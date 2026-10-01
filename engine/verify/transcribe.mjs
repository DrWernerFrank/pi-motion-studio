// transcribe: WER (fillers excluded) <= 15% on the speech fixture (known script), word times monotonic,
// >= 90% of word midpoints inside the measured speech (truth + envelope), a re-run is a cache hit, offline.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { transcribe, transcriptFile } from '../transcribe.mjs';
import { ingestSource, mediaDir, readBin } from '../ingest.mjs';
import { readFilm } from '../lib/film.mjs';
import { envelope } from '../lib/speechprobe.mjs';

const KEY = 'verify-asr', ID = 'speech';
const FIL = { um: true, uh: true, umm: true, hmm: true, er: true, erm: true };
const norm = (s) => (s.toLowerCase().match(/[a-z']+/g) || []).filter((w) => !FIL[w]);
function wer(refWords, hypWords) {
  const d = Array.from({ length: refWords.length + 1 }, (_, i) => [i, ...Array(hypWords.length).fill(0)].map((v, j) => (i === 0 ? j : v)));
  for (let i = 1; i <= refWords.length; i++) for (let j = 1; j <= hypWords.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (refWords[i - 1] === hypWords[j - 1] ? 0 : 1));
  return { errs: d[refWords.length][hypWords.length], n: refWords.length };
}

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { FILMS } = await import('../lib/film.mjs');
  const { createEditFilm } = await import('../edit-cli.mjs');
  const { rmSync, existsSync } = await import('node:fs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: ID, log: () => {} });

  const t0 = Date.now(), r = await transcribe(KEY, ID, { force: true, log: () => {} });
  const secs = Math.max(0, Date.now() - t0); // ms
  need(r.language === 'en', `language ${r.language}, not en`);
  const truth = JSON.parse(readFileSync(join(fixturePath('speech').replace(/[\\/][^\\/]+$/, ''), 'speech.truth.json'), 'utf8'));
  const ref = norm(truth.items.filter((i) => i.kind === 'sentence' || i.kind === 'flub').map((i) => i.text).join(' '));
  const hyp = norm(r.words.map((w) => w.text).join(' '));
  const { errs, n } = wer(ref, hyp);
  need(errs / n <= 0.15, `WER ${(100 * errs / n).toFixed(1)}% > 15% (${errs} errors in ${n} ref words)`);
  const mono = r.words.every((w, i) => w.end > w.start && (i === 0 || w.start >= r.words[i - 1].end - 1e-6));
  need(mono, 'word times are not monotonic');
  // >= 90% of word midpoints inside true speech (the TTS truth, which is the ground truth by construction)
  const speech = truth.items.filter((i) => i.kind !== 'pause').map((i) => [i.start, i.end]);
  const inside = r.words.filter((w) => speech.some(([a, b]) => (w.start + w.end) / 2 >= a - 0.05 && (w.start + w.end) / 2 <= b + 0.05)).length;
  need(inside / r.words.length >= 0.9, `${inside}/${r.words.length} word midpoints inside speech`);
  // cache hit
  const t1 = Date.now(), again = await transcribe(KEY, ID, { log: () => {} });
  need(again.cached && Date.now() - t1 < 2000, `second transcribe not a cache hit (${Date.now() - t1} ms)`);
  need(existsSync(transcriptFile(readFilm(KEY), ID)), 'transcript.json missing');
  facts.push(`WER ${(100 * errs / n).toFixed(1)}% (${n} ref words), ${r.words.length} words, lang en@${r.language_probability}, ${inside}/${r.words.length} in speech, first pass ${(secs / 1000).toFixed(1)} s, cache hit ${Date.now() - t1} ms`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
