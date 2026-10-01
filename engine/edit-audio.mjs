// The dialog bus (mission D4): the edit's audio as one sample-accurate stem, composited in Node from each source's audio.wav
// (48 kHz 16-bit PCM from ingest). Frame boundaries map to sample boundaries with one rounding rule everywhere:
//   sampleAt(frame) = round(frame * den * 48000 / num)     (NTSC: 1601.6 samples per frame, so lengths are exact to one sample)
// so a clip that starts at frame n starts at sampleAt(n) and an A/V offset can only come from the encoder, never from here.
import { homedir } from 'node:os';
import { closeSync, existsSync, openSync, readSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize, writeWav } from './audio.mjs';
import { readBin } from './ingest.mjs';
import { clipFrames, grid, timelineFrames } from './lib/edit-ops.mjs';
import { loadEdit } from './lib/edit-store.mjs';
import { mediaDir } from './ingest.mjs';
import { run } from './lib/proc.mjs';

const SR = 48000;
const CLEAN_RECIPE = 2; // hp 80 Hz, arnndn (RNNoise model; afftdn fallback), alimiter. Compressor dropped: it cost 1.3 WER points for nothing (D-014)

// Per-source cleanup (D4): high-pass ~80 Hz, afftdn denoise, a gentle compressor, a limiter — cached in the
// source's media folder (audio-clean.wav), so the mix builds fast on re-runs. Originals untouched.
export async function cleanAudio(film, id, { log = () => {} } = {}) {
  const bin = readBin(film), src = bin.sources[id];
  if (!src) throw new Error(`no source "${id}"`);
  const dir = mediaDir(film, id), inWav = join(dir, 'audio.wav'), out = join(dir, 'audio-clean.wav');
  const stateFile = join(dir, 'ingest.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const key = `clean${CLEAN_RECIPE}:${src.sha256.slice(0, 16)}`;
  if (state.steps?.clean === key && existsSync(out)) return out;
  const part = `${out}.part.wav`;
  // arnndn with the RNNoise speech model (measured on `noisy`: floor -33.3 -> -51 dB, WER unchanged at 1.4%;
  // afftdn only reached -4.8 dB). Without the model file, fall back to afftdn and say so in the log.
  const model = join(homedir(), '.local', 'share', 'pi-motion-studio', 'models', 'rnnoise', 'sh.rnnn');
  const denoise = existsSync(model) ? `arnndn=m=${model}` : 'afftdn=nr=12:nf=-40';
  if (!existsSync(model)) log(`clean ${id}: rnnoise model missing -> afftdn fallback (fetch models/rnnoise/sh.rnnn, see THIRD_PARTY.md)`);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', inWav, '-af',
    `highpass=f=80,${denoise},alimiter=limit=0.9:attack=2:release=36`,
    '-ar', String(SR), '-c:a', 'pcm_s16le', part]);
  renameSync(part, out);
  state.steps = { ...(state.steps || {}), clean: key };
  writeFileSync(stateFile, JSON.stringify(state, null, 1));
  log(`clean ${id}: denoise + hp + compressor -> audio-clean.wav`);
  return out;
}

