#!/usr/bin/env node
// fake-pi.mjs — the pi binary's stand-in for the make runner's tests (S4 proved the real
// interface: `pi -p --session-id <id> @file "instruction"`; this answers it without a model).
// The runner sets STUDIO_PI_CMD='node <this file>' (the runner splits it on spaces into argv),
// and this file BEHAVES like a producer agent that followed the produce skill:
//
//   STUDIO_FAKE_PI_MODE=plan   write a minimal VALID plan.json (1 motion segment, 6s, the
//                              project's formats, 2 alternatives incl. the simplest, budget,
//                              deliverables — zero warnings) + the matching requirement rows
//                              (duration 6s tol 1, formats, has-audio) via ledger.addRequirements
//   STUDIO_FAKE_PI_MODE=build  ALSO build the piece honestly: kinds/project segment() creates +
//                              links the child, a moving-circle index.html is written, then the
//                              child's OWN pipeline runs in-process — gridBeats, the draft render
//                              + gates (the produce loop's build), the synth soundtrack, the
//                              FINAL render (the deliverable verify needs), gates again, and
//                              ensureFinals (the single-wrapper copy into the project's out/)
//   STUDIO_FAKE_PI_MODE=fail   exit 1 (the relaunch/cap/budget legs)
//   STUDIO_FAKE_PI_MODE=flaky  fail unless a marker file exists — the first call creates it and
//                              fails, the second behaves as build (the relaunch-recovers leg)
//   STUDIO_FAKE_PI_MODE=slow   sleep STUDIO_FAKE_PI_SLEEP ms, then behave as build (concurrency)
//   STUDIO_FAKE_PI_SLEEP=ms    sleep first in ANY mode (gives a test a window to seed STOP/budget)
//   STUDIO_FAKE_PI_LOG=path    one JSONL row per invocation: { at, argv, mode, key }
//
// It reads the request from the @brief.md argv (never from argv text: the request is only in the
// file). Renders go one at a time: a pgrep guard waits while any other fake-pi is mid-build.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));      // …/engine/produce
const ROOT = resolve(HERE, '..', '..');
const FILMS = join(ROOT, 'films');
const argv = process.argv.slice(2);
const mode = process.env.STUDIO_FAKE_PI_MODE || 'plan';

// the request arrives as @films/<key>/brief.md — never as argv text
const briefArg = argv.find((a) => a.startsWith('@')) ?? '';
const brief = briefArg ? resolve(briefArg.slice(1)) : null;
const sessionId = argv[argv.indexOf('--session-id') + 1];
const key = (brief ? brief.split(/[/\\]/).at(-2) : null) ?? sessionId ?? null;

