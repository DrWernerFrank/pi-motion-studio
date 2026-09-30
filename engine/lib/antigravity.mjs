// Antigravity bridge: drive real Antigravity agents (Google AI Pro subscription
// quota — no API key) from the studio. Three pieces:
//
//   1. a headless Antigravity language_server (the same binary the IDE runs,
//      launched with the IDE's own flags) — login persists across restarts;
//   2. its `agentapi` CLI — new-conversation / send-message;
//   3. the conversation's brain transcript (JSONL) — clean MODEL replies.
//
// Images: copied into the agent's project workspace, the agent views them with
// its file tools (full multimodal read).
//
// Used by `studio read <film>` (default when available) and the GUI reader.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './serve.mjs';
import { envKey } from './gemini.mjs';

// ── locate the Windows side (username-agnostic) ─────────────────────────────
function winUser() {
  for (const u of readdirSync('/mnt/c/Users')) {
    if (u === 'Public' || u.startsWith('.')) continue;
    if (existsSync(`/mnt/c/Users/${u}/AppData/Local/Programs/antigravity/resources/bin/language_server.exe`)) return u;
  }
  return null;
}
export function agyPaths() {
  const u = winUser();
  if (!u) return null;
  const home = `/mnt/c/Users/${u}`;
  return {
    ls: `${home}/AppData/Local/Programs/antigravity/resources/bin/language_server.exe`,
    home, gemini: `${home}/.gemini`,
    projects: `${home}/.gemini/config/projects`,
    brain: `${home}/.gemini/antigravity/brain`,
  };
}
function pickProject() {
  const p = agyPaths();
  const override = envKey('AGY_PROJECT_ID');
  if (override) return { id: override, ws: null };
  try {
    let best = null;
    for (const f of readdirSync(p.projects)) {
      const j = JSON.parse(readFileSync(join(p.projects, f), 'utf8'));
      const ws = j.projectResources?.resources?.[0]?.folderUri?.replace('file:///', '')?.replace(/%3A/i, ':');
      if (!best) best = { id: j.id, ws };
      if (ws && existsSync(`/${ws.replace(/\\/g, '/')}`)) best = { id: j.id, ws: `/${ws.replace(/\\/g, '/')}` };
    }
    return best;
  } catch { return null; }
}

// ── headless language server lifecycle ──────────────────────────────────────
const STATE = join(ROOT, '.agy-bridge.json');
const LOG = join(ROOT, '.agy-bridge.log');
const CSRF = 'studio-local-token';
const PORTS = { https: 5387 };

function state() { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; } }
function alive(pid) {
  if (!pid) return false;
  const r = spawnSync('/mnt/c/Windows/System32/tasklist.exe', ['/FI', `PID eq ${pid}`], { timeout: 8000 });
  return new RegExp(`[^0-9]${pid}[^0-9]`).test(String(r.stdout));
}
function listening() {
  const r = spawnSync('/mnt/c/Windows/System32/netstat.exe', ['-ano'], { timeout: 8000 });
  return /127\.0\.0\.1:5387\s.*LISTENING/.test(String(r.stdout));
}

// Spawns the LS exactly like the IDE does (flags decoded from its app.asar).
// Returns { httpPort }. Login: once (browser consent via `studio login-gemini`
// style flow printed in the log) — then persists.
export async function ensureServer({ timeoutMs = 20000 } = {}) {
  const p = agyPaths();
  if (!p) throw new Error('Antigravity not found (looked in /mnt/c/Users/*/AppData/Local/Programs/antigravity)');
  const st = state();
  if (st?.httpPort && alive(st.pid)) return st;

  if (!listening()) {
    const { createWriteStream } = await import('node:fs');
    const log = createWriteStream(LOG, { flags: 'w' });
    const child = spawn(p.ls, [
      '--standalone', '--override_ide_name', 'antigravity', '--subclient_type', 'hub',
      '--override_ide_version', '1.0.0', '--override_user_agent_name', 'antigravity',
      `--https_server_port`, String(PORTS.https), '--csrf_token', CSRF, '--app_data_dir', 'antigravity',
      '--api_server_url', 'https://generativelanguage.googleapis.com',
      '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
      '--enable_sidecars', '--headless',
    ], { cwd: p.home, env: { ...process.env, HOME: p.home, USERPROFILE: p.home }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log); child.stderr.pipe(log); child.unref();
    // wait for the fixed HTTPS port to come up
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (listening()) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!listening()) throw new Error(`language server did not start — see ${LOG.replace(ROOT + '/', '')} (if it says "Starting login", run: studio login-gemini)`);
    // grab its pid
    const ns = spawnSync('/mnt/c/Windows/System32/netstat.exe', ['-ano'], { timeout: 8000 });
    const pid = /127\.0\.0\.1:5387\s+\S+\s+LISTENING\s+(\d+)/.exec(String(ns.stdout))?.[1];
    writeFileSync(STATE, JSON.stringify({ pid: pid ? Number(pid) : null, httpPort: null, at: Date.now() }));
  }
  return { httpPort: httpPort(), pid: state()?.pid };
}
function httpPort() {
  // discover from netstat: the PID listening on 5387 also listens on the HTTP port
  const ns = spawnSync('/mnt/c/Windows/System32/netstat.exe', ['-ano'], { timeout: 8000 });
  const rows = String(ns.stdout).split('\n').map((l) => l.trim()).filter((l) => /^TCP\s/.test(l));
  const https = rows.find((l) => /127\.0\.0\.1:5387\s+\S+\s+LISTENING\s+(\d+)/.test(l));
  const pid = /LISTENING\s+(\d+)\s*$/.exec(https || '')?.[1];
  if (!pid) throw new Error('language server is not up — start it with: studio read (it self-heals on retry)');
  const other = rows.find((l) => new RegExp(`127\\.0\\.0\\.1:(\\d+)\\s+\\S+\\s+LISTENING\\s+${pid}\\s*$`).test(l) && !/:5387\s/.test(l));
  const port = /127\.0\.0\.1:(\d+)\s/.exec(other || '')?.[1];
  if (!port) throw new Error('could not discover the language server HTTP port from netstat');
  writeFileSync(STATE, JSON.stringify({ pid: Number(pid), httpPort: Number(port), at: Date.now() }));
  return Number(port);
}

