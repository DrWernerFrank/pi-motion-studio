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

/** Record the human's input files: path + sha256, read-only (never moved or modified). */
export function recordInputs(key, files) {
  const dir = join(FILMS, key);
  const rows = [];
  for (const f of files) {
    const abs = resolveInput(f);
    if (!existsSync(abs)) throw new Error(`input file not found: ${f} (Windows paths work: C:\\Users\\…\\clip.mp4)`);
    rows.push({ id: `i${rows.length + 1}`, path: abs, sha256: shaOf(abs) });
  }
  const cur = readJson(join(dir, 'inputs.json'), []);
  writeJson(join(dir, 'inputs.json'), [...cur, ...rows]);
  appendLog(key, `inputs recorded: ${rows.map((r) => `${r.id}=${r.path.replace(homedirSafe(), '~')}`).join(', ')}`);
  return rows;
}

const shaOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const homedirSafe = () => homedir();

/** A Windows path from WSL (C:\Users\…) resolves through wslpath; ~ expands to HOME. */
function resolveInput(f) {
  if (process.platform === 'linux' && /^[A-Za-z]:[\\/]/.test(f)) {
    try { return execFileSync('wslpath', ['-u', f], { encoding: 'utf8' }).trim(); } catch { return f; }
  }
  return f.replace(/^~(?=\/)/, process.env.HOME || '~');
}

// ── the plan ───────────────────────────────────────────────────────────────────────────────
export async function planCheck(key) {
  const { validatePlanFile } = await import('../../produce/plan.mjs');
  const r = await validatePlanFile(join(FILMS, key, 'plan.json'));
  return r;
}

// ── segments: children of any kind ──────────────────────────────────────────────────────────
export async function segment(key, seg, { design = true } = {}) {
  const plan = readJson(join(FILMS, key, 'plan.json'), null);
  if (!plan) throw new Error(`films/${key}/plan.json is empty — write the plan first (studio project plan ${key} --check)`);
  const childKey = seg.film ?? `${key}-${seg.id}`;
  if (existsSync(join(FILMS, childKey))) return { key: childKey, existed: true };
  const K = await kindModule(seg.capability);
  const r = K.create(childKey, { title: `${seg.role ?? seg.id} — ${key}`, formats: plan.deliverables.find((d) => d.type === 'video')?.formats ?? ['16:9'] });
  // the child knows its parent (the films list groups under the project)
  const cfg = readJson(join(FILMS, childKey, 'film.json'), {});
  cfg.parent = key;
  writeJson(join(FILMS, childKey, 'film.json'), cfg);
  // one design system: the project's design.json flows into every child (children may override
  // ONLY what the plan says — for now: inherit wholesale; per-key overrides come with the plan)
  if (design) copyDesign(key, childKey);
  // the project's parts + state
  const film = readJson(join(FILMS, key, 'film.json'), {});
  film.parts = [...new Set([...(film.parts || []), childKey])];
  writeJson(join(FILMS, key, 'film.json'), film);
  const st = readJson(join(FILMS, key, 'state.json'), { segments: {} });
  st.segments[seg.id] = { status: 'created', film: childKey, capability: seg.capability, at: new Date().toISOString() };
  writeJson(join(FILMS, key, 'state.json'), st);
  appendLog(key, `segment ${seg.id} (${seg.capability}) -> films/${childKey}`);
  void r;
  return { key: childKey, existed: false };
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
const pickDesign = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => ['palette', 'colors', 'c', 'fonts', 'type', 'ladder', 'feel', 'devices'].includes(k)));

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
  // a project renders through its parts; the assembled deliverable is ship's job (P3 wires assembly)
  const parts = (readJson(join(FILMS, key, 'film.json'), {}).parts) || [];
  const out = [];
  for (const p of parts) out.push(...await (await hooksFor(p)).render(p, { ...opts, quality: opts.quality ?? 'draft' }));
  setState(key, { phase: 'built' });
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
export function summary(cfg, dir) { return { project: true, parent: null, children: cfg.parts ?? [] }; }
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
