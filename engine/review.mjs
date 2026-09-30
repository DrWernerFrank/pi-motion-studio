// Critique rounds as data: films/<key>/reviews.json (the GUI charts it) + review_log.md (humans read it).
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFilm, readJson, writeJson } from './lib/film.mjs';

export const RUBRIC = {
  hook: 'hook in the first 2s',
  readability: 'readable at phone size (360px wide)',
  motion: 'motion quality: springs, no sliding, no dead frames',
  variety: 'something new every 2-4s',
  composition: 'composition, hierarchy, negative space',
  brand: 'brand / brief accuracy',
  sound: 'sound sync and mix',
};
export const PASS_SCORE = 8;

export function addReview(key, { scores = {}, problems = [], notes = '', reviewer = 'critic', sheets = [] }) {
  const film = readFilm(key);
  const missing = Object.keys(RUBRIC).filter((k) => typeof scores[k] !== 'number');
  if (missing.length) throw new Error(`scores missing: ${missing.join(', ')} (score every rubric item 1-10)`);
  const file = join(film.dir, 'reviews.json');
  const all = readJson(file, []);
  const round = all.length + 1;
  const min = Math.min(...Object.values(scores));
  const entry = { round, at: new Date().toISOString(), reviewer, scores, min, pass: min >= PASS_SCORE, problems, notes, sheets };
  all.push(entry);
  writeJson(file, all);

  const log = join(film.dir, 'review_log.md');
  if (!existsSync(log)) writeFileSync(log, `# Review log: ${film.key}\n\nEvery round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score ${PASS_SCORE}+.\n`);
  appendFileSync(log, [
    `\n## Round ${round} · ${entry.at.slice(0, 16).replace('T', ' ')} · ${reviewer} · ${entry.pass ? 'PASS' : 'not yet'}`,
    '',
    Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(' · '),
    '',
    ...problems.map((p, i) => `${i + 1}. **${p.t ?? '-'}s** ${p.issue}${p.fix ? `  \n   fix: ${p.fix}` : ''}`),
    notes ? `\n${notes}` : '',
    sheets.length ? `\nsheets: ${sheets.join(', ')}` : '',
    '',
  ].join('\n'));
  return entry;
}
