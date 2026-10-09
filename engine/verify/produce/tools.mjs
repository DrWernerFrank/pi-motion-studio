// tools (P5): the project_* pi surface — every tool registered in project-tools.ts with a Type.Object
// schema, listed in index.ts BY_FILE (the lead owns that file; until the entry lands this row fails on
// EXACTLY 'pending lead: BY_FILE entry'), and each RUN against a fixture project. The fixture is a real
// one: project_new creates films/verify-p-tools (the request verbatim in brief.md), the check seeds a
// real minimal plan (one 6s 9:16 motion segment, mode single), project_segment creates the child from
// the plan's row, and the child is BUILT HONESTLY — a moving-circle index.html (it never stops moving,
// so the motion gates pass), the synth soundtrack, the 9:16 final — before project_check measures the
// ledger (duration/formats green with the measured numbers; the subjective row honestly cannot pass
// until a seeded producer-critic round with the 9 rubric keys 8+ and a REAL saved sheet) and
// project_ship publishes (byte-identical final, poster, credits, report, phase shipped).
//
// Loading the .ts for real follows the math tools check (engine/verify/math/tools.mjs): a byte-identical
// copy in a scratch "farm" whose engine/ and films/ are symlinks to this repo and whose node_modules
// resolves @earendil-works from pi's install — the tools register against a stub ExtensionAPI and their
// cheap paths run (project_* spawns no CLI, no render: the renders below are the fixture's own build,
// not the tools). Motion renders only (no manim: the one-render window rule never applies here).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const TOOLS = ['project_new', 'project_status', 'project_plan', 'project_segment', 'project_assemble', 'project_check', 'project_ship'];
const KEY = 'verify-p-tools';
const CHILD = `${KEY}-s01`;
const REQUEST = 'A 6-second vertical animated piece: one circle that never stops moving.';
const CLI = join(ROOT, 'engine', 'cli.mjs');

// the studio CLI, one subprocess per call (deterministic cwd, no shell between us and argv)
const sh = (args, timeout = 20 * 60 * 1000) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const rm = (...keys) => { for (const k of keys) rmSync(join(FILMS, k), { recursive: true, force: true }); };

// ── the plan: a REAL one (SCHEMAS §plan.json) — one motion segment, two alternatives including the
//    simplest thing that could work, budget, feasibility, risks — and ZERO warnings (verify treats a
//    warning as a why, so the fixture plan must be clean through validatePlanFile) ───────────────────
const PLAN = {
  version: 1,
  goal: 'A viewer watches one circle drift alive across a vertical phone frame for six seconds.',
  audience: 'the phone-scroll audience (9:16 at 1080x1920)',
  assumptions: ['the request means a code-drawn circle (no borrowed footage)', 'the studio synth bed gives the piece its sound (no narration was asked)'],
  deliverables: [{ type: 'video', name: 'loop', formats: ['9:16'], duration: 6 }],
  decision: {
    chosen: 'motion',
    why: 'A code-drawn circle on a beat grid is the motion technique\'s home turf: drawn in code, deterministic, sound from the same timeline.',
    risky: false,
    alternatives: [
      { id: 'math', rejected_because: 'there is nothing to teach or prove; a typeset circle would carry no motion of its own' },
      { id: 'simplest: a static circle on a card', rejected_because: 'a still cannot carry motion or sound, and the ask says one circle that never stops moving' },
    ],
    probes: [],
  },
  segments: [{
    id: 's01', capability: 'motion', role: 'the whole piece',
    brief: 'One circle springs in and drifts on a slow lissajous path with an orbiting dot, never a dead frame.',
    duration: 6, inputs: [], film: CHILD,
    acceptance: ['the child film\'s gates PASS (something moves in every 1.5s window)', 'the final is 9:16 with the studio soundtrack at the mix level'],
  }],
  assembly: { mode: 'single', transitions: 'none — one technique, one part', audio: 'one mix at -14 LUFS' },
  feasibility: { blocked_inputs: [], needs_capability: [] },
  budget: { minutes: 240, usd: 0 },
  risks: ['a 6s piece must stay honest: everything drawn in code, one moving circle, no stock motion'],
};

