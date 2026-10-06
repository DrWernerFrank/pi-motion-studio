// project (P2): `studio project new/status/list/plan/verify/rebuild/ship/where` work; a run killed
// mid-build resumes from state.json without redoing finished parts; a note on the final chains
// through the segment to the child's own where; a revision appends requirements and rebuilds only
// the touched parts (counts asserted); a child lists its parent. The single-technique wrapper leg
// (one motion segment: animate the child so its gates pass HONESTLY, render the final, ship) proves
// the thin-wrapper contract: the project's final is the child's final, byte-identical, with the
// poster at 35% and the captions copied.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-p-project';
const CHILD = `${KEY}-s01`;
const CHILD2 = `${KEY}-s02`;
const CLI = join(ROOT, 'engine', 'cli.mjs');
const REQUEST = 'A 6-second animated studio ident, widescreen, with voice and captions.';

// the studio CLI, one subprocess per call (deterministic cwd, no shell between us and argv)
const sh = (args, timeout = 10 * 60 * 1000) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const rm = (...keys) => { for (const k of keys) rmSync(join(FILMS, k), { recursive: true, force: true }); };

// ── the plan: a REAL one (SCHEMAS §plan.json) — one motion segment, two alternatives including
//    the simplest thing that could work, budget, feasibility, risks ─────────────────────────────
const planOne = (film, duration, role) => ({
  version: 1,
  goal: 'A viewer instantly knows this is Motion Studio and feels that any request becomes one synced piece.',
  audience: 'potential clients meeting the studio mark at the top of a reel',
  assumptions: ['the request means a drawn, voiced ident (no borrowed footage)', 'widescreen 16:9 is the only asked format'],
  deliverables: [
    { type: 'video', name: 'ident', formats: ['16:9'], duration },
    { type: 'captions', name: 'captions' },
  ],
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
    id: 's01', capability: 'motion', role,
    brief: 'The mark springs in, one line lands, and the ident resolves inside six seconds without a dead frame.',
    duration, inputs: [], film,
    acceptance: ['the child film\'s gates PASS (something moves in every 1.5s window)', 'the final is 16:9 with sound at the studio mix level'],
  }],
  assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'one mix at -14 LUFS' },
  feasibility: { blocked_inputs: [], needs_capability: [] },
  budget: { minutes: 180, usd: 0 },
  risks: ['a 6s ident must stay honest: everything drawn in code, no stock motion'],
});

// the child's film: an ident that actually moves — every value from design.json, every move a pure
// function of t (the scaffold template holds still from 4s and its dead-time gate FAILs; this one
// animates through the whole six seconds so the gates pass honestly)
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

