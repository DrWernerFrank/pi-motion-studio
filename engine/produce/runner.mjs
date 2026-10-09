// The make runner (K10) — `studio make "<request>"`: the loop that turns a plain-words request
// into a verified project. The request NEVER travels through a shell string after creation: pi
// receives an @file (films/<key>/brief.md, where the request is stored verbatim) and one fixed
// instruction; the request itself never appears in argv. The loop relaunches pi under ONE session
// id (the project key — a relaunch continues the session, S4) until `studio project verify` is
// green, a STOP file appears, the minutes budget is gone, or the relaunch cap is hit. One runner
// at a time: a lock at ~/.cache/pi-motion-studio/make.lock + films/<key>/runner.pid; a second
// make while one runs refuses loudly; --stop (stopRun) SIGTERMs the runner pid, whose handler
// kills the pi child and unwinds. STUDIO_PI_CMD substitutes the pi binary (tests use fake-pi).
//
//   makeRun(request, { key?, formats?, minutes?, planOnly?, file? }) -> { key, iterations, outcome, reason?, logFile }
//   stopRun() -> { stopped: [{ key, pid }] }   (a polite refusal when nothing runs)
//
// outcomes: 'verified' (verify green) · 'plan-only' (--plan-only: a valid plan and nothing built)
// · 'stopped-stop' (a STOP file) · 'stopped-budget' (the minutes soft/hard stop) · 'stopped-cap'
// (the relaunch cap) · 'stopped' (SIGINT/SIGTERM — --stop or an interrupt).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
const LOCK = join(CACHE, 'make.lock');
const LOGS = join(CACHE, 'logs');
const INSTRUCTION = 'Follow the produce skill for the attached request.';
/** The relaunch cap: pi gets at most this many runs per make (STUDIO_MAKE_MAX_RUNS overrides). */
const maxRuns = () => Math.max(1, Number(process.env.STUDIO_MAKE_MAX_RUNS) || 12);

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// ── the log: one file per run, timestamped lines (also the CLI's progress) ─────────────────────
const logFileOf = (key) => join(LOGS, `make-${key}.log`);
const say = (key, line) => {
  mkdirSync(LOGS, { recursive: true });
  appendFileSync(logFileOf(key), `[${new Date().toISOString()}] ${line}\n`);
  console.log(`make ${key}: ${line}`);
};
const clip = (s) => (s.length > 120000 ? `${s.slice(0, 60000)}\n… (${s.length} bytes, the middle truncated) …\n${s.slice(-60000)}` : s);

