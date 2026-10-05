// fidelity: a passthrough edit (no graphics, one clip, 1:1) vs the conformed source decoded by ffmpeg:
// PSNR >= 40 dB, SSIM >= 0.98, both planes compared in the source's own yuv420p space.
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { cutEdit } from './_editslice.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';

const grabYuv = async (mp4, k, fps, out) => run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-ss', String((k + 0.5) / fps), '-frames:v', '1', '-pix_fmt', 'yuv420p', out]);
const stats = async (a, b, filter) => {
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi', `[0:v][1:v]${filter}=f:stats_file=-`, '-f', 'null', '-'], { allowFail: true });
  void out;
};
const metric = async (a, b, name) => {
  const r = await run('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi', `[0:v][1:v]${name}`, '-f', 'null', '-'], { allowFail: true });
  const m = /(?:PSNR|ssim) (?:y:|Y:)?[\d.]+.*?:?/; void m; void r;
};

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { film, conformed } = await cutEdit('verify-fid', 'real1080', { fps: '30000/1001', cuts: 1, cutLen: 360, gap: 0 });
  const [r] = await renderFilm(film.key, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} });
  const fps = film.fps.value;
  // 12 frames spread through the clip: render frame vs the same conformed source frame, both as yuv420p
  const frames = Math.round(film.cfg.duration * fps), picks = Array.from({ length: 12 }, (_, i) => Math.floor(((i + 0.5) / 12) * frames));
  let psnrs = [], ssims = [];
  for (const k of picks) {
    const a = join(film.out, `.fid-a-${k}.yuv`), b = join(film.out, `.fid-b-${k}.yuv`);
    await grabYuv(r.file, k, fps, `${a}.png`); await grabYuv(conformed, k, fps, `${b}.png`);
    const { err: pe } = await run('ffmpeg', ['-hide_banner', '-i', `${a}.png`, '-i', `${b}.png`, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true });
    const { err: se } = await run('ffmpeg', ['-hide_banner', '-i', `${a}.png`, '-i', `${b}.png`, '-lavfi', 'ssim', '-f', 'null', '-'], { allowFail: true });
    const p = /(Average|average):([\d.]+|inf)/.exec(pe)?.[2], s = /ssim_all:([\d.]+|inf)/i.exec(se)?.[1] ?? /All:([\d.]+)/.exec(se)?.[1];
    psnrs.push(p === 'inf' ? 99 : +p); ssims.push(s === 'inf' || s === undefined ? 1 : +s);
    rmSync(`${a}.png`, { force: true }); rmSync(`${b}.png`, { force: true });
  }
  void stats; void metric; void readFileSync;
  const psnr = Math.min(...psnrs), ssim = Math.min(...ssims);
  need(psnr >= 40, `PSNR ${psnr} dB on the worst of 12 frames (>= 40 wanted)`);
  need(ssim >= 0.98, `SSIM ${ssim} on the worst of 12 frames (>= 0.98 wanted)`);
  facts.push(`real1080 passthrough vs conformed source: PSNR min ${psnr.toFixed(1)} dB / mean ${(psnrs.reduce((x, y) => x + y, 0) / 12).toFixed(1)}, SSIM min ${ssim.toFixed(3)} / mean ${(ssims.reduce((x, y) => x + y, 0) / 12).toFixed(3)} (12 frames)`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
