// assemble (P3, slow): K8's contract on a REAL composite — one motion, one edit and one math
// child (each built honestly: the motion child animates through every frame, the edit child is
// the NASA talking-head fixture cut to its least-frozen 3 s, the math child is a fresh 2-beat
// scene with verified claims), assembled into one piece in 16:9 AND 9:16 through every leg the
// plan can name (direct: stream copy; xfade: the designed transitions; edit-film: the default),
// then MEASURED on the actual files: exact geometry per format, yuv420p/bt709/SAR 1:1/faststart,
// duration = the segments' sum minus the transition overlaps within one frame, A/V within one
// frame, loudness at mix.lufs with true peak <= -1 dBTP, no black or frozen frame at any join
// (blackdetect/freezedetect over the cut windows), each segment's frames within PSNR >= 40 dB of
// its own final (the xfade leg's honest figure: the PURE windows >= 40 — a crossfade frame is a
// new picture by design, ADR-003), the project's palette + fonts present in every child's
// design.json, state 'assembled' with both formats' finals in out/, and a re-assemble that is
// byte-identical (determinism). The fixture ends with `studio project verify` GREEN — the
// assembled deliverable passes the ledger's measured verifiers end to end.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { fixturePath } from '../../fixtures.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { parseFps } from '../../lib/frames.mjs';
import { loudness } from '../../audio.mjs';
import { run } from '../../lib/proc.mjs';

const CLI = join(ROOT, 'engine', 'cli.mjs');
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const sh = (args, timeout = 10 * 60 * 1000) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const sleep = (ms) => new Promise((ok) => { setTimeout(ok, ms); });

// ONE Manim render at a time (house rule): pgrep (bracketed, so this line never matches itself)
// before any math-film render; wait up to 3x120s, then refuse loudly.
const manimBusy = () => spawnSync('pgrep', ['-f', '[m]anim render']).status === 0;
async function waitManim() {
  for (let i = 0; i < 3 && manimBusy(); i++) {
    console.log(`  assemble: another manim render is running — waiting 120s (${i + 1}/3)`);
    await sleep(120 * 1000);
  }
  if (manimBusy()) throw new Error('a manim render is still running after 3x120s — one Manim render at a time (retry when the box is idle)');
}

const KEY = 'verify-p-asm';
const S01 = `${KEY}-s01`, S02 = `${KEY}-s02`, S03 = `${KEY}-s03`;   // motion, edit, math
const RM = () => { for (const f of readdirSync(FILMS)) if (f.startsWith(KEY)) rmSync(join(FILMS, f), { recursive: true, force: true }); };

// ── the fixtures ──────────────────────────────────────────────────────────────────────────────
// The motion child: one circle that never stops moving (the tools check's vocabulary — the
// scaffold template holds still from 4 s and fails its dead-time gate; this animates through all
// six seconds so the gates pass honestly, in the project's inherited palette via design.json).
const MOTION_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>drift</title>
<link rel="stylesheet" href="/engine/lib/fonts.css">
</head>
<body>
<script type="module">
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import { spring, clamp, pulse } from '/engine/lib/motion.js';
let D, cfg;
film({
  async setup(L, c) { cfg = c; D = await loadDesign(); },
  draw(ctx, t, L) {
    ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H);
    const alive = spring(Math.min(t / 1.1, 1), ...D.feel('ui'));
    const x = L.cx + L.u * 26 * Math.sin(t * 0.75 + 0.4);
    const y = L.cy - L.u * 2 + L.u * 13 * Math.sin(t * 1.25 + 1.1);
    const r = L.u * 7.5 * (0.62 + 0.38 * alive) * (1 + 0.05 * pulse(t, cfg.beats || []));
    ctx.globalAlpha = 0.25 + 0.75 * alive;
    ctx.fillStyle = D.c.accent; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const a = t * 2.1;
    ctx.fillStyle = D.c.ink;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55, L.u * 1.5, 0, Math.PI * 2); ctx.fill();
    const late = spring(clamp((t - 3.6) / 1.2, 0, 1), ...D.feel('containers'));
    if (late > 0) {
      const b = t * -1.4 + 0.8;
      ctx.globalAlpha = 0.2 + 0.8 * late;
      ctx.fillStyle = D.c.muted ?? D.c.ink;
      ctx.beginPath(); ctx.arc(x + Math.cos(b) * r * 2.6, y + Math.sin(b) * r * 2.6, L.u * 2.2 * (0.5 + 0.5 * late), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const w = L.safe.w * clamp(t / cfg.duration, 0, 1);
    ctx.fillStyle = D.c.accent; ctx.globalAlpha = 0.85;
    ctx.fillRect(L.safe.x, L.H - L.u * 0.5, w, L.u * 0.5); ctx.globalAlpha = 1;
  },
});
</script>
</body>
</html>
`;

// The math child: a fresh 2-beat scene (the moving image, then the typeset formula with a worked
// example) — every on-screen number a registered, verified claim; sized from L in both axes so it
// fits 16:9 and 9:16 natively (the child renders both formats itself; assembly never crops it).
const MATH_SCENE = `from manim import DOWN, Create, FadeOut, NumberPlane, Polygon, Square, Transform, VGroup, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, color_for
from studio_manim.kit import into


