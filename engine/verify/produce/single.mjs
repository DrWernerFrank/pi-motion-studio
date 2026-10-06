// single (P2, slow): a project wrapping ONE math film, ONE motion film and ONE edit film — each
// ships with the child's final unchanged (the thin wrapper COPIES byte-identical; a remux with
// the same video stream bytes would also satisfy the contract — the copy is the stricter form we
// assert) and `studio project verify` passes on every wrapper. The children are real films of
// their kind with minimal PASSING pieces (motion: a 6s ident that animates through every frame,
// voice + captions; edit: the NASA talking-head fixture ingested, one 3s clip measured off the
// freeze map, dialog bus, 16:9 final; math: the 3-scene starter scaffold, voice, draft + 16:9
// final — the heavy one, guarded to run one Manim render at a time).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { fixturePath } from '../../fixtures.mjs';
import { ROOT } from '../../lib/serve.mjs';

const CLI = join(ROOT, 'engine', 'cli.mjs');
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const sh = (args, timeout = 10 * 60 * 1000) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const sleep = (ms) => new Promise((ok) => { setTimeout(ok, ms); });

// ONE Manim render at a time (house rule): pgrep before any math-film render; wait up to 3x120s
// for a clean list, then refuse loudly rather than stack a second heavy render.
const manimBusy = () => spawnSync('pgrep', ['-f', 'manim render']).status === 0;
async function waitManim() {
  for (let i = 0; i < 3 && manimBusy(); i++) {
    console.log(`  single: another manim render is running — waiting 120s (${i + 1}/3)`);
    await sleep(120 * 1000);
  }
  if (manimBusy()) throw new Error('a manim render is still running after 3x120s — one Manim render at a time (retry when the box is idle)');
}

// the motion child's film: an ident that actually moves (the scaffold template holds still from
// 4s and fails its dead-time gate; this one animates through all six seconds — honestly)
const IDENT_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ident</title>
<link rel="stylesheet" href="/engine/lib/fonts.css">
</head>
<body>
<script type="module">
// The ident: the mark springs in, one line lands, a circle drifts through the beat grid until the
// last frame. Every value comes from design.json via D; every move is a pure function of t.
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import { spring, clamp, rrect, kineticLine, playScenes, pulse } from '/engine/lib/motion.js';

let D, cfg;

function drift(ctx, t, L, alive) {
  const r = L.u * 8.5;
  const x = L.cx + L.u * 24 * Math.sin(t * 0.9 + 0.4);   // a slow drift: a big shape, always resolvable
  const s = alive * (1 + 0.05 * pulse(t, cfg.beats || []));
  ctx.save(); ctx.translate(x, L.cy - L.u * 2); ctx.scale(s, s); ctx.globalAlpha = 0.25 + 0.75 * alive;
  ctx.fillStyle = D.c.accent; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // the orbiting dot: the heartbeat that never stops while the ident lives
  const a = t * 1.9;
  ctx.fillStyle = D.c.ink;
  ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.55, L.cy - L.u * 2 + Math.sin(a) * r * 1.55, L.u * 1.6, 0, Math.PI * 2); ctx.fill();
}

const scenes = [
  { from: 0, to: 2.1, draw(ctx, lt, L) {
      // the word rises on its own springs behind a bar that never starts empty (frame 0 must read)
      const w = L.W * (0.18 + 0.44 * spring(lt, ...D.feel('ui')));
      ctx.fillStyle = D.c.accent;
      rrect(ctx, L.cx - w / 2, L.cy + D.px('hero', L) * 0.55, w, Math.max(3, D.px('hero', L) * 0.07), 4); ctx.fill();
      ctx.textAlign = 'center';
      D.type(ctx, 'hero', L);
      kineticLine(ctx, 'Motion Studio', L.cx, L.cy - D.px('hero', L) * 0.42, lt, { feel: D.feel('type'), stagger: D.stagger, align: 'center', color: D.c.ink });
  } },
  { from: 1.8, to: 4.3, draw(ctx, lt, L, p, t) {
      drift(ctx, t, L, spring(lt, ...D.feel('containers')));
  } },
  { from: 4.0, to: 6.05, draw(ctx, lt, L, p, t) {
      // the payoff line lands while the circle keeps drifting; nothing freezes before the end
      drift(ctx, t, L, 1);
      ctx.textAlign = 'center';
      D.type(ctx, 'title', L);
      kineticLine(ctx, 'one request, one piece', L.cx, L.cy + L.u * 17, t - 4.05, { feel: D.feel('type'), stagger: D.stagger, align: 'center', color: D.c.muted });
  } },
];

