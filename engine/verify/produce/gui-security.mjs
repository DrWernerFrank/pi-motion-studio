// gui-security (the producer's GUI surface, P5): every new project/make endpoint refuses what it
// must, on a spare port against the REAL gui server — tokenless POSTs 403, hostile ids/paths 4xx,
// the make request capped and validated, a second concurrent make 409, and (the structural leg)
// NO endpoint passes the request through a shell or runs anything outside the job runner.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, kindOf } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { makeRun, stopRun } from '../../produce/runner.mjs';

const PORT = 3213, BASE = `http://127.0.0.1:${PORT}`;   // IPv4 literal: localhost resolves ::1 first here and the server binds 127.0.0.1 (D-012's class)
const KEY = 'verify-p-guisec';
const LOCK = join(homedir(), '.cache', 'pi-motion-studio', 'make.lock');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  rmSync(join(FILMS, KEY), { recursive: true, force: true });

  // a seeded project with one requirement row (the GET doc must carry it; hostile ids must not)
  const { create } = await import('../../kinds/project/index.mjs');
  const { addRequirements } = await import('../../produce/ledger.mjs');
  create(KEY, { title: KEY, request: 'a seeded project for the security check', formats: ['16:9'] });
  addRequirements(KEY, [{ text: '16:9 format', type: 'measurable', verifier: 'formats', arg: ['16:9'] }]);

  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env: { ...process.env, STUDIO_PORT: String(PORT) }, stdio: 'ignore', detached: true });
  srv.unref();
  await new Promise((r) => setTimeout(r, 2500));
  const get = (path) => fetch(encodeURI(BASE + path)).then(async (r) => ({ status: r.status, body: await r.text() })).catch(() => ({ status: -1, body: '' }));
  const post = (path, body, headers = {}) => fetch(encodeURI(BASE + path), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })
    .then(async (r) => ({ status: r.status, body: await r.text() })).catch(() => ({ status: -1, body: '' }));

  try {
    const token = (/STUDIO_TOKEN = '([0-9a-f]+)'/.exec((await get('/')).body) || [])[1];
    need(!!token, 'no token minted into the page');
    const auth = { 'x-studio-token': token };

    // 1 · tokenless POSTs -> 403 on every new POST endpoint (the job POST, make, make/stop)
    for (const ep of [`/api/project/${KEY}/job`, '/api/make', '/api/make/stop']) {
      const r = await post(ep, { kind: 'verify', request: 'x' });
      need(r.status === 403, `POST ${ep} without a token gave ${r.status}, wanted 403`);
    }

    // 2 · hostile ids on the project endpoints: traversal, absolute, dotfiles, unknown, non-project
    const hostile = ['../../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', '.env', 'films/../engine/cli.mjs', 'no-such-film', 'mathdemo', 'demo-cut'];
    for (const id of hostile) {
      const g = await get(`/api/project/${id}`);
      need(g.status === 404 || g.status === 400, `GET /api/project/${id.slice(0, 24)} gave ${g.status}, wanted 4xx`);
      const w = await get(`/api/project/${id}/where?t=1`);
      need(w.status === 404 || w.status === 400, `GET /api/project/${id.slice(0, 24)}/where gave ${w.status}, wanted 4xx`);
      const j = await post(`/api/project/${id}/job`, { kind: 'verify' }, auth);
      need(j.status === 404 || j.status === 400, `POST /api/project/${id.slice(0, 24)}/job gave ${j.status}, wanted 4xx`);
    }
    const badKind = await get(`/api/project/mathdemo`);
    need(badKind.status === 404, `a NON-project film key on /api/project gave ${badKind.status}, wanted 404 (the kindOf guard)`);

    // 3 · the make request is validated: non-string, empty, over the 4000 cap, bad formats, bad minutes
    need((await post('/api/make', { request: 42 }, auth)).status === 400, 'a non-string request must 400');
    need((await post('/api/make', { request: '   ' }, auth)).status === 400, 'a blank request must 400');
    const big = 'x'.repeat(4001);
    const rBig = await post('/api/make', { request: big }, auth);
    need(rBig.status === 400 && /4001 characters/.test(rBig.body), `a 4001-char request must 400 naming the cap (got ${rBig.status})`);
    need((await post('/api/make', { request: 'ok', formats: ['9:77'] }, auth)).status === 400, 'a bad format must 400');
    need((await post('/api/make', { request: 'ok', minutes: 0 }, auth)).status === 400, 'minutes 0 must 400');

    // 4 · a second concurrent make -> 409 (both guards: the server's MAKING flag and the runner's
    //     lock — the CLI-side lock is probed directly by seeding it, the honest way)
    // (a fake slow run: seed the runner's lock with OUR pid as a live holder — a CLI-started run)
    const { writeFileSync: wf } = await import('node:fs');
    wf(LOCK, JSON.stringify({ pid: process.pid, key: 'verify-p-cli-run', startedAt: new Date().toISOString() }));
    try {
      const r = await post('/api/make', { request: 'a second make while one runs' }, auth);
      need(r.status === 409 && /verify-p-cli-run/.test(r.body), `a second concurrent make gave ${r.status} (wanted 409 naming the active key)`);
      need(!existsSync(join(FILMS, 'make-a-second-make-while-one-runs')), 'the refused make must not have created its project');
    } finally { rmSync(LOCK, { force: true }); }
    // stop with nothing running: the polite answer (not a 500)
    const stop0 = await post('/api/make/stop', {}, auth);
    need(stop0.status === 200 || stop0.status === 400, `make/stop with nothing running gave ${stop0.status}`);

    // 5 · the structural legs, read from the server source (the design, asserted):
    const src = readFileSync(join(ROOT, 'studio-gui', 'server.mjs'), 'utf8');
    // child_process exec, never the ubiquitous String.prototype.exec: match an exec NOT preceded
    // by a dot (i.e. ` exec(` at a call site, not `.exec(p)` — the regex method)
    const shellExec = /(?:^|[^.\w])exec\s*\(|execSync|spawnSync|shell:\s*true/.test(src);
    need(!shellExec, 'the server must never run anything through a shell (exec/execSync/spawnSync/shell:true found in its source)');
    need(!/spawn\([^,]+,\s*\[.*\$\{.*request/.test(src), 'the request must never appear in a spawn argv');
    // the make child is spawned BY the job runner path (startMakeJob builds the job record + spawns)
    need(/startMakeJob/.test(src) && /jobs\.push\(job\)/.test(src), 'the make runner must be a child of the job runner (a job record + a spawn)');
    // the request travels by file: the child reads its spec from a file, the argv carries only the path
    need(/readFileSync\(process\.argv\[1\]/.test(src), 'the make child must read its spec from a file (argv = the path only)');
    const reqInArgv = /spawn\([^)]*request[^)]*\)/.test(src);
    need(!reqInArgv, 'the request must not be passed to a spawn');
    // request files live OUTSIDE the repo (the cache), so no request text ever lands in a repo file
    need(/make-req/.test(src), 'the request file must live under the cache (make-req), not the repo');

    facts.push('403 tokenless on job+make+make/stop; hostile ids 404/400 (traversal, absolute, dotfile, unknown, non-project); make validated (non-string, blank, 4001 chars, bad format, minutes 0); a second make 409 naming the active key with no project created; stop-without-run polite');
    facts.push('structural: no exec/shell:true, no request in any spawn argv (spec by file under the cache), the runner is a job-runner child (job record + spawn)');
  } finally {
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
    try { srv.kill(); } catch { /* already gone */ }
    try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* the group may be gone */ }
    rmSync(LOCK, { force: true });
  }
  void makeRun; void stopRun; void kindOf;
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