// one JSONL row per invocation (the check asserts the @file argv and that the request never is)
const LOG = process.env.STUDIO_FAKE_PI_LOG || join(homedir(), '.cache', 'pi-motion-studio', 'logs', 'fake-pi.jsonl');
mkdirSync(dirname(LOG), { recursive: true });
appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), argv, mode, key })}\n`);

const die = (msg, code = 1) => { console.error(`fake-pi: ${msg}`); process.exit(code); };
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
if (Number(process.env.STUDIO_FAKE_PI_SLEEP || 0) > 0) await sleep(Number(process.env.STUDIO_FAKE_PI_SLEEP));

if (!key || !existsSync(join(FILMS, key, 'brief.md'))) die(`no @films/<key>/brief.md in argv (got: ${argv.join(' ')})`);

// ── the plan: minimal, VALID and ZERO warnings (verify pushes plan warnings into its whys) ─────
function writePlan(k) {
  const cfg = readJson(join(FILMS, k, 'film.json'), {});
  const bud = readJson(join(FILMS, k, 'budget.json'), { minutes: 180 });
  const formats = cfg.formats?.length ? cfg.formats : ['16:9'];
  const plan = {
    version: 1,
    goal: `A viewer watches one circle move with a landing title across a ${formats.join(' + ')} frame for six seconds.`,
    audience: 'the make runner\'s own fixture audience (the studio smoke test)',
    assumptions: [
      'the request means a code-drawn piece (no borrowed footage)',
      'the studio synth bed gives the piece its sound (no narration was asked)',
    ],
    deliverables: [{ type: 'video', name: 'piece', formats, duration: 6 }],
    decision: {
      chosen: 'motion',
      why: 'A code-drawn moving circle on a beat grid is the motion technique\'s home turf: deterministic, sound from the same timeline, fast to relaunch.',
      risky: false,
      alternatives: [
        { id: 'math', rejected_because: 'nothing here needs teaching or proof; a typeset piece would carry no motion of its own' },
        { id: 'simplest: a static card', rejected_because: 'a still cannot carry motion or sound, and the runner relaunches until verify is green' },
      ],
      probes: [],
    },
    segments: [{
      id: 's01', capability: 'motion', role: 'the whole piece',
      brief: 'One circle springs in and drifts with a fading title and an orbiting dot, never a dead frame.',
      duration: 6, inputs: [],
      acceptance: [
        'the child film\'s gates PASS (something moves in every 1.5s window)',
        'the final is the asked format with the studio soundtrack at the mix level',
      ],
    }],
    assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'one mix at -14 LUFS' },
    feasibility: { blocked_inputs: [], needs_capability: [] },
    budget: { minutes: bud.minutes || 180, usd: 0 },
    risks: ['a 6s piece must stay honest: everything drawn in code, one moving circle, no stock motion'],
  };
  writeJson(join(FILMS, k, 'plan.json'), plan);
  return plan;
}

async function addRequirements(k) {
  const L = await import('./ledger.mjs');
  const formats = readJson(join(FILMS, k, 'film.json'), {}).formats ?? ['16:9'];
  await L.addRequirements(k, [
    { text: 'the piece runs 6 seconds', type: 'measurable', verifier: 'duration', arg: 6, tolerance: 1 },
    { text: `the piece is ${formats.join(' and ')}`, type: 'measurable', verifier: 'formats', arg: formats },
    { text: 'the piece has sound (not silent)', type: 'measurable', verifier: 'has-audio', arg: true },
  ], { source: 'request' });
}

// the child's film: one circle that never stops moving, with a title that fades in — the gates
// (dead-time, novelty, hook, determinism) pass on their own, honestly: every value comes from
// design.json via D, every move is a pure function of t, nothing settles before the last frame.
const CHILD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>piece</title>
<link rel="stylesheet" href="/engine/lib/fonts.css">
</head>
<body>
<script type="module">
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import { spring, clamp, pulse, kineticLine } from '/engine/lib/motion.js';

let D, cfg;

film({
  async setup(L, c) { cfg = c; D = await loadDesign(); },
  draw(ctx, t, L) {
    ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H);
    const alive = spring(Math.min(t / 1.1, 1), ...D.feel('ui'));        // the circle springs in over ~1s
    const r = L.u * 8.5 * (0.65 + 0.35 * alive) * (1 + 0.06 * pulse(t, cfg.beats || []));
    const x = L.cx + L.u * 24 * Math.sin(t * 0.9 + 0.4);                // the slow drift across the frame
    const y = L.cy - L.u * 2 + L.u * 14 * Math.sin(t * 1.35);
    ctx.globalAlpha = 0.25 + 0.75 * alive;
    ctx.fillStyle = D.c.accent; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const a = t * 1.9;                                                  // the orbiting dot never stops
    ctx.fillStyle = D.c.ink;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55, L.u * 1.6, 0, Math.PI * 2); ctx.fill();
    const tf = clamp((t - 2.4) / 1.2, 0, 1);                           // the title fades in from 2.4s and lands
    if (tf > 0) {
      ctx.globalAlpha = tf; ctx.textAlign = 'center';
      D.type(ctx, 'title', L);
      kineticLine(ctx, 'one request, one piece', L.cx, L.cy - L.u * 17, t - 2.4, { feel: D.feel('type'), stagger: D.stagger, align: 'center', color: D.c.ink });
      ctx.globalAlpha = 1;
    }
    const w = L.safe.w * clamp(t / cfg.duration, 0, 1);                 // the through-line fills to the end
    ctx.fillStyle = D.c.accent; ctx.globalAlpha = 0.85;
    ctx.fillRect(L.safe.x, L.H - L.u * 0.5, w, L.u * 0.5); ctx.globalAlpha = 1;
  },
});
</script>
</body>
</html>
`;

