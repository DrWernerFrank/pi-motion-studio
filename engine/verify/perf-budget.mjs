// perf-budget (P9): the speed budget, measured honestly — never tuned to pass. On this machine (12 cores
// assumed; recorded in the measured line): ingest + conform of the 20-minute 1080p30 `long` fixture into a
// fresh film <= 0.5x realtime (600 s); draft render of a 60 s talking-head excerpt <= 1x realtime (60 s,
// workers 4); final render of the same excerpt <= 3x realtime (180 s, workers 4) with peak RSS <= 2.5 GB
// (VmHWM of the render node process and of every ffmpeg child, sampled at 1 Hz); and no temp dirs left
// behind (out/.parts removed, no *.part.* in media dirs). --quick skips the 20-minute ingest part.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { createEditFilm } from '../edit-cli.mjs';
import { ingestSource } from '../ingest.mjs';
import { cutEdit } from './_editslice.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { renderFilm } from '../render.mjs';
import { ROOT } from '../lib/serve.mjs';

const KEY_LONG = 'perf-test-long', KEY_R = 'perf-test-render';
const REALTIME_LONG = 20 * 60;   // the `long` fixture is 20 minutes
const BUDGET = { ingest: 0.5 * REALTIME_LONG, draft: 60, final: 3 * 60, rss: 2.5 * 1024 ** 3 };

// every descendant of pid (node -> chromium -> renderers, node -> ffmpeg), via /proc's ppid links
function tree(pid) {
  const ppids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const st = readFileSync(`/proc/${d}/stat`, 'utf8'); ppids.set(Number(d), Number(st.split(') ')[1].split(' ')[1])); } catch { /* raced away */ }
  }
  const out = new Set([pid]);
  for (let grew = true; grew;) { grew = false; for (const [p, pp] of ppids) if (out.has(pp) && !out.has(p)) { out.add(p); grew = true; } }
  return out;
}
const memOf = (pid) => { try { const s = readFileSync(`/proc/${pid}/status`, 'utf8'); return { hwm: Number(/VmHWM:\s+(\d+)/.exec(s)[1]) * 1024, rss: Number(/VmRSS:\s+(\d+)/.exec(s)[1]) * 1024 }; } catch { return null; } };

// run a command as a child and sample the whole child tree's memory at 1 Hz until it exits -> { wall, code, maxHwm, maxTree, samples, tail }
async function sampled(cmd, args) {
  const t0 = performance.now();
  const ch = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (out += d));
  const closed = new Promise((ok) => ch.on('close', ok));
  let maxHwm = 0, maxTree = 0, samples = 0;
  for (;;) {
    const tickDone = Promise.resolve(closed).then(() => false);
    const awake = await Promise.race([tickDone, new Promise((r) => setTimeout(r, 1000)).then(() => true)]);
    if (!awake) break;
    let sum = 0;
    for (const p of tree(ch.pid)) { const m = memOf(p); if (m) { maxHwm = Math.max(maxHwm, m.hwm); sum += m.rss; } }
    maxTree = Math.max(maxTree, sum); samples++;
  }
  const code = await closed;
  return { wall: (performance.now() - t0) / 1000, code, maxHwm, maxTree, samples, tail: out.trim().split('\n').at(-1) || '' };
}

// no *.part.* anywhere under a film's assets (an interrupted ingest or render leftover)
const partLeftovers = (dir) => { const out = []; const walk = (d) => { for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) { const p = join(d, e.name); if (e.name.includes('.part.')) out.push(p); else if (e.isDirectory()) walk(p); } }; walk(dir); return out; };

