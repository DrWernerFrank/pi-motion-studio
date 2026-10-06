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
    if (r.type === 'measurable' && !VERIFIERS.includes(r.verifier)) bad.push(`${r.id} "${r.text}": a measurable requirement must name a verifier the library knows — "${r.verifier ?? 'none'}" is not one of ${VERIFIERS.join(', ')}`);
    if (r.type === 'measurable' && r.arg === undefined) bad.push(`${r.id}: arg (what the verifier compares against)`);
    if (r.type !== 'measurable' && r.verifier) bad.push(`${r.id}: only measurable requirements carry a verifier`);
    if (!r.text) bad.push(`${r.id}: text — the ask in plain words`);
    if (!r.source) bad.push(`${r.id}: source ("request" | "revision N" | "implied")`);
    if (r.status === 'waived' && r.waived_by !== 'human') bad.push(`${r.id}: a waiver is the human's alone (waived_by must be "human", got ${JSON.stringify(r.waived_by)})`);
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
/** A subjective requirement passes ONLY with critic evidence: a reviews.json round whose scores
 *  carry every rubric key of this film's kind (the studio's 7 + the kind's own — a project adds
 *  fidelity + coherence) at 8+ AND whose sheets are non-empty (the critic must have looked). The
 *  LAST round is the operative verdict (fresh eyes; the P9 review check reads it the same way).
 *  Without it the requirement CANNOT pass — no evidence, no green, and nothing a build can invent. */
export async function verifySubjective(key, req) {
  const { RUBRIC } = await import('../review.mjs');
  const keys = [...Object.keys(RUBRIC)];
  try {
    const { hooksFor } = await import('../kinds/registry.mjs');
    const K = await hooksFor(key);                     // the film's kind, motion-fallback
    if (Array.isArray(K.rubric)) keys.push(...K.rubric);
  } catch { /* no film.json / no registry yet: the base 7 keys decide */ }
  const id = req?.id ?? 'subjective';
  const cannot = (why) => ({ status: 'red', pass: false, evidence: `cannot pass: ${why}`, measured: 'cannot-pass' });
  const rounds = readJson(join(FILMS, key, 'reviews.json'), []);
  const last = Array.isArray(rounds) && rounds.length ? rounds[rounds.length - 1] : null;
  if (!last) return cannot(`requirement ${id} ("${req?.text ?? 'subjective'}") has no critic evidence — films/${key}/reviews.json holds no review round (a subjective ask passes only with a round scoring every rubric key 8+ with saved sheets)`);
  const low = keys.filter((k) => !((last.scores ?? {})[k] >= 8));
  if (low.length) return cannot(`requirement ${id}: the last review round (${last.reviewer ?? 'critic'}) scores ${low.map((k) => `${k} ${last.scores?.[k] ?? '—'}`).join(', ')} below 8 (round ${last.round ?? '?'} of ${rounds.length})`);
  if (!Array.isArray(last.sheets) || !last.sheets.length) return cannot(`requirement ${id}: the last review round (${last.reviewer ?? 'critic'}) saved no sheets — the critic must have looked (sheets: ["sheets/every-16x9.png", …])`);
  const min = Math.min(...keys.map((k) => last.scores[k]));
  return { status: 'green', pass: true, evidence: `critic round ${last.round ?? rounds.length} by ${last.reviewer ?? 'critic'}: every rubric key 8+ (min ${min}) over ${keys.length} keys, ${last.sheets.length} sheet(s)`, measured: `round ${last.round ?? rounds.length} min ${min}` };
}

/** Run every pending measurable + subjective requirement against the project's finals.
 *  Returns { green, red, rows } — fact/proof rows pass through to their own gates. */
export async function runLedger(key, { finals } = {}) {
  const { verifyRequirement } = await import('./verify-lib.mjs');
  const ledger = readLedger(key);
  const out = [];
  for (const r of ledger) {
    if (r.status === 'waived') { out.push({ ...r, measured: 'waived' }); continue; }
    if (r.type === 'subjective') {
      try { const s = await verifySubjective(key, r); out.push({ ...r, status: s.status, evidence: s.evidence, measured: s.measured }); }
      catch (e) { out.push({ ...r, status: 'red', evidence: String(e.message || e), measured: 'cannot-pass' }); }
      continue;
    }
    if (r.type !== 'measurable') { out.push(r); continue; }   // fact/proof are checked by their own gates
    try { out.push({ ...r, ...(await verifyRequirement(r, { key, finals })).row }); }
    catch (e) { out.push({ ...r, status: 'red', evidence: String(e.message || e) }); }
  }
  return { green: out.filter((r) => r.status === 'green' || r.status === 'waived'), red: out.filter((r) => r.status === 'red'), rows: out };
}

/** Write the measured statuses back (the verify command's last step). */
export function writeStatuses(key, rows) { writeJson(ledgerPath(key), rows); }
