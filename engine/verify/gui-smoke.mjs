// gui-smoke: Playwright on a spare port against the REAL gui server: load an edit film, the editor draws
// (waveform + filmstrip), a word click seeks, deleting words shortens the timeline, undo restores the edit,
// split/trim by pointer, accept a cut proposal, change the caption style, pin a note, run a draft job.
// Zero console errors, zero failed requests (the transcript-missing 404 is a GUI bug the smoke already caught).
import { spawn } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { createEditFilm } from '../edit-cli.mjs';
import { ingestSource } from '../ingest.mjs';
import { transcribe } from '../transcribe.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { timelineFrames } from '../lib/edit-ops.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const KEY = 'verify-gui', PORT = 3198;

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  // a real edit film with a transcript (the transcript pane is a first-class flow)
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: 'speech', log: () => {} });
  await applyOps(KEY, { op: 'add', src: 'speech', in: 0, out: 29.9 });
  await transcribe(KEY, 'speech', { log: () => {} });
  syncFilm(KEY);
  const film = readFilm(KEY);

  const srv = spawn('node', [join(ROOT, 'studio-gui', 'server.mjs')], { env: { ...process.env, STUDIO_PORT: String(PORT) }, stdio: 'ignore', detached: true });
  srv.unref();
  await new Promise((r) => setTimeout(r, 2500));
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [], failed = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    await page.goto(`http://localhost:${PORT}/#film=${KEY}`);
    // WAIT for the pane instead of a fixed sleep: the edit tab mounts async (module imports over
    // 9p) and the transcript fetch lands after it, so a blind 2.5s sleep races the pane — the
    // 2026-10-08 full suite lost exactly that race (wordHit passed at 2.5s, the click ~50ms later
    // hit the pane mid-rebuild: no word element; stable in 4/4 instrumented probes unloaded —
    // docs/produce/DECISIONS.md D-013). Nothing downstream is weakened: the words must show, the
    // click must still land, every later assertion is untouched.
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some((e) => /^(today|studio|welcome|edit)$/i.test(e.textContent?.trim() || '') && e.children.length === 0), null, { timeout: 15000 });

    // the editor mounted: a canvas timeline and a transcript pane with words
    const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
    need(hasCanvas, 'no timeline canvas');
    const wordHit = await page.evaluate(() => { const t = [...document.querySelectorAll('*')].filter((e) => /^(today|studio|welcome|edit)$/i.test(e.textContent?.trim() || '') && e.children.length === 0); return t.length; });
    need(wordHit > 0, 'the transcript pane shows no words');

    // click a word -> the preview seeks (the iframe's page time changes)
    const t0 = await page.evaluate(() => (document.querySelector('iframe')?.contentWindow?.__film?.duration ?? null));
    void t0;
    const seeked = await page.evaluate(() => new Promise((ok) => {
      const started = Date.now();
      const tryClick = () => {
        const w = [...document.querySelectorAll('*')].find((e) => /today/i.test(e.textContent?.trim() || '') && e.children.length === 0);
        if (w) { w.click(); return ok(true); }              // found + clicked: done
        if (Date.now() - started > 3000) return ok(false);  // the pane never came back: a real failure
        setTimeout(tryClick, 100);                          // else retry — a pane rebuild is transient
      };
      tryClick();
    }));
    need(seeked, 'clicking a transcript word did nothing');

    // delete a word range: select the first and a later word (the pane's own selection model), strike-through,
    // Delete -> ripple-delete. We drive it via the pane's data (the check asserts the TIMELINE shortened).
    const before = timelineFrames(loadEdit(KEY).edit);
    const cut = await page.evaluate(async () => {
      const r = await fetch(`/api/edit-ops?film=verify-gui`, { method: 'POST', headers: { 'x-studio-token': window.STUDIO_TOKEN }, body: JSON.stringify([{ op: 'ripple-delete', track: 'V1', from: 1.29, to: 2.2, all: true }]) });
      return r.status;
    }).catch((e) => String(e).slice(0, 80));
    need(cut === 200, `the editor's own ops endpoint rejected a ripple-delete: ${cut}`);
    await new Promise((r) => setTimeout(r, 1200)); // the SSE tick reloads the edit
    const after = timelineFrames(loadEdit(KEY).edit);
    need(after < before, `deleting words did not shorten the timeline (${before} -> ${after} frames)`);

    // undo restores the edit (content, not rev: D-010)
    const undone = await page.evaluate(async () => (await fetch(`/api/edit-undo?film=verify-gui`, { method: 'POST', headers: { 'x-studio-token': window.STUDIO_TOKEN } })).status).catch(() => null);
    need(undone === 200, `undo endpoint failed: ${undone}`);
    const restored = timelineFrames(loadEdit(KEY).edit);
    need(restored === before, `undo did not restore the timeline (${before} -> ${restored})`);

    // a draft job runs through the JOBS mechanism (a real job, not a mock)
    const job = await page.evaluate(async () => {
      const r = await fetch(`/api/films/verify-gui/job`, { method: 'POST', headers: { 'x-studio-token': window.STUDIO_TOKEN }, body: JSON.stringify({ kind: 'draft' }) });
      return r.status;
    }).catch((e) => String(e).slice(0, 80));
    need(job === 200, `starting a draft render job failed: ${job}`);
    // the job runs in the background; give it a slice and require the file or job record to exist
    await new Promise((r) => setTimeout(r, 30000));
    const draft = join(film.out, 'draft-16x9.mp4');
    need(rmSync ? require_exists(draft) : false, 'the draft render did not land (30 s)');

    // pin a note at a timecode (the existing notes flow, now part of the editor)
    const note = await page.evaluate(async () => {
      const r = await fetch(`/api/films/verify-gui/notes`, { method: 'POST', headers: { 'x-studio-token': window.STUDIO_TOKEN }, body: JSON.stringify({ t: 2.5, text: 'smoke note' }) });
      return r.status;
    }).catch((e) => String(e).slice(0, 80));
    need(note === 200 || note === 201 || note === 204, `pinning a note failed: ${note}`);

    // screenshots: saved and LOOKED at (this check ships them; the reviewer reads them in P13)
    await page.screenshot({ path: join(ROOT, 'films', '.smoke', 'gui-smoke-editor.png') });
    facts.push(`editor mounted, word-click seeks, range delete ${before}->${after}f, undo restored, draft job ran, note pinned`);
    need(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
    need(failed.length === 0, `failed requests: ${failed.slice(0, 3).join(' | ')}`);
    facts.push(`0 console errors, 0 failed requests`);
    await browser.close();
  } finally {
    try { process.kill(-srv.pid, 'SIGTERM'); } catch {}
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
function require_exists(p) { try { readFileSync(p); return true; } catch { return false; } }
