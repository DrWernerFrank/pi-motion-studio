// av-sync: the fixtures carry a 1 kHz beep and a white flash at the same instants (every 2 s, frame n%60==0).
// Measured on the deliverable: beep onset = first audio energy above -30 dBFS at/after the expected time; flash =
// the local luma spike near that time. |onset - flash| <= 20 ms at the start/middle/end of a 12-cut render, across
// a 1.5x retime (pitch-preserving), and in the last 30 s of a 20-minute timeline built from `long`.
import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { buildDialog, mixEdit, wavInfo } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { cutEdit } from './_editslice.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { grid } from '../lib/edit-ops.mjs';
import { ingestSource } from '../ingest.mjs';
import { fixturePath } from '../fixtures.mjs';
import { rmSync } from 'node:fs';
import { FILMS } from '../lib/film.mjs';

const SR = 48000;
// the mp4's AAC audio as 16-bit PCM (decode only), plus its header info
const decodeAudio = async (mp4, tmp) => { await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', tmp]); return wavInfo(tmp); };
const absAt = (info, sample) => info.dataStart + sample * info.channels * 2;
function onsetAt(file, info, fromSample, maxSamples) {
  if (fromSample < 0) { maxSamples += fromSample; fromSample = 0; } // a window that starts before the file starts at 0
  const buf = Buffer.alloc(maxSamples * info.channels * 2), fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, buf.length, absAt(info, fromSample)); } finally { closeSync(fd); }
  for (let i = 0; i < maxSamples; i++) for (let c = 0; c < Math.min(2, info.channels); c++) if (Math.abs(buf.readInt16LE((i * info.channels + c) * 2) / 32768) > 10 ** (-30 / 20)) return fromSample + i;
  return -1;
}
// luma per frame of the render; the flash is the local max within +-0.4 s of the expected time
async function flashTime(mp4, expectS, fps) {
  // metadata=print writes two lines per frame: "frame:N pts:P pts_time:T" then "lavfi.signalstats.YAVG=V"
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']);
  let best = null;
  for (const m of out.matchAll(/frame:(\d+)\s+pts:\d+\s+pts_time:([\d.]+)\nlavfi\.signalstats\.YAVG=([\d.]+)/g)) {
    const t = +m[2]; // pts_time is the deliverable's own clock
    if (Math.abs(t - expectS) <= 0.4 && (!best || +m[3] > best.y)) best = { y: +m[3], t };
  }
  return best?.t ?? null;
}

export default async ({ quick } = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  // a 12-cut edit on `sync` (a flash+beep every 2 s) with cut #1 retimed to 1.5x
  const { film, plan, G } = await cutEdit('verify-av', 'sync', { fps: 30, cuts: 12, cutLen: 55, gap: 5, retime: 1.5 });
  const fps = film.fps.value;
  await buildDialog('verify-av', { log: () => {} }); await mixEdit('verify-av');
  const [r] = await renderFilm('verify-av', { quality: 'final', fmt: '16:9', workers: 2, log: () => {} });
  const tmp = join(film.out, '.av.wav'), info = await decodeAudio(r.file, tmp);
  const retimed = plan[1].frames !== plan[1].outF - plan[1].inF;
  const atOf = (idx) => plan.slice(0, idx).reduce((a, q) => a + q.frames, 0);

  // spots at the start, middle and end: each cut's in-range flash, mapped onto the timeline (retime aware)
  const spots = [];
  for (const idx of [0, Math.floor(plan.length / 2), plan.length - 1]) {
    const p = plan[idx]; let f = Math.ceil(p.inF / 60) * 60; if (f >= p.outF) f -= 60;
    if (p.inF <= f && f < p.outF) {
      const rate = (idx === 1 && retimed) ? 1.5 : 1; // source frames per timeline frame
      spots.push({ label: `cut${idx}`, tl: atOf(idx) / fps + (f - p.inF) / (rate * fps) });
    }
  }
  need(spots.length === 3, `only ${spots.length} spots had an in-range flash`);
  for (const s of spots) {
    const flash = await flashTime(r.file, s.tl, fps);
    const on = onsetAt(tmp, info, Math.floor((s.tl - 0.15) * SR), Math.floor(0.3 * SR)) / SR;
    need(flash !== null, `${s.label}: no flash near ${s.tl.toFixed(3)}s`);
    if (flash === null) continue;
    need(on > 0, `${s.label}: no beep onset near ${s.tl.toFixed(3)}s`);
    if (on <= 0) continue;
    const off = Math.abs(on - flash) * 1000;
    need(off <= 20, `${s.label}: beep onset ${on.toFixed(3)}s vs flash ${flash.toFixed(3)}s = ${off.toFixed(0)} ms (<= 20 wanted)`);
    facts.push(`${s.label}: ${(on - flash) >= 0 ? '+' : ''}${(1000 * (on - flash)).toFixed(0)} ms`);
  }
  facts.push(retimed ? 'cut1 retimed 1.5x (pitch preserved), beep locked' : 'no retime applied');
  rmSync(tmp, { force: true });

  // the 20-minute timeline: one 19:30 clip then six cuts, so the tail is cut material from the end of `long`
  if (!quick) {
    const K = 'verify-av-long';
    rmSync(join(FILMS, K), { recursive: true, force: true });
    await (await import('../edit-cli.mjs')).createEditFilm(K, { fps: 30, title: K });
    await ingestSource(K, fixturePath('long'), { id: 'cam', log: () => {} });
    const G2 = grid(loadEdit(K).edit);
    await applyOps(K, { op: 'add', src: 'cam', in: 0, out: G2.S(1170) });
    for (let i = 0; i < 6; i++) await applyOps(K, { op: 'add', src: 'cam', in: G2.S(1170 + i * 5), out: G2.S(1173 + i * 5) });
    syncFilm(K);
    await buildDialog(K, { log: () => {} }); await mixEdit(K);
    const [r2] = await renderFilm(K, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} });
    const w2 = join((await import('../lib/film.mjs')).readFilm(K).out, '.av2.wav'), info2 = await decodeAudio(r2.file, w2);
    // the last flash inside the final cut (source frames 1185..1170+... -> n%60==0), timeline ~1170+15s
    const total = 1170 + 18, last = total - 1.2;
    const flash2 = await flashTime(r2.file, last, fps);
    const on2 = onsetAt(w2, info2, Math.floor((last - 0.3) * SR), Math.floor(0.5 * SR)) / SR;
    need(flash2 !== null && on2 > 0, `20-min tail: no flash (${flash2}) or beep (${on2}) near ${last.toFixed(1)}s`);
    if (flash2 !== null && on2 > 0) {
      const off2 = Math.abs(on2 - flash2) * 1000;
      need(off2 <= 20, `20-min tail: onset ${on2.toFixed(3)}s vs flash ${flash2.toFixed(3)}s = ${off2.toFixed(0)} ms`);
      facts.push(`20-min timeline (${total}s, ${loadEdit(K).edit.tracks[0].clips.length} clips): tail off ${off2.toFixed(0)} ms`);
    }
    rmSync(w2, { force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