// header of a PCM WAV: finds the data chunk wherever ffmpeg put it (LIST chunks, etc.)
export function wavInfo(file) {
  const fd = openSync(file, 'r'), head = Buffer.alloc(4096);
  try {
    readSync(fd, head, 0, 4096, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${file} is not a WAV`);
    let o = 12, ch = 0, rate = 0, bits = 0, fmt = 0;
    while (o + 8 <= head.length) {
      const id = head.toString('ascii', o, o + 4), size = head.readUInt32LE(o + 4);
      if (id === 'fmt ') { fmt = head.readUInt16LE(o + 8); ch = head.readUInt16LE(o + 10); rate = head.readUInt32LE(o + 12); bits = head.readUInt16LE(o + 22); }
      if (id === 'data') return { channels: ch, rate, bits, format: fmt, dataStart: o + 8, bytes: size === 0xffffffff || size === 0 ? null : size };
      o += 8 + size + (size & 1);
    }
    throw new Error(`${file}: no data chunk in the first 4 KB`);
  } finally { closeSync(fd); }
}

// samples [a, b) of a 16-bit PCM wav as per-channel Float32Arrays (zeros past the end of the file)
function readSegment(file, info, a, b) {
  const n = b - a, ch = info.channels, out = Array.from({ length: ch }, () => new Float32Array(n)), bytes = Buffer.alloc(n * ch * 2);
  const fd = openSync(file, 'r');
  try { readSync(fd, bytes, 0, bytes.length, info.dataStart + a * ch * 2); } finally { closeSync(fd); }
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = bytes.readInt16LE((i * ch + c) * 2) / 32768;
  return out;
}

// pitch-preserving retime of a segment to exactly dst samples (atempo chain; each stage is within 0.5..100)
async function stretch(chans, dst, tmp) {
  const ch = chans.length, n = chans[0].length, pcm = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), (i * ch + c) * 2);
  const inF = `${tmp}.in.raw`, outF = `${tmp}.out.raw`; writeFileSync(inF, pcm);
  let r = n / dst; const chain = [];
  while (r < 0.5) { chain.push('atempo=0.5'); r /= 0.5; } while (r > 100) { chain.push('atempo=100'); r /= 100; } chain.push(`atempo=${r.toFixed(8)}`);
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', String(SR), '-ac', String(ch), '-i', inF, '-af', chain.join(','), '-f', 's16le', '-ar', String(SR), '-ac', String(ch), outF]);
    const buf = (await import('node:fs')).readFileSync(outF), got = Math.floor(buf.length / (ch * 2)), res = Array.from({ length: ch }, () => new Float32Array(dst));
    for (let i = 0; i < Math.min(got, dst); i++) for (let c = 0; c < ch; c++) res[c][i] = buf.readInt16LE((i * ch + c) * 2) / 32768;
    return res;
  } finally { rmSync(inF, { force: true }); rmSync(outF, { force: true }); }
}

// two clips of one track that are the same continuous speech (no cut between them): no micro-fade at the join
const continuous = (a, b) => a.src === b.src && a.speed === b.speed && !a.freeze && !b.freeze && a.out === b.in && a.at + 0 <= b.at;

// Build out/dialog.wav. Returns { file, samples, frames, clips }.
export async function buildDialog(filmKey, { log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit), { fps } = G, sampleAt = (f) => Math.round((f * fps.den * SR) / fps.num);
  const frames = timelineFrames(edit), total = sampleAt(frames), L = new Float32Array(total), R = new Float32Array(total);
  let placed = 0;
  for (const track of edit.tracks) {
    const cs = [...track.clips].sort((a, b) => G.F(a.at) - G.F(b.at));
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], s = edit.sources[c.src];
      if (c.freeze || !s.has_audio || c.audio?.mute) continue;
      // the cleanup chain runs once per source (cached); the mix always reads the cleaned copy
      const wav = await cleanAudio(film, c.src, { log });
      if (!existsSync(wav)) throw new Error(`no audio.wav for source "${c.src}": re-run \`studio ingest ${film.key} <file> --id ${c.src}\``);
      const info = wavInfo(wav), a0 = sampleAt(G.F(c.in)), a1 = sampleAt(G.F(c.out)), d0 = sampleAt(G.F(c.at)), d1 = sampleAt(G.F(c.at) + clipFrames(edit, c)), dst = d1 - d0;
      let seg = readSegment(wav, info, a0, a1);
      if (c.dur !== undefined || a1 - a0 !== dst) seg = await stretch(seg, dst, join(film.out, `.stretch-${c.id}`));
      const gain = 10 ** ((c.audio?.gain_db ?? 0) / 20), [fi, fo] = c.audio?.fade_ms ?? [8, 8];
      const prev = cs[i - 1], next = cs[i + 1];
      const nIn = prev && G.F(prev.at) + clipFrames(edit, prev) === G.F(c.at) && continuous(prev, c) ? 0 : Math.round((fi * SR) / 1000);
      const nOut = next && G.F(c.at) + clipFrames(edit, c) === G.F(next.at) && continuous(c, next) ? 0 : Math.round((fo * SR) / 1000);
      const jcutS = (c.audio?.j_cut_ms ?? 0) / 1000; // J/L offset: this clip's audio starts after its picture
      const d0j = Math.max(0, d0 + Math.round(jcutS * SR));
      const dstJ = Math.min(total, d1 + Math.round(jcutS * SR));
      const dst2 = Math.max(0, dstJ - d0j);
      if (dst2 <= 0) { placed++; continue; }
      if (seg[0].length > dst2) seg = seg.map((ch) => ch.subarray(0, dst2)); else if (seg[0].length < dst2) seg = seg.map((ch) => { const o = new Float32Array(dst2); o.set(ch); return o; });
      const mono = seg.length === 1;
      const D = d0j, N = dst2;
      for (let k = 0; k < N; k++) {
        let g = gain; if (k < nIn) g *= 0.5 - 0.5 * Math.cos((Math.PI * k) / nIn); if (k >= N - nOut) g *= 0.5 - 0.5 * Math.cos((Math.PI * (N - 1 - k)) / nOut);
        L[D + k] += seg[0][k] * g; R[D + k] += (mono ? seg[0][k] : seg[1][k]) * g;
      }
      placed++;
    }
  }
  const file = join(film.out, 'dialog.wav'); writeWav(file, L, R);
  log(`dialog.wav: ${placed} clips, ${total} samples (${(total / SR).toFixed(3)}s) = ${frames} frames`);
  return { file, samples: total, frames, clips: placed };
}

