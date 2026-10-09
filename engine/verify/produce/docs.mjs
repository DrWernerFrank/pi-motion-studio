// docs (P9): studio help lists every command; README + AGENTS.md carry "Start here" and
// "## Producer"; the skill, the critic, CAPABILITIES.md (generated), ADR-001..004 and
// THIRD_PARTY.md exist; and the OLDER checks that read docs still pass (verify-edit docs +
// verify-math docs — the skills' front matter is their surface too).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const runCli = (args, timeout = 120000) => spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout });

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. every CLI case is in the help (the same convention as the older docs checks)
  const cli = readFileSync(join(ROOT, 'engine', 'cli.mjs'), 'utf8');
  const cases = [...cli.matchAll(/^    case '([a-z-]+)':/gm)].map((m) => m[1]);
  const help = runCli(['help']).stdout;
  for (const c of cases) need(new RegExp(`(^|\\s)${c}(\\s|<|$)`).test(help), `studio help does not list "${c}"`);
  for (const row of ['project', 'make', 'capability', 'capabilities', 'brief-lint', 'verify-produce'])
    need(new RegExp(`(^|\\s)${row}(\\s|<|$)`).test(help), `studio help misses the producer command "${row}"`);
  facts.push(`help lists all ${cases.length} commands incl. the producer rows`);

  // 2. README + AGENTS.md carry the front door
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  need(/## Start here/.test(agents) && /produce/.test(agents.split('## Start here')[1].split('##')[0]),
    'AGENTS.md "Start here" must exist above everything and point at the produce skill');
  need(agents.indexOf('## Start here') < agents.indexOf('## Where things live'), 'AGENTS.md "Start here" must sit ABOVE "Where things live"');
  need(/## Producer/.test(readme) && /studio make/.test(readme), 'README "## Producer" must exist and name studio make');
  need(/requirements ledger|ledger/.test(readme), 'README Producer section must mention the requirements ledger');
  // the older sections the older checks grep stay intact
  need(/## Real footage/.test(agents) && /## Math videos/.test(agents), 'AGENTS.md keeps the older sections (their checks read them)');
  facts.push('AGENTS.md Start here (above everything) + README ## Producer; the older sections intact');

  // 3. the skill, the critic, ADRs, THIRD_PARTY
  need(existsSync(join(ROOT, '.pi', 'skills', 'produce', 'SKILL.md')), 'the produce skill is missing');
  need(existsSync(join(ROOT, '.pi', 'agents', 'producer-critic.md')), 'producer-critic.md is missing');
  for (const adr of ['ADR-001-registry.md', 'ADR-002-project-kind.md', 'ADR-003-assembly.md', 'ADR-004-runner.md'])
    need(existsSync(join(ROOT, 'docs', 'produce', adr)), `docs/produce/${adr} is missing`);
  need(existsSync(join(ROOT, 'docs', 'produce', 'THIRD_PARTY.md')), 'docs/produce/THIRD_PARTY.md is missing');
  need(existsSync(join(ROOT, 'docs', 'produce', 'CAPABILITIES.md')), 'docs/produce/CAPABILITIES.md is missing (studio capabilities --doc)');
  need(existsSync(join(ROOT, 'docs', 'produce', 'SCHEMAS.md')), 'docs/produce/SCHEMAS.md is missing');
  facts.push('skill + critic + ADR-001..004 + THIRD_PARTY + SCHEMAS present');

  // 4. CAPABILITIES.md is GENERATED (not hand-stale): its id set equals the live catalog's
  const capDoc = readFileSync(join(ROOT, 'docs', 'produce', 'CAPABILITIES.md'), 'utf8');
  need(/^# The capability catalog \(generated/.test(capDoc), 'CAPABILITIES.md lacks its generated header (run: studio capabilities --doc)');
  const { validatedCatalog } = await import('../../produce/catalog.mjs');
  const live = (await validatedCatalog()).map((e) => e.id).sort();
  for (const id of live) need(new RegExp(`^## ${id} — `, 'm').test(capDoc), `CAPABILITIES.md is stale: no section for "${id}" (run: studio capabilities --doc)`);
  const docIds = [...capDoc.matchAll(/^## ([a-z-]+) — /gm)].map((m) => m[1]).sort();
  for (const id of docIds) need(live.includes(id), `CAPABILITIES.md lists "${id}" which the catalog no longer has (stale: run --doc)`);
  facts.push(`CAPABILITIES.md generated + current (${live.length} entries, ids match the catalog)`);

  // 5. THIRD_PARTY.md is honest: says no new downloads + points at the earlier records
  const tp = readFileSync(join(ROOT, 'docs', 'produce', 'THIRD_PARTY.md'), 'utf8');
  need(/nothing new was downloaded/i.test(tp), 'THIRD_PARTY.md must state what was downloaded (nothing new) honestly');
  need(/docs\/editing\/THIRD_PARTY\.md/.test(tp) && /docs\/math\/THIRD_PARTY\.md/.test(tp), 'THIRD_PARTY.md must point at the earlier missions\' records for the reused surfaces');

  // 6. THE OLDER DOC CHECKS STILL PASS (the skills' front matter is their surface — this mission
  //    edited it: the four defer clauses). Run both; a partial run exits 1 BY DESIGN (D-002), so
  //    read the rows, like the produce regress check does.
  const rowsOf = (out) => (out || '').split('\n').filter((l) => /^(PASS|FAIL|ERR |skip|TODO) /.test(l));
  const ve = spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'verify-edit', '--only', 'docs'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const veRows = rowsOf(ve.stdout);
  need(veRows.length >= 1 && veRows.every((l) => /^PASS /.test(l)), `verify-edit docs not green after the skill edits:\n  ${veRows.filter((l) => !/^PASS/.test(l)).join('\n  ') || ve.stderr.split('\n').slice(-2)}`);
  const vm = spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'verify-math', '--only', 'docs'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const vmRows = rowsOf(vm.stdout);
  need(vmRows.length >= 1 && vmRows.every((l) => /^PASS /.test(l)), `verify-math docs not green:\n  ${vmRows.filter((l) => !/^PASS/.test(l)).join('\n  ') || vm.stderr.split('\n').slice(-2)}`);
  facts.push('verify-edit docs + verify-math docs still PASS (the defer-clause edits held)');

  void execFileSync;
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
