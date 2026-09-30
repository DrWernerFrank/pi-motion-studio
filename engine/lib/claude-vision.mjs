// Claude Sonnet vision for the studio: read an image (contact sheet, poster,
// frame) by asking Claude Sonnet 5.5 through the Claude Code CLI — the same
// login and subscription quota that runs the claude-bridge models. No API
// key, no extra login. Used by the GUI reader and `studio read <film>`.
//
// Images on /mnt/c can be permission-blocked for Claude Code, so every image
// is staged into a fixed folder under /tmp first (proven readable), and the
// prompt sends the staged path.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CLAUDE_VISION_MODEL = process.env.STUDIO_VISION_MODEL || 'claude-sonnet-5-5';
const CLAUDE_BIN = process.env.STUDIO_CLAUDE_BIN || join(process.env.HOME || '/home/werner', '.local', 'bin', 'claude');
const MAX_BYTES = 14 * 1024 * 1024;
const STAGE_DIR = join(tmpdir(), 'studio-vision');
const EXT_FOR = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };

export function claudeVisionAvailable() {
  try { return existsSync(CLAUDE_BIN); } catch { return false; }
}

/** Stage an image where Claude Code can read it; resolves the staged path. */
function stage(src) {
  const ext = (src.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
  if (!EXT_FOR[ext]) throw new Error(`not a readable image type (.${ext || '?'}) — PNG, JPEG, WebP or GIF`);
  const s = statSync(src);
  if (!s.size) throw new Error('the image file is empty');
  if (s.size > MAX_BYTES) throw new Error(`the image is ${(s.size / 1048576).toFixed(1)} MB; the limit is 14 MB`);
  mkdirSync(STAGE_DIR, { recursive: true });
  const staged = join(STAGE_DIR, `img-${randomUUID().slice(0, 8)}.${EXT_FOR[ext]}`);
  copyFileSync(src, staged);
  return staged;
}

function askClaude(prompt, model, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    if (!existsSync(CLAUDE_BIN)) return reject(new Error(`Claude Code was not found at ${CLAUDE_BIN} — install it, or vision falls back`));
    const child = spawn(CLAUDE_BIN, ['--model', model, '--print', prompt], { cwd: tmpdir(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Claude did not answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Claude Code could not be started (${e.message})`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (text) return resolve(text);
      reject(new Error(`Claude Code exited${code != null ? ` (code ${code})` : ''}${err.trim() ? `: ${err.trim().slice(0, 200)}` : ' with no output'}`));
    });
  });
}

/** Image file → { text, model, engine }. Reads with Claude Sonnet 5.5. */
export async function claudeRead({ image, prompt, model, timeoutMs = 180000 } = {}) {
  const src = typeof image === 'string' ? image : null;
  if (!src) throw new Error('image: a file path is required');
  if (!existsSync(src)) throw new Error(`image not found: ${src}`);
  let staged = null;
  try {
    staged = stage(src);
    const question = String(prompt || '').trim() || 'Read this image: transcribe any text it contains, then describe what it shows.';
    const full = `${question}\n\nThe image is at this absolute path: ${staged}\nRead that image file first — it is the subject of this task. Answer only about what you SEE in it.`;
    const text = await askClaude(full, model || CLAUDE_VISION_MODEL, timeoutMs);
    return { text, model: model || CLAUDE_VISION_MODEL, engine: 'claude-code' };
  } finally {
    if (staged) { try { unlinkSync(staged); } catch { /* already gone */ } }
  }
}
