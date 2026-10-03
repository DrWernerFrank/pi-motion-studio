// capped.mjs — THE memory guard. Every Python/Manim process the studio spawns runs through here
// (math films: engine/math.mjs; never call spawn() directly for scene work).
//
// After the typeset.py OOM (docs/math/DECISIONS.md D-006) the rule is structural:
//   1. a HARD per-process memory cap — systemd user cgroup (MemoryMax, no swap) when the machine
//      has systemd, plus a belt-and-braces RSS watchdog polling the process group (works everywhere,
//      and catches grandchildren the cgroup might re-parent);
//   2. a wall-clock kill (a hung scene dies at its budget, SIGKILL after SIGTERM grace);
//   3. a deterministic environment (PYTHONHASHSEED, fixed locale, SOURCE_DATE_EPOCH);
//   4. a TOTAL-RAM scheduler (MemPool): jobs declare their expected peak (= their cap) and a queue
//      never lets the sum exceed the machine's budget — oversubscription is impossible by design.
//
// A killed run RESOLVES with { killed: true, reason: 'memory' | 'timeout' } — callers turn that into
// the loud, actionable error (scene, last animation, fix). It never rejects.
import { spawn } from 'node:child_process';
import { run as _run } from './proc.mjs';

// The machine policy (calibrated in docs/math/ADR-004; this box: 6.8 GB RAM).
//   check  1024 MB  (measured dry-run peak 200 MB; the class of process that OOM'd before)
//   draft  1536 MB  (measured draft peak 920 MB; up to 3 in flight under the total budget)
//   final  3072 MB  (measured heavy-scene peak 3.16 GB at 1080p60 — the probe scene; real demo
//                    scenes are lighter; a scene that hits this cap is killed loudly and gets SPLIT,
//                    never "given more". Raise only with a DECISIONS entry + measurement.)
//   TOTAL  4608 MB  (~2.2 GB left for the OS, pi, the GUI and the browser on a 6.8 GB box)
export const CAPS = { check: 1024, draft: 1536, final: 3072 };
export const TOTAL_MB = 4608;
export const TIMEOUTS = { check: 180, draft: 300, final: 900 }; // s per scene, by quality

let _systemd = null;
async function hasSystemd() {
  if (_systemd !== null) return _systemd;
  try { const r = await _run('systemd-run', ['--user', '--scope', '--quiet', 'true'], { allowFail: true, timeout: undefined }); _systemd = r.code === 0; }
  catch { _systemd = false; }
  return _systemd;
}

// The deterministic env (mission §3.2): same inputs -> identical frames, run to run.
export function detEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SOURCE_DATE_EPOCH: '1735689600',
    ...extra,
  };
}

const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } };

// The last thing a killed Manim scene was doing (progress bars carry `Animation N: <Type>(...)`).
export function lastAnimation(err = '') {
  const flat = err.replace(/\r/g, '\n');
  const hits = [...flat.matchAll(/Animation (\d+): (\w+)/g)];
  return hits.length ? `animation ${hits.at(-1)[1]} (${hits.at(-1)[2]})` : null;
}

export async function runCapped(cmd, args, { cwd, env, input, memoryMb = 1024, timeoutS = 300, label = '' } = {}) {
  const systemd = await hasSystemd();
  const wrap = systemd
    ? ['systemd-run', '--user', '--scope', '--quiet', '-p', `MemoryMax=${memoryMb}M`, '-p', 'MemorySwapMax=0']
    : [];
  return new Promise((resolve) => {
    const p = systemd
      ? spawn(wrap[0], [...wrap.slice(1), cmd, ...args], { cwd, env: detEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      : spawn(cmd, args, { cwd, env: detEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '', err = '', reason = null, done = false;
    const take = (d, to) => (chunk) => { const s = String(chunk); to === 'out' ? (out += s) : (err += s); if (out.length > 4e6) out = out.slice(-2e6); if (err.length > 4e6) err = err.slice(-2e6); };
    p.stdout.on('data', take(null, 'out')); p.stderr.on('data', take(null, 'err'));
    const finish = (code) => { if (done) return; done = true; clearInterval(rss); clearTimeout(to); resolve({ code, out, err, killed: reason !== null, reason, label }); };

    // belt-and-braces watchdog: the cgroup is the wall, this is the second one (and the only one
    // on machines without systemd). Polls the whole process group's RSS every 150 ms.
    const rss = setInterval(async () => {
      try {
        const r = await _run('ps', ['-o', 'rss=', '-g', String(p.pid)], { allowFail: true });
        const total = String(r.out).split('\n').map((n) => Number(n)).filter(Boolean).reduce((a, b) => a + b, 0);
        if (total > memoryMb * 1024) { reason = 'memory'; killGroup(p.pid); }
      } catch { /* ps raced with the exit; the close handler owns the rest */ }
    }, 150);
    const to = setTimeout(() => { reason = 'timeout'; killGroup(p.pid); }, timeoutS * 1000);

    p.on('error', (e) => { reason = 'spawn'; err += String(e); finish(127); });
    // A death by signal with no watchdog reason = the CGROUP's OOM kill (MemoryMax): attribute it.
    p.on('close', (code, signal) => {
      if (reason === null && signal) reason = signal === 'SIGKILL' ? 'memory' : `signal:${signal}`;
      finish(code);
    });
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}

// The scheduler: a job declares its expected peak (= its cap); it launches only when the running
// sum plus it stays under TOTAL_MB. Oversubscription is impossible by construction.
export class MemPool {
  constructor(totalMb = TOTAL_MB) { this.totalMb = totalMb; this.running = []; this.queue = []; }
  get usedMb() { return this.running.reduce((a, j) => a + j.memoryMb, 0); }
  run(job) { // { cmd, args, memoryMb, timeoutS, cwd, env, label, onDone }
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject }); this._drain();
    });
  }
  _drain() {
    this.queue = this.queue.filter((j) => {
      if (this.usedMb + j.memoryMb > this.totalMb) return true; // keep waiting
      const job = { ...j };
      this.running.push(job);
      runCapped(job.cmd, job.args, job).then((r) => {
        this.running = this.running.filter((x) => x !== job);
        job.resolve(r); this._drain();
      }, (e) => { this.running = this.running.filter((x) => x !== job); job.reject(e); this._drain(); });
      return false; // launched
    });
  }
}

// The loud error for a killed scene — what a human (and the agent) reads next.
export function killedMessage(r, { film, scene, fmt, quality } = {}) {
  const where = `${film ?? '?'}${scene ? ` scene ${scene}` : ''}${fmt ? ` ${fmt}` : ''} (${quality ?? '?'})`;
  const anim = lastAnimation(r.err);
  if (r.reason === 'memory') {
    return `KILLED (memory cap) in ${where}: the scene process exceeded its budget and was killed to protect the machine${anim ? `, last started ${anim}` : ''}.`
      + ' Fix: split the scene into smaller ones, or reduce what it animates at once — never raise the cap without a measured DECISIONS entry.';
  }
  if (r.reason === 'timeout') {
    return `KILLED (time budget) in ${where}: the scene exceeded its wall-clock budget${anim ? `; last started ${anim}` : ''}.`
      + ' Fix: profile before optimizing (mission §10) — --from-sentence and check runs are the iteration tools.';
  }
  return `command failed in ${where}: ${(r.err || r.out || '').trim().split('\n').slice(-6).join('\n')}`;
}
