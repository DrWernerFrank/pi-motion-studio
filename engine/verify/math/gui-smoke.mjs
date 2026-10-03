// gui-smoke (math films, P10): Playwright on a spare port against the REAL gui server, with a REAL
// math film — films/mathdemo copied to films/verify-m-gui (the demo itself is never mutated; the
// copy is cleaned up at the end). M7's list, one leg each:
//   the math view mounts (video + format toggle + timeline strip, the Live view hidden, no live
//   iframe request at all) · the video plays (a real src, currentTime advances) · the format toggle
//   swaps to the 9:16 draft · a sentence click seeks the video to its start (±0.1 s) · a sentence
//   edit re-voices through POST /api/film/:key/sentence and the status shows the new timing · an
//   SSE film event fires for the timing.json write · a SEEDED syntax error (a second film) shows
//   file:line in Scenes · Checks lists the real lint + claims numbers (independently recomputed
//   here) · a pinned note resolves to scene/sentence/file through /where · a draft job runs (after
//   the one-Manim-at-a-time pgrep guard) and its logs stream over SSE.
// Zero console errors, zero failed requests (collected the way the edit check collects them).
// Screenshots land in ctx.cache and ship with the check (they get looked at — see the report).
import { spawn, execSync } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCapped } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { FILMS } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-gui', EKEY = 'verify-m-gui-err', PORT = 3210, BASE = `http://localhost:${PORT}`;
const MANIM = join(ROOT, 'engine', 'manim');

