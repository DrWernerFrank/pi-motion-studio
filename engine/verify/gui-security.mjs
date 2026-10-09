// gui-security: every new endpoint refuses what it must. POST without the token -> 403; traversal,
// absolute paths, dotfiles and unknown film ids rejected; no endpoint reads a file outside the repo.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEditFilm } from '../edit-cli.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const KEY = 'verify-sec', PORT = 3199, BASE = `http://127.0.0.1:${PORT}`;   // IPv4 literal: localhost resolves ::1 first here and the server binds 127.0.0.1 (D-012's class)

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });

  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env: { ...process.env, STUDIO_PORT: String(PORT) }, stdio: 'ignore', detached: true });
  srv.unref();
  await new Promise((r) => setTimeout(r, 2500));
  const post = (path, body) => fetch(BASE + path, { method: 'POST', body: JSON.stringify(body ?? {}) }).then((r) => r.status).catch(() => -1);
  const get = (path) => fetch(BASE + path).then((r) => r.status).catch(() => -1);
  try {
    // 1. every POST endpoint without the token -> 403 (never 500, never 200)
    for (const ep of ['/api/edit-ops?film=' + KEY, '/api/edit-undo?film=' + KEY, '/api/edit-redo?film=' + KEY, '/api/edit-cuts?film=' + KEY, '/api/notes?film=' + KEY]) {
      const s = await post(ep, {});
      need(s === 403, `POST ${ep.split('?')[0]} without a token gave ${s}, wanted 403`);
    }
    const token = await fetch(`${BASE}/api/token`).then((r) => r.text()).catch(() => null);
    need(!!token, 'no token endpoint (the GUI must mint one)');
    const auth = { 'x-studio-token': token };

    // 2. hostile ids and paths on every new endpoint
    const hostile = ['../../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', '.env', 'films/../engine/render.mjs', 'verify-sec/../../', 'nonexistent-film'];
    for (const h of hostile) {
      for (const ep of ['edit', 'peaks', 'transcript']) {
        const s = await get(`/api/${ep}?film=${encodeURIComponent(h)}` + (ep !== 'edit' ? '&src=speech' : ''));
        need(s === 400 || s === 403 || s === 404, `GET /api/${ep} with film "${h.slice(0, 30)}" gave ${s} (wanted 400/403/404)`);
      }
      const s2 = await fetch(`${BASE}/api/edit-ops?film=${encodeURIComponent(h)}`, { method: 'POST', headers: auth, body: JSON.stringify([{ op: 'marker', t: 1 }]) }).then((r) => r.status).catch(() => -1);
      need(s2 === 400 || s2 === 403 || s2 === 404, `POST /api/edit-ops with film "${h.slice(0, 30)}" gave ${s2}`);
    }
    // a lut with a traversal path must be refused server-side (edit-ops only checks the extension)
    const lutAttack = await fetch(`${BASE}/api/edit-ops?film=${KEY}`, { method: 'POST', headers: auth, body: JSON.stringify([{ op: 'lut', file: '../.env' }]) }).then((r) => r.status).catch(() => -1);
    need(lutAttack >= 400, `lut with "../.env" accepted (${lutAttack})`);

    // 3. no endpoint can read a file outside the repo: a probe file in /tmp and a dotfile in the repo
    writeFileSync('/tmp/gui-sec-probe.txt', 'secret');
    for (const path of ['/api/peaks?film=../../../../../tmp/gui-sec-probe.txt', '/api/transcript?film=verify-sec&src=../../../.env', '/api/edit?film=../../home/werner/.bashrc']) {
      const s = await get(path);
      need(s >= 400, `GET ${path.slice(0, 60)} gave ${s}`);
      if (s < 400) bad.push(`OUTSIDE READ: ${path}`);
    }
    facts.push('POSTs 403 without a token; hostile ids/paths 4xx on every endpoint; traversal lut refused');
  } finally {
    try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
    rmSync('/tmp/gui-sec-probe.txt', { force: true });
  }
  void mkdirSync; void readFilm;
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