export default async ({ quick = false } = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const MB = (b) => `${(b / 1024 ** 2).toFixed(0)} MB`;
  try {
    // ── ingest + conform of the 20-minute fixture (skipped by --quick) ─────────────────────────────
    let ingestS = null;
    if (!quick) {
     try {
      rmSync(join(FILMS, KEY_LONG), { recursive: true, force: true });
      createEditFilm(KEY_LONG, { fps: 30, title: KEY_LONG, formats: ['16:9'] });
      const t = performance.now();
      const rec = await ingestSource(KEY_LONG, fixturePath('long'), { id: 'cam', log: () => {} });
      ingestS = (performance.now() - t) / 1000;
      need(ingestS <= BUDGET.ingest, `ingest+conform of the 20-min fixture took ${ingestS.toFixed(0)}s, budget ${BUDGET.ingest}s (0.5x realtime)`);
      facts.push(`ingest long (20min 1080p30, ${rec.ingest.conform.frames} frames): ${ingestS.toFixed(0)}s = ${(ingestS / REALTIME_LONG).toFixed(2)}x realtime (budget 0.50x)`);
      // the long film's own cleanliness, checked before it is deleted (the budget's temp-dir clause)
      need(!existsSync(join(readFilm(KEY_LONG).out, '.parts')), 'films/perf-test-long/out/.parts left behind by the ingest');
      const longLeft = partLeftovers(join(FILMS, KEY_LONG, 'assets'));
      need(longLeft.length === 0, `temp files left behind by the ingest: ${longLeft.join(', ')}`);
      rmSync(join(FILMS, KEY_LONG), { recursive: true, force: true }); // the measurement is the point; the film is not needed
     } catch (e) { bad.push(`ingest of the 20-min fixture failed: ${String(e.message || e).split('\n')[0]}`); rmSync(join(FILMS, KEY_LONG), { recursive: true, force: true }); }
    } else facts.push('ingest long: skipped by --quick');

    // ── a 60.0 s talking-head excerpt (12 cuts, one at half speed, one 58-frame freeze -> exactly 1800 frames) ─
    const { film } = await cutEdit(KEY_R, 'real-talking-head', {
      fps: 30, cuts: 12, cutLen: 134, gap: 0, retime: 0.5, fmt: ['16:9'], log: () => {},
      extraOps: [{ op: 'freeze', id: 'c12', t: 54, dur: 58 / 30 }], // tops the timeline up to exactly 60.000 s
    });
    need(film.cfg.duration === 60, `the excerpt is ${film.cfg.duration}s, wanted exactly 60.0s (1800 frames at 30fps)`);

    // ── draft: <= 1x realtime ──────────────────────────────────────────────────────────────────────
    let draftS = null;
    try {
      const t = performance.now();
      await renderFilm(KEY_R, { quality: 'draft', fmt: '16:9', workers: 4, log: () => {} });
      draftS = (performance.now() - t) / 1000;
      need(draftS <= BUDGET.draft, `draft render of 60s took ${draftS.toFixed(0)}s, budget ${BUDGET.draft}s (1x realtime)`);
      facts.push(`draft 60s (workers 4): ${draftS.toFixed(0)}s = ${(draftS / 60).toFixed(2)}x realtime (budget 1.00x)`);
    } catch (e) { bad.push(`draft render failed: ${String(e.message || e).split('\n')[0]}`); } // crash-proof: a failed render is a FAIL with numbers, never a lost log

    // ── final: <= 3x realtime, peak RSS <= 2.5 GB (sampled at 1 Hz over the render node + its ffmpeg/chromium children) ─
    const fin = await sampled('node', ['engine/cli.mjs', 'render', KEY_R, '--fmt', '16:9', '--workers', '4']);
    facts.push(`final 60s (workers 4): exit ${fin.code}, ${fin.wall.toFixed(0)}s = ${(fin.wall / 60).toFixed(2)}x realtime (budget 3.00x)` +
      `; peak RSS ${MB(fin.maxHwm)} (budget ${MB(BUDGET.rss)}), whole-tree sampled ${MB(fin.maxTree)} over ${fin.samples} ticks`);
    if (fin.code !== 0) bad.push(`final render exited ${fin.code}: ${fin.tail}`); // the budget facts stay readable even when the render failed
    else {
      need(fin.wall <= BUDGET.final, `final render of 60s took ${fin.wall.toFixed(0)}s, budget ${BUDGET.final}s (3x realtime)`);
      need(fin.samples > 0, 'the RSS sampler never ran (the render finished inside its first tick?)');
      need(fin.maxHwm <= BUDGET.rss, `peak RSS ${MB(fin.maxHwm)} (single process VmHWM), budget ${MB(BUDGET.rss)}`);
    }

    // the final render must actually be the film (not a fast path gone wrong); probed only when it exists — a
    // failed render is already a FAIL above and must not crash the check before its numbers are returned
    if (fin.code === 0) {
    const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames:format=duration', '-of', 'json', join(readFilm(KEY_R).out, 'final-16x9.mp4')])).out);
    need(Number(probe.streams[0].nb_frames) === 1800, `final render has ${probe.streams[0].nb_frames} frames, wanted 1800`);

    // ── no temp dirs left behind ───────────────────────────────────────────────────────────────────
    const rf = readFilm(KEY_R);
    const partsGone = !existsSync(join(rf.out, '.parts'));
    need(partsGone, 'films/perf-test-render/out/.parts was left behind');
    const leftovers = partLeftovers(join(FILMS, KEY_R, 'assets'));
    need(leftovers.length === 0, `temp files left behind: ${leftovers.join(', ')}`);
    facts.push(`temp dirs: .parts ${partsGone ? 'gone' : 'LEFT BEHIND'}, ${leftovers.length} *.part.* leftovers; final probed ${probe.streams[0].nb_frames} frames / ${Number(probe.format.duration).toFixed(3)}s`);
    } else facts.push('temp dirs: not probed (the final render failed)');
    facts.push(`on a ${cpus().length}-core machine (the budgets assume 12)`);
  } finally {
    // exactly the films THIS CHECK created (never a sweep: another agent may own a neighbouring key)
    for (const k of [KEY_LONG, KEY_R]) rmSync(join(FILMS, k), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: (bad.length ? 'FAIL: ' + bad.join('; ') + ' — ' : '') + facts.join('; ') };
};
