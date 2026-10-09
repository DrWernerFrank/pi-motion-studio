// gui-security (math films, P10): every new math endpoint refuses what it must, on a spare port
// against the REAL gui server. Mirrors engine/verify/gui-security.mjs:
//   1. POST without the token -> 403 on every new endpoint (the sentence POST; the GETs are
//      read-only, like every other GET in the server).
//   2. traversal (../), absolute paths, dotfiles, unknown film ids and hostile sentence ids -> 4xx
//      on every new endpoint; a hostile id is rejected BEFORE any python runs (timed).
//   3. no endpoint reads a file outside the repo: a probe file in /tmp that every traversal-shaped
//      parameter tries to reach — never in a response body.
//   4. no endpoint runs scene code outside the job runner: the /records python children are the
//      same capped runner the engine uses (runCapped: memory + wall-clock caps) — the layout lint
//      shells `python -m studio_manim.lint` (the CLI the checks shell), and the syntax probe is
//      ast.parse only (never an import). This check asserts the DESIGN: hostile inputs never
//      reach a spawn (fast 4xx, measured), and the happy-path /records says which capped CLI ran.
import { spawn } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, kindOf } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-gui-sec', PORT = 3211, BASE = `http://127.0.0.1:${PORT}`;   // IPv4 literal: localhost resolves ::1 first here and the server binds 127.0.0.1 (D-012's class)
const NEW_GETS = ['script', 'records', 'where'];   // + the sentence POST

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const probe = '/tmp/gui-m-sec-probe.txt';
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  cpSync(join(FILMS, 'mathdemo'), join(FILMS, KEY), { recursive: true });
  writeFileSync(join(FILMS, KEY, 'film.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(FILMS, 'mathdemo', 'film.json'), 'utf8')), title: KEY }, null, 2) + '\n');
  writeFileSync(probe, 'SECRET-CONTENT-P10');

  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env: { ...process.env, STUDIO_PORT: String(PORT) }, stdio: 'ignore', detached: true });
  srv.unref();
  await new Promise((r) => setTimeout(r, 2500));
  const get = (path) => fetch(encodeURI(BASE + path)).then(async (r) => ({ status: r.status, body: await r.text() })).catch(() => ({ status: -1, body: '' }));
  const post = (path, body, headers = {}) => fetch(encodeURI(BASE + path), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })
    .then(async (r) => ({ status: r.status, body: await r.text() })).catch(() => ({ status: -1, body: '' }));
  try {
    // the token, the way the page gets it (window.STUDIO_TOKEN, minted into index.html)
    const token = (/STUDIO_TOKEN = '([0-9a-f]+)'/.exec((await get('/')).body) || [])[1];
    need(!!token, 'no token minted into the page');
    const auth = { 'x-studio-token': token };

    // 1 · POST without the token -> 403 (never 500, never 200) on the new POST endpoint
    for (const ep of ['sentence', 'script', 'records', 'where']) {
      const r = await post(`/api/film/${KEY}/${ep}`, { id: 's01.1', text: 'no token' });
      need(r.status === 403, `POST /api/film/:key/${ep} without a token gave ${r.status}, wanted 403`);
    }

    // 2 · hostile film keys on every new endpoint: traversal, absolute, dotfiles, unknown, empty
    const hostile = ['../../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini', '.env', 'films/../engine/render.mjs',
      `${KEY}/../../`, 'nonexistent-film', 'verify-m-gui-sec.', '.ssh', '%2e%2e%2f'];
    for (const h of hostile) {
      for (const ep of NEW_GETS) {
        const q = ep === 'where' ? '?t=3.4' : '';
        const r = await get(`/api/film/${h}/${ep}${q}`);
        need(r.status >= 400 && r.status < 500, `GET /api/film/${h.slice(0, 24)}/${ep} gave ${r.status} (wanted 4xx)`);
        need(!r.body.includes('SECRET-CONTENT-P10'), `GET /api/film/${h.slice(0, 24)}/${ep} leaked the probe file`);
      }
      const r2 = await post(`/api/film/${h}/sentence`, { id: 's01.1', text: 'hostile key' }, auth);
      need(r2.status >= 400 && r2.status < 500, `POST /api/film/${h.slice(0, 24)}/sentence gave ${r2.status} (wanted 4xx)`);
    }
    // a non-math film is not a math film: the math endpoints refuse it (404, never a wrong-kind read)
    for (const other of ['demo-cut', 'studio-reel']) {
      try { if (kindOf(JSON.parse(readFileSync(join(FILMS, other, 'film.json'), 'utf8'))) === 'math') continue; } catch { continue; }
      const r = await get(`/api/film/${other}/script`);
      need(r.status === 404, `GET /api/film/${other}/script on a non-math film gave ${r.status}, wanted 404`);
      facts.push(`non-math film ${other} refused on the math endpoints (404)`);
      break;
    }

    // 3 · hostile WHERE parameters: t must be a finite second-count, fmt one of the film's formats
    for (const t of ['NaN', 'abc', '', '-1', '1e309', 'null', 'Infinity']) {
      const r = await get(`/api/film/${KEY}/where?t=${encodeURIComponent(t)}`);
      need(r.status === 400, `GET /where with t=${t.slice(0, 8)} gave ${r.status}, wanted 400`);
    }
    const noT = await get(`/api/film/${KEY}/where`);
    need(noT.status === 400, `GET /where with no t gave ${noT.status}, wanted 400`);
    for (const fmt of ['../../../tmp/gui-m-sec-probe.txt', '16x9', '..%2F..%2Fetc%2Fpasswd', '']) {
      const r = await get(`/api/film/${KEY}/where?t=3.4&fmt=${fmt}`);
      need(r.status === 400, `GET /where with fmt="${fmt.slice(0, 24)}" gave ${r.status}, wanted 400`);
      need(!r.body.includes('SECRET-CONTENT-P10'), `GET /where with fmt="${fmt.slice(0, 24)}" leaked the probe`);
    }

    // 4 · hostile sentence ids + a grammar-breaking rewrite: rejected before any python runs
    //    (timed: the happy path re-voices in ~5 s, a hostile id must answer in well under a second),
    //    and a rewrite the parser rejects leaves script.md BYTE-IDENTICAL (rollback, no partial write)
    const before = readFileSync(join(FILMS, KEY, 'script.md'), 'utf8');
    for (const id of ['../../etc/passwd', 's01.1\n[s99.9] injected', 's01.1 rm -rf', 'S01.1', 's1.', 's01.1.1', '']) {
      const t0 = Date.now();
      const r = await post(`/api/film/${KEY}/sentence`, { id, text: 'hostile' }, auth);
      const ms = Date.now() - t0;
      need(r.status === 400 || r.status === 404, `POST /sentence with id=${JSON.stringify(id).slice(0, 24)} gave ${r.status} (wanted 400/404)`);
      need(ms < 900, `POST /sentence with id=${JSON.stringify(id).slice(0, 24)} took ${ms} ms — something heavy ran before the rejection`);
      need(!r.body.includes('SECRET-CONTENT-P10'), 'the sentence POST leaked the probe');
    }
    for (const text of ['', null, 5, 'x'.repeat(1001), 'fine {unclosed']) {
      const r = await post(`/api/film/${KEY}/sentence`, { id: 's03.1', text }, auth);
      need(r.status === 400 || r.status === 404, `POST /sentence with text=${JSON.stringify(text)?.slice(0, 18)} gave ${r.status}`);
    }
    const after = readFileSync(join(FILMS, KEY, 'script.md'), 'utf8');
    need(before === after, 'a rejected sentence rewrite left script.md changed (the rollback failed)');

    // 5 · no endpoint reads a file outside the repo: every shape a GET can name, probed against /tmp
    for (const p of [`/api/film/${KEY}/../../../../../tmp/gui-m-sec-probe.txt/script`,
      `/api/film/..%2F..%2F..%2F..%2Ftmp%2Fgui-m-sec-probe.txt/records`,
      `/api/film/${KEY}/where?t=3.4&fmt=../../../../../tmp/gui-m-sec-probe.txt`,
      `/api/film/${KEY}/sentence/../../../../../tmp/gui-m-sec-probe.txt`]) {
      const r = await get(p);
      need(r.status >= 400, `GET ${p.slice(0, 70)} gave ${r.status}`);
      need(!r.body.includes('SECRET-CONTENT-P10'), `OUTSIDE READ: ${p.slice(0, 70)}`);
    }
    // the happy paths are 200s on the fixture (the endpoints are real, not 404-walls):
    const okScript = await get(`/api/film/${KEY}/script`), okWhere = await get(`/api/film/${KEY}/where?t=3.4`), okRec = await get(`/api/film/${KEY}/records`);
    need(okScript.status === 200 && okWhere.status === 200 && okRec.status === 200,
      `the happy path is not 200: script ${okScript.status}, where ${okWhere.status}, records ${okRec.status}`);
    need(/studio_manim\.lint \(capped/.test(okRec.body), 'the /records lint does not declare its capped CLI source');
    need(!okRec.body.includes('SECRET-CONTENT-P10') && !okScript.body.includes('SECRET-CONTENT-P10'), 'a happy-path response leaked the probe');
    // /where never runs python: it must answer fast, and a hostile t must not slow it down either
    const t0 = Date.now();
    await get(`/api/film/${KEY}/where?t=12.5`);
    const whereMs = Date.now() - t0;
    need(whereMs < 900, `/where (records + timing only, no python) took ${whereMs} ms`);
    facts.push(`happy paths 200 (script/where/records, ${whereMs} ms for /where); /records runs its lint through the capped CLI`);
    facts.push('POSTs 403 without a token; hostile keys/ids/paths/t/fmt 4xx on every new endpoint (timed <900 ms, no python); rejected rewrites roll script.md back byte-identical; no response ever carries the /tmp probe');
  } catch (e) {
    bad.push(`unexpected: ${String(e?.message || e).split('\n')[0]}`);   // a crash is a failed check, never a dead verifier
  } finally {
    try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
    rmSync(probe, { force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
