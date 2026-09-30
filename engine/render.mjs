// Walk time, paint each frame with window.seek(t), pipe frames into ffmpeg.
// Parallel: the frame range is split across workers (pages); each encodes a part,
// parts are concatenated losslessly. Safe because every frame is a pure function of t.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fmtSlug, openStudio, readFilm } from './lib/film.mjs';
import { run } from './lib/proc.mjs';

export const QUALITY = {
  draft: { scale: 0.5, fpsCap: 30, sub: 1, crf: 23, preset: 'veryfast', img: 'jpeg' },
  final: { scale: 1, fpsCap: 120, sub: null, crf: 16, preset: 'medium', img: 'png' },
};

export async function renderFilm(key, opts = {}) {
  const film = readFilm(key);
  const q = QUALITY[opts.quality || 'final'];
  const fmts = opts.fmt === 'all' ? film.cfg.formats : [opts.fmt || film.cfg.formats[0]];
  const FPS = Math.min(opts.fps || film.cfg.fps, q.fpsCap);
  const SUB = opts.sub ?? q.sub ?? film.cfg.motionBlur;
  const from = opts.from ?? 0, to = Math.min(opts.to ?? film.cfg.duration, film.cfg.duration);
  const workers = opts.workers || Math.max(1, Math.min(4, Math.floor(cpus().length / 3)));
  const log = opts.log || console.log;
  const studio = await openStudio();
  const results = [];
  try {
    for (const fmt of fmts) {
      const t0 = Date.now();
      const frames = Math.round((to - from) * FPS);
      const partsDir = join(film.out, '.parts', fmtSlug(fmt));
      rmSync(partsDir, { recursive: true, force: true }); mkdirSync(partsDir, { recursive: true });
      const n = Math.min(workers, frames);
      const chunk = Math.ceil(frames / n);
      let done = 0, lastPct = -1;
      const tick = () => {
        const pct = Math.floor((100 * ++done) / frames);
        if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; log(`[${fmt}] ${pct}%  (${done}/${frames} frames)`); }
      };
      await Promise.all(Array.from({ length: n }, async (_, w) => {
        const a = w * chunk, b = Math.min(frames, a + chunk);
        if (a >= b) return;
        const page = await studio.page(film, fmt, q.scale);
        await encodePart(page, join(partsDir, `part-${String(w).padStart(2, '0')}.mp4`), { a, b, FPS, SUB, from, q, tick });
        await page.close();
      }));
      if (studio.errors.length) throw new Error('film threw while rendering:\n' + studio.errors.slice(0, 5).join('\n'));

      const range = opts.from != null || opts.to != null;
      // out/<name>.mp4 is the deliverable, out/<name>.silent.mp4 the picture-only intermediate.
      const name = `${opts.quality === 'draft' ? 'draft' : range ? `range-${from}-${to}` : 'final'}-${fmtSlug(fmt)}`;
      const silent = join(film.out, `${name}.silent.mp4`);
      const list = join(partsDir, 'list.txt');
      writeFileSync(list, Array.from({ length: n }, (_, w) => `file 'part-${String(w).padStart(2, '0')}.mp4'`).join('\n'));
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', silent]);
      rmSync(partsDir, { recursive: true, force: true });

      const final = join(film.out, `${name}.mp4`);
      const mixWav = join(film.out, 'mix.wav');
      if (!existsSync(mixWav)) copyFileSync(silent, final);
      else {
        const args = ['-y', '-v', 'error', '-i', silent];
        if (from > 0) args.push('-ss', String(from));
        args.push('-i', mixWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', final);
        await run('ffmpeg', args);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log(`[${fmt}] wrote ${final.slice(film.dir.length + 1)}  ${frames} frames x${SUB} sub @${FPS}fps in ${secs}s`);
      results.push({ fmt, file: final, silent, frames, fps: FPS, sub: SUB, seconds: +secs });
    }
  } finally { await studio.close(); }
  return results;
}

async function encodePart(page, file, { a, b, FPS, SUB, from, q, tick }) {
  const bt709 = 'scale=out_color_matrix=bt709:out_range=tv';
  const vf = SUB > 1
    ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,${bt709}`
    : bt709;
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', q.img === 'png' ? 'png' : 'mjpeg',
    '-framerate', String(FPS * SUB), '-i', '-', '-vf', vf, '-r', String(FPS),
    '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((ok, bad) => ff.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c} on ${file}`)))));
  const type = q.img === 'png' ? 'image/png' : 'image/jpeg';
  for (let f = a; f < b; f++) {
    for (let s = 0; s < SUB; s++) {
      const t = from + (f * SUB + s) / (FPS * SUB);
      const url = await page.evaluate(([t, type]) => window.__still(t, type, 0.92), [t, type]);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    tick();
  }
  ff.stdin.end();
  await closed;
}
