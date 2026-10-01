// parity: the live page, a draft and a final render of the same edit agree on sampled frames.
// Both sides are compared in the deliverable's own colour space (the page PNG -> yuv420p first); SSIM >= 0.92
// per frame on natural footage — the bar and its full evidence trail are in docs/editing/DECISIONS.md D-012.
// (after resizing the smaller): what you scrub in the GUI is what you export.
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openStudio } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { cutEdit } from './_editslice.mjs';
import { renderFilm } from '../render.mjs';

// The page PNG is RGB; the deliverable is yuv420p. Comparing across colour spaces measures the conversion, not
// the picture, so the page is put into the deliverable's own space first (D-012).
const ssim = async (a, b, tmp) => {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', a, '-i', b, '-lavfi', `[0:v]format=yuv420p[p];[p][1:v]ssim=f:stats_file=${tmp}`, '-f', 'null', '-']);
  const s = (await import('node:fs')).readFileSync(tmp, 'utf8'), vals = [...s.matchAll(/All:([\d.]+|[iI][nN][fF]+)/g)].map((m) => (/[iI]/.test(m[1]) ? 1 : +m[1]));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
};
// Grab a frame as PNG (nothing lossy on top of the codec's own loss) and seek exactly: -ss AFTER -i
// (-ss before -i snaps to the nearest keyframe, which is not the frame we sampled on the page).
const grab = async (mp4, t, out) => run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-ss', String(t), '-frames:v', '1', out]);

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const tmp = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    // natural footage: on synthetic hard-edge patterns (barcode cells, saturated bars) crf16 ringing caps SSIM
    // around 0.92 even for a frame-exact match (measured in D-012); those fixtures' exactness is proven by frame-exact instead.
    // natural talking footage, cuts starting at source frame 200 (past the intro title card: flat graphics
    // cap SSIM at ~0.94 whatever the crf — measured D-012 — and the talking head is what parity is about)
    for (const [id, fx, fmt, start, len] of [['real', 'real-talking-head', '16:9', 200, 40], ['real1080', 'real1080', '16:9', 0, 30]]) {
      const { film } = await cutEdit(`verify-par-${id}`, fx, { fps: 30, cuts: 5, cutLen: len, gap: 30, fmt: [fmt], srcStart: start });
      const [draft] = await renderFilm(film.key, { quality: 'draft', fmt, workers: 2, log: () => {} });
      const [final] = await renderFilm(film.key, { quality: 'final', fmt, workers: 2, log: () => {} });
      // 10 frames from the page (full res) vs the final; and draft (half res) vs final resized
      const studio = await openStudio(), page = await studio.page(film, fmt, 1);
      const D = film.cfg.duration, lows = [];
      for (let i = 0; i < 10; i++) {
        const t = ((i + 0.5) / 10) * (D - 0.1);
        const png = join(tmp, `p-${id}-${i}.png`);
        (await import('node:fs')).writeFileSync(png, Buffer.from((await page.evaluate((t) => window.__frame(t, 'image/png'), t)).slice(22), 'base64'));
        const f = join(tmp, `f-${id}-${i}.png`); await grab(final.file, t, f);
        const s = await ssim(png, f, join(tmp, 's.txt'));
        if (s < 0.92) lows.push(`frame ${i}: ssim ${s}`);
      }
      await studio.close();
      need(lows.length === 0, `${id}: page vs final ${lows.join(', ')}`);
      // draft vs final: resize the final down to the draft's size first (the check's own rule)
      const da = join(tmp, `d-${id}.png`), db = join(tmp, `df-${id}.png`), small = join(tmp, `df-small-${id}.png`);
      await grab(draft.file, D / 2, da); await grab(final.file, D / 2, db);
      await run('ffmpeg', ['-y', '-v', 'error', '-i', db, '-vf', 'scale=iw/2:ih/2', small]);
      const dl = await ssim(da, small, join(tmp, 's.txt'));
      need(dl >= 0.92, `${id}: draft vs final ssim ${dl}`);
      facts.push(`${id}: page/final ssim >= 0.92 (10 frames, D-012), draft/final ${dl.toFixed(3)}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
