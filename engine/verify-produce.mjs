// studio verify-produce: the contract for the producer mission (templates/prompts/producer.md §7).
// One row per check with its measured numbers; docs/produce/verify-last.json; exit 0 only if every
// required check passed. A check lives in engine/verify/produce/<id>.mjs (default export: async (ctx) =>
// { pass, measured, skip? }); a check without a file is "pending" and counts as red (same conventions as
// verify-edit and verify-math — their D-003/D-004, never silently weakened).
//   studio verify-produce [--quick] [--list] [--only <id>,…] [--clean]
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

const OUT = join(ROOT, 'docs', 'produce');
const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
export const VERIFY_CACHE = join(CACHE, 'verify-produce');

// id, phase that delivers it, what must hold (short), slow = skipped by --quick (renders, GUI runs, full runs).
// Order matters: `regress` runs before every check that creates films/verify-p-* (its spawned
// verify-edit/verify-math sweeps collect temp films older than their own start — see docs/math/DECISIONS.md D-003).
export const CHECKS = [
  ['env', 'P0', 'doctor reports pi on PATH (version), the capability readiness table, the runner prerequisites; each missing item names its fix'],
  ['regress', 'P0', 'studio regress passes and both cheap subsets (verify-edit env,edit-ops,gui-security,tools,docs / verify-math env,regress,typeset,claims,docs) pass'],
  ['registry', 'P1', 'motion, edit, math and project are registry modules; no raw FILM-KIND check outside engine/kinds/ (kindOf/requireKind are the sanctioned helpers); golden CLI transcripts + draft md5 equal the committed baseline; a missing required hook fails loudly naming it; verify-edit docs seeded-fault still fails'],
  ['naming', 'P1', 'no tracked path and no films/ path with Windows-reserved chars; math outputs final-16x9 style; the three math demos migrated, re-render identical md5; media/ + x-*.json untracked and ignored'],
  ['capabilities', 'P1', 'studio capabilities --json validates against the schema; readiness from real probes; every invoke command exists in studio help; the three techniques + voice/asr/captions/mix/capture/ingest/assemble present; a malformed entry rejected with its path'],
  ['services', 'P2', 'a motion film with a script.md gets timing.json and a narration bus at mix.lufs; the math path byte-identical to before; captions/mix/capture callable from any kind hooks'],
  ['plan', 'P2', 'the validator rejects a plan missing goal/assumptions/segment capability/acceptance/reasons/<2 alternatives/budget/deliverables; accepts a valid one; flags over-scoping and unknown capabilities; a risky choice requires saved probe sheets'],
  ['ledger', 'P2', 'each verifier passes seeded good media and fails seeded bad media with a message; measurable w/o verifier fails loudly; subjective w/o critic evidence cannot pass; brief-lint flags every number/format/language/named asset of 10 seeded requests; a non-human waiver refused'],
  ['facts', 'P2', 'quote-in-snapshot passes; missing quote, missing snapshot, hedged claim, unsourced claim each handled by rule; verification offline'],
  ['assets', 'P2', 'an asset without a license blocks ship; PD/CC0/CC-BY parsed from recorded Wikimedia/NASA/Internet Archive fixtures; credits list every attributed asset; sha256 pins hold'],
  ['budget', 'P2', 'no key or no STUDIO_BUDGET_USD: the fake cloud provider reports disabled and is never called; with both it is called and logged to budget.json; usd hard stop + minutes soft/hard stops fire; nothing real is ever called'],
  ['project', 'P2', 'studio project new/status/list/plan/verify/rebuild/ship/where work; a killed run resumes from state.json; a note on the final chains through the segment to the child where; a revision appends requirements and rebuilds only touched parts (counts asserted); a child lists its parent'],
  ['single', 'P2', 'a project wrapping one math, one motion and one edit film each ships with the child final unchanged (byte-identical or remux only) and project verify passes', true],
  ['assemble', 'P3', 'composite fixture (math + motion + edit) in 16:9 and 9:16: exact geometry, bt709, duration = sum within 1 frame, A/V within 1 frame, loudness at mix.lufs and <= -1 dBTP, no black/frozen join, per-segment PSNR >= 40 dB (or the S2 figure), design present in every child', true],
  ['skill', 'P4', 'the produce skill + AGENTS.md "Start here" exist and parse; the four older skills defer to produce; no two skills claim "any video"; the skill names the order, decision framework, one-question rule, revision flow and the loop'],
  ['critic', 'P4', 'producer-critic parses, is read-only, lists its tools, scores 7 keys + fidelity + coherence, the fidelity-10 rule present; film_review accepts its round'],
  ['make', 'P5', 'studio make (fake pi) creates the project, stores the request verbatim, passes it by file, relaunches until the project verifier passes, stops on budget/STOP/cap, refuses a second concurrent run, survives quotes/backticks/$(); --plan-only stops after a valid plan; --stop kills the run'],
  ['tools', 'P5', 'every project_* tool registered in project-tools.ts with a Type.Object schema and listed in BY_FILE; each runs against a fixture project'],
  ['gui-smoke', 'P5', 'Playwright on a spare port: the Make dialog creates a project (fake pi); Plan/Requirements/Assets/Facts/Log render; segments show status; children group under the project; a note pins; a rebuild runs; zero console errors, screenshots looked at', true],
  ['gui-security', 'P5', 'POST without token 403; oversized request, traversal or absolute attachment path, second concurrent run and unknown id refused; no endpoint passes the request through a shell or runs anything outside the job runner'],
  ['chart', 'P6', 'the grown chart technique (K12, demo D): create scaffolds chart.json; the data/axis gates run good/bad (a bad row names its index); motion re-exports; the catalog + plan menu carry it'],
  ['growth', 'P6', 'studio capability new scaffolds a capability that capability check refuses until its parts exist and accepts when they do; a passing one appears in studio capabilities and in the plan menu; demo D capability passes its own check; removing a capability leaves the registry consistent'],
  ['battery', 'P7', 'the 12 stored plans validate; each covers >= 90% of its independently written reference requirements; each capability set is one of the reference acceptable sets; every missing input flagged in feasibility; alternatives stated; no invented input'],
  ['errors', 'P8', 'each P8 failure fails loud with the next step; a prompt-injection page changes nothing and is noted in log.md; a killed run and two simultaneous runs handled; partial output never promoted'],
  ['docs', 'P9', 'studio help lists every command; README and AGENTS.md carry "Start here" and "## Producer"; the skill, the critic, CAPABILITIES.md (generated), ADR-001..004 and THIRD_PARTY.md exist; the older checks that read docs still pass'],
  ['hygiene', 'P9', 'after a full run films/ holds no verify-*; the repo root holds no stray files; git status shows only intended files; scratch empty; studio cache gc frees the new caches; nothing printed or logged contains a credential'],
  ['demos', 'P9', 'four demo projects exist with finals in the asked formats, ledgers green, gates PASS, credits and report present, every fact sourced, every asset licensed, spend zero', true],
  ['review', 'P9', 'each demo reviews.json: >= 3 rounds, last by producer-critic, every score >= 8, fidelity = 10, sheets exist', true],
].map(([id, phase, title, slow = false]) => ({ id, phase, title, slow }));

