// regress (P0): math features must cost the existing films nothing, and the previous mission's cheap
// contract stays green while this one lands. Runs `studio regress` (the four motion films: baseline
// frame hashes + gate verdicts) and `studio verify-edit --only env,edit-ops,gui-security,tools,docs`
// (the always-on subset of the editing contract; its full run passes at mission end).
//
// This check spawns the CLI rather than importing the check functions, so the lock, the temp-film
// sweep and the one-row-per-check behaviour are exactly the user's (see docs/math/DECISIONS.md D-003).
// It sits in CHECKS before every check that creates films/verify-m-*: the spawned verify-edit's sweep
// removes verify-m films older than its own start, so this position is part of the contract —
// do not move `regress` later in the table.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { FILMS } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const CLI = join(ROOT, 'engine', 'cli.mjs');
const tail = (s) => (String(s).trim().split('\n').filter(Boolean).slice(-3).join(' | ') || '(no output)');

export default async () => {
  const bad = [], facts = [];

  // 1. the four motion films, unchanged (determinant-explainer is recorded broken — that IS the baseline).
  const a = await run(process.execPath, [CLI, 'regress'], { cwd: ROOT, allowFail: true });
  const films = a.out.split('\n').filter((l) => /identical|broken/.test(l)).length;
  if (a.code !== 0 || !/regress: PASS/.test(a.out)) bad.push(`studio regress: ${tail(a.out + a.err)}`);
  else facts.push(`motion films: ${films} films on baseline (${/8\/8/g.test(a.out) ? 'frame hashes + gate verdicts identical' : 'as recorded'})`);

  // 2. the editing contract's always-on subset. A `--only` run exits non-zero BY DESIGN (a partial run
  // can never pass — editing D-003), so the verdict is read from its rows, not its exit code.
  const b = await run(process.execPath, [CLI, 'verify-edit', '--only', 'env,edit-ops,gui-security,tools,docs'], { cwd: ROOT, allowFail: true });
  const rows = b.out.split('\n').filter((l) => /^(PASS|FAIL|TODO|skip|ERR )/.test(l));
  const notPassing = rows.filter((l) => !/^PASS /.test(l));
  if (rows.length !== 5 || notPassing.length) bad.push(`verify-edit env,edit-ops,gui-security,tools,docs: ${tail(b.out + b.err)}`);
  else facts.push('verify-edit env,edit-ops,gui-security,tools,docs: 5/5 PASS');

  // The spawned `--only` run leaves its own films/verify-sec and films/verify-tools behind (each edit
  // check rmSyncs at its start; the runner's end-of-run sweep has an mtime guard that protects films
  // created during the run). The spawned run has completed and released its lock, so every verify-*
  // film older than its end is a leftover — finish the sweep here, or films/ would not be empty at the
  // end of a verify-math run (the P11 hygiene check fails on that). A verify-edit started after this
  // one finished creates its films later than `tEnd`: never touched.
  const tEnd = Date.now();
  if (existsSync(FILMS)) for (const f of readdirSync(FILMS)) {
    const p = join(FILMS, f);
    if (/^verify-[a-z0-9-]+$/.test(f) && statSync(p).mtimeMs < tEnd - 2000) { rmSync(p, { recursive: true, force: true }); facts.push(`swept films/${f} (spawned-run leftover)`); }
  }

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 600) : facts.join('; ') };
};
