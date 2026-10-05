// frame-exact: on sync (CFR) and vfr-rotated (VFR -> CFR conform), 12 cuts: every output frame's barcode index
// equals the planned source frame, in the live page, the draft and the final render. 0 frames of error.
import { fixturePath } from '../fixtures.mjs';
import { readBarcodes } from '../lib/barcode.mjs';
import { clipFrames, grid, mapFrame } from '../lib/edit-ops.mjs';
import { cutEdit } from './_editslice.mjs';
import { openStudio } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { renderFilm } from '../render.mjs';
import { join } from 'node:path';

export default async ({ quick } = {}) => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  // spacing fits inside each fixture (sync: 900 frames, vfr-rotated: 600)
  // a format that shows the whole source (the strip must survive the cover-fit): landscape -> 16:9, portrait -> 9:16. Both upscale 720->1080 = 1.5x.
  for (const [id, fx, cutLen, gap, fmt, scale] of [['sync', 'sync', 15, 40, '16:9', 1.5], ['vfr', 'vfr-rotated', 10, 25, '9:16', 1.5]]) {
    const { film, plan, G } = await cutEdit(`verify-fe-${id}`, fx, { fps: 30, cuts: 12, cutLen, gap, fmt: [fmt] });
    const edit = (await import('../lib/edit-store.mjs')).loadEdit(film.key).edit, v1 = edit.tracks.find((t) => t.kind === 'video');
    // the content a conformed frame shows: the vfr-rotated fixture dropped every 5th source frame (n%5==3),
    // and the conform holds the previous frame in those slots (verified in ingest-conform) — that held frame IS the planned picture.
    const contentOf = id === 'vfr' ? (q) => (q % 5 === 3 ? q - 1 : q) : (q) => q;
    const expected = []; // barcode number for every timeline frame
    for (let k = 0; k < G.F(film.cfg.duration); k++) { const c = v1.clips.find((x) => k >= G.F(x.at) && k < G.F(x.at) + clipFrames(edit, x)); expected.push(c ? contentOf(mapFrame(edit, c, k)) : -1); }

    // live page (the preview path; full-res canvas, so the cover factor is canvas/source)
    const studio = await openStudio();
    const page = await studio.page(film, fmt, 1);
    let wrong = 0, first = null;
    for (let k = 0; k < expected.length; k++) {
      const t = G.S(k) + G.S(1) / 2; // middle of the frame
      const png = await page.evaluate((t) => window.__frame(t, 'image/png'), t);
      // decode the barcode strip straight from the PNG (top-left 640x40, cells of 40)
      const got = await readBarcodePng(png, scale);
      if (got !== expected[k]) { wrong++; first ??= { k, got, want: expected[k] }; }
    }
    await studio.close();
    need(wrong === 0, `${id}: ${wrong}/${expected.length} frames wrong in the live page${first ? ` (first at frame ${first.k}: read ${first.got}, planned ${first.want})` : ''}`);
    if (!wrong) facts.push(`${id}: ${expected.length}/${expected.length} page frames exact`);

    // renders
    for (const quality of quick ? ['draft'] : ['draft', 'final']) {
      const [r] = await renderFilm(film.key, { quality, fmt, workers: 2, log: () => {} });
      // the strip's scale in this render: render width / conformed source width (cover-fit into a same-aspect canvas is uniform)
      const w = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width', '-of', 'json', r.file])).out).streams[0].width;
      const rs = w / film.cfg._srcW;
      const bars = await readBarcodes(r.file, { scale: rs });
      const rw = bars.map((x, i) => x.n !== expected[i] ? { i: x.i, got: x.n, want: expected[i] } : null).filter(Boolean);
      need(bars.length === expected.length, `${id}/${quality}: ${bars.length} frames rendered, ${expected.length} planned`);
      need(rw.length === 0, `${id}/${quality}: ${rw.length} frames wrong${rw[0] ? ` (first ${JSON.stringify(rw[0])})` : ''}`);
      if (!rw.length) facts.push(`${id}/${quality}: ${bars.length} frames exact`);
    }
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};

// decode the barcode strip out of a base64 PNG without a browser: crop happens in readBarcodes, so decode here from raw PNG pixels
import { spawn } from 'node:child_process';
function readBarcodePng(dataUrl, scale = 1) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return new Promise((ok, bad) => {
    const w = Math.round(640 * scale), h = Math.round(40 * scale);
    const p = spawn('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', `crop=${w}:${h}:0:0,scale=16:1:flags=area,format=gray`, '-f', 'rawvideo', '-']);
    p.stdin.on('error', () => {}); p.stdin.end(b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0));
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString('binary')));
    p.stderr.on('data', (d) => bad(new Error(String(d))));
    p.on('close', () => { const buf = Buffer.from(out, 'binary'); let n = 0; for (let i = 0; i < 16; i++) if (buf[i] > 127) n |= 1 << i; ok(n); });
  });
}
void fixturePath;
