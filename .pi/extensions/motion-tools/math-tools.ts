/**
 * math-tools: the studio's hands and eyes for math films (kind: "math", mission M8) — the exact
 * same shape as tools.ts/edit-tools.ts: every tool drives the same engine the GUI buttons and the
 * terminal use (the CLI through the studio() helper where the CLI case exists, the node module
 * where it does not yet), and looks at its own sheets. math_look/math_scene return IMAGES.
 *
 *   math_status   the math film state: film.json, scenes + their rendered seconds, sentences and
 *                 voice, timing, the merged claims ledger, gates, OPEN NOTES, what's rendered
 *   math_script   parse script.md (stable sentence ids, bookmarks) or lint it (raw symbols)
 *   math_voice    build the narration (all sentences, or re-voice one); native word timings
 *   math_scene    check ONE scene (typeset + claims, no video) or draft-render it + its sheet
 *   math_look     a labelled contact sheet as an IMAGE (every/sentences/bookmarks/sections/phone/strip/times)
 *   math_check    checkMathFilm (all scenes, dry) + the layout lint from the records; --independent
 *                 re-evaluates every claim in a fresh sympy process from its text alone
 *   math_render   renderMathFilm (draft/final, per format) with {rendered, cached, seconds}
 *   math_gate     the math gates (runMathGates) — FAIL blocks ship
 *   math_where    which scene, sentence, animation and file:line owns a timecode
 *
 * This machine runs ONE Manim render at a time (6.8 GB shared): every tool that may start a
 * manim process first takes the render window (pgrep '-m manim render', sustained quiet, up to
 * 120 s x 3). Reviews keep using film_review (the 7 rubric keys + correctness + clarity).
 * Loaded next to tools.ts/edit-tools.ts by ./index.ts.
 */
import { Type } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const CLI = path.join(ROOT, "engine", "cli.mjs")

type Text = { type: "text"; text: string }
type Img = { type: "image"; data: string; mimeType: string }

function studio(args: string[], signal?: AbortSignal, onLine?: (l: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd: ROOT })
    let out = ""
    const take = (d: Buffer) => { const s = String(d); out += s; if (onLine) s.split("\n").filter(Boolean).forEach(onLine) }
    p.stdout.on("data", take); p.stderr.on("data", take)
    const kill = () => p.kill("SIGTERM")
    signal?.addEventListener("abort", kill, { once: true })
    p.on("close", (code) => { signal?.removeEventListener("abort", kill); ok({ code: code ?? 1, out: out.trim() }) })
  })
}

const readJson = (p: string, d: any = null) => { try { return JSON.parse(readFileSync(p, "utf8")) } catch { return d } }
const text = (t: string): Text => ({ type: "text", text: t })
const fail = (what: string, out: string) => { throw new Error(`${what} failed:\n${out.slice(-4000)}`) }
const relOf = (f: string) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f)

// The node entry points (M8): import the module where the CLI case does not exist yet. Importing
// through a file URL keeps it working from pi's loader and from the tools check's harness alike.
const engine = async (m: string) => import(pathToFileURL(path.join(ROOT, "engine", m)).href as string)

// -- the render window: ONE manim render at a time on this machine --------------------------------
// '-m manim render' matches the real processes (the runner spawns `python -m manim render …`,
// check runs too: `… --dry_run`); wrapper shells that merely EMBED the pattern in their own
// command line (a sibling's pgrep guard, a monitor) are filtered out by /proc/<pid>/comm — only
// actual python processes hold the window.
function manimRenders(): string[] {
  try {
    const r = spawnSync("pgrep", ["-f", "--", "-m manim render"], { encoding: "utf8" })
    return (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean).filter((pid) => {
      try { return /^python/.test(readFileSync(`/proc/${pid}/comm`, "utf8").trim()) } catch { return false }
    })
  } catch { return [] }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function renderWindow(what: string): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const deadline = Date.now() + 120_000
    let quiet = 0
    while (Date.now() < deadline) {
      const busy = manimRenders()
      quiet = busy.length ? 0 : quiet + 1
      if (quiet >= 3) return // ~6 s of sustained quiet: a sibling's mid-run gap is 1-3 s
      await sleep(busy.length ? 3000 : 2000)
    }
  }
  throw new Error(`${what}: another Manim render is running (pids ${manimRenders().join(" ")}). This machine runs ONE manim render at a time (6.8 GB RAM shared with siblings) — wait for it to finish and retry.`)
}

