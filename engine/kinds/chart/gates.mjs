// gates.mjs — chart's gates (K12). A gate takes the film record ({key, dir, cfg, out} — what
// readFilm returns) and returns {name, pass, detail}; a FAIL blocks ship, a gate must never
// throw (runGates catches a throw and reports it as a FAIL — a crash is not a verdict).
// runGates(key) runs them all and writes films/<key>/gates.json {at, pass, checks} (the same
// shape math's runMathGates and motion's gates return).
//
// The two stubs below THROW until implemented — the growth contract (studio capability check
// chart) requires >= 2 gates that RUN without throwing on a seeded film. Make each gate check
// one thing this technique can actually be wrong about (math's layout/claims gates and the
// chart technique's data/axis gates in engine/verify/produce/growth.mjs are the pattern).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const existsSyncSafe = (p) => { try { return existsSync(p); } catch { return false; } };
const readJsonSafe = (p) => { try { return readJson(p); } catch { return null; } };
import { readFilm, readJson, writeJson } from '../../lib/film.mjs';

// GATE 1 — data: the film draws from chart.json; a chart without rows (or without the source
// every figure must cite) is not a chart — FAIL names the file and what is missing.
export async function firstGate(film) {
  const file = join(film.dir, 'chart.json');
  const chart = existsSyncSafe(file) ? readJsonSafe(file) : null;
  const rows = Array.isArray(chart?.data) ? chart.data : [];
  const problems = [];
  if (!chart) problems.push(`no chart.json — the data file a chart film draws (create makes one)`);
  else {
    if (!rows.length) problems.push('chart.json has no data rows');
    const max = 40;
    if (rows.length > max) problems.push(`${rows.length} rows (>${max}: a readable race holds <= 40 bars)`);
    if (!chart.source || /fill me in/.test(String(chart.source))) problems.push('chart.json carries no source — every on-screen figure must trace to it (or a facts ledger)');
  }
  return { name: 'chart-data', pass: !problems.length, detail: problems.length ? problems.join('; ') : `${rows.length} data rows, source recorded` };
}

// GATE 2 — axis: every row is a numeric pair [x, y] (the film's axis math depends on it); a
// malformed row FAILs naming its index and its value.
export async function secondGate(film) {
  const file = join(film.dir, 'chart.json');
  const chart = existsSyncSafe(file) ? readJsonSafe(file) : null;
  const rows = Array.isArray(chart?.data) ? chart.data : [];
  if (!rows.length) return { name: 'chart-axis', pass: false, detail: 'no rows to check (the data gate names the file)' };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length < 2 || !Number.isFinite(+r[0]) || !Number.isFinite(+r[1]))
      return { name: 'chart-axis', pass: false, detail: `data[${i}] is ${JSON.stringify(r)} — every row must be a numeric pair [x, y] (a year and a value)` };
  }
  return { name: 'chart-axis', pass: true, detail: `${rows.length}/${rows.length} rows are numeric pairs` };
}

export const GATES = [firstGate, secondGate];

export async function runGates(key, { write = true, log = console.log } = {}) {
  const film = readFilm(key);
  const checks = [];
  for (const g of GATES) {
    let r;
    try { r = await g(film); } catch (e) { r = { name: g.name, pass: false, detail: `threw: ${e.message}` }; }
    checks.push(r);
    log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
  }
  const result = { at: new Date().toISOString(), pass: checks.every((c) => c.pass), checks };
  if (write) writeJson(join(film.dir, 'gates.json'), result);
  return result;
}
