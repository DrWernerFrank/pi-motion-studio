// The plan validator (K4): a plan.json is a contract, and this checks it — every segment has a
// capability that exists in the catalog, reasons are present (>= 2 alternatives including the
// simplest thing that could work), a budget, deliverables, no over-scoping, and a risky choice
// carries saved probe sheets. Pure: (plan, catalog) -> { ok, errors[], warnings[] }.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/serve.mjs';

export const PLAN_VERSION = 1;

/** Validate a plan object. `catalog` = the validated catalog entries (id -> entry). */
export function checkPlan(plan, catalogById) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan.json: not an object'], warnings };
  if (plan.version !== PLAN_VERSION) err(`version: ${PLAN_VERSION} (got ${JSON.stringify(plan.version)})`);
  if (!plan.goal || typeof plan.goal !== 'string' || plan.goal.length < 8) err(`goal: one line, the film in one sentence (missing/too short: ${JSON.stringify(plan.goal?.slice?.(0, 40))})`);
  if (!Array.isArray(plan.assumptions) || !plan.assumptions.length) err('assumptions: a non-empty array — what you assumed when the request was ambiguous (write them down and move on)');
  if (!Array.isArray(plan.deliverables) || !plan.deliverables.length) err('deliverables: a non-empty array ({ type: "video", formats: [...], duration: n })');
  else for (const d of plan.deliverables) {
    if (d.type === 'video') {
      if (!Array.isArray(d.formats) || !d.formats.length) err(`deliverable "${d.name ?? '?'}": formats — which aspect ratios (16:9, 9:16, 1:1, 4:5)`);
      if (typeof d.duration !== 'number' || d.duration <= 0) err(`deliverable "${d.name ?? '?'}": duration in seconds`);
    } else if (!['still', 'audio', 'captions'].includes(d.type)) err(`deliverable type "${d.type}" (video|still|audio|captions)`);
  }

  // the decision carries its reasons
  const dec = plan.decision;
  if (!dec || typeof dec !== 'object') err('decision: { chosen, why, alternatives } — the technique choice and its reasons');
  else {
    if (!dec.chosen) err('decision.chosen: which technique (a catalog id) or "composite"');
    if (!dec.why || typeof dec.why !== 'string' || dec.why.length < 10) err('decision.why: why that choice (a sentence, not a word)');
    const alts = dec.alternatives;
    if (!Array.isArray(alts) || alts.length < 2) err('decision.alternatives: at least two considered, including the simplest thing that could work');
    else for (const a of alts) if (!a.id || !a.rejected_because) err(`decision.alternatives: { id, rejected_because } — every alternative carries its reason (${JSON.stringify(a.id).slice(0, 30)} has none)`);
    // a single-technique choice must name a real technique; "composite" plans assemble (P3)
    if (dec.chosen !== 'composite') {
      const cap = catalogById[dec.chosen];
      if (!cap) err(`decision.chosen "${dec.chosen}" is not in the capability catalog (${[...Object.keys(catalogById)].join(', ')})`);
      else if (cap.type !== 'technique') err(`decision.chosen "${dec.chosen}" is a ${cap.type}, not a technique`);
    }
    // a risky choice requires probe sheets (a 5-minute prototype of the hardest moment, looked at)
    if (dec.risky && !(Array.isArray(dec.probes) && dec.probes.length)) err('decision.risky: a risky choice needs saved probe sheets (probes/p1-sheet.png — look before you leap)');
  }

  // segments
  const segs = plan.segments;
  if (!Array.isArray(segs) || !segs.length) err('segments: a non-empty array (one per part of the piece)');
  else {
    const ids = new Set();
    for (const s of segs) {
      if (!s.id || /^s\d{2}$/.test(s.id) === false && !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) err(`segment id "${s.id}" (s01, s02, … or a slug)`);
      if (ids.has(s.id)) err(`segment id "${s.id}" twice`);
      ids.add(s.id);
      if (!s.capability) err(`segment ${s.id}: capability — which technique makes this part`);
      else {
        const cap = catalogById[s.capability];
        if (!cap) err(`segment ${s.id}: capability "${s.capability}" is not in the catalog (${[...Object.keys(catalogById)].join(', ')})`);
        else if (cap.type !== 'technique') err(`segment ${s.id}: capability "${s.capability}" is a ${cap.type}, not a technique`);
        else if (cap.typical?.duration && typeof s.duration === 'number') {
          const [lo, hi] = cap.typical.duration;
          if (s.duration < lo * 0.5 || s.duration > hi * 2) warn(`segment ${s.id}: ${s.duration}s is outside ${cap.capability ?? s.capability}'s typical ${lo}-${hi}s — possible over-scoping`);
        }
      }
      if (!s.role) err(`segment ${s.id}: role (cold open, proof, payoff, end card …)`);
      if (!s.brief || s.brief.length < 12) err(`segment ${s.id}: brief — what this part shows (a sentence)`);
      if (typeof s.duration !== 'number' || s.duration <= 0) err(`segment ${s.id}: duration in seconds`);
      if (!Array.isArray(s.acceptance) || !s.acceptance.length) err(`segment ${s.id}: acceptance — what must hold when this part is done`);
      if (s.film && !/^[a-z0-9][a-z0-9-]*$/.test(s.film)) err(`segment ${s.id}: film key "${s.film}" (lowercase letters, digits, dashes)`);
    }
    // over-scoping: the segments' total vs the video deliverables' target (±20%)
    const target = (plan.deliverables || []).filter((d) => d.type === 'video').reduce((n, d) => n + (d.duration || 0), 0);
    const total = segs.reduce((n, s) => n + (s.duration || 0), 0);
    if (target && total > target * 1.2) err(`over-scoping: segments total ${total}s vs the deliverables' ${target}s (+${Math.round(100 * (total / target - 1))}%) — cut scope or raise the target`);
    else if (target && total < target * 0.8 && dec?.chosen !== 'composite') warn(`segments total ${total}s vs the ${target}s target — is a part missing?`);
  }

  // assembly, feasibility, budget
  const asm = plan.assembly;
  if (!asm || !asm.mode) err('assembly.mode: edit-film (default), direct, or single (one technique — no assembly)');
  else if (!['edit-film', 'direct', 'single'].includes(asm.mode)) err(`assembly.mode "${asm.mode}" (edit-film|direct|single)`);
  if (!plan.feasibility || !Array.isArray(plan.feasibility.blocked_inputs)) err('feasibility.blocked_inputs: the missing inputs, flagged — never invented');
  if (dec?.chosen !== 'composite' && !Array.isArray(plan.feasibility?.needs_capability ?? [])) err('feasibility.needs_capability: an array (what must be built if nothing fits)');
  const bud = plan.budget;
  if (!bud || typeof bud.minutes !== 'number' || bud.minutes <= 0) err('budget.minutes: the time budget (soft stop at 80%, hard at 100%)');
  if (!bud || typeof bud.usd !== 'number' || bud.usd < 0) err('budget.usd: the money budget (0 by default — spend nothing without permission)');
  if (!Array.isArray(plan.risks)) warn('risks: an empty list is suspicious — what could go wrong?');

  // a risky/composite plan needs probe sheets (the hardest moment, prototyped and looked at)
  if ((dec?.risky || (segs?.length || 0) >= 3) && !(Array.isArray(dec?.probes) && dec.probes.length))
    err('a composite (3+ segments) or risky plan needs saved probe sheets (decision.probes) — a 5-minute prototype of the hardest moment, looked at through contact sheets');

  return { ok: errors.length === 0, errors, warnings };
}

/** Load + validate a plan against the catalog. Returns { ok, errors, warnings, plan }. */
export async function validatePlanFile(file) {
  const { validatedCatalog } = await import('./catalog.mjs');
  const entries = await validatedCatalog();
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  let plan = null;
  try { plan = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, errors: [`plan.json does not parse: ${e.message}`], warnings: [], plan: null, catalogById: byId }; }
  const r = checkPlan(plan, byId);
  return { ...r, plan, catalogById: byId };
}

void join; void ROOT;
