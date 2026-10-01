// Studio GUI server: films, live seek(t) preview, renders, sheets, reviews, gates, notes, jobs.
// Loopback only. pi drives the work from pi-web or the terminal; this page watches it happen.
//   node studio-gui/server.mjs      (or: studio gui)     env: STUDIO_PORT (default 3142)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { FILMS, readJson } from '../engine/lib/film.mjs';
import { OP_NAMES, OpError } from '../engine/lib/edit-ops.mjs';
import { applyOps, historyDepth, loadEdit, redo, syncFilm, undo } from '../engine/lib/edit-store.mjs';
import { binDir, readBin } from '../engine/ingest.mjs';
import { geminiRead } from '../engine/lib/gemini.mjs';
import { askAntigravity, antigravityAvailable } from '../engine/lib/antigravity.mjs';
import { claudeRead, claudeVisionAvailable } from '../engine/lib/claude-vision.mjs';
import { ROOT, safePath, sendFile } from '../engine/lib/serve.mjs';

const PORT = Number(process.env.STUDIO_PORT || 3142);
const TOKEN = randomBytes(16).toString('hex');
const PUB = join(ROOT, 'studio-gui', 'public');
// ids the edit endpoints accept: film keys and media-bin source ids. No dots, no slashes, no leading
// dash, so a client id can never traverse, go absolute, or name a dotfile — the server joins the rest.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const OP_SNAP = [...OP_NAMES, 'snap'];  // 'snap' rides along in a batch as a query (applyOps answers it, changes nothing)
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

function films() {
  if (!existsSync(FILMS)) return [];
  return readdirSync(FILMS).filter((k) => existsSync(join(FILMS, k, 'film.json'))).map(summary)
    .sort((a, b) => b.updated - a.updated);
}

function outFiles(dir) {
  const out = join(dir, 'out'), list = [];
  for (const sub of ['', 'sheets']) {
    const d = join(out, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (f.startsWith('.')) continue;
      const p = join(d, f), st = statSync(p);
      if (st.isFile()) list.push({ name: sub ? `${sub}/${f}` : f, size: st.size, mtime: st.mtimeMs });
    }
  }
  return list.sort((a, b) => b.mtime - a.mtime);
}

function summary(key) {
  const dir = join(FILMS, key);
  const cfg = readJson(join(dir, 'film.json'), {});
  const reviews = readJson(join(dir, 'reviews.json'), []);
  const gates = readJson(join(dir, 'gates.json'));
  const files = outFiles(dir);
  return {
    key, title: cfg.title || key, duration: cfg.duration, formats: cfg.formats || ['9:16'],
    edit: existsSync(join(dir, 'edit.json')),
    review: reviews.length ? { round: reviews.length, min: reviews.at(-1).min, pass: reviews.at(-1).pass } : null,
    gates: gates ? { pass: gates.pass, warns: gates.checks.filter((c) => c.level === 'warn').length, at: gates.at } : null,
    finals: files.filter((f) => /^final-[^.]*\.mp4$/.test(f.name)).map((f) => f.name),
    updated: Math.max(mtime(join(dir, 'index.html')), ...files.map((f) => f.mtime), mtime(join(dir, 'reviews.json'))),
  };
}

function detail(key) {
  const dir = join(FILMS, key);
  if (!existsSync(join(dir, 'film.json'))) return null;
  return {
    ...summary(key),
    cfg: readJson(join(dir, 'film.json')),
    design: readJson(join(dir, 'design.json')),
    beats: readJson(join(dir, 'beats.json')),
    cues: readJson(join(dir, 'cues.json'), []),
    reviews: readJson(join(dir, 'reviews.json'), []),
    gatesFull: readJson(join(dir, 'gates.json')),
    notes: readJson(join(dir, 'notes.json'), []),
    brief: read(join(dir, 'brief.md')),
    shotlist: read(join(dir, 'shotlist.md')),
    reviewLog: read(join(dir, 'review_log.md')),
    files: outFiles(dir),
    code: mtime(join(dir, 'index.html')),
  };
}