// dialog.wav (+ the synthesized/supplied music bed and sfx when the film has them) -> out/mix.wav at the loudness target
export async function mixEdit(filmKey, { target } = {}) {
  const { film } = loadEdit(filmKey), cfg = film.cfg, lufs = target ?? cfg.mix?.lufs ?? -14, pre = join(film.out, '.premix.wav'), file = join(film.out, 'mix.wav');
  const dialog = join(film.out, 'dialog.wav'), extras = [join(film.out, 'music.wav'), join(film.out, 'sfx.wav')].filter((f) => existsSync(f) && (cfg.music || cfg.track));
  const D = (film.fps.den * timelineFramesOf(filmKey)) / film.fps.num;
  const duckDb = cfg.mix?.duck_db ?? -12, duckAtt = 150, duckRel = 400; // craft rule: 10-14 dB, ~150/400 ms
  const inputs = [dialog, ...extras];
  // the dialog bus keys the sidechain that ducks the bed (D4); music never fights the voice
  const chain = inputs.map((_, i) => `[${i}:a]aresample=${SR}[a${i}]`).join(';');
  const r = Math.max(1, 20 * Math.log10(10 ** (-duckDb / 20))); // duckDb -> compression ratio at a fixed threshold
  const mix = inputs.length === 1
    ? '[a0]anull[m]'
    : `[a0]asplit=2[key][dial];[a1][key]sidechaincompress=threshold=0.02:ratio=${r.toFixed(2)}:attack=${Math.round(duckAtt)}:release=${Math.round(duckRel)}:makeup=1:link=average[bed];[dial][bed]amix=inputs=2:normalize=0[m]`;
  const extraCh = inputs.slice(2).map((_, i) => `;[a${i + 2}]anull[b${i}]`).join('') + (inputs.length > 2 ? `;[m]${inputs.slice(2).map((_, i) => `[b${i}]`).join('')}amix=inputs=${inputs.length - 1}:normalize=0[m]` : '');
  await run('ffmpeg', ['-y', '-v', 'error', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', `${chain};${mix}${extraCh}`, '-map', '[m]', '-ac', '2', '-c:a', 'pcm_f32le', pre]);
  const l = await normalize(pre, file, lufs);
  rmSync(pre, { force: true });
  return { file, ...l, duration: D };
}
const timelineFramesOf = (k) => timelineFrames(loadEdit(k).edit);
