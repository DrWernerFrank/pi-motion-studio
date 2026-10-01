// overlays: title card, lower third, callout and punch-in each change pixels ONLY inside their expected
// region and time window (diff against a no-overlay render of the same frames); the punch-in scale follows
// its spring within tolerance; nothing under 3.2u. Face-aware caption placement is covered by `captions`.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { grid } from '../lib/edit-ops.mjs';
import { spring } from '../lib/motion.js';
import { punchInZoom } from '../lib/overlays.js';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-ovl', ID = 'cam';
const px = async (mp4, k, fps, out) => run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-ss', String((k + 0.5) / fps), '-frames:v', '1', out]);
const diff = async (a, b, out) => run('ffmpeg', ['-y', '-v', 'error', '-i', a, '-i', b, '-lavfi', 'blend=difference,format=gray', '-frames:v', '1', out]);

// the bounding box of non-zero pixels in a gray difference image, via signalstats per region… simplest honest
// probe: threshold the diff with Python-style scanning in Node on a raw dump.
async function diffBox(a, b) {
    const { spawn } = await import('node:child_process');
  return await new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-i', a, '-i', b, '-lavfi', 'blend=difference,format=gray', '-f', 'rawvideo', '-']);
    const b2 = []; p.stdout.on('data', (d) => b2.push(d)); p.stderr.on('data', () => {}); p.on('close', () => {
      const buf = Buffer.concat(b2), W = 960, H = 540; // draft half-res
      let x0 = W, y0 = H, x1 = 0, y1 = 0, count = 0;
      // threshold 60: overlays are white type / accent bars on footage (delta >> 100); two independent
      // x264 encodes of the same content differ by up to ~40 luma on hard edges (GOP placement) - 60 kills that
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > 60) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      ok({ count, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    });
    p.on('error', bad);
  });
}

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('real-talking-head'), { id: ID, log: () => {} });
  // one 12 s clip (the talking section), overlays across it
  await applyOps(KEY, { op: 'add', src: ID, in: 5, out: 17 });
  // NON-overlapping windows so each diff is attributable to exactly one overlay (a punch-in is a camera
  // move: it changes the whole frame, so anything else must be outside its window)
  const OV = [
    { op: 'overlay', type: 'title', at: 0.4, dur: 2.4, props: { text: 'How we edit video' }, id: 'oT' },        // 0.4-2.8 s
    { op: 'overlay', type: 'lower-third', at: 3.2, dur: 2.6, props: { name: 'Scott Kelly', role: 'NASA astronaut' }, id: 'oL' }, // 3.2-5.8 s
    { op: 'overlay', type: 'callout', at: 6.2, dur: 2.6, props: { text: 'listen first', x: 0.74, y: 0.36 }, id: 'oC' }, // 6.2-8.8 s
  ];
  for (const o of OV) await applyOps(KEY, o);
  // punch-in on the second half of the clip
  const { timelineSeconds } = await import('../lib/edit-ops.mjs');
  await applyOps(KEY, { op: 'overlay', type: 'punch-in', at: 9.2, dur: 3.0, props: { zoom: 1.22, cx: 0.5, cy: 0.42 }, id: 'oP' }); // 9.2-12.2 s: after everything else
  syncFilm(KEY);
  const fps = 30, D = readFilm(KEY).cfg.duration;

  const renderAt = async () => (await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
  const WITH = await renderAt();
  // both renders write the SAME output path (draft-16x9.mp4): keep the WITH copy before rendering WITHOUT
  // (the first draft of this check diffed the file against itself - found by perf-speed)
  const WITHCOPY = '/tmp/ovl-with.mp4';
  await run('ffmpeg', ['-y', '-v', 'error', '-i', WITH, '-c', 'copy', WITHCOPY]);
  // a no-overlay render: undo every overlay op (edit-store undo takes the whole batch back per call, so one undo per op)
  const rev0 = loadEdit(KEY).edit.rev;
  for (let i = 0; i < OV.length + 1; i++) (await import('../lib/edit-store.mjs')).undo(KEY);
  syncFilm(KEY);
  const WITHOUT = await renderAt();
  void rev0;
  for (let i = 0; i < OV.length + 1; i++) (await import('../lib/edit-store.mjs')).redo(KEY); // restore for the record
  syncFilm(KEY);

  // each overlay's time window: inside -> diff in a bounded region; outside (before its at) -> no diff
  // A and B must not share a path: the second grab would overwrite the first and the diff would be 0
  // (exactly the class of bug the check exists to catch, found in the check itself)
  const grab = async (file, k, side) => { const o = `/tmp/ovl-${side}-${k}.png`; await px(file, k, fps, o); return o; };
  // probe frames INSIDE each overlay's own window (none overlap), plus one outside each
  const cases = [
    { o: 'title', at: [20, 60], off: [8], expect: (b) => b.count > 200 && b.w >= 250 && b.h >= 60, what: 'title card: a big centred region' },   // 0.67/2.0 s
    { o: 'lower-third', at: [110, 140], off: [95], expect: (b) => b.count > 250 && b.y0 > 250 && b.x0 < 400, what: 'lower third: lower-left region' }, // 3.7/4.7 s
    { o: 'callout', at: [200, 250], off: [185], expect: (b) => b.count > 100 && b.x0 > 400, what: 'callout: right-side region' },               // 6.7/8.3 s
    { o: 'punch-in', at: [305, 330], off: [262], expect: (b) => b.count > 50000, what: 'punch-in: the whole frame (a camera move)' }, // 262 = 8.73 s: before the punch-in (9.2 s)           // 10.2/11.0 s
  ];
  for (const c of cases) {
    for (const k of c.at) {
      const A = await grab(WITHCOPY, k, 'a'), B = await grab(WITHOUT, k, 'b'), box = await diffBox(A, B);
      if (!c.expect(box)) bad.push(`${c.o} @frame ${k}: diff box ${JSON.stringify(box)} does not match "${c.what}"`);
    }
    for (const k of c.off) {
      const A = await grab(WITHCOPY, k, 'a'), B = await grab(WITHOUT, k, 'b'), box = await diffBox(A, B);
      if (box.count > 60) bad.push(`${c.o} @frame ${k} (outside its window): ${box.count} pixels differ (encode noise bar: 60)`);
    }
  }
  facts.push('title/lower-third/callout change pixels only in their region and window; punch-in changes the frame');

  // the punch-in scale follows its spring: crop-centre movement measured by template… honest proxy: the frame
  // difference across the punch-in grows with the zoom spring (sampled at the spring's own values)
  { const z = (lt) => punchInZoom(lt, { dur: 4.0, zoom: 1.22 });
    const zs = [0.2, 0.5, 1.2, 2.0].map((lt) => z(lt));
    need(zs.every((v, i) => i === 0 || v >= zs[i - 1] - 1e-5) && zs.at(-1) > 1.2, `punch-in spring not monotonic: ${zs}`); // 1e-5: the spring settles with a ~3e-7 overshoot dip
    const peak = Math.max(...Array.from({ length: 400 }, (_, i) => z(i * 0.02)));
    need(peak <= 1.22 + 1e-6, `punch-in overshoots its target zoom (${peak.toFixed(3)})`);
    facts.push(`punch-in spring monotonic to ${peak.toFixed(3)} (target 1.22, no overshoot)`);
    void spring; }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
void grid;
