// Assets (K6): every asset the piece uses is either made by the studio, supplied by the human
// (attested), or carries a recorded license (public domain / CC0 / CC-BY with attribution
// captured). An asset without a license blocks ship. Helpers fetch from open sources (Wikimedia
// Commons, NASA, Internet Archive) and PARSE the license from their API metadata — tests run
// against recorded fixtures, never live calls. Credits are generated (out/credits.md).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../lib/film.mjs';

export const assetsPath = (key) => join(FILMS, key, 'assets.json');

/** The licenses we accept, with their human names and whether attribution is required. */
export const LICENSES = {
  'public domain': { name: 'Public domain', attribution: false },
  pd: { name: 'Public domain', attribution: false },
  cc0: { name: 'CC0 1.0', attribution: false },
  'cc-by-4.0': { name: 'CC BY 4.0', attribution: true },
  'cc-by-3.0': { name: 'CC BY 3.0', attribution: true },
  'cc-by-sa-4.0': { name: 'CC BY-SA 4.0', attribution: true },
  'cc-by-sa-3.0': { name: 'CC BY-SA 3.0', attribution: true },
  nasa: { name: 'NASA guidelines (public domain for media)', attribution: true },
  human: { name: 'supplied by the human (their own file)', attribution: false },
  studio: { name: 'made by the studio', attribution: false },
};

/** Parse a license from an API metadata blob (the recorded fixtures' shape). Recognizes the
 *  Wikimedia license template names, NASA's usage lines, and the plain license strings. */
export function parseLicense(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const text = [meta.license, meta.licensetext, meta.usage, meta.rights, meta.credit, meta.description]
    .filter(Boolean).join(' ').toLowerCase();
  if (/public domain/.test(text)) return 'public domain';
  if (/cc0/.test(text)) return 'cc0';
  const by = /cc[ -]?by[ -]?sa[ -]?([34])\.0/.exec(text) || /creative commons attribution-sharealike ([34])\.0/.exec(text);
  if (by) return `cc-by-sa-${by[1]}.0`;
  const plain = /cc[ -]?by[ -]?([34])\.0/.exec(text) || /creative commons attribution ([34])\.0/.exec(text);
  if (plain) return `cc-by-${plain[1]}.0`;
  if (/nasa/.test(text) && (meta.usage || /nasa/.test(String(meta.source ?? '')))) return 'nasa';
  return null;
}

const shaOf = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };

/** Add an asset: { id, path, origin, license, attribution, role }. license 'human'/'studio' are
 *  attestations; anything else must be a known license. sha256 pinned on add (holds at verify). */
export function addAsset(key, { id, path, origin, license, attribution, role, bytes, sha256 }) {
  const rows = readJson(assetsPath(key), []);
  if (rows.some((a) => a.id === id)) throw new Error(`asset "${id}" already exists in films/${key}/assets.json`);
  if (!LICENSES[license]) throw new Error(`asset "${id}": unknown license "${license}" (${Object.keys(LICENSES).join(', ')})`);
  if (LICENSES[license].attribution && !attribution) throw new Error(`asset "${id}": license ${LICENSES[license].name} REQUIRES attribution (who made it + where it is from)`);
  const row = { id, path, sha256: sha256 ?? shaOf(path) ?? null, origin: origin ?? path,
    license, attribution: attribution ?? null, role: role ?? 'asset', added: new Date().toISOString() };
  if (bytes) row.bytes = bytes;
  writeJson(assetsPath(key), [...rows, row]);
  return row;
}

/** Verify: every asset has a license (or is human/studio), the sha256 pin still holds, CC-BY
 *  attribution is captured. Returns { ok, rows }. */
export function verifyAssets(key) {
  const rows = readJson(assetsPath(key), []);
  const out = [];
  for (const a of rows) {
    if (!LICENSES[a.license]) { out.push({ id: a.id, status: 'red', why: `no license recorded (${a.license ?? 'none'}) — public domain / CC0 / CC-BY (with attribution) / human / studio` }); continue; }
    if (LICENSES[a.license].attribution && !a.attribution) { out.push({ id: a.id, status: 'red', why: `${LICENSES[a.license].name} needs attribution captured` }); continue; }
    if (a.sha256 && a.path && existsSync(a.path)) {
      const now = shaOf(a.path);
      if (now && now !== a.sha256) { out.push({ id: a.id, status: 'red', why: `sha256 drift: ${a.path} changed since it was pinned` }); continue; }
    } else if (a.sha256 && a.path && !existsSync(a.path)) {
      out.push({ id: a.id, status: 'red', why: `pinned file missing: ${a.path}` }); continue;
    }
    out.push({ id: a.id, status: 'green', why: `${LICENSES[a.license].name}${a.attribution ? ` · ${a.attribution}` : ''}` });
  }
  return { ok: out.every((r) => r.status === 'green'), rows: out };
}

/** Generate out/credits.md — every attributed asset + the human's inputs. */
export function creditsMd(key) {
  const rows = readJson(assetsPath(key), []);
  const inputs = readJson(join(FILMS, key, 'inputs.json'), []);
  const by = rows.filter((a) => LICENSES[a.license]?.attribution);
  const md = [`# Credits — ${key}`, '',
    'Every asset this piece uses that is not made by the studio or supplied by the requester.', ''];
  if (!by.length) md.push('All assets are studio-made or supplied by the requester. Nothing to attribute.', '');
  for (const a of by) md.push(`- **${a.role}** — ${a.attribution} (${LICENSES[a.license].name}; ${a.origin})`);
  if (inputs.length) { md.push('', '## Supplied by the requester', ''); for (const i of inputs) md.push(`- ${i.path.replace(/^.*[\\/]/, '')} (sha256 ${String(i.sha256).slice(0, 12)}…)`); }
  return md.join('\n') + '\n';
}
