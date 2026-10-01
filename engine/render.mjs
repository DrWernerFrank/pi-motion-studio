// Walk time, paint each frame with window.seek(t), pipe frames into ffmpeg.
// Parallel: the frame range is split across workers (pages); each encodes a part,
// parts are concatenated losslessly. Safe because every frame is a pure function of t.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import { fmtSlug, openStudio, readFilm } from './lib/film.mjs';
import { framesIn, parseFps } from './lib/frames.mjs';
import { run } from './lib/proc.mjs';
import { gridUnits, noteSegment, planRender, SEGMENT_FRAMES, windowOf } from './segment-cache.mjs';

export const QUALITY = {
  draft: { scale: 0.5, fpsCap: 30, sub: 1, crf: 23, preset: 'veryfast', img: 'jpeg' },
  final: { scale: 1, fpsCap: 120, sub: null, crf: 16, preset: 'medium', img: 'png' },
};

// The highest whole-number division of the film's rate that fits under a cap (60 -> 30, 60000/1001 -> 30000/1001, 24 stays 24).
export function capFps(fps, cap) { const k = Math.ceil(fps.value / cap - 1e-9); return k <= 1 ? fps : parseFps({ num: fps.num, den: fps.den * k }); }

export async function renderFilm(key, opts = {}) {
  const film = readFilm(key);
  const quality = opts.quality || 'final';
  const q = QUALITY[quality];
  const fmts = opts.fmt === 'all' ? film.cfg.formats : [opts.fmt || film.cfg.formats[0]];
  const FPS = capFps(parseFps(opts.fps || film.cfg.fps), q.fpsCap); // exact rational: frame counts and times never come from float seconds
  const SUB = opts.sub ?? q.sub ?? film.cfg.motionBlur;
  const from = opts.from ?? 0, to = Math.min(opts.to ?? film.cfg.duration, film.cfg.duration);
  const workers = opts.workers || Math.max(1, Math.min(4, Math.floor(cpus().length / 3)));
  const log = opts.log || console.log;
  let studio = null; // opened lazily: a fully cached (warm) render never needs a browser
  const pages = async (fmt, scale) => (studio ??= await openStudio()).page(film, fmt, scale);
  const results = [];
  try {
    for (const fmt of fmts) {
      const t0 = Date.now();
      const frames = framesIn(to - from, FPS);
      const partsDir = join(film.out, '.parts', fmtSlug(fmt));
      rmSync(partsDir, { recursive: true, force: true }); mkdirSync(partsDir, { recursive: true });
      let done = 0, lastPct = -1;
      const tick = (n = 1) => {
        for (let i = 0; i < n; i++) {
          const pct = Math.floor((100 * ++done) / frames);
          if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; log(`[${fmt}] ${pct}%  (${done}/${frames} frames)`); }
        }
      };
      // a whole-output 3D LUT (edit.color.lut), resolved once here: encodePart appends it to the filter chain
      let lut = '';
      if (film.cfg.kind === 'edit') {
        const { readJson } = await import('./lib/film.mjs');
        const edit = readJson(join(film.dir, 'edit.json'));
        if (edit?.color?.lut) {
          const { safePath } = await import('./lib/serve.mjs');
          const full = safePath(edit.color.lut.replace(/^\//, ''));
          if (!full || !existsSync(full)) throw new Error(`edit.color.lut "${edit.color.lut}" does not resolve inside the repo`);
          lut = `,lut3d=file='${full}':interp=nearest`;
        }
      }

      // P9 segment cache. Parts are units of a fixed frame grid (engine/segment-cache.mjs): cached units are copied
      // in, the gaps are encoded and written back. Every path — cache on, --no-cache (opts.bypassCache), cold, warm,
      // mixed, or a cache error — splits at the SAME grid, so the deliverable is byte-identical however many parts
      // were served from the cache; a cache problem can only cost time, never correctness.
      const win = windowOf(film, { from, to, fps: FPS });
      const covers = (us, a0, b0) => us.length > 0 && us[0].a === a0 && us.at(-1).b === b0
        && us.reduce((s, u) => s + (u.b - u.a), 0) === b0 - a0 && us.every((u, i) => i === 0 || us[i - 1].b === u.a);
      let plan = null;
      if (win.aligned && !opts.bypassCache) {
        try { plan = await planRender(film, { quality, fmt, from, to, fps: FPS, sub: SUB, workers }); }
        catch (e) { log(`[${fmt}] segment cache unavailable (${String(e.message || e).split('\n')[0]}): rendering without it`); plan = null; }
      }
      let units;
      if (plan && covers(plan.units, win.A, win.B)) {
        units = plan.units;
        if (units.some((u) => u.cached)) log(`[${fmt}] cache: ${plan.hits}/${units.length} segments reused`);
      } else if (win.aligned) { // no cache (bypassed or failed): the same grid, just nothing reused or written back
        plan = null;
        units = gridUnits(win.A, win.B, win.total, SEGMENT_FRAMES[quality] ?? SEGMENT_FRAMES.final)
          .map((u) => ({ ...u, cached: false, file: null, hash: null }));
      } else { // a window that is not frame-aligned (a partial render off the grid): the plain worker split, no cache
        plan = null;
        const n = frames > 0 ? Math.min(workers, frames) : 0, chunk = frames > 0 ? Math.ceil(frames / n) : 0;
        units = Array.from({ length: n }, (_, w) => { const a = w * chunk, b = Math.min(frames, a + chunk); return a >= b ? null : { a, b, local: true }; }).filter(Boolean);
      }
      const parts = units.map((u) => ({ ...u, part: join(partsDir, `part-${String(u.a).padStart(6, '0')}.mp4`) }));
      for (const p of parts) if (p.cached) { copyFileSync(p.file, p.part); tick(p.b - p.a); } // frames from the cache count as done
      const enc = parts.filter((p) => !p.cached);
      if (enc.length) {
        const n = Math.min(workers, enc.length), target = enc.reduce((s, u) => s + u.b - u.a, 0) / n;
        const groups = []; let cur = [], acc = 0;
        for (const u of enc) { cur.push(u); acc += u.b - u.a; if (acc >= target && groups.length < n - 1) { groups.push(cur); cur = []; acc = 0; } }
        groups.push(cur);
        await Promise.all(groups.map(async (group) => {
          const page = await pages(fmt, q.scale);
          for (const u of group) {
            // times are exact rationals on integer frames: an aligned unit's frames are absolute timeline frames;
            // a misaligned partial window keeps the legacy from-offset formula
            const tOf = u.local
              ? (f, s) => from + ((f * SUB + s) * FPS.den) / (FPS.num * SUB)
              : (f, s) => ((f * SUB + s) * FPS.den) / (FPS.num * SUB);
            await encodePart(page, u.part, { a: u.a, b: u.b, FPS, SUB, q, tick, lut, tOf });
          }
          await page.close();
        }));
      }
      if (studio?.errors.length) throw new Error('film threw while rendering:\n' + studio.errors.slice(0, 5).join('\n'));

      // a freshly encoded full segment is the cache's content, by construction: promote it before the concat, so a
      // broken part (wrong frame count) fails loudly here instead of shipping a corrupt deliverable
      if (plan) for (const p of parts) if (!p.cached && p.full) {
        if (!(await noteSegment(p.part, p.segA, p.segB, p.hash, { film, fmt, quality }))) log(`[${fmt}] cache: could not write segment [${p.segA},${p.segB}) (disk?)`);
      }

      const range = opts.from != null || opts.to != null;
      // out/<name>.mp4 is the deliverable, out/<name>.silent.mp4 the picture-only intermediate.
      const name = `${opts.quality === 'draft' ? 'draft' : range ? `range-${from}-${to}` : 'final'}-${fmtSlug(fmt)}`;
      const silent = join(film.out, `${name}.silent.mp4`);
      const list = join(partsDir, 'list.txt');
      writeFileSync(list, parts.map((p) => `file '${basename(p.part)}'`).join('\n'));
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
      const cached = plan ? `; cache ${plan.hits}/${units.length} segments` : opts.bypassCache ? '; cache bypassed' : '';
      log(`[${fmt}] wrote ${final.slice(film.dir.length + 1)}  ${frames} frames x${SUB} sub @${FPS.str}fps in ${secs}s${cached}`);
      results.push({ fmt, file: final, silent, frames, fps: FPS.str, sub: SUB, seconds: +secs });
    }
  } finally { await studio?.close(); }
  return results;
}

async function encodePart(page, file, { a, b, FPS, SUB, q, tick, lut = '', tOf }) {
  // setparams: the scale filter only tags the matrix; the encoder takes primaries/transfer/range from the frames, not from the -color_* flags
  const bt709 = 'scale=out_color_matrix=bt709:out_range=tv,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
  const vf = SUB > 1
    ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N*${FPS.den}/${FPS.num}/TB,${bt709}${lut}`
    : bt709 + lut;
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', q.img === 'png' ? 'png' : 'mjpeg',
    '-framerate', `${FPS.num * SUB}/${FPS.den}`, '-i', '-', '-vf', vf, '-r', FPS.str,
    '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((ok, bad) => ff.on('close', (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c} on ${file}`)))));
  const type = q.img === 'png' ? 'image/png' : 'image/jpeg';
  for (let f = a; f < b; f++) {
    for (let s = 0; s < SUB; s++) {
      const t = tOf(f, s); // exact: an integer numerator over an integer denominator
      const url = await page.evaluate(([t, type]) => window.__frame(t, type, 0.92), [t, type]);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    tick();
  }
  ff.stdin.end();
  await closed;
}