// the narration: one line, spoken by the S3 voice service (gives the ident its sound + captions)
const IDENT_SCRIPT = '# The ident\n\n# scene s01: the line\n[s01.1] One request, one piece, every part in sync.\n';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  rm(KEY, CHILD, CHILD2);
  try {
    const dir = join(FILMS, KEY), cdir = join(FILMS, CHILD);

    // ── a. project new: the request VERBATIM, the ledgers, status/list ─────────────────────────
    //       (with --file inputs: a ~ path and a Windows path — recordInputs must pin both by sha)
    const winPath = 'C:\\Users\\Hp\\Desktop\\pi-motion-studio\\README.md';
    const tildePath = '~/.cache/pi-motion-studio/fixtures/real/talking-head-original.webm';
    const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
    let r = sh(['project', 'new', KEY, REQUEST, '--formats', '16:9', '--file', tildePath, '--file', winPath]);
    need(r.code === 0, `project new failed: ${r.err.slice(0, 200)}`);
    need(readFileSync(join(dir, 'brief.md'), 'utf8').includes(REQUEST), 'brief.md does not carry the request VERBATIM');
    const cfg0 = readJson(join(dir, 'film.json'), {});
    need(cfg0.kind === 'project' && (cfg0.parts || []).length === 0, `film.json is not a fresh project (kind ${cfg0.kind}, parts ${cfg0.parts?.length})`);
    for (const f of ['plan.json', 'requirements.json', 'assets.json', 'facts.json', 'budget.json', 'inputs.json', 'state.json', 'log.md', 'design.json', 'brief.md'])
      need(existsSync(join(dir, f)), `films/${KEY}/${f} was not created`);
    const inputs = readJson(join(dir, 'inputs.json'), []);
    need(inputs.length === 2, `inputs.json holds ${inputs.length} row(s) (want 2: the ~ path + the Windows path)`);
    need(inputs[0]?.id === 'i1' && inputs[1]?.id === 'i2', `input ids are ${inputs.map((x) => x.id).join(',')} (want i1, i2)`);
    need(inputs[0]?.path === join(process.env.HOME, '.cache/pi-motion-studio/fixtures/real/talking-head-original.webm'),
      `the ~ path did not expand to $HOME: ${inputs[0]?.path}`);
    need(inputs[1]?.path === '/mnt/c/Users/Hp/Desktop/pi-motion-studio/README.md',
      `the Windows path did not resolve through wslpath: ${inputs[1]?.path}`);
    need(inputs[0]?.sha256 === sha(inputs[0].path) && inputs[1]?.sha256 === sha(inputs[1].path),
      'the human\'s inputs are not sha-pinned to the files on disk');
    facts.push(`new: request verbatim in brief.md, 7 ledgers, 2 inputs sha-pinned (~ + C:\\ both resolved)`);

    r = sh(['project', 'list']);
    need(r.code === 0 && r.out.includes(KEY), 'project list does not print the project');
    r = sh(['project', 'status', KEY]);
    need(r.code === 0 && /planning/.test(r.out) && /0 part\(s\)/.test(r.out), `project status says: ${r.out.split('\n')[0]}`);

    // the plan (written by the producer, as SCHEMAS says) + --check VALID
    writeJson(join(dir, 'plan.json'), planOne(CHILD, 6, 'the whole ident'));
    r = sh(['project', 'plan', KEY, '--check']);
    need(r.code === 0 && /plan: VALID/.test(r.out), `plan --check: ${r.out.slice(0, 160)}`);

    // the module path (the project_segment tool's route): segment() creates + links the child
    const P = await import('../../kinds/project/index.mjs');
    const seg = await P.segment(KEY, readJson(join(dir, 'plan.json')).segments[0], { build: false });
    need(seg.key === CHILD && existsSync(cdir), `segment() did not create films/${CHILD}`);
    need(readJson(join(cdir, 'film.json'), {}).parent === KEY, 'the child does not list its parent');
    const dChild = readJson(join(cdir, 'design.json'), {});
    need(dChild.inheritedFrom === `films/${KEY}/design.json`, `the child design's inheritedFrom is ${dChild.inheritedFrom}`);
    need(JSON.stringify(dChild.palette) === JSON.stringify(readJson(join(dir, 'design.json'), {}).palette),
      'the child design does not carry the project\'s palette');
    need((readJson(join(dir, 'film.json'), {}).parts || []).includes(CHILD), 'parts does not list the child');
    need(P.stateOf(KEY).segments.s01?.film === CHILD, 'state.json does not carry the segment');
    facts.push('plan VALID (1 motion segment, 2 alternatives incl. the simplest); segment() linked the child (parent + palette inherited + parts + state)');

    // the requirements (via the ledger module — formats/has-audio/captions carry non-numeric args)
    const L = await import('../../produce/ledger.mjs');
    await L.addRequirements(KEY, [
      { text: 'the ident runs 6 seconds', type: 'measurable', verifier: 'duration', arg: 6, tolerance: 1 },
      { text: 'the ident is widescreen 16:9', type: 'measurable', verifier: 'formats', arg: ['16:9'] },
      { text: 'the ident has sound (not silent)', type: 'measurable', verifier: 'has-audio', arg: true },
      { text: 'the ident ships captions', type: 'measurable', verifier: 'captions', arg: true },
    ], { source: 'request' });

    // ── b. a killed run resumes: s01 seeded done, s02 not created -> rebuild skips s01 ───────────
    writeFileSync(join(cdir, 'marker.txt'), 'finished in a previous run\n');   // the untouched-part probe
    const st = P.stateOf(KEY);
    st.segments.s01.status = 'done';                                     // what a killed run leaves behind
    writeJson(join(dir, 'state.json'), st);
    const two = structuredClone(readJson(join(dir, 'plan.json'), {}));
    two.deliverables[0].duration = 12;
    two.assembly = { mode: 'edit-film', transitions: 'a designed join, no black frames', audio: 'one mix at -14 LUFS' };
    two.segments.push({ ...two.segments[0], id: 's02', film: CHILD2, role: 'the tail card',
      brief: 'A second card carries the end mark so the piece can breathe past the ident.' });
    writeJson(join(dir, 'plan.json'), two);
    r = sh(['project', 'rebuild', KEY], 15 * 60 * 1000);
    need(r.code === 0, `rebuild failed: ${r.err.slice(0, 200)}`);
    need(/1 part\(s\) built, 1 already done/.test(r.out) && !/2 part\(s\) built/.test(r.out),
      `the resume counts are wrong: ${(r.out.match(/rebuild: .*/) || ['(no counts)'])[0]}`);
    need(existsSync(join(cdir, 'marker.txt')) && readFileSync(join(cdir, 'marker.txt'), 'utf8').startsWith('finished'),
      'rebuild touched the already-done child (the marker is gone/changed)');
    const kids = readdirSync(FILMS).filter((k) => k.startsWith(`${KEY}-`));
    need(kids.length === 2 && kids.includes(CHILD2), `rebuild left ${kids.length} child film(s) (want exactly s01 + s02)`);
    const st2 = P.stateOf(KEY);
    need(st2.segments.s01?.status === 'done', 'rebuild re-opened the done segment');
    need(['created', 'building', 'done'].includes(st2.segments.s02?.status), 'rebuild did not record s02 in state.json');
    // the scaffold child s02 is still the static template: its gates must FAIL LOUDLY and it must
    // stay 'building' — the resume story includes an unfinished part being reported, not hidden
    need(/gates FAIL/.test(r.out) && /stays 'building'/.test(r.out), 'rebuild did not report the failing child loudly');
    need(st2.segments.s02?.status === 'building', `the failing child is '${st2.segments.s02?.status}' (want 'building')`);
    facts.push(`resume: "1 part(s) built, 1 already done", s01 untouched (marker survived), s02 gates FAIL loud -> stays 'building'`);

    // ── c. where chains: the timecode -> the segment -> the child's own where ────────────────────
    r = sh(['project', 'where', KEY, '--t', '2']);
    need(r.code === 0, `project where failed: ${r.err.slice(0, 160)}`);
    need(/segment s01 \(motion, the whole ident\) @ \+2\.00s/.test(r.out), `the segment line is: ${r.out.split('\n')[0]}`);
    need(r.out.includes(`child films/${CHILD}`), 'where does not name the child film');
    need(/its own where:/.test(r.out), 'where does not reach for the child\'s own where');
    // (the chained scene/sentence line for a MATH child is asserted in the `single` check, where a
    //  real math child exists — a motion child has no where of its own and says so)

    // ── d. a revision appends requirements + rebuilds ONLY the touched part ────────────────────
    writeFileSync(join(FILMS, CHILD2, 'marker.txt'), 'not part of this revision\n');
    r = sh(['project', 'requirement', KEY, 'add', '--text', 'revision 1: the ident still runs 6 seconds after the fix',
      '--type', 'measurable', '--verifier', 'duration', '--arg', '6', '--source', 'revision 1']);
    need(r.code === 0, `requirement add failed: ${r.err.slice(0, 160)}`);
    r = sh(['project', 'rebuild', KEY, '--only', 's01'], 15 * 60 * 1000);
    need(r.code === 0, `rebuild --only s01 failed: ${r.err.slice(0, 200)}`);
    need(/1 part\(s\) built, 0 already done \(only s01\)/.test(r.out), `the revision counts are wrong: ${(r.out.match(/rebuild: .*/) || ['(none)'])[0]}`);
    need(!r.out.includes(`-> films/${CHILD2}`), 'rebuild --only s01 also rebuilt s02');
    need(existsSync(join(FILMS, CHILD2, 'marker.txt')), 'the revision rebuilt the other child (its marker is gone)');
    const revRows = readJson(join(dir, 'requirements.json'), []).filter((x) => x.source === 'revision 1');
    need(revRows.length === 1 && revRows[0].id && /6 second/.test(revRows[0].text),
      `the revision row is missing or malformed: ${JSON.stringify(revRows)}`);
    facts.push(`revision: row ${revRows[0].id} (source "revision 1") appended; "1 part(s) built, 0 already done (only s01)"; s02 untouched`);

    // ── e. the single-technique wrapper: animate the child HONESTLY, render, ship ───────────────
    // the project returns to its one-segment plan (leg b's second segment was the killed-run
    // probe; its child is removed with it) — this is the wrapper story the ship hook serves
    const one = planOne(CHILD, 6, 'the whole ident');
    writeJson(join(dir, 'plan.json'), one);
    const filmCfg = readJson(join(dir, 'film.json'), {});
    filmCfg.parts = [CHILD];
    writeJson(join(dir, 'film.json'), filmCfg);
    const stE = P.stateOf(KEY);
    delete stE.segments.s02;
    writeJson(join(dir, 'state.json'), stE);
    rm(CHILD2);
    writeFileSync(join(cdir, 'index.html'), IDENT_HTML);
    writeFileSync(join(cdir, 'script.md'), IDENT_SCRIPT);

    // rebuild --only s01 now builds the animated child: draft + gates PASS -> state 'done'
    r = sh(['project', 'rebuild', KEY, '--only', 's01'], 15 * 60 * 1000);
    need(r.code === 0 && /gates PASS -> done/.test(r.out), `the rebuilt segment did not land done: ${r.out.split('\n').slice(-4).join(' | ')}`);
    need(P.stateOf(KEY).segments.s01?.status === 'done', 'state.json does not mark s01 done after a green build');

    // the child's own pipeline: voice + mix (S3), captions sidecar, the 16:9 FINAL (ensureFinals
    // needs final-16x9.mp4 — a draft is not a deliverable), then its gates
    r = sh(['sound', CHILD], 20 * 60 * 1000);
    need(r.code === 0 && existsSync(join(cdir, 'out', 'mix.wav')), `sound failed: ${r.err.slice(0, 200)}`);
    const { exportCaptions } = await import('../../math-captions.mjs');
    const caps = exportCaptions(CHILD);
    need(caps.cues >= 1, 'the narration wrote no caption cues');
    r = sh(['render', CHILD, '--fmt', '16:9'], 30 * 60 * 1000);
    need(r.code === 0 && existsSync(join(cdir, 'out', 'final-16x9.mp4')), `final render failed: ${r.err.slice(0, 200)}`);
    r = sh(['gate', CHILD], 15 * 60 * 1000);
    need(r.code === 0, `the animated child's gates FAIL: ${r.out.match(/FAIL[^\n]*/g)?.join(' | ').slice(0, 200)}`);

    // ship: verify -> publish (byte-identical finals + captions + poster + credits + report)
    r = sh(['project', 'ship', KEY], 30 * 60 * 1000);
    need(r.code === 0, `ship failed:\n${(r.err || r.out).split('\n').slice(-6).join('\n')}`);
    need(/project verify: green/.test(r.out), 'ship did not verify green first');
    const fin = join(dir, 'out', 'final-16x9.mp4'), cfin = join(cdir, 'out', 'final-16x9.mp4');
    need(existsSync(fin) && md5(fin) === md5(cfin), 'the project final is NOT byte-identical to the child\'s (md5 differs)');
    for (const cap of ['captions.srt', 'captions.vtt'])
      need(existsSync(join(dir, 'out', cap)) && md5(join(dir, 'out', cap)) === md5(join(cdir, 'out', cap)), `${cap} was not copied byte-identical`);
    const poster = join(dir, 'out', 'poster-16x9.png');
    need(existsSync(poster) && statSync(poster).size > 1000 && readFileSync(poster).slice(1, 4).toString() === 'PNG',
      'ship did not publish a poster still from the child\'s final');
    for (const f of ['credits.md', 'report.md']) {
      const p = join(dir, 'out', f);
      need(existsSync(p) && statSync(p).size > 200, `ship did not write out/${f}`);
    }
    need(readFileSync(join(dir, 'out', 'report.md'), 'utf8').includes('the ident runs 6 seconds'), 'report.md does not carry the ledger');
    need(P.stateOf(KEY).phase === 'shipped', `state phase is ${P.stateOf(KEY).phase} (want shipped)`);
    facts.push(`ship: verify green, final byte-identical (md5 ${md5(fin).slice(0, 8)}…), captions + poster + credits + report, phase shipped`);

    // verify standalone: exit 0, green
    r = sh(['project', 'verify', KEY]);
    need(r.code === 0 && /VERIFY GREEN/.test(r.out), `project verify after ship: ${r.out.split('\n').slice(-2).join(' | ')}`);

    // the subjective leg: a subjective ask WITHOUT critic evidence cannot pass — verify must say so
    await L.addRequirements(KEY, [{ text: 'the ident feels alive, not canned', type: 'subjective' }], { source: 'request' });
    r = sh(['project', 'verify', KEY]);
    need(r.code === 1 && /requirements red/.test(r.out) && /no critic evidence/.test(r.out),
      `a subjective row without a review round did not go red: ${r.out.split('\n').slice(-2).join(' | ')}`);
    // (this fixture carries no critic round — the row is removed again, not waived: a waiver is
    //  the human's alone, and faking a review would be worse than not having one)
    writeJson(join(dir, 'requirements.json'), readJson(join(dir, 'requirements.json'), []).filter((x) => x.type !== 'subjective'));
    r = sh(['project', 'verify', KEY]);
    need(r.code === 0, `verify after dropping the un-evidenced subjective row: ${r.out.split('\n').slice(-2).join(' | ')}`);
    facts.push('subjective leg: no critic evidence -> verify red naming it (exit 1)');

    // ── f. the child lists its parent, and project list shows the shipped project ───────────────
    need(readJson(join(cdir, 'film.json'), {}).parent === KEY, 'the shipped child lost its parent link');
    r = sh(['project', 'list']);
    const line = (r.out.split('\n').find((l) => l.startsWith(KEY)) || `(absent: ${r.out.split('\n')[0]})`);
    need(r.code === 0 && /shipped/.test(line) && /parts 1/.test(line) && /finals 1/.test(line),
      `project list does not show the shipped project: ${line}`);
    facts.push('the child lists its parent; project list shows it shipped (1 part, 1 final)');
  } finally {
    rm(KEY, CHILD, CHILD2);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
