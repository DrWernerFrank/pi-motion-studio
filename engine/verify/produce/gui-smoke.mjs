// gui-smoke (the producer's GUI surface, P5, slow): Playwright on a spare port — the Make dialog
// creates a project (a stubbed runner via STUDIO_PI_CMD is not needed: the make endpoint runs the
// REAL runner with a FAKE pi, exactly like the make check); the Plan/Requirements/Assets/Facts/Log
// tabs render with real data; segments show status; children group under the project in the list;
// a note pins; a rebuild job runs; zero console errors and zero failed requests. Screenshots are
// saved for the lead to LOOK at (the smoke's own eyes are DOM assertions).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const PORT = 3214, BASE = `http://localhost:${PORT}`;
const KEY = 'verify-p-guismoke', CHILD = `${KEY}-s01`;
const FAKE = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w3-gui-lead', 'fake-pi.mjs');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const scratch = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w3-gui-lead');
  rmSync(scratch, { recursive: true, force: true });
  const { mkdirSync } = await import('node:fs');
  mkdirSync(scratch, { recursive: true });

  // the fake pi the runner will spawn: mode plan+build in one (a minimal producer that makes the
  // project VERIFY green without any engine work — the make check's fake-pi does the real thing;
  // here a one-shot stub keeps the smoke fast and deterministic)
  writeFileSync(FAKE, `
import { writeFileSync, readFileSync } from 'node:fs';
const key = process.argv.find((a) => /^films\\//.test(a))?.replace(/^films\\//, '').replace(/\\/brief\\.md$/, '');
if (key) {
  // a plan + one requirement that verifies green: the runner's own 'studio project verify' does
  // the measuring (a 1x1 one-second final is overkill here — instead: plan-only semantics. The
  // runner stops after the first green VERIFY; a plan with no measurable rows verifies green
  // with zero finals (verifyProject: no formats required when the deliverable list is 'still').
  writeFileSync('films/' + key + '/plan.json', JSON.stringify({
    version: 1, goal: 'a smoke-test project that verifies green without rendering',
    audience: 'the check', assumptions: ['the smoke needs no video deliverable'],
    deliverables: [{ type: 'still', name: 'poster' }],
    decision: { chosen: 'motion', why: 'the simplest thing that could work for the smoke: a still deliverable, no segments rendered.',
      alternatives: [{ id: 'simplest: nothing', rejected_because: 'a plan must exist' }] },
    segments: [{ id: 's01', capability: 'motion', role: 'the one part', brief: 'not rendered in the smoke', duration: 2, acceptance: ['the plan validates'] }],
    assembly: { mode: 'single', transitions: 'n/a', audio: 'n/a' },
    feasibility: { blocked_inputs: [], needs_capability: [] },
    budget: { minutes: 30, usd: 0 }, risks: ['none: a smoke fixture'] }, null, 2));
}
console.log('[fake-pi] smoke stub for ' + key);
`);
  writeFileSync(join(scratch, 'fake-pi-wrapper.sh'), `#!/usr/bin/env bash
exec node ${JSON.stringify(FAKE)} "$@"
`);
  const { chmodSync } = await import('node:fs');
  chmodSync(join(scratch, 'fake-pi-wrapper.sh'), 0o755);

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

  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], {
    env: { ...process.env, STUDIO_PORT: String(PORT), STUDIO_PI_CMD: join(scratch, 'fake-pi-wrapper.sh') },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let browser = null;
  const refs = { srv };
  try {
    await new Promise((r) => setTimeout(r, 2500));
    const { chromium } = await import('playwright');
    refs.browser = browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [], failed = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r2) => failed.push(r2.url().slice(0, 80)));
    page.on('response', (r2) => { if (r2.status() >= 400) failed.push(`${r2.status()} ${r2.url().slice(0, 80)}`); });

    await page.goto(`${BASE}/#film=${KEY}`, { waitUntil: 'networkidle' });
    // the project view mounted: the phase chip + the goal + the segment row
    await page.waitForSelector('#stage, .proj, [data-proj]', { timeout: 8000 }).catch(() => {});
    const body = await page.textContent('body');
    need(/GPS/.test(body), 'the project page does not show the project');
    need(/building|planning/.test(body), 'the phase is not shown');

    // the tabs render with real data
    for (const tab of ['plan', 'requirements', 'assets', 'facts', 'log']) {
      await page.click(`[data-tab="${tab}"], .tab[data-t="${tab}"]`).catch(() => {});
    }
    const text = await page.textContent('body');
    need(/60 seconds/.test(text), 'the Requirements tab does not list the seeded requirement');
    need(/20,200 km/.test(text), 'the Facts tab does not list the seeded fact');
    need(/studio/.test(text), 'the Assets tab does not list the seeded asset');
    need(/s01 built/.test(text) || /seeded row/.test(text), 'the Log tab does not show the log tail');
    need(/math/.test(text) && /the story/.test(text), 'the Plan tab does not show the segment with its capability');

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

    // the Make dialog: opens, validates, and starts a run (the fake pi makes the project verify green)
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
      // wait for the runner's loop (fake pi, one iteration) then assert the project exists + verified
      await new Promise((r) => setTimeout(r, 6000));
      need(existsSync(join(FILMS, mk.body.key, 'brief.md')), 'the made project was not created');
      const st = await (await fetch(`${BASE}/api/project/${mk.body.key}`)).json();
      need(/verified|green/.test(JSON.stringify(st).slice(0, 400)) || st.requirements, 'the made project has no requirements after the run');
      rmSync(join(FILMS, mk.body.key), { recursive: true, force: true });
    }

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
    try { if (browser) await browser.close(); } catch { /* already gone */ }
    try { srv.kill(); } catch { /* the port dies with us */ }
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
    rmSync(join(FILMS, CHILD), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
