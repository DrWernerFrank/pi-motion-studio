// Gemini vision for the studio: send an image (contact sheet, poster, frame)
// plus a prompt, get text back. Server-side only — the key lives in .env and
// never reaches the browser.
//   .env (studio root):
//     GEMINI_API_KEY=...        from https://aistudio.google.com/apikey
//     GEMINI_MODEL=gemini-2.5-flash   optional override
// Used by the GUI (POST /api/gemini/read) and `studio read <film>`.
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './serve.mjs';
import { codeAssistRead, getSubscriptionToken } from './gemini-auth.mjs';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

let envCache = null;
function dotEnv() {
  if (envCache) return envCache;
  envCache = {};
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) envCache[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env yet */ }
  return envCache;
}
export function envKey(name) { return process.env[name] || dotEnv()[name]; }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export async function geminiRead({ image, file = '', prompt, model, timeoutMs = 90_000 }) {
  // Auth order: your Google-account subscription (OAuth — Login with Google, no
  // API key) → GEMINI_API_KEY. Same request shape for both; only the header differs.
  const mime = MIME[(file.match(/\.\w+$/)?.[0] || '').toLowerCase()] || 'image/png';
  const bytes = Buffer.isBuffer(image) ? image : readFileSync(image);
  if (bytes.length > 14 * 1024 * 1024) throw new Error('image too large for inline upload (>14MB)');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: String(prompt || 'Describe this image.') }, { inline_data: { mime_type: mime, data: bytes.toString('base64') } }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  });

  const sub = await getSubscriptionToken().catch((e) => ({ error: e }));
  if (sub && !sub.error && sub.token && (sub.genai || sub.projectId)) {
    const m = (model && !['subscription'].includes(model) ? model : envKey('GEMINI_MODEL') || 'gemini-2.5-flash').trim();
    if (sub.genai) { // consumer Gemini API on subscription quota
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${sub.token}`, 'X-Goog-Api-Client': 'gl-node/22.17.0' },
        signal: AbortSignal.timeout(timeoutMs), body,
      }).catch((e2) => { throw new Error(`gemini fetch failed: ${e2.message}`); });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const detail = /"message":\s*"([^"]+)"/.exec(t)?.[1] || t.slice(0, 200);
        throw new Error(`gemini ${res.status} (subscription): ${detail}`);
      }
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error(`gemini returned no text (${j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'empty'})`);
      return { text, model: `${m} · subscription`, usage: j.usageMetadata || null, file };
    }
    return codeAssistRead({ token: sub.token, projectId: sub.projectId, image: bytes, prompt, model: m, timeoutMs });
  }
  const key = envKey('GEMINI_API_KEY');
  if (!key) {
    const why = sub?.needsLogin ? ` — this login has no generative-language scope or project (${(sub.why || '').slice(0, 120)})` : sub?.error ? ` — (${sub.error.message.slice(0, 120)})` : '';
    throw new Error(`no Gemini auth${why}: run \`studio login-gemini\` once (browser login with the Google account of your Google AI Pro subscription — no API key), or set GEMINI_API_KEY in .env`);
  }
  if (sub?.error) console.error(`note: subscription login unusable (${sub.error.message}); using API key`);
  const m = (model || envKey('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL).trim();

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: String(prompt || 'Describe this image.') }, { inline_data: { mime_type: mime, data: bytes.toString('base64') } }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    }),
  }).catch((e) => { throw new Error(`gemini fetch failed: ${e.message}`); });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const detail = /"message":\s*"([^"]+)"/.exec(t)?.[1] || t.slice(0, 200);
    throw new Error(`gemini ${res.status}: ${detail}`);
  }
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) {
    const reason = j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'empty response';
    throw new Error(`gemini returned no text (${reason})`);
  }
  return { text, model: m, usage: j.usageMetadata || null, file };
}

// ── agent mode: the Gemini CLI ─────────────────────────────────────────────
// The same "spawn a full agent, not a bare model" pattern the studio uses with
// Claude Code. `gemini` is a real agent: it reads the film's brief, shotlist and
// design from disk, so its critique is grounded in intent. Needs:
//   npm i -g @google/gemini-cli
// Auth: the same GEMINI_API_KEY from .env is passed through, or its own OAuth.
export async function hasGeminiCli() {
  return new Promise((ok) => {
    execFile('gemini', ['--version'], { timeout: 8000 }, (err) => ok(!err));
  });
}

export async function agentRead({ cwd, sheetPath, filmKey, prompt, timeoutMs = 180_000 }) {
  if (!(await hasGeminiCli()))
    throw new Error('gemini CLI not installed: `npm i -g @google/gemini-cli` (or use --engine api for the zero-install bare-vision path)');
  const env = { ...process.env };
  const key = envKey('GEMINI_API_KEY');
  if (key && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY) env.GEMINI_API_KEY = key; // .env key feeds the CLI too
  const full = `${prompt}

The contact sheet image for this round is attached as @${sheetPath} — read it first.
You are inside a motion-design studio; the film lives in films/${filmKey}/ with brief.md (intent),
shotlist.md (the beat-by-beat plan), design.json (the design system) and index.html (the code).
Ground every judgment in what you see in the sheet, and check the plan files if intent is unclear.`;
  return new Promise((ok, fail) => {
    execFile('gemini', ['--skip-trust', '--approval-mode', 'plan', '-p', full], { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const tail = String(stderr || '').split('\n').filter((l) => !/YOLO|Approval mode overridden/i.test(l)).join('\n').trim();
      if (err) return fail(new Error(`gemini CLI failed: ${(tail || err.message).slice(0, 300)}`));
      const text = String(stdout).trim();
      if (!text) return fail(new Error(`gemini CLI returned no text${tail ? ` (${tail.slice(0, 200)})` : ''}`));
      ok({ text, engine: 'gemini-cli' });
    });
  });
}
