/**
 * project-tools: the producer's hands for project films (kind: "project", mission P5) — one plain-words
 * request, many parts. Every tool drives the same engine the GUI buttons and the terminal use: the CLI's
 * `studio project …` dispatches to exactly these modules (engine/kinds/project + engine/produce/*), and the
 * tools import them directly — the cases that need MORE than the CLI offers (minutes on create, the per-row
 * ledger report, the loud ship refusal that carries the why list) or that are pure reads (status) never
 * spawn a process at all. project_* never renders and never re-encodes: segments are built by their own
 * engines, assembly for mode "single" is a byte-identical copy, ship publishes what verified.
 *
 *   project_new       create the project: the request VERBATIM in brief.md + the ledgers + state.json
 *   project_status    the project's state: phase, parts (status/capability/film), budget, requirement
 *                     counts, the children's gates, what is rendered under out/, OPEN NOTES
 *   project_plan      read plan.json (goal, decision + alternatives + why, segments, deliverables,
 *                     feasibility, budget) or, with check: true, run the validator (ok/errors/warnings)
 *   project_segment   create ONE child film from the plan's row (parent link + design inherited);
 *                     role/brief/duration default to the plan row; creating does not render
 *   project_assemble  per plan.assembly.mode: "single" -> the child's finals copied into out/
 *                     byte-identical; "edit-film"/"direct" -> honestly "assembly lands with P3"
 *   project_check     the producer's green-check: the ledger (measured verifiers + subjective via
 *                     critic evidence), facts, assets, budget — a per-row report + the count
 *   project_ship      verify first (refuses loudly with the why list when red), then publish:
 *                     finals, poster, out/credits.md, out/report.md, state.json -> shipped
 *
 * Projects are films too: films/<key>/film.json with kind "project". Every tool validates the kind and
 * points at the other kinds' tools. Reviews keep using film_review (a project's rubric adds fidelity +
 * coherence). Loaded next to tools.ts/edit-tools.ts/math-tools.ts by ./index.ts.
 */
import { Type } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

type Text = { type: "text"; text: string }

const readJson = (p: string, d: any = null) => { try { return JSON.parse(readFileSync(p, "utf8")) } catch { return d } }
const text = (t: string): Text => ({ type: "text", text: t })

// The node entry points: the same modules the CLI's `studio project …` case dispatches to. Importing
// through a file URL keeps it working from pi's loader and from the tools check's harness alike.
const engine = async (m: string) => import(pathToFileURL(path.join(ROOT, "engine", m)).href as string)

const Film = Type.String({ description: "Project film key (folder under films/, made with project_new or `studio project new <key> \"<request>\"`)" })

/** The project behind a key: films/<key>/film.json must exist AND be kind "project" — the project tools
 *  drive project films only, and the error names the tools for the other kinds (the math tools' rule). */
async function projectOf(film: string) {
  const dir = path.join(ROOT, "films", film)
  if (!existsSync(path.join(dir, "film.json"))) throw new Error(`no film "${film}" (films/${film}/film.json missing)`)
  const cfg = readJson(path.join(dir, "film.json"), {})
  const { kindOf } = await engine("lib/film.mjs")
  const kind = kindOf(cfg)
  if (kind !== "project") throw new Error(`films/${film} is kind=${kind}, not project — use project_status on project films, film_status/edit_status/math_status for the other kinds`)
  return { dir, cfg }
}

