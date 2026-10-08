// make (P5): the runner — `studio make` with a FAKE pi (STUDIO_PI_CMD) drives a real project from
// a plain-words request to a green `studio project verify`. The request NEVER travels through a
// shell string after creation (pi gets @films/<key>/brief.md; the fake-pi JSONL proves the argv),
// the loop RELAUNCHES until verify is green (flaky proves recovery on the 2nd run), and the stops
// fire in order: a STOP file, the minutes budget (the runner's own accounting), the relaunch cap.
// A second makeRun while one runs THROWS naming the first key; stopRun() SIGTERMs the runner pid
// (its handler kills the pi child and unwinds — the lock and pid file go with it). Quotes,
// backticks and $() in the request arrive verbatim in brief.md and nothing expands. --plan-only
// stops after a valid plan with no children built. The make lock is gone after every leg.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { makeRun, stopRun } from '../../produce/runner.mjs';

const CLI = join(ROOT, 'engine', 'cli.mjs');
const FAKE = join(ROOT, 'engine', 'produce', 'fake-pi.mjs');
const LOCK = join(homedir(), '.cache', 'pi-motion-studio', 'make.lock');
const INSTRUCTION = 'Follow the produce skill for the attached request.';
const ENVKEYS = ['STUDIO_PI_CMD', 'STUDIO_FAKE_PI_MODE', 'STUDIO_FAKE_PI_SLEEP', 'STUDIO_FAKE_PI_LOG', 'STUDIO_MAKE_MAX_RUNS'];

