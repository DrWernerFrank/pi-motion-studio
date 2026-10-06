// Capability growth (K12): when nothing in the catalog fits, the producer grows a capability.
//   studio capability new <id> --type technique|service [--description "…"]   the scaffold
//   studio capability check <id>                                             the contract check
//   studio capability remove <id>                                            take it back out
// A TECHNIQUE is a kind (ADR-001): engine/kinds/<id>/ from templates/capability/, picked up
// HOT by the registry's scan — no catalog edit, no CLI of its own — and its catalog.json entry
// rides into `studio capabilities` and the plan menu. A SERVICE is a module with a frozen
// interface (engine/produce/services/<id>/) plus a catalog ENTRY that lives in
// engine/produce/catalog.mjs SERVICES — the lead's file — so the growth is TWO-STEP BY DESIGN:
// the module now, the entry when the lead pastes the reported lines. The grown registry
// (~/.local/share/pi-motion-studio/produce/grown.json, runtime state — never committed) records
// what was scaffolded, with its entry, for reconciliation.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFilm, readJson, writeJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';
import { REQUIRED } from '../kinds/registry.mjs';
import { SERVICES, validateEntry } from './catalog.mjs';

const KINDS = join(ROOT, 'engine', 'kinds');
const SERVICES_DIR = join(ROOT, 'engine', 'produce', 'services');
const CHECKS_DIR = join(ROOT, 'engine', 'verify', 'produce');
const TEMPLATES = join(ROOT, 'templates', 'capability');
const FILM_TEMPLATE = join(ROOT, 'templates', 'film');

/** The grown registry: runtime state (never committed) — what was scaffolded, with its entry. */
export const GROWN_FILE = join(homedir(), '.local', 'share', 'pi-motion-studio', 'produce', 'grown.json');
export const readGrown = () => {
  const rows = readJson(GROWN_FILE, []);
  return Array.isArray(rows) ? rows : [];
};
const writeGrown = (rows) => { mkdirSync(dirname(GROWN_FILE), { recursive: true }); writeJson(GROWN_FILE, rows); };
const addGrown = (row) => {
  const rows = readGrown();
  if (rows.some((r) => r.id === row.id)) throw new Error(`"${row.id}" is already in the grown registry (${GROWN_FILE.replace(homedir(), '~')}) — remove it first (studio capability remove ${row.id})`);
  rows.push(row);
  writeGrown(rows);
  return row;
};

const rel = (f) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);

/** Import a file AS IT IS ON DISK. The mtime+size key busts Node's ESM cache, so a check inside
 *  a long-lived process (the growth verifier) reads the current file, not an earlier scaffold
 *  of the same path — the registry caches kinds per process the same way. */
export async function freshImport(file) {
  const s = statSync(file);
  return import(pathToFileURL(file).href + `?v=${Math.round(s.mtimeMs)}-${s.size}`);
}

/** The registry with a fresh LOADED cache (the same trick its own verify check uses). */
let freshSeq = 0;
const freshAllKinds = () =>
  import(`../kinds/registry.mjs?grow=${process.pid}-${freshSeq++}`).then((m) => m.allKinds());

// ── the scaffold ─────────────────────────────────────────────────────────────────────────────

/** Fill the template placeholders: __ID__ (the id), __ID_US__ (the id with dashes as
 *  underscores — tool-name style, verify-chart → verify_chart_status), __DESCRIPTION__. */
const fill = (text, id, description) => String(text)
  .replaceAll('__ID_US__', id.replace(/-/g, '_'))   // first: it contains __ID_'s prefix shape
  .replaceAll('__ID__', id)
  .replaceAll('__DESCRIPTION__', String(description ?? ''));
