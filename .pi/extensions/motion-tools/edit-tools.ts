/**
 * edit-tools: the studio's hands for real footage (mission D10) — the exact same shape as tools.ts:
 * every tool shells out to engine/cli.mjs, the same CLI the GUI buttons and the terminal use, and looks
 * at its own sheets. edit_look returns IMAGES, edit_audio measures what you cannot listen to
 * (loudness per second + waveform/spectrogram), edit_cut always shows the removed text before applying.
 *
 *   edit_status      the edit state: bin, tracks, timeline, overlays, captions, gates, notes, renders
 *   edit_ingest      conform a real file into the media bin (CFR, upright, SDR, proxy, peaks, silence map)
 *   edit_transcribe  local word-level ASR on an ingested source (cached by content hash)
 *   edit_transcript  read the transcript in chunks: seconds ranges, grep, compact|words|srt
 *   edit_ops         batch timeline ops (validated, atomic, undoable, baseRev-guarded)
 *   edit_cut         measured cut proposals with the removed text; dry-run first, apply when chosen
 *   edit_look        contact sheets as IMAGES; mode 'cuts' = both sides of every cut with source timecodes
 *   edit_audio       dialog bus + mix, then loudness per second and waveform/spectrogram sheets
 *   edit_render      draft / final / partial render (progress streamed)
 *   edit_gate        mechanical gates (lint, determinism, dead time, loudness, deliverable probe)
 *
 * Loaded next to tools.ts by ./index.ts; critique rounds keep using film_review.
 */
import { Type } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

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

// ffmpeg directly, read-only analysis on the mix (mission §9: "you cannot listen, so measure and look").
// Sheets land in films/<film>/out/analysis/ next to everything else the film produces.
function ff(args: string[], signal?: AbortSignal): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    const p = spawn("ffmpeg", args, { cwd: ROOT })
    let out = "", err = ""
    p.stdout.on("data", (d) => (out += String(d)))
    p.stderr.on("data", (d) => (err += String(d)))
    const kill = () => p.kill("SIGTERM")
    signal?.addEventListener("abort", kill, { once: true })
    p.on("close", (code) => { signal?.removeEventListener("abort", kill); ok({ code: code ?? 1, out, err }) })
  })
}

const readJson = (p: string, d: any = null) => { try { return JSON.parse(readFileSync(p, "utf8")) } catch { return d } }
const text = (t: string): Text => ({ type: "text", text: t })
const fail = (what: string, out: string) => { throw new Error(`${what} failed:\n${out.slice(-4000)}`) }

const Film = Type.String({ description: "Edit film key (folder name under films/, made with `studio new <key> --edit`)" })
const Fmt = Type.Optional(Type.String({ description: "Format: '9:16' | '1:1' | '16:9' | '4:5'. Default: the film's first format." }))
const Src = Type.String({ description: "Source id in the media bin (see edit_status), e.g. 'cam'" })