export default async (ctx = {}) => {
  // a killed full run leaves its seeds (the machine slept mid-run once; the leftovers collided
  // with the restarted run's keys — D-010). Sweep the make keys at ENTRY: every run starts clean.
  const { readdirSync, rmSync } = await import('node:fs');
  const { FILMS } = await import('../../lib/film.mjs');
  for (const k of readdirSync(FILMS)) if (k.startsWith('make-')) rmSync(join(FILMS, k), { recursive: true, force: true });
  const bad = [], facts = [], runs = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const sh = (args, timeout = 10 * 60 * 1000) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  const lockGone = (leg) => need(!existsSync(LOCK), `the make lock survived leg ${leg} (one runner at a time means it drops with the run)`);

  // the fake pi's JSONL: one row per invocation { at, argv, mode, key } — the argv evidence
  const LOG = join(ctx.cache ?? join(homedir(), '.cache', 'pi-motion-studio', 'verify-produce'), 'make-fake-pi.jsonl');
  rmSync(LOG, { force: true });
  const calls = (key) => (existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).filter((row) => row.key === key) : []);

  // the runner's env (saved now, restored in the finally — the next check must never see the fake)
  const saved = Object.fromEntries(ENVKEYS.map((k) => [k, process.env[k]]));
  const setEnv = (extra = {}) => {
    for (const k of ENVKEYS) delete process.env[k];
    process.env.STUDIO_PI_CMD = `node ${FAKE}`;      // the runner splits this on spaces into argv
    process.env.STUDIO_FAKE_PI_LOG = LOG;
    Object.assign(process.env, extra);
  };
  const track = (p) => { runs.push(p.catch(() => ({}))); return p; };   // shadowed for the finally
  const make = (request, opts = {}, extra = {}) => { setEnv(extra); return track(makeRun(request, opts)); };
  const waitFor = async (fn, what, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  /** A run whose fixture (a STOP file, a seeded budget) must land between the project's creation
   *  and the loop's stop checks: start makeRun, wait for runner.pid, seed, then await. The fake
   *  sleeps (STUDIO_FAKE_PI_SLEEP) so the window is wide and the seed is never a race. */
  const seeded = (request, opts, extra, seed) => {
    setEnv(extra);
    const p = track(makeRun(request, opts));
    return (async () => {
      const key = await waitFor(() => readJson(LOCK)?.key, 'the run to take the make lock');
      await waitFor(() => existsSync(join(FILMS, key, 'runner.pid')), `films/${key}/runner.pid (the project exists, the loop is starting)`);
      await seed(key);
      return await p;
    })();
  };

  try {
    // ── a. the full run: build -> verify green, the child linked, the requirements green ───────
    const REQ = 'A spring ident for the studio, six seconds, vertical.';
    let r = await make(REQ, { formats: ['9:16'], file: [join(ROOT, 'README.md')] }, { STUDIO_FAKE_PI_MODE: 'build' });
    need(r.key === 'make-spring-ident-studio', `the key is ${r.key} (want the slug of the request's first significant words)`);
    need(r.iterations >= 1, `iterations ${r.iterations} < 1`);
    need(r.outcome === 'verified', `outcome ${r.outcome} (want verified): ${r.reason}`);
    const dir = join(FILMS, r.key), child = `${r.key}-s01`;
    need(existsSync(join(FILMS, child, 'film.json')), `no child films/${child} was built`);
    need(readJson(join(FILMS, child, 'film.json'), {}).parent === r.key, 'the child does not list its parent');
    const rows = readJson(join(dir, 'requirements.json'), []);
    need(rows.length === 3 && rows.every((x) => x.status === 'green' && x.evidence),
      `the requirements are not all green: ${rows.map((x) => `${x.id}=${x.status}`).join(', ')}`);
    const v = sh(['project', 'verify', r.key]);
    need(v.code === 0 && /VERIFY GREEN/.test(v.out), `studio project verify ${r.key} (exit ${v.code}): ${(v.out || v.err).split('\n').slice(-2).join(' | ')}`);
    const inp = readJson(join(dir, 'inputs.json'), []);
    const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
    need(inp.length === 1 && inp[0].id === 'i1' && inp[0].sha256 === sha(inp[0].path), 'the --file input is not sha-pinned in inputs.json');
    facts.push(`build: verified in ${r.iterations} pi run(s); the child linked (parent set); 3/3 requirements green; verify exit 0; input i1 sha-pinned`);

    // ── b. the request VERBATIM in brief.md; the argv carries the @file and NEVER the request ──
    need(readFileSync(join(dir, 'brief.md'), 'utf8').includes(REQ), 'brief.md does not carry the request VERBATIM');
    const inv = calls(r.key);
    need(inv.length === 1, `the fake pi ran ${inv.length} time(s) for ${r.key} (want 1)`);
    const argv = inv[0]?.argv ?? [];
    need(argv.includes(`@films/${r.key}/brief.md`), `the argv does not pass the brief by file: ${JSON.stringify(argv)}`);
    need(argv[argv.indexOf('--session-id') + 1] === r.key, 'the argv does not reuse the project key as the session id');
    need(argv.at(-1) === INSTRUCTION, `the instruction argument changed: ${JSON.stringify(argv.at(-1))}`);
    need(!argv.join(' ').includes('spring ident') && !argv.join(' ').includes('six seconds'),
      'request text appears in the pi argv (it must live only in brief.md)');
    // the -N suffix on a clash: the same request again makes a NEW project, not an error
    const two = await make(REQ, {}, { STUDIO_FAKE_PI_MODE: 'fail', STUDIO_MAKE_MAX_RUNS: '1' });
    need(two.key === 'make-spring-ident-2', `the clashing key is ${two.key} (want the -2 suffix)`);
    need(two.outcome === 'stopped-cap' && two.iterations === 1, `the clashing run: ${two.outcome} after ${two.iterations} run(s)`);
    lockGone('b');
    facts.push('brief verbatim; the argv = [@brief, the session id, the fixed instruction] with zero request text; a clash takes -2');

    // ── c. a hostile request: quotes, backticks, $() — verbatim, nothing expanded ──────────────
    const HOSTILE = 'A film about "quotes", `backticks` and $(rm -rf /) staying safe';
    r = await make(HOSTILE, { formats: ['9:16'] }, { STUDIO_FAKE_PI_MODE: 'build' });
    need(r.outcome === 'verified', `the hostile request did not verify: ${r.outcome} — ${r.reason}`);
    need(readFileSync(join(FILMS, r.key, 'brief.md'), 'utf8').includes(HOSTILE), 'brief.md does not carry the hostile request VERBATIM');
    const hc = calls(r.key);
    need(hc.length === 1 && !hc[0].argv.join(' ').includes('rm -rf'), 'the hostile text reached the pi argv');
    need(!existsSync(join(ROOT, 'rf')) && !existsSync(join(ROOT, 'quotes')), 'a shell expansion happened (stray files at the repo root)');
    lockGone('c');
    facts.push('hostile request: verified, verbatim in brief.md, argv clean, nothing expanded');

    // ── d. STOP: a STOP file stops the run with the pi call in flight (<= 1 call) ─────────────
    r = await seeded('Stop me right away please, a tiny vertical piece.', { formats: ['9:16'] },
      { STUDIO_FAKE_PI_MODE: 'fail', STUDIO_FAKE_PI_SLEEP: '2500' },
      async (key) => writeFileSync(join(FILMS, key, 'STOP'), 'stop the run\n'));
    need(r.outcome === 'stopped-stop', `outcome ${r.outcome} (want stopped-stop): ${r.reason}`);
    need(r.iterations === 1 && calls(r.key).length <= 1, `a STOPped run still relaunched: ${r.iterations} run(s), ${calls(r.key).length} pi call(s)`);
    need(/STOP/.test(r.reason), `the stop reason does not name the STOP file: ${r.reason}`);
    lockGone('d');
    facts.push('STOP: stopped-stop after 1 pi call, the reason names the STOP file');

    // ── e. the relaunch cap: N pi runs (a REAL relaunch), then stopped-cap naming the cap ──────
    r = await make('Cap me at two runs, a vertical piece.', { formats: ['9:16'] },
      { STUDIO_FAKE_PI_MODE: 'fail', STUDIO_MAKE_MAX_RUNS: '2' });
    need(r.outcome === 'stopped-cap', `outcome ${r.outcome} (want stopped-cap): ${r.reason}`);
    need(r.iterations === 2 && calls(r.key).length === 2, `the cap run: ${r.iterations} iteration(s), ${calls(r.key).length} pi call(s) (want 2 — it must relaunch)`);
    need(/cap \(2/.test(r.reason) || /STUDIO_MAKE_MAX_RUNS/.test(r.reason), `the cap reason does not name the cap: ${r.reason}`);
    lockGone('e');
    facts.push('cap: 2 pi calls (a real relaunch), then stopped-cap with the cap named');

    // ── f. the budget: seeded at 95% of 2 minutes -> the runner's own accounting stops it ──────
    r = await seeded('Budget me at two minutes, a vertical piece.', { formats: ['9:16'] },
      { STUDIO_FAKE_PI_MODE: 'fail', STUDIO_FAKE_PI_SLEEP: '2500', STUDIO_MAKE_MAX_RUNS: '3' },
      async (key) => writeJson(join(FILMS, key, 'budget.json'), { minutes: 2, usd: 0, spent_usd: 0,
        calls: [{ at: '2026-10-06T00:00:00.000Z', provider: 'fake', costUsd: 0, minutes: 1.9, label: 'seeded spend (written by the check)' }] }));
    need(r.outcome === 'stopped-budget', `outcome ${r.outcome} (want stopped-budget): ${r.reason}`);
    need(/wrap up/.test(r.reason), `the budget reason does not carry the wrap-up note: ${r.reason}`);
    need(r.iterations === 1, `the budget stop fired after ${r.iterations} run(s) (want 1 — before the cap of 3)`);
    const bud = readJson(join(FILMS, r.key, 'budget.json'), {});
    need((bud.calls || []).length === 2 && /pi run 1/.test(bud.calls.at(-1)?.label ?? ''),
      `the runner did not append its minutes row: ${JSON.stringify((bud.calls || []).map((c) => c.label))}`);
    need(bud.calls.at(-1)?.costUsd === 0 && bud.spent_usd === 0, 'the time accounting spent money (costUsd/spent_usd must stay 0)');
    lockGone('f');
    facts.push('budget: 1.9 of 2 min seeded, the run\'s own accounting crossed the 80% soft stop -> stopped-budget with the wrap-up note, $0 spent');

    // ── g. one runner at a time: a second makeRun throws; --stop ends the first ──────────────
    setEnv({ STUDIO_FAKE_PI_MODE: 'slow', STUDIO_FAKE_PI_SLEEP: '3000' });
    const first = track(makeRun('Slow me down, a vertical piece.', { formats: ['9:16'] }));
    const key1 = await waitFor(() => readJson(LOCK)?.key, 'the slow run to take the make lock');
    await waitFor(() => calls(key1).length === 1, 'the slow run\'s pi to start (the fake-pi log)');
    let refused = null;
    try { await makeRun('A second run while the first is busy.', { formats: ['9:16'] }); }
    catch (e) { refused = String(e.message || e); }
    need(!!refused && refused.includes(key1), `a second concurrent makeRun did not refuse naming the first key (${key1}): ${refused}`);
    const stop = await stopRun();
    need(stop.stopped.length === 1 && stop.stopped[0].key === key1, `stopRun() stopped ${JSON.stringify(stop.stopped)} (want the run ${key1})`);
    r = await first;
    need(r.outcome === 'stopped', `the stopped run's outcome is ${r.outcome} (want stopped): ${r.reason}`);
    need(!existsSync(join(FILMS, key1, 'runner.pid')), 'the stopped run left its runner.pid behind');
    lockGone('g');
    facts.push(`concurrency: makeRun #2 threw naming ${key1}; --stop ended run #1 (${r.outcome}, pid file gone)`);

    // ── h. --plan-only: a valid plan and NOTHING built ────────────────────────────────────────
    r = await make('Plan me a piece, nothing built.', { formats: ['9:16'], planOnly: true }, { STUDIO_FAKE_PI_MODE: 'plan' });
    need(r.outcome === 'plan-only', `outcome ${r.outcome} (want plan-only): ${r.reason}`);
    const p = sh(['project', 'plan', r.key, '--check']);
    need(p.code === 0 && /plan: VALID/.test(p.out), `plan --check on the plan-only run (exit ${p.code}): ${(p.out || p.err).split('\n').slice(-2).join(' | ')}`);
    need(!existsSync(join(FILMS, `${r.key}-s01`)), 'a plan-only run built a child film');
    const orphans = existsSync(FILMS) ? readdirSync(FILMS).filter((k) => k.startsWith(`${r.key}-`)) : [];
    need(orphans.length === 0, `a plan-only run left child films: ${orphans.join(', ')}`);
    lockGone('h');
    facts.push('plan-only: plan.json VALID via the CLI, zero children built');

    // ── i. --stop with nothing running: the polite refusal ───────────────────────────────────
    let polite = null;
    try { await stopRun(); } catch (e) { polite = String(e.message || e); }
    need(!!polite && /nothing to stop/.test(polite), `stopRun() with nothing running did not refuse politely: ${polite}`);
    lockGone('i');
    facts.push('stopRun() with nothing running: the polite refusal');

    // ── extra (beyond the listed legs, one cheap build): a FAILING first run recovers on the ───
    //    relaunch — the loop's whole promise: pi relaunches IN THE SAME SESSION until green
    r = await make('Flaky first, green on the relaunch, vertical.', { formats: ['9:16'] }, { STUDIO_FAKE_PI_MODE: 'flaky' });
    need(r.outcome === 'verified' && r.iterations === 2, `the flaky run: ${r.outcome} after ${r.iterations} run(s) (want verified after 2)`);
    need(calls(r.key).length === 2, `the flaky run made ${calls(r.key).length} pi call(s) (want 2)`);
    lockGone('extra');
    facts.push('recovery: pi run 1 failed, run 2 (the same session id) built -> verified after 2 iterations');

    // ── j. the lock is gone (per leg above) and nothing leaked ─────────────────────────────────
    need(!existsSync(LOCK), 'the make lock survived the whole check');
  } finally {
    for (const k of ENVKEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await Promise.allSettled(runs);   // every leg awaits its run inline; this only guards the throw path
    if (existsSync(FILMS)) {          // the fixtures never outlive the check (all of them are films/make-*)
      const left = readdirSync(FILMS).filter((k) => /^make-/.test(k));
      for (const k of left) rmSync(join(FILMS, k), { recursive: true, force: true });
      if (left.length) console.log(`  make check: swept ${left.length} fixture film(s): ${left.join(', ')}`);
    }
    rmSync(LOCK, { force: true });
    rmSync(LOG, { force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
