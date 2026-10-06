// studio migrate-names: the Windows-safe naming migration for math films (P1, ADR-001's sibling —
// templates/prompts/producer.md §3.9). The FORMAT ids stay `16:9` (they are ids, not paths); every
// DERIVED PATH becomes the slugged form `16x9`: out/draft-16x9.mp4, records/16x9/, sheets, the
// film-root handoff files, and the path strings inside reviews.json. Tracked files move with
// `git mv` (history preserved); derived out/ files plain-rename. Idempotent; prints every move.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fmtSlug, kindOf, readFilm, readJson, writeJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const tracked = (rel) => {
  try { execSync(`git ls-files --error-unmatch -- "${rel}"`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }); return true; }   // 0 exit = tracked
  catch { return false; }
};

/** One file or dir move; git mv for tracked paths so history follows. Returns the move or null. */
function move(oldAbs, newAbs) {
  if (!existsSync(oldAbs) || oldAbs === newAbs) return null;
  const rel = oldAbs.slice(ROOT.length + 1).replace(/\\/g, '/');
  if (tracked(rel)) execSync(`git mv -- "${rel}" "${newAbs.slice(ROOT.length + 1)}"`, { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
  else renameSync(oldAbs, newAbs);
  return `${rel} -> ${newAbs.slice(ROOT.length + 1)}`;
}

// reserved on Windows in a path segment: : * ? " < > | and trailing dots/spaces
export const RESERVED = /[:*?"<>|]/;

/** Migrate one film's derived names. Returns { moved: [...], fixed: [...] } (fixed = JSON edits). */
export function migrateNames(key) {
  const film = readFilm(key);
  const fmts = film.cfg.formats || [];
  const moved = [], fixed = [];

  // 1. out/: draft-/final-<fmt>.mp4 and any sheet carrying a raw fmt (old phone sheets predate fmtSlug)
  for (const dir of [join(film.dir, 'out'), join(film.dir, 'out', 'sheets')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!RESERVED.test(f)) continue;
      moved.push(...[move(join(dir, f), join(dir, f.replace(/(\d+)[:x](\d+)/, '$1x$2')))].filter(Boolean));
    }
  }
  // 2. records/<fmt>/ -> records/<slug>/ (dirs)
  const rec = join(film.dir, 'records');
  if (existsSync(rec)) for (const f of readdirSync(rec)) {
    if (!RESERVED.test(f)) continue;
    moved.push(...[move(join(rec, f), join(rec, fmtSlug(f)))].filter(Boolean));
  }
  // 3. film-root derived files carrying a raw fmt (scene handoffs etc.)
  for (const f of readdirSync(film.dir)) {
    if (!statSync(join(film.dir, f)).isFile() || !RESERVED.test(f) || !fmts.some((x) => f.includes(x))) continue;
    moved.push(...[move(join(film.dir, f), join(film.dir, f.replace(/(\d+)[:x](\d+)/, '$1x$2')))].filter(Boolean));
  }
  // 4. path strings inside reviews.json (the sheet entries past rounds recorded) and notes.json
  for (const [file, name] of [[join(film.dir, 'reviews.json'), 'reviews.json'], [join(film.dir, 'notes.json'), 'notes.json']]) {
    const data = readJson(file);
    if (!Array.isArray(data)) continue;
    let touched = false;
    const fix = (s) => (typeof s === 'string' && RESERVED.test(s) ? s.replace(/(\d+)[:x](\d+)/g, '$1x$2') : s);
    for (const row of data) {
      if (Array.isArray(row.sheets)) { const n = row.sheets.map(fix); if (n.join('\n') !== row.sheets.join('\n')) { row.sheets = n; touched = true; } }
      for (const p of row.problems || []) if (typeof p.fix === 'string' && RESERVED.test(p.fix)) { p.fix = fix(p.fix); touched = true; }
      if (typeof row.notes === 'string' && RESERVED.test(row.notes)) { row.notes = fix(row.notes); touched = true; }
    }
    if (touched) { writeJson(file, data); fixed.push(name); }
  }
  return { moved, fixed };
}

/** The whole studio at once: every math film. */
export function migrateAll() {
  const out = {};
  for (const k of readdirSync(join(ROOT, 'films'))) {
    const cfg = readJson(join(ROOT, 'films', k, 'film.json'), null);
    if (kindOf(cfg) !== 'math') continue;   // kindOf: the sanctioned kind read (ADR-001)
    out[k] = migrateNames(k);
  }
  return out;
}
void fmtSlug;
