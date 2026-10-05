// Shared by the edit-slice checks (frame-exact, av-sync, rational-fps, parity, determinism): a temp edit film
// from a fixture, cut N times, rendered through the normal paths. verify-edit removes films/verify-* afterwards.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { ingestSource, mediaDir } from '../ingest.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { grid } from '../lib/edit-ops.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

// Build films/<key> as an edit film on fixture `fx` (source id "cam") with `cuts` cuts of cutLen source frames,
// spaced cutLen+gap apart (so no source frame is used twice). retime: cut #1 plays at that speed.
// extraOps run after the adds. Returns { film, plan: [{inF, outF, frames}], conformed, cfps, G }.
export async function cutEdit(key, fx, { cuts = 12, cutLen = 15, gap = 40, fps, retime, extraOps = [], fmt = ['16:9'], srcStart = 0, log = () => {} } = {}) {
  const dir = join(FILMS, key); rmSync(dir, { recursive: true, force: true });
  const { createEditFilm } = await import('../edit-cli.mjs');
  await createEditFilm(key, { fps, title: key, formats: fmt });
  const rec = await ingestSource(key, fixturePath(fx), { id: 'cam', log });
  const cfps = rec.ingest.conform, G = grid(loadEdit(key).edit);
  const plan = []; let src = srcStart;
  for (let i = 0; i < cuts; i++) {
    const frames = i === 1 && retime ? Math.max(1, Math.round(cutLen / retime)) : cutLen;
    plan.push({ inF: src, outF: src + cutLen, frames });
    await applyOps(key, { op: 'add', src: 'cam', in: G.S(src), out: G.S(src + cutLen), ...(i === 1 && retime ? { speed: retime } : {}), note: `cut ${i}` });
    src += cutLen + gap;
  }
  for (const op of extraOps) await applyOps(key, op);
  syncFilm(key);
  const film = readFilm(key);
  film.cfg._srcW = cfps.width; // for the checks: the cover factor of a format canvas
  return { film, plan, conformed: join(mediaDir(film, 'cam'), 'conformed.mp4'), cfps, G };
}