const fillEntry = (o, id, description) => {
  if (typeof o === 'string') return fill(o, id, description);
  if (Array.isArray(o)) return o.map((x) => fillEntry(x, id, description));
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fillEntry(v, id, description)]));
  return o;
};
/** A free-text description inside a single-quoted JS string (the service's catalog-entry lines). */
const jsString = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Scaffold a grown capability. technique -> engine/kinds/<id>/ from templates/capability/
 * (create works; the other hooks, the gates and the check are honest stubs). service ->
 * engine/produce/services/<id>/ (the frozen interface) plus the catalog-entry LINES returned
 * for the lead (the entry itself is the lead's to add — two-step by design). Both record a
 * grown.json row {id, type, createdAt, entry}. Returns {id, type, dir, files, catalogLines,
 * entry, message} — message is the printed block with the NEXT-STEPS naming every contract part.
 */
export async function scaffold(id, { type = 'technique', description } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(id ?? ''))) throw new Error('studio capability new <id>: lowercase letters, digits, dashes (a letter first)');
  if (!['technique', 'service'].includes(type)) throw new Error(`--type technique|service (got "${type}")`);
  const desc = String(description ?? '').trim() || `${id} — a grown ${type} (describe it honestly: its entry's makes[], its SKILL.md craft)`;

  // never over anything that already exists — these names are load-bearing
  const kinds = await freshAllKinds().catch(() => null);   // an unrelated broken kind does not block a scaffold
  if (kinds?.[id]) throw new Error(`kind "${id}" already exists (${rel(join(KINDS, id))}) — grow it (studio capability check ${id}) or remove it first (studio capability remove ${id})`);
  if (id === 'registry') throw new Error('"registry" is the kind registry itself (engine/kinds/registry.mjs) — pick another id');
  if (SERVICES.some((s) => s.id === id)) throw new Error(`service "${id}" already exists (engine/produce/catalog.mjs SERVICES)`);
  for (const p of [join(KINDS, id), join(SERVICES_DIR, id), join(CHECKS_DIR, `${id}.mjs`)])
    if (existsSync(p)) throw new Error(`${rel(p)} already exists — remove it first (studio capability remove ${id})`);
  if (readGrown().some((r) => r.id === id)) throw new Error(`"${id}" is already in the grown registry (${GROWN_FILE.replace(homedir(), '~')}) — remove it first (studio capability remove ${id})`);

  const created = [];
  const write = (dir, name, text) => { const f = join(dir, name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); created.push(rel(f)); };
  const row = { id, createdAt: new Date().toISOString() };   // the grown.json row: {id, type, createdAt, entry}
  const cap = {};                                            // the catalog entry the capability carries
  let catalogLines = null, message = '';

  if (type === 'technique') {
    const dir = join(KINDS, id);
    mkdirSync(dir, { recursive: true });
    for (const [tmpl, name] of [['README.md.tmpl', 'README.md'], ['SKILL.md.tmpl', 'SKILL.md'], ['TOOLS.md.tmpl', 'TOOLS.md'], ['doctor.mjs.tmpl', 'doctor.mjs'], ['gates.mjs.tmpl', 'gates.mjs'], ['index.mjs.tmpl', 'index.mjs']])
      write(dir, name, fill(readFileSync(join(TEMPLATES, tmpl), 'utf8'), id, desc));
    // the catalog entry: JSON, filled as DATA (a description with a quote must not break it)
    row.type = 'technique';
    Object.assign(cap, fillEntry(JSON.parse(readFileSync(join(TEMPLATES, 'catalog.json'), 'utf8')), id, desc));
    writeJson(join(dir, 'catalog.json'), cap);
    created.push(rel(join(dir, 'catalog.json')));
    // the check stub — a verify-produce row file (the lead wires its row when the technique ships)
    write(CHECKS_DIR, `${id}.mjs`, fill(readFileSync(join(TEMPLATES, 'verify', 'produce', '__ID__.mjs.tmpl'), 'utf8'), id, desc));
    message = [
      `scaffolded technique "${id}" -> ${rel(dir)}/ (a KIND — the registry scan picks it up hot)`,
      `  index.mjs      create works (stamps kind: ${id}); render/look/sound/gate/ship are stubs; doctor re-exported`,
      `  catalog.json   the capability entry (ready: "${id}" — an unknown probe id: honestly NOT-READY until ready: "yes")`,
      `  gates.mjs      two gate stubs (firstGate, secondGate)`,
      `  doctor.mjs     a real existence probe  ·  SKILL.md / TOOLS.md / README.md  the contract (README.md is the whole of it)`,
      `  check stub     ${rel(join(CHECKS_DIR, `${id}.mjs`))}`,
      `  grown row      ${GROWN_FILE.replace(homedir(), '~')} (runtime state — never committed)`,
      ``,
      `NEXT STEPS — studio capability check ${id} refuses until every part is real:`,
      `  1. implement the five hook stubs in index.mjs (a motion-based technique re-exports motion's hooks — engine/kinds/edit/index.mjs is the pattern)`,
      `  2. implement BOTH gates in gates.mjs — each RUNS on a seeded film and returns {name, pass, detail} (never a throw; a FAIL names the thing)`,
      `  3. rewrite the check stub ${rel(join(CHECKS_DIR, `${id}.mjs`))} — seed a film, run the gates good/bad (keep it cheap: no renders)`,
      `  4. fill catalog.json honestly (real makes/strengths/weak, the gate names, ready: "yes" when the technique needs nothing)`,
      `  5. write the SKILL.md craft paragraph (> 200 chars) and keep TOOLS.md's tool lines (>= 1)`,
      `  6. studio capability check ${id} — READY: the registry scan carries it into studio capabilities + the plan menu, hot`,
    ].join('\n');
  } else {
    const dir = join(SERVICES_DIR, id);
    mkdirSync(dir, { recursive: true });
    write(dir, 'index.mjs', fill(readFileSync(join(TEMPLATES, 'service', 'index.mjs.tmpl'), 'utf8'), id, desc));
    write(dir, 'README.md', fill(readFileSync(join(TEMPLATES, 'service', 'README.md.tmpl'), 'utf8'), id, desc));
    // the catalog entry LINES for the lead (returned + recorded; never written — catalog.mjs is the lead's file)
    const use = `import { run } from "./produce/services/${id}/index.mjs" — a technique calls it (the interface is frozen)`;
    row.type = 'service';
    Object.assign(cap, {
      id, type: 'service', makes: [desc],
      strengths: ['(what it is good at — edit me)'], weak: ['(what it cannot do — edit me)'],
      needs: [], ready: 'yes',
      invoke: { use },
      gates: [`${id}: the service's own gate — what must hold for its output to be trusted`],
    });
    catalogLines = [
      '  {',
      `    id: ${jsString(id)}, type: 'service', makes: [${jsString(desc)}],`,
      `    strengths: [${jsString('(what it is good at — edit me)')}],`,
      `    weak: [${jsString('(what it cannot do — edit me)')}],`,
      `    needs: [], ready: 'yes',`,
      `    invoke: { use: ${jsString(use)} },`,
      `    gates: [${jsString(`${id}: the service's own gate — what must hold for its output to be trusted`)}],`,
      '  },',
    ].join('\n');
    message = [
      `scaffolded service "${id}" -> ${rel(dir)}/ (a service MODULE — any technique imports { run })`,
      `  index.mjs   the frozen interface: run(key, opts) (a stub — implement what it does to films/<key>) + status() (a cheap probe)`,
      `  README.md   the two-step contract`,
      `  grown row   ${GROWN_FILE.replace(homedir(), '~')} (runtime state — never committed)`,
      ``,
      `THE CATALOG ENTRY (the second step — the lead pastes this into engine/produce/catalog.mjs SERVICES):`,
      catalogLines,
      ``,
      `NEXT STEPS:`,
      `  1. implement run(key, opts) in ${rel(join(dir, 'index.mjs'))} — what the service does to films/<key>; keep the interface frozen`,
      `  2. hand the entry lines above to the lead (they are recorded in the grown row; engine/produce/catalog.mjs SERVICES is the lead's file)`,
      `  3. studio capability check ${id} — asserts the module interface + the grown row meanwhile`,
      `  4. studio capabilities lists the service only after the lead adds the entry (two-step by design)`,
    ].join('\n');
  }

  row.entry = cap;
  addGrown(row);
  return { id, type, dir: type === 'technique' ? join(KINDS, id) : join(SERVICES_DIR, id), files: created, catalogLines, entry: cap, message };
}

