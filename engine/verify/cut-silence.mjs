// cut-silence: after `cut silence`, no internal pause longer than the configured max + pad, no clipped word
// start (the first 40 ms of every kept word keeps its energy), and no speech word lost. Measured on the
// rendered cut's audio with the SAME threshold the silence map uses (floor + max(6, 0.3*spread)) — a stricter
// meter would count kept breath as "silence" and a looser one would hide real dead air.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { grid, timelineFrames } from '../lib/edit-ops.mjs';
import { ingestSource, mediaDir } from '../ingest.mjs';
import { buildDialog, wavInfo } from '../edit-audio.mjs';
import { cutSilence } from '../cut.mjs';
import { envelope, probeEnvelope } from '../lib/speechprobe.mjs';
import { retimeWords } from '../lib/retime.mjs';
import { transcribe } from '../transcribe.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-csil', ID = 'speech', MAX_GAP = 0.5, KEEP = 0.15;

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 0, out: 29.9 });
  const tr = await transcribe(KEY, ID, { log: () => {} });

  const r = await cutSilence(KEY, { maxGap: MAX_GAP, keepBreath: KEEP, apply: true, log: () => {} });
  syncFilm(KEY);
  await buildDialog(KEY, { log: () => {} });
  const film = readFilm(KEY), edit = loadEdit(KEY).edit, G = grid(edit);
  need(r.actionable >= 5, `only ${r.actionable} silence proposals (the fixture has 10 pauses >= 0.5 s)`);
  facts.push(`${r.actionable} cuts, ${(r.framesRemoved / 30).toFixed(2)} s removed`);

  // every proposal named what it removed (the human-veto rule)
  need(r.proposals.every((p) => p.skipped || typeof p.removedText === 'string'), 'a proposal without its removed text');

  // 1. no internal pause beyond max + keep: gaps measured on the dialog bus at the map's own threshold
  const env = envelope(join(film.out, 'dialog.wav'));
  const probe = probeEnvelope(env, { gapMs: (MAX_GAP + KEEP) * 1000, rangeStart: 0 });
  const longGaps = probe.gaps.filter((g) => g.start > 0.3 && g.end < (env.length / 100) - 0.3); // internal only
  need(longGaps.length === 0, `internal pauses beyond ${MAX_GAP + KEEP}s: ${longGaps.map((g) => `${g.start}-${g.end}s (${g.duration.toFixed(2)})`).join(', ')}`);
  facts.push(`longest internal pause ${(Math.max(0, ...probe.gaps.filter((g) => g.start > 0.3 && g.end < env.length / 100 - 0.3).map((g) => g.duration)) || 0).toFixed(2)} s (bar ${MAX_GAP + KEEP}s)`);

  // 2. no clipped word start: the first 40 ms of every kept word is speech-loud in the output
  const tl = retimeWords(edit, ID, tr.words);
  const speechFloor = probe.threshold;
  const clipped = tl.filter((w) => { const a = Math.floor(w.start * 100), b = a + 4; const seg = env.slice(a, b); const rms = Math.sqrt(seg.reduce((x, y) => x + 10 ** (y / 10), 0) / Math.max(1, seg.length)); return 10 * Math.log10(rms + 1e-12) < speechFloor - 6; });
  need(clipped.length === 0, `clipped word starts: ${clipped.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(', ')}`);
  facts.push(`${tl.length} words, all open at full energy`);

  // 3. no speech word lost: the retimed transcript holds every original word (nothing but silence was removed)
  need(tl.length === tr.words.length, `${tl.length} words on the timeline, ${tr.words.length} in the transcript`);
  // and the flub/fillers are NOT removed by this pass (silence only)
  need(tl.some((w) => /^um/i.test(w.text)), 'cut silence removed a filler (it should not: fillers are speech)');
  facts.push('no words lost, fillers untouched');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
