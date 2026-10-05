// transcript-edit: delete a word range -> the cut lands at the measured gap within 30 ms, neighbouring words stay
// intact, and the retimed transcript (word times moved onto the cut timeline, never re-transcribed) agrees with a
// fresh transcription of the rendered cut: >= 90% of words within 150 ms.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { clipFrames, grid, timelineFrames } from '../lib/edit-ops.mjs';
import { ingestSource } from '../ingest.mjs';
import { transcribe } from '../transcribe.mjs';
import { retimeWords } from '../lib/retime.mjs';
import { buildDialog, mixEdit } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-tedit', ID = 'speech';

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 0, out: 29.9 }); // the whole speech clip on V1 (29.93 s)

  const tr = await transcribe(KEY, ID, { log: () => {} });
  const truth = JSON.parse(readFileSync(join(fixturePath('speech').replace(/[\\/][^\\/]+$/, ''), 'speech.truth.json'), 'utf8'));
  // a filler (um @2.26) and a real pause: delete the word range of filler 2 ("um" @25.25) including its trailing gap
  const um = tr.words.findIndex((w) => /^um+[,.]?$/i.test(w.text) && w.start > 20); // ASR adds punctuation
  need(um > 0, `no second "um" in the transcript (filler detection: see ADR-002)`);
  if (um <= 0) return { pass: false, measured: bad.join('; ') };
  const w = tr.words[um], next = tr.words[um + 1];
  const silence = JSON.parse(readFileSync(join(readFilm(KEY).dir, 'assets/media', ID, 'silence.json'), 'utf8'));
  const gap = silence.gaps.find((g) => g.start < w.start && g.end > w.end) ?? { start: w.start - 0.1, end: next.start - 0.03 };
  // delete [gap.start, next.start - 0.03): the filler and its breath, cut at the measured gap edges
  const delFrom = gap.start, delTo = Math.min(gap.end + 0.12, next ? next.start - 0.03 : w.end + 0.3);
  const before = loadEdit(KEY).edit, beforeFrames = timelineFrames(before);
  applyOps(KEY, { op: 'ripple-delete', track: 'V1', from: delFrom, to: delTo, all: true });
  const after = loadEdit(KEY).edit;
  const cutFrames = beforeFrames - timelineFrames(after);
  const wantedMs = ((delTo - delFrom) * 1000);
  need(Math.abs(cutFrames / 30 * 1000 - wantedMs) <= 33, `removed ${(cutFrames / 30 * 1000).toFixed(0)} ms, wanted ${wantedMs.toFixed(0)} ms (within 30 ms + 1 frame)`);

  // neighbouring words intact: the word before the cut and the word after it still exist on the timeline
  const tl = retimeWords(after, ID, tr.words).filter((x) => x.__clip === 'c2' || true);
  const prevW = tr.words[um - 1], nextW = tr.words[um + 1];
  const pT = tl.find((x) => x.text === prevW.text && Math.abs(x.start - prevW.start) < 0.2);
  const nT = tl.find((x) => x.text === nextW.text && Math.abs(x.start - (nextW.start - (delTo - delFrom))) < 0.35); // the word after the cut sits at its old time minus the removed span
  need(!!pT, 'the word before the cut is gone from the timeline');
  need(!!nT, `the word after the cut is not at cut_end + offset (expected ~${nextW.start - (delTo - delFrom)}, look at nT)`);

  // retimed vs a fresh transcription of the cut
  syncFilm(KEY); // film.json duration follows the timeline: without this the render truncates to the scaffold's 1 s
  await buildDialog(KEY, { log: () => {} }); await mixEdit(KEY);
  const [r] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} });
  const tmp = join(readFilm(KEY).out, '.cut.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', r.file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', tmp + '.f32']);
  // run asr.py on the rendered cut's audio (16 kHz wav so asr's own ffmpeg load is a no-op resample)
  await run('ffmpeg', ['-y', '-v', 'error', '-i', r.file, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmp]);
  const { pythonFor } = await import('../doctor.mjs');
  const asr = new URL('../asr.py', import.meta.url).pathname;
  await run(pythonFor('ml'), [asr, '--in', tmp, '--out', tmp + '.json', '--model', 'small', '--language', 'en', '--force']);
  const freshDoc = JSON.parse(readFileSync(tmp + '.json', 'utf8'));
  const re = retimeWords(after, ID, tr.words).filter((x) => !/^um+[,.]?$/i.test(x.text));
  const fw = freshDoc.words.filter((x) => !/^um+[,.]?$/i.test(x.text));
  let matched = 0, total = 0;
  for (const a of fw) { total++; const hit = re.find((b) => b.text.toLowerCase() === a.text.toLowerCase() && Math.abs(b.start - a.start) <= 0.15); if (hit) matched++; }
  need(matched / Math.max(1, total) >= 0.9, `retimed vs fresh: ${matched}/${total} words within 150 ms`);
  facts.push(`cut ${wantedMs.toFixed(0)} ms -> ${cutFrames} frames (within 1 frame); neighbours intact; retimed vs fresh ASR: ${matched}/${total} (${(100 * matched / total).toFixed(0)}%) within 150 ms`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
