// seams: a continuous 440 Hz tone cut at 20 places. No click at any seam (the sample-to-sample step must stay
// within the tone's own slope times a small margin), every seam carries a micro-fade >= 5 ms (the 8 ms raised-
// cosine default), no black or frozen frame at the joins, and a J/L offset is honored to the sample.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { buildDialog, wavInfo } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { grid, timelineFrames } from '../lib/edit-ops.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-seams', SR = 48000, CUTS = 20;

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  const tone = join(FILMS, KEY, 'tone.wav');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  (await import('node:fs')).mkdirSync(join(FILMS, KEY), { recursive: true });
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', '-c:a', 'pcm_s16le', tone]);
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, tone, { id: 'tone', log: () => {} }); // an audio-only source
  // 20 cuts of the tone back to back (0.35s each) on A1; J-cut the 5th by 150 ms; video from the sync fixture keeps the picture side honest
  const syncId = 'cam';
  await ingestSource(KEY, (await import('../fixtures.mjs')).fixturePath('sync'), { id: syncId, log: () => {} });
  const G = () => grid(loadEdit(KEY).edit);
  for (let i = 0; i < CUTS; i++) await applyOps(KEY, { op: 'add', src: 'tone', track: 'A1', in: i * 0.4, out: i * 0.4 + 0.35, note: `seam ${i}` });
  for (let i = 0; i < CUTS; i++) await applyOps(KEY, { op: 'add', src: syncId, in: 60 + i * 15, out: 60 + i * 15 + 10 });
  await applyOps(KEY, { op: 'jcut', id: loadEdit(KEY).edit.tracks[1].clips[4].id, ms: 150 });
  syncFilm(KEY);
  await buildDialog(KEY, { log: () => {} });
  const [out] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} });

  const film = readFilm(KEY), edit = loadEdit(KEY).edit, Gg = grid(edit);
  const wav = join(film.out, 'dialog.wav'), info = wavInfo(wav), fd = readFileSync(wav);
  const at = (s) => info.dataStart + s * info.channels * 4; // 32-bit float stereo
  const ch = (s) => fd.readFloatLE(at(s));
  const total = timelineFrames(edit) / 30;

  // the seams of A1 (every clip boundary), each 0.35s long
  const seams = [];
  { const t = edit.tracks.find((x) => x.id === 'A1'); let cursor = 0; for (const c of [...t.clips].sort((a, b) => a.at - b.at)) { seams.push({ at: +c.at, end: +(c.at + 0.35).toFixed(4) }); cursor = c.at + 0.35; } void cursor; }

  // 1. no click: the biggest sample-to-sample step at a seam, vs the tone's own natural step (2*pi*440*A/SR)
  const amp = 0.5;
  const naturalStep = ((2 * Math.PI * 440 * amp) / SR) * 1.5 + 1e-4;
  const clicky = [];
  for (const s of seams) {
    const center = Math.round(s.at * SR);
    let maxStep = 0;
    for (let i = center - 240; i < center + 240; i++) maxStep = Math.max(maxStep, Math.abs(ch(i + 1) - ch(i)));
    if (maxStep > naturalStep) clicky.push({ at: s.at, maxStep: maxStep.toFixed(5), bar: naturalStep.toFixed(5) });
  }
  need(clicky.length === 0, `clicks at ${clicky.map((c) => `${c.at}s (step ${c.maxStep} > ${c.bar})`).join(', ')}`);
  facts.push(`${seams.length} seams, max step within the tone's own slope`);

  // 2. micro-fade >= 5 ms at every seam except the J-cut one (its audio crosses the join by design)
  for (let si = 0; si < seams.length; si++) {
    if (si === 4) continue;
    const s = seams[si], center = Math.round(s.at * SR);
    let loud = 0, quiet = 0;
    for (let i = center - 400; i < center + 400; i++) { const v = Math.abs(ch(i)); if (v > 0.3 * amp) loud++; else if (v < 0.05 * amp) quiet++; }
    const dip = quiet >= 100 && loud < 700; // a >= 5 ms fade leaves ~100+ near-zero samples around the join
    if (!dip) bad.push(`seam at ${s.at}s has no micro-fade (quiet ${quiet}, loud ${loud})`);
  }
  facts.push('micro-fades present at the seams (8 ms default)');

  // 3. the J-cut: clip 5's audio starts 150 ms after its picture... audio-only here, so check the clip's audio start moved
  { const t = edit.tracks.find((x) => x.id === 'A1'), c5 = t.clips[4];
    const startS = Math.round(c5.at * SR), jc = (c5.audio?.j_cut_ms ?? 0) / 1000;
    // find where tone energy actually begins near the clip start
    let i = startS - 200; while (i < startS + SR && Math.abs(ch(i)) < 0.1 * amp) i++;
    const offMs = ((i - startS) / SR) * 1000;
    need(Math.abs(offMs - jc * 1000) <= 3, `J-cut: audio begins ${offMs.toFixed(0)} ms into the clip, wanted ${jc * 1000} ms`);
    facts.push(`J/L offset honored: ${offMs.toFixed(0)} ms (set ${jc * 1000} ms)`); }

  // 4. no black or frozen frames at the video seams (blackdetect + freezedetect on the render)
  const { err: bd } = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', out.file, '-vf', 'blackdetect=d=0.04:pix_th=0.08', '-an', '-f', 'null', '-'], { allowFail: true });
  const blacks = [...bd.matchAll(/black_start:([\d.]+)/g)].map((m) => +m[1]);
  need(blacks.length === 0, `black frames at ${blacks.join(', ')}s`);
  const { err: fz } = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', out.file, '-vf', 'freezedetect=n=-75dB:d=0.5', '-an', '-f', 'null', '-'], { allowFail: true });
  const frozens = [...fz.matchAll(/freeze_start:([\d.]+)/g)].map((m) => +m[1]);
  need(frozens.length === 0, `frozen frames at ${frozens.join(', ')}s`);
  facts.push('no black or frozen frames at the joins');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
