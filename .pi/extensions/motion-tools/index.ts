/**
 * motion-tools entry: registers the film_* tools in this session, teaches the
 * interactive-subagents extension where they live (so motion-critic and
 * motion-animator can list them in `tools:`), and adds /studio.
 *
 * Project extensions load before global ones, so the subagent registry does not
 * exist yet when this factory runs: register on session_start (idempotent).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import motionTools from "./tools.ts"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOOLS = path.join(DIR, "tools.ts")
const ROOT = path.resolve(DIR, "../../..")
const PORT = Number(process.env.STUDIO_PORT || 3142)
const NAMES = ["film_status", "film_look", "film_render", "film_sound", "film_gate", "film_review"]

async function guiUp(): Promise<boolean> {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/films`, { signal: AbortSignal.timeout(800) })).ok } catch { return false }
}

export default function (pi: ExtensionAPI) {
  motionTools(pi)

  pi.on("session_start", async () => {
    const api = (globalThis as any).__pi_interactive_subagents
    if (!api?.registerToolExtension) return
    for (const n of NAMES) { try { api.registerToolExtension(n, TOOLS) } catch { /* already registered */ } }
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