// ── live updates: poll signatures (WSL's inotify misses Windows-side writes) ─
const clients = new Set();
const send = (ev) => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(s); };
const sigs = new Map();
function signature(key) {
  const dir = join(FILMS, key);
  const own = readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => `${f}:${mtime(join(dir, f))}`);
  return [...own, ...outFiles(dir).map((f) => `${f.name}:${f.mtime}`)].join('|');
}
setInterval(() => {
  if (!clients.size || !existsSync(FILMS)) return;
  const keys = readdirSync(FILMS).filter((k) => existsSync(join(FILMS, k, 'film.json')));
  if (keys.length !== [...sigs.keys()].length) send({ type: 'films' });
  for (const k of keys) {
    const s = signature(k);
    if (sigs.has(k) && sigs.get(k) !== s) send({ type: 'film', key: k, code: mtime(join(FILMS, k, 'index.html')) });
    sigs.set(k, s);
  }
  for (const k of [...sigs.keys()]) if (!keys.includes(k)) sigs.delete(k);
}, 1000);

// ── jobs: the GUI's buttons run the same CLI pi uses ────────────────────────
const JOBS = {
  look: (k) => ['look', k, '--mode', 'every', '--every', '0.5'],
  beats: (k) => ['look', k, '--mode', 'beats'],
  phone: (k) => ['look', k, '--mode', 'phone'],
  draft: (k) => ['render', k, '--draft'],
  render: (k) => ['render', k, '--fmt', 'all'],
  sound: (k) => ['sound', k],
  gate: (k) => ['gate', k],
  ship: (k) => ['ship', k],
};
const jobs = [];
function startJob(key, kind, extra = []) {
  if (jobs.some((j) => j.key === key && j.code === undefined)) throw Object.assign(new Error('a job is already running for this film'), { status: 409 });
  const args = [...JOBS[kind](key), ...extra];
  const job = { id: jobs.length + 1, key, kind, args, log: [], started: Date.now() };
  jobs.push(job); if (jobs.length > 50) jobs.shift();
  const p = spawn(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT });
  const line = (d) => String(d).split('\n').filter(Boolean).forEach((l) => { job.log.push(l); send({ type: 'job', id: job.id, key, line: l }); });
  p.stdout.on('data', line); p.stderr.on('data', line);
  p.on('close', (code) => { job.code = code; job.ended = Date.now(); send({ type: 'job-end', id: job.id, key, kind, code }); });
  send({ type: 'job-start', id: job.id, key, kind, args });
  return job;
}

// ── http ────────────────────────────────────────────────────────────────────
const json = (res, status, v) => { const b = JSON.stringify(v); res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(b); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
const allowedHost = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);

