/**
 * motion-tools: the studio's hands and eyes for pi.
 *
 *   film_status  config, open notes from the GUI, latest review + gates, what's rendered
 *   film_look    contact sheet straight from seek(t), returned as an IMAGE the model looks at
 *   film_render  draft / final / partial render (progress streamed)
 *   film_sound   beats → music → sfx → mix at -14 LUFS
 *   film_gate    mechanical gates (lint, determinism, dead time, loop, loudness, cue sync)
 *   film_review  record one critique round (scores + worst problems) for the GUI and the log
 *
 * Every tool shells out to engine/cli.mjs, the same CLI the GUI buttons and the terminal use.
 * Loaded into the main session by ./index.ts and into subagents (motion-critic, motion-animator)
 * through the interactive-subagents registerToolExtension hook.
 */
import { Type } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
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

const readJson = (p: string, d: any = null) => { try { return JSON.parse(readFileSync(p, "utf8")) } catch { return d } }
const text = (t: string): Text => ({ type: "text", text: t })
const fail = (what: string, out: string) => { throw new Error(`${what} failed:\n${out.slice(-4000)}`) }

const Film = Type.String({ description: "Film key (folder name under films/), e.g. 'launch-film'" })
const Fmt = Type.Optional(Type.String({ description: "Format: '9:16' | '1:1' | '16:9' | '4:5'. Default: the film's first format." }))