const Film = Type.String({ description: "Math film key (folder name under films/, made with `studio new <key> --math`)" })
const Fmt = Type.Optional(Type.String({ description: "Format: '16:9' | '9:16' | '1:1' | '4:5'. Default: the film's first format." }))
const Scene = Type.String({ description: "Scene id (the scenes/*.py file name), e.g. 's02_meaning'" })

// claims ledgers across formats merge by (expr, says) — the same key studio_manim.claims.merge_ledgers uses
function mergedClaims(dir: string, formats: string[]): { total: number; ok: number; failed: number; scenes: string[] } {
  const seen = new Map<string, any>()
  const scenes = new Set<string>()
  for (const f of formats) {
    const d = path.join(dir, "records", f.replace(":", "x"))   // Windows-safe records dir (16x9)
    if (!existsSync(d)) continue
    for (const file of readdirSync(d).filter((x) => x.endsWith("-claims.json"))) {
      for (const c of readJson(path.join(d, file), []) as any[]) {
        const k = `${c.expr}\u0000${c.says ?? ""}`
        if (!seen.has(k)) { seen.set(k, c); if (c.scene) scenes.add(c.scene) }
      }
    }
  }
  const rows = [...seen.values()]
  return { total: rows.length, ok: rows.filter((c) => c.ok === true).length, failed: rows.filter((c) => c.ok !== true).length, scenes: [...scenes] }
}

