/**
 * motion-tools entry: registers the film_* and edit_* tools in this session, teaches the
 * interactive-subagents extension where they live (so motion-critic, motion-animator and
 * edit-critic can list them in `tools:`), and adds /studio.
 *
 * Project extensions load before global ones, so the subagent registry does not
 * exist yet when this factory runs: register on session_start (idempotent).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import motionTools from "./tools.ts"
import editTools from "./edit-tools.ts"
import mathTools from "./math-tools.ts"
import projectTools from "./project-tools.ts"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOOLS = path.join(DIR, "tools.ts")
const EDIT_TOOLS = path.join(DIR, "edit-tools.ts")
const MATH_TOOLS = path.join(DIR, "math-tools.ts")
const PROJECT_TOOLS = path.join(DIR, "project-tools.ts")
const ROOT = path.resolve(DIR, "../../..")
const PORT = Number(process.env.STUDIO_PORT || 3142)

// tool name -> the module that registers it, so every name lands on its own file
const BY_FILE: [string, string[]][] = [
  [TOOLS, ["film_status", "film_look", "film_render", "film_sound", "film_gate", "film_review"]],
  [EDIT_TOOLS, ["edit_status", "edit_ingest", "edit_transcribe", "edit_transcript", "edit_ops", "edit_cut", "edit_look", "edit_audio", "edit_render", "edit_gate"]],
  [MATH_TOOLS, ["math_status", "math_script", "math_voice", "math_scene", "math_look", "math_check", "math_render", "math_gate", "math_where"]],
  [PROJECT_TOOLS, ["project_new", "project_status", "project_plan", "project_segment", "project_assemble", "project_check", "project_ship"]],
]
const NAMES = BY_FILE.flatMap(([, names]) => names)

async function guiUp(): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/films`, { signal: AbortSignal.timeout(800) })).ok } catch { return false }
}

export default function (pi: ExtensionAPI) {
  motionTools(pi)
  editTools(pi)
  mathTools(pi)
  projectTools(pi)

  pi.on("session_start", async () => {
    const api = (globalThis as any).__pi_interactive_subagents
    if (!api?.registerToolExtension) return
    for (const [file, names] of BY_FILE) for (const n of names) { try { api.registerToolExtension(n, file) } catch { /* already registered */ } }
  })

  pi.registerCommand("studio", {
    description: "Start (if needed) the Motion Studio GUI and show its URL",
    handler: async (_args, ctx) => {
      if (!(await guiUp())) {
        const p = spawn(process.execPath, [path.join(ROOT, "studio-gui", "server.mjs")], { cwd: ROOT, detached: true, stdio: "ignore" })
        p.unref()
        for (let i = 0; i < 20 && !(await guiUp()); i++) await new Promise((r) => setTimeout(r, 150))
      }
      ctx.ui.notify(`Motion Studio: http://localhost:${PORT}`, "info")
    },
  })
}
