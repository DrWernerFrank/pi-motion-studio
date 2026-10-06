// The project kind (K3): one request, many parts. A project film folder wraps a request: brief.md
// (verbatim), plan.json (K4), requirements.json (K5), assets/facts/budget (K6/K7), design.json
// (one system for the whole piece), state.json (the resume truth), and children — real films of any
// kind whose film.json carries "parent". A single-technique project is a thin wrapper: its final is
// the child's final (no re-encode — the ship hook copies/remuxes only).
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, kindOf, readFilm, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { hooksFor, kindModule } from '../registry.mjs';

const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

// ── create ──────────────────────────────────────────────────────────────────────────────────
export function create(key, { title, request, formats = ['16:9'], inputs = [] } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio project new <key>: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error(`films/${key} already exists`);
  mkdirSync(join(dir, 'sources'), { recursive: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  // the machine files (ADR-002's one-writer-per-file rule)
  writeJson(join(dir, 'film.json'), { kind: 'project', title: title ?? key, formats, request, parts: [] });
  writeJson(join(dir, 'plan.json'), null);
  writeJson(join(dir, 'requirements.json'), []);
  writeJson(join(dir, 'assets.json'), []);
  writeJson(join(dir, 'facts.json'), []);
  writeJson(join(dir, 'budget.json'), { minutes: 180, usd: 0, spent_usd: 0, calls: [] });
  writeJson(join(dir, 'inputs.json'), []);
  writeJson(join(dir, 'state.json'), { phase: 'planning', segments: {}, started: new Date().toISOString() });
  // the request VERBATIM first, then the interpretation (the producer fills that in)
  writeFileSync(join(dir, 'brief.md'), `# ${title ?? key}\n\n## The request (verbatim)\n\n${request}\n\n## Interpretation\n\n(goal in one line, the explicit constraints, the implied ones, the assumptions — the producer writes this)\n`);
  writeFileSync(join(dir, 'log.md'), `# Production log — ${key}\n\nOne line per decision, newest last.\n`);
  // a default design system (the producer replaces it with the real direction before any segment)
  const d = JSON.parse(readFileSync(join(ROOT, 'templates', 'film', 'design.json'), 'utf8'));
  writeJson(join(dir, 'design.json'), d);
  if (inputs.length) recordInputs(key, inputs);
  return { dir, message: `created films/${key} (project)\n  next: write the interpretation in brief.md, the plan (plan.json), then studio project plan ${key} --check\n  then build: studio project rebuild ${key}` };
}

/** Record the human's input files: path + sha256, read-only (never moved or modified). The ids
 *  continue the ledger's numbering (i2 after i1), so a second `--file` run can never shadow i1. */
export function recordInputs(key, files) {
  const dir = join(FILMS, key);
  const cur = readJson(join(dir, 'inputs.json'), []);
  const rows = [];
  for (const f of files) {
    const abs = resolveInput(f);
    if (!existsSync(abs)) throw new Error(`input file not found: ${f} (a ~ path expands to $HOME; a Windows path resolves through wslpath under WSL)`);
    rows.push({ id: `i${cur.length + rows.length + 1}`, path: abs, sha256: shaOf(abs) });
  }
  writeJson(join(dir, 'inputs.json'), [...cur, ...rows]);
  appendLog(key, `inputs recorded: ${rows.map((r) => `${r.id}=${r.path.replace(homedirSafe(), '~')} (sha256 ${r.sha256.slice(0, 12)}…)`).join(', ')}`);
  return rows;
}

const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const homedirSafe = () => homedir();

/** A path from anywhere the human writes it: ~ expands to HOME (either slash), a Windows path
 *  (C:\… or C:/… or \\wsl$\…) resolves through wslpath when we run under WSL, anything else is
 *  used as-is. The file is only ever READ (the studio never moves or rewrites the human's media). */
function resolveInput(f) {
  const p = String(f).trim();
  if (/^~(?:$|[/\\])/.test(p)) return p.replace(/^~/, process.env.HOME || '~');
  if (process.platform === 'linux' && /^([A-Za-z]:[\\/]|\\\\)/.test(p)) {
    try { const r = execFileSync('wslpath', ['-u', p], { encoding: 'utf8' }).trim(); if (r) return r; }
    catch { /* no wslpath or a bogus drive: fall through, the existsSync below names the raw path */ }
  }
  return p;
}

// ── the plan ───────────────────────────────────────────────────────────────────────────────
export async function planCheck(key) {
  const { validatePlanFile } = await import('../../produce/plan.mjs');
  const r = await validatePlanFile(join(FILMS, key, 'plan.json'));
  return r;
}

// ── segments: children of any kind ──────────────────────────────────────────────────────────
/** One part of the piece: create the child film (or LINK a film that already exists under
 *  seg.film), inherit the design system, list it in parts + state — then BUILD it: one draft
 *  render (the first asked format — one heavy render at a time, the caller walks the plan in
 *  order) followed by the child's own gates. Gates PASS -> state 'done' (a later rebuild resumes
 *  past it); gates FAIL or a render that throws -> the segment stays 'building' with a LOUD
 *  report — never a silent skip; the producer fixes the child and rebuilds --only <id>.
 *  `build: false` is the link-only path (a child built by its own pipeline ahead of the plan). */
export async function segment(key, seg, { design = true, build = true } = {}) {
  const plan = readJson(join(FILMS, key, 'plan.json'), null);
  if (!plan) throw new Error(`films/${key}/plan.json is empty — write the plan first (studio project plan ${key} --check)`);
  const childKey = seg.film ?? `${key}-${seg.id}`;
  const formats = plan.deliverables?.find((d) => d.type === 'video')?.formats ?? ['16:9'];
  const existed = existsSync(join(FILMS, childKey));
  if (!existed) {
    const K = await kindModule(seg.capability);
    K.create(childKey, { title: `${seg.role ?? seg.id} — ${key}`, formats, duration: seg.duration });
  }
  // the link: the child knows its parent (the films list groups under the project) — also for a
  // child that already existed (built ahead of the plan through its own pipeline)
  const cfg = readJson(join(FILMS, childKey, 'film.json'), {});
  if (cfg.parent !== key) writeJson(join(FILMS, childKey, 'film.json'), { ...cfg, parent: key });
  // one design system: the project's design.json flows into every child (children may override
  // ONLY what the plan says — for now: inherit wholesale; per-key overrides come with the plan)
  if (!existed && design) copyDesign(key, childKey);
  // the project's parts + state
  const film = readJson(join(FILMS, key, 'film.json'), {});
  film.parts = [...new Set([...(film.parts || []), childKey])];
  writeJson(join(FILMS, key, 'film.json'), film);
  const st = readJson(join(FILMS, key, 'state.json'), { phase: 'planning', segments: {} });
  st.segments ??= {};
  st.segments[seg.id] = { ...st.segments[seg.id], status: st.segments[seg.id]?.status ?? 'created', film: childKey, capability: seg.capability, at: new Date().toISOString() };
  writeJson(join(FILMS, key, 'state.json'), st);
  appendLog(key, `segment ${seg.id} (${seg.capability}) -> films/${childKey}${existed ? ' (existing film linked)' : ''}`);
  const r = { key: childKey, existed };
  if (!build) return r;
  return { ...r, ...(await buildSegment(key, seg, childKey, formats)) };
}

/** The build half (segment() above links first): draft render + the child's gates -> done. */
async function buildSegment(key, seg, childKey, formats) {
  const stFile = join(FILMS, key, 'state.json');
  const mark = (patch) => {
    const st = readJson(stFile, { phase: 'planning', segments: {} });
    st.segments ??= {};
    st.segments[seg.id] = { ...st.segments[seg.id], ...patch };
    // phase: building while any part is unfinished; 'assembled' once every planned part is done
    const plan = readJson(join(FILMS, key, 'plan.json'), {}) ?? {};
    const done = (plan.segments || []).every((s) => st.segments[s.id]?.status === 'done');
    st.phase = done ? 'assembled' : 'building';
    writeJson(stFile, st);
  };
  mark({ status: 'building' });
  try {
    const K = await hooksFor(childKey);
    await K.render(childKey, { quality: 'draft', fmt: formats[0] });   // ONE heavy render at a time
    const g = await K.gate(childKey);
    if (g.pass) {
      mark({ status: 'done' });
      const line = `segment ${seg.id}: draft + gates PASS -> done`;
      appendLog(key, line);
      console.log(`  ✓ ${line}`);
      return { status: 'done', gates: true };
    }
    const fails = (g.checks ?? []).filter((c) => c.level === 'fail');
    const head = `segment ${seg.id} gates FAIL — it stays 'building' (fix films/${childKey}, then: studio project rebuild ${key} --only ${seg.id})`;
    appendLog(key, `${head}\n${fails.map((f) => `  ${f.name}: ${f.detail}`).join('\n')}`);
    console.log(`  !! ${head}`);
    for (const f of fails.slice(0, 3)) console.log(`     ${f.name}: ${String(f.detail).split('\n')[0].slice(0, 140)}`);
    if (fails.length > 3) console.log(`     … (+${fails.length - 3} more failed check(s) — films/${childKey}/gates.json)`);
    return { status: 'building', gates: false, failed: fails.map((f) => f.name) };
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0].slice(0, 300);
    appendLog(key, `segment ${seg.id} build FAILED — it stays 'building': ${msg}`);
    console.log(`  !! segment ${seg.id} build FAILED — it stays 'building': ${msg}`);
    return { status: 'building', gates: false, error: msg };
  }
}

function copyDesign(key, childKey) {
  const d = readJson(join(FILMS, key, 'design.json'), null);
  if (!d) return;
  // children keep their own design fields the engine requires, but inherit the system's direction:
  // palette, fonts, ladder, feel — one piece, not stitched parts (K8)
  const child = readJson(join(FILMS, childKey, 'design.json'), null) || {};
  writeJson(join(FILMS, childKey, 'design.json'), {
    ...child, ...pickDesign(d),
    direction: d.direction ?? child.direction,
    inheritedFrom: `films/${key}/design.json`,
  });
}
const pickDesign = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => ['palette', 'colors', 'c', 'fonts', 'type', 'ladder', 'feel', 'motion', 'devices'].includes(k)));

