// The verifier library (K5): every measurable requirement resolves to a measurement on the actual
// deliverables (ffprobe/ffmpeg/ASR — never a guess). Each verifier: (req, { key, finals }) ->
// { row: { status, evidence, measured }, why? }. Seeded bad media must FAIL with a message.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FILMS, readJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const ffprobe = (file, args) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 << 20 }));

/** The project's video deliverables: out/final-<fmt>.mp4 for every asked format (16x9 slugs). */
export function finalsOf(key, { formats } = {}) {
  const out = join(FILMS, key, 'out');
  if (!existsSync(out)) return [];
  const want = (formats || readJson(join(FILMS, key, 'film.json'), {}).formats || []).map((f) => f.replace(':', 'x'));
  const files = readdirSync(out).filter((f) => /^final-[\w-]+\.mp4$/.test(f));
  return want.map((f) => join(out, `final-${f}.mp4`)).filter(existsSync).concat(
    files.filter((f) => !want.some((w) => f === `final-${w}.mp4`)).map((f) => join(out, f)));
}

const probeVideo = (file) => {
  const j = ffprobe(file, ['-show_entries', 'stream=codec_type,width,height,pix_fmt,sample_aspect_ratio:format=duration', '-select_streams', 'v']);
  return { v: (j.streams || [])[0], duration: +j.format.duration };
};

const loudnessOf = (file) => {   // ebur128: integrated LUFS + true peak
  const out = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 5 * 60 * 1000 }).stderr || '';
  const j = JSON.parse(out.slice(out.indexOf('{', out.indexOf('Input Integrated'))));
  return { lufs: +j.input_i, tp: +j.input_tp };
};