export default function mathTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "math_status",
    label: "Math film status",
    description:
      "The math film's state: film.json (kind/lang/voice/captions/mix), scenes with their last rendered " +
      "seconds per format, sentences (count, voiced?), timing (duration, native/proportional), the merged " +
      "claims ledger (total + verified), the last gates run, OPEN NOTES the user pinned in the Studio GUI " +
      "(timecoded: fix them first) and what is rendered. Call it at the start of every round.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p) {
      const dir = path.join(ROOT, "films", p.film)
      if (!existsSync(path.join(dir, "film.json"))) throw new Error(`no film "${p.film}" (films/${p.film}/film.json missing)`)
      const cfg = readJson(path.join(dir, "film.json"), {})
      const { kindOf } = await engine("lib/film.mjs")
      if (kindOf(cfg) !== "math") throw new Error(`films/${p.film} is kind=${kindOf(cfg)}, not math (film_status/edit_status for the other kinds)`)
      const design = readJson(path.join(dir, "design.json"), {})
      const timing = readJson(path.join(dir, "timing.json"), {})
      const sentences: any[] = timing?.sentences ?? []
      const notes = (readJson(path.join(dir, "notes.json"), []) as any[]).filter((n) => !n.done)
      const gates = readJson(path.join(dir, "gates.json"))
      const sceneIds = existsSync(path.join(dir, "scenes")) ? readdirSync(path.join(dir, "scenes")).filter((f) => f.endsWith(".py")).sort().map((f) => f.replace(/\.py$/, "")) : []
      const secs = (id: string) => (cfg.formats as string[]).map((f) => {
        const s = readJson(path.join(dir, "records", f.replace(":", "x"), `${id}-timeline.json`), {})?.seconds
        return s ? `${f} ${(+s).toFixed(1)}s` : null
      }).filter(Boolean).join(", ")
      const voiced = sentences.filter((s) => s.audio && existsSync(s.audio)).length
      const claims = mergedClaims(dir, cfg.formats ?? [])
      const outDir = path.join(dir, "out")
      const rendered = existsSync(outDir) ? readdirSync(outDir).filter((f) => /\.(mp4|wav|srt|vtt|md)$/i.test(f)).sort() : []
      const gateLines = gates
        ? `gates (${gates.at}): ${gates.pass ? "PASS" : "FAIL"}\n${(gates.checks ?? []).filter((c: any) => c.level !== "pass").map((c: any) => `  ${String(c.level ?? "?").toUpperCase()} ${c.name}: ${c.detail}`).join("\n") || "  all pass"}`
        : "gates: not run yet (math_gate / studio gate)"
      const lines = [
        `film: ${p.film} · kind math · "${cfg.title ?? ""}" · ${cfg.duration ?? 0}s @ ${cfg.fps ?? 60}fps · ${cfg.formats?.join(", ")}`,
        `lang ${cfg.lang ?? "en"} · voice ${cfg.voice ?? "(default piper)"} · captions ${cfg.captions ?? "auto"} · music ${cfg.music ?? "none"} · mix ${cfg.mix?.lufs ?? -16} LUFS`,
        `direction: ${design.direction ?? "(design.json missing)"}`,
        "",
        `scenes (${sceneIds.length}):${sceneIds.map((id) => `\n  ${id}  ${secs(id) || "not rendered yet"}`).join("")}`,
        `sentences: ${sentences.length} (${voiced} voiced) · timing ${timing?.timing ?? "none"} · ${timing?.duration ? `${(+timing.duration).toFixed(2)}s of narration` : "no timing.json (math_voice / studio sound writes it)"}`,
        `claims: ${claims.total} merged (${claims.ok} verified${claims.failed ? `, ${claims.failed} NOT ok — fix before shipping` : ""}) across ${claims.scenes.length} scene${claims.scenes.length === 1 ? "" : "s"}`,
        "",
        notes.length ? `OPEN NOTES FROM THE USER (fix these first, then mark nothing: the user resolves them in the GUI):\n${notes.map((n) => `  @${n.t}s [${n.fmt}] ${n.text}`).join("\n")}` : "open notes: none",
        "",
        gateLines,
        "",
        rendered.length ? `rendered: ${rendered.join(", ")}` : "rendered: nothing yet (math_scene quality draft, or math_render quality draft)",
      ]
      return { content: [text(lines.join("\n"))], details: { scenes: sceneIds.length, sentences: sentences.length, voiced, claims: claims.total, claimsOk: claims.ok, notes: notes.length } }
    },
  })

  pi.registerTool({
    name: "math_script",
    label: "Parse/lint script",
    description:
      "Parse films/<film>/script.md into sentences (stable ids s01.1…, bookmarks {like_this}, scene " +
      "order) or lint it: raw symbols a voice would mangle (x^2, λ, ≤, π…) flagged with the sentence id " +
      "and line — say them in words or add a lexicon.json respelling. The sentence ids are what scenes' " +
      "say()/at()/until() and the claims' says= reference; they stay stable when other sentences change.",
    parameters: Type.Object({
      film: Film,
      action: Type.Optional(Type.Union([Type.Literal("parse"), Type.Literal("lint")])),
    }),
    async execute(_id, p) {
      const N = await engine("narration.mjs")
      const r = await N.parseScript(p.film)
      const per = r.sentences.map((s: any) =>
        `  [${s.id}] ${s.scene}: ${s.spoken.slice(0, 72)}${s.spoken.length > 72 ? "…" : ""}${(s.bookmarks ?? []).length ? `  {${s.bookmarks.map((b: any) => b.id).join(", ")}}` : ""}`)
      const lint = r.lint ?? []
      const warn = r.warnings ?? []
      const head = [
        `script: ${r.sentences.length} sentences in ${r.scenes.length} scenes (${r.scenes.map((s: any) => s.id).join(" → ")})`,
        ...(p.action === "lint" ? [] : per),
      ]
      if (p.action === "lint" || lint.length || warn.length) {
        head.push("", lint.length ? `LINT (${lint.length}) — raw symbols in the spoken text:` : "lint: clean (no raw symbols)",
        ...lint.map((l: any) => `  ${l.message}`),
        ...(warn.length ? [`warnings:`, ...warn.map((w: any) => `  ${w}`)] : []),
        `${r.sentences.reduce((a: number, s: any) => a + (s.spoken ?? "").split(/\s+/).length, 0)} words — at ~150 wpm that is ~${(r.sentences.reduce((a: number, s: any) => a + (s.spoken ?? "").split(/\s+/).length, 0) / 150).toFixed(1)} min of narration`,
      )
      }
      return { content: [text(head.join("\n"))], details: { sentences: r.sentences.length, scenes: r.scenes.length, lint: lint.length } }
    },
  })

  pi.registerTool({
    name: "math_voice",
    label: "Build narration",
    description:
      "Build the film's narration (Piper, deterministic, native sample-exact word timings) and write " +
      "timing.json: every sentence's start/end, words and bookmarks — the scenes read it, never " +
      "hard-code times. Pass sentence to re-voice exactly that one (changing a sentence re-voices only " +
      "it and re-renders only the scenes whose timing changed). Bring your own narration.wav instead " +
      "with `node engine/cli.mjs` narration alignNarration (ADR-003: piper default, kokoro fallback).",
    parameters: Type.Object({
      film: Film,
      sentence: Type.Optional(Type.String({ description: "Sentence id to re-voice, e.g. 's02.1' (default: all missing)" })),
    }),
    async execute(_id, p) {
      const N = await engine("narration.mjs")
      // D-014's rule for derived writes: a re-voice that lands on IDENTICAL content (deterministic
      // piper: same text + voice -> same samples -> same timing) must not touch timing.json's mtime,
      // or every draft looks stale and every look re-renders. Snapshot, voice, restore on equality.
      const timingFile = path.join(ROOT, "films", p.film, "timing.json")
      const snap = existsSync(timingFile) ? { content: readFileSync(timingFile, "utf8"), atime: statSync(timingFile).atime, mtime: statSync(timingFile).mtime } : null
      const r = await N.buildVoice(p.film, { only: p.sentence })
      if (snap && readFileSync(timingFile, "utf8") === snap.content) utimesSync(timingFile, snap.atime, snap.mtime)
      return {
        content: [text([
          `voice ${r.voice} (length_scale ${r.length_scale}): ${r.sentences.length} sentences, ${r.voiced.length} (re)voiced${p.sentence ? ` (${p.sentence})` : ""}`,
          `timing: ${r.timing} word timings · ${r.sample_rate} Hz · ${r.duration.toFixed(2)}s of narration (+0.15s gaps) → films/${p.film}/timing.json`,
          "next: write the scenes against say()/at()/until() (they wait for, and never outrun, the narration), then math_scene.",
        ].join("\n"))],
        details: { sentences: r.sentences.length, voiced: r.voiced.length, duration: r.duration, timing: r.timing },
      }
    },
  })

  pi.registerTool({
    name: "math_scene",
    label: "Check/draft one scene",
    description:
      "One scene of a math film. quality 'check' = the dry run (typesetting + claims + records, no " +
      "video; ~8 s) — run it often while writing. quality 'draft' = render that scene alone (default " +
      "format or fmt) and return ITS contact sheet as an image: the frames are the scene from t=0 (the " +
      "one-scene draft replaces out/draft-<fmt>.mp4 until the next full render; the sheet's scene label " +
      "maps film positions, so for a mid-film scene trust the times). One Manim render at a time on " +
      "this machine: the tool waits for the window.",
    parameters: Type.Object({
      film: Film,
      scene: Type.String({ description: "Scene id, e.g. 's02_meaning' (required — this is the one-scene tool)" }),
      quality: Type.Optional(Type.Union([Type.Literal("check"), Type.Literal("draft")])),
      fmt: Fmt,
    }),
    async execute(_id, p, signal) {
      if (p.quality === "draft") {
        await renderWindow(`math_scene ${p.film} ${p.scene}`)
        const args = ["scene", p.film, p.scene]
        if (p.fmt) args.push("--fmt", p.fmt)
        const r = await studio(args, signal)
        if (r.code) fail("math_scene", r.out)
        const fmt = p.fmt || readJson(path.join(ROOT, "films", p.film, "film.json"), {}).formats?.[0] || "16:9"
        const look = await studio(["look", p.film, "--mode", "every", "--fmt", fmt], signal)
        if (look.code) fail("math_scene (look)", look.out)
        const relp = look.out.split("\n").pop()!.split("  ")[0]
        const content: (Text | Img)[] = [
          text(`${r.out}\n${look.out}\n\nFrames above are scene "${p.scene}" rendered ALONE (times are scene-local; the sheet's scene label maps film positions). Sheet: ${relp}. Score what you see, name problems with timestamps.`),
          { type: "image", data: readFileSync(path.join(ROOT, relp)).toString("base64"), mimeType: "image/png" },
        ]
        return { content, details: { scene: p.scene, fmt, sheet: relp } }
      }
      const args = ["check", p.film, "--scene", p.scene]
      await renderWindow(`math_scene check ${p.film} ${p.scene}`)
      const r = await studio(args, signal)
      return { content: [text(r.out)], details: { pass: r.code === 0, scene: p.scene } }
    },
  })

  pi.registerTool({
    name: "math_look",
    label: "Look at the math film",
    description:
      "A labelled contact sheet of the math film as an IMAGE — every frame carries time, scene, " +
      "sentence id and the narration text. Modes: 'every' (every N s), 'sentences' (mid-sentence), " +
      "'bookmarks' (at each {bookmark}), 'sections' (mid-scene), 'strip' (n consecutive frames from " +
      "`at`: pops, jitter, ghost dissolves), 'times' (explicit list), 'phone' (360px wide every 1s: " +
      "the readability test). A stale draft is re-rendered first (one render at a time on this " +
      "machine: the tool waits for the window). Be a harsh critic: you are checking your own work.",
    parameters: Type.Object({
      film: Film,
      mode: Type.Optional(Type.Union(["every", "sentences", "bookmarks", "sections", "phone", "strip", "times"].map((m) => Type.Literal(m)))),
      every: Type.Optional(Type.Number({ description: "seconds between frames for mode 'every' (default 0.5)" })),
      at: Type.Optional(Type.Number({ description: "start time for mode 'strip'" })),
      n: Type.Optional(Type.Number({ description: "frame count for mode 'strip' (default 12)" })),
      times: Type.Optional(Type.Array(Type.Number(), { description: "seconds, for mode 'times'" })),
      fmt: Fmt,
      width: Type.Optional(Type.Number({ description: "thumbnail width px (default 270-360)" })),
    }),
    async execute(_id, p, signal) {
      // lookMath re-renders a STALE draft before extracting frames: take the render window only then
      const M = await engine("math.mjs")
      const MC = await engine("math-cli.mjs")
      const film = M.readMathFilm(p.film)
      const fmt = p.fmt || film.cfg.formats?.[0] || "16:9"
      if (MC.draftStale(film, path.join(film.out, `draft-${fmt.replace(":", "x")}.mp4`)))
        await renderWindow(`math_look ${p.film} (stale draft re-render)`)
      const args = ["look", p.film, "--mode", p.mode ?? "every"]
      if (p.every) args.push("--every", String(p.every))
      if (p.at != null) args.push("--at", String(p.at))
      if (p.n) args.push("--n", String(p.n))
      if (p.times?.length) args.push("--times", p.times.join(","))
      if (p.fmt) args.push("--fmt", p.fmt)
      if (p.width) args.push("--width", String(p.width))
      const r = await studio(args, signal)
      if (r.code) fail("math_look", r.out)
      const relp = r.out.split("\n").pop()!.split("  ")[0]
      const content: (Text | Img)[] = [
        text(`${r.out}\n\nSheet: ${relp} (also visible in the Studio GUI → Sheets). Score what you see, name problems with timestamps.`),
        { type: "image", data: readFileSync(path.join(ROOT, relp)).toString("base64"), mimeType: "image/png" },
      ]
      return { content, details: { file: relp } }
    },
  })

  pi.registerTool({
    name: "math_check",
    label: "Check the math film",
    description:
      "checkMathFilm: every scene's dry run — typesetting compiles, every claim evaluates true, the " +
      "layout records are written — a fraction of a render. The claims ledger is merged across formats " +
      "and counted; pass independent:true to re-evaluate every claim in a FRESH sympy process from its " +
      "text alone (the critic's oracle: nothing is trusted because a scene said so). Fix every FAIL " +
      "before drafting. One capped python per leg; one render window.",
    parameters: Type.Object({
      film: Film,
      scene: Type.Optional(Type.String({ description: "Only this scene (default: all)" })),
      independent: Type.Optional(Type.Boolean({ description: "Re-evaluate the merged claims ledger in fresh processes (default false)" })),
    }),
    async execute(_id, p) {
      await renderWindow(`math_check ${p.film}`) // checkMathFilm spawns `manim render --dry_run` per scene
      const M = await engine("math.mjs")
      const rows = await M.checkMathFilm(p.film, { scene: p.scene })
      const bad = rows.filter((x: any) => !x.ok)
      const lines = [
        ...rows.map((r: any) => (r.ok ? `ok    ${r.scene}: typeset + ${r.claims} claim(s)` : `FAIL  ${r.scene}:\n${r.error}`)),
        `check: ${rows.length - bad.length}/${rows.length} scenes clean${bad.length ? " — fix the FAILs above (file:line is in the error)" : ""}`,
      ]
      let indep = null
      if (p.independent) {
        const dir = path.join(ROOT, "films", p.film)
        const cfg = readJson(path.join(dir, "film.json"), {})
        const claims = mergedClaims(dir, cfg.formats ?? [])
        if (!claims.total) lines.push("independent: no claims in the records yet (render or check first)")
        else {
          // hygiene: scratch lives under ~/.cache (never films/, never the repo)
          const { homedir } = await import("node:os")
          const scratch = path.join(homedir(), ".cache", "pi-motion-studio", "scratch")
          const { mkdirSync, writeFileSync, rmSync } = await import("node:fs")
          mkdirSync(scratch, { recursive: true })
          const file = path.join(scratch, `${p.film}-independent.json`)
          const ledger = []
          for (const f of cfg.formats ?? []) {
            const d = path.join(dir, "records", f.replace(":", "x"))
            if (!existsSync(d)) continue
            for (const x of readdirSync(d).filter((y) => y.endsWith("-claims.json")))
              for (const c of readJson(path.join(d, x), []) as any[])
                if (!ledger.some((l: any) => l.expr === c.expr && l.says === c.says)) ledger.push({ expr: c.expr, ok: c.ok, ...(c.tol != null ? { tol: c.tol } : {}) })
          }
          writeFileSync(file, JSON.stringify(ledger))
          try {
            const C = await engine("lib/capped.mjs")
            const D = await engine("doctor.mjs")
            const r = await C.runCapped(D.pythonFor("manim"), ["-W", "ignore", "-m", "studio_manim.claims", "--independent", file],
              { cwd: path.join(ROOT, "engine", "manim"), memoryMb: C.CAPS.check, timeoutS: 120, label: `math_check independent ${p.film}`,
                env: { PYTHONPATH: path.join(ROOT, "engine", "manim") } })
            if (r.killed) throw new Error(`independent re-evaluation killed (${r.reason})`)
            if (r.code !== 0) throw new Error(`--independent exited ${r.code}:\n${(r.err || r.out).slice(-600)}`)
            const out = JSON.parse((r.out.trim().split("\n").at(-1)))
            const agree = out.filter((x: any) => x.agrees === true).length
            indep = { total: out.length, agree }
            lines.push(`independent: ${agree}/${out.length} claims re-derived in fresh sympy processes from their text alone${agree === out.length ? "" : ` — DISAGREES:\n${out.filter((x: any) => x.agrees !== true).map((x: any) => `  ${x.expr} (ledger ok=${x.ok}, independent ok=${x.independent_ok ?? "?"})`).join("\n")}`}`)
          } finally { (await import("node:fs")).rmSync(file, { force: true }) }
        }
      }
      return { content: [text(lines.join("\n"))], details: { ok: rows.length - bad.length, scenes: rows.length, independent: indep } }
    },
  })

  pi.registerTool({
    name: "math_render",
    label: "Render math film",
    description:
      "renderMathFilm: 'draft' = half-res 30fps (fast, cached per scene — a warm re-render is a " +
      "concat); 'final' = full-res at the film's fps. fmt renders one format, default all of " +
      "film.json's. Reports rendered vs cached scenes and the seconds per format; out/mix.wav is muxed " +
      "in as AAC when present. One manim render at a time on this machine: the tool waits for the window.",
    parameters: Type.Object({
      film: Film,
      quality: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("final")])),
      fmt: Type.Optional(Type.String({ description: "'16:9' | '9:16' | '1:1' | '4:5' (default: every format of the film)" })),
    }),
    async execute(_id, p, signal) {
      await renderWindow(`math_render ${p.film}`)
      const M = await engine("math.mjs")
      const rows = await M.renderMathFilm(p.film, { quality: p.quality ?? "draft", fmt: p.fmt })
      const lines = rows.map((r: any) =>
        `${r.quality}-${r.fmt}: ${relOf(r.file)}  ${r.seconds.toFixed ? r.seconds.toFixed(2) : r.seconds}s (${r.scenes} scene${r.scenes === 1 ? "" : "s"}; ${r.rendered} rendered, ${r.cached} cached)`)
      return { content: [text(lines.join("\n") || "nothing rendered")], details: { rendered: rows.reduce((a: number, r: any) => a + r.rendered, 0), cached: rows.reduce((a: number, r: any) => a + r.cached, 0), seconds: rows.reduce((a: number, r: any) => a + r.seconds, 0), files: rows.map((r: any) => relOf(r.file)) } }
    },
  })

  pi.registerTool({
    name: "math_gate",
    label: "Run math gates",
    description:
      "The math gates (engine/math-gates.mjs, written to gates.json): layout (lint: offscreen, " +
      "overlap, size, contrast), claims (every claim true, coverage), typeset, narration (every " +
      "sentence voiced, scenes cover their narration), sync, pace, captions, loudness (mix.lufs ±1, " +
      "≤ -1 dBTP), deliverable, deterministic. Reads the rendered records + runs the lint and claims " +
      "drivers (capped pythons, ffmpeg) — it renders nothing itself. FAIL blocks ship; WARN is for " +
      "your judgement.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p, signal) {
      const file = path.join(ROOT, "engine", "math-gates.mjs")
      if (!existsSync(file))
        throw new Error(`math gates module missing: engine/math-gates.mjs does not exist in this checkout — the tool imports runMathGates(key, {log}) → {pass, checks} from it and writes gates.json (studio gate/ship dispatch for kind math rides the same module). Until it exists: math_check (claims + typesetting) + math_look are the pre-ship checks.`)
      const G = await engine("math-gates.mjs")
      const r = await G.runMathGates(p.film, { log: () => {} })
      const table = (r.checks ?? []).map((c: any) =>
        `  ${String(c.level ?? (c.ok === false ? "fail" : c.ok === true ? "pass" : "warn")).toUpperCase().padEnd(4)} ${c.name}: ${c.detail ?? ""}`)
      return {
        content: [text([`gates ${r.pass ? "PASS" : "FAIL"} (films/${p.film}/gates.json)`, ...table].join("\n"))],
        details: { pass: r.pass === true, warn: (r.checks ?? []).filter((c: any) => (c.level ?? "") === "warn").length },
      }
    },
  })

  pi.registerTool({
    name: "math_where",
    label: "Locate a timecode",
    description:
      "Which scene, sentence, animation and file:line owns a timecode — resolveWhere, the same " +
      "resolver `studio where` and the GUI's Notes tab use. A note pinned at 49.27s must lead " +
      "straight to the code. Pass fmt to resolve against that format's records.",
    parameters: Type.Object({
      film: Film,
      t: Type.Number({ description: "seconds into the film" }),
      fmt: Fmt,
    }),
    async execute(_id, p) {
      const W = await engine("where.mjs")
      const r = W.resolveWhere(p.film, p.t, p.fmt)
      if (r.error) throw new Error(r.error)
      const s = r.sentence
      const a = r.animation
      const lines = [
        `${r.t}s → scene ${r.scene} (scene_t ${r.scene_t}s)${s ? ` · ${s.id} “${(s.text ?? "").slice(0, 48)}”` : " · no sentence"}${r.bookmark ? ` · near {${r.bookmark.id}}@${r.bookmark.t}s` : ""}${r.overrun ? " · OVERRUN nearby (animations ran past the narration — see the overrun trace entries)" : ""}`,
        `  animation: ${a ? `#${a.i} ${a.name ?? a.animation ?? "?"} @${a.t}s` : "none"}`,
        `  code: ${r.file}${r.line ? ":" + r.line : ""}`,
      ]
      return { content: [text(lines.join("\n"))], details: { scene: r.scene, sentence: s?.id ?? null, file: r.file, line: r.line ?? null } }
    },
  })
}
