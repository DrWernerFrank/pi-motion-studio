// gui-smoke (the producer's GUI surface, P5, slow): Playwright on a spare port — the Make dialog
// creates a project (a stubbed runner via STUDIO_PI_CMD is not needed: the make endpoint runs the
// REAL runner with a FAKE pi, exactly like the make check); the Plan/Requirements/Assets/Facts/Log
// tabs render with real data; segments show status; children group under the project in the list;
// a note pins; a rebuild job runs; zero console errors and zero failed requests. Screenshots are
// saved for the lead to LOOK at (the smoke's own eyes are DOM assertions).
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const PORT = 3214, BASE = `http://127.0.0.1:${PORT}`;   // the server binds 127.0.0.1 (IPv4); 'localhost' resolves to ::1 here first
const KEY = 'verify-p-guismoke', CHILD = `${KEY}-s01`;
const FAKE = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w3-gui-lead', 'fake-pi.mjs');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const scratch = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w3-gui-lead');
  rmSync(scratch, { recursive: true, force: true });
  const { mkdirSync } = await import('node:fs');
  mkdirSync(scratch, { recursive: true });

  // the fake pi = the runner's OWN test harness (engine/produce/fake-pi.mjs, mode build: an
  // honest motion child + draft+final renders + gates + ensureFinals — the make check's partner).
  // The earlier ad-hoc stub mis-parsed the @brief.md argv and never built anything.
  const FAKE = join(ROOT, 'engine', 'produce', 'fake-pi.mjs');
  const FAKELOG = join(scratch, 'fake-pi.jsonl');
  const env = {
    ...process.env, STUDIO_PORT: String(PORT),
    STUDIO_PI_CMD: `node ${FAKE}`,          // the runner splits this on spaces into argv
    STUDIO_FAKE_PI_MODE: 'build',
    STUDIO_FAKE_PI_LOG: FAKELOG,
  };

  // a seeded project (real data for the tabs) + a child so the grouping shows
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  const { create, segment, setState, appendLog } = await import('../../kinds/project/index.mjs');
  const { addRequirements } = await import('../../produce/ledger.mjs');
  const { addFact } = await import('../../produce/facts.mjs');
  const { addAsset } = await import('../../produce/assets.mjs');
  create(KEY, { title: 'GPS in 60 seconds', request: 'A 60-second narrated explainer on how GPS knows where you are, vertical and widescreen.', formats: ['16:9', '9:16'] });
  addRequirements(KEY, [
    { text: '60 seconds', type: 'measurable', verifier: 'duration', arg: 60, tolerance: 2 },
    { text: '16:9 and 9:16', type: 'measurable', verifier: 'formats', arg: ['16:9', '9:16'] },
    { text: 'narrated', type: 'measurable', verifier: 'has-audio' },
  ]);
  addFact(KEY, { id: 'f01', claim: 'GPS satellites orbit at about 20,200 km', hedged: true, hedge: 'stated as approximate (the smoke fixture)' });
  addAsset(KEY, { id: 'a1', path: join(FILMS, KEY, 'design.json'), license: 'studio', role: 'the design system' });
  writeFileSync(join(FILMS, KEY, 'plan.json'), JSON.stringify({ version: 1, goal: 'how GPS finds you', audience: 'a curious person', assumptions: ['60s finished'],
    deliverables: [{ type: 'video', name: 'main', formats: ['16:9', '9:16'], duration: 60 }],
    decision: { chosen: 'math', why: 'the numbers must be verified claims', alternatives: [{ id: 'motion', rejected_because: 'numbers would be hand-checked' }, { id: 'simplest: one static frame', rejected_because: 'no payoff' }] },
    segments: [{ id: 's01', capability: 'math', role: 'the story', brief: 'four clocks, one spot', duration: 60, acceptance: ['claims verified'] }],
    assembly: { mode: 'single', transitions: 'n/a', audio: 'one narration mix' },
    feasibility: { blocked_inputs: [], needs_capability: [] }, budget: { minutes: 120, usd: 0 }, risks: [] }, null, 2));
  await segment(KEY, { id: 's01', capability: 'math', role: 'the story', brief: 'x', duration: 60 });
  setState(KEY, { phase: 'building', segments: { s01: { status: 'done', film: CHILD, capability: 'math' } } });
  appendLog(KEY, 's01 built and gated (the seeded row)');

  const SRVLOG = join(scratch, 'server.log');
  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  // the server's own output goes to a file we can quote when it dies — a piped-and-dropped stderr
  // is how the first full run's 'fetch failed' stayed undiagnosed for a day
  const srvOut = createWriteStream(SRVLOG, { flags: 'a' });
  srv.stdout?.pipe(srvOut); srv.stderr?.pipe(srvOut);
  let srvDied = '';
  srv.on('exit', (c, s) => { srvDied = `the GUI server exited (code ${c}${s ? ', ' + s : ''})`; });
  const bootLog = () => { try { return readFileSync(SRVLOG, 'utf8').split('\n').slice(-12).join(' | ').slice(0, 400); } catch { return '(no log)'; } };
  let browser = null;
  const refs = { srv };
  try {
    // POLL the CHEAP static '/' until it answers — never /api/films: that scans every film on
    // the 9p repo (~1.8s a hit), and a client-aborted request still queues its FULL scan, so a
    // 500ms-aborted poll DoSes the very server it is waiting for (60 queued scans starved 'goto'
    // into a 'domcontentloaded' timeout — the 2026-10-08 only-run's real cause, measured live:
    // '/' answers in ~1s, /api/films takes 1.6-1.8s warm).
    let up = false;
    for (let k = 0; k < 60 && !up && !srvDied; k++) {
      try { up = (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (srvDied) throw new Error(`${srvDied} — boot log: ${bootLog()}`);
    if (!up) throw new Error(`the GUI never answered on :${PORT} within 60s — boot log: ${bootLog()}`);
    const { chromium } = await import('playwright');
    refs.browser = browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [], failed = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r2) => failed.push(r2.url().slice(0, 80)));
    page.on('response', (r2) => { if (r2.status() >= 400) failed.push(`${r2.status()} ${r2.url().slice(0, 80)}`); });

    // 'networkidle' NEVER fires while the SSE stream is open (the /api/events connection stays
    // alive) — goto raced 30s into a timeout on the second boot. Load the DOM, then wait for
    // the film list content explicitly.
    await page.goto(`${BASE}/#film=${KEY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#films li, #films .dim', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));   // the view modules mount after the film fetch
    // the project view mounted: the phase chip + the goal + the segment row
    await page.waitForSelector('#stage, .proj, [data-proj]', { timeout: 8000 }).catch(() => {});
    const body = await page.textContent('body');
    need(/GPS/.test(body), 'the project page does not show the project');
    need(/building|planning/.test(body), 'the phase is not shown');

    // the tabs render with real data: click each and assert ITS content while it is visible
    // (only one tab is rendered at a time — a click-through-then-assert sees just the last one)
    const tabText = async (tab) => {
      await page.click(`[data-tab="${tab}"]`).catch(() => {});
      await new Promise((r) => setTimeout(r, 150));   // renderTab is synchronous, but let the frame land
      return page.textContent('body');
    };
    const tReq = await tabText('requirements');
    need(/60 seconds/.test(tReq), 'the Requirements tab does not list the seeded requirement');
    const tFacts = await tabText('facts');
    need(/20,200 km/.test(tFacts), 'the Facts tab does not list the seeded fact');
    const tAssets = await tabText('assets');
    need(/studio/.test(tAssets) && /design system/.test(tAssets), 'the Assets tab does not list the seeded asset');
    const tLog = await tabText('log');
    need(/s01 built/.test(tLog) || /seeded row/.test(tLog), 'the Log tab does not show the log tail');
    const tPlan = await tabText('plan');
    need(/math/.test(tPlan) && /the story/.test(tPlan), 'the Plan tab does not show the segment with its capability');

    // children group under the project in the films list
    const listHtml = await page.innerHTML('#films');
    need(listHtml.includes(CHILD), 'the child film does not appear in the list');
    need(/class="kids"|kid/.test(listHtml), 'the child is not nested under its project (no kids grouping)');

    // a note pins (the existing notes flow, on the project film)
    const note = await page.evaluate(async (key) => {
      const t = window.STUDIO_TOKEN;
      const r = await fetch(`/api/films/${key}/notes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': t }, body: JSON.stringify({ t: 3.2, text: 'the smoke pinned this' }) });
      return r.status;
    }, KEY);
    need(note === 200, `pinning a note on the project gave ${note}, wanted 200`);

    // a rebuild job runs (through the job runner; the SSE job events fire)
    const jobId = await page.evaluate(async (key) => {
      const t = window.STUDIO_TOKEN;
      const r = await fetch(`/api/project/${key}/job`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': t }, body: JSON.stringify({ kind: 'verify' }) });
      return (await r.json()).id;
    }, KEY);
    need(!!jobId, 'the verify job did not start');
    await new Promise((r) => setTimeout(r, 3000));
    const jobs = await (await fetch(`${BASE}/api/jobs`)).json();
    const job = jobs.find((j) => j.id === jobId);
    need(!!job, `the job ${jobId} is not in the jobs list`);
    need(job.code !== undefined || (job.tail || []).length > 0, 'the job produced neither an exit code nor log lines');

    // the Make dialog: opens, validates, and starts a run; the fake pi (mode build) BUILDS the
    // piece for real — wait for the made project to verify green (the runner's own green test)
    await page.click('#makeBtn');
    await page.fill('#makeForm textarea[name="request"]', 'A tiny smoke project about nothing, 16:9.');
    const mk = await page.evaluate(async () => {
      const fd = new FormData(document.querySelector('#makeForm'));
      const request = fd.get('request');
      const t = window.STUDIO_TOKEN;
      const r = await fetch('/api/make', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': t }, body: JSON.stringify({ request, formats: ['16:9'] }) });
      return { status: r.status, body: await r.json() };
    });
    need(mk.status === 200 && mk.body.key, `the Make dialog's POST gave ${JSON.stringify(mk).slice(0, 120)}, wanted 200 + a key`);
    if (mk.body?.key) {
      // poll the project's API doc until the state says shipped/verified, or the fake's argv proves
      // the run (a real build takes tens of seconds: a 6s/8s draft + final at 16:9)
      let verified = false, rows = null;
      for (let i = 0; i < 120 && !verified; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await (await fetch(`${BASE}/api/project/${mk.body.key}`)).json().catch(() => null);
        rows = st?.requirements ?? null;
        const finals = (st?.state?.segments && Object.values(st.state.segments).some((sg) => sg.status === 'done')) || (st?.logTail || []).some((l) => /verify|shipped|done/i.test(l));
        verified = !!rows?.length && rows.every((r) => r.status === 'green' || r.status === 'waived') && finals;
      }
      need(verified, `the made project did not verify green (the fake-pi build): requirements ${JSON.stringify((rows || []).map((r) => [r.id, r.status]))}`);
      if (verified) facts.push('the Make flow: the fake-pi (mode build) honestly built the piece; every requirement row green through the GUI-started runner');
    }
    // close the modal before the screenshots (it dims the whole page)
    await page.keyboard.press('Escape').catch(() => {});
    await page.click('#makeDlg [value="cancel"]').catch(() => {});

    // zero console errors / failed requests (the smoke's collector)
    need(!errors.length, `console errors: ${errors.slice(0, 3).join(' | ')}`);
    need(!failed.length, `failed requests: ${failed.slice(0, 3).join(' | ')}`);

    // screenshots for the lead to LOOK at (the DOM assertions above are the smoke's own eyes)
    const shots = [];
    for (const [name, sel] of [['project', '#film, body'], ['films', '#films']]) {
      const f = join(scratch, `smoke-${name}.png`);
      await page.screenshot({ path: f, fullPage: false }).catch(() => {});
      if (existsSync(f)) shots.push(f);
    }
    facts.push(`tabs rendered with seeded data (requirement 60s, fact 20,200km, asset, log tail, segment math/the-story); the child nested under the project; a note pinned (200); a verify job ran (id ${jobId}); the Make dialog created ${mk.body?.key ?? 'the project'} and the fake-pi loop verified it; 0 console errors, 0 failed requests; screenshots: ${shots.map((s) => s.split('scratch/')[1]).join(', ')}`);
  } finally {
    // wind the run down FIRST (a mid-run rmSync races the runner's verify; the make check owns the
    // hostile cases — here just stop it politely and let the job end), then remove the films
    try { await import('../../produce/runner.mjs').then((m) => m.stopRun()).catch(() => {}); } catch { /* nothing running */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { if (browser) await browser.close(); } catch { /* already gone */ }
    try { srv.kill(); } catch { /* the port dies with us */ }
    try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* the group may be gone */ }
    for (const k of readdirSync(FILMS).filter((f) => f.startsWith('make-'))) rmSync(join(FILMS, k), { recursive: true, force: true });
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
    rmSync(join(FILMS, CHILD), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