// ── the contract check ─────────────────────────────────────────────────────────────────────

/** checkCapability(id) -> { ok, missing[], present[], id, type }. A TECHNIQUE is refused until
 *  every part is real: the module, the registry load (the six required hooks — a missing one is
 *  a missing part, parsed out of allKinds' loud failure), a capability entry validateEntry
 *  accepts, a doctor probe (the module's doctor export, or a ready: id the PROBES map knows),
 *  >= 2 gates that RUN on a seeded film (the stubs throw; implemented gates RETURN), the check
 *  file (a real default export that runs — the scaffold stub says "not implemented"), TOOLS.md
 *  (>= 1 tool name) and SKILL.md (> 200 chars). A SERVICE needs the frozen interface (run +
 *  status) and its grown.json row carrying the entry (the catalog listing is the lead's second
 *  step — reported, never faked). */
export async function checkCapability(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(id ?? ''))) throw new Error('studio capability check <id>: lowercase letters, digits, dashes (a letter first)');
  if (existsSync(join(SERVICES_DIR, id, 'index.mjs')) && !existsSync(join(KINDS, id, 'index.mjs'))) return checkService(id);
  return checkTechnique(id);
}

async function checkTechnique(id) {
  const missing = [], present = [];
  const done = () => ({ ok: missing.length === 0, missing, present, id, type: 'technique' });
  const kindDir = join(KINDS, id);
  const idx = join(kindDir, 'index.mjs');

  // 1. the module
  if (!existsSync(idx)) { missing.push(`module: engine/kinds/${id}/index.mjs does not exist (scaffold: studio capability new ${id} --type technique)`); return done(); }
  present.push(`module: engine/kinds/${id}/index.mjs (a kind module — the registry scan picks it up hot)`);
  let mod = null;
  try { mod = await freshImport(idx); }
  catch (e) { missing.push(`module: index.mjs does not load: ${firstLine(e)}`); return done(); }

  // 2. the six required hooks: functions the registry can dispatch — and not the scaffold stubs
  //    (the marker "not implemented yet: <hook>" IS the stub contract; the source scan names them)
  const stubbed = new Set([...readFileSync(idx, 'utf8').matchAll(/not implemented yet:\s*([a-zA-Z]+)/g)].map((m) => m[1]));
  for (const h of REQUIRED) {
    if (typeof mod[h] !== 'function') missing.push(`hook ${h}: a required hook (a function export in index.mjs) — the registry refuses the whole studio without it`);
    else if (stubbed.has(h)) missing.push(`hook ${h}: still the scaffold stub (throws "not implemented yet") — implement it, or re-export motion's (engine/kinds/edit/index.mjs is the pattern)`);
    else present.push(`hook ${h}`);
  }
  try {
    const kinds = await freshAllKinds();   // the registry's own load — duplicate names, load faults
    if (!kinds[id]) missing.push(`registry: allKinds() loads but does not list "${id}" (engine/kinds/${id}/index.mjs must export the hooks at its top level)`);
    else present.push('registry: allKinds() loads the kind (required hooks + no duplicate names)');
  } catch (e) {
    const msg = String((e && e.message) || e);
    const mine = new RegExp(`kind "${id}"[^\\n]*missing required hook\\(s\\):\\s*(.+)`).exec(msg);
    if (mine) for (const h of mine[1].split(',').map((s) => s.trim()))
      if (!missing.some((m) => m.startsWith(`hook ${h}:`))) missing.push(`hook ${h}: the registry's loud load names it missing (${firstLine(e)})`);
    else missing.push(`registry: allKinds() fails — ${firstLine(e)}`);
  }

  // 3. the capability entry (K2): validateEntry accepts it, and it names the kind it rides
  let entry = null;
  try { entry = typeof mod.capability === 'function' ? await mod.capability() : mod.capability; }
  catch (e) { missing.push(`catalog entry: the capability export throws: ${firstLine(e)}`); }
  if (entry === null || entry === undefined) {
    if (!missing.some((m) => m.startsWith('catalog entry:')))
      missing.push(`catalog entry: index.mjs exports no capability (the K2 entry — docs/produce/SCHEMAS.md § the capability entry; catalog.json is the data)`);
  } else {
    const errs = validateEntry(entry, `engine/kinds/${id}/catalog.json`);
    if (errs.length) missing.push(`catalog entry: ${errs.join('; ')}`);
    else if (entry.id !== id) missing.push(`catalog entry: id "${entry.id}" must be the kind's name "${id}" (the registry lists kinds by directory — studio capabilities would show it under the wrong id)`);
    else if (entry.type !== 'technique') missing.push(`catalog entry: a kind's entry is a technique (got type "${entry.type}")`);
    else present.push('catalog entry: validateEntry ok (id, type, makes, invoke, gates)');
  }

  // 4. a doctor probe: the module's doctor export, or a ready the PROBES map knows
  const { PROBES } = await import('./capabilities.mjs');
  if (typeof mod.doctor === 'function') present.push(`doctor probe: the module exports doctor(ctx) (engine/kinds/${id}/doctor.mjs — wired in index.mjs)`);
  else if (entry?.ready === 'yes') present.push('doctor probe: catalog ready "yes" (needs nothing — always ready)');
  else if (entry?.ready && PROBES[entry.ready]) present.push(`doctor probe: catalog ready "${entry.ready}" (a probe engine/produce/capabilities.mjs knows)`);
  else missing.push(`doctor probe: a doctor(ctx) export wired in index.mjs (engine/kinds/${id}/doctor.mjs — the scaffold wires it), or a catalog ready the PROBES map knows`);

  // 5. >= 2 gates that RUN on a seeded film (the stubs throw; implemented gates return a verdict)
  const gatesFile = join(kindDir, 'gates.mjs');
  if (!existsSync(gatesFile)) missing.push(`gates: engine/kinds/${id}/gates.mjs does not exist (>= 2 gates: functions that run on a seeded film and return {name, pass, detail})`);
  else {
    const seedKey = `verify-p-grow-${id}`;   // the checks' temp-film namespace; always removed
    const seedDir = join(ROOT, 'films', seedKey);
    rmSync(seedDir, { recursive: true, force: true });
    try {
      let film = null;
      try { mod.create(seedKey, {}); film = readFilm(seedKey); }
      catch { /* create's own state is the hook parts above — seed by hand so the gates still get judged */ }
      if (!film) {
        cpSync(FILM_TEMPLATE, seedDir, { recursive: true });
        const cfg = readJson(join(seedDir, 'film.json'));
        writeJson(join(seedDir, 'film.json'), { ...cfg, kind: id });
        try { film = readFilm(seedKey); } catch { film = null; }
      }
      if (!film) missing.push('gates: a film could not be seeded for the gate run (create throws and the manual seed failed)');
      else {
        const gm = await freshImport(gatesFile);
        const list = Array.isArray(gm.GATES) ? gm.GATES : [];
        if (!list.length) missing.push(`gates: GATES lists nothing (>= 2 gate functions — engine/kinds/${id}/gates.mjs)`);
        else {
          const ran = [];
          for (const g of list) {
            try { const r = await g(film); if (r && typeof r === 'object' && 'pass' in r) ran.push(String(r.name ?? g?.name ?? 'gate')); }
            catch { /* a throwing gate is not implemented (runGates reports a throw as a FAIL) */ }
          }
          if (ran.length >= 2) present.push(`gates: ${ran.length}/${list.length} run on a seeded film without throwing (${ran.slice(0, 3).join(', ')})`);
          else missing.push(`gates: only ${ran.length}/${list.length} gate(s) run on a seeded film (a gate RETURNS {name, pass, detail} — the scaffold's stubs throw; implement both)`);
        }
      }
    } finally { rmSync(seedDir, { recursive: true, force: true }); }
  }

  // 6. the check file: a real default export that runs (the scaffold stub answers "not implemented")
  const checkFile = join(CHECKS_DIR, `${id}.mjs`);
  if (!existsSync(checkFile)) missing.push(`check file: engine/verify/produce/${id}.mjs does not exist (a default export async (ctx) => ({pass, measured}) — seed a film, run the gates good/bad)`);
  else {
    try {
      const chk = await freshImport(checkFile);
      if (typeof chk.default !== 'function') missing.push(`check file: engine/verify/produce/${id}.mjs has no default export`);
      else {
        const r = await chk.default({ quick: true, root: ROOT, cache: join(homedir(), '.cache', 'pi-motion-studio', 'scratch', `capability-${id}`), runFull: false });
        if (r?.skip) missing.push(`check file: skipped (${firstLine(r.skip)}) — the capability check needs it to run`);
        else if (r?.pass === false && /not implemented/.test(String(r.measured))) missing.push(`check file: still the scaffold stub (${firstLine(r.measured)})`);
        else if (r?.pass === false) missing.push(`check file: runs but is RED (${firstLine(r.measured)}) — the technique's own check must pass before the capability is real`);
        else present.push(`check file: engine/verify/produce/${id}.mjs runs${r?.pass ? ' — PASS' : ''}`);
      }
    } catch (e) { missing.push(`check file: engine/verify/produce/${id}.mjs threw: ${firstLine(e)}`); }
  }

  // 7. TOOLS.md — at least one tool entry line ("- `tool_name` — what it does")
  const toolsFile = join(kindDir, 'TOOLS.md');
  const tools = existsSync(toolsFile) ? [...readFileSync(toolsFile, 'utf8').matchAll(/^- `([a-z][a-z0-9_]+)`/gm)].map((m) => m[1]) : [];
  if (tools.length >= 1) present.push(`TOOLS.md: ${tools.length} tool name(s) (${tools.slice(0, 3).join(', ')}) — the lead wires them into .pi/extensions`);
  else missing.push(`TOOLS.md: engine/kinds/${id}/TOOLS.md needs >= 1 tool entry line ("- \`tool_name\` — what it does")`);

  // 8. SKILL.md — the craft paragraph
  const skill = existsSync(join(kindDir, 'SKILL.md')) ? readFileSync(join(kindDir, 'SKILL.md'), 'utf8').trim() : '';
  if (skill.length > 200) present.push(`SKILL.md: ${skill.length} chars of craft (what the viewer feels first, what survives a 360px phone, what only this technique does)`);
  else missing.push(`SKILL.md: engine/kinds/${id}/SKILL.md needs the craft paragraph (> 200 chars — now ${skill.length})`);

  return done();
}