export default async (ctx = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const cache = ctx.cache || '/tmp/vm-gui';
  const shots = join(cache, 'shots');
  rmSync(shots, { recursive: true, force: true }); mkdirSync(shots, { recursive: true });
  const refs = { browser: null, srv: null, touchIv: null };
  try {
    await run({ bad, facts, need, shots, ctx, refs });
  } catch (e) {
    // a crash is a FAILED CHECK, never a dead verifier: the runner's .then has no .catch
    bad.push(`unexpected: ${String(e?.message || e).split('\n')[0]}`);
    const log = refs.srvLog || [];
    if (log.length) bad.push(`server said: ${log.slice(-6).join('').split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400)}`);
  } finally {
    // a job that was mid-run when the server died would keep rendering into the fixture: kill it
    // by ITS OWN key (never a sibling's), then take the server group and the fixtures.
    try { execSync(`pkill -f "cli.mjs render ${KEY}" 2>/dev/null; pkill -f "films/${KEY}/scenes" 2>/dev/null; true`); } catch {}
    try { refs.browser?.close(); } catch {}
    try { if (refs.srv) process.kill(-refs.srv.pid, 'SIGTERM'); } catch {}
    try { clearInterval(refs.touchIv); } catch {}
    for (const k of [KEY, EKEY]) rmSync(join(FILMS, k), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};

async function run({ bad, facts, need, shots, refs }) {

  // ── the fixture: mathdemo copied (title fixed), plus a twin with a SEEDED syntax error ──────
  for (const k of [KEY, EKEY]) rmSync(join(FILMS, k), { recursive: true, force: true });
  cpSync(join(FILMS, 'mathdemo'), join(FILMS, KEY), { recursive: true });
  cpSync(join(FILMS, 'mathdemo'), join(FILMS, EKEY), { recursive: true });
  for (const [k, title] of [[KEY, 'Math demo (gui check)'], [EKEY, 'Math demo (seeded error)']]) {
    const f = join(FILMS, k, 'film.json'), cfg = JSON.parse(readFileSync(f, 'utf8'));
    cfg.title = title; writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
  }
  const errScene = join(FILMS, EKEY, 'scenes', 's02_meaning.py');
  const src = readFileSync(errScene, 'utf8').split('\n');
  src.splice(3, 0, 'this is (not valid python');   // line 4: a paren that never closes
  writeFileSync(errScene, src.join('\n'));
  // a review round with the math rubric's NINE keys (the chart must show correctness + clarity)
  const nine = { hook: 8, readability: 8, motion: 8, variety: 8, composition: 8, brand: 8, sound: 8, correctness: 9, clarity: 8 };
  writeFileSync(join(FILMS, KEY, 'reviews.json'), JSON.stringify([{ round: 1, at: new Date().toISOString(),
    reviewer: 'math-critic', scores: nine, min: Math.min(...Object.values(nine)), pass: true, problems: [], notes: 'seeded for the rubric chart' }], null, 1) + '\n');
  // ground truth for the Checks tab, computed independently of the GUI: the claims on disk + the
  // same capped lint CLI the server shells (16:9 and 9:16 in parallel)
  const claimsTruth = [];
  for (const f of readdirSync(join(FILMS, KEY, 'records'))) {
    for (const file of readdirSync(join(FILMS, KEY, 'records', f))) {
      if (!file.endsWith('-claims.json')) continue;
      for (const c of JSON.parse(readFileSync(join(FILMS, KEY, 'records', f, file), 'utf8'))) claimsTruth.push(c);
    }
  }
  const lints = await Promise.all(['16:9', '9:16'].map((f) => runCapped(pythonFor('manim'),
    ['-m', 'studio_manim.lint', join(FILMS, KEY, 'records', f), join(FILMS, KEY, 'design.json'), f],
    { cwd: ROOT, memoryMb: 512, timeoutS: 30, env: { PYTHONPATH: MANIM }, label: `smoke lint ${f}` })));
  const lintTruth = {};
  ['16:9', '9:16'].forEach((f, i) => { lintTruth[f] = JSON.parse((lints[i].out || '').trim()).length; });

  // ── the server, the SSE tap, the browser ────────────────────────────────────────────────────
  refs.touchIv = setInterval(() => { for (const k of [KEY, EKEY]) try { utimesSync(join(FILMS, k), new Date(), new Date()); } catch {} }, 15000);
  refs.srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env: { ...process.env, STUDIO_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  refs.srvLog = [];
  refs.srv.stdout?.on('data', (d) => refs.srvLog.push(String(d)));
  refs.srv.stderr?.on('data', (d) => refs.srvLog.push('ERR ' + String(d)));
  refs.srv.unref();
  // up BEFORE anything else (a cold import on /mnt/c can outlive the fixed wait; a dead spawn must
  // fail the check with a reason, not leave the browser legs guessing)
  let up = false;
  for (let i = 0; i < 30 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await fetch(`${BASE}/api/films`).then((r) => r.ok).catch(() => false); }
  if (!up) { bad.push('the gui server never answered on :' + PORT); return; }
  let browser;
  try {
    // a node-side SSE tap: every event the GUI's own connection would see (the timing.json leg)
    const events = [];
    await new Promise((ok) => {
      const req = httpGet(`${BASE}/api/events`, (res) => {
        res.on('data', (d) => { for (const line of String(d).split('\n')) { const m = /^data: (.*)$/.exec(line.trim()); if (m) try { events.push(JSON.parse(m[1])); } catch {} } });
        setTimeout(ok, 400);   // the hello handshake
      });
      req.on('error', () => ok());
    });
    const saw = (pred, ms = 6000) => new Promise((ok) => {
      const t0 = Date.now();
      const iv = setInterval(() => { const hit = events.find(pred); if (hit) { clearInterval(iv); ok(hit); } else if (Date.now() - t0 > ms) { clearInterval(iv); ok(null); } }, 100);
    });

    const { chromium } = await import('playwright');
    refs.browser = browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [], failed = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    const evalk = (fn, ...a) => page.evaluate(fn, ...a);

    // 1 · the math view mounts: its tabs, the hidden Live view, the video with a real src, the strip
    await page.goto(`${BASE}/#film=${KEY}`);
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { if (document.querySelector('#mView')) { clearInterval(iv); ok(true); } }, 100); setTimeout(() => { clearInterval(iv); ok(false); }, 10000); }))
      .then((m) => need(m, 'the math view did not mount'));
    const mount = await evalk(() => ({
      tabs: [...document.querySelectorAll('#tabs button')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.tab),
      liveHidden: getComputedStyle(document.querySelector('#viewSeg [data-v="live"]')).display === 'none',
      iframeLive: !!document.querySelector('#live'),
      stripW: document.querySelector('#mStrip')?.clientWidth || 0,
      src: document.querySelector('#mVideo')?.getAttribute('src') || '',
    }));
    need(mount.tabs.join(',') === 'script,scenes,checks,reviews,sheets,notes,jobs', `the math tabs: ${mount.tabs.join(',')}`);
    need(mount.liveHidden, 'the Live view is not hidden for a math film');
    need(!mount.iframeLive, 'the live iframe is still in the DOM (math films have no live page)');
    need(mount.stripW > 400, `the timeline strip is ${mount.stripW}px wide`);
    need(/draft-16:9\.mp4|final-16:9\.mp4/.test(mount.src), `no 16:9 draft video src: ${mount.src}`);
    facts.push(`mounted: tabs ${mount.tabs.join('/')}, Live hidden, strip ${mount.stripW}px, src ${mount.src.split('?')[0].split('/').pop()}`);

    // 2 · the video plays (a real src, currentTime advances)
    const played = await evalk(() => { const v = document.querySelector('#mVideo'); v.muted = true; return v.play().then(() => 'playing').catch((e) => e.name); });
    await page.waitForTimeout(1300);
    const t1 = await evalk(() => document.querySelector('#mVideo').currentTime);
    need(played === 'playing' && t1 > 0.3, `the video did not play (${played}, t=${t1})`);

    // 3 · the format toggle swaps to the 9:16 draft
    await page.click('#mFmt button[data-f="9:16"]');
    await evalk(() => new Promise((ok) => { const v = document.querySelector('#mVideo');
      const iv = setInterval(() => { if (v.getAttribute('src')?.includes('draft-9:16.mp4') && v.readyState >= 1) { clearInterval(iv); ok(true); } }, 80);
      setTimeout(() => { clearInterval(iv); ok(false); }, 12000); }))
      .then((ok) => need(ok, 'the 9:16 toggle did not swap the video src'));
    const t916 = await evalk(() => document.querySelector('#mVideo').currentTime);
    facts.push(`video played to ${t1.toFixed(2)}s; the 9:16 toggle swapped the src (kept t=${t916.toFixed(2)}s)`);
    await page.click('#mFmt button[data-f="16:9"]');
    await evalk(() => new Promise((ok) => { const v = document.querySelector('#mVideo');
      const iv = setInterval(() => { if (v.getAttribute('src')?.includes('16:9') && v.readyState >= 1) { clearInterval(iv); ok(true); } }, 80);
      setTimeout(() => { clearInterval(iv); ok(false); }, 12000); }))
      .then((ok) => need(ok, 'toggling back to 16:9 did not restore the src'));

    // 4 · a sentence click seeks the video to that sentence's start (±0.1 s)
    const want = 6.372971;   // s02.1's start in the copied timing.json
    await evalk((id) => document.querySelector(`.mSent[data-id="${id}"]`).click(), 's02.1');
    await page.waitForTimeout(700);
    const tSeek = await evalk(() => document.querySelector('#mVideo').currentTime);
    need(Math.abs(tSeek - want) <= 0.1, `clicking s02.1 sought to ${tSeek}, wanted ${want} ±0.1`);

    // 5 · a sentence edit re-voices and the status shows the new timing + the SSE film event fires
    const oldTime = await evalk(() => document.querySelector('.mSent[data-id="s02.2"] .mTime').textContent);
    await evalk(() => document.querySelector('.mSent[data-id="s02.2"] .mEdit').click());
    await evalk((txt) => { document.querySelector('.mSent[data-id="s02.2"] textarea').value = txt; },
      'Here: three by two, minus one by one. {lands}Five, exactly.');
    await evalk(() => document.querySelector('.mSent[data-id="s02.2"] .mSave').click());
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { const n = document.querySelector('#mRevoice');
      if (n && !n.hidden && n.textContent.includes('re-voiced')) { clearInterval(iv); ok(n.textContent); } }, 120);
      setTimeout(() => { clearInterval(iv); ok(''); }, 40000); }))
      .then((status) => {
        need(!!status, 'the re-voice status line never showed the new timing');
        const m = /re-voiced s02\.2 → ([\d.]+)–([\d.]+)s/.exec(status || '');
        need(!!m, `the status does not carry the new timing: ${status}`);
        if (m) facts.push(`re-voiced s02.2 → ${m[1]}–${m[2]}s (was ${oldTime})`);
      });
    const filmEv = await saw((e) => e.type === 'film' && e.key === KEY, 8000);   // timing.json was just written
    need(!!filmEv, 'no SSE film event for the timing.json write (the watcher must see records/timing/sentences)');
    const newLine = readFileSync(join(FILMS, KEY, 'script.md'), 'utf8').split('\n').find((l) => l.startsWith('[s02.2]'));
    need(!!newLine && newLine.includes('Five, exactly.'), `script.md's [s02.2] line was not rewritten: ${newLine}`);

    // 6 · the seeded-error twin: Scenes shows the error WITH file:line
    await evalk((k) => document.querySelector(`#films li[data-k="${k}"]`).click(), EKEY);
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { if (document.querySelector('#mView')) { clearInterval(iv); ok(true); } }, 100); setTimeout(() => { clearInterval(iv); ok(false); }, 10000); }))
      .then((m) => need(m, 'the seeded-error film did not mount the math view'));
    await evalk(() => document.querySelector('#tabs button[data-tab="scenes"]').click());
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { const e = document.querySelector('.mErr');
      if (e) { clearInterval(iv); ok(e.textContent); } }, 150); setTimeout(() => { clearInterval(iv); ok(''); }, 40000); }))
      .then((errText) => {
        need(/scenes\/s02_meaning\.py:4/.test(errText || ''), `the Scenes tab did not show the seeded error with file:line: ${errText}`);
        facts.push(`the seeded error surfaced as "${(errText || '').slice(0, 60)}"`);
      });

    // 7 · Checks lists the real numbers: lint + claims, recomputed here independently
    await evalk((k) => document.querySelector(`#films li[data-k="${k}"]`).click(), KEY);
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { if (document.querySelector('#mView')) { clearInterval(iv); ok(true); } }, 100); setTimeout(() => { clearInterval(iv); ok(false); }, 10000); }))
      .then((m) => need(m, 'switching back to the main fixture did not mount'));
    await evalk(() => document.querySelector('#tabs button[data-tab="checks"]').click());
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { const l = document.querySelector('#mCheckLine');
      if (l) { clearInterval(iv); ok(l.textContent); } }, 150); setTimeout(() => { clearInterval(iv); ok(''); }, 40000); }))
      .then((line) => {
        need(/claims \d+ \(\d+ verified\)/.test(line || ''), `the Checks line is missing the claims ledger: ${line}`);
        const l169 = /16:9: (\d+)/.exec(line || ''), l916 = /9:16: (\d+)/.exec(line || ''), cl = /claims (\d+)/.exec(line || '');
        need(l169 && +l169[1] === lintTruth['16:9'], `lint 16:9 shown ${l169?.[1]}, the CLI says ${lintTruth['16:9']}`);
        need(l916 && +l916[1] === lintTruth['9:16'], `lint 9:16 shown ${l916?.[1]}, the CLI says ${lintTruth['9:16']}`);
        need(cl && +cl[1] === claimsTruth.length, `claims shown ${cl?.[1]}, the records hold ${claimsTruth.length}`);
        facts.push(`Checks: ${line}`);
      });
    const lintRows = await evalk(() => document.querySelectorAll('.mLint').length);
    need(lintRows === lintTruth['9:16'], `the lint table lists ${lintRows} rows, the CLI reports ${lintTruth['9:16']}`);
    await page.screenshot({ path: join(shots, 'checks.png') });

    // 8 · a pinned note resolves through /where (scene · sentence · file) in the Notes tab
    const note = await evalk(async () => (await fetch(`/api/films/verify-m-gui/notes`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-token': window.STUDIO_TOKEN }, body: JSON.stringify({ t: 3.4, fmt: '16:9', text: 'smoke: the square should be visible here' }) })).status);
    need(note === 200, `pinning a note failed: ${note}`);
    await evalk(() => document.querySelector('#tabs button[data-tab="notes"]').click());
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { const w = document.querySelector('.mWhereLine');
      if (w && w.textContent.includes('scene')) { clearInterval(iv); ok(w.textContent); } }, 150); setTimeout(() => { clearInterval(iv); ok(''); }, 8000); }))
      .then((w) => {
        need(/scene s01_hook/.test(w || '') && /s01\.1/.test(w || '') && /scenes\/s01_hook\.py/.test(w || ''),
          `the note did not resolve to scene/sentence/file: ${w}`);
        facts.push(`the note at 3.4s resolved: ${(w || '').replace(/\s+/g, ' ').slice(0, 90)}`);
      });
    await page.screenshot({ path: join(shots, 'notes.png') });

    // 9 · the rubric chart carries the two math keys (correctness + clarity)
    await evalk(() => document.querySelector('#tabs button[data-tab="reviews"]').click());
    await page.waitForTimeout(300);
    const rub = await evalk(() => [...document.querySelectorAll('#tabBody .scores > div')].map((d) => d.firstChild.textContent));
    need(rub.includes('correctness') && rub.includes('clarity'), `the review chart lacks the math rubric keys: ${rub.join(',')}`);
    facts.push(`the rubric chart shows ${rub.length} keys (incl. correctness + clarity)`);

    // 10 · a draft job: pgrep-guarded (never two Manim renders), started through the Run tab,
    //     logs streaming over SSE, waited to completion
    const rendersInFlight = () => {
      try { return execSync('pgrep -af "manim render" || true').toString().split('\n')
        .filter((l) => l.trim() && !/bash|pgrep/.test(l)).length; } catch { return 0; }
    };
    let waited = 0;
    for (let i = 0; i < 3 && rendersInFlight() > 0; i++) {   // up to 120 s for a clean window
      await new Promise((r) => setTimeout(r, 40000)); waited += 40;
    }
    const windowBusy = rendersInFlight() > 0;
    if (windowBusy) facts.push(`pgrep-guard: another render held the window for ${waited}s — proceeding under the capped runner's RAM budget`);
    await evalk(() => document.querySelector('#tabs button[data-tab="jobs"]').click());
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await evalk(() => document.querySelector('.jobs button[data-k="draft"]').click());
    const jobStart = await saw((e) => e.type === 'job-start' && e.key === KEY, 15000);
    need(!!jobStart, 'no job-start SSE event for the draft job');
    // the job record exists and is RUNNING (JOBS shells the same CLI pi uses) — then the logs:
    // the math CLI is quiet while it renders (manim's progress is captured, not printed), so the
    // first streamed line arrives at the END; assert the stream with the render-long timeout.
    const jobRec = await evalk(async () => (await fetch('/api/jobs').then((r) => r.json())).slice(-1)[0]);
    need(jobRec?.key === KEY && jobRec?.kind === 'draft' && jobRec?.code === undefined, `the draft job did not register as running: ${JSON.stringify(jobRec)?.slice(0, 120)}`);
    await evalk(() => new Promise((ok) => { const iv = setInterval(() => { const l = document.querySelector('#log');
      if (l && l.textContent.trim() && !l.textContent.startsWith('Buttons run the same')) { clearInterval(iv); ok(l.textContent.split('\n')[0]); } }, 500);
      setTimeout(() => { clearInterval(iv); ok(''); }, 300000); }))
      .then((first) => need(!!first, `the draft job's logs never streamed into the Run tab (first line: ${first})`));
    facts.push(`draft job started in ${((Date.now() - t0) / 1000).toFixed(1)}s, logs streaming (window wait ${waited}s${windowBusy ? ', busy' : ', clean'})`);
    let jobDone = null;
    for (let i = 0; i < 100 && !jobDone; i++) {   // up to ~300 s for the render (both formats)
      await new Promise((r) => setTimeout(r, 3000));
      jobDone = await evalk(async () => (await fetch('/api/jobs').then((r) => r.json())).slice(-1)[0]);
      if (jobDone && jobDone.key === KEY && jobDone.code !== undefined && jobDone.kind === 'draft') break;
      if (jobDone && jobDone.key !== KEY) jobDone = null;
    }
    need(!!jobDone && jobDone.code === 0, `the draft job did not finish cleanly: ${JSON.stringify(jobDone)?.slice(0, 140)}`);
    if (jobDone && jobDone.code === 0) {
      const d169 = statSync(join(FILMS, KEY, 'out', 'draft-16:9.mp4')), d916 = statSync(join(FILMS, KEY, 'out', 'draft-9:16.mp4'));
      need(Math.max(d169.mtimeMs, d916.mtimeMs) > t0 - 1000, 'the drafts were not re-written by the job');
      facts.push(`draft job done in ${((Date.now() - t0) / 1000).toFixed(0)}s — both drafts re-written, ${jobDone.args.join(' ')}`);
    }
    await page.screenshot({ path: join(shots, 'run.png') });

    // 11 · screenshots of the view itself (looked at in the report) + the final tallies
    await evalk(() => document.querySelector('#tabs button[data-tab="script"]').click());
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'script.png') });
    need(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
    need(failed.length === 0, `failed requests: ${failed.slice(0, 3).join(' | ')}`);
    facts.push(`0 console errors, 0 failed requests; screenshots in ${shots}`);
    await browser.close();
  } finally {
    try { browser?.close(); } catch {}
  }
  void existsSync;
}