// ── state / resume ─────────────────────────────────────────────────────────────────────────
export const stateOf = (key) => readJson(join(FILMS, key, 'state.json'), { phase: 'planning', segments: {} });
export function setState(key, patch) {
  const st = readJson(join(FILMS, key, 'state.json'), { segments: {} });
  writeJson(join(FILMS, key, 'state.json'), { ...st, ...patch, segments: { ...st.segments, ...(patch.segments ?? {}) } });
}

export function appendLog(key, line) {
  const file = join(FILMS, key, 'log.md');
  if (!existsSync(file)) writeFileSync(file, `# Production log — ${key}\n\n`);
  const d = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(file, `\n- ${d}  ${line}`);
}

// ── required registry hooks ─────────────────────────────────────────────────────────────────
export async function look(key, opts = {}) {
  // the project's look: a contact sheet per child final (the pieces, not the whole — yet)
  const parts = (readJson(join(FILMS, key, 'film.json'), {}).parts) || [];
  const { contactSheet } = await import('../../stills.mjs');
  const rows = [];
  for (const p of parts) {
    const film = readFilm(p);
    for (const fmt of (film.cfg.formats || []).slice(0, 1)) {
      try { rows.push(await contactSheet(p, { ...opts, fmt, name: `project-${p}` })); } catch { /* a part not rendered yet */ }
    }
  }
  if (!rows.length) throw new Error(`no rendered parts to look at yet (parts: ${parts.join(', ') || 'none'})`);
  return rows.at(-1);
}
export async function render(key, opts = {}) {
  // a project renders through its parts, one at a time (the assembled deliverable is ship's job —
  // P3 wires assembly); the phase moves to 'building' per state.json's vocabulary
  const parts = (readJson(join(FILMS, key, 'film.json'), {}).parts) || [];
  const out = [];
  for (const p of parts) out.push(...await (await hooksFor(p)).render(p, { ...opts, quality: opts.quality ?? 'draft' }));
  setState(key, { phase: 'building' });
  return out;
}
export async function gate(key) {
  // every child's gates must pass; the ledger's measurable rows run here too
  const parts = (readJson(join(FILMS, key, 'film.json'), {}).parts) || [];
  const bad = [];
  for (const p of parts) {
    const g = await (await hooksFor(p)).gate(p);
    if (!g.pass) bad.push(p);
  }
  return { pass: bad.length === 0, failed: bad, checks: [] };
}
export async function sound(key) {
  const parts = (readJson(join(FILMS, key, 'film.json'), {}).parts) || [];
  for (const p of parts) await (await hooksFor(p)).sound(p);
  return { ok: true };
}
export async function ship(key) {
  const { shipProject } = await import('../../produce/ship.mjs');
  return shipProject(key);
}

