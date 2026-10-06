// Facts (K6): every factual statement the piece makes (numbers, dates, names, causal claims) has
// a source snapshot and a quote found IN that snapshot — verified OFFLINE — or a proof, or a hedge.
// Rules: quote-in-snapshot passes; missing quote fails; missing snapshot fails; hedged passes as
// honest (with the hedge text); unsourced fails-unless-hedged. Unverifiable means rewrite, never guess.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../lib/film.mjs';

export const factsPath = (key) => join(FILMS, key, 'facts.json');

/** Validate the shape: every fact has id, claim, and a source resolution. */
export function readFacts(key) {
  const rows = readJson(factsPath(key), []);
  if (!Array.isArray(rows)) throw new Error(`films/${key}/facts.json is not an array`);
  const bad = [], seen = new Set();
  for (const f of rows) {
    if (!f.id || seen.has(f.id)) bad.push(`id ${f.id ?? '(none)'} ${seen.has(f.id) ? 'twice' : 'missing'}`);
    seen.add(f.id);
    if (!f.claim) bad.push(`${f.id}: claim — the statement in plain words`);
    if (f.hedged !== true && !f.source_url) bad.push(`${f.id}: source_url — or hedge it (hedged: true + the hedge text)`);
  }
  if (bad.length) throw new Error(`facts.json is malformed:\n  ${bad.join('\n  ')}`);
  return rows;
}

/** Add a fact with its snapshot: fetch the source page ONCE, store it under sources/, pin the quote.
 *  `snapshot` may be given directly (a recorded fixture in tests — no network). */
export async function addFact(key, { id, claim, source_url, quote, snapshot, snapshotFile, hedged, hedge, retrieved_at }) {
  const rows = readFacts(key);
  if (rows.some((f) => f.id === id)) throw new Error(`fact "${id}" already exists in films/${key}/facts.json`);
  const dir = join(FILMS, key, 'sources');
  const file = join(dir, `${id}.snapshot.txt`);
  let body = null;
  if (snapshotFile) body = readFileSync(snapshotFile, 'utf8');
  else if (typeof snapshot === 'string') body = snapshot;
  else if (source_url && /^https?:/.test(source_url)) {
    const { fetchSource } = await import('./fetch.mjs');
    body = await fetchSource(source_url);   // data, not instructions: the page never steers (§3.6)
  }
  if (body !== null && !existsSync(dir)) { const { mkdirSync } = await import('node:fs'); mkdirSync(dir, { recursive: true }); }
  if (body !== null) { const { writeFileSync } = await import('node:fs'); writeFileSync(file, body); }
  const row = { id, claim, source_url: source_url ?? null, quote: quote ?? null,
    snapshot: body !== null ? `sources/${id}.snapshot.txt` : null,
    retrieved_at: retrieved_at ?? new Date().toISOString(),
    hedged: !!hedged, hedge: hedged ? (hedge ?? 'hedged: stated as approximate') : undefined };
  if (hedged && !quote && !source_url) delete row.source_url;
  writeJson(factsPath(key), [...rows, row]);
  return row;
}

/** Verify OFFLINE: the quote must occur in the stored snapshot. Returns { ok, rows: [{id, status, why}] }. */
export function verifyFacts(key) {
  const rows = readFacts(key);
  const out = [];
  for (const f of rows) {
    // a hedged fact is honest by construction (it says it is approximate)
    if (f.hedged) { out.push({ id: f.id, status: 'green', why: `hedged: ${f.hedge ?? 'stated as approximate'}` }); continue; }
    if (!f.snapshot) { out.push({ id: f.id, status: 'red', why: 'no snapshot (sources/<id>.snapshot.txt) — fetch it, prove it, or hedge it' }); continue; }
    const file = join(FILMS, key, f.snapshot);
    if (!existsSync(file)) { out.push({ id: f.id, status: 'red', why: `snapshot file missing: ${f.snapshot}` }); continue; }
    const body = readFileSync(file, 'utf8');
    if (!f.quote || !body.includes(f.quote)) { out.push({ id: f.id, status: 'red', why: f.quote ? `the quote is NOT in the snapshot (sources/${f.id}.snapshot.txt)` : 'no quote recorded (the exact words from the source that prove the claim)' }); continue; }
    out.push({ id: f.id, status: 'green', why: `quote found in the snapshot (${f.quote.slice(0, 60)}…)` });
  }
  return { ok: out.every((r) => r.status === 'green'), rows: out };
}