export default function motionTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "film_status",
    label: "Film status",
    description:
      "State of one film: film.json, design direction, OPEN NOTES the user pinned in the Studio GUI (timecoded: " +
      "treat them as top-priority fixes), the latest critique scores, gate results and rendered files. Call it at " +
      "the start of every round.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, params) {
      const dir = path.join(ROOT, "films", params.film)
      if (!existsSync(path.join(dir, "film.json"))) throw new Error(`no film "${params.film}" (films/${params.film}/film.json missing)`)
      const cfg = readJson(path.join(dir, "film.json"), {})
      const design = readJson(path.join(dir, "design.json"), {})
      const notes = (readJson(path.join(dir, "notes.json"), []) as any[]).filter((n) => !n.done)
      const reviews = readJson(path.join(dir, "reviews.json"), []) as any[]
      const gates = readJson(path.join(dir, "gates.json"))
      const { out } = await studio(["list"])
      const last = reviews.at(-1)
      const lines = [
        `film: ${params.film} · ${cfg.duration}s @ ${cfg.fps}fps · ${cfg.formats?.join(", ")} · ${cfg.loop ? "loop" : "no loop"}`,
        `direction: ${design.direction ?? "(design.json missing)"}`,
        "",
        notes.length ? `OPEN NOTES FROM THE USER (fix these first, then mark nothing: the user resolves them in the GUI):\n${notes.map((n) => `  @${n.t}s [${n.fmt}] ${n.text}`).join("\n")}` : "open notes: none",
        "",
        last ? `last review (round ${last.round}, min ${last.min}, ${last.pass ? "PASS" : "not yet"}): ${Object.entries(last.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}\n${(last.problems || []).map((p: any) => `  @${p.t}s ${p.issue}`).join("\n")}` : "reviews: none yet",
        "",
        gates ? `gates (${gates.at}): ${gates.pass ? "PASS" : "FAIL"}\n${gates.checks.filter((c: any) => c.level !== "pass").map((c: any) => `  ${c.level.toUpperCase()} ${c.name}: ${c.detail}`).join("\n") || "  all pass"}` : "gates: not run",
        "",
        out.split("\n").find((l) => l.startsWith(params.film)) ?? "",
      ]
      return { content: [text(lines.join("\n"))], details: { notes: notes.length, round: last?.round ?? 0 } }
    },
  })

  pi.registerTool({
    name: "film_look",
    label: "Look at frames",
    description:
      "Render moments of the film straight from window.seek(t) and LOOK at them as one labelled contact sheet " +
      "(takes seconds, no video encode). Modes: 'every' (every N s, default 0.5), 'beats' (just after each beat), " +
      "'shots' (one per film.json shot), 'strip' (n consecutive frames from `at`: catches pops, overlaps, jitter), " +
      "'times' (explicit list), 'phone' (360px wide every 1s: the readability test). Be a harsh motion director " +
      "when you look: you are checking your own work.",
    parameters: Type.Object({
      film: Film,
      mode: Type.Optional(Type.Union(["every", "beats", "shots", "strip", "times", "phone"].map((m) => Type.Literal(m)))),
      every: Type.Optional(Type.Number({ description: "seconds between frames for mode 'every'" })),
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
      if (r.code) fail("film_look", r.out)
      const rel = r.out.split("\n").pop()!.split("  ")[0]
      const file = path.join(ROOT, rel)
      const content: (Text | Img)[] = [
        text(`${r.out}\n\nSheet: ${rel} (also visible in the Studio GUI → Sheets). Score what you see, name problems with timestamps.`),
        { type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" },
      ]
      return { content, details: { file: rel } }
    },
  })

  pi.registerTool({
    name: "film_render",
    label: "Render film",
    description:
      "Render the film to MP4. quality 'draft' = half-res 30fps, no blur (seconds); 'final' = full-res film fps with " +
      "motion blur. `from`/`to` render only a slice (re-render just the seconds you fixed). fmt 'all' renders every " +
      "format. If out/mix.wav exists the audio is muxed in.",
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
      if (r.code) fail("film_render", r.out)
      return { content: [text(r.out.split("\n").filter((l) => !l.includes("%")).join("\n"))], details: undefined }
    },
  })

  pi.registerTool({
    name: "film_sound",
    label: "Build sound",
    description:
      "Build the soundtrack: beats.json (measured from film.json track, or gridded from music.bpm), synthesized " +
      "music (film.json music: bpm, key, progression, style drive|piano|minimal, sections), SFX from cues.json " +
      "(types: click tick pop thump impact whoosh swipe riser type chime glitch shutter drop; fields t, type, gain, " +
      "pan, len, pitch, hz, free), then a mix normalized to -14 LUFS / -1 dBTP → out/mix.wav.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p, signal) {
      const r = await studio(["sound", p.film], signal)
      if (r.code) fail("film_sound", r.out)
      return { content: [text(r.out)], details: undefined }
    },
  })

  pi.registerTool({
    name: "film_gate",
    label: "Run gates",
    description:
      "Mechanical gates, written to gates.json: lint (no Math.random/timers/wall clock/CSS animation), determinism " +
      "(same frame across seek orders), dead time, novelty every 2-4s, hook, blank frames, loop seam, loudness, " +
      "cue sync, deliverable probe. FAIL blocks shipping; WARN is for your judgement.",
    parameters: Type.Object({ film: Film }),
    async execute(_id, p, signal) {
      const r = await studio(["gate", p.film], signal)
      return { content: [text(r.out)], details: { pass: r.code === 0 } }
    },
  })

  pi.registerTool({
    name: "film_review",
    label: "Record review",
    description:
      "Record one critique round after LOOKING at sheets (film_look). Score every rubric item 1-10: hook, " +
      "readability, motion, variety, composition, brand, sound. List the 3 worst problems with timestamps and the " +
      "fix. Pass = every score 8+. Written to reviews.json + review_log.md; the GUI charts it.",
    parameters: Type.Object({
      film: Film,
      scores: Type.Object({
        hook: Type.Number(), readability: Type.Number(), motion: Type.Number(), variety: Type.Number(),
        composition: Type.Number(), brand: Type.Number(), sound: Type.Number(),
      }),
      problems: Type.Array(Type.Object({ t: Type.Number({ description: "seconds" }), issue: Type.String(), fix: Type.Optional(Type.String()) })),
      notes: Type.Optional(Type.String()),
      sheets: Type.Optional(Type.Array(Type.String(), { description: "sheet paths this round looked at" })),
      reviewer: Type.Optional(Type.String()),
    }),
    async execute(_id, p) {
      const { film, ...review } = p
      const r = await studio(["review", film, "--json", JSON.stringify(review)])
      if (r.code) fail("film_review", r.out)
      return { content: [text(r.out)], details: undefined }
    },
  })
}