async function checkService(id) {
  const missing = [], present = [];
  const done = () => ({ ok: missing.length === 0, missing, present, id, type: 'service' });
  const dir = join(SERVICES_DIR, id);
  const idx = join(dir, 'index.mjs');

  // 1. the frozen interface — run() may still be the scaffold's stub (the interface EXISTING is
  //    this contract's part; what run() does is the service's own correctness, its own tests)
  if (!existsSync(idx)) { missing.push(`module: engine/produce/services/${id}/index.mjs does not exist (scaffold: studio capability new ${id} --type service)`); return done(); }
  present.push(`module: engine/produce/services/${id}/index.mjs (a service module — any technique imports { run })`);
  let mod = null;
  try { mod = await freshImport(idx); }
  catch (e) { missing.push(`module: index.mjs does not load: ${firstLine(e)}`); return done(); }
  for (const fn of ['run', 'status']) {
    if (typeof mod[fn] !== 'function') missing.push(`interface ${fn}(): the frozen service interface exports it (engine/produce/services/${id}/index.mjs — run(key, opts) is the work, status() the cheap probe)`);
    else present.push(`interface ${fn}() — ${fn === 'run' ? 'the work, run(key, opts)' : 'the cheap probe, status() -> {ok, detail}'}`);
  }

  // 2. the grown row — the catalog entry the lead must add to catalog.mjs SERVICES
  const row = readGrown().find((r) => r.id === id);
  if (!row || row.type !== 'service') missing.push(`grown registry: no "${id}" service row in ${GROWN_FILE.replace(homedir(), '~')} (scaffold writes it — it carries the catalog entry for the lead)`);
  else {
    const errs = validateEntry(row.entry ?? {}, `grown.json ${id}`);
    if (errs.length) missing.push(`grown registry: the recorded entry does not validate (${errs.join('; ')})`);
    else if (row.entry.id !== id) missing.push(`grown registry: the recorded entry names id "${row.entry.id}", not "${id}"`);
    else present.push('grown registry: the row + the catalog entry the lead adds (engine/produce/catalog.mjs SERVICES)');
  }

  // 3. the catalog listing, honestly: two-step by design — listed only once the lead pasted the
  //    entry; until then the module + the grown row are what is real (reported, never faked)
  try {
    const { validatedCatalog } = await import('./catalog.mjs');
    const hit = (await validatedCatalog()).find((e) => e.id === id);
    present.push(hit
      ? `catalog: LISTED (the lead added the entry — studio capabilities knows "${id}")`
      : `catalog: not in studio capabilities yet — two-step by design (the lead pastes the entry from the grown row; the module is real meanwhile)`);
  } catch (e) { present.push(`catalog: unreadable (${firstLine(e)}) — the listing could not be checked`); }

  return done();
}