class Scene(StudioScene):
    """s01_area — the moving image, then the formula: how much a matrix changes area."""

    scene_id = "s01_area"

    def construct(self):
        plane = NumberPlane(
            x_range=[-4.5, 4.5, 1], y_range=[-2.75, 2.75, 1],
            x_length=L.stage.w * 0.95, y_length=L.stage.h * 0.62,
            background_line_style={"stroke_width": 1, "stroke_opacity": 0.45},
        )
        plane.move_to([L.stage.cx, L.stage.cy + L.stage.h * 0.12, 0])
        q = Txt("How much does a matrix change area?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        sq = Square(1).set_stroke(color_for("positive"), 3).set_fill(color_for("positive"), 0.25)
        sq.move_to(plane.c2p(0.5, 0.5))
        par = Polygon(
            plane.c2p(0, 0), plane.c2p(3, 1), plane.c2p(4, 3), plane.c2p(1, 2),
            fill_color=color_for("area"), fill_opacity=0.30,
            stroke_color=color_for("result"), stroke_width=3,
        )
        five = Eq(r"{{\\text{area}}} \\times {{5}}", roles={"p2": "result"})
        five.next_to(par, DOWN, buff=0.45)

        A = Eq(
            r"\\det\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = {{ad}} - {{bc}}",
            roles={"p1": "positive", "p2": "negative"},
        )
        ex = Eq(r"= 3 \\cdot 2 - 1 \\cdot 1 = {{5}}", roles={"p1": "result"})
        note = Txt("five times the area", role="body")
        buff = max(0.5, L.stage.h * 0.055)
        ex.next_to(A, DOWN, buff=buff)
        note.next_to(ex, DOWN, buff=buff * 0.8)
        stack = VGroup(A, ex, note)
        into(stack, L.safe, fill=0.86)

        self.add(plane)
        with self.say("s01.1"):
            self.play(Write(q), run_time=1.2)
            self.play(Create(sq), run_time=self.until("square"))
        with self.say("s01.2"):
            self.play(Transform(sq, par), run_time=self.until("stretch"))
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale", says="s01.2")
        with self.say("s01.3"):
            self.play(FadeOut(plane, sq, q), run_time=0.5)
            self.play(Write(A), run_time=self.until("formula"))
        with self.say("s01.4"):
            self.play(Write(ex), run_time=self.until("example"))
            claim("3 * 2 - 1 * 1 == 5", about="worked example", says="s01.4")
        with self.say("s01.5"):
            self.play(Write(note), run_time=0.8)
        self.wait(0.6)
`;
const MATH_SCRIPT = `# The area scale — the assembly fixture's math part

## scene s01_area: the question
[s01.1] How much does a matrix change area? {square}Watch the unit square.
[s01.2] This one stretches it to {stretch}five times the space.
[s01.3] For any two-by-two matrix, {formula}the determinant is ad minus bc.
[s01.4] Here: three times two, {example}minus one times one. Five.
[s01.5] Five times the area — that is what the determinant measures.
`;

// The project's design system: the TEMPLATE's grammar with a DISTINCT palette, so the
// inheritance assertion proves the children carry the PROJECT's system, not the template's.
const DESIGN = {
  direction: 'One synced piece — an ident, a real voice, one true fact — under one design system.',
  fonts: { display: 'Bricolage Grotesque', ui: 'Inter', mono: 'JetBrains Mono' },
  palette: { bg: '#101014', ink: '#f4f1ea', muted: '#8a867e', surface: '#1c1c20', accent: '#2ec1ff' },
  ladder: [
    { role: 'hero', u: 17, weight: 800, trackingEm: -0.045 },
    { role: 'title', u: 9, weight: 700, trackingEm: -0.03 },
    { role: 'body', u: 4.2, weight: 500, trackingEm: -0.01 },
    { role: 'label', u: 2.6, weight: 600, trackingEm: 0.08, case: 'upper' },
  ],
  motion: { ui: 'SNAPPY', containers: 'DEFAULT', type: 'HEAVY', character: 'PLAYFUL', stagger: 0.05 },
  devices: [{ name: 'assembly-through-line', purpose: 'a progress edge that fills across every part' }],
  reference: 'the studio template grammar only',
  banned: ['centered title on gradient', 'everything fading in', 'corner labels', 'frame borders', 'glow on UI chrome', 'particle bursts'],
};

// the copyDesign merge (engine/kinds/project/index.mjs): the pick + inheritedFrom. The link step
// runs it for films it creates; a child built AHEAD of the plan (the math child, whose draft
// measures the duration the plan needs) does not get it — reported to the lead, applied here the
// same way so the piece is one system, honestly. One guard the kind's own copyDesign lacks: a
// pick key whose SHAPE differs from the child's stays the child's (the math kind's ladder is a
// role→size map, the film/edit kinds' a size-ladder array — spreading one over the other crashes
// the math theme reader, `AttributeError: 'list' object has no attribute 'get'`, measured) — the
// same fix belongs in copyDesign for math children created through segment().
const PICK = ['palette', 'colors', 'c', 'fonts', 'type', 'ladder', 'feel', 'motion', 'devices'];
const shape = (x) => (Array.isArray(x) ? 'a' : x !== null && typeof x === 'object' ? 'o' : typeof x);
const mergeDesign = (projKey, childKey) => {
  const d = readJson(join(FILMS, projKey, 'design.json'), null);
  const child = readJson(join(FILMS, childKey, 'design.json'), null) || {};
  const merged = { ...child };
  for (const [k, v] of Object.entries(d)) {
    if (!PICK.includes(k)) continue;
    if (k in child && shape(child[k]) !== shape(v)) continue;   // the child keeps its own shape
    merged[k] = v;
  }
  writeJson(join(FILMS, childKey, 'design.json'), {
    ...merged, direction: d.direction ?? child.direction, inheritedFrom: `films/${projKey}/design.json`,
  });
};

// the plan (assembly.mode/transitions rewritten between the legs; the fixture ENDS on the default)
const planOf = (mode, transitions, d3) => ({
  version: 1,
  goal: 'A viewer meets the studio mark, hears a real voice, and leaves knowing what a determinant does.',
  audience: 'a mixed audience meeting the studio through one short synced piece',
  assumptions: ['the three parts are real children built through their own engines', 'both asked formats come from the children\'s own renders'],
  deliverables: [{ type: 'video', name: 'showreel', formats: ['16:9', '9:16'], duration: +(6 + 3 + d3).toFixed(3) }],
  decision: {
    chosen: 'composite',
    why: 'The piece asks for a code-drawn ident, a real-clip cut and a narrated proof — no single technique carries all three.',
    risky: false,
    alternatives: [
      { id: 'motion', rejected_because: 'it cannot use the real talking-head clip; the proof would be decoration, not a verified claim' },
      { id: 'simplest: three separate uploads', rejected_because: 'the ask is one piece in two formats, not three files' },
    ],
    probes: ['probes/p1-sheet.png'],
  },
  segments: [
    { id: 's01', capability: 'motion', role: 'cold open', brief: 'The circle springs in and drifts alive across six seconds, never a dead frame.', duration: 6, inputs: [], film: S01, acceptance: ['the child film\'s gates PASS (something moves in every 1.5s window)'] },
    { id: 's02', capability: 'edit', role: 'the real voice', brief: 'One three-second beat of the speaker, cut frame-exact with the dialog bus.', duration: 3, inputs: [], film: S02, acceptance: ['the timeline is exactly one 3s clip of the moving part of the source'] },
    { id: 's03', capability: 'math', role: 'the proof', brief: 'The unit square stretches to the parallelogram, then the formula lands with a worked example.', duration: d3, inputs: [], film: S03, acceptance: ['every on-screen number is a registered, verified claim'] },
  ],
  assembly: { mode, transitions, audio: 'one mix at -14 LUFS' },
  feasibility: { blocked_inputs: [], needs_capability: [] },
  budget: { minutes: 180, usd: 0 },
  risks: ['assembly is the first composite path — the check measures it end to end'],
});

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const t0 = Date.now();
  RM();
  try {
    const P = await import('../../kinds/project/index.mjs');
    const L = await import('../../produce/ledger.mjs');
    const { assemble, assemblyProbes } = await import('../../produce/assemble.mjs');

    // ── the project + the design system ─────────────────────────────────────────────────────
    await P.create(KEY, { title: 'the assembly fixture', request: 'A short showreel: the ident, a real clip, one proof. 16:9 and 9:16.', formats: ['16:9', '9:16'] });
    writeJson(join(FILMS, KEY, 'design.json'), DESIGN);

    // ── the math child first (its draft MEASURES the duration the plan needs) ────────────────
    let r = sh(['new', S03, '--math', '--formats', '16:9,9:16', '--title', 'the area scale']);
    need(r.code === 0, `math child new failed: ${r.err.slice(0, 160)}`);
    for (const f of readdirSync(join(FILMS, S03, 'scenes'))) rmSync(join(FILMS, S03, 'scenes', f), { force: true });
    writeFileSync(join(FILMS, S03, 'scenes', 's01_area.py'), MATH_SCENE);
    writeFileSync(join(FILMS, S03, 'script.md'), MATH_SCRIPT);
    const patch = (k, fn) => { const c = readJson(join(FILMS, k, 'film.json'), {}); writeJson(join(FILMS, k, 'film.json'), fn(c)); };
    patch(S03, (c) => ({ ...c, fps: 30, duration: 0 }));               // the assembly rate: 30 fps
    mergeDesign(KEY, S03);                                             // the system, before any pixel is painted
    r = sh(['sound', S03], 20 * 60 * 1000);
    need(r.code === 0 && existsSync(join(FILMS, S03, 'out', 'mix.wav')), `math child sound failed: ${r.err.slice(0, 200)}`);
    await waitManim();
    r = sh(['render', S03, '--draft'], 30 * 60 * 1000);
    need(r.code === 0, `math child draft failed: ${(r.err || r.out).split('\n').slice(-4).join(' | ').slice(0, 300)}`);
    const D3 = +(readJson(join(FILMS, S03, 'film.json'), {}).duration ?? 0);
    need(D3 >= 15, `the math child measured ${D3}s — the plan needs >= 15s to stay inside math's typical range (no plan warning)`);
    facts.push(`children: motion 6s + edit 3s + math ${D3.toFixed(3)}s (draft-derived)`);

    // the plan's probe sheet: a REAL contact sheet of the hardest moment (the math child)
    r = sh(['look', S03], 5 * 60 * 1000);
    const sheetRow = r.out.trim().split('\n').at(-1) ?? '';
    const sheet = sheetRow.split('  ')[0];
    mkdirSync(join(FILMS, KEY, 'probes'), { recursive: true });
    if (/^films\//.test(sheet) && existsSync(join(ROOT, sheet))) copyFileSync(join(ROOT, sheet), join(FILMS, KEY, 'probes', 'p1-sheet.png'));

    // ── the plan (VALID, zero warnings) + the ledger ──────────────────────────────────────
    writeJson(join(FILMS, KEY, 'plan.json'), planOf('edit-film', 'hard cuts — the parts butt at exact frame boundaries', D3));
    let pc = await P.planCheck(KEY);
    need(pc.ok, `plan: ${pc.errors.join('; ')}`);
    need(!pc.warnings.length, `plan warnings (project verify treats them as red): ${pc.warnings.join('; ')}`);
    const added = await L.addRequirements(KEY, [
      { text: `the piece runs ${(6 + 3 + D3).toFixed(1)} seconds`, type: 'measurable', verifier: 'duration', arg: +(6 + 3 + D3).toFixed(3), tolerance: 1 },
      { text: 'the piece ships 16:9 and 9:16', type: 'measurable', verifier: 'formats', arg: ['16:9', '9:16'] },
      { text: 'the mix sits at -14 LUFS', type: 'measurable', verifier: 'loudness', arg: -14 },
    ], { source: 'request' });
    need(added.length === 3, `the fixture ledger appended ${added.length}/3 rows`);

    // ── link the segments: motion + edit created BY the link (design inherited by the kind),
    //    math linked (built ahead; its design was merged above — the reported line) ──────────
    const plan = planOf('edit-film', 'hard cuts — the parts butt at exact frame boundaries', D3);
    for (const s of plan.segments) {
      const seg = await P.segment(KEY, s, { build: false });
      need(seg.key === s.film, `segment ${s.id} resolved to films/${seg.key} (want ${s.film})`);
    }
    // the children's content: the moving circle; the talking-head clip (the least-frozen 3s)
    writeFileSync(join(FILMS, S01, 'index.html'), MOTION_HTML);
    patch(S01, (c) => ({ ...c, fps: 30 }));
    {
      const src = fixturePath('real-talking-head');
      const probe = spawnSync('ffmpeg', ['-v', 'info', '-i', src, '-vf', 'freezedetect=n=0.003:d=1', '-f', 'null', '-'], { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 16 << 20 });
      const e = probe.stderr || '';
      const starts = [...e.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
      const ends = [...e.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
      const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(e);
      const dur = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : 0;
      need(dur > 10, `the talking-head fixture did not probe (${dur}s) — is it built? (studio fixtures real-talking-head)`);
      const frozen = starts.map((s, i) => [s, ends[i] ?? s + 1]);
      let best = { w: 0, ov: Infinity };
      for (let w = 0; w + 3 <= dur + 1e-9; w += 0.25) {
        const ov = frozen.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, w + 3) - Math.max(a, w)), 0);
        if (ov < best.ov) best = { w, ov };
        if (best.ov === 0) break;
      }
      const { ingestSource } = await import('../../ingest.mjs');
      const { applyOps, syncFilm } = await import('../../lib/edit-store.mjs');
      await ingestSource(S02, src, { id: 'cam', log: () => {} });
      await applyOps(S02, { op: 'add', src: 'cam', in: +best.w.toFixed(3), out: +(best.w + 3).toFixed(3), at: 0, note: 'the least-frozen 3s window' });
      syncFilm(S02);
      facts.push(`edit child: the NASA clip cut at ${best.w.toFixed(2)}s (${frozen.length} freeze run(s) mapped)`);
    }
    // the children's own sound (the motion child's synth bed; the edit child's dialog bus over the
    // ducked bed) — the segments' audio rides their finals' tracks, so the finals must carry it
    for (const k of [S01, S02]) {
      r = sh(['sound', k], 20 * 60 * 1000);
      need(r.code === 0 && existsSync(join(FILMS, k, 'out', 'mix.wav')), `${k} sound failed: ${r.err.slice(0, 160)}`);
    }
    // build them: draft + gates -> done (the honest children; one heavy render at a time)
    for (const s of plan.segments) {
      const seg = await P.segment(KEY, s, { build: true });
      need(seg.status === 'done', `segment ${s.id} did not land done (${seg.status}: ${seg.failed || seg.error || '?'})`);
      const g = readJson(join(FILMS, s.film, 'gates.json'), null);
      need(g?.pass === true, `segment ${s.id} (${s.film}) gates: ${g ? 'FAIL' : 'no gates.json'}`);
    }
    // the finals: every child renders BOTH asked formats through its own engine
    const finals = { [S01]: ['16:9', '9:16'], [S02]: ['16:9', '9:16'], [S03]: ['16:9', '9:16'] };
    for (const k of Object.keys(finals)) {
      for (const fmt of finals[k]) {
        if (k === S03) await waitManim();
        r = sh(['render', k, '--fmt', fmt], k === S03 ? 40 * 60 * 1000 : 30 * 60 * 1000);
        need(r.code === 0 && existsSync(join(FILMS, k, 'out', `final-${fmt.replace(':', 'x')}.mp4`)), `${k} final ${fmt} failed: ${r.err.slice(0, 160)}`);
      }
    }

    // ── the measurements (every number from the actual files, via the assembler's own record) ─
    const RATIO = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
    const probe = async (args) => JSON.parse((await run('ffprobe', ['-v', 'error', ...args, '-of', 'json'])).out);
    const faststart = (file) => { const b = readFileSync(file).slice(0, 1 << 16).toString('latin1'); const m = b.indexOf('moov'), d = b.indexOf('mdat'); return m > 0 && (d < 0 || m < d); };
    const psnrOf = async (file, ref, from, dur, refAt, refDur) => {
      const to = +(from + dur).toFixed(6), rTo = +(refAt + refDur).toFixed(6);
      const { err } = await run('ffmpeg', ['-nostats', '-i', file, '-i', ref, '-filter_complex',
        `[0:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[a];[1:v]trim=start=${refAt}:end=${rTo},setpts=PTS-STARTPTS[b];[a][b]psnr`, '-f', 'null', '-'], { allowFail: true });
      const m = /average:(inf|[\d.]+)/i.exec(err);
      return m ? (m[1] === 'inf' ? Infinity : +m[1]) : null;   // BOTH sides trimmed to the window: an untrimmed reference mispairs frames
    };
    const measure = async (label, floor) => {
      const rec = assemblyProbes(KEY);
      for (const f of rec.formats) {
        const fps = parseFps(f.fps), frame = fps.den / fps.num;
        const j = await probe(['-show_entries', 'stream=codec_type,width,height,pix_fmt,sample_aspect_ratio,duration,color_space,color_transfer,color_primaries:format=duration', f.file]);
        const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
        const [W, H] = RATIO[f.fmt];
        need(v.width === W && v.height === H, `${label} ${f.fmt}: ${v.width}x${v.height} != ${W}x${H}`);
        need(v.pix_fmt === 'yuv420p' && v.sample_aspect_ratio === '1:1', `${label} ${f.fmt}: ${v.pix_fmt} SAR ${v.sample_aspect_ratio}`);
        need(v.color_space === 'bt709' && v.color_transfer === 'bt709' && v.color_primaries === 'bt709', `${label} ${f.fmt}: colors ${v.color_space}/${v.color_transfer}/${v.color_primaries}`);
        need(faststart(f.file), `${label} ${f.fmt}: moov is not first (no faststart)`);
        const D = +j.format.duration;
        need(Math.abs(D - f.expected) <= frame + 1e-9, `${label} ${f.fmt}: ${D.toFixed(3)}s vs expected ${f.expected.toFixed(3)}s (sum ${f.sum.toFixed(3)} - overlaps ${f.overlaps.toFixed(3)}) > 1 frame`);
        need(a && Math.abs(+a.duration - +v.duration) <= frame + 1e-9, `${label} ${f.fmt}: A/V ${(+v.duration).toFixed(3)}s vs ${a ? (+a.duration).toFixed(3) : 'none'}s > 1 frame`);
        const l = await loudness(f.file);
        need(Math.abs(l.lufs - rec.target) <= 1 && l.truePeak <= -1, `${label} ${f.fmt}: ${l.lufs} LUFS / ${l.truePeak} dBTP (want ${rec.target} ±1 / <= -1)`);
        for (const jo of f.joins) {
          const w = { from: Math.max(0, jo.from), to: Math.min(D, jo.to) };
          const blk = (await run('ffmpeg', ['-v', 'error', '-ss', String(w.from), '-to', String(w.to), '-i', f.file, '-vf', 'blackdetect=d=0.05:pix_th=0.03', '-an', '-f', 'null', '-'], { allowFail: true })).err;
          need(!/black_start/.test(blk), `${label} ${f.fmt}: black frames at the ${jo.at}s join`);
          const frz = (await run('ffmpeg', ['-v', 'error', '-ss', String(w.from), '-to', String(w.to), '-i', f.file, '-vf', 'freezedetect=n=0.003:d=0.05', '-an', '-f', 'null', '-'], { allowFail: true })).err;
          need(!/freeze_start/.test(frz), `${label} ${f.fmt}: frozen frames at the ${jo.at}s join`);
        }
        const nums = [], pures = [];
        for (const s of f.segments) {
          const whole = await psnrOf(f.file, s.ref, s.at, s.dur, s.refAt, s.dur);
          const w = s.pure ?? { from: s.at, dur: s.dur };
          const pure = s.pure ? await psnrOf(f.file, s.ref, s.pure.from, s.pure.dur, s.refAt + (s.pure.from - s.at), s.pure.dur) : whole;
          nums.push(whole === Infinity ? 'inf' : whole?.toFixed(1));
          if (pure !== null) pures.push(pure === Infinity ? 'inf' : pure.toFixed(1));
          need(!s.reframed, `${label} ${f.fmt} ${s.id}: assembled from a reframed fallback (want the child's own ${f.fmt} final)`);
          const floorTxt = floor === Infinity ? 'inf (bit-identical)' : `${floor} dB`;
          need(pure !== null && pure >= floor, `${label} ${f.fmt} ${s.id}: PSNR ${pure} < ${floorTxt} (whole-window ${whole})`);
        }
        facts.push(`${label} ${f.fmt}: ${v.width}x${v.height} yuv420p bt709 SAR 1:1 faststart, ${D.toFixed(3)}s (expected ${f.expected.toFixed(3)}), A/V ${Math.abs(+a.duration - +v.duration) * 1000 < 1 ? '<1ms' : (Math.abs(+a.duration - +v.duration) * 1000).toFixed(0) + 'ms'}, ${l.lufs} LUFS / ${l.truePeak} dBTP, ${f.joins.length} joins clean, PSNR ${nums.join('/')} dB${pures.length && pures.join('/') !== nums.join('/') ? ` (pure ${pures.join('/')})` : ''}`);
      }
      return assemblyProbes(KEY);
    };

    // ── leg 1: mode 'direct' (the measured-better hard-cut path: zero encodes, PSNR inf) ────
    writeJson(join(FILMS, KEY, 'plan.json'), planOf('direct', 'hard cuts', D3));
    let t = Date.now();
    let a1 = await assemble(KEY, { fmts: ['16:9'] });
    const tDirect = ((Date.now() - t) / 1000).toFixed(1);
    need(a1.formats[0].leg === 'direct', `mode direct did not take the concat leg (${a1.formats[0].leg})`);
    await measure('direct', Infinity);
    facts.push(`direct leg: ${tDirect}s, stream copy (0 re-encodes) — every segment's PSNR is inf (bit-identical packets)`);

    // ── leg 2: transitions (the xfade leg: one encode, designed joins) ─────────────────────
    writeJson(join(FILMS, KEY, 'plan.json'), planOf('edit-film', 'fade 0.3s between segments', D3));
    t = Date.now();
    await assemble(KEY, { fmts: ['16:9'] });
    const tXfade = ((Date.now() - t) / 1000).toFixed(1);
    const rec2 = await measure('xfade', 40);
    need(Math.abs(rec2.formats[0].overlaps - 0.6) < 1e-6, `xfade: overlaps ${rec2.formats[0].overlaps} (want 2 x 0.3s)`);
    facts.push(`xfade leg: ${tXfade}s, one re-encode — pure windows >= 40 dB; the whole-segment figures carry the 0.3s blends (a fade frame is a NEW picture by design, ADR-003)`);

    // ── leg 3: the default (edit-film), BOTH formats — the fixture's final state ────────────
    writeJson(join(FILMS, KEY, 'plan.json'), planOf('edit-film', 'hard cuts — the parts butt at exact frame boundaries', D3));
    t = Date.now();
    const a3 = await assemble(KEY);
    const tEdit = ((Date.now() - t) / 1000).toFixed(1);
    need(a3.formats.length === 2 && a3.formats.every((f) => f.leg === 'edit-film'), `the default leg: ${JSON.stringify(a3.formats.map((f) => [f.fmt, f.leg]))}`);
    const rec3 = await measure('edit-film', 40);
    facts.push(`edit-film leg (the default): ${tEdit}s for both formats — the ingest conform + the edit render (two encodes; PSNR measured above, >= 40 asserted)`);

    // determinism: same inputs -> same bytes (the edit render's own checks prove it; this pins it
    // on the assembled deliverable — the idempotent edit + the segment cache make it fast)
    const before = md5(join(FILMS, KEY, 'out', 'final-16x9.mp4'));
    t = Date.now();
    await assemble(KEY, { fmts: ['16:9'] });
    const after = md5(join(FILMS, KEY, 'out', 'final-16x9.mp4'));
    need(before === after, `re-assembling 16:9 produced a different file (${before.slice(0, 8)} vs ${after.slice(0, 8)}) — assembly is not deterministic`);
    facts.push(`determinism: re-assemble 16:9 in ${((Date.now() - t) / 1000).toFixed(1)}s -> md5 ${after.slice(0, 8)} identical`);

    // ── the design inheritance: one system, every child ────────────────────────────────────
    const proj = readJson(join(FILMS, KEY, 'design.json'), {});
    for (const k of [S01, S02, S03]) {
      const d = readJson(join(FILMS, k, 'design.json'), {});
      need(JSON.stringify(d.palette) === JSON.stringify(proj.palette), `${k}: design.json does not carry the project's palette (${d.palette?.accent} vs ${proj.palette.accent})`);
      need(JSON.stringify(d.fonts) === JSON.stringify(proj.fonts), `${k}: design.json does not carry the project's fonts`);
      need(d.inheritedFrom === `films/${KEY}/design.json`, `${k}: design.json inheritedFrom is ${d.inheritedFrom}`);
    }
    facts.push(`design inheritance: palette #${proj.palette.accent.slice(1)} + fonts in all 3 children's design.json (inheritedFrom films/${KEY}/design.json)`);

    // ── state + deliverables + the ledger's verdict on the assembled piece ─────────────────
    need(P.stateOf(KEY).phase === 'assembled', `state phase is ${P.stateOf(KEY).phase} (want assembled)`);
    for (const f of ['16x9', '9x16']) need(existsSync(join(FILMS, KEY, 'out', `final-${f}.mp4`)) && statSync(join(FILMS, KEY, 'out', `final-${f}.mp4`)).size > 1024, `out/final-${f}.mp4 missing or empty`);
    r = sh(['project', 'verify', KEY], 10 * 60 * 1000);
    need(r.code === 0 && /VERIFY GREEN/.test(r.out), `project verify on the assembled fixture: ${r.out.split('\n').slice(-2).join(' | ')}`);
    facts.push(`studio project verify: GREEN on the assembled piece (the ledger's duration/formats/loudness rows measured on the assembled finals)`);

    // the tools/CLI surface names the assembler (project_assemble's composite branch is the
    // lead's wiring — reported; the module is the sanctioned surface this check exercises)
  } catch (e) {
    bad.push(`threw: ${String(e.message || e).split('\n').slice(0, 4).join(' | ')}`);
  } finally {
    RM();
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 600) : `${facts.join('; ')} — ${((Date.now() - t0) / 1000).toFixed(0)}s` };
};
