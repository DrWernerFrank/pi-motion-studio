// Regression guard for the motion films: frame hashes at fixed times + gate verdicts, compared to
// docs/editing/baseline.json. Edit features must cost the existing films nothing.
//   studio regress            compare against the baseline
//   studio regress --write    (re)record the baseline from the current code
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gates } from './gates.mjs';
import { FILMS, openStudio, readFilm, readJson, stillPng, writeJson } from './lib/film.mjs';
import { ROOT } from './lib/serve.mjs';

export const BASELINE = join(ROOT, 'docs', 'editing', 'baseline.json');
export const BASELINE_FILMS = ['studio-reel', 'det-film', 'determinant-explained', 'determinant-explainer'];
const SCALE = 0.5, SAMPLES = 8;

// 8 fixed moments per film, on the frame grid: the middle of each eighth of the duration.
export const sampleTimes = (cfg) => Array.from({ length: SAMPLES }, (_, i) => Math.floor(((i + 0.5) / SAMPLES) * cfg.duration * cfg.fps) / cfg.fps);

async function snapshotOne(key) {
  const film = readFilm(key), fmt = film.cfg.formats[0], times = sampleTimes(film.cfg);
  const studio = await openStudio();
  try {
    const page = await studio.page(film, fmt, SCALE);
    const hashes = [];
    for (const t of times) hashes.push(createHash('sha256').update(await stillPng(page, t)).digest('hex').slice(0, 16));
    if (studio.errors.length) throw new Error(`${key} threw:\n${studio.errors.slice(0, 3).join('\n')}`);
    // write:false: a comparison must not rewrite the film's own gates.json
    const g = await gates(key, { log: () => {}, write: false });
    return { fmt, scale: SCALE, fps: film.cfg.fps, duration: film.cfg.duration, times, hashes,
      gates: Object.fromEntries(g.checks.map((c) => [c.name, c.level])) };
  } finally { await studio.close(); }
}

// A film that cannot render (never calls film({...}), page error) is recorded as broken, with the
// reason, so the baseline stays truthful and regress notices the day it changes either way.
export async function snapshot(keys = BASELINE_FILMS) {
  const films = {};
  for (const k of keys) {
    try { films[k] = await snapshotOne(k); }
    catch (e) { films[k] = { broken: String(e.message || e).split('\n')[0] }; }
  }
  return films;
}

// Returns { pass, rows[], measured } where rows say what drifted.
export async function compare(keys = BASELINE_FILMS) {
  const base = readJson(BASELINE);
  if (!base) return { pass: false, rows: ['no docs/editing/baseline.json: run `studio regress --write` on a clean checkout'], measured: {} };
  const now = await snapshot(keys), rows = [], measured = {};
  for (const k of keys) {
    const b = base.films[k], n = now[k];
    if (!b) { rows.push(`${k}: not in the baseline`); continue; }
    if (b.broken || n.broken) {
      measured[k] = b.broken && n.broken ? `still broken as recorded (${n.broken})` : '';
      if (!(b.broken && n.broken && b.broken === n.broken)) rows.push(`${k}: ${b.broken ? 'was broken, now renders: re-record the baseline on purpose' : `now broken: ${n.broken}`}`);
      continue;
    }
    const drift = n.hashes.map((h, i) => (h === b.hashes[i] ? null : b.times[i])).filter((x) => x !== null);
    const gateDrift = Object.keys({ ...b.gates, ...n.gates }).filter((c) => b.gates[c] !== n.gates[c]).map((c) => `${c}: ${b.gates[c] ?? 'absent'} → ${n.gates[c] ?? 'absent'}`);
    measured[k] = `${n.hashes.length - drift.length}/${n.hashes.length} frames identical, ${Object.keys(n.gates).length - gateDrift.length}/${Object.keys(n.gates).length} gate verdicts unchanged`;
    if (drift.length) rows.push(`${k}: frames differ at ${drift.join(', ')}s`);
    if (gateDrift.length) rows.push(`${k}: gate verdicts changed: ${gateDrift.join('; ')}`);
  }
  return { pass: rows.length === 0, rows, measured };
}

export async function writeBaseline(keys = BASELINE_FILMS) {
  const films = await snapshot(keys);
  writeJson(BASELINE, { note: 'frame sha256 (png, first format, scale 0.5) at 8 fixed times + gate verdict levels. Rewrite only when a film is changed on purpose.', films });
  return films;
}