// ── the verifiers ────────────────────────────────────────────────────────────────────────────
const VERIFIERS = {
  /** duration <arg> seconds within <tolerance> (default 2s) on every final. */
  duration: async (req, ctx) => {
    const tol = req.tolerance ?? 2;
    const bad = [], lines = [];
    for (const f of pick(ctx)) {
      const d = probeVideo(f).duration;
      if (Math.abs(d - req.arg) > tol) bad.push(`${f.split('/').pop()}: ${d.toFixed(2)}s vs ${req.arg}s`);
      lines.push(`${f.split('/').pop()} ${d.toFixed(2)}s`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** every asked format exists as a final, with the exact geometry. */
  formats: async (req, ctx) => {
    const want = [].concat(req.arg);
    const GEO = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
    const bad = [], lines = [];
    for (const f of want) {
      const file = join(FILMS, ctx.key, 'out', `final-${f.replace(':', 'x')}.mp4`);
      if (!existsSync(file)) { bad.push(`${f}: no final-${f.replace(':', 'x')}.mp4`); continue; }
      const { v } = probeVideo(file);
      const [W, H] = GEO[f] || [];
      if (W && (v.width !== W || v.height !== H)) bad.push(`${f}: ${v.width}x${v.height} vs ${W}x${H}`);
      lines.push(`${f} ${v.width}x${v.height}`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** resolution >= <arg> on the long side (e.g. 1080). */
  resolution: async (req, ctx) => {
    const bad = [], lines = [];
    for (const f of pick(ctx)) { const { v } = probeVideo(f); if (Math.max(v.width, v.height) < req.arg) bad.push(`${f.split('/').pop()}: ${v.width}x${v.height} < ${req.arg}`); lines.push(`${v.width}x${v.height}`); }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || `every final >= ${req.arg}p (${lines.join(', ')})`, measured: lines.join(', ') };
  },
  /** loudness at <arg> LUFS (default the project's mix.lufs) ± 1, true peak <= -1 dBTP. */
  loudness: async (req, ctx) => {
    const target = req.arg ?? readJson(join(FILMS, ctx.key, 'film.json'), {}).mix?.lufs ?? -14;
    const bad = [], lines = [];
    for (const f of pick(ctx)) {
      const { lufs, tp } = loudnessOf(f);
      if (Math.abs(lufs - target) > 1 || tp > -1) bad.push(`${f.split('/').pop()}: ${lufs} LUFS / ${tp} dBTP (want ${target} ±1 / <= -1)`);
      lines.push(`${lufs} LUFS, ${tp} dBTP`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** an audio stream exists (and is not digital silence). */
  'has-audio': async (req, ctx) => {
    const bad = [], lines = [];
    for (const f of pick(ctx)) {
      const j = ffprobe(f, ['-show_entries', 'stream=codec_type:format=duration', '-select_streams', 'a']);
      const a = (j.streams || [])[0];
      if (!a) { bad.push(`${f.split('/').pop()}: no audio stream`); continue; }
      // mean volume over the first 30s: silence measures about -91 dB
      const out = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-t', '30', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8', timeout: 2 * 60 * 1000 }).stderr || '';
      const mean = +/mean_volume:\s*(-?[\d.]+) dB/.exec(out)?.[1];
      if (!(mean > -60)) bad.push(`${f.split('/').pop()}: audio is silent (mean ${mean} dB)`);
      lines.push(`mean ${mean} dB`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** caption files exist (out/captions.srt) and are non-empty, monotonic. */
  captions: async (req, ctx) => {
    const dir = join(FILMS, ctx.key, 'out');
    const srt = join(dir, 'captions.srt');
    if (!existsSync(srt)) return { status: 'red', evidence: 'no out/captions.srt (burned-in captions still need the sidecar file)', measured: 'missing' };
    const txt = readFileSync(srt, 'utf8');
    const cues = txt.split('\r\n\r\n').filter((b) => b.trim()).length;
    const times = [...txt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g)]
      .map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000);
    const mono = times.every((t, i) => i === 0 || t >= times[i - 1]);
    if (!cues || !mono) return { status: 'red', evidence: `${cues} cues, monotonic=${mono}`, measured: `${cues} cues` };
    return { status: 'green', evidence: `${cues} cues, monotonic`, measured: `${cues} cues` };
  },
  /** the narration's language is <arg> (ASR on the final mix; default 'auto' detects). */
  language: async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return { status: 'red', evidence: 'no finals to listen to', measured: 'none' };
    const { transcribeMix } = await import('./asr-probe.mjs');
    const r = await transcribeMix(files[0]);
    if (req.arg && r.language !== String(req.arg)) return { status: 'red', evidence: `ASR heard ${r.language} (${r.probability}), want ${req.arg}`, measured: r.language };
    return { status: 'green', evidence: `ASR heard ${r.language} (${r.probability})`, measured: r.language };
  },
  /** every final's video stays inside the platform safe area (no content in the outer 6%/10% band):
   *  measured as a near-black band check on a motionless frame — the real craft rule lives in the
   *  engines' own layout; this catches a render that ignored it entirely. */
  'safe-area': async (req, ctx) => {
    const bad = [], lines = [];
    for (const f of pick(ctx)) {
      const { v } = probeVideo(f);
      const portrait = v.height > v.width;
      const [x0, y0] = [Math.round(v.width * (portrait ? 0.07 : 0.06)), Math.round(v.height * 0.08)];
      const crop = portrait ? `${v.width - 2 * x0}:${Math.round(v.height * 0.72)}:${x0}:${y0}` : `${Math.round(v.width * 0.88)}:${v.height - 2 * y0}:${x0}:${y0}`;
      const out = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', `${crop},signalstats,metadata=print:file=-`, '-f', 'null', '-'], { encoding: 'utf8', timeout: 2 * 60 * 1000 }).stdout || '';
      const yavg = +/lavfi\.signalstats\.YAVG=([\d.]+)/.exec(out)?.[1];
      if (!(yavg >= 8)) bad.push(`${f.split('/').pop()}: the safe band is near-black (YAVG ${yavg}) — the content is outside the safe area`);
      lines.push(`safe YAVG ${yavg}`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** the named asset (arg: an assets.json id) is actually used by a child (in its film folder, hash-matched). */
  'asset-used': async (req, ctx) => {
    const assets = readJson(join(FILMS, ctx.key, 'assets.json'), []);
    const a = assets.find((x) => x.id === req.arg) || assets.find((x) => x.id === String(req.arg));
    if (!a) return { status: 'red', evidence: `no asset "${req.arg}" in assets.json`, measured: 'missing' };
    const want = a.sha256;
    // the asset's bytes appear under some child film folder (the render copies them in)
    for (const child of childrenOf(ctx.key)) {
      const found = walkHash(join(FILMS, child), want);
      if (found) return { status: 'green', evidence: `${a.id} used by ${child} (${found})`, measured: found };
    }
    return { status: 'red', evidence: `${a.id} (sha ${String(want).slice(0, 8)}) is not in any child film folder`, measured: 'not used' };
  },
  /** every final <= <arg> MiB. */
  'max-size': async (req, ctx) => {
    const bad = [], lines = [];
    for (const f of pick(ctx)) { const mb = statSync(f).size / (1024 * 1024); if (mb > req.arg) bad.push(`${f.split('/').pop()}: ${mb.toFixed(1)} MiB > ${req.arg}`); lines.push(`${mb.toFixed(1)} MiB`); }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
};

const pick = (ctx) => ctx.finals || finalsOf(ctx.key);
function childrenOf(key) {
  const pre = `${key}-`;
  return existsSync(FILMS) ? readdirSync(FILMS).filter((f) => f.startsWith(pre) && existsSync(join(FILMS, f, 'film.json'))) : [];
}
function walkHash(dir, want) {   // find a file whose sha256 == want (bounded: skip out/, records/)
  const shaOf = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };
  const walk = (d, depth) => {
    if (depth > 4) return null;
    for (const f of readdirSync(d)) {
      if (f === 'out' || f === 'records' || f.startsWith('.') || f === 'node_modules') continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) { const r = walk(p, depth + 1); if (r) return r; }
      else if (shaOf(p) === want) return p.replace(ROOT + '/', '');
    }
    return null;
  };
  try { return walk(dir, 0); } catch { return null; }
}

/** Dispatch one measurable requirement. Unknown verifier -> a loud throw (the ledger check proves it). */
export async function verifyRequirement(req, ctx) {
  const v = VERIFIERS[req.verifier];
  if (!v) throw new Error(`requirement ${req.id}: no verifier "${req.verifier}" in the library (${Object.keys(VERIFIERS).join(', ')})`);
  const row = await v(req, ctx);
  return { row: { status: row.status, evidence: row.evidence }, measured: row.measured, why: row.evidence };
}
export const VERIFIER_NAMES = Object.keys(VERIFIERS);
