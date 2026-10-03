// studio verify-math: the contract for math films (templates/prompts/math-video-engine.md §7).
// One row per check with its measured numbers; docs/math/verify-last.json; exit 0 only if every
// required check passed. A check lives in engine/verify/math/<id>.mjs (default export: async (ctx) =>
// { pass, measured, skip? }); a check without a file is "pending" and counts as red (mirrors the
// editing mission's D-003/D-004, never silently weakened).
//   studio verify-math [--quick] [--list] [--only <id>,…] [--clean]
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

const OUT = join(ROOT, 'docs', 'math');
const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
export const VERIFY_CACHE = join(CACHE, 'verify-math');

// id, phase that delivers it, what must hold (short), slow = skipped by --quick (long renders, finals).
// Order matters: `regress` sits before every check that creates films/verify-m-* (its spawned
// verify-edit sweeps verify-m films older than its own start — see docs/math/DECISIONS.md D-003).
export const CHECKS = [
  ['env', 'P1', 'doctor resolves Manim (importable, pinned), cairo/pango, a typesetting backend (probe formula -> SVG), ffmpeg, a TTS voice, ASR, sympy, the bundled fonts as Pango sees them'],
  ['regress', 'P0', 'studio regress passes and verify-edit --only env,edit-ops,gui-security,tools,docs passes'],
  ['typeset', 'P2', '40 formulas compile deterministically; named parts select+color; a Persian sentence shapes RTL; a broken formula fails with the formula + scene file:line'],
  ['render-determinism', 'P2', 'a fixture scene rendered twice from cold cache in 2 formats: identical framemd5; 1 worker == 3 workers', true],
  ['formats', 'P2', 'one scene in 16:9/9:16/1:1/4:5: exact WxH, yuv420p, bt709, SAR 1:1, faststart; lint clean in all four; text >= 3.2u; portrait is a re-composition, not a scaled copy', true],
  ['look', 'P2', 'every look mode (every/sentences/bookmarks/sections/phone/strip/times) works for all formats; frames labelled time, scene, sentence id, text; a stale draft is re-rendered first'],
  ['layout-lint', 'P3', '12 seeded-violation scenes each reported with the right object ids and time (+/- 1 frame); 0 false positives on 6 clean scenes; the solver places 8 crowded labels, each near its anchor'],
  ['claims', 'P4', '30 true claims pass, 15 false (incl. subtle sign errors) fail with a message; unparseable is an error; num() shows the computed value; --independent agrees on all 45; a false claim blocks ship'],
  ['script', 'P5', 'sentence ids stable when other sentences change; bookmarks parse; duplicate/missing ids and unknown scenes rejected with line numbers; sentences.json round-trips; the lint flags raw symbols'],
  ['voice', 'P5', 'byte-identical audio for the same text; timing offsets == concatenated sample offsets (+/- 1 sample); lexicon + normalizer apply; WER <= 10% round trip; one sentence re-voices alone; offline; fa voice; a narration.wav aligns'],
  ['sync', 'P5', 'a 6-bookmark scene: every bookmarked animation within 1 frame of timing.json and 80 ms of the ASR-measured word onset; scenes cover their narration; A/V end offset <= 1 frame'],
  ['where', 'P5', '20 random times resolve to scene, sentence, animation index and file:line agreeing with trace.json; a pinned note resolves the same'],
  ['scene-cache', 'P6', 'unchanged re-render < 10% of cold; one changed scene re-renders only it; one changed sentence re-voices one and re-renders only affected scenes; a palette change invalidates everything; formats never share partials', true],
  ['concat-mux', 'P6', '12-scene fixture: no black/duplicated/frozen frames at the joins; a 10-min film A/V drift <= 1 frame; loudness mix.lufs +/- 1, <= -1 dBTP; bed >= 8 dB lower under narration', true],
  ['errors', 'P6', 'syntax error, name error, backend compile error, missing voice model, hung scene, empty scene, invalid script: each fails loud with file:line or the formula + the fix; CLI and GUI show the same message; never a bare traceback'],
  ['perf-budget', 'P6', 'calibrated in S4 then frozen: draft <= 2x realtime on demos; one-scene draft re-render <= 20 s; a check run <= 25% of a draft; peak RSS <= 2.5 GB; temp dirs gone', true],
  ['library', 'P7', 'every kit component renders in all four formats with zero lint violations and zero failed claims; every ```python block in kit.md executes; the public API is frozen in the docs', true],
  ['captions', 'P7', 'narration captions in en and fa at 4 formats: <= 2 lines, >= 3.2u, safe area, no overlap; every codepoint in the font cmap; SRT/VTT monotonic and equal to the sentences'],
  ['gates', 'P8', 'math gates run on a math film -> gates.json; seeded faults (overlap, false claim, missing narration, loudness off, static hold) each FAIL with the right gate name + timestamp; a clean film passes; Canvas-only gates are replaced'],
  ['tools', 'P9', 'every math_* tool registered in math-tools.ts with a Type.Object schema and listed in BY_FILE; each runs against the starter film; skill and agent front matter parse'],
  ['docs', 'P9', 'studio help lists every command; README and AGENTS.md carry "## Math videos"; the skill, kit.md, craft.md and the critic exist; THIRD_PARTY.md lists every download; ADR-001..004 exist'],
  ['starter', 'P9', 'studio new from templates/math/ -> voice -> render -> gate -> ship unattended in 16:9 and 9:16; every gate passes; outputs probe clean', true],
  ['gui-smoke', 'P10', 'Playwright on a spare port: the math film plays, the format toggle works, clicking a sentence seeks, editing + re-voicing updates status, a seeded error shows file:line, Checks lists lint+claims, a pinned note resolves, a draft runs; 0 console errors, 0 failed requests'],
  ['gui-security', 'P10', 'POST without token gives 403; traversal, absolute paths, dotfiles and unknown film ids rejected on every new endpoint; scene code never runs outside the job runner'],
  ['hygiene', 'P11', 'after a full run films/ holds no verify-*; scratch is empty; git status shows only intended files; studio cache reports sizes and cache gc frees the math caches'],
  ['demos', 'P12', 'three narrated demos (determinant, tangent, odd-squares): finals in 16:9 + 9:16, 45-120 s, gates PASS, lint clean, >= 15 claims each all verified, >= 90% of mathematical sentences linked, no placeholder text', true],
  ['review', 'P12', 'reviews.json of each demo: >= 3 rounds, the last by math-critic, every score >= 8, correctness 10 with the independent re-derivation recorded in the notes, sheets exist'],
].map(([id, phase, title, slow = false]) => ({ id, phase, title, slow }));