/** ONE render at a time: wait while any other fake-pi is alive (pgrep names this file; the count
 *  includes this process, so >1 means a sibling is mid-build). The runner serializes runs itself;
 *  this guard also covers a stray fake-pi from a killed run. */
async function oneRenderAtATime() {
  const count = () => {
    const r = spawnSync('pgrep', ['-f', 'engine/produce/fake-pi.mjs'], { encoding: 'utf8', timeout: 5000 });
    if (r.error) return 1;   // no pgrep: nothing to guard against
    return (r.stdout || '').split('\n').filter(Boolean).length;
  };
  for (let i = 0; i < 480 && count() > 1; i++) await sleep(250);   // up to 120s
}

// ── mode build (and the second call of flaky, and slow after its sleep) ───────────────────────
async function buildPiece(k) {
  const P = await import('../kinds/project/index.mjs');
  const { gridBeats } = await import('../audio.mjs');
  const { renderFilm } = await import('../render.mjs');
  const { gates } = await import('../gates.mjs');
  const { ensureFinals } = await import('./ship.mjs');
  const { hooksFor } = await import('../kinds/registry.mjs');

  const plan = writePlan(k);
  await addRequirements(k);
  const seg = plan.segments[0];
  const child = `${k}-${seg.id}`;

  await P.segment(k, seg, { build: false });          // create + link the child (+ the design system)
  writeFileSync(join(FILMS, child, 'index.html'), CHILD_HTML);
  gridBeats(child);                                   // beats from the scaffold's bpm (idempotent)

  await oneRenderAtATime();                           // no two fake-pi renders ever overlap
  const built = await P.segment(k, seg);               // the produce loop's build: draft render + gates
  if (!built.gates) die(`the child's gates did not pass — refusing to pretend: ${JSON.stringify(built.failed ?? built)}`);
  console.log(`fake-pi: films/${child} draft + gates PASS (segment done)`);

  const K = await hooksFor(child);
  await K.sound(child);                                // the synth soundtrack: music + sfx -> out/mix.wav
  const fmt = plan.deliverables.find((d) => d.type === 'video').formats[0];
  await renderFilm(child, { quality: 'final', fmt });  // the DELIVERABLE (the mix is muxed in)
  const g = await gates(child);                        // the full gates on the finished child
  if (!g.pass) die(`the finished child's gates FAIL: ${g.checks.filter((c) => c.level === 'fail').map((c) => c.name).join(', ')}`);
  const fin = ensureFinals(k);                        // the single-wrapper copy into the project's out/
  console.log(`fake-pi: built films/${child} (sound, final ${fmt}, gates PASS) and copied ${fin.copied.join(', ')} into films/${k}/out/`);
}

// ── dispatch ─────────────────────────────────────────────────────────────────────────────────
try {
  if (mode === 'fail') die('the requested failure (STUDIO_FAKE_PI_MODE=fail)', 1);
  if (mode === 'flaky') {
    const marker = join(FILMS, key, '.fake-pi-flaky-passed');
    if (!existsSync(marker)) { writeFileSync(marker, `${new Date().toISOString()}\n`); die('flaky: the first call fails (the marker is written — the next relaunch succeeds)', 1); }
    await buildPiece(key);
  } else if (mode === 'build' || mode === 'slow') {
    await buildPiece(key);                             // slow already slept above
  } else if (mode === 'plan') {
    writePlan(key);
    await addRequirements(key);
    console.log(`fake-pi: plan.json + requirements written for films/${key} (nothing built)`);
  } else {
    die(`unknown STUDIO_FAKE_PI_MODE "${mode}" (plan|build|fail|flaky|slow)`, 2);
  }
} catch (e) {
  die(String((e && e.stack) || e).split('\n').slice(0, 6).join('\n'));
}
process.exit(0);
