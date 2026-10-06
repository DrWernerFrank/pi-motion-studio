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

  // 2. the edit contract's cheap subset
  const r2 = run(['verify-edit', '--only', 'env,edit-ops,gui-security,tools,docs'], 20 * 60 * 1000);
  const pass2 = /^PASS  env/m.test(r2.stdout || '') && (r2.stdout || '').split('\n').filter((l) => /^PASS /.test(l)).length;
  need(r2.stdout && !/FAIL|ERR /m.test(r2.stdout.split('verify-edit:')[0]), `verify-edit cheap subset not green:\n${(r2.stdout || '').split('\n').filter((l) => !/^PASS/.test(l)).join(' | ')}`);
  facts.push(`verify-edit cheap subset: ${pass2}/5 PASS`);

  // 3. the math contract's cheap subset
  const r3 = run(['verify-math', '--only', 'env,regress,typeset,claims,docs'], 25 * 60 * 1000);
  const pass3 = (r3.stdout || '').split('\n').filter((l) => /^PASS /.test(l)).length;
  need(r3.stdout && !/FAIL|ERR /m.test(r3.stdout.split('verify-math:')[0]), `verify-math cheap subset not green:\n${(r3.stdout || '').split('\n').filter((l) => !/^PASS/.test(l)).join(' | ')}`);
  facts.push(`verify-math cheap subset: ${pass3}/5 PASS`);

  function need(ok, what) { if (!ok) bad.push(what); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