const gitHead = async () => {
  const h = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, allowFail: true });
  const d = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, allowFail: true });
  return `${h.out.trim() || 'none'}${d.out.trim() ? '+dirty' : ''}`;
};

// Temp films the checks create live under films/verify-m-* and are removed at the end of a run — but only
// films that existed before this process started (mtime guard), so a concurrent verifier never deletes
// another run's films mid-check. The sweep also takes stale leftovers of the editing verifier
// (films/verify-*, the 5 GB the first mission left behind); films created after this process started are
// never touched — each check cleans up its own.
export const RUN_STARTED = Date.now();
export function cleanTemp() {
  const gone = [];
  if (existsSync(FILMS)) for (const f of readdirSync(FILMS)) {
    if (/^verify-(m-)?[a-z0-9-]+$/.test(f) && statSync(join(FILMS, f)).mtimeMs < RUN_STARTED - 2000) { rmSync(join(FILMS, f), { recursive: true, force: true }); gone.push(`films/${f}`); }
  }
  if (existsSync(VERIFY_CACHE)) { rmSync(VERIFY_CACHE, { recursive: true, force: true }); gone.push(VERIFY_CACHE.replace(homedir(), '~')); }
  return gone;
}

async function load(id) {
  const file = join(ROOT, 'engine', 'verify', 'math', `${id}.mjs`);
  return existsSync(file) ? (await import(pathToFileURL(file).href)).default : null;
}

const SYMBOL = { passed: 'PASS', failed: 'FAIL', pending: 'TODO', skipped: 'skip', error: 'ERR ' };

// One verify run at a time: two math verify runs would collect each other's temp films mid-check.
// Separate lock from verify-edit's (a full verify-edit running in the background makes this runner's
// `regress` check fail loudly with the lock's message — the runs are sequential by design, never corrupt).
const LOCK = join(CACHE, 'math-verify.lock');
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function takeLock() {
  mkdirSync(CACHE, { recursive: true });
  const cur = readJson(LOCK);
  if (cur?.pid && cur.pid !== process.pid && pidAlive(cur.pid)) throw new Error(`another verify-math is running (pid ${cur.pid}, started ${cur.at}): wait for it; stale locks are taken over automatically`);
  if (cur?.pid && cur.pid !== process.pid) console.error(`verify-math: taking over a stale lock (pid ${cur.pid} from ${cur.at})`);
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
}
const dropLock = () => { try { const cur = readJson(LOCK); if (cur?.pid === process.pid) rmSync(LOCK, { force: true }); } catch { /* not ours */ } };

export async function verifyMath({ quick = false, list = false, only, clean = false } = {}) {
  takeLock();
  try {
  return await runVerify({ quick, list, only, clean });
  } finally { dropLock(); }
}

async function runVerify({ quick = false, list = false, only, clean = false } = {}) {
  const last = readJson(join(OUT, 'verify-last.json'), { checks: {} });
  if (clean) { const gone = cleanTemp(); console.log(gone.length ? `removed ${gone.join(', ')}` : 'nothing to clean'); return { pass: true }; }
  if (list) {
    for (const c of CHECKS) console.log(`${c.id.padEnd(20)} ${c.phase.padEnd(4)} ${(last.checks?.[c.id]?.status || 'pending').padEnd(8)} ${c.slow ? '[slow] ' : ''}${c.title}`);
    return { pass: true };
  }
  const want = only ? String(only).split(',') : null;
  if (want) for (const w of want) if (!CHECKS.some((c) => c.id === w)) throw new Error(`unknown check "${w}": studio verify-math --list`);
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
            const x = await impl({ quick, root: ROOT, cache: VERIFY_CACHE });
            r = x.skip ? { status: 'skipped', reason: x.skip, measured: x.skip } : { status: x.pass ? 'passed' : 'failed', measured: x.measured ?? '' };
          }
        } catch (e) { r = { status: 'error', measured: String(e.message || e).split('\n').slice(0, 4).join(' | ') }; }
      }
      r.ms = Date.now() - t; checks[c.id] = r;
      console.log(`${SYMBOL[r.status]}  ${c.id.padEnd(20)} ${String(r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms').padStart(7)}  ${r.measured}`);
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
  console.log(`\n${result.passed.length}/${ids.length} passed, ${failed.length} not passing (${result.pending.length} pending), ${result.skipped.length} skipped  in ${((Date.now() - t0) / 1000).toFixed(0)}s  → docs/math/${want ? 'verify-last-only' : 'verify-last'}.json`);
  console.log(result.pass ? 'verify-math: PASS' : `verify-math: ${want || quick ? 'partial run (cannot pass)' : 'FAIL'}`);
  return result;
}