const gitHead = async () => {
  const h = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, allowFail: true });
  const d = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, allowFail: true });
  return `${h.out.trim() || 'none'}${d.out.trim() ? '+dirty' : ''}`;
};

// Temp films the checks create live under films/verify-p-* and are removed at the end of a run — but only
// films that existed before this process started (mtime guard), so a concurrent verifier never deletes
// another run's films mid-check. COMMITTED fixtures are git-tracked and NEVER swept (the third-sweep rule,
// docs/math/DECISIONS.md D-026/D-029): a temp film is untracked by definition.
export const RUN_STARTED = Date.now();
const trackedByGit = (f) => {
  try { return execSync('git ls-files -- films/' + f, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; }
  catch { return false; }
};
export function cleanTemp() {
  const gone = [];
  if (existsSync(FILMS)) for (const f of readdirSync(FILMS)) {
    if (/^verify-p-[a-z0-9-]+$/.test(f) && statSync(join(FILMS, f)).mtimeMs < RUN_STARTED - 2000) {
      if (trackedByGit(f)) continue; // a committed fixture: never a leftover
      rmSync(join(FILMS, f), { recursive: true, force: true }); gone.push(`films/${f}`);
    }
  }
  if (existsSync(VERIFY_CACHE)) { rmSync(VERIFY_CACHE, { recursive: true, force: true }); gone.push(VERIFY_CACHE.replace(homedir(), '~')); }
  return gone;
}

async function load(id) {
  const file = join(ROOT, 'engine', 'verify', 'produce', `${id}.mjs`);
  return existsSync(file) ? (await import(pathToFileURL(file).href)).default : null;
}

const SYMBOL = { passed: 'PASS', failed: 'FAIL', pending: 'TODO', skipped: 'skip', error: 'ERR ' };

// One verify run at a time: two produce verify runs would collect each other's temp films mid-check.
// A separate lock from verify-edit/verify-math (their full runs are supposed to run concurrently with
// this one at mission end — the lock is only about THIS runner's own runs).
const LOCK = join(CACHE, 'produce-verify.lock');
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function takeLock() {
  mkdirSync(CACHE, { recursive: true });
  const cur = readJson(LOCK);
  if (cur?.pid && cur.pid !== process.pid && pidAlive(cur.pid)) throw new Error(`another verify-produce is running (pid ${cur.pid}, started ${cur.at}): wait for it; stale locks are taken over automatically`);
  if (cur?.pid && cur.pid !== process.pid) console.error(`verify-produce: taking over a stale lock (pid ${cur.pid} from ${cur.at})`);
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
}
const dropLock = () => { try { const cur = readJson(LOCK); if (cur?.pid === process.pid) rmSync(LOCK, { force: true }); } catch { /* not ours */ } };

export async function verifyProduce({ quick = false, list = false, only, clean = false } = {}) {
  takeLock();
  try {
    return await runVerify({ quick, list, only, clean });
  } finally { dropLock(); }
}

async function runVerify({ quick = false, list = false, only, clean = false } = {}) {
  const last = readJson(join(OUT, 'verify-last.json'), { checks: {} });
  if (clean) { const gone = cleanTemp(); console.log(gone.length ? `removed ${gone.join(', ')}` : 'nothing to clean'); return { pass: true }; }
  if (list) {
    for (const c of CHECKS) console.log(`${c.id.padEnd(16)} ${c.phase.padEnd(4)} ${(last.checks?.[c.id]?.status || 'pending').padEnd(8)} ${c.slow ? '[slow] ' : ''}${c.title}`);
    return { pass: true };
  }
  const want = only ? String(only).split(',') : null;
  if (want) for (const w of want) if (!CHECKS.some((c) => c.id === w)) throw new Error(`unknown check "${w}": studio verify-produce --list`);
  const picked = CHECKS.filter((c) => !want || want.includes(c.id));
  const checks = {}, t0 = Date.now();
  try {
    for (const c of picked) {
      const t = Date.now(); let r;
      if (quick && c.slow) r = { status: 'skipped', reason: '--quick', measured: 'skipped by --quick' };
      else {
        try {
          const impl = await load(c.id);
          if (!impl) r = { status: 'pending', measured: `not implemented yet (due in ${c.phase})` };
          else {
            const x = await impl({ quick, root: ROOT, cache: VERIFY_CACHE, runFull: !quick });
            r = x.skip ? { status: 'skipped', reason: x.skip, measured: x.skip } : { status: x.pass ? 'passed' : 'failed', measured: x.measured ?? '' };
          }
        } catch (e) { r = { status: 'error', measured: String(e.message || e).split('\n').slice(0, 4).join(' | ') }; }
      }
      r.ms = Date.now() - t; checks[c.id] = r;
      console.log(`${SYMBOL[r.status]}  ${c.id.padEnd(16)} ${String(r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms').padStart(7)}  ${r.measured}`);
    }
  } finally { cleanTemp(); }
  const ids = picked.map((c) => c.id);
  const of = (s) => ids.filter((id) => checks[id].status === s);
  // A skip is only honest for an environment cause; a --quick skip must never read as "done".
  const failed = [...of('failed'), ...of('error'), ...of('pending'), ...ids.filter((id) => checks[id].status === 'skipped' && checks[id].reason === '--quick')];
  const result = {
    at: new Date().toISOString(), gitHead: await gitHead(), quick, only: want, required: ids, passed: of('passed'), failed,
    skipped: of('skipped').map((id) => ({ id, reason: checks[id].reason })), pending: of('pending'),
    pass: failed.length === 0 && !want && !quick, checks,
  };
  // A partial run never overwrites the full verdict.
  writeJson(join(OUT, want ? 'verify-last-only.json' : 'verify-last.json'), result);
  console.log(`\n${result.passed.length}/${ids.length} passed, ${failed.length} not passing (${result.pending.length} pending), ${result.skipped.length} skipped  in ${((Date.now() - t0) / 1000).toFixed(0)}s  → docs/produce/${want ? 'verify-last-only' : 'verify-last'}.json`);
  console.log(result.pass ? 'verify-produce: PASS' : `verify-produce: ${want || quick ? 'partial run (cannot pass)' : 'FAIL'}`);
  return result;
}
