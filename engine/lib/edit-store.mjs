// edit-store: edit.json on disk. Every change goes through applyOps: validated, atomic (temp file + rename), appended to
// edit.log.jsonl, snapshotted for undo/redo, and guarded by baseRev so an agent and the GUI can edit the same film safely.
//   rev is a monotonic counter: it never goes back, not even on undo (undo restores the CONTENT and bumps rev), so a stale
//   baseRev can never be mistaken for current (no A-B-A).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpError, applyOp, newEdit, query, timelineSeconds, validateEdit } from './edit-ops.mjs';
import { readFilm, readJson } from './film.mjs';
import { readBin } from '../ingest.mjs';
import { grid, timelineFrames } from './edit-ops.mjs';

const HISTORY_MAX = 100;
export const editFile = (film) => join(film.dir, 'edit.json');
const histFile = (film) => join(film.dir, '.edit', 'history.json');
const logFile = (film) => join(film.dir, 'edit.log.jsonl');

export function writeAtomic(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, text); renameSync(tmp, file);
}
const writeEdit = (film, edit) => writeAtomic(editFile(film), JSON.stringify(edit, null, 2) + '\n');
const readHist = (film) => readJson(histFile(film), { undo: [], redo: [] });

export function loadEdit(filmKey) {
  const film = readFilm(filmKey);
  if (!existsSync(editFile(film))) throw new OpError(`films/${film.key} has no edit.json: create one with \`studio new <key> --edit\``, 'notfound');
  const edit = JSON.parse(readFileSync(editFile(film), 'utf8'));
  validateEdit(edit);
  return { film, edit };
}

export function createEdit(filmKey, { fps = 30 } = {}) {
  const film = readFilm(filmKey);
  if (existsSync(editFile(film))) throw new OpError(`films/${film.key} already has an edit.json`);
  const edit = newEdit({ fps }); writeEdit(film, edit); return { film, edit };
}

// ops: one op or an array. Atomic as a batch: if any op fails nothing is written. One undo step per call.
// Returns { edit, rev, results }. opts: { baseRev, who }
export function applyOps(filmKey, ops, { baseRev, who = 'cli' } = {}) {
  const { film, edit } = loadEdit(filmKey), list = Array.isArray(ops) ? ops : [ops];
  if (baseRev !== undefined && baseRev !== null && Number(baseRev) !== edit.rev) throw new OpError(`conflict: the edit changed since you read it (you had rev ${baseRev}, it is rev ${edit.rev}): reload it and redo your change`, 'conflict');
  const ctx = { bin: readBin(film) };
  let next = edit; const results = [];
  list.forEach((op, i) => {
    try {
      if (op.op === 'snap') { results.push(query(next, op, ctx)); return; }
      next = applyOp(next, op, ctx); results.push({ ok: true });
    } catch (e) { if (e instanceof OpError) { e.message = `op ${i + 1}/${list.length} (${op.op}): ${e.message}`; } throw e; }
  });
  if (next === edit) return { edit, rev: edit.rev, results, changed: false };
  const hist = readHist(film);
  hist.undo.push(structuredClone(edit)); if (hist.undo.length > HISTORY_MAX) hist.undo.shift(); hist.redo = [];
  next.rev = edit.rev + 1;
  writeAtomic(histFile(film), JSON.stringify(hist));
  writeEdit(film, next);
  appendFileSync(logFile(film), JSON.stringify({ rev: next.rev, at: new Date().toISOString(), who, ops: list.filter((o) => o.op !== 'snap') }) + '\n');
  return { edit: next, rev: next.rev, results, changed: true };
}

function swap(filmKey, from, to, label, baseRev) {
  const { film, edit } = loadEdit(filmKey);
  if (baseRev !== undefined && baseRev !== null && Number(baseRev) !== edit.rev) throw new OpError(`conflict: the edit changed since you read it (you had rev ${baseRev}, it is rev ${edit.rev})`, 'conflict');
  const hist = readHist(film);
  if (!hist[from].length) throw new OpError(`nothing to ${label}`);
  const snap = hist[from].pop(); hist[to].push(structuredClone(edit));
  snap.rev = edit.rev + 1;
  writeAtomic(histFile(film), JSON.stringify(hist)); writeEdit(film, snap);
  appendFileSync(logFile(film), JSON.stringify({ rev: snap.rev, at: new Date().toISOString(), who: 'cli', ops: [{ op: label }] }) + '\n');
  return { edit: snap, rev: snap.rev };
}
export const undo = (filmKey, o = {}) => swap(filmKey, 'undo', 'redo', 'undo', o.baseRev);
export const redo = (filmKey, o = {}) => swap(filmKey, 'redo', 'undo', 'redo', o.baseRev);
export const historyDepth = (filmKey) => { const h = readHist(readFilm(filmKey)); return { undo: h.undo.length, redo: h.redo.length }; };

// film.json is the source of truth for fps/formats/duration: keep duration equal to the timeline (exact frame count).
export function syncFilm(filmKey) {
  const { film, edit } = loadEdit(filmKey), cfg = readJson(join(film.dir, 'film.json'));
  const frames = timelineFrames(edit), duration = timelineSeconds(edit);
  const next = { ...cfg, kind: 'edit', fps: edit.fps.includes('/') ? edit.fps : Number(edit.fps), duration: frames ? duration : cfg.duration, motionBlur: cfg.motionBlur ?? 1 };
  if (JSON.stringify(next) !== JSON.stringify(cfg)) writeAtomic(join(film.dir, 'film.json'), JSON.stringify(next, null, 2) + '\n');
  return { frames, duration: next.duration, fps: edit.fps };
}

export { grid };