// ── the key: 'make-' + a slug of the request's first ~4 significant words (<= 24 chars) ──────────
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'about', 'into', 'at', 'by', 'is', 'are', 'be', 'it', 'its', 'this', 'that', 'as', 'my', 'our', 'your', 'please', 'us']);
export function slugKey(request, { taken = (k) => existsSync(join(FILMS, k)) } = {}) {
  const words = (String(request).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  const pick = words.slice(0, 4);
  let base = `make-${pick.join('-') || 'run'}`;
  while (base.length > 24) {                     // the whole key stays <= 24 chars: drop a word, then hard-cut
    if (pick.length > 1) { pick.pop(); base = `make-${pick.join('-')}`; }
    else { base = base.slice(0, 24).replace(/-+$/, ''); break; }
  }
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {                       // a clash takes the next free -N suffix
    const suffix = `-${n}`;
    let stem = base.slice(0, 24 - suffix.length).replace(/-+$/, '');
    const dash = stem.lastIndexOf('-');
    if (dash > 4) stem = stem.slice(0, dash);     // keep whole words when we can (never cut into 'make-')
    const cand = `${stem}${suffix}`;
    if (!taken(cand)) return cand;
  }
}

// ── the lock: one runner at a time (a second make refuses loudly naming the other run) ─────────
let ACTIVE = null;   // this process's live run: { key, child, stopping }

function takeLock(key) {
  mkdirSync(CACHE, { recursive: true });
  const cur = readJson(LOCK);
  if (cur?.pid && cur.pid !== process.pid && pidAlive(cur.pid))
    throw new Error(`another make run is active — key "${cur.key ?? '(unknown)'}" (pid ${cur.pid}, started ${cur.startedAt ?? '?'}). Stop it first: ./studio make --stop, or wait for it to finish`);
  if (cur?.pid && cur.pid !== process.pid)
    say(key, `taking over a STALE make lock (pid ${cur.pid} from ${cur.startedAt ?? '?'}) — that run is gone; this run proceeds`);
  writeJson(LOCK, { pid: process.pid, key, startedAt: new Date().toISOString() });
}
const dropLock = () => { const cur = readJson(LOCK); if (!cur || cur.pid === process.pid) rmSync(LOCK, { force: true }); };

// ── the time accounting, once per pi run ──────────────────────────────────────────────────────
/** A run's minutes are real even when the spend is zero. With the (fake) provider enabled,
 *  budget.call() logs the row itself and enforces the stops; with it DISABLED (the default: no key
 *  in .env + no STUDIO_BUDGET_USD — nothing is ever called) call() returns {ok:false,disabled}
 *  WITHOUT logging, so the runner appends the minutes row itself (the same calls[] shape, costUsd
 *  always 0) and applies the same stops call() would: soft at 80% (wrap up), hard at 100%. */
async function accountMinutes(key, minutes, label) {
  const B = await import('./budget.mjs');
  if (B.providerStatus('fake').enabled) {
    try {
      const r = await B.call(key, 'fake', { costUsd: 0, minutes, label });
      return r?.softStop ? { stop: 'soft', why: r.why } : { stop: null };
    } catch (e) { return { stop: 'hard', why: String(e.message || e) }; }
  }
  const file = B.budgetPath(key);
  const bud = readJson(file, { minutes: 180, usd: 0, spent_usd: 0, calls: [] });
  const row = { at: new Date().toISOString(), provider: 'fake', costUsd: 0, minutes, label };
  writeJson(file, { ...bud, calls: [...(bud.calls || []), row] });
  const spent = (bud.calls || []).reduce((n, c) => n + (c.minutes || 0), 0) + minutes;
  if (spent >= bud.minutes) return { stop: 'hard', why: `budget (minutes) HARD stop: ${spent.toFixed(1)} of ${bud.minutes} min used — finish with what exists and report honestly` };
  if (spent >= bud.minutes * 0.8) return { stop: 'soft', why: `budget (minutes) soft stop at 80%: wrap up with what exists (${Math.max(0, bud.minutes - spent).toFixed(1)} min left)` };
  return { stop: null };
}

// ── one pi run: argv ONLY — the request lives in brief.md, never on the command line ───────────
function runPi(key, n) {
  return new Promise((resolve) => {
    const cmd = String(process.env.STUDIO_PI_CMD || 'pi').split(' ').filter(Boolean);   // split: a wrapper command works
    const brief = `@${join('films', key, 'brief.md')}`;
    const args = ['-p', '--session-id', key, brief, INSTRUCTION];
    say(key, `pi run ${n}: ${cmd.join(' ')} ${args.join(' ')}`);
    const t0 = Date.now();
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    ACTIVE.child = child;
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { say(key, `pi run ${n}: could not spawn ${cmd[0]} — ${e.message}`); resolve({ code: -1, out: '', err: String(e.message), ms: Date.now() - t0 }); });
    child.on('close', (code, signal) => {
      if (out) say(key, `pi run ${n} said:\n${clip(out)}`);
      if (err.trim()) say(key, `pi run ${n} stderr:\n${clip(err)}`);
      say(key, `pi run ${n}: ${signal ? `killed by ${signal}` : `exit ${code}`} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      resolve({ code: signal ? -1 : code, signal, out, err, ms: Date.now() - t0 });
    });
  });
}

// ── SIGINT/SIGTERM: kill the child, let the loop unwind (the lock + pid file go in the finally) ─
function installSignals(key) {
  const stop = (sig) => {
    if (!ACTIVE || ACTIVE.key !== key) return;
    ACTIVE.stopping = sig;
    say(key, `${sig}: stopping — the pi child is killed and the run unwinds (the lock and pid file are cleaned as it ends)`);
    try { ACTIVE.child?.kill('SIGTERM'); } catch { /* already gone */ }
    // the SIGKILL fallback fires only for THE child it was armed for (a stale timer must never
    // reach into a later run's child — unref'd timers keep firing after the run is over)
    const child = ACTIVE.child;
    const kill = setTimeout(() => { try { if (ACTIVE?.child === child) child.kill('SIGKILL'); } catch { /* gone */ } }, 5000);
    kill.unref?.();
  };
  const onTerm = () => stop('SIGTERM'), onInt = () => stop('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  return () => { process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt); };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
export async function makeRun(request, { key, formats, minutes, planOnly, file } = {}) {
  if (!request || typeof request !== 'string' || !request.trim()) throw new Error('studio make "<request>" — the request in plain words');
  if (ACTIVE) throw new Error(`another make run is active in this process — key "${ACTIVE.key}". Stop it first: ./studio make --stop, or wait for it to finish`);
  const K = key ?? slugKey(request);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(K)) throw new Error(`the key "${K}" must be lowercase letters, digits and dashes`);
  const cap = maxRuns();
  say(K, `make ${K}: request ${request.length} chars, formats ${(formats ?? ['16:9']).join(',')}, minutes ${minutes ?? 180}${planOnly ? ', plan only' : ''}, at most ${cap} pi run(s)`);
  takeLock(K);
  ACTIVE = { key: K, child: null, stopping: null };
  const pidFile = join(FILMS, K, 'runner.pid');
  let removeSignals = () => {};
  let iterations = 0;
  let result = null;
  let lastWhy = '(no verify ran)';
  try {
    // 1. the project: the request VERBATIM in brief.md, --file inputs sha-pinned, the minutes budget
    const P = await import('../kinds/project/index.mjs');
    const r = await P.create(K, { request, formats: formats ?? ['16:9'], inputs: file ?? [] });
    console.log(r.message);
    const B = await import('./budget.mjs');
    const mins = Number(minutes ?? 180);
    if (!Number.isFinite(mins) || mins <= 0) throw new Error('--minutes must be a positive number of minutes');
    writeJson(B.budgetPath(K), { ...readJson(B.budgetPath(K), {}), minutes: mins });

    writeFileSync(pidFile, String(process.pid));
    removeSignals = installSignals(K);

    // 2. the loop: pi -> verify -> the stop conditions, relaunching until one fires
    const stopFiles = [join(FILMS, K, 'STOP'), join(ROOT, 'STOP')];
    for (let n = 1; n <= cap && !result; n++) {
      if (ACTIVE.stopping) break;                       // a signal already asked us to stop
      const run = await runPi(K, n);
      iterations = n;
      const acc = await accountMinutes(K, run.ms / 60000, `pi run ${n} (${(run.ms / 1000).toFixed(0)}s)`);
      if (acc.stop) say(K, `budget: ${acc.why}`);
      if (ACTIVE.stopping) { result = { outcome: 'stopped', reason: `stopped by ${ACTIVE.stopping} (studio make --stop or an interrupt) — the pi child was killed after ${n} run(s)` }; break; }

      if (planOnly) {
        // --plan-only: a valid plan is the finish line — stop, no children built
        const { validatePlanFile } = await import('./plan.mjs');
        const plan = await validatePlanFile(join(FILMS, K, 'plan.json'));
        say(K, `plan --check: ${plan.ok ? `VALID (${(plan.plan?.segments || []).length} segment(s), chosen ${plan.plan?.decision?.chosen})` : `${plan.errors.length} error(s) — ${plan.errors[0]}`}`);
        if (plan.ok) { result = { outcome: 'plan-only', reason: `plan.json valid after ${n} pi run(s) — no children built` }; break; }
        lastWhy = `plan: ${plan.errors.join('; ')}`;
      } else {
        const { verifyProject } = await import('./ship.mjs');
        let v;
        try { v = await verifyProject(K); } catch (e) { v = { pass: false, why: [String(e.message || e)] }; }
        lastWhy = (v.why || ['(no reasons)']).join('; ');
        say(K, `verify: ${v.pass ? 'GREEN' : `${v.why.length} problem(s) — ${String(v.why[0]).slice(0, 200)}`}`);
        if (v.pass) { result = { outcome: 'verified', reason: `project verify GREEN after ${n} pi run(s)` }; break; }
      }
      if (stopFiles.some(existsSync)) { result = { outcome: 'stopped-stop', reason: `a STOP file appeared (films/${K}/STOP or the repo root) — the run stops without rebuilding` }; break; }
      if (acc.stop) { result = { outcome: 'stopped-budget', reason: acc.why }; break; }
      if (n < cap) say(K, `not green yet — relaunching pi in the same session (run ${n + 1} of at most ${cap})`);
    }
    if (!result)
      result = ACTIVE.stopping
        ? { outcome: 'stopped', reason: `stopped by ${ACTIVE.stopping} (studio make --stop or an interrupt) — the pi child was killed` }
        : { outcome: 'stopped-cap', reason: `the relaunch cap (${cap} pi run(s), STUDIO_MAKE_MAX_RUNS) was hit without a green verify — last problems: ${lastWhy.slice(0, 300)}` };
  } finally {
    try { rmSync(pidFile, { force: true }); } catch { /* nothing to clean */ }
    removeSignals();
    ACTIVE = null;
    dropLock();
    say(K, `outcome: ${result?.outcome ?? 'aborted'}${result?.reason ? ` — ${result.reason}` : ''}`);
  }
  return { key: K, iterations, outcome: result.outcome, reason: result.reason, logFile: logFileOf(K) };
}

// ── --stop: SIGTERM every runner pid (its handler kills the pi child and unwinds) ──────────────
export async function stopRun() {
  const stopped = [];
  if (existsSync(FILMS)) {
    for (const d of readdirSync(FILMS)) {
      const f = join(FILMS, d, 'runner.pid');
      if (!existsSync(f)) continue;
      const pid = Number(readFileSync(f, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 1 || !pidAlive(pid)) { rmSync(f, { force: true }); continue; }   // a stale pid file: the run is gone
      process.kill(pid, 'SIGTERM');      // the runner's own SIGTERM handler kills its pi child + unwinds
      stopped.push({ key: d, pid });
    }
  }
  const cur = readJson(LOCK);
  if (cur?.pid && (stopped.some((s) => s.pid === cur.pid) || !pidAlive(cur.pid))) { try { rmSync(LOCK, { force: true }); } catch { /* not ours */ } }
  if (!stopped.length)
    throw new Error('no make run is active — nothing to stop (a run writes films/<key>/runner.pid while it works; stale pid files were cleaned up just now)');
  return { stopped };
}