// ── ask an Antigravity agent ────────────────────────────────────────────────
// Returns { text, engine }. `image` is a file path; copied into the agent's
// workspace so its file tools can view it.
export async function askAntigravity({ prompt, image, model, timeoutMs = 300000, onProgress } = {}) {
  const p = agyPaths();
  if (!p) throw new Error('Antigravity not found');
  const proj = pickProject();
  if (!proj?.id) throw new Error('no Antigravity project found — open Antigravity once so a project exists, then retry');
  const srv = await ensureServer();
  const httpPort = srv.httpPort || httpPort();

  // workspace staging for the image — the agent gets the ABSOLUTE windows path
  let sheet = null, sheetWin = null;
  if (image && existsSync(image)) {
    const ws = proj.ws || p.home;
    try {
      copyFileSync(image, join(ws, '.studio-sheet.png'));
      sheet = '.studio-sheet.png';
      sheetWin = ws.replace(/^\/mnt\/([a-z])\//i, (_m, d) => `${d.toUpperCase()}:\\\\`).replace(/\//g, '\\\\') + '\\\\.studio-sheet.png';
    } catch { sheet = null; }
  }
  const END = '===STUDIO-REPLY-END===';
  const full = sheet
    ? `${prompt}\n\nThe image to judge is at this absolute path: ${sheetWin}\nView that image file with your file-viewing tools first — it is the subject of this task. Answer about what you SEE in it.\nEnd your reply with the exact line: ${END}`
    : `${prompt}\n\nEnd your reply with the exact line: ${END}`;

  const m = (model || envKey('AGY_MODEL') || 'flash').toLowerCase();
  const r = spawnSync(p.ls, [
    'agentapi', 'new-conversation', `--model=${m}`, '--title=studio-read', full,
  ], {
    cwd: p.home, timeout: 60000, encoding: 'utf8',
    env: { ...process.env, HOME: p.home, USERPROFILE: p.home, WSLENV: 'ANTIGRAVITY_LS_ADDRESS:ANTIGRAVITY_CSRF_TOKEN:ANTIGRAVITY_PROJECT_ID', ANTIGRAVITY_LS_ADDRESS: `localhost:${httpPort}`, ANTIGRAVITY_CSRF_TOKEN: CSRF, ANTIGRAVITY_PROJECT_ID: proj.id },
  });
  if (r.status !== 0) {
    const err = /"error":\s*"([^"]+)"/.exec(r.stdout || r.stderr || '')?.[1] || String(r.stderr || r.stdout || '').slice(0, 200);
    throw new Error(`agentapi: ${err}`);
  }
  const id = /"conversationId":\s*"([0-9a-f-]+)"/.exec(r.stdout)?.[1];
  if (!id) throw new Error(`agentapi returned no conversation id: ${String(r.stdout).slice(0, 200)}`);

  // poll the brain transcript for the model's reply
  const tPath = join(p.brain, id, '.system_generated', 'logs', 'transcript.jsonl');
  const t0 = Date.now();
  let lastSize = -1, lastGrowth = Date.now();
  onProgress?.('agent running…');
  const substantive = (c) => c && c.trim().length > 60 && !/^Created At:/m.test(c) && !/Task logs are available/.test(c);
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((res) => setTimeout(res, 1500));
    let lines = '';
    try { lines = readFileSync(tPath, 'utf8'); } catch { continue; }
    if (lines.length !== lastSize) { lastSize = lines.length; lastGrowth = Date.now(); }
    const replies = [];
    let sawEnd = false;
    for (const l of lines.split('\n')) {
      if (!l) continue;
      try {
        const j = JSON.parse(l);
        if (j.source === 'MODEL' && j.status === 'DONE' && j.content && j.content.trim()) replies.push(j.content);
        if (j.source === 'MODEL' && typeof j.content === 'string' && j.content.includes(END)) sawEnd = true;
      } catch {}
    }
    const done = sawEnd || (Date.now() - lastGrowth > 8000 && replies.some(substantive));
    if (done) {
      // final answer: the reply containing the marker, else the last substantive one
      const marked = replies.find((c) => c.includes(END));
      const best = marked || [...replies].reverse().find(substantive) || replies[replies.length - 1] || '';
      const text = best.split(END)[0].replace(new RegExp(`${END}\\s*$`), '').trim() || best.trim();
      if (sheet) { try { unlinkSync(join(proj.ws || p.home, '.studio-sheet.png')); } catch {} }
      return { text, engine: `antigravity · ${m}` };
    }
  }
  throw new Error(`agent did not reply within ${Math.round(timeoutMs / 1000)}s (conversation ${id} — open Antigravity to inspect it)`);
}

export function antigravityAvailable() { return !!agyPaths(); }
