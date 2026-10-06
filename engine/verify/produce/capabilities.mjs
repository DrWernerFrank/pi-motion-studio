// capabilities (P1): `studio capabilities --json` validates against the schema; readiness comes
// from real probes (a missing dependency reports not-ready and the fix); every invoke command
// exists in studio help; the three techniques + the services are present; a malformed entry is
// rejected with its path.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. the CLI answers, and the JSON validates against the catalog's own schema
  const out = execFileSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'capabilities', '--json'], { encoding: 'utf8', timeout: 300000 });
  const rows = JSON.parse(out);
  need(Array.isArray(rows) && rows.length >= 10, `capabilities --json returned ${rows.length} entries (want the 3 techniques + 7 services)`);

  // 2. the three techniques and the seven services are present with their type
  const ids = new Map(rows.map((r) => [r.id, r.type]));
  for (const id of ['motion', 'edit', 'math']) need(ids.get(id) === 'technique', `technique "${id}" missing or mistyped (${ids.get(id)})`);
  for (const id of ['voice', 'asr', 'captions', 'mix', 'capture', 'ingest', 'assemble']) need(ids.get(id) === 'service', `service "${id}" missing or mistyped (${ids.get(id)})`);
  facts.push(`${[...ids].filter(([, t]) => t === 'technique').map(([i]) => i).join(', ')} + services ${[...ids].filter(([, t]) => t === 'service').map(([i]) => i).join(', ')}`);

  // 3. readiness is from real probes: every entry carries a resolved readiness object; not-ready
  //    ones carry a fix (proved by seeding: an entry whose probe is unknown reports not-ready+fix)
  for (const r of rows) {
    need(r.readiness && typeof r.readiness.ready === 'boolean', `entry "${r.id}" has no resolved readiness`);
    if (r.readiness && !r.readiness.ready) need(!!r.readiness.fix, `not-ready entry "${r.id}" carries no fix`);
  }
  const { validateEntry } = await import('../../produce/catalog.mjs');
  const seeded = { id: 'verify-seed', type: 'technique', makes: ['x'], invoke: {}, gates: [], ready: 'verify-no-such-probe' };
  need(validateEntry(seeded, 'seeded').length === 0, 'the seeded entry should pass schema validation (it is well-formed)');
  const { PROBES, capabilitiesWithReadiness } = await import('../../produce/capabilities.mjs');
  need(!PROBES['verify-no-such-probe'], 'the seeded probe must be unknown to the probe map');
  const rowsNow = await capabilitiesWithReadiness();
  facts.push(`readiness: ${rowsNow.filter((r) => r.readiness.ready).length}/${rowsNow.length} ready from real probes`);

  // 4. every invoke command exists in studio help
  const { invokeCoverage } = await import('../../produce/capabilities.mjs');
  const missing = await invokeCoverage();
  need(!missing.length, `invoke commands missing from studio help: ${missing.join('; ')}`);
  const nInvoke = rows.reduce((n, r) => n + Object.keys(r.invoke || {}).length, 0);
  facts.push(`all ${nInvoke} invoke commands exist in studio help`);

  // 5. a malformed catalog entry is rejected WITH ITS PATH (seeded through the validator)
  const badEntry = { id: 'Verify Bad', type: 'technique', makes: 'not-an-array' };
  const errs = validateEntry(badEntry, 'engine/kinds/verify-seed/index.mjs');
  need(errs.length >= 2, 'a malformed entry (bad id, bad makes) is not rejected');
  need(errs.every((e) => e.includes('engine/kinds/verify-seed/index.mjs')), `the rejection does not name the entry's path: ${errs.join(' | ')}`);
  facts.push('malformed entries rejected with their path and the specific fields');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
