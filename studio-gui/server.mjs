// Studio GUI server: films, live seek(t) preview, renders, sheets, reviews, gates, notes, jobs.
// Loopback only. pi drives the work from pi-web or the terminal; this page watches it happen.
//   node studio-gui/server.mjs      (or: studio gui)     env: STUDIO_PORT (default 3142)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { FILMS, fmtSlug, kindOf, readJson } from '../engine/lib/film.mjs';
import { hooksFor } from '../engine/kinds/registry.mjs';
import { OP_NAMES, OpError } from '../engine/lib/edit-ops.mjs';
import { applyOps, historyDepth, loadEdit, redo, syncFilm, undo } from '../engine/lib/edit-store.mjs';
import { binDir, readBin } from '../engine/ingest.mjs';
import { geminiRead } from '../engine/lib/gemini.mjs';
import { askAntigravity, antigravityAvailable } from '../engine/lib/antigravity.mjs';
import { claudeRead, claudeVisionAvailable } from '../engine/lib/claude-vision.mjs';
import { ROOT, safePath, sendFile } from '../engine/lib/serve.mjs';
// math films (kind: math): the math view's endpoints + jobs. All additive; the edit/motion paths are untouched.
import { writeFileSync } from 'node:fs';
import { runCapped } from '../engine/lib/capped.mjs';
import { pythonFor } from '../engine/doctor.mjs';
import { readMathFilm } from '../engine/math.mjs';
import { buildVoice } from '../engine/narration.mjs';
import { resolveWhere } from '../engine/where.mjs';

const PORT = Number(process.env.STUDIO_PORT || 3142);
const TOKEN = randomBytes(16).toString('hex');
const PUB = join(ROOT, 'studio-gui', 'public');
// ids the edit endpoints accept: film keys and media-bin source ids. No dots, no slashes, no leading
// dash, so a client id can never traverse, go absolute, or name a dotfile — the server joins the rest.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const OP_SNAP = [...OP_NAMES, 'snap'];  // 'snap' rides along in a batch as a query (applyOps answers it, changes nothing)
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

