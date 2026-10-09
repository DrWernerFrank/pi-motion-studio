// regress (P0): the no-regression guarantee for the whole mission — `studio regress` passes and
// BOTH cheap verify subsets pass (verify-edit env,edit-ops,gui-security,tools,docs and verify-math
// env,regress,typeset,claims,docs). Runs BEFORE every check that creates films (its spawned
// sweeps collect temp films — the order rule, docs/math/DECISIONS.md D-003).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const STUDIO = join(ROOT, 'studio');

export default async () => {
  const bad = [], facts = [];
  const run = (args, timeout = 20 * 60 * 1000) => spawnSync(STUDIO, args, { cwd: ROOT, encoding: 'utf8', timeout });

  // 1. the four motion films are still on the editing baseline
  const r1 = run(['regress'], 8 * 60 * 1000);
  need(r1.status === 0, `studio regress exited ${r1.status}:\n${(r1.stdout || r1.stderr || '').split('\n').filter((l) => /DRIFT|FAIL|broken/.test(l)).join(' | ')}`);
  facts.push('studio regress: 4 motion films on the baseline (frame hashes + gate verdicts identical)');

  // 2-3. the two cheap subsets. Judge by the ROW lines (a row is "^PASS|^FAIL|^ERR |^skip|^TODO
  //      <id>"), never by substrings: a PASS row's own measured text can honestly contain the word
  //      FAIL (the claims check reports "a false claim blocks ship: AssertionError: CLAIM FAILED…").
  const rowsOf = (out) => (out || '').split('\n').filter((l) => /^(PASS|FAIL|ERR |skip|TODO) /.test(l));
  const subset = (name, args, want, timeout) => {
    const r = run(args, timeout);
    const rows = rowsOf(r.stdout);
    const good = rows.filter((l) => /^PASS /.test(l)).length;
    const badRows = rows.filter((l) => !/^PASS /.test(l));
    need(rows.length >= want && badRows.length === 0,
      `${name}: ${good}/${want} PASS${badRows.length ? `\n  ${badRows.join('\n  ')}` : rows.length < want ? `\n  (only ${rows.length} row lines — output truncated?)\n  ${(r.stdout || r.stderr || '').split('\n').slice(-6).join('\n  ')}` : ''}`);
    return good;
  };
  const pass2 = subset('verify-edit cheap subset', ['verify-edit', '--only', 'env,edit-ops,gui-security,tools,docs'], 5, 20 * 60 * 1000);
  facts.push(`verify-edit cheap subset: ${pass2}/5 PASS`);
  const pass3 = subset('verify-math cheap subset', ['verify-math', '--only', 'env,regress,typeset,claims,docs'], 5, 25 * 60 * 1000);
  facts.push(`verify-math cheap subset: ${pass3}/5 PASS`);

  function need(ok, what) { if (!ok) bad.push(what); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