// ── removal ─────────────────────────────────────────────────────────────────────────────────

/** Take a grown capability back out: its kind dir (or service module), its check file and its
 *  grown.json row — the registry scan and the catalog no longer see it. A capability COMMITTED
 *  to git is the LEAD's to remove, never the tool's (git is the line between "grown by the
 *  producer" and "owned by the studio" — removeCapability refuses tracked paths). */
export function removeCapability(id) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(id ?? ''))) throw new Error('studio capability remove <id>: lowercase letters, digits, dashes (a letter first)');
  const kindDir = join(KINDS, id), svcDir = join(SERVICES_DIR, id), checkFile = join(CHECKS_DIR, `${id}.mjs`);
  const rows = readGrown();
  const row = rows.find((r) => r.id === id);
  const targets = [kindDir, svcDir, checkFile].filter((p) => existsSync(p));
  if (!targets.length && !row) throw new Error(`unknown capability "${id}": no kind module, no service module, no grown row — nothing to remove`);
  const tracked = spawnSync('git', ['ls-files', '--', kindDir, svcDir, checkFile], { cwd: ROOT, encoding: 'utf8' });
  const listed = String(tracked.stdout || '').split('\n').filter(Boolean);
  if (listed.length) throw new Error(`${id} is committed to git (${listed.slice(0, 3).join(', ')}${listed.length > 3 ? ` +${listed.length - 3} more` : ''}) — a committed capability is the lead's to remove, not the tool's`);
  const removed = [];
  for (const p of targets) { rmSync(p, { recursive: true, force: true }); removed.push(rel(p)); }
  if (row) { writeGrown(rows.filter((r) => r.id !== id)); removed.push(`${GROWN_FILE.replace(homedir(), '~')} (the "${id}" row)`); }
  return {
    id, removed, row,
    message: `removed ${id}: ${removed.join(', ') || '(only the grown row)'}\n  the registry scan and the catalog no longer see it (studio capabilities)`,
  };
}
