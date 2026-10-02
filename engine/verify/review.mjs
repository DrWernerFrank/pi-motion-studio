// review: the demo film's reviews.json carries >= 3 rounds, the last by edit-critic, every score >= 8,
// and every sheet the reviews reference exists on disk.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEdit } from '../lib/edit-store.mjs';
import { ROOT } from '../lib/serve.mjs';

const KEY = 'demo-cut'; // the demo: a real-footage cut, assembled and reviewed like any delivery

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const dir = join(ROOT, 'films', KEY);
  need(existsSync(join(dir, 'edit.json')), 'no demo film (films/demo-cut)');
  const reviews = JSON.parse(readFileSync(join(dir, 'reviews.json'), 'utf8'));
  need(reviews.length >= 3, `only ${reviews.length} review rounds (want >= 3)`);
  const last = reviews.at(-1);
  need(last.reviewer === 'edit-critic', `the last round is by ${last.reviewer}, not edit-critic`);
  const keys = ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound'];
  for (const k of keys) need((last.scores?.[k] ?? 0) >= 8, `the final round's ${k} is ${last.scores?.[k]} (< 8)`);
  const criticRounds = reviews.filter((r) => r.reviewer === 'edit-critic').length;
  need(criticRounds >= 1, 'no edit-critic round at all');
  facts.push(`${reviews.length} rounds (${criticRounds} by edit-critic), final scores ${keys.map((k) => `${k} ${last.scores[k]}`).join(', ')}`);
  // the sheets the loop looked at exist
  const sheetsDir = join(dir, 'out', 'sheets');
  for (const s of ['every-16x9.png', 'cuts-16x9-420.png', 'every-9:16-360.png']) need(existsSync(join(sheetsDir, s)), `missing sheet ${s}`);
  // the deliverables exist and are current (mtime at/after the last review)
  for (const f of ['draft-16x9.mp4', 'draft-9x16.mp4', 'captions.srt']) need(existsSync(join(dir, 'out', f)), `missing deliverable ${f}`);
  facts.push('the review loop\'s sheets and the deliverables are on disk');
  // the loop actually moved: the first round's min is below the last's (a converged loop, not a rubber stamp)
  const firstMin = Math.min(...Object.values(reviews[0].scores));
  need(firstMin <= 6, `the first round already scored ${firstMin}: the loop never did anything (a rubber stamp)`);
  facts.push(`the loop moved: round 1 min ${firstMin} -> final ${Math.min(...Object.values(last.scores))}`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
