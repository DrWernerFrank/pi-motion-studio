// S1 colour: canvas pixels of a seeked <video> vs ffmpeg's decode of the same frame (bt709, limited -> full RGB).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, serveStatic } from '../../../engine/lib/serve.mjs';

const FILE = join(ROOT, 'films', 'verify-s1', 'assets', 'media', 'gop15-720.mp4'), W = 1280, Y0 = 60, H = 600;
const raw = (args) => new Promise((ok, bad) => { const p = spawn('ffmpeg', args), b = []; p.stdout.on('data', (d) => b.push(d)); p.on('close', (c) => (c ? bad(new Error('ffmpeg ' + c)) : ok(Buffer.concat(b)))); });
const srv = await serveStatic(), { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-gpu'] });
const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
await p.goto(`${srv.url}/docs/editing/spikes/s1.html`); await p.waitForFunction(() => window.__ready);
await p.evaluate((s) => window.__open(s), '/films/verify-s1/assets/media/gop15-720.mp4');
const VARIANTS = {
  'bt709 limited→full': 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc',
  'bt601 limited→full': 'scale=in_color_matrix=bt601:in_range=tv:out_range=pc',
  'bt709, full-range input (no expansion)': 'scale=in_color_matrix=bt709:in_range=pc:out_range=pc',
  'bt709 limited→full, bilinear chroma (accurate_rnd+full_chroma_int)': 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int+bicubic',
};
const stats = (px, ref) => { let se = 0, n = 0; const bias = [0, 0, 0]; for (let i = 0; i < ref.length; i += 4) for (let c = 0; c < 3; c++) { const d = px[i + c] - ref[i + c]; se += d * d; bias[c] += d; n++; } const mse = se / n; return { psnr: +(10 * Math.log10(255 * 255 / mse)).toFixed(2), signedBias: bias.map((x) => +(x / (n / 3)).toFixed(2)) }; };
const rows = [];
for (const n of [10, 450]) {
  await p.evaluate((n) => window.__seek(n, 30), n);
  const px = await p.evaluate(([y, h]) => window.__pixels(0, y, 1280, h), [Y0, H]);
  for (const [name, vf] of Object.entries(VARIANTS)) {
    const ref = await raw(['-v', 'error', '-i', FILE, '-vf', `select=eq(n\\,${n}),crop=${W}:${H}:0:${Y0},${vf},format=rgba`, '-frames:v', '1', '-f', 'rawvideo', '-']);
    rows.push({ frame: n, ref: name, ...stats(px, ref) });
  }
}
console.log(JSON.stringify(rows, null, 1));
await browser.close(); await srv.close();
