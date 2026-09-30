// Subscription auth: Gemini via your Google account (Google AI Pro / Code Assist
// free tier), NOT an API key. The studio's own updated take on the old
// pi-gemini-auth pattern — one login, shared with the `gemini` CLI:
//
//   * reads/writes ~/.gemini/oauth_creds.json (the CLI's own file, WSL side)
//   * also reads a Windows-side CLI login (C:\Users\<you>\.gemini\oauth_creds.json)
//   * PKCE browser login: `studio login-gemini` → click the URL it prints
//   * then `studio read <film>` (and the GUI reader) run on subscription quota
//
// Endpoint: cloudcode-pa.googleapis.com (Cloud Code Assist, the Gemini CLI backend).
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EP = 'https://cloudcode-pa.googleapis.com';
const REDIRECT_URI = 'http://localhost:8085/oauth2callback';
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language', // consumer Gemini API (AI Pro quota)
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');
// The Gemini CLI's public embedded OAuth client (same one upstream CLI + the old
// pi-gemini-auth used; base64 is the upstream obfuscation, not a secret).
const CLIENT_ID = Buffer.from('NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2' + 'YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t', 'base64').toString();
const CLIENT_SECRET = Buffer.from('R09DU1BYLTR1SGdNUG0tMW83' + 'U2stZ2VWNkN1NWNsWEZzeGw=', 'base64').toString();
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'X-Goog-Api-Client': 'gl-node/22.17.0',
  'Client-Metadata': JSON.stringify({ ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }),
};
export const SUB_DEFAULT_MODEL = 'gemini-2.5-pro';

// ── credentials: wherever a Gemini CLI login lives ─────────────────────────
export function credsPaths() {
  const out = [];
  if (process.env.GEMINI_OAUTH_CREDS) out.push(process.env.GEMINI_OAUTH_CREDS);
  out.push(join(homedir(), '.gemini', 'oauth_creds.json'));                      // WSL CLI / our login
  try { for (const u of readdirSync('/mnt/c/Users')) { const p = `/mnt/c/Users/${u}/.gemini/oauth_creds.json`; if (u !== 'Public' && existsSync(p)) out.push(p); } } catch {}
  return [...new Set(out.filter((p) => existsSync(p)))];
}
function readCreds() {
  for (const p of credsPaths()) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j.access_token || j.refresh_token) return { path: p, j };
    } catch { /* skip unreadable */ }
  }
  return null;
}
const writeCreds = (path, j) => { try { writeFileSync(path, JSON.stringify(j, null, 2)); } catch { /* read-only Windows side: fine */ } };

async function refreshAccessToken(path, j) {
  if (!j.refresh_token) throw new Error('login expired: run `studio login-gemini`');
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: j.refresh_token, grant_type: 'refresh_token' }),
  }).catch(() => { throw new Error('token refresh network error'); });
  if (!res.ok) throw new Error(`login expired (refresh ${res.status}): run \`studio login-gemini\``);
  const d = await res.json();
  j.access_token = d.access_token;
  if (d.refresh_token) j.refresh_token = d.refresh_token;
  if (d.expires_in) j.expiry_date = Date.now() + (d.expires_in - 240) * 1000;
  writeCreds(path, j);
  return j.access_token;
}
export async function getSubscriptionToken() {
  const c = readCreds();
  if (!c) return null;
  const fresh = c.j.expiry_date && c.j.expiry_date > Date.now() ? c.j.access_token : await refreshAccessToken(c.path, c.j);
  if (!fresh) return null;
  const scopes = String(c.j.scope || '');
  if (scopes.includes('generative-language'))
    return { token: fresh, projectId: '', path: c.path, genai: true }; // consumer Gemini API: no project needed
  let projectId = c.j.project_id || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!projectId) { // a CLI login (cloud-platform only): try Code Assist discovery + cache
    try { projectId = await discoverProject(fresh); c.j.project_id = projectId; writeCreds(c.path, c.j); }
    catch (e) { return { token: fresh, projectId: '', path: c.path, genai: false, needsLogin: true, why: e.message }; }
  }
  return { token: fresh, projectId, path: c.path, genai: false };
}