export default function projectTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "project_new",
    label: "New project",
    description:
      "Create the project film that wraps a plain-words request: films/<key>/ with the request VERBATIM at " +
      "the top of brief.md, the ledgers (plan.json, requirements.json, assets.json, facts.json, budget.json), " +
      "state.json and a default design system. Pass the request exactly as the human said it — it is the " +
      "contract every requirement is measured against, and the critic reads it first. formats takes " +
      "'9:16,16:9' or an array; minutes is the time budget (soft stop at 80%, hard at 100%).",
    parameters: Type.Object({
      key: Type.String({ description: "the project's film key: lowercase letters, digits, dashes (the folder under films/)" }),
      request: Type.String({ description: "the human's request VERBATIM, plain words, exactly as they said it" }),
      formats: Type.Optional(Type.Union([Type.String({ description: "asked formats, comma-separated: '9:16,16:9'" }), Type.Array(Type.String(), { description: "asked formats: ['9:16','16:9']" })])),
      minutes: Type.Optional(Type.Union([Type.Number({ description: "time budget in minutes (default 180)" }), Type.String({ description: "time budget in minutes as a string, e.g. '240'" })])),
    }),
    async execute(_id, p) {
      // coerce: formats '9:16,16:9' | ['9:16'] -> an array of format ids; minutes '240' | 240 -> a number
      const formats: string[] = p.formats == null ? ["16:9"]
        : Array.isArray(p.formats) ? p.formats.map((f: any) => String(f).trim()).filter(Boolean)
        : String(p.formats).split(",").map((s) => s.trim()).filter(Boolean)
      const minutes = p.minutes == null ? null : Number(p.minutes)
      const P = await engine("kinds/project/index.mjs")
      const r = await P.create(p.key, { request: p.request, formats })
      const dir = path.join(ROOT, "films", p.key)
      if (minutes != null) {
        if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`minutes must be a positive number (got ${JSON.stringify(p.minutes)}) — it is the time budget: soft stop at 80%, hard stop at 100%`)
        const { writeJson } = await engine("lib/film.mjs")
        const bud = readJson(path.join(dir, "budget.json"), null)
        if (bud) writeJson(path.join(dir, "budget.json"), { ...bud, minutes })
      }
      const bud = readJson(path.join(dir, "budget.json"), {})
      return {
        content: [text([
          r.message,
          `budget: ${bud.minutes} min, $${bud.usd} (zero spend by default — every call logs to budget.json)`,
          "",
          "next:",
          "  1. write the interpretation in films/" + p.key + "/brief.md (goal in one line, the explicit + implied constraints, the assumptions)",
          "  2. write the plan (films/" + p.key + "/plan.json): decision + alternatives incl. the simplest thing that could work, segments, budget — docs/produce/SCHEMAS.md §plan.json",
          "  3. project_plan check:true validates it; project_segment creates each child; project_check verifies; project_ship ships",
        ].join("\n"))],
        details: { key: p.key, formats, minutes: bud.minutes },
      }
    },
  })

  pi.registerTool({
    name: "project_status",
    label: "Project status",
    description:
      "The project's state at a glance — read-only JSON reads, never a CLI spawn: phase, every segment with " +
      "its status/capability/child film, the budget (minutes spent + usd, its phase), requirement counts by " +
      "status, each child's gates (PASS/FAIL with the failed checks), what is rendered under out/ (the finals " +
      "list), and OPEN NOTES the user pinned in the Studio GUI (fix them first). Call it at the start of every " +
      "round; `studio project status <key>` prints the same state from the terminal.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p) {
      const { dir, cfg } = await projectOf(p.film)
      const st = readJson(path.join(dir, "state.json"), { phase: "planning", segments: {} })
      const plan = readJson(path.join(dir, "plan.json"), null)
      const parts = (cfg.parts ?? []) as string[]
      const B = await engine("produce/budget.mjs")
      const bud = B.budgetOf(p.film)
      const rows = readJson(path.join(dir, "requirements.json"), []) as any[]
      const by = (s: string) => rows.filter((r) => r.status === s).length
      const notes = (readJson(path.join(dir, "notes.json"), []) as any[]).filter((n) => !n.done)
      const gates = parts.map((c) => {
        const g = readJson(path.join(ROOT, "films", c, "gates.json"), null)
        if (!g) return `  films/${c}: gates not run yet (its own gate tool / studio gate ${c})`
        const fails = (g.checks ?? []).filter((x: any) => x.level === "fail").map((x: any) => x.name)
        return `  films/${c}: gates ${g.pass ? "PASS" : "FAIL"}${fails.length ? ` (${fails.join(", ")})` : ""}`
      })
      const outDir = path.join(dir, "out")
      const rendered = existsSync(outDir) ? readdirSync(outDir).filter((f) => /^(final-.*\.mp4|captions\.(srt|vtt)|poster-.*\.png|credits\.md|report\.md)$/i.test(f)).sort() : []
      // the segments: the plan's rows joined with state.json's truth (a plan row not created yet still shows)
      const segs: any[] = plan?.segments ?? Object.entries(st.segments ?? {}).map(([id, sg]: any) => ({ id, capability: sg.capability }))
      const segLines = segs.map((s) => {
        const sg = st.segments?.[s.id]
        return `  ${String(s.id).padEnd(6)} ${String(sg?.status ?? "not created").padEnd(11)} films/${sg?.film ?? `${p.film}-${s.id}`} (${s.capability}) — ${s.role ?? ""}`
      })
      const lines = [
        `project: ${p.film} · "${cfg.title ?? p.film}" · phase ${st.phase ?? "planning"} · formats ${(cfg.formats ?? []).join(", ")}`,
        `request: "${String(cfg.request ?? "").replace(/\s+/g, " ").slice(0, 140)}"`,
        plan ? `plan: ${plan.goal}` : "plan: none yet — write films/" + p.film + "/plan.json (project_plan check:true validates it)",
        "",
        `segments (${segs.length}):${segLines.length ? "\n" + segLines.join("\n") : " (none — the plan has no segments yet)"}`,
        `budget: ${bud.spentMinutes.toFixed(0)}/${bud.minutes} min (${bud.phase}), $${bud.spentUsd.toFixed(3)} of $${bud.usd}`,
        `requirements: ${rows.length} (${by("green")} green, ${by("pending")} pending, ${by("red")} red, ${by("waived")} waived) — project_check measures them`,
        `children's gates (${parts.length}):${gates.length ? "\n" + gates.join("\n") : " none yet (project_segment creates the children)"}`,
        `rendered (out/): ${rendered.length ? rendered.join(", ") : "nothing yet (project_assemble/ship publish the finals here)"}`,
        "",
        notes.length ? `OPEN NOTES FROM THE USER (fix these first, then mark nothing: the user resolves them in the GUI):\n${notes.map((n) => `  @${n.t}s [${n.fmt}] ${n.text}`).join("\n")}` : "open notes: none",
      ]
      return { content: [text(lines.join("\n"))], details: { phase: st.phase ?? "planning", segments: segs.length, parts: parts.length, requirements: rows.length, green: by("green"), red: by("red"), notes: notes.length } }
    },
  })

  pi.registerTool({
    name: "project_plan",
    label: "Read/validate the plan",
    description:
      "Read the project's plan.json — the technique decision and its reasons (chosen + why + the rejected " +
      "alternatives), the segments with capability/role/duration/brief/acceptance, the deliverables, the " +
      "assembly mode, the feasibility flags (missing inputs are flagged, never invented) and the budget — or, " +
      "with check: true, run the plan validator (the same one `studio project plan <key> --check` runs) and " +
      "get ok/errors/warnings. The plan is the contract: project_segment creates children from its rows and " +
      "ship refuses while it does not validate.",
    parameters: Type.Object({
      film: Film,
      check: Type.Optional(Type.Boolean({ description: "run the validator instead of reading: ok/errors/warnings (default: read the plan back)" })),
    }),
    async execute(_id, p) {
      const { dir } = await projectOf(p.film)
      if (p.check) {
        const { validatePlanFile } = await engine("produce/plan.mjs")
        const r = await validatePlanFile(path.join(dir, "plan.json"))
        const lines = [
          r.ok
            ? `plan: VALID (${(r.plan?.segments ?? []).length} segments, chosen ${r.plan?.decision?.chosen}${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ""})`
            : `plan: ${r.errors.length} error(s)${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ""}`,
          ...r.errors.map((e: string) => `  ✗ ${e}`),
          ...r.warnings.map((w: string) => `  ⚠ ${w}`),
        ]
        if (!r.ok) lines.push("fix the errors above, then project_plan check:true again — the plan is the contract every segment and requirement hangs off")
        return { content: [text(lines.join("\n"))], details: { ok: r.ok === true, errors: r.errors.length, warnings: r.warnings.length } }
      }
      const plan = readJson(path.join(dir, "plan.json"), null)
      if (!plan) return { content: [text(`plan.json is empty — write the plan first (docs/produce/SCHEMAS.md §plan.json: goal, decision + alternatives incl. the simplest thing that could work, segments, assembly, feasibility, budget, risks), then project_plan check:true to validate it`)], details: { empty: true } }
      const segs = (plan.segments ?? []) as any[]
      const lines = [
        `goal: ${plan.goal}`,
        `audience: ${plan.audience ?? "(not stated)"}`,
        `decision: ${plan.decision?.chosen} — ${plan.decision?.why}`,
        ...(plan.decision?.alternatives ?? []).map((a: any) => `  ✗ ${a.id}: ${a.rejected_because}`),
        plan.decision?.risky ? `  ⚠ risky — probes: ${(plan.decision.probes ?? []).join(", ") || "NONE (the validator rejects a risky plan without saved probe sheets)"}` : "",
        "",
        `segments (${segs.length}):`,
        ...segs.map((s) => `  ${s.id}  ${s.capability}  ${s.role}  ${s.duration}s${s.film ? `  films/${s.film}` : ""}\n    ${s.brief}\n    acceptance: ${(s.acceptance ?? []).join("; ")}`),
        "",
        `deliverables: ${(plan.deliverables ?? []).map((d: any) => `${d.type}${d.formats ? ` (${d.formats.join(", ")})` : ""}${d.duration ? ` ${d.duration}s` : ""}`).join(", ")}`,
        `assembly: ${plan.assembly?.mode ?? "(missing)"}${plan.assembly?.transitions ? ` — ${plan.assembly.transitions}` : ""}`,
        `feasibility: blocked_inputs [${(plan.feasibility?.blocked_inputs ?? []).join(", ")}] · needs_capability [${(plan.feasibility?.needs_capability ?? []).join(", ")}]`,
        `budget: ${plan.budget?.minutes} min, $${plan.budget?.usd}`,
        `risks: ${(plan.risks ?? []).join("; ") || "(none stated)"}`,
      ].filter(Boolean)
      return { content: [text(lines.join("\n"))], details: { segments: segs.length, chosen: plan.decision?.chosen ?? null, mode: plan.assembly?.mode ?? null } }
    },
  })

  pi.registerTool({
    name: "project_segment",
    label: "Create one segment",
    description:
      "Create ONE child film from a plan.json segment (the kinds/project segment link): the child's film.json " +
      "carries parent (the films list groups it under the project) and its design.json inherits the project's " +
      "one system. role/brief/duration come from the plan's row for this id when omitted; capability must " +
      "agree with the plan. Creating does NOT render — build the child in its own engine (studio project " +
      "rebuild <key> [--only <id>] runs draft + gates and marks the segment done; the kind's own tools do the " +
      "craft), then project_check measures it.",
    parameters: Type.Object({
      film: Film,
      id: Type.String({ description: "the segment's id in plan.json (s01, s02 …) — its row supplies role/brief/duration/acceptance when omitted below" }),
      capability: Type.String({ description: "the technique that makes this part (a catalog id: motion, math, edit …) — must match the plan's row" }),
      role: Type.Optional(Type.String({ description: "the part's job in the piece (default: the plan row's role)" })),
      brief: Type.Optional(Type.String({ description: "what this part shows, a sentence (default: the plan row's brief)" })),
      duration: Type.Optional(Type.Number({ description: "seconds (default: the plan row's duration)" })),
    }),
    async execute(_id, p) {
      const { dir } = await projectOf(p.film)
      const plan = readJson(path.join(dir, "plan.json"), null)
      if (!plan) throw new Error(`films/${p.film}/plan.json is empty — write the plan first (project_plan check:true validates it; a segment is created FROM its row, never invented)`)
      const row = (plan.segments ?? []).find((s: any) => s.id === p.id)
      if (!row) throw new Error(`no segment "${p.id}" in films/${p.film}/plan.json — write it into the plan first (id, capability, role, brief, duration, acceptance), then project_segment again: the plan is the contract`)
      if (row.capability && row.capability !== p.capability) throw new Error(`the plan says segment ${p.id} is "${row.capability}", not "${p.capability}" — change the plan (or the call) so they agree; the plan is the contract`)
      const seg = { ...row, id: p.id, capability: p.capability, ...(p.role != null ? { role: p.role } : {}), ...(p.brief != null ? { brief: p.brief } : {}), ...(p.duration != null ? { duration: p.duration } : {}) }
      if (seg.duration == null) throw new Error(`segment ${p.id} has no duration (neither the plan row nor the call) — write it into plan.json (seconds) and re-run project_plan check:true`)
      const P = await engine("kinds/project/index.mjs")
      const r = await P.segment(p.film, seg, { build: false })
      const childCfg = readJson(path.join(ROOT, "films", r.key, "film.json"), {})
      const dChild = readJson(path.join(ROOT, "films", r.key, "design.json"), {})
      return {
        content: [text([
          `segment ${p.id} (${p.capability}) -> films/${r.key}${r.existed ? " (an existing film, linked)" : " (created)"}`,
          `  film.json carries parent: ${childCfg.parent} — the films list groups it under films/${p.film}`,
          `  design inherited: ${dChild.inheritedFrom ?? "(the child kept its own design)"} — one system for the whole piece`,
          `  ${seg.duration}s · role: ${seg.role ?? p.id}`,
          `next: build the child in its own engine — \`studio project rebuild ${p.film} --only ${p.id}\` runs draft + gates and marks the segment done; the kind's own tools (film_*/edit_*/math_*) do the craft`,
        ].join("\n"))],
        details: { key: r.key, parent: childCfg.parent ?? null, inheritedFrom: dChild.inheritedFrom ?? null, existed: r.existed === true },
      }
    },
  })

  pi.registerTool({
    name: "project_assemble",
    label: "Assemble the piece",
    description:
      "Put the piece together per the plan's assembly.mode — honestly, and NEVER a re-encode: mode 'single' " +
      "(one technique, one part) is a thin wrapper — the child's finals are copied into out/ byte-identical, " +
      "with its captions; modes 'edit-film'/'direct' (designed joins, one mix at the target loudness) land with " +
      "P3 and this says exactly that, naming where the segments' finals are, instead of inventing finals. " +
      "After a single copy: project_check measures the deliverables, project_ship publishes.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p) {
      const { dir, cfg } = await projectOf(p.film)
      const plan = readJson(path.join(dir, "plan.json"), null)
      if (!plan) throw new Error(`films/${p.film}/plan.json is empty — write the plan first (its assembly.mode says how the piece is put together)`)
      const mode = plan.assembly?.mode
      if (!mode) throw new Error(`plan.assembly.mode is missing — edit-film (designed joins) | direct | single (one technique: the child's finals ARE the finals) — docs/produce/SCHEMAS.md §plan.json`)
      if (mode === "single") {
        const { ensureFinals } = await engine("produce/ship.mjs")
        const r = ensureFinals(p.film)   // byte-identical copies only — the wrapper never re-encodes
        return {
          content: [text([
            `assembly: single — one technique, one part: the child's finals ARE the project's finals`,
            `copied from films/${r.child} into films/${p.film}/out/ (byte-identical copies, never re-encoded):`,
            ...(r.copied ?? []).map((f: string) => `  ${f}`),
            `next: project_check measures the deliverables against the requirements, then project_ship publishes`,
          ].join("\n"))],
          details: { mode, copied: r.copied ?? [], child: r.child ?? null },
        }
      }
      // composite modes: the assembler (P3) owns the joins — say so honestly, name where the parts are
      const children = (cfg.parts ?? []) as string[]
      const finals = children.flatMap((c) => {
        const o = path.join(ROOT, "films", c, "out")
        return existsSync(o) ? readdirSync(o).filter((f) => /^final-.*\.mp4$/.test(f)).map((f) => `films/${c}/out/${f}`) : []
      })
      return {
        content: [text([
          `assembly lands with P3 (the assembler): the plan says mode "${mode}" — designed joins and one mix at the target loudness, not a copy.`,
          `the segments' finals are at:`,
          ...(finals.length ? finals.map((f) => `  ${f}`) : ["  (none rendered yet — build the parts first)"]),
          `until assembly runs, project_ship refuses honestly (verify: no out/final-*.mp4) — no invented finals, ever.`,
        ].join("\n"))],
        details: { mode, finals },
      }
    },
  })

  pi.registerTool({
    name: "project_check",
    label: "Check the project",
    description:
      "The producer's own green-check between review rounds — the ledger and the ledgers around it: " +
      "runLedger measures every measurable requirement against the finals (ffprobe'd evidence, never " +
      "asserted), subjective rows resolve through critic evidence (a film_review round with the rubric keys " +
      "8+ and saved sheets — without it they cannot pass, honestly), fact rows through the facts ledger, " +
      "plus verifyFacts, verifyAssets and verifyBudget. One compact line per row (id, status, evidence) and " +
      "the count. Not the gates (project_status shows them) and not the plan (project_plan check:true) — " +
      "`studio project verify <key>` is the full pre-ship contract.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p) {
      const { dir } = await projectOf(p.film)
      const L = await engine("produce/ledger.mjs")
      const F = await engine("produce/facts.mjs")
      const A = await engine("produce/assets.mjs")
      const B = await engine("produce/budget.mjs")
      const meas = await L.runLedger(p.film, {})   // measurable (measured) + subjective (verifySubjective)
      let facts: any = null, factsWhy = ""
      try { facts = F.verifyFacts(p.film) } catch (e: any) { factsWhy = String(e.message || e).split("\n")[0] }
      let assets: any = { ok: false, rows: [] }, assetsWhy = ""
      try { assets = A.verifyAssets(p.film) } catch (e: any) { assetsWhy = String(e.message || e).split("\n")[0] }
      const bud = B.verifyBudget(p.film)
      // fact-typed rows resolve through the facts ledger (the same resolution verifyProject uses)
      const factOf = (r: any) => {
        if (facts === null) return { status: "red", evidence: `the facts ledger could not be read: ${factsWhy}` }
        if (!r.fact) return { status: "red", evidence: `a fact-typed requirement must name its facts.json id (fact: "f01")` }
        const row = facts.rows.find((f: any) => f.id === r.fact)
        if (!row) return { status: "red", evidence: `no fact "${r.fact}" in films/${p.film}/facts.json` }
        return { status: row.status, evidence: `${r.fact}: ${row.why}` }
      }
      const rows = (meas.rows ?? []).map((r: any) => (r.type === "fact" && r.status !== "waived" ? { ...r, ...factOf(r) } : { ...r }))
      L.writeStatuses(p.film, rows)   // the measured truth lands in requirements.json — verify does the same
      const one = (r: any) => `${r.id} ${String(r.status ?? "?").padEnd(7)} ${r.text} — ${String(r.evidence ?? "").split("\n")[0].slice(0, 170)}`
      const n = (s: string) => rows.filter((r: any) => r.status === s).length
      const green = n("green"), waived = n("waived"), red = n("red"), pending = n("pending")
      const lines = [
        `requirements (${rows.length} rows):`,
        ...rows.map(one),
        facts ? `facts (${facts.rows.length}): ${facts.rows.map((f: any) => `${f.id} ${f.status}`).join(", ") || "none recorded"}` : `facts: the ledger could not be read — ${factsWhy}`,
        assets ? `assets (${assets.rows.length}): ${assets.rows.map((a: any) => `${a.id} ${a.status}`).join(", ") || "none recorded"}` : `assets: the ledger could not be read — ${assetsWhy}`,
        `budget: ${bud.ok ? "held" : "NOT held"} — ${bud.spentMinutes.toFixed(0)}/${bud.minutes} min (${bud.phase}), $${bud.spentUsd.toFixed(3)} of $${bud.usd} (${bud.calls} call(s))`,
        "",
        `check: ${green + waived}/${rows.length} requirement rows green (${red} red, ${pending} pending, ${waived} waived)${red ? " — fix the reds (a subjective row passes only with a critic round: film_review, every rubric key 8+, sheets saved)" : ""}`,
      ]
      return { content: [text(lines.join("\n"))], details: { total: rows.length, green: green + waived, red, pending, waived, facts: facts ? facts.ok : false, assets: assets.ok === true, budget: bud.ok === true } }
    },
  })

  pi.registerTool({
    name: "project_ship",
    label: "Ship the project",
    description:
      "Ship the project: the deliverables are published (a single-technique project's finals are the child's, " +
      "byte-identical — never a re-encode), then the FULL verify runs first and ship REFUSES LOUDLY with the " +
      "why list when anything is red (the plan must validate, every requirement green — subjective rows need " +
      "a review round first — facts/assets/budget clean, the children's gates PASS, the deliverables present). " +
      "On green: poster, out/credits.md and out/report.md are written, state.json goes shipped. The human gets " +
      "the report; revisions append requirements and rebuild only what they touch.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p) {
      const { dir } = await projectOf(p.film)
      const S = await engine("produce/ship.mjs")
      const fin = S.ensureFinals(p.film)   // byte-identical publish for mode single; a no-op for composite
      const v = await S.verifyProject(p.film)
      if (!v.pass) {
        throw new Error([
          `ship refuses — films/${p.film} does not verify (${v.why.length} problem(s)):`,
          ...v.why.map((w: string) => `  ✗ ${w}`),
          "",
          "fix the reds above, then project_ship again (project_check runs the same verifiers row by row; `studio project verify <key>` is the full contract)",
        ].join("\n"))
      }
      await S.shipProject(p.film)
      const out = readdirSync(path.join(dir, "out")).sort()
      return {
        content: [text([
          `shipped films/${p.film} — verify green first, then publish:`,
          ...out.map((f) => `  ${f}`),
          `report: films/${p.film}/out/report.md · credits: films/${p.film}/out/credits.md`,
          `state: shipped (films/${p.film}/state.json) — a revision appends requirements and rebuilds only the parts it touches`,
        ].join("\n"))],
        details: { files: out, finals: fin.copied ?? [], pass: true },
      }
    },
  })
}
