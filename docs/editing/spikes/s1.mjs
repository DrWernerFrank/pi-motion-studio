// S1: footage in Chromium. Frame exactness, speed, determinism and colour of <video> seeks on conformed media.
//   node docs/editing/spikes/s1.mjs   (results printed as JSON; numbers are copied into ADR-001)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../../../engine/fixtures.mjs';
import { ROOT, serveStatic } from '../../../engine/lib/serve.mjs';
import { run } from '../../../engine/lib/proc.mjs';

const DIR = join(ROOT, 'films', 'verify-s1', 'assets', 'media'); mkdirSync(DIR, { recursive: true });
const TAG = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const conform = (src, out, { gop, fps = 30, preset = 'veryfast', t } = {}) => run('ffmpeg', ['-y', '-v', 'error', '-i', src, ...(t ? ['-t', String(t)] : []),
  '-vf', `fps=${fps},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', preset, '-crf', '16', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0', ...TAG, '-an', out]);
const files = { 'gop15-720': [fixturePath('sync'), { gop: 15 }], 'intra-720': [fixturePath('sync'), { gop: 1 }], 'gop15-1080': [fixturePath('long'), { gop: 15, t: 60 }] };
for (const [id, [src, o]] of Object.entries(files)) if (!existsSync(join(DIR, `${id}.mp4`))) await conform(src, join(DIR, `${id}.mp4`), o);

const srv = await serveStatic();
const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-gpu', '--hide-scrollbars'] });
const open = async (id) => { const p = await browser.newPage({ viewport: { width: 800, height: 600 } }); await p.goto(`${srv.url}/docs/editing/spikes/s1.html`); await p.waitForFunction(() => window.__ready); const info = await p.evaluate((s) => window.__open(s), `/films/verify-s1/assets/media/${id}.mp4`); return { p, info }; };
const rnd = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const out = { canPlay: null, runs: {} };

const N = Number(process.env.S1_N || 500), SEQ = Number(process.env.S1_SEQ || 300), MODES = (process.env.S1_MODES || 'seeked,rvfc').split(',');
for (const [id, frames] of [['gop15-720', 900], ['intra-720', 900], ['gop15-1080', 1800]]) {
  for (const mode of MODES) {
    console.error(`[s1] ${id} ${mode} ...`);
    const { p, info } = await open(id);
    out.canPlay ??= await p.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'));
    const R = rnd(7), wrong = [], seq = [];
    let t0 = Date.now();
    for (let k = 0; k < N; k++) { const n = Math.floor(R() * frames); const got = await p.evaluate(([n, m]) => window.__seek(n, 30, m), [n, mode]).catch((e) => `ERR ${e.message.split('\n')[0]}`); if (got !== n) wrong.push([n, got]); }
    const randMs = (Date.now() - t0) / N;
    t0 = Date.now(); let seqWrong = 0;
    for (let n = 0; n < SEQ; n++) { const got = await p.evaluate(([n, m]) => window.__seek(n, 30, m), [n, mode]).catch(() => -1); if (got !== n) seqWrong++; }
    const seqMs = (Date.now() - t0) / SEQ;
    console.error(`[s1]   random ${N}: wrong ${wrong.length}, ${randMs.toFixed(1)} ms/seek; sequential ${SEQ}: wrong ${seqWrong}, ${seqMs.toFixed(1)} ms/frame`);
    out.runs[`${id}/${mode}`] = { ...info, randomSeeks: N, randomWrong: wrong.length, sample: wrong.slice(0, 4), randomMsPerSeek: +randMs.toFixed(1), seqFrames: SEQ, seqWrong, seqMsPerFrame: +seqMs.toFixed(1) };
    await p.close();
  }
}

// determinism: two pages in parallel (like two workers) and two sequential runs give identical pixels
const hashes = async () => { const { p } = await open('gop15-720'); const h = []; for (const n of [0, 37, 123, 450, 899, 61, 62]) { await p.evaluate((n) => window.__seek(n, 30), n); h.push(createHash('sha256').update(await p.evaluate(() => window.__png())).digest('hex').slice(0, 12)); } await p.close(); return h; };
const [a, b, c, d] = await Promise.all([hashes(), hashes(), hashes(), hashes()]);
out.determinism = { fourParallelPagesIdentical: [b, c, d].every((x) => x.join() === a.join()), hashes: a };

await browser.close(); await srv.close();
console.log(JSON.stringify(out, null, 1));
