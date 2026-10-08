// review (P9): each demo's reviews.json carries >= 3 rounds, the LAST by producer-critic, every
// score >= 8, fidelity = 10, and sheets exist — the quality bar, read from the films' own records.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const DEMOS = [
  { key: 'composite', child: 'composite-s02', keys: ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound', 'correctness', 'clarity', 'fidelity', 'coherence'] },
  { key: 'launch-teaser', child: 'launch-teaser-s01', keys: ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound', 'fidelity', 'coherence'] },
  { key: 'gps', child: 'gps-s01', keys: ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound', 'correctness', 'clarity', 'fidelity', 'coherence'] },
  { key: 'cities', child: 'cities-s01', keys: ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound', 'fidelity', 'coherence'] },
];

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  for (const d of DEMOS) {
    const file = join(ROOT, 'films', d.child, 'reviews.json');
    let rounds = [];
    try { rounds = JSON.parse(readFileSync(file, 'utf8')); } catch { bad.push(`${d.child}: no reviews.json`); continue; }
    need(rounds.length >= 3, `${d.child}: ${rounds.length} round(s) (want >= 3)`);
    const last = rounds.at(-1);
    need(last?.reviewer === 'producer-critic', `${d.child}: the last round is by ${last?.reviewer}, not producer-critic`);
    // every score in the last round >= 8, fidelity 10, and its keys complete
    for (const k of d.keys) {
      const v = last?.scores?.[k];
      need(typeof v === 'number' && v >= 8, `${d.child}: the last round's ${k} is ${v} (want >= 8)`);
    }
    need(last?.scores?.fidelity === 10, `${d.child}: the last round's fidelity is ${last?.scores?.fidelity} (10 or the project is not done)`);
    need(Array.isArray(last?.sheets) && last.sheets.length > 0, `${d.child}: the last round saved no sheets`);
    facts.push(`${d.child}: r${rounds.length} (last: producer-critic, min ${last?.min}, fidelity ${last?.scores?.fidelity})`);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