export default function editTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "edit_status",
    label: "Edit status",
    description:
      "The edit state of one film: sources/bin, tracks with clip counts, timeline (duration/frames/fps/rev), " +
      "overlays, captions config, markers, undo depth, OPEN NOTES the user pinned in the Studio GUI " +
      "(timecoded: fix them first), the latest gates and what is rendered. Call it before every round; " +
      "use film_status for motion (code-drawn) films.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, params) {
      const dir = path.join(ROOT, "films", params.film)
      if (!existsSync(path.join(dir, "film.json"))) throw new Error(`no film "${params.film}" (films/${params.film}/film.json missing)`)
      const r = await studio(["edit", params.film, "show", "--json"])
      if (r.code) fail("edit_status", r.out)
      const edit: any = JSON.parse(r.out.slice(r.out.indexOf("{")))
      const cfg = readJson(path.join(dir, "film.json"), {})
      const design = readJson(path.join(dir, "design.json"), {})
      const notes = (readJson(path.join(dir, "notes.json"), []) as any[]).filter((n) => !n.done)
      const gates = readJson(path.join(dir, "gates.json"))
      const bin: any = readJson(path.join(dir, "assets", "media", "index.json"), { sources: {} })
      const out = existsSync(path.join(dir, "out")) ? readdirSync(path.join(dir, "out"), { withFileTypes: true }) : []
      const rendered = out.filter((e) => e.isFile() && /\.(mp4|wav|srt|vtt)$/i.test(e.name) && !e.name.includes(".silent")).map((e) => e.name)
      const onTimeline = new Set(Object.keys(edit.sources ?? {}))
      const sources = Object.entries(bin.sources ?? {})
        .map(([id, s]: [string, any]) => `${id}(${s.kind} ${s.duration?.toFixed?.(1) ?? "?"}s${s.has_audio ? "" : ", no audio"}${onTimeline.has(id) ? "" : ", in bin — not on the timeline"})`)
      const lines = [
        `film: ${params.film} · kind ${cfg.kind ?? "?"} · ${edit.seconds}s (${edit.frames} frames @ ${edit.fps} fps) · rev ${edit.rev} · ${cfg.formats?.join(", ")}`,
        `direction: ${design.direction ?? "(design.json missing)"}`,
        "",
        `sources: ${sources.join(", ") || "none (edit_ingest a file first)"}`,
        `tracks: ${edit.tracks.map((t: any) => `${t.id} [${t.kind}] ${t.clips} clip${t.clips === 1 ? "" : "s"}`).join(" · ")}`,
        edit.overlays?.length ? `overlays:\n${edit.overlays.map((o: any) => `  ${o.id} ${o.type} @${o.at}s +${o.dur}s ${JSON.stringify(o.props)}`).join("\n")}` : "overlays: none",
        edit.captions ? `captions: ${JSON.stringify(edit.captions)}` : "captions: off (a caption-style op turns them on)",
        edit.markers?.length ? `markers: ${edit.markers.map((m: any) => `${m.t}s ${m.label}`).join(" · ")}` : "markers: none",
        `history: ${edit.history?.undo ?? 0} undo / ${edit.history?.redo ?? 0} redo`,
        "",
        notes.length ? `OPEN NOTES FROM THE USER (fix these first, then mark nothing: the user resolves them in the GUI):\n${notes.map((n) => `  @${n.t}s [${n.fmt}] ${n.text}`).join("\n")}` : "open notes: none",
        "",
        gates ? `gates (${gates.at}): ${gates.pass ? "PASS" : "FAIL"}\n${gates.checks.filter((c: any) => c.level !== "pass").map((c: any) => `  ${c.level.toUpperCase()} ${c.name}: ${c.detail}`).join("\n") || "  all pass"}` : "gates: not run",
        "",
        rendered.length ? `rendered: ${rendered.join(", ")}` : "rendered: nothing yet (edit_render quality 'draft' first)",
      ]
      return { content: [text(lines.join("\n"))], details: { rev: edit.rev, seconds: edit.seconds, clips: edit.tracks.reduce((a: number, t: any) => a + t.clips, 0), notes: notes.length } }
    },
  })

  pi.registerTool({
    name: "edit_ingest",
    label: "Ingest source",
    description:
      "Conform a real file into the film's media bin: constant frame rate at the project fps, upright, SDR " +
      "bt709, short GOP (exact cheap seeks) + a scrub proxy, 48 kHz PCM audio, waveform peaks, a filmstrip, " +
      "scene cuts and a silence map. Cached by content hash: a re-ingest is a no-op. Windows paths, spaces " +
      "and non-ASCII work; the original is never touched. `edit_status` lists what is in the bin.",
    parameters: Type.Object({
      film: Film,
      src: Type.String({ description: "Path to the source file. Windows paths work: C:\\Users\\…\\clip.mp4" }),
      id: Type.Optional(Type.String({ description: "Source id in the bin (lowercase letters, digits, dashes), e.g. 'cam'. Default: from the file name." })),
      fps: Type.Optional(Type.String({ description: "Conform fps, e.g. '30000/1001'. Default: the film's own fps." })),
      max: Type.Optional(Type.Number({ description: "Max long side in px (default 1920)" })),
    }),
    async execute(_id, p, signal) {
      const args = ["ingest", p.film, p.src]
      if (p.id) args.push("--id", p.id)
      if (p.fps) args.push("--fps", p.fps)
      if (p.max) args.push("--max", String(p.max))
      const r = await studio(args, signal)
      if (r.code) fail("edit_ingest", r.out)
      return { content: [text(r.out)], details: undefined }
    },
  })

  pi.registerTool({
    name: "edit_transcribe",
    label: "Transcribe source",
    description:
      "Local word-level ASR on an ingested source (never a hosted service; footage never leaves the " +
      "machine). Cached by (media hash, model, language): a re-run is a cache hit. Word boundaries are " +
      "refined against the audio, but cut points still come from the measured silence map, not the words.",
    parameters: Type.Object({
      film: Film,
      src: Src,
      model: Type.Optional(Type.String({ description: "ASR model size (default 'small')" })),
      force: Type.Optional(Type.Boolean({ description: "Re-run even when cached" })),
    }),
    async execute(_id, p, signal) {
      const args = ["transcribe", p.film, p.src]
      if (p.model) args.push("--model", p.model)
      if (p.force) args.push("--force")
      const r = await studio(args, signal)
      if (r.code) fail("edit_transcribe", r.out)
      return { content: [text(r.out)], details: undefined }
    },
  })

  pi.registerTool({
    name: "edit_transcript",
    label: "Read transcript",
    description:
      "Read a source's transcript in chunks an hour of speech at a time: `from`/`to` seconds ranges, `grep` " +
      "for a phrase, format compact (one line per ~8 words with times — read by eye), words (per-word times " +
      "and confidence) or srt. While reading, note the strongest lines (the hook), every name and number, " +
      "the flubs and retakes. Never re-transcribe a cut: word timings retime onto the edit automatically.",
    parameters: Type.Object({
      film: Film,
      src: Src,
      from: Type.Optional(Type.Number({ description: "seconds" })),
      to: Type.Optional(Type.Number({ description: "seconds" })),
      grep: Type.Optional(Type.String({ description: "regex, case-insensitive" })),
      format: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("words"), Type.Literal("srt")])),
    }),
    async execute(_id, p) {
      const args = ["transcript", p.film, p.src]
      if (p.from != null) args.push("--from", String(p.from))
      if (p.to != null) args.push("--to", String(p.to))
      if (p.grep) args.push("--grep", p.grep)
      if (p.format) args.push("--format", p.format)
      const r = await studio(args)
      if (r.code) fail("edit_transcript", r.out)
      return { content: [text(r.out)], details: undefined }
    },
  })

  pi.registerTool({
    name: "edit_ops",
    label: "Apply edit ops",
    description:
      "Batch timeline operations through the edit model: every op is validated, atomic (all-or-nothing), " +
      "frame-snapped at the project's rational fps, undoable and logged. Author times in seconds. Ops: " +
      "add, trim, split, delete, ripple-delete, move, reorder, speed, freeze, volume, fade, xfade, jcut, " +
      "crop-keyframe, cam, color, lut, overlay, caption-style, marker. Pass baseRev (from edit_status) to " +
      "conflict-check against concurrent edits — a stale baseRev is rejected, never blind-written. Never " +
      "hand-edit edit.json.",
    parameters: Type.Object({
      film: Film,
      ops: Type.Array(Type.Object({ op: Type.String({ description: "op name, e.g. 'add', 'ripple-delete', 'caption-style'" }) },
        { description: "One op: { op, ...args } — times in seconds; e.g. { op: 'add', src: 'cam', in: 1.6, out: 7.05, at: 0 }", additionalProperties: true }),
        { description: "Ops to apply as one atomic batch (one undo step)" }),
      baseRev: Type.Optional(Type.Number({ description: "The rev you read (edit_status); a mismatch is a conflict" })),
    }),
    async execute(_id, p, signal) {
      const args = ["edit", p.film, "ops", JSON.stringify(p.ops)]
      if (p.baseRev != null) args.push("--base-rev", String(p.baseRev))
      const r = await studio(args, signal)
      if (r.code) fail("edit_ops", r.out)
      const rev = Number(/→ rev (\d+)/.exec(r.out)?.[1] ?? 0)
      return { content: [text(r.out)], details: { rev } }
    },
  })

  pi.registerTool({
    name: "edit_cut",
    label: "Propose cuts",
    description:
      "Measured cut proposals, never guessed: the silence map and freezedetect decide WHERE, the transcript " +
      "only says WHAT leaves. DRY-RUN by default and every proposal carries its removed text — read them, " +
      "veto anything that changes meaning (negations, numbers) or clips a word, then pass apply:true. " +
      "Kinds: silence (pauses > max-gap, keeping keep-breath of breath), fillers (um/uh, verified against " +
      "the audio), takes (near-duplicate sentences: the last complete one stays), idle (frozen picture, " +
      "screen recordings; speedUp speeds it instead), tighten (hit --target by trimming the longest pauses).",
    parameters: Type.Object({
      film: Film,
      kind: Type.Union([Type.Literal("silence"), Type.Literal("fillers"), Type.Literal("takes"), Type.Literal("idle"), Type.Literal("tighten")]),
      src: Type.Optional(Src),
      apply: Type.Optional(Type.Boolean({ description: "Apply the proposals (default: dry-run for review)" })),
      maxGap: Type.Optional(Type.Number({ description: "silence: max internal pause in s (default 0.5)" })),
      keepBreath: Type.Optional(Type.Number({ description: "silence: breath to keep in s (default 0.15)" })),
      also: Type.Optional(Type.Array(Type.String(), { description: "fillers: extra words to cut, e.g. ['like','you know']" })),
      window: Type.Optional(Type.Number({ description: "takes: pairing window in s (default 20)" })),
      maxIdle: Type.Optional(Type.Number({ description: "idle: max frozen stretch in s (default 1)" })),
      speedUp: Type.Optional(Type.Boolean({ description: "idle: speed the stretch up instead of cutting it" })),
      speed: Type.Optional(Type.Number({ description: "idle with speedUp: the rate (default 4)" })),
      target: Type.Optional(Type.Number({ description: "tighten: target duration in s" })),
    }),
    async execute(_id, p, signal) {
      const args = ["cut", p.film, p.kind]
      if (p.src) args.push("--src", p.src)
      if (p.apply) args.push("--apply")
      if (p.maxGap != null) args.push("--max-gap", String(p.maxGap))
      if (p.keepBreath != null) args.push("--keep-breath", String(p.keepBreath))
      if (p.also?.length) args.push("--also", p.also.join(","))
      if (p.window != null) args.push("--window", String(p.window))
      if (p.maxIdle != null) args.push("--max-idle", String(p.maxIdle))
      if (p.speedUp) args.push("--speed-up")
      if (p.speed != null) args.push("--speed", String(p.speed))
      if (p.target != null) args.push("--target", String(p.target))
      const r = await studio(args, signal)
      if (r.code) fail("edit_cut", r.out)
      return { content: [text(r.out)], details: { applied: !!p.apply } }
    },
  })

  pi.registerTool({
    name: "edit_look",
    label: "Look at the edit",
    description:
      "Render moments of the edit straight from seek(t) and LOOK at them as one labelled contact sheet " +
      "(takes seconds, no video encode). Modes: 'cuts' (the last frame before and the first after every " +
      "cut — this is where edits break; each label carries the SOURCE timecode it shows), 'every' (every N " +
      "s), 'times' (explicit list), 'strip' (n consecutive frames from `at`: pops, jitter), 'phone' (360px: " +
      "the caption readability test), 'beats', 'shots'. Be a harsh editor: hunt flashes, framing jumps, " +
      "clipped mouths, captions that pop.",
    parameters: Type.Object({
      film: Film,
      mode: Type.Optional(Type.Union(["every", "cuts", "times", "strip", "phone", "beats", "shots"].map((m) => Type.Literal(m)))),
      every: Type.Optional(Type.Number({ description: "seconds between frames for mode 'every' (default 0.5)" })),
      at: Type.Optional(Type.Number({ description: "start time for mode 'strip'" })),
      n: Type.Optional(Type.Number({ description: "frame count for mode 'strip' (default 12)" })),
      times: Type.Optional(Type.Array(Type.Number(), { description: "seconds, for mode 'times'" })),
      fmt: Fmt,
      width: Type.Optional(Type.Number({ description: "thumbnail width px (default 270-360)" })),
    }),
    async execute(_id, p, signal) {
      const args = ["look", p.film, "--mode", p.mode ?? "every"]
      if (p.every) args.push("--every", String(p.every))
      if (p.at != null) args.push("--at", String(p.at))
      if (p.n) args.push("--n", String(p.n))
      if (p.times?.length) args.push("--times", p.times.join(","))
      if (p.fmt) args.push("--fmt", p.fmt)
      if (p.width) args.push("--width", String(p.width))
      const r = await studio(args, signal)
      if (r.code) fail("edit_look", r.out)
      const relp = r.out.split("\n").pop()!.split("  ")[0]
      const file = path.join(ROOT, relp)
      const content: (Text | Img)[] = [
        text(`${r.out}\n\nSheet: ${relp} (also visible in the Studio GUI → Sheets). Score what you see, name problems with timestamps.`),
        { type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" },
      ]
      return { content, details: { file: relp } }
    },
  })

  pi.registerTool({
    name: "edit_audio",
    label: "Build + measure audio",
    description:
      "Build the edit's sound — the dialog bus assembles itself from the timeline (every trim, speed " +
      "change and J/L offset honored to the sample, micro-fades at seams, per-source cleanup, music/sfx " +
      "ducked under speech, -14 LUFS / -1 dBTP) → out/mix.wav — THEN measure what you cannot listen to: " +
      "loudness per second (ebur128), a waveform sheet and a spectrogram sheet. Read the numbers: level " +
      "jumps, dead air, hiss floors, a clipped word. Say the loudness target, never hand-tune levels.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p, signal) {
      const s = await studio(["sound", p.film], signal)
      if (s.code) fail("edit_audio", s.out)
      const dir = path.join(ROOT, "films", p.film, "out")
      const mix = path.join(dir, "mix.wav")
      if (!existsSync(mix)) fail("edit_audio", `no out/mix.wav after \`studio sound\`:\n${s.out}`)
      const an = path.join(dir, "analysis"); mkdirSync(an, { recursive: true })
      const waveform = path.join(an, "waveform.png"), spectrogram = path.join(an, "spectrogram.png"), loudnessFile = path.join(an, "loudness.json")
      const [w, sp] = await Promise.all([
        ff(["-y", "-v", "error", "-i", mix, "-filter_complex", "showwavespic=s=1800x400:colors=#ff5b2e", "-frames:v", "1", waveform], signal),
        ff(["-y", "-v", "error", "-i", mix, "-filter_complex", "showspectrumpic=s=1800x400:color=fire", "-frames:v", "1", spectrogram], signal),
      ])
      if (w.code || sp.code) fail("edit_audio", `${w.err}\n${sp.err}`)
      const e = await ff(["-hide_banner", "-nostats", "-i", mix, "-af", "ebur128=peak=true", "-f", "null", "-"], signal)
      const sec: Record<number, number[]> = {}
      for (const m of e.err.matchAll(/t:\s*([\d.]+)[^\n]*?\bM:\s*(-?[\d.]+|-inf)/g)) {
        const t = Math.floor(Number(m[1])), v = m[2] === "-inf" ? -70 : Number(m[2])
        ;(sec[t] ??= []).push(v)
      }
      const perSec = Object.entries(sec).sort((a, b) => Number(a[0]) - Number(b[0])).map(([t, vs]) => [Number(t), vs.at(-1)!] as [number, number])
      const summary = e.err.slice(e.err.lastIndexOf("Summary"))
      const lufs = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1] ?? "?"
      const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1] ?? "?"
      // per second; long mixes fold to 5 s means so the numbers stay readable
      const fold = perSec.length > 90 ? 5 : 1
      const cells: string[] = []
      for (let i = 0; i < perSec.length; i += fold) {
        const g = perSec.slice(i, i + fold), mean = g.reduce((a, [, v]) => a + v, 0) / g.length
        cells.push(`${g[0][0]}-${g.at(-1)![0] + 1}s ${mean.toFixed(1)}`)
      }
      const rows: string[] = []
      for (let i = 0; i < cells.length; i += 6) rows.push(`  ${cells.slice(i, i + 6).join("  ")}`)
      const first: [number, number] = perSec[0] ?? [0, 0]
      const quiet = perSec.reduce((a, b) => (b[1] < a[1] ? b : a), first)
      const loud = perSec.reduce((a, b) => (b[1] > a[1] ? b : a), first)
      writeFileSync(loudnessFile, JSON.stringify({ perSecond: perSec, lufs, truePeak: peak }, null, 1) + "\n")
      const body = [
        s.out,
        "",
        `loudness per second (momentary, ebur128${fold > 1 ? `, folded to ${fold}s means` : ""}):`,
        ...rows,
        perSec.length ? `range: quietest ${quiet[1].toFixed(1)} LUFS (s ${quiet[0]}) … loudest ${loud[1].toFixed(1)} LUFS (s ${loud[0]})` : "",
        `integrated ${lufs} LUFS, true peak ${peak} dBFS`,
        "",
        `sheets: films/${p.film}/out/analysis/waveform.png (below), spectrogram.png, loudness.json`,
      ]
      const content: (Text | Img)[] = [
        text(body.filter((l) => l !== "").join("\n")),
        { type: "image", data: readFileSync(waveform).toString("base64"), mimeType: "image/png" },
      ]
      return { content, details: { lufs, truePeak: peak, waveform: `films/${p.film}/out/analysis/waveform.png` } }
    },
  })

  pi.registerTool({
    name: "edit_render",
    label: "Render edit",
    description:
      "Render the edit to MP4. quality 'draft' = half-res 30fps (seconds — pacing checks, do them often); " +
      "'final' = full-res at the film's own fps with motion blur. `from`/`to` re-render only the seconds you " +
      "fixed. fmt 'all' renders every format (9:16, 1:1, 16:9, 4:5 from one edit). out/mix.wav is muxed in " +
      "as AAC; captions come from the edit; cuts are frame-exact.",
    parameters: Type.Object({
      film: Film,
      quality: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("final")])),
      fmt: Type.Optional(Type.String({ description: "'9:16' | '1:1' | '16:9' | '4:5' | 'all'" })),
      from: Type.Optional(Type.Number()), to: Type.Optional(Type.Number()),
    }),
    async execute(_id, p, signal, onUpdate) {
      const args = ["render", p.film]
      if ((p.quality ?? "draft") === "draft") args.push("--draft")
      if (p.fmt) args.push("--fmt", p.fmt)
      if (p.from != null) args.push("--from", String(p.from))
      if (p.to != null) args.push("--to", String(p.to))
      const r = await studio(args, signal, (l) => onUpdate?.({ content: [text(l)], details: undefined }))
      if (r.code) fail("edit_render", r.out)
      return { content: [text(r.out.split("\n").filter((l) => !l.includes("%")).join("\n"))], details: undefined }
    },
  })

  pi.registerTool({
    name: "edit_gate",
    label: "Run edit gates",
    description:
      "Mechanical gates, written to gates.json: lint (no timers/randomness/wall clock/CSS animation), " +
      "determinism, dead time, novelty, hook, blank frames, loop seam, loudness, cue sync, deliverable " +
      "probe. FAIL blocks shipping; WARN is for your judgement. Run it before every render round and fix " +
      "every FAIL.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p, signal) {
      const r = await studio(["gate", p.film], signal)
      return { content: [text(r.out)], details: { pass: r.code === 0 } }
    },
  })
}