async function films() {
  if (!existsSync(FILMS)) return [];
  const rows = [];
  for (const k of readdirSync(FILMS)) {
    if (!existsSync(join(FILMS, k, 'film.json'))) continue;
    rows.push(await summary(k));
  }
  return rows.sort((a, b) => b.updated - a.updated);
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

async function summary(key) {
  const dir = join(FILMS, key);
  const cfg = readJson(join(dir, 'film.json'), {});
  const reviews = readJson(join(dir, 'reviews.json'), []);
  const gates = readJson(join(dir, 'gates.json'));
  const files = outFiles(dir);
  // the per-kind view flags come from the kind module (the math view mounts on "math" like
  // edit.json mounts the editor — ADR-001); edit/math default false exactly as before
  const flags = (await hooksFor(key)).summary?.(cfg, dir) ?? {};
  return {
    key, title: cfg.title || key, duration: cfg.duration, formats: cfg.formats || ['9:16'],
    edit: false, math: false, ...flags,
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
  check: (k) => ['check', k],   // math films: studio check (typeset + claims, dry-run; errors loudly on non-math)
  gate: (k) => ['gate', k],
  ship: (k) => ['ship', k],
};
const jobs = [];
const revoicing = new Set();   // films with a sentence re-voice in flight (one at a time, like the job guard)
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
    if (p === '/app.js' || p === '/edit.js' || p === '/math.js' || p === '/style.css') return sendFile(req, res, join(PUB, p.slice(1)));
    // Project files at their real paths: films import /engine/lib/*.js absolutely.
    if (/^\/(films|engine|refs|templates)\//.test(p)) { const full = safePath(p); if (!full) { res.writeHead(403); return res.end(); } return sendFile(req, res, full); }

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: {"type":"hello"}\n\n'); clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (p === '/api/films' && req.method === 'GET') return json(res, 200, await films());
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

    // ── the math film endpoints (kind: math — M7's view) ────────────────────────────────
    // Same rules as the edit tab: ids only, validated — film keys match ^[a-z0-9][a-z0-9-]*$ (the
    // route regex AND mathId re-check it), sentence ids the parser's own ^s\d+\.\d+$. No client
    // string ever reaches a path join as a free value: the server resolves everything under
    // films/<key>/ itself, so traversal, absolute paths and dotfiles are impossible by construction.
    // Scene code NEVER runs here: the one python child of a request (the syntax probe) parses
    // scenes/*.py with ast — no import, no exec — and the layout lint reads records only. Both go
    // through runCapped (the engine's memory/time guard), exactly like the engine's own calls.
    const SENT_RE = /^s\d{1,4}\.\d{1,4}$/;   // studio_manim.script's own sentence-id grammar
    const mathId = (v) => {
      const k = String(v ?? '');
      if (!ID_RE.test(k)) return null;
      const d = join(FILMS, k);
      return existsSync(join(d, 'film.json')) && kindOf(readJson(join(d, 'film.json'), {})) === 'math' ? k : null;
    };
    const mM = /^\/api\/film\/([a-z0-9-]+)\/(script|sentence|records|where)$/.exec(p);
    if (mM) {
      const [, keyRaw, sub] = mM;
      const k = mathId(keyRaw);
      if (!k) return json(res, 404, { error: 'no such math film (films/<key> with kind: math)' });
      const dir = join(FILMS, k);

      // GET script — script.md raw + sentences.json + timing.json, one document for the Script tab
      if (sub === 'script' && req.method === 'GET') {
        const doc = readJson(join(dir, 'sentences.json'), {});
        return json(res, 200, { key: k, script: read(join(dir, 'script.md')) ?? '',
          scenes: doc.scenes ?? [], doc: doc.sentences ?? [], timing: readJson(join(dir, 'timing.json'), {}) });
      }

      // POST sentence { id, text } — rewrite that ONE [id] line in script.md, re-voice it, return the
      // new timing entry. Runs in-process (like the edit tab's ops — never a CLI per click; measured
      // ~5 s), guarded per film: one re-voice at a time and never while a job runs for that film.
      // If the new prose breaks the script grammar, the line is rolled back and the parser's own
      // line-numbered errors come back with a 400.
      if (sub === 'sentence' && req.method === 'POST') {
        const b = await body(req);
        if (typeof b.id !== 'string' || !SENT_RE.test(b.id)) return json(res, 400, { error: 'id: a sentence id like s02.1' });
        if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 1000) return json(res, 400, { error: 'text: the sentence prose, 1-1000 characters' });
        const text = b.text.replace(/[\r\n]+/g, ' ').trim();
        if (jobs.some((j) => j.key === k && j.code === undefined)) return json(res, 409, { error: 'a job is already running for this film' });
        if (revoicing.has(k)) return json(res, 409, { error: 'a sentence re-voice is already running for this film' });
        const file = join(dir, 'script.md'), src = read(file);
        if (src == null) return json(res, 404, { error: `no script.md in films/${k}` });
        const lines = src.split('\n');
        const i = lines.findIndex((l) => l.trim() === `[${b.id}]` || l.trim().startsWith(`[${b.id}] `));
        if (i < 0) return json(res, 404, { error: `no sentence ${b.id} in films/${k}/script.md` });
        const before = lines[i];
        lines[i] = `[${b.id}] ${text}`;
        writeFileSync(file, lines.join('\n'));
        revoicing.add(k);
        try {
          let r;
          try { r = await buildVoice(k, { only: b.id }); }
          catch (e) {
            lines[i] = before; writeFileSync(file, lines.join('\n'));
            return json(res, 400, { error: `script.md rejected the new sentence:\n  ${(e.errors || [e.message || e]).join('\n  ')}` });
          }
          return json(res, 200, { ok: true, id: b.id, voiced: r.voiced, duration: r.duration,
            sentence: (r.sentences || []).find((s) => s.id === b.id) ?? null });
        } finally { revoicing.delete(k); }
      }

      // GET records — the scenes table (timeline seconds + last render per format + a SYNTAX
      // probe: ast.parse, never an import), the layout lint (the same capped studio_manim.lint CLI
      // the checks run, per format), the claims ledger (records/<fmt>/*-claims.json) and gates.json.
      if (sub === 'records' && req.method === 'GET') {
        const film = readMathFilm(k);
        const SYNTAX_PY = ['import ast, json, sys', 'out = []',
          'for f in sys.argv[1:]:',
          '    try:',
          '        ast.parse(open(f, encoding="utf-8").read(), filename=f)',
          '        out.append({"file": f, "ok": True})',
          '    except SyntaxError as e:',
          '        out.append({"file": f, "ok": False, "message": e.msg or str(e), "line": e.lineno, "offset": e.offset})',
          'print("RESULT " + json.dumps(out))'].join('\n');
        const rels = film.scenes.map((s) => `scenes/${s.id}.py`);
        // the probe + one lint per format: independent capped children, run together (measured ~2 s)
        const syntaxP = runCapped(pythonFor('manim'), ['-c', SYNTAX_PY, ...rels],
          { cwd: dir, memoryMb: 512, timeoutS: 20, label: `gui syntax ${k}` }).catch(() => null);
        const lintPs = (film.cfg.formats || []).map((f) => {
          const rd = join(dir, 'records', fmtSlug(f));
          if (!existsSync(rd)) return Promise.resolve(null);   // never rendered in this format
          return runCapped(pythonFor('manim'), ['-m', 'studio_manim.lint', rd, join(dir, 'design.json'), f],
            { cwd: ROOT, memoryMb: 512, timeoutS: 30, label: `gui lint ${k} ${f}`, env: { PYTHONPATH: join(ROOT, 'engine', 'manim') } }).catch(() => null);
        });
        const [syntax, ...lintRs] = await Promise.all([syntaxP, ...lintPs]);
        let syn = {};
        if (syntax && syntax.code === 0) {
          try { syn = Object.fromEntries(JSON.parse((syntax.out || '').trim().replace(/^.*RESULT /s, '')).map((x) => [x.file, x])); } catch { /* shown as unprobed below */ }
        }
        const lint = {};
        (film.cfg.formats || []).forEach((f, i) => {
          const r = lintRs[i];
          if (r === null) { lint[f] = null; return; }   // no records dir for this format
          try { lint[f] = { violations: JSON.parse((r.out || '').trim()), source: 'studio_manim.lint (capped, 30s)' }; }
          catch { lint[f] = { error: `lint ${f} failed (rc ${r.code}): ${(r.err || r.out || '').trim().split('\n').slice(-2).join(' ')}` }; }
        });
        const claims = [];
        for (const f of film.cfg.formats || []) {
          const rd = join(dir, 'records', fmtSlug(f));
          if (!existsSync(rd)) continue;
          for (const file of readdirSync(rd)) {
            if (!file.endsWith('-claims.json')) continue;
            for (const c of readJson(join(rd, file), [])) claims.push({ fmt: f, scene: file.replace(/-claims\.json$/, ''), ...c });
          }
        }
        const scenes = film.scenes.map((s) => {
          const probe = syn[`scenes/${s.id}.py`];
          const row = { id: s.id, file: `scenes/${s.id}.py`, seconds: {}, lastRender: {}, claims: claims.filter((c) => c.scene === s.id).length,
            error: probe && !probe.ok ? { file: `scenes/${s.id}.py`, line: probe.line, message: probe.message } : null };
          for (const f of film.cfg.formats || []) {
            const tl = join(dir, 'records', fmtSlug(f), `${s.id}-timeline.json`);
            if (existsSync(tl)) { row.seconds[f] = readJson(tl, {}).seconds ?? null; row.lastRender[f] = mtime(tl); }
          }
          return row;
        });
        return json(res, 200, { key: k, formats: film.cfg.formats || [], scenes, lint, claims,
          gates: readJson(join(dir, 'gates.json'), null),
          note: 'syntax: ast.parse (capped, no import); lint: studio_manim.lint (capped)' });
      }

      // GET where?t=<s>[&fmt=] — resolveWhere: the scene, sentence, animation and file:line that own
      // a timecode (the Notes tab's resolver — a note pinned at 49.27 s leads straight to the code).
      if (sub === 'where' && req.method === 'GET') {
        const rawT = url.searchParams.get('t');
        const t = Number(rawT);
        if (rawT == null || rawT.trim() === '' || !Number.isFinite(t) || t < 0 || t > 1e6)
          return json(res, 400, { error: 't: seconds since 0 — a finite number >= 0 (e.g. ?t=12.34)' });
        const fmt = url.searchParams.get('fmt');
        const formats = readJson(join(dir, 'film.json'), {}).formats || [];
        if (fmt != null && !formats.includes(fmt)) return json(res, 400, { error: `fmt: one of ${formats.join(', ')}` });   // '' is malformed, not absent
        const r = resolveWhere(k, t, fmt || undefined);
        return r && r.error ? json(res, 404, { error: r.error }) : json(res, 200, r);
      }
    }

    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Motion Studio GUI: http://localhost:${PORT}`));
