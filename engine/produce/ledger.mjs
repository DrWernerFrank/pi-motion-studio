// The requirements ledger (K5) + its verifier library. A requirement is one explicit ask of the
// request (every number, format, language and named asset in it, plus the implied constraints),
// with a type: measurable (a verifier from this library — one without fails loudly), fact, proof,
// or subjective (passes only with critic evidence). Only the human waives a requirement.
//
//   engine/produce/ledger.mjs — the ledger file's shape, append/revise, the verifier dispatch
//   engine/produce/verify-lib.mjs — the measured verifiers (ffprobe/ffmpeg, no guessing)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../lib/film.mjs';

export const TYPES = ['measurable', 'fact', 'proof', 'subjective'];
export const STATUSES = ['pending', 'green', 'red', 'waived'];

/** The verifiers this library knows (measurable requirements must name one). */
export const VERIFIERS = ['duration', 'formats', 'resolution', 'loudness', 'has-audio', 'captions',
  'language', 'safe-area', 'asset-used', 'max-size'];

// ── the ledger file ─────────────────────────────────────────────────────────────────────────
export const ledgerPath = (key) => join(FILMS, key, 'requirements.json');

export function readLedger(key) {
  const rows = readJson(ledgerPath(key), []);
  if (!Array.isArray(rows)) throw new Error(`films/${key}/requirements.json is not an array`);
  const bad = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r.id || seen.has(r.id)) bad.push(`id ${r.id ?? '(none)'} ${seen.has(r.id) ? 'twice' : 'missing'}`);
    seen.add(r.id);
    if (!TYPES.includes(r.type)) bad.push(`${r.id}: type "${r.type}" (${TYPES.join('|')})`);
    if (!STATUSES.includes(r.status)) bad.push(`${r.id}: status "${r.status}"`);
    if (r.type === 'measurable' && !VERIFIERS.includes(r.verifier)) bad.push(`${r.id}: verifier "${r.verifier}" (${VERIFIERS.join('|')})`);
    if (r.type === 'measurable' && r.arg === undefined) bad.push(`${r.id}: arg (what the verifier compares against)`);
    if (r.type !== 'measurable' && r.verifier) bad.push(`${r.id}: only measurable requirements carry a verifier`);
    if (!r.text) bad.push(`${r.id}: text — the ask in plain words`);
    if (!r.source) bad.push(`${r.id}: source ("request" | "revision N" | "implied")`);
    if (r.status === 'waived' && r.waived_by !== 'human') bad.push(`${r.id}: a waiver is the human's alone (waived_by must be "human")`);
  }
  if (bad.length) throw new Error(`requirements.json is malformed:\n  ${bad.join('\n  ')}`);
  return rows;
}

/** Append requirements (the producer, from the request or a revision). Returns the new rows. */
export function addRequirements(key, rows, { source = 'request' } = {}) {
  const ledger = readLedger(key);
  const existing = new Set(ledger.map((r) => r.text));
  const add = rows.filter((r) => !existing.has(r.text)).map((r, i) => ({
    id: `r${String(ledger.length + i + 1).padStart(2, '0')}`,
    text: r.text, type: r.type ?? 'measurable', verifier: r.verifier, arg: r.arg, tolerance: r.tolerance,
    fact: r.fact, claim: r.claim, source: r.source ?? source, status: 'pending', evidence: null,
    waived_by: null,
  }));
  writeJson(ledgerPath(key), [...ledger, ...add]);
  return add;
}

/** A revision: new requirements flagged with their revision number (they rebuild only what they touch). */
export function revise(key, rows) { return addRequirements(key, rows, { source: `revision ${(readLedger(key).filter((r) => r.source.startsWith('revision')).length / 1 + 0)}` }); }
void revise;   // (the revision flow goes through the CLI: rows carry source: "revision N" already)

/** The human's waiver — anything else is refused (the check proves it). */
export function waive(key, id) {
  const ledger = readLedger(key);
  const r = ledger.find((x) => x.id === id);
  if (!r) throw new Error(`no requirement "${id}" in films/${key}/requirements.json`);
  r.status = 'waived'; r.waived_by = 'human'; r.evidence = r.evidence || 'waived by the human';
  writeJson(ledgerPath(key), ledger);
  return r;
}

// ── the verifier dispatch: one requirement -> measured evidence ──────────────────────────────
/** Run every pending measurable requirement against the project's finals. Returns { green, red, rows }. */
export async function runLedger(key, { finals } = {}) {
  const { verifyRequirement } = await import('./verify-lib.mjs');
  const ledger = readLedger(key);
  const out = [];
  for (const r of ledger) {
    if (r.status === 'waived') { out.push({ ...r, measured: 'waived' }); continue; }
    if (r.type !== 'measurable') { out.push(r); continue; }   // fact/proof/subjective are checked by their own gates
    try { out.push({ ...r, ...(await verifyRequirement(r, { key, finals })).row }); }
    catch (e) { out.push({ ...r, status: 'red', evidence: String(e.message || e) }); }
  }
  return { green: out.filter((r) => r.status === 'green' || r.status === 'waived'), red: out.filter((r) => r.status === 'red'), rows: out };
}

/** Write the measured statuses back (the verify command's last step). */
export function writeStatuses(key, rows) { writeJson(ledgerPath(key), rows); }