film({
  async setup(L, c) { cfg = c; D = await loadDesign(); },
  draw(ctx, t, L) {
    ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H);
    playScenes(scenes, ctx, t, L);
    // the through-line: a timeline edge that fills across the whole ident
    const w = L.safe.w * clamp(t / cfg.duration, 0, 1);
    ctx.fillStyle = D.c.accent; ctx.globalAlpha = 0.85;
    ctx.fillRect(L.safe.x, L.H - L.u * 0.5, w, L.u * 0.5);
    ctx.globalAlpha = 1;
  },
});
</script>
</body>
</html>
`;
const IDENT_SCRIPT = '# The ident\n\n# scene s01: the line\n[s01.1] One request, one piece, every part in sync.\n';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const KEYS = ['verify-p-single-x', 'verify-p-single-x-c01', 'verify-p-single-e', 'verify-p-single-e-c01', 'verify-p-single-m', 'verify-p-single-m-c01'];
  const rm = () => { for (const k of KEYS) rmSync(join(FILMS, k), { recursive: true, force: true }); };
  rm();
  try {
    const P = await import('../../kinds/project/index.mjs');
    const L = await import('../../produce/ledger.mjs');

    /** plan + requirements + segment-link for one wrapper (the shared wrapper flow). */
    const wrap = async (projKey, childKey, request, plan, rows) => {
      const dir = join(FILMS, projKey);
      let r = sh(['project', 'new', projKey, request, '--formats', '16:9']);
      need(r.code === 0, `${projKey}: project new failed: ${r.err.slice(0, 160)}`);
      need(readFileSync(join(dir, 'brief.md'), 'utf8').includes(request), `${projKey}: brief.md lost the request verbatim`);
      writeJson(join(dir, 'plan.json'), plan);
      r = sh(['project', 'plan', projKey, '--check']);
      need(r.code === 0 && /plan: VALID/.test(r.out), `${projKey}: plan --check: ${r.out.slice(0, 140)}`);
      const added = await L.addRequirements(projKey, rows, { source: 'request' });
      need(added.length === rows.length, `${projKey}: only ${added.length}/${rows.length} requirement(s) appended`);
      const seg = await P.segment(projKey, plan.segments[0]);    // link + build (draft + gates)
      need(seg.key === childKey, `${projKey}: segment resolved to films/${seg.key}`);
      need(readJson(join(FILMS, childKey, 'film.json'), {}).parent === projKey, `${projKey}: the child does not list its parent`);
      return seg;
    };

    /** ship + the byte-identity contract + standalone verify. */
    const shipIt = async (projKey, childKey, { captions = false } = {}) => {
      const dir = join(FILMS, projKey), cdir = join(FILMS, childKey);
      let r = sh(['project', 'ship', projKey], 30 * 60 * 1000);
      need(r.code === 0, `${projKey}: ship failed:\n${(r.err || r.out).split('\n').slice(-5).join('\n')}`);
      if (r.code !== 0) return '(ship failed)';   // the needs above already said why; never throw past here
      need(/project verify: green/.test(r.out), `${projKey}: ship did not verify green first`);
      const fin = join(dir, 'out', 'final-16x9.mp4'), cfin = join(cdir, 'out', 'final-16x9.mp4');
      need(existsSync(fin) && existsSync(cfin) && md5(fin) === md5(cfin),
        `${projKey}: the project's final is not byte-identical to the child's (md5 ${existsSync(fin) ? md5(fin).slice(0, 8) : '??'} vs ${existsSync(cfin) ? md5(cfin).slice(0, 8) : '??'})`);
      if (captions) {
        for (const cap of ['captions.srt', 'captions.vtt'])
          need(existsSync(join(dir, 'out', cap)) && md5(join(dir, 'out', cap)) === md5(join(cdir, 'out', cap)),
            `${projKey}: ${cap} was not copied byte-identical from the child`);
      }
      const poster = join(dir, 'out', 'poster-16x9.png');
      need(existsSync(poster) && statSync(poster).size > 1000 && readFileSync(poster).slice(1, 4).toString() === 'PNG',
        `${projKey}: ship published no poster still from the final`);
      for (const f of ['credits.md', 'report.md'])
        need(existsSync(join(dir, 'out', f)) && statSync(join(dir, 'out', f)).size > 200, `${projKey}: ship wrote no out/${f}`);
      need(P.stateOf(projKey).phase === 'shipped', `${projKey}: state phase is ${P.stateOf(projKey).phase} (want shipped)`);
      r = sh(['project', 'verify', projKey]);
      need(r.code === 0 && /VERIFY GREEN/.test(r.out), `${projKey}: standalone verify: ${r.out.split('\n').slice(-2).join(' | ')}`);
      return md5(fin);
    };

    // ── X: the motion wrapper — a 6s ident that animates, voice + captions ─────────────────────
    {
      const proj = 'verify-p-single-x', child = 'verify-p-single-x-c01';
      const REQUEST = 'A 6-second animated studio ident, widescreen, with voice and captions.';
      let r = sh(['new', child, '--duration', '6', '--formats', '16:9']);
      need(r.code === 0, `motion child new failed: ${r.err.slice(0, 160)}`);
      writeFileSync(join(FILMS, child, 'index.html'), IDENT_HTML);
      writeFileSync(join(FILMS, child, 'script.md'), IDENT_SCRIPT);
      const plan = {
        version: 1,
        goal: 'A viewer instantly knows this is Motion Studio and feels that any request becomes one synced piece.',
        audience: 'potential clients meeting the studio mark at the top of a reel',
        assumptions: ['the request means a drawn, voiced ident (no borrowed footage)', 'widescreen 16:9 is the only asked format'],
        deliverables: [{ type: 'video', name: 'ident', formats: ['16:9'], duration: 6 }, { type: 'captions', name: 'captions' }],
        decision: {
          chosen: 'motion',
          why: 'A 6-second brand ident is the motion technique\'s home turf: drawn in code, beat-locked, sound and picture from one timeline.',
          risky: false,
          alternatives: [
            { id: 'math', rejected_because: 'there is nothing to teach or prove; a typeset ident would be slower to build and slower to watch' },
            { id: 'simplest: a static logo card', rejected_because: 'a still cannot carry motion or sound, and the ask says animated with voice' },
          ],
          probes: [],
        },
        segments: [{
          id: 's01', capability: 'motion', role: 'the whole ident',
          brief: 'The mark springs in, one line lands, and the ident resolves inside six seconds without a dead frame.',
          duration: 6, inputs: [], film: child,
          acceptance: ['the child film\'s gates PASS (something moves in every 1.5s window)', 'the final is 16:9 with sound at the studio mix level'],
        }],
        assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'one mix at -14 LUFS' },
        feasibility: { blocked_inputs: [], needs_capability: [] },
        budget: { minutes: 180, usd: 0 },
        risks: ['a 6s ident must stay honest: everything drawn in code, no stock motion'],
      };
      const seg = await wrap(proj, child, REQUEST, plan, [
        { text: 'the ident runs 6 seconds', type: 'measurable', verifier: 'duration', arg: 6, tolerance: 1 },
        { text: 'the ident is widescreen 16:9', type: 'measurable', verifier: 'formats', arg: ['16:9'] },
        { text: 'the ident has sound (not silent)', type: 'measurable', verifier: 'has-audio', arg: true },
        { text: 'the ident ships captions', type: 'measurable', verifier: 'captions', arg: true },
      ]);
      need(seg.status === 'done', `motion wrapper: the segment build did not land done (${seg.status}: ${seg.failed || seg.error || '?'})`);
      r = sh(['sound', child], 20 * 60 * 1000);
      need(r.code === 0 && existsSync(join(FILMS, child, 'out', 'mix.wav')), `motion child sound failed: ${r.err.slice(0, 160)}`);
      const { exportCaptions } = await import('../../math-captions.mjs');
      need(exportCaptions(child).cues >= 1, 'the ident\'s narration wrote no caption cues');
      r = sh(['render', child, '--fmt', '16:9'], 30 * 60 * 1000);
      need(r.code === 0 && existsSync(join(FILMS, child, 'out', 'final-16x9.mp4')), `motion child final render failed: ${r.err.slice(0, 160)}`);
      r = sh(['gate', child], 15 * 60 * 1000);
      need(r.code === 0, `the motion child's gates FAIL: ${r.out.match(/FAIL[^\n]*/g)?.join(' | ').slice(0, 200)}`);
      const md = await shipIt(proj, child, { captions: true });
      facts.push(`motion wrapper: 6s ident, gates PASS, shipped byte-identical (md5 ${md.slice(0, 8)}…), verify exit 0`);
    }

    // ── E: the edit wrapper — the NASA talking-head fixture, one measured 3s clip ──────────────
    {
      const proj = 'verify-p-single-e', child = 'verify-p-single-e-c01';
      const REQUEST = 'Cut a 3-second teaser from my talking-head clip, widescreen.';
      // the moving window, measured: freezedetect over the source, first 3s window with no >=1s
      // frozen run inside (else the least-frozen one) — a teaser cut from footage that moves
      const src = fixturePath('real-talking-head');
      const probe = spawnSync('ffmpeg', ['-v', 'info', '-i', src, '-vf', 'freezedetect=n=0.003:d=1', '-f', 'null', '-'], { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 16 << 20 });
      const e = probe.stderr || '';
      const starts = [...e.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
      const ends = [...e.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
      const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(e);
      const dur = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : 0;
      const frozen = starts.map((s, i) => [s, ends[i] ?? s + 1]);
      let best = { w: 0, ov: Infinity };
      for (let w = 0; w + 3 <= dur + 1e-9; w += 0.25) {
        const ov = frozen.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, w + 3) - Math.max(a, w)), 0);
        if (ov < best.ov) best = { w, ov };
        if (best.ov === 0) break;
      }
      need(dur > 10, `the talking-head fixture did not probe (${dur}s) — is it built? (studio fixtures real-talking-head)`);
      const srcStart = Math.round(best.w * 30);   // the edit grid is 30fps; 90 frames = one 3s clip
      const { cutEdit } = await import('../../verify/_editslice.mjs');
      const { film } = await cutEdit(child, 'real-talking-head', { cuts: 1, cutLen: 90, gap: 0, srcStart, fps: 30, log: () => {} });
      const D = +film.cfg.duration.toFixed(3);
      need(Math.abs(D - 3) < 0.05, `the edit child's timeline is ${D}s (want one 3s clip)`);
      const plan = {
        version: 1,
        goal: 'A viewer gets the speaker\'s point in one tight widescreen teaser cut from real footage.',
        audience: 'the requester\'s audience on widescreen platforms',
        assumptions: ['the ask is a 3-second teaser, not the full interview', 'the clip is the human\'s own footage (recorded fixture here, public domain)'],
        deliverables: [{ type: 'video', name: 'teaser', formats: ['16:9'], duration: D }],
        decision: {
          chosen: 'edit',
          why: 'The ask is a cut of real footage — the edit technique exists for exactly that: frame-exact cuts, a dialog bus, word-accurate captions when wanted.',
          risky: false,
          alternatives: [
            { id: 'motion', rejected_because: 'code-drawn film cannot use the real clip; redrawing a talking head would be a parody, not a teaser' },
            { id: 'simplest: hand the raw clip over', rejected_because: 'no cut, no mix, no widescreen deliverable — the ask says a teaser' },
          ],
          probes: [],
        },
        segments: [{
          id: 's01', capability: 'edit', role: 'the teaser',
          brief: 'One three-second beat of the speaker, cut frame-exact with the dialog bus under it.',
          duration: D, inputs: [], film: child,
          acceptance: ['the timeline is exactly one 3s clip of the moving part of the source', 'the edit gates PASS (frame-exact, in sync)'],
        }],
        assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'the dialog bus over a ducked bed at -14 LUFS' },
        feasibility: { blocked_inputs: [], needs_capability: [] },
        budget: { minutes: 180, usd: 0 },
        risks: ['the source is 30000/1001 VFR-ish webm — the conform handles it, the edit grid stays 30'],
      };
      const seg = await wrap(proj, child, REQUEST, plan, [
        { text: `the teaser runs ${D} seconds`, type: 'measurable', verifier: 'duration', arg: D, tolerance: 1 },
        { text: 'the teaser is widescreen 16:9', type: 'measurable', verifier: 'formats', arg: ['16:9'] },
        { text: 'the teaser keeps the speaker\'s audio (not silent)', type: 'measurable', verifier: 'has-audio', arg: true },
      ]);
      need(seg.status === 'done', `edit wrapper: the segment build did not land done (${seg.status}: ${seg.failed || seg.error || '?'})`);
      let r = sh(['sound', child], 20 * 60 * 1000);
      need(r.code === 0 && existsSync(join(FILMS, child, 'out', 'mix.wav')), `edit child sound failed: ${r.err.slice(0, 200)}`);
      r = sh(['render', child, '--fmt', '16:9'], 30 * 60 * 1000);
      need(r.code === 0 && existsSync(join(FILMS, child, 'out', 'final-16x9.mp4')), `edit child final render failed: ${r.err.slice(0, 200)}`);
      r = sh(['gate', child], 15 * 60 * 1000);
      need(r.code === 0, `the edit child's gates FAIL: ${r.out.match(/FAIL[^\n]*/g)?.join(' | ').slice(0, 200)}`);
      const md = await shipIt(proj, child);
      facts.push(`edit wrapper: ${D}s teaser (window ${best.w.toFixed(2)}s, ${frozen.length} freeze run(s) mapped), gates PASS, shipped byte-identical (md5 ${md.slice(0, 8)}…), verify exit 0`);
    }

    // ── M: the math wrapper — the 3-scene starter scaffold, voice + 16:9 final (the heavy one) ──
    {
      const proj = 'verify-p-single-m', child = 'verify-p-single-m-c01';
      const REQUEST = 'Explain what a determinant does in a short narrated film, widescreen, with captions.';
      let r = sh(['new', child, '--math', '--formats', '16:9']);
      need(r.code === 0, `math child new failed: ${r.err.slice(0, 160)}`);
      r = sh(['sound', child], 20 * 60 * 1000);
      need(r.code === 0, `math child sound failed: ${r.err.slice(0, 200)}`);
      need(existsSync(join(FILMS, child, 'timing.json')) && existsSync(join(FILMS, child, 'out', 'mix.wav'))
        && existsSync(join(FILMS, child, 'out', 'captions.srt')), 'the math child\'s narration did not land timing + mix + captions');
      await waitManim();
      r = sh(['render', child, '--draft'], 40 * 60 * 1000);
      need(r.code === 0, `math child draft render failed: ${(r.err || r.out).split('\n').slice(-4).join(' | ').slice(0, 300)}`);
      const D = +(readJson(join(FILMS, child, 'film.json'), {}).duration ?? 0);
      need(D > 10, `the math child's film.json duration is ${D}s (the draft render should have derived it)`);
      const plan = {
        version: 1,
        goal: 'A viewer can say what a determinant does and why ad minus bc is the area scale factor.',
        audience: 'curious adults with no math background',
        assumptions: ['the request means a narrated explainer (it says "explain… narrated")', 'widescreen 16:9 is the only asked format'],
        deliverables: [{ type: 'video', name: 'explainer', formats: ['16:9'], duration: D }, { type: 'captions', name: 'captions' }],
        decision: {
          chosen: 'math',
          why: 'The ask is a narrated explanation with on-screen numbers that must be true — the math technique verifies every claim it shows while it typesets the proof.',
          risky: false,
          alternatives: [
            { id: 'motion', rejected_because: 'code-drawn type cannot verify a claim; the numbers would be decoration, not proof' },
            { id: 'simplest: a static diagram with text', rejected_because: 'no narration, no animation of the area argument, no captions' },
          ],
          probes: [],
        },
        segments: [{
          id: 's01', capability: 'math', role: 'the whole explainer',
          brief: 'Ask the question over the moving unit square, land the formula with a worked example, recap the takeaway.',
          duration: D, inputs: [], film: child,
          acceptance: ['every on-screen number is a registered, verified claim', 'narration and animation stay in sync (the sync gate)'],
        }],
        assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'the narration bus at -16 LUFS' },
        feasibility: { blocked_inputs: [], needs_capability: [] },
        budget: { minutes: 180, usd: 0 },
        risks: ['typesetting needs the manim venv (the first install is slow; the doctor probes it)'],
      };
      const seg = await wrap(proj, child, REQUEST, plan, [
        { text: `the explainer runs ${D} seconds`, type: 'measurable', verifier: 'duration', arg: D, tolerance: 2 },
        { text: 'the explainer is widescreen 16:9', type: 'measurable', verifier: 'formats', arg: ['16:9'] },
        { text: 'the explainer has narration (not silent)', type: 'measurable', verifier: 'has-audio', arg: true },
        { text: 'the explainer ships captions', type: 'measurable', verifier: 'captions', arg: true },
        { text: 'the mix sits at the film\'s -16 LUFS', type: 'measurable', verifier: 'loudness', arg: -16 },
      ]);
      need(seg.status === 'done', `math wrapper: the segment build did not land done (${seg.status}: ${seg.failed || seg.error || '?'})`);
      await waitManim();
      r = sh(['render', child, '--fmt', '16:9'], 60 * 60 * 1000);
      need(r.code === 0, `math child final render failed: ${(r.err || r.out).split('\n').slice(-4).join(' | ').slice(0, 300)}`);
      r = sh(['gate', child], 30 * 60 * 1000);
      need(r.code === 0, `the math child's gates FAIL: ${r.out.match(/FAIL[^\n]*/g)?.join(' | ').slice(0, 200)}`);
      const md = await shipIt(proj, child, { captions: true });
      // the chained where: a note on the final resolves through the segment to the child's own
      // where — scene + sentence (the motion child has no where; this one must chain)
      r = sh(['project', 'where', proj, '--t', '2']);
      need(r.code === 0 && /scene s\d+/.test(r.out) && /s\d+\.\d+/.test(r.out),
        `the math wrapper's where did not chain to a scene/sentence: ${r.out.split('\n').slice(0, 3).join(' | ')}`);
      facts.push(`math wrapper: ${D}s starter (voice + draft + 16:9 final), gates PASS, shipped byte-identical (md5 ${md.slice(0, 8)}…), verify exit 0, where chains to scene/sentence`);
    }
  } finally {
    rm();
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