// ── GUI flags + view ────────────────────────────────────────────────────────────────────────
export function summary(cfg, dir) { void dir; return { project: true, parent: null, children: cfg.parts ?? [] }; }
export const view = 'project';
export const rubric = ['fidelity', 'coherence'];

// the capability entry (K2): the producer's own surface
export const capability = {
  makes: ['one piece from a plain-words request: any technique, any mix, assembled and verified against the ask'],
  strengths: ['requirements ledger with measured verifiers', 'facts + assets + budget ledgers', 'resume from state.json', 'revisions rebuild only what they touch'],
  weak: ['an extra layer over the techniques (worth it only when the ask is more than one technique can carry)'],
  typical: { duration: [5, 300], formats: ['16:9', '9:16', '1:1', '4:5'] },
  needs: [], ready: 'yes',
  invoke: { create: 'studio project new <key> "<request>"', plan: 'studio project plan <key> --check',
             rebuild: 'studio project rebuild <key>', verify: 'studio project verify <key>', ship: 'studio project ship <key>' },
  gates: ['project verify: the plan validates, every requirement green, child gates PASS, assets/facts/credits clean, budget held'],
  tools: ['project_status', 'project_plan', 'project_segment', 'project_check', 'project_ship'],
  skill: 'produce', critic: 'producer-critic',
};
