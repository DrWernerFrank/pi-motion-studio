// growth (P6, K12): the capability lifecycle, end to end, honestly. A scaffold is REFUSED with
// every stubbed part named and nothing else; the same capability implemented for real
// (verify-chart — the chart technique demo D builds on: motion-based, its data gated before
// any frame ships) is ACCEPTED, appears in studio capabilities and in the plan menu, and leaves
// the registry + catalog consistent once removed. A service scaffold records its catalog entry
// for the lead and is NOT listed until the lead adds it (two-step by design). Everything is
// cleaned up in the finally — a run killed mid-check is mopped up at the row's start.
//
// Once demo D commits its chart capability under the id "verify-chart", the row never touches
// it (removeCapability refuses tracked paths): it checks the committed one passes its own
// check and drives the scaffold->refuse->remove lifecycle on a scratch id instead — the
// contract stays proven in both worlds.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCapability, readGrown, removeCapability, scaffold } from '../../produce/growth.mjs';
import { FILMS, kindOf, readFilm, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const CHART = 'verify-chart';          // the demo-D capability id (the task's prescribed id)
const SCRATCH = 'verify-grow-cycle';   // the lifecycle's scratch id (mission end, id taken)
const FETCH = 'verify-fetcher';        // the service half
const PLAN_KEY = 'verify-p-grow-plan';
const DEMO_FILM = 'verify-p-grow-chart';
const DESC = 'animated data charts — bars, lines, rankings drawn as motion films from a chart.json data table (the numbers gated before any frame ships)';

const rel = (f) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f);
void rel;   // (kept for the row's debug prints; the asserts name paths themselves)
// import a file AS IT IS ON DISK (the growth verifier may hold an earlier scaffold of the same
// path in Node's ESM cache — the mtime+size key reads what is there NOW)
const fresh = async (f) => { const s = statSync(f); return import(pathToFileURL(f).href + '?v=' + Math.round(s.mtimeMs) + '-' + s.size); };
const cli = (args, timeout = 300000) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 16 << 20 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// the catalog ids in a FRESH process — the registry caches kinds per process, so this is the
// honest "what does the studio see right now" probe; it doubles as the validatedCatalog-ok proof
const catalogIds = () => {
  const r = spawnSync(process.execPath, ['-e',
    'const { pathToFileURL } = require("node:url"); import(pathToFileURL(process.argv[1]).href).then(async (m) => { const c = await m.validatedCatalog(); console.log("IDS " + JSON.stringify(c.map((e) => e.id + ":" + e.type))); }).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); })',
    join(ROOT, 'engine', 'produce', 'catalog.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 90000 });
  const m = /IDS (\[.*\])/.exec(r.stdout || '');
  return { code: r.status, ids: m ? JSON.parse(m[1]) : null, err: r.stderr || '' };
};

// ── the honest verify-chart implementation (written into engine/kinds/verify-chart/ by the
//    row, then removed by it — the pattern demo D's real capability follows; no backticks, so
//    it rides inside this file's template literals unescaped) ─────────────────────────────────
const CHART_INDEX = `// The verify-chart kind (K12, grown): a chart film is a MOTION film whose content is a data
// table — chart.json { data: [[x, y], …], source: "…" } — gated before any frame ships. The
// technique is motion-based: required hooks are own exports (ADR-001) and the re-exports ARE
// the inheritance declaration — render/look/sound/gate/ship are motion's (the same timeline,
// springs and beat-locked sound; motion's mechanical gates hold the film craft). create is the
// technique's own: it stamps kind "verify-chart" and writes the chart.json stub the data gate
// demands be filled (>= 1 row, a named source).
export { gate, look, render, sound, ship } from '../motion/index.mjs';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

export function create(key, { title, duration, formats, loop, bpm, data, source } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key>: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error('films/' + key + ' already exists');
  cpSync(join(ROOT, 'templates', 'film'), dir, { recursive: true });   // the motion scaffold
  const cfg = readJson(join(dir, 'film.json'));
  Object.assign(cfg, {
    kind: 'verify-chart',                            // the stamp: this film IS a chart film
    title: title ?? key, duration: duration ?? cfg.duration,
    formats: formats ?? cfg.formats, loop: loop === undefined ? !!cfg.loop : !!loop,
  });
  cfg.music.bpm = bpm ?? cfg.music.bpm;
  writeJson(join(dir, 'film.json'), cfg);
  // the technique's own data table: empty until the producer fills it — the data gate FAILs
  // (naming chart.json) until it holds >= 1 row and a source
  writeJson(join(dir, 'chart.json'), { data: Array.isArray(data) ? data : [], source: source ?? '' });
  return { dir, message: 'created films/' + key + ' (kind: verify-chart)\\n' +
    '  next: fill chart.json (data + source — the data/axis gates decide), then index.html draws it like any motion film\\n' +
    '  preview: studio gui  (or open http://localhost:3142/films/' + key + '/)' };
}

// the capability catalog entry (K2) — catalog.json is the data; the registry scan carries it
export const capability = readJson(fileURLToPath(new URL('./catalog.json', import.meta.url)));
// the doctor probe (growth contract part #3): wired here so the kind module exports it
export { doctor } from './doctor.mjs';
`;

const CHART_GATES = `// The verify-chart gates: a chart film is only as good as its DATA. One thing per gate:
//   dataGate  the film folder carries chart.json with >= 1 row AND a source (where the numbers
//             came from) — the FAIL names the file
//   axisGate  every row is a numeric pair — the FAIL names the FIRST bad row, never "some rows"
// A gate returns {name, pass, level, detail} and never throws (runGates reports a throw as a
// FAIL — a crash is not a verdict); runGates writes gates.json {at, pass, checks}.
import { join } from 'node:path';
import { readFilm, readJson, writeJson } from '../../lib/film.mjs';

const pair = (row) => Array.isArray(row) && row.length === 2 && row.every((n) => typeof n === 'number' && Number.isFinite(n));

export async function dataGate(film) {
  const chart = readJson(join(film.dir, 'chart.json'), null);
  if (!chart || typeof chart !== 'object' || Array.isArray(chart))
    return { name: 'data', pass: false, level: 'fail', detail: 'chart.json is missing — a chart film carries its data table (chart.json {data: [[x, y], …], source: "where the numbers came from"}); the create hook writes a stub to fill' };
  if (!Array.isArray(chart.data) || !chart.data.length)
    return { name: 'data', pass: false, level: 'fail', detail: 'chart.json has no data rows — a chart needs >= 1 [x, y] row before any frame ships (fill chart.json)' };
  if (typeof chart.source !== 'string' || !chart.source.trim())
    return { name: 'data', pass: false, level: 'fail', detail: 'chart.json carries no source — every number on screen must say where it came from (chart.json source: "…"; the facts ledger holds the claims)' };
  return { name: 'data', pass: true, level: 'pass', detail: 'chart.json: ' + chart.data.length + ' rows, source "' + chart.source + '"' };
}

export async function axisGate(film) {
  const chart = readJson(join(film.dir, 'chart.json'), null);
  const rows = Array.isArray(chart && chart.data) ? chart.data : [];
  if (!rows.length)
    return { name: 'axis', pass: false, level: 'fail', detail: 'chart.json has no data rows to check — the data gate names the file' };
  for (let i = 0; i < rows.length; i++)
    if (!pair(rows[i]))
      return { name: 'axis', pass: false, level: 'fail', detail: 'chart.json data[' + i + '] = ' + JSON.stringify(rows[i]) + ' is not a numeric pair — the first bad row; every row must be [number, number]' };
  return { name: 'axis', pass: true, level: 'pass', detail: rows.length + ' rows, all numeric pairs' };
}

export const GATES = [dataGate, axisGate];

export async function runGates(key, { write = true, log = console.log } = {}) {
  const film = readFilm(key);
  const checks = [];
  for (const g of GATES) {
    let r;
    try { r = await g(film); } catch (e) { r = { name: g.name, pass: false, level: 'fail', detail: 'threw: ' + ((e && e.message) || e) }; }
    checks.push(r);
    log((r.pass ? 'ok  ' : 'FAIL') + ' ' + r.name + ': ' + r.detail);
  }
  const result = { at: new Date().toISOString(), pass: checks.every((c) => c.pass), checks };
  if (write) writeJson(join(film.dir, 'gates.json'), result);
  return result;
}
`;

const CHART_CATALOG = {
  id: 'verify-chart',
  type: 'technique',
  makes: [DESC],
  strengths: [
    'the data is gated: >= 1 row, every row a numeric pair, a named source — no invented or unsourced numbers',
    "all of motion's craft: one timeline reframes to every format, springs, beat-locked sound",
    'the chart is data + design: swap chart.json and the same film re-renders',
  ],
  weak: [
    'no real footage',
    'no spreadsheet ingestion (the table is pasted into chart.json by hand)',
    "draws only what the film's index.html implements (the technique ships the gates, the film draws)",
  ],
  typical: { duration: [10, 60], formats: ['16:9', '9:16', '1:1', '4:5'] },
  needs: [], ready: 'yes',
  invoke: {
    create: 'studio new <key> (then kind: verify-chart in film.json — a project segment with capability verify-chart creates it)',
    look: 'studio look <key>',
    render: 'studio render <key> --draft',
    sound: 'studio sound <key>',
    gate: 'studio gate <key>',
    ship: 'studio ship <key>',
  },
  gates: ['data (chart.json: >= 1 row + a named source)', 'axis (every row a numeric pair — the first bad row named)'],
  tools: ['verify_chart_status', 'verify_chart_check'],
  skill: 'produce',
  critic: 'producer-critic',
};

const CHART_SKILL = `# verify-chart — charts as motion films

A chart film is a motion film whose content is a data table: chart.json carries the numbers
(data: [[x, y], …]) and where they came from (source), the film's index.html draws them with
the same springs, type ladder and beat-locked sound as any motion film, and two gates decide
done before any final ships: the data gate (>= 1 row, a named source — no unsourced numbers on
screen) and the axis gate (every row a numeric pair — the first bad row is named, never "some
rows are wrong").

Craft: the first three seconds show the SHAPE of the data — the biggest bar lands first, the
trend of the line is legible before any axis label, so a scrolling viewer gets the story before
the detail. What must survive a 360 px phone screen: the value labels (>= 3.2u, one decimal at
most — a chart that rounds on screen but not in data lies), the axis baseline, and the source
line at the end (the audience's right to know where the numbers came from). What only this
technique does: the numbers are DATA, not hand-coded pixels — swap chart.json and the same film
re-renders with new numbers, and the gates refuse a chart whose rows are not numeric pairs or
whose source is empty, so no chart ships with invented or unsourced numbers. What it cannot
do: no real footage, no spreadsheet parsing (paste the table into chart.json by hand), and the
drawing is whatever index.html implements — the technique ships the contract and the gates, the
film draws.
`;

const CHART_TOOLS = `# verify-chart tools (K12)

The tool surface this capability declares (the lead wires these into .pi/extensions — a
Type.Object schema each, same style as tools.ts, listed in index.ts BY_FILE):

- \`verify_chart_status\` — read a chart film's status: the kind, chart.json's row count + source, gates.json's verdict
- \`verify_chart_check\` — run the data/axis gates on a film and report the FAIL lines (chart.json named when absent; the first bad row named)
`;

const CHART_CHECK = `// verify-chart (K12, the grown chart technique): the technique's own check — a chart film is
// seeded with the kind's own create, both gates run GOOD and BAD, and every loud failure names
// the thing that is wrong (the absent file; the first bad row). Cheap by contract — seed +
// gates, no renders — because studio capability check runs this file on every check.
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILMS, kindOf, readFilm, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const SEED = 'verify-p-grow-chart-check';
// the growth verifier may hold an earlier scaffold of this kind in its ESM cache — the mtime
// key reads what is on disk NOW
const fresh = async (f) => { const s = statSync(f); return import(pathToFileURL(f).href + '?v=' + Math.round(s.mtimeMs) + '-' + s.size); };

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const dir = join(FILMS, SEED);
  rmSync(dir, { recursive: true, force: true });   // a leftover from a killed run never blocks the seed
  try {
    const K = await fresh(join(ROOT, 'engine', 'kinds', 'verify-chart', 'index.mjs'));
    const G = await fresh(join(ROOT, 'engine', 'kinds', 'verify-chart', 'gates.mjs'));
    const made = K.create(SEED, { title: 'growth check seed' });
    need(!!made && !!made.dir && existsSync(join(made.dir, 'chart.json')), 'create does not write the chart.json stub');
    need(kindOf(readFilm(SEED).cfg) === 'verify-chart', 'create does not stamp kind: verify-chart');

    // GOOD: three rows + a source -> both gates pass
    writeJson(join(dir, 'chart.json'), { data: [[0, 12], [1, 19], [2, 7]], source: 'the growth check seeded rows' });
    let r = await G.dataGate(readFilm(SEED));
    need(r.pass && /3 rows/.test(r.detail), 'the data gate does not pass on good data (' + r.detail + ')');
    r = await G.axisGate(readFilm(SEED));
    need(r.pass, 'the axis gate does not pass on numeric pairs (' + r.detail + ')');

    // BAD 1: chart.json absent -> the data gate FAILS NAMING THE FILE
    rmSync(join(dir, 'chart.json'));
    r = await G.dataGate(readFilm(SEED));
    need(!r.pass && /chart\\.json/.test(r.detail), 'a missing chart.json must FAIL naming the file (got: ' + r.detail + ')');

    // BAD 2: a non-numeric row -> the axis gate FAILS NAMING THE FIRST BAD ROW
    writeJson(join(dir, 'chart.json'), { data: [[0, 12], ['q1', 9], [2, 7]], source: 'the growth check seeded rows' });
    r = await G.dataGate(readFilm(SEED));
    need(r.pass, '3 rows + a source must pass the data gate (got: ' + r.detail + ')');
    r = await G.axisGate(readFilm(SEED));
    need(!r.pass && /data\\[1\\]/.test(r.detail), 'a non-numeric row must FAIL naming the first bad row (got: ' + r.detail + ')');

    // the pipeline shape: runGates runs both, writes gates.json, never throws
    let suite = await G.runGates(SEED, { log: () => {} });
    need(suite.pass === false && suite.checks && suite.checks.length === 2, 'runGates did not run both gates (' + JSON.stringify(suite.checks && suite.checks.map((c) => c.name)) + ')');
    need(existsSync(join(dir, 'gates.json')), 'runGates did not write gates.json');
    writeJson(join(dir, 'chart.json'), { data: [[0, 12], [1, 19], [2, 7]], source: 'the growth check seeded rows' });
    suite = await G.runGates(SEED, { log: () => {} });
    need(suite.pass, 'runGates must PASS on good data (' + JSON.stringify(suite.checks) + ')');
    facts.push('both gates run good/bad on a seeded chart film: the failures name chart.json / data[1]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
`;

// a seeded plan whose segment names a chart technique — what a producer writes against the menu
const GROWTH_PLAN = {
  version: 1,
  goal: 'a 30-second animated chart of the growth checks, one number landing per beat',
  audience: "the studio's humans — what the producer mission verified, in one glance",
  assumptions: ["the growth check's own numbers are the story (no external data needed)"],
  deliverables: [{ type: 'video', name: 'main', formats: ['16:9', '9:16'], duration: 30 }],
  decision: {
    chosen: CHART,
    why: 'the piece IS a chart of numbers — the chart technique draws data tables, and its data gates decide done',
    risky: false,
    alternatives: [
      { id: 'motion', rejected_because: 'a plain motion film has no data-table contract — the numbers would be hand-coded pixels' },
      { id: 'simplest: static chart image', rejected_because: 'no motion, no sound, no second format — the request asks for an animated piece' },
    ],
  },
  segments: [{
    id: 's01', capability: CHART, role: 'the whole piece',
    brief: "the growth check's own numbers as bars landing on the beat grid",
    duration: 30, inputs: [], film: PLAN_KEY + '-s01',
    acceptance: ['every number on screen comes from chart.json (the data gate)', 'every row a numeric pair (the axis gate)'],
  }],
  assembly: { mode: 'single', transitions: 'none (one segment)', audio: "the chart film's own mix at mix.lufs" },
  feasibility: { blocked_inputs: [], needs_capability: [] },
  budget: { minutes: 180, usd: 0 },
  risks: ['the chart technique is young — its gates are the safety net'],
};

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // a run killed mid-check may have left these behind — mop up first (a committed capability
  // is refused by removeCapability, so the mop-up can never touch the lead's)
  for (const id of [CHART, SCRATCH, FETCH]) { try { removeCapability(id); } catch { /* not there — clean */ } }
  for (const f of [PLAN_KEY, DEMO_FILM, CHART + '-check', 'verify-p-grow-' + CHART])
    rmSync(join(FILMS, f), { recursive: true, force: true });

  // the refuse half, shared by both worlds: every stubbed part named, nothing else
  const assertRefused = (r, what) => {
    need(!r.ok, 'capability check ACCEPTED ' + what + ' (it must refuse until the parts are real)');
    const stubbed = ['hook render', 'hook look', 'hook sound', 'hook gate', 'hook ship', 'gates', 'check file'];
    for (const p of stubbed) need(r.missing.some((m) => m.startsWith(p)), what + ': the missing parts do not name the stubbed "' + p + '" (missing: ' + r.missing.join(' | ') + ')');
    need(r.missing.length === stubbed.length, what + ': ' + r.missing.length + ' missing parts (want exactly the ' + stubbed.length + ' stubbed ones: ' + r.missing.join(' | ') + ')');
    for (const p of ['module', 'hook create', 'registry', 'catalog entry', 'doctor probe', 'TOOLS.md', 'SKILL.md'])
      need(r.present.some((m) => m.startsWith(p)), what + ': the present parts do not name "' + p + '" (present: ' + r.present.join(' | ') + ')');
  };

  // seed a project + a plan whose segment names the capability; assert it VALIDATES in a fresh
  // process (the registry's catalog is per-process — the honest plan-menu proof)
  const planMenu = async (capId) => {
    const made = cli(['project', 'new', PLAN_KEY, 'the growth check: chart the studio']);
    need(made.code === 0, 'studio project new failed: ' + made.out.split('\n').slice(-2).join(' | '));
    writeJson(join(FILMS, PLAN_KEY, 'plan.json'), {
      ...GROWTH_PLAN,
      decision: { ...GROWTH_PLAN.decision, chosen: capId },
      segments: [{ ...GROWTH_PLAN.segments[0], capability: capId }],
    });
    const r = cli(['project', 'plan', PLAN_KEY, '--check']);
    need(r.code === 0 && /plan: VALID/.test(r.out), 'a plan with a ' + capId + ' segment does not validate (' + r.out.split('\n').slice(-3).join(' | ') + ')');
  };

  try {
    // after the mop-up, an existing engine/kinds/verify-chart is COMMITMITTED (demo D's) — the
    // two worlds: grow the capability now, or check the one the mission already grew
    const committed = existsSync(join(ROOT, 'engine', 'kinds', CHART, 'index.mjs'));

    if (!committed) {
      // ── a. the scaffold is refused: every stubbed part named, nothing else ────────────────
      await scaffold(CHART, { type: 'technique', description: DESC });
      need(existsSync(join(ROOT, 'engine', 'kinds', CHART, 'index.mjs')), 'the scaffold wrote no kind module');
      need(existsSync(join(ROOT, 'engine', 'verify', 'produce', CHART + '.mjs')), 'the scaffold wrote no check stub');
      assertRefused(await checkCapability(CHART), 'the scaffolded technique');
      facts.push('scaffold refused with exactly the stubbed parts named (5 hook stubs, the gate stubs, the check stub)');

      // ── b. the same capability implemented HONESTLY (what demo D builds on) ───────────────
      const KDIR = join(ROOT, 'engine', 'kinds', CHART);
      writeFileSync(join(KDIR, 'index.mjs'), CHART_INDEX);
      writeFileSync(join(KDIR, 'gates.mjs'), CHART_GATES);
      writeJson(join(KDIR, 'catalog.json'), CHART_CATALOG);
      writeFileSync(join(KDIR, 'SKILL.md'), CHART_SKILL);
      writeFileSync(join(KDIR, 'TOOLS.md'), CHART_TOOLS);
      writeFileSync(join(ROOT, 'engine', 'verify', 'produce', CHART + '.mjs'), CHART_CHECK);

      const ok = await checkCapability(CHART);
      need(ok.ok, 'capability check still refuses the implemented technique: ' + ok.missing.join(' | '));
      need(!ok.missing.length, 'the implemented capability reports missing parts: ' + ok.missing.join(' | '));
      facts.push('implemented ' + CHART + ' accepted: ' + ok.present.length + ' contract parts present');

      // the gates genuinely run (demo D builds on them): good data passes; an absent chart.json
      // FAILs naming the file; a non-numeric row FAILs naming the first bad row
      const K = await fresh(join(KDIR, 'index.mjs'));
      const G = await fresh(join(KDIR, 'gates.mjs'));
      K.create(DEMO_FILM, { title: 'growth demo' });
      const demo = join(FILMS, DEMO_FILM);
      need(kindOf(readFilm(DEMO_FILM).cfg) === CHART, 'create does not stamp kind: ' + CHART);
      need(existsSync(join(demo, 'chart.json')), 'create does not write the chart.json stub');
      writeJson(join(demo, 'chart.json'), { data: [[0, 12], [1, 19], [2, 7]], source: 'the growth check seeded rows' });
      let g = await G.dataGate(readFilm(DEMO_FILM));
      need(g.pass, 'the data gate fails on good data: ' + g.detail);
      g = await G.axisGate(readFilm(DEMO_FILM));
      need(g.pass, 'the axis gate fails on numeric pairs: ' + g.detail);
      rmSync(join(demo, 'chart.json'));
      g = await G.dataGate(readFilm(DEMO_FILM));
      need(!g.pass && /chart\.json/.test(g.detail), 'an absent chart.json must FAIL naming the file (got: ' + g.detail + ')');
      writeJson(join(demo, 'chart.json'), { data: [[0, 12], ['q1', 9], [2, 7]], source: 'the growth check seeded rows' });
      g = await G.dataGate(readFilm(DEMO_FILM));
      need(g.pass, '3 rows + a source must pass the data gate (got: ' + g.detail + ')');
      g = await G.axisGate(readFilm(DEMO_FILM));
      need(!g.pass && /data\[1\]/.test(g.detail), 'a non-numeric row must FAIL naming the first bad row (got: ' + g.detail + ')');
      const suite = await G.runGates(DEMO_FILM, { log: () => {} });
      need(suite.pass === false && suite.checks && suite.checks.length === 2, 'runGates did not run both gates');
      need(existsSync(join(demo, 'gates.json')), 'runGates did not write gates.json');
      writeJson(join(demo, 'chart.json'), { data: [[0, 12], [1, 19], [2, 7]], source: 'the growth check seeded rows' });
      const green = await G.runGates(DEMO_FILM, { log: () => {} });
      need(green.pass, 'runGates must pass on good data');
      facts.push('the chart gates run good/bad on a seeded film (chart.json named when absent; data[1] named on a bad row; ' + green.checks.length + ' checks green)');

      // the menu grew: studio capabilities lists it HOT through the registry scan (a fresh
      // process; the table path also proves every invoke command exists in studio help)
      const cap = cli(['capabilities']);
      need(cap.code === 0, 'studio capabilities failed with the grown technique present: ' + cap.out.split('\n').slice(-3).join(' | '));
      need(/(^|\n)ready\s+technique\s+verify-chart\b/.test(cap.out), 'studio capabilities does not list the grown technique as ready (got: ' + (cap.out.split('\n').filter((l) => /verify-chart/.test(l)).join(' | ') || 'no line') + ')');
      facts.push('studio capabilities lists ' + CHART + ' (technique, ready) — hot through the registry scan');

      // and a plan with a verify-chart segment VALIDATES (checkPlan) — the menu a producer sees
      await planMenu(CHART);
      facts.push('a seeded plan with a ' + CHART + ' segment VALIDATES (checkPlan) — the menu grew');

      // ── c. removal leaves the registry + the catalog consistent ──────────────────────────
      const gone = removeCapability(CHART);
      need(gone.removed.some((p) => p.includes('engine/kinds/' + CHART)), 'removeCapability did not remove the kind dir (' + gone.removed.join(', ') + ')');
      need(gone.removed.some((p) => p.includes('grown.json')), 'removeCapability did not remove the grown row');
      const after = catalogIds();
      need(after.code === 0 && after.ids, 'validatedCatalog fails after the removal: ' + after.err);
      need(!after.ids.some((i) => i.indexOf(CHART + ':') === 0), CHART + ' is still in the catalog after removal (' + (after.ids || []).join(',') + ')');
      const planGone = cli(['project', 'plan', PLAN_KEY, '--check']);
      need(planGone.code !== 0 && planGone.out.includes(CHART) && planGone.out.includes('not in the catalog'), 'the same plan after removal must FAIL naming ' + CHART + ' as not in the catalog (got: ' + planGone.out.split('\n').slice(-3).join(' | ') + ')');
      need(!readGrown().some((r) => r.id === CHART), 'the grown row survived the removal');
      facts.push('removal consistent: the catalog validates without it, the plan menu no longer offers it, grown.json clean');
    } else {
      // ── mission end: demo D's chart capability is COMMITTED under this id — never touched.
      // The row checks IT passes its own check (the CHECKS row's demo-D clause) and that the
      // plan menu offers it; the refuse->remove lifecycle runs on a scratch id instead.
      const d = await checkCapability(CHART);
      need(d.ok, 'the committed chart capability does not pass its own check: ' + d.missing.join(' | '));
      await planMenu(CHART);
      await scaffold(SCRATCH, { type: 'technique', description: 'the growth check scratch technique (the lifecycle proof while ' + CHART + ' is committed)' });
      assertRefused(await checkCapability(SCRATCH), 'the scratch scaffold');
      const gone = removeCapability(SCRATCH);
      need(gone.removed.some((p) => p.includes('engine/kinds/' + SCRATCH)), 'removeCapability did not remove the scratch kind dir');
      const after = catalogIds();
      need(after.code === 0 && after.ids && !after.ids.some((i) => i.indexOf(SCRATCH + ':') === 0), 'the catalog is inconsistent after the scratch removal (' + after.err + ')');
      let refused = null;
      try { removeCapability(CHART); refused = 'removed a committed capability'; } catch (e) { refused = String((e && e.message) || e); }
      need(/committed to git/.test(refused), 'removeCapability must REFUSE a committed capability (got: ' + refused + ')');
      facts.push('the committed ' + CHART + ' passes its own check; the lifecycle proven on ' + SCRATCH + '; removal of a committed capability refused');
    }

    // ── d. a service: the module + the grown row + the entry lines for the lead; NOT listed ─
    const svc = await scaffold(FETCH, { type: 'service', description: 'fetch a data table from a URL into films/<key>/chart.json (the source recorded, a local snapshot pinned — offline-verifiable)' });
    need(existsSync(join(ROOT, 'engine', 'produce', 'services', FETCH, 'index.mjs')), 'the service scaffold wrote no module');
    need(typeof svc.catalogLines === 'string' && svc.catalogLines.includes("id: '" + FETCH + "'"), 'the service scaffold returned no catalog-entry lines for the lead');
    const grow = readGrown().find((r) => r.id === FETCH);
    need(grow && grow.type === 'service' && grow.entry && grow.entry.id === FETCH, 'the grown row is missing or malformed (' + JSON.stringify(grow && grow.id) + ')');
    const svcCheck = await checkCapability(FETCH);
    need(svcCheck.ok, 'the scaffolded service is refused: ' + svcCheck.missing.join(' | '));
    for (const p of ['module', 'interface run', 'interface status', 'grown registry'])
      need(svcCheck.present.some((m) => m.startsWith(p)), 'the service check does not name "' + p + '" (present: ' + svcCheck.present.join(' | ') + ')');
    // the two-step, asserted honestly: a fresh process must NOT list the service yet
    const beforeLead = catalogIds();
    need(beforeLead.code === 0 && beforeLead.ids, 'validatedCatalog fails with the scaffolded service present: ' + beforeLead.err);
    need(!beforeLead.ids.some((i) => i.indexOf(FETCH + ':') === 0), 'a scaffolded service must NOT be listed in studio capabilities before the lead adds the entry (two-step by design — got: ' + (beforeLead.ids || []).join(',') + ')');
    facts.push('the service growth is two-step by design: module + grown row + the entry lines for the lead; studio capabilities does not list it yet');
  } finally {
    for (const id of [CHART, SCRATCH, FETCH]) { try { removeCapability(id); } catch { /* not scaffolded, or committed (the lead's) — clean */ } }
    for (const f of [PLAN_KEY, DEMO_FILM, CHART + '-check', 'verify-p-grow-' + CHART])
      rmSync(join(FILMS, f), { recursive: true, force: true });
  }

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