// ── project discovery (Code Assist needs a cloudaicompanion project) ───────
export async function discoverProject(token, { onProgress } = {}) {
  const post = (method, body) => fetch(`${EP}/v1internal:${method}`, { method: 'POST', headers: { ...HEADERS, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const meta = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };
  const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  onProgress?.('checking Code Assist project…');
  const load = await post('loadCodeAssist', { cloudaicompanionProject: envProjectId, metadata: meta });
  const loadBody = load.ok ? await load.json().catch(() => null) : null;
  const existing = loadBody?.cloudaicompanionProject || loadBody?.currentCloudaicompanionProject;
  if (existing) return existing;
  onProgress?.('onboarding (first login)…');
  // tier comes from the account's allowedTiers (Google AI Pro / Code Assist: standard-tier)
  const def = loadBody?.allowedTiers?.find((t) => t.isDefault && t.id);
  const tierId = def?.id || 'free-tier';
  const ob = await post('onboardUser', { tierId, metadata: meta, ...(envProjectId ? { cloudaicompanionProject: envProjectId, metadata: { ...meta, duetProject: envProjectId } } : {}) });
  if (!ob.ok) throw new Error(`onboardUser ${ob.status}: ${(await ob.text().catch(() => '')).slice(0, 200)}`);
  const op = await ob.json();
  const done = await (op.done ? Promise.resolve(op) : new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('onboarding timed out')), 60_000);
    const poll = async () => {
      const r = await fetch(`${EP}${op.name}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (j.done) { clearTimeout(t); ok(j); } else setTimeout(poll, 1500);
    };
    poll();
  }));
  const id = done?.result?.cloudaicompanionProject || done?.result?.project?.id || '';
  if (!id) throw new Error('could not discover a Code Assist project — set GOOGLE_CLOUD_PROJECT or run `gemini` once interactively');
  return id;
}

// ── login: browser PKCE → ~/.gemini/oauth_creds.json (shared with `gemini`) ─
export async function loginGemini({ onProgress } = {}) {
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state, code_challenge: challenge, code_challenge_method: 'S256',
  })}`;

  const code = await new Promise((ok, fail) => {
    let done = false, timer = null;
    const srv = createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://localhost:8085');
      if (u.pathname !== '/oauth2callback') return;
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html' }); res.end('<h3>state mismatch — retry the login command</h3>');
        return finish(fail, new Error('OAuth state mismatch'));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h3>Motion Studio: login OK — you can close this tab and go back to the terminal.</h3>');
      finish(ok, u.searchParams.get('code'));
    });
    const finish = (fn, arg) => { if (!done) { done = true; if (timer) clearTimeout(timer); srv.close(); try { fn(arg); } catch {} } };
    srv.on('error', (e) => finish(fail, new Error(`callback server on :8085 failed (${e.code}) — port in use?`)));
    timer = setTimeout(() => finish(fail, new Error('login timed out after 5 minutes — retry')), 300_000);
    srv.listen(8085, '127.0.0.1', () => onProgress?.(url));
  });

  const tr = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code_verifier: verifier }),
  });
  if (!tr.ok) throw new Error(`token exchange ${tr.status}: ${(await tr.text().catch(() => '')).slice(0, 200)}`);
  const t = await tr.json();

  onProgress?.('discovering project…');
  let projectId = '';
  try { projectId = await discoverProject(t.access_token, { onProgress }); }
  catch (e) { onProgress?.(`project discovery skipped (${String(e.message).split('\n')[0].slice(0, 90)}) — fine: the consumer Gemini API needs no project)`); }
  const dir = join(homedir(), '.gemini');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'oauth_creds.json');
  writeFileSync(file, JSON.stringify({
    access_token: t.access_token, refresh_token: t.refresh_token,
    token_type: 'Bearer', scope: t.scope, id_token: t.id_token,
    expiry_date: Date.now() + ((t.expires_in || 3600) - 240) * 1000, project_id: projectId,
  }, null, 2));
  return { file, projectId, refresh: !!t.refresh_token };
}

// ── generateContent on the subscription backend ─────────────────────────────
export async function codeAssistRead({ token, projectId, image, prompt, model = SUB_DEFAULT_MODEL, timeoutMs = 120_000 }) {
  if (!projectId) throw new Error('no Code Assist project on this login — run `studio login-gemini` again');
  const res = await fetch(`${EP}/v1internal:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      project: projectId, model,
      request: {
        contents: [{ role: 'user', parts: [{ text: String(prompt || 'Describe this image.') }, { inlineData: { mimeType: 'image/png', data: Buffer.from(image).toString('base64') } }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      },
    }),
  }).catch((e) => { throw new Error(`code assist fetch failed: ${e.message}`); });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Code Assist ${res.status}: ${(/"message":\s*"([^"]+)"/.exec(txt)?.[1] || txt).slice(0, 220)}`);
  }
  const sse = await res.text();
  let out = '';
  for (const chunk of sse.split('\n')) {
    if (!chunk.startsWith('data: ') || chunk.includes('[DONE]')) continue;
    try {
      const j = JSON.parse(chunk.slice(6));
      out += (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    } catch { /* partial chunk */ }
  }
  if (!out.trim()) throw new Error('Code Assist returned no text (quota or policy? re-login: studio login-gemini)');
  return { text: out.trim(), model: `${model} · subscription`, engine: 'subscription' };
}

// ── smoke test: one tiny text call on the subscription quota ─────────────────
export async function subPing() {
  const s = await getSubscriptionToken();
  if (!s?.genai) throw new Error(s?.needsLogin ? s.why : 'login lacks the generative-language scope — re-run studio login-gemini');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${s.token}`, 'X-Goog-Api-Client': 'gl-node/22.17.0' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: SUBSCRIPTION-OK' }] }] }),
  });
  if (!res.ok) throw new Error(`ping ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('ping returned no text');
  return text;
}
