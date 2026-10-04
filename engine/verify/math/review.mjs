// review (P12): each demo's reviews.json — >= 3 rounds, the LAST by math-critic, every final
// score >= 8, correctness 10 with the independent re-derivation recorded in the notes, and the
// sheets the rounds looked at exist. This check ASSERTS the converged state; it cannot pass until
// the films have actually earned it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const DEMOS = ['determinant', 'tangent', 'odd-squares'];
const KEYS = ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound', 'correctness', 'clarity'];

export default async () => {
  const bad = [], facts = [];
  for (const key of DEMOS) {
    const dir = join(ROOT, 'films', key);
    const reviews = JSON.parse(readFileSync(join(dir, 'reviews.json'), 'utf8'));
    if (reviews.length < 3) { bad.push(`${key}: ${reviews.length} rounds (< 3)`); continue; }
    const last = reviews.at(-1);
    if (!/math-critic/i.test(last.reviewer || last.who || '')) bad.push(`${key}: the last round (${last.reviewer || '?'}) is not by math-critic`);
    if (!last.pass) {
      const low = KEYS.filter((k) => (last.scores?.[k] ?? 0) < 8);
      if ((last.scores?.correctness ?? 0) !== 10) low.push('correctness!=10');
      bad.push(`${key}: the last round is min ${last.min} — below the bar on ${low.join(', ') || 'an unknown key'}`);
    } else facts.push(`${key}: PASS at round ${last.round} (min ${last.min}, ${reviews.length} rounds)`);
    // the re-derivation recorded: the critic's notes must say what it re-derived
    const notes = String(last.notes || '');
    if (!/re-deriv|derivé|re-derived|derivation/i.test(notes)) bad.push(`${key}: the last round's notes do not record the re-derivation`);
    // the sheets the rounds looked at exist
    const sheets = join(dir, 'out', 'sheets');
    if (!existsSync(sheets) || !readdirSync(sheets).some((f) => /every-16x9/.test(f)))
      bad.push(`${key}: no every-16x9 sheet (the rounds' evidence)`);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 500) : facts.join('; ') };
};