const server = createServer(async (req, res) => {
  try {
    if (!allowedHost.has((req.headers.host || '').toLowerCase())) { res.writeHead(403); return res.end('bad host'); }
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    if (req.method === 'POST' && req.headers['x-studio-token'] !== TOKEN) return json(res, 403, { error: 'bad token' });

    if (p === '/' || p === '/index.html') {
      const html = readFileSync(join(PUB, 'index.html'), 'utf8').replace('__TOKEN__', TOKEN);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html);
    }
    if (p === '/app.js' || p === '/edit.js' || p === '/style.css') return sendFile(req, res, join(PUB, p.slice(1)));
    // Project files at their real paths: films import /engine/lib/*.js absolutely.
    if (/^\/(films|engine|refs|templates)\//.test(p)) { const full = safePath(p); if (!full) { res.writeHead(403); return res.end(); } return sendFile(req, res, full); }

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: {"type":"hello"}\n\n'); clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (p === '/api/films' && req.method === 'GET') return json(res, 200, films());
    if (p === '/api/jobs') return json(res, 200, jobs.slice(-20).map(({ log, ...j }) => ({ ...j, tail: log.slice(-200) })));
    // An AI reads a sheet/poster: { key, file, prompt, model?, engine? }
    // Antigravity agents (Google AI Pro subscription, no key) preferred; API-key vision as fallback.
    if (p === '/api/gemini/read' && req.method === 'POST') {
      const b = await body(req);
      if (!/^[a-z0-9-]+$/.test(b.key || '') || !existsSync(join(FILMS, b.key, 'film.json'))) return json(res, 404, { error: 'no such film' });
      const relFile = String(b.file || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (/[.]{2}|[&=]|^\s*$/.test(relFile) || !/^([\w-]+\/)*[\w.-]+\.(png|jpe?g|webp)$/i.test(relFile))
        return json(res, 400, { error: 'file: image name under films/<key>/out, e.g. sheets/times-9x16.png' });
      const full = join(FILMS, b.key, 'out', relFile);
      if (!existsSync(full)) return json(res, 404, { error: 'no such image — run Look first' });
      // Vision: Claude Sonnet 5.5 (via Claude Code — same login and quota as
      // the claude-bridge models). Antigravity agent as fallback; API-key
      // Gemini last (GEMINI_API_KEY in .env), for when neither is available.
      if (claudeVisionAvailable()) {
        try {
          const r = await claudeRead({ image: full, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
          return json(res, 200, r);
        } catch (e) {
          if (!antigravityAvailable()) {
            try {
              const r = await geminiRead({ image: readFileSync(full), file: relFile, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
              return json(res, 200, { ...r, note: `Claude failed (${String(e.message).slice(0, 120)}); used API key` });
            } catch { return json(res, 502, { error: e.message }); }
          }
          try {
            const r = await askAntigravity({ image: full, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
            return json(res, 200, { ...r, note: `Claude failed (${String(e.message).slice(0, 90)}); used an Antigravity agent` });
          } catch { return json(res, 502, { error: e.message }); }
        }
      }
      if (antigravityAvailable()) {
        try {
          const r = await askAntigravity({ image: full, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
          return json(res, 200, r);
        } catch (e) {
          try { // fall back to the API-key path if the Antigravity agent fails
            const r = await geminiRead({ image: readFileSync(full), file: relFile, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
            return json(res, 200, { ...r, note: `antigravity failed (${String(e.message).slice(0, 120)}); used API key` });
          } catch { return json(res, 502, { error: e.message }); }
        }
      }
      const r = await geminiRead({ image: readFileSync(full), file: relFile, prompt: String(b.prompt || '').slice(0, 8000), model: b.model });
      return json(res, 200, r);
    }
    if (p === '/api/films' && req.method === 'POST') {
      const b = await body(req);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(b.key || '')) return json(res, 400, { error: 'key: lowercase letters, digits, dashes' });
      const args = ['new', b.key, '--duration', String(b.duration || 15), '--formats', (b.formats || ['9:16']).join(',')];
      if (b.title) args.push('--title', b.title);
      const r = await new Promise((ok) => { const c = spawn(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT }); let e = ''; c.stderr.on('data', (d) => (e += d)); c.on('close', (code) => ok({ code, e })); });
      return r.code ? json(res, 400, { error: r.e.trim() }) : json(res, 200, { ok: true, key: b.key });
    }
    const m = /^\/api\/films\/([a-z0-9-]+)(?:\/(job|notes))?$/.exec(p);
    if (m) {
      const [, key, sub] = m;
      if (!sub) { const d = detail(key); return d ? json(res, 200, d) : json(res, 404, { error: 'no such film' }); }
      if (sub === 'job' && req.method === 'POST') {
        const b = await body(req);
        if (!JOBS[b.kind]) return json(res, 400, { error: `kind: ${Object.keys(JOBS).join(', ')}` });
        try { return json(res, 200, { id: startJob(key, b.kind).id }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
      }
      if (sub === 'notes' && req.method === 'POST') {
        // Notes pinned to a timecode. pi reads notes.json at the start of every round (see the motion-reel skill).
        const b = await body(req), file = join(FILMS, key, 'notes.json');
        const notes = readJson(file, []);
        if (b.resolve != null) { const n = notes.find((x) => x.id === b.resolve); if (n) n.done = true; }
        else if (b.text) {
          notes.push({ id: (notes.at(-1)?.id || 0) + 1, t: +(+b.t || 0).toFixed(2), fmt: b.fmt, text: String(b.text).slice(0, 2000), at: new Date().toISOString(), done: false });
          appendFileSync(join(FILMS, key, 'review_log.md'), `\n> **note from you @ ${(+b.t || 0).toFixed(2)}s:** ${String(b.text).slice(0, 2000)}\n`);
        }
        (await import('../engine/lib/film.mjs')).writeJson(file, notes);
        return json(res, 200, notes);
      }
    }

    // ── the edit tab: edit.json in-process through edit-ops/edit-store, never a CLI per click ────────
    // Ids only, validated: film keys and source ids match ^[a-z0-9][a-z0-9-]*$ (no dots, slashes or
    // leading dash), so no client string can traverse, name an absolute path or reach a dotfile. The
    // server resolves every id under films/<key>/ itself.
    const editId = (v) => { const k = String(v ?? ''); if (!ID_RE.test(k)) return null; const d = join(FILMS, k); return existsSync(join(d, 'film.json')) && existsSync(join(d, 'edit.json')) ? k : null; };
    const opFail = (e, res2, key) => {
      const status = e.code === 'conflict' ? 409 : e.code === 'notfound' ? 404 : 400;
      const cur = status === 409 ? (() => { try { return loadEdit(key).edit; } catch { return null; } })() : null;
      return json(res2, status, { error: String(e.message || e), code: e.code || 'invalid', ...(cur ? { edit: cur, rev: cur.rev } : {}) });
    };
    // A batch from the browser is ids + numbers. The one op that names a file (lut) is checked against
    // the repo root before edit-ops ever sees it; unknown ops/ids are rejected up front for a clean 400.
    const checkOps = (ops) => {
      if (!Array.isArray(ops) || !ops.length || ops.length > 500) throw new OpError('ops: an array of 1-500 ops');
      for (const o of ops) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) throw new OpError('each op is an object { op, ... }');
        const name = o.op ?? o.name;
        if (!OP_SNAP.includes(name)) throw new OpError(`unknown op "${name}" (ops: ${OP_NAMES.join(', ')})`);
        if (o.src !== undefined && (typeof o.src !== 'string' || !ID_RE.test(o.src))) throw new OpError(`bad source id ${JSON.stringify(o.src)}`);
        if (typeof o.file === 'string') {   // lut { file }: the one op that names a file — relative, inside the repo, .cube/.3dl
          const f = o.file.replace(/\\/g, '/');
          if (f.includes('..') || /^[a-z]:/i.test(f) || f.startsWith('/') || !/^(?!\/)([\w][\w .\-()]*\/)*[\w][\w .\-()]*\.(cube|3dl)$/i.test(f))
            throw new OpError(`lut file must be a repo-relative .cube/.3dl path (no .., no absolute), got ${JSON.stringify(o.file)}`);
          if (!safePath('/' + f)) throw new OpError(`lut file does not resolve inside the repo: ${JSON.stringify(o.file)}`);
        }
      }
      return ops;
    };

    if (p === '/api/edit' && req.method === 'GET') {
      const key = editId(url.searchParams.get('film'));
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      let r; try { r = loadEdit(key); } catch (e) { return e instanceof OpError ? opFail(e, res, key) : json(res, 500, { error: String(e.message || e) }); }
      const { film, edit } = r;
      const sources = {};
      for (const [id, s] of Object.entries(readBin(film).sources || {})) {
        const md = join(binDir(film), id), mj = readJson(join(md, 'media.json'), null);
        sources[id] = { ...s, original_here: existsSync(s.path), has_transcript: existsSync(join(md, 'transcript.json')),
          has_filmstrip: existsSync(join(md, 'filmstrip.jpg')), has_peaks: existsSync(join(md, 'peaks.json')), ingest: mj?.ingest ?? null };
      }
      return json(res, 200, { key: film.key, edit, rev: edit.rev, editMtime: mtime(join(film.dir, 'edit.json')),
        history: historyDepth(key), sources,
        ops: OP_NAMES,   // what THIS engine build can do: the editor shows/hides affordances accordingly (e.g. a clip-note op)
        cfg: { title: film.cfg.title, fps: film.cfg.fps, duration: film.cfg.duration, formats: film.cfg.formats } });
    }
    // Peaks and transcripts are OPTIONAL per-source ingest products: a source without audio has no
    // peaks, one without speech has no transcript, and a stale edit can name a source the bin lost.
    // Missing = a first-class empty state (the film page treats its own optional fetches the same way,
    // see film.mjs), so these answer 200 with an empty document instead of 404: the editor then draws
    // no waveform / shows the transcribe affordance, and no legitimate state logs a failed request.
    // Malformed ids (traversal, absolute, dotfile) still answer 400.
    if ((p === '/api/peaks' || p === '/api/transcript') && req.method === 'GET') {
      const key = editId(url.searchParams.get('film')), src = String(url.searchParams.get('src') ?? '');
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      if (!ID_RE.test(src)) return json(res, 400, { error: 'src: a source id from the media bin' });
      const file = join(FILMS, key, 'assets', 'media', src, p === '/api/peaks' ? 'peaks.json' : 'transcript.json');
      if (existsSync(file)) return sendFile(req, res, file);
      return json(res, 200, p === '/api/peaks'
        ? { rate: 100, scale: 127, channels: 1, buckets: 0, data: [], src }       // no peaks: nothing to draw
        : { version: 1, language: null, words: [], transcribed: false, src });   // no transcript yet: the pane offers to transcribe
    }
    if (p === '/api/edit-ops' && req.method === 'POST') {
      const key = editId(url.searchParams.get('film'));
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      const b = await body(req), ops = Array.isArray(b) ? b : b.ops;
      try {
        checkOps(ops);
        const r = applyOps(key, ops, { baseRev: b.baseRev, who: 'gui' });
        let sync = null; if (r.changed) { try { sync = syncFilm(key); } catch { /* film.json unchanged; the next op syncs */ } }
        return json(res, 200, { ...r, history: historyDepth(key), sync });
      } catch (e) { if (e instanceof OpError) return opFail(e, res, key); return json(res, 500, { error: String(e.message || e) }); }
    }
    if ((p === '/api/edit-undo' || p === '/api/edit-redo') && req.method === 'POST') {
      const key = editId(url.searchParams.get('film'));
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      const b = await body(req);
      try {
        const r = (p === '/api/edit-undo' ? undo : redo)(key, { baseRev: b.baseRev });
        try { syncFilm(key); } catch { /* keep the edit; film.json catches up on the next op */ }
        return json(res, 200, { edit: r.edit, rev: r.rev, history: historyDepth(key) });
      } catch (e) { if (e instanceof OpError) return opFail(e, res, key); return json(res, 500, { error: String(e.message || e) }); }
    }
    // Cut proposals, dry: the same measured cuts the CLI lists, for the review panel (accept = one op)
    if (p === '/api/edit-cuts' && req.method === 'POST') {
      const key = editId(url.searchParams.get('film'));
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      const b = await body(req), kind = String(b.kind ?? 'silence');
      const C = await import('../engine/cut.mjs');
      const fns = { silence: C.cutSilence, fillers: C.cutFillers, takes: C.cutTakes, idle: C.cutIdle, tighten: C.tighten };
      if (!fns[kind]) return json(res, 400, { error: 'kind: silence, fillers, takes, idle or tighten' });
      if (b.src !== undefined && !ID_RE.test(String(b.src))) return json(res, 400, { error: 'src: a source id from the media bin' });
      const num = (v, lo, hi, d) => (v === undefined || v === null || v === '' ? d : Math.min(hi, Math.max(lo, Number(v)) || d));
      const opts = { src: b.src, apply: false, log: () => {},
        ...(kind === 'silence' ? { maxGap: num(b.maxGap, 0.1, 10, 0.5), keepBreath: num(b.keepBreath, 0, 1, 0.15) } : {}),
        ...(kind === 'takes' ? { window: num(b.window, 2, 120, 20) } : {}),
        ...(kind === 'idle' ? { maxIdle: num(b.maxIdle, 0.2, 10, 1), speedUp: !!b.speedUp, speed: num(b.speed, 1, 16, 4) } : {}),
        ...(kind === 'tighten' && b.target !== undefined && b.target !== null && b.target !== '' ? { target: num(b.target, 1, 24 * 3600, 60) } : {}) };
      try { return json(res, 200, await fns[kind](key, opts)); } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
    }
    if (p === '/api/edit-transcribe' && req.method === 'POST') {  // local ASR, cached by (sha, model, language)
      const key = editId(url.searchParams.get('film'));
      if (!key) return json(res, 404, { error: 'no such edit film (films/<key>/edit.json)' });
      const b = await body(req);
      if (typeof b.src !== 'string' || !ID_RE.test(b.src)) return json(res, 400, { error: 'src: a source id from the media bin' });
      const model = ['tiny', 'base', 'small', 'medium'].includes(b.model) ? b.model : 'small';
      const language = typeof b.language === 'string' && /^[a-z]{2,3}$/.test(b.language) ? b.language : 'auto';
      try {
        const r = await (await import('../engine/transcribe.mjs')).transcribe(key, b.src, { model, language });
        return json(res, 200, { language: r.language, words: r.words.length, cached: !!r.cached });
      } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
    }

    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Motion Studio GUI: http://localhost:${PORT}`));