// the child's film: a circle that actually moves — it springs in, then drifts on a lissajous path with
// an orbiting dot until the last frame, over a through-line bar that fills across the whole piece (the
// scaffold template holds still from 4s and its dead-time gate FAILs; this one animates through all
// six seconds so the gates pass honestly — the same motion vocabulary as the ident fixtures)
const CIRCLE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>drift</title>
<link rel="stylesheet" href="/engine/lib/fonts.css">
</head>
<body>
<script type="module">
// One circle that never stops moving. Every value comes from design.json via D; every move is a
// pure function of t (deterministic: same t, same pixels, whatever the seek history).
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import { spring, clamp, pulse } from '/engine/lib/motion.js';

let D, cfg;

film({
  async setup(L, c) { cfg = c; D = await loadDesign(); },
  draw(ctx, t, L) {
    ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H);
    const alive = spring(Math.min(t / 1.1, 1), ...D.feel('ui'));        // springs in over the first ~1s
    const r = L.u * 8.5 * (0.65 + 0.35 * alive) * (1 + 0.06 * pulse(t, cfg.beats || []));
    const x = L.cx + L.u * 24 * Math.sin(t * 0.9 + 0.4);                // the slow drift: a big shape, always resolvable
    const y = L.cy - L.u * 2 + L.u * 14 * Math.sin(t * 1.35);
    ctx.globalAlpha = 0.25 + 0.75 * alive;
    ctx.fillStyle = D.c.accent; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const a = t * 1.9;                                                  // the orbiting dot: the heartbeat that never stops
    ctx.fillStyle = D.c.ink;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.55, y + Math.sin(a) * r * 1.55, L.u * 1.6, 0, Math.PI * 2); ctx.fill();
    const w = L.safe.w * clamp(t / cfg.duration, 0, 1);                 // the through-line: fills across the whole piece
    ctx.fillStyle = D.c.accent; ctx.globalAlpha = 0.85;
    ctx.fillRect(L.safe.x, L.H - L.u * 0.5, w, L.u * 0.5); ctx.globalAlpha = 1;
  },
});
</script>
</body>
</html>
`;

// what each description must name (its job), so a >100-char description cannot be a filler text
const JOB = {
  project_new: /create|created/i,
  project_status: /state|phase/i,
  project_plan: /plan\.json|validator/i,
  project_segment: /child film|segment/i,
  project_assemble: /assembl/i,
  project_check: /requirement|ledger/i,
  project_ship: /publish|refuses/i,
};

export default async (ctx = {}) => {
  const bad = [], facts = [], live = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const root = ctx.root || ROOT;
  const t0 = Date.now();
  const dir = join(FILMS, KEY), cdir = join(FILMS, CHILD);

  // ── 1. structural: project-tools.ts registers every tool by name with a Type.Object schema ─────
  const src = readFileSync(join(root, '.pi', 'extensions', 'motion-tools', 'project-tools.ts'), 'utf8');
  const registerCount = [...src.matchAll(/registerTool\(/g)].length;
  need(registerCount >= TOOLS.length, `project-tools.ts registers ${registerCount} tools, wanted ${TOOLS.length}`);
  for (const n of TOOLS) {
    need(new RegExp(`name:[ ]*["']${n}["']`).test(src), `project-tools.ts does not register "${n}"`);
    const at = src.indexOf(`"${n}"`);
    const block = src.slice(at, src.indexOf('registerTool', at + 20) > 0 ? src.indexOf('registerTool', at + 20) : src.length);
    need(/parameters:\s*Type\.Object/.test(block), `tool "${n}" has no Type.Object schema in its block`);
  }
  facts.push(`${TOOLS.length} tools registered by name, each with a Type.Object schema`);

  // ── 2. BY_FILE: index.ts wires project-tools.ts in (the LEAD's edit — pending until it lands) ─
  //    Until the entry exists the row fails on EXACTLY 'pending lead: BY_FILE entry'; the functional
  //    legs below do not depend on it (registration is asserted by importing project-tools.ts itself).
  const idx = readFileSync(join(root, '.pi', 'extensions', 'motion-tools', 'index.ts'), 'utf8');
  const wired = /import projectTools from ["']\.\/project-tools\.ts["']/.test(idx)
    && /\bprojectTools\(pi\)/.test(idx)
    && /PROJECT_TOOLS,\s*\[\s*["']project_new["']/.test(idx)
    && TOOLS.every((n) => new RegExp(`["']${n}["']`).test(idx));
  need(wired, 'pending lead: BY_FILE entry');
  if (wired) facts.push('index.ts wires project-tools.ts in (import + projectTools(pi) + BY_FILE with the 7 names)');

  // ── 3. load project-tools.ts for real and run every tool against a fixture project ───────────
  //    (the farm: byte-identical .ts copy, engine/ + films/ symlinked here, @earendil-works from
  //    pi's install — the math tools check's loader)
  const scope = [join(homedir(), '.pi', 'agent', 'npm', 'node_modules', '@earendil-works')].find((p) => existsSync(p));
  if (!scope) bad.push('@earendil-works (pi-ai) not found on this machine: the live-registration farm cannot run');
  else {
    const farm = join(ctx.cache || join(tmpdir(), 'verify-p-tools'), 'farm');
    rmSync(farm, { recursive: true, force: true });
    rm(KEY, CHILD);   // a clean slate (a crashed earlier run may have left the fixture)
    try {
      for (const d of [join(farm, 'node_modules'), join(farm, '.pi', 'extensions', 'motion-tools')]) mkdirSync(d, { recursive: true });
      symlinkSync(scope, join(farm, 'node_modules', '@earendil-works'), 'dir');
      symlinkSync(join(root, 'engine'), join(farm, 'engine'), 'dir');
      symlinkSync(join(root, 'films'), join(farm, 'films'), 'dir');
      const file = join(farm, '.pi', 'extensions', 'motion-tools', 'project-tools.ts');
      writeFileSync(file, src); // byte-identical copy: ROOT inside it resolves to the farm, whose engine/films point here
      const tools = [];
      (await import(pathToFileURL(file).href)).default({ registerTool: (t) => tools.push(t) });
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      for (const n of TOOLS) {
        need(!!byName[n], `live registration: "${n}" did not register (got ${tools.map((t) => t.name).join(',') || 'none'})`);
        if (byName[n]) {
          need((byName[n].description || '').length > 100, `tool "${n}" description is ${byName[n].description?.length ?? 0} chars (want > 100, teaching usage)`);
          need(JOB[n].test(byName[n].description || ''), `tool "${n}" description does not name its job`);
        }
      }
      const run = async (name, params) => {
        const r = await byName[name].execute('tools-check', params);
        return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), details: r.details };
      };

      // -- the fixture, through the tools themselves ------------------------------------------
      // project_new: the request VERBATIM, formats coerced '9:16' -> ['9:16'], minutes '240' -> 240
      const nu = await run('project_new', { key: KEY, request: REQUEST, formats: '9:16', minutes: '240' });
      need(new RegExp(`created films/${KEY} \\(project\\)`).test(nu.text), `project_new: ${nu.text.split('\n')[0]}`);
      need(readFileSync(join(dir, 'brief.md'), 'utf8').includes(REQUEST), 'project_new: brief.md does not carry the request VERBATIM');
      const cfg0 = readJson(join(dir, 'film.json'), {});
      need(cfg0.kind === 'project' && JSON.stringify(cfg0.formats) === '["9:16"]', `project_new: kind ${cfg0.kind}, formats ${JSON.stringify(cfg0.formats)} (formats must coerce '9:16' -> ["9:16"])`);
      need(cfg0.request === REQUEST, 'project_new: film.json does not carry the request verbatim');
      need(readJson(join(dir, 'budget.json'), {}).minutes === 240, `project_new: budget minutes is ${readJson(join(dir, 'budget.json'), {}).minutes} (must coerce '240' -> 240)`);
      live.push(`project_new (request verbatim in brief.md, formats ["9:16"] coerced, minutes 240 of 240)`);

      // project_plan: the empty-plan message first (the next step, not a crash), then read + check
      let pl = await run('project_plan', { film: KEY });
      need(/plan\.json is empty/.test(pl.text) && /write the plan first/.test(pl.text), `project_plan on a fresh project must say the plan is empty with the next step: ${pl.text.split('\n')[0]}`);
      writeJson(join(dir, 'plan.json'), PLAN);
      pl = await run('project_plan', { film: KEY, check: true });
      need(pl.details?.ok === true, `project_plan check:true did not validate: ${pl.text.slice(0, 200)}`);
      pl = await run('project_plan', { film: KEY });
      need(/goal:/.test(pl.text) && /decision: motion/.test(pl.text) && /simplest: a static circle/.test(pl.text)
        && /s01\s+motion\s+the whole piece\s+6s/.test(pl.text) && /assembly: single/.test(pl.text) && /budget: 240 min/.test(pl.text),
        `project_plan read-back: ${pl.text.split('\n').slice(0, 4).join(' | ')}`);
      live.push('project_plan (empty -> next step; VALID via check:true; read-back names goal, decision + alternatives, the segment, assembly, budget)');

      // the requirements (the ledger module — as the producer writes them) + one hedged fact
      const L = await import('../../produce/ledger.mjs');
      const added = await L.addRequirements(KEY, [
        { text: 'the piece runs 6 seconds', type: 'measurable', verifier: 'duration', arg: 6, tolerance: 1 },
        { text: 'the piece is vertical 9:16', type: 'measurable', verifier: 'formats', arg: ['9:16'] },
        { text: 'the circle never stops moving — the piece feels alive to the last frame', type: 'subjective' },
      ], { source: 'request' });
      need(added.length === 3, `the fixture ledger appended ${added.length}/3 rows`);
      const F = await import('../../produce/facts.mjs');
      await F.addFact(KEY, { id: 'f01', claim: 'the circle drifts for about six seconds', hedged: true, hedge: 'stated as approximate' });

      // project_segment: from the plan's row (role/brief/duration omitted -> the row supplies them),
      // the capability guard first, then the child + the parent link + the inherited design
      let rejected = null;
      try { await run('project_segment', { film: KEY, id: 's01', capability: 'math' }); } catch (e) { rejected = String(e.message || e); }
      need(/the plan says segment s01 is "motion", not "math"/.test(rejected || ''), `project_segment did not refuse a capability that contradicts the plan: ${rejected}`);
      const sg = await run('project_segment', { film: KEY, id: 's01', capability: 'motion' });
      need(new RegExp(`-> films/${CHILD}`).test(sg.text), `project_segment: ${sg.text.split('\n')[0]}`);
      need(new RegExp(`parent: ${KEY}`).test(sg.text), `project_segment does not report the parent link: ${sg.text.split('\n')[1] || ''}`);
      need(new RegExp(`design inherited: films/${KEY}/design\\.json`).test(sg.text), `project_segment does not report the inherited design: ${sg.text.split('\n')[2] || ''}`);
      need(existsSync(join(cdir, 'film.json')), `project_segment did not create films/${CHILD}`);
      need(readJson(join(cdir, 'film.json'), {}).parent === KEY, 'the child does not list its parent');
      need(readJson(join(cdir, 'film.json'), {}).duration === 6, 'the child duration did not come from the plan row (6s)');
      need(readJson(join(cdir, 'design.json'), {}).inheritedFrom === `films/${KEY}/design.json`, 'the child design does not carry inheritedFrom');
      need((readJson(join(dir, 'film.json'), {}).parts || []).includes(CHILD), 'parts does not list the child');
      live.push(`project_segment (s01 -> films/${CHILD}: parent link, design inherited, 6s from the plan row; the capability guard refused a contradicting "math")`);

      // project_status: the state before the build — the segment, the budget, the requirement counts,
      // one OPEN NOTE, and the kind guard refusing a non-project film
      writeJson(join(dir, 'notes.json'), [{ t: 2, fmt: '9:16', text: 'keep the circle moving', done: false }]);
      let st = await run('project_status', { film: KEY });
      need(/phase planning/.test(st.text), `project_status phase: ${st.text.split('\n')[0]}`);
      need(new RegExp(`s01\\s+created\\s+films/${CHILD} \\(motion\\)`).test(st.text), `project_status segments: ${(st.text.match(/segments.*\n.*/) || [''])[0]}`);
      need(/240 min/.test(st.text) && /\$0\.000 of \$0/.test(st.text), `project_status budget: ${(st.text.match(/budget.*/) || [''])[0]}`);
      need(/requirements: 3 \(0 green, 3 pending, 0 red, 0 waived\)/.test(st.text), `project_status requirement counts: ${(st.text.match(/requirements.*/) || [''])[0]}`);
      need(/OPEN NOTES/.test(st.text) && /keep the circle moving/.test(st.text), 'project_status does not surface the open note');
      need(/gates not run yet/.test(st.text), 'project_status does not report the children\'s gates');
      rmSync(join(dir, 'notes.json'), { force: true }); // the note served its assert; the fixture ships without one
      let guard = null;
      try { await run('project_status', { film: 'mathdemo' }); } catch (e) { guard = String(e.message || e); }
      need(/is kind=math, not project/.test(guard || '') && /film_status/.test(guard || ''), `project_status did not refuse a non-project film with the fix: ${guard}`);
      live.push('project_status (planning, the s01/motion segment, 0/240 min, 3 requirements pending, the open note, the kind guard on mathdemo)');

      // build the child HONESTLY: the moving circle (gates pass on their own), then the synth
      // soundtrack and the 9:16 final — the fixture's own build, not the tools' doing
      writeFileSync(join(cdir, 'index.html'), CIRCLE_HTML);
      let r = sh(['project', 'rebuild', KEY], 25 * 60 * 1000);
      need(r.code === 0 && /gates PASS -> done/.test(r.out), `rebuild did not land the segment done: ${(r.err || r.out).split('\n').slice(-3).join(' | ')}`);
      r = sh(['sound', CHILD], 20 * 60 * 1000);
      need(r.code === 0 && existsSync(join(cdir, 'out', 'mix.wav')), `sound failed: ${r.err.slice(0, 200)}`);
      r = sh(['render', CHILD, '--fmt', '9:16'], 30 * 60 * 1000);
      need(r.code === 0 && existsSync(join(cdir, 'out', 'final-9x16.mp4')), `the 9:16 final render failed: ${r.err.slice(0, 200)}`);
      r = sh(['gate', CHILD], 15 * 60 * 1000);
      need(r.code === 0, `the moving-circle child's gates FAIL: ${(r.err || r.out).match(/FAIL[^\n]*/g)?.join(' | ').slice(0, 200)}`);
      // a REAL sheet for the review round (the critic must have looked — so the fixture saves one)
      r = sh(['look', CHILD, '--mode', 'every', '--fmt', '9:16'], 5 * 60 * 1000);
      need(r.code === 0, `look failed: ${r.err.slice(0, 200)}`);
      const sheet = r.out.trim().split('\n').pop().split('  ')[0];
      need(/^films\//.test(sheet) && existsSync(join(ROOT, sheet)) && statSync(join(ROOT, sheet)).size > 1000,
        `the contact sheet the review cites is not a real saved sheet: "${sheet}"`);
      live.push(`the child built honestly (rebuild: draft + gates PASS -> done; synth soundtrack; final-9x16.mp4; gates PASS; sheet ${sheet.split('/').pop()})`);

      // project_assemble: mode single -> the child's finals copied byte-identical (never a re-encode)
      const asm = await run('project_assemble', { film: KEY });
      need(/assembly: single/.test(asm.text) && /final-9x16\.mp4/.test(asm.text), `project_assemble: ${asm.text.split('\n')[0]}`);
      need(existsSync(join(dir, 'out', 'final-9x16.mp4')), 'project_assemble copied no final into the project out/');
      need(md5(join(dir, 'out', 'final-9x16.mp4')) === md5(join(cdir, 'out', 'final-9x16.mp4')),
        `the project's final is NOT byte-identical to the child's (md5 ${md5(join(dir, 'out', 'final-9x16.mp4')).slice(0, 8)} vs ${md5(join(cdir, 'out', 'final-9x16.mp4')).slice(0, 8)})`);
      live.push(`project_assemble (single: final-9x16.mp4 copied byte-identical, md5 ${md5(join(dir, 'out', 'final-9x16.mp4')).slice(0, 8)}…)`);

      // project_check: the measurable rows green WITH the measured numbers, the subjective row
      // honestly red (no critic evidence), the facts row green, the budget held
      let chk = await run('project_check', { film: KEY });
      need(/r01 green/.test(chk.text) && /final-9x16\.mp4 6\.\d+s/.test(chk.text), `the duration row is not green with the measured number: ${(chk.text.match(/r01.*/) || [''])[0]}`);
      need(/r02 green/.test(chk.text) && /9:16 1080x1920/.test(chk.text), `the formats row is not green with the measured geometry: ${(chk.text.match(/r02.*/) || [''])[0]}`);
      need(/r03 red/.test(chk.text) && /cannot pass/.test(chk.text) && /no critic evidence/.test(chk.text), `the subjective row must be honestly red without a round: ${(chk.text.match(/r03.*/) || [''])[0]}`);
      need(/f01 green/.test(chk.text), `the facts row: ${(chk.text.match(/facts.*/) || [''])[0]}`);
      need(/budget: held/.test(chk.text), `the budget line: ${(chk.text.match(/budget.*/) || [''])[0]}`);
      need(chk.details?.green === 2 && chk.details?.red === 1, `project_check details: ${JSON.stringify(chk.details)}`);
      live.push('project_check (r01 green 6.0xs measured, r02 green 1080x1920, r03 honestly red — cannot pass without a critic round, f01 hedged green, budget held)');

      // the seeded producer-critic round: the 9 keys 8+ and the REAL saved sheet — then the
      // subjective row goes green (nothing a build can invent; the critic's evidence resolves it)
      const R = await import('../../review.mjs');
      R.addReview(KEY, {
        scores: { hook: 9, readability: 8, motion: 9, variety: 8, composition: 8, brand: 8, sound: 8, fidelity: 10, coherence: 9 },
        problems: [], reviewer: 'producer-critic', sheets: [sheet],
        notes: 'seeded by the tools check: duration and formats re-measured on the final (6.0s, 1080x1920); the sheet is the child\'s real contact sheet',
      });
      chk = await run('project_check', { film: KEY });
      need(/r03 green/.test(chk.text) && /critic round/.test(chk.text), `the subjective row did not resolve through the critic round: ${(chk.text.match(/r03.*/) || [''])[0]}`);
      need(chk.details?.green === 3 && chk.details?.red === 0, `project_check after the round: ${JSON.stringify(chk.details)}`);
      need(readJson(join(dir, 'requirements.json'), []).every((x) => x.status === 'green'), 'the measured statuses did not land in requirements.json');
      live.push('project_check after the seeded 9-key producer-critic round (r03 green through reviews.json; 3/3 rows green, statuses written)');

      // project_ship: verify green first, then publish — the final byte-identical, the poster,
      // credits + report, the state shipped
      const sp = await run('project_ship', { film: KEY });
      need(new RegExp(`shipped films/${KEY}`).test(sp.text), `project_ship: ${sp.text.split('\n')[0]}`);
      need((sp.details?.files || []).includes('final-9x16.mp4') && (sp.details?.files || []).includes('poster-9x16.png'), `project_ship files: ${JSON.stringify(sp.details?.files)}`);
      need(md5(join(dir, 'out', 'final-9x16.mp4')) === md5(join(cdir, 'out', 'final-9x16.mp4')), 'ship: the project final is no longer byte-identical to the child\'s');
      const poster = join(dir, 'out', 'poster-9x16.png');
      need(existsSync(poster) && statSync(poster).size > 1000 && readFileSync(poster).slice(1, 4).toString() === 'PNG', 'ship published no poster still from the final');
      for (const f of ['credits.md', 'report.md'])
        need(existsSync(join(dir, 'out', f)) && statSync(join(dir, 'out', f)).size > 100 && readFileSync(join(dir, 'out', f), 'utf8').includes(KEY),
          `ship wrote no real out/${f}`);
      need(readFileSync(join(dir, 'out', 'report.md'), 'utf8').includes('the circle never stops moving'), 'report.md does not carry the ledger');
      need(readJson(join(dir, 'state.json'), {}).phase === 'shipped', `state phase is ${readJson(join(dir, 'state.json'), {}).phase} (want shipped)`);
      live.push(`project_ship (verify green, final byte-identical, poster + credits + report, phase shipped)`);

      // project_status again: the shipped state, gates PASS, the finals listed
      st = await run('project_status', { film: KEY });
      need(/phase shipped/.test(st.text) && /gates PASS/.test(st.text) && /final-9x16\.mp4/.test(st.text), `project_status after ship: ${st.text.split('\n')[0]} · ${(st.text.match(/gates.*/) || [''])[0]}`);
      live.push('project_status (shipped, gates PASS, the finals listed)');

      // ── 4. the critic's tool line: producer-critic lists project_status — and it exists now ───
      const critic = readFileSync(join(root, '.pi', 'agents', 'producer-critic.md'), 'utf8');
      const toolLine = (critic.match(/^tools:\s*(.*)$/m) || [])[1] || '';
      need(/project_status/.test(toolLine), 'producer-critic.md does not list project_status in its tools line');
      need(!!byName.project_status, 'the tool producer-critic lists (project_status) is not registered');
      facts.push('producer-critic lists project_status and the tool is registered (the registration lint above)');
    } catch (e) {
      bad.push(`functional: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`);
    } finally {
      rm(KEY, CHILD);
      rmSync(farm, { recursive: true, force: true });
    }
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const ran = live.length ? `live: ${live.join(' · ')}` : 'live: none';
  return { pass: bad.length === 0, measured: `${bad.length ? 'FAIL: ' + bad.join('; ') + ' || ' : ''}${facts.join('; ')} · ${ran} [${secs}s]` };
};
