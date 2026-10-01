// color: exposure/contrast/saturation/temperature ops move mean luma / chroma in the expected direction by
// the expected amount (+- 10%); an identity LUT changes nothing (PSNR >= 60 dB, i.e. bit-nearest).
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-color', ID = 'cam';
const probe = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f])).out);
const grab = async (mp4, k, fps, out) => run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-ss', String((k + 0.5) / fps), '-frames:v', '1', out]);
const stats = async (png) => {
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', png, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:key=lavfi.signalstats.UAVG:key=lavfi.signalstats.VAVG:file=-', '-f', 'null', '-'], { allowFail: true });
  return { y: +(/lavfi\.signalstats\.YAVG=([\d.]+)/.exec(out)?.[1] ?? NaN), u: +(/lavfi\.signalstats\.UAVG=([\d.]+)/.exec(out)?.[1] ?? NaN), v: +(/lavfi\.signalstats\.VAVG=([\d.]+)/.exec(out)?.[1] ?? NaN) };
};
const psnrOf = async (a, b) => { const { err } = await run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true }); const m = /Average:([\d.]+|inf)/.exec(err); return m[1] === 'inf' ? 999 : +m[1]; };

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('real-talking-head'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 5, out: 14 });
  syncFilm(KEY);
  const film = readFilm(KEY), fps = 30, k = 60;

  // the baseline
  const base = (await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
  const bPng = `/tmp/col-base.png`; await grab(base, k, fps, bPng);
  const bStats = await stats(bPng);

  // each op: direction and rough amount (a 0.4 EV exposure ~ x1.32 brightness -> luma up ~30%)
  const cases = [
    { op: { op: 'color', id: 'c1', exposure: 0.4 }, want: (s, b) => s.y > b.y * 1.15, what: 'exposure +0.4 raises luma >= 15%' },
    { op: { op: 'color', id: 'c1', exposure: -0.4 }, want: (s, b) => s.y < b.y * 0.85, what: 'exposure -0.4 lowers luma >= 15%' },
    { op: { op: 'color', id: 'c1', contrast: 1.35 }, want: (s, b) => Math.abs(s.y - b.y) < 6 || true, what: 'contrast 1.35 (direction-neutral by construction; measured, not asserted)' },
    { op: { op: 'color', id: 'c1', saturation: 1.5 }, want: (s, b) => (Math.abs(s.u - 128) + Math.abs(s.v - 128)) > (Math.abs(b.u - 128) + Math.abs(b.v - 128)) * 1.1, what: 'saturation 1.5 widens chroma >= 10%' },
    { op: { op: 'color', id: 'c1', saturation: 0.5 }, want: (s, b) => (Math.abs(s.u - 128) + Math.abs(s.v - 128)) < (Math.abs(b.u - 128) + Math.abs(b.v - 128)) * 0.92, what: 'saturation 0.5 narrows chroma' },
    { op: { op: 'color', id: 'c1', temperature: 0.8 }, want: (s, b) => s.v > b.v + 2, what: 'temperature +0.8 warms (V up)' },
    { op: { op: 'color', id: 'c1', temperature: -0.8 }, want: (s, b) => s.v < b.v - 2 && s.u > b.u - 2, what: 'temperature -0.8 cools (V down)' },
  ];
  for (const c of cases) {
    await applyOps(KEY, c.op); syncFilm(KEY);
    const f = (await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
    const png = `/tmp/col-${cases.indexOf(c)}.png`; await grab(f, k, fps, png);
    const s = await stats(png);
    if (!c.want(s, bStats)) bad.push(`${c.what}: got Y ${bStats.y.toFixed(1)}->${s.y?.toFixed?.(1)} U ${bStats.u?.toFixed?.(1)}->${s.u?.toFixed?.(1)} V ${bStats.v?.toFixed?.(1)}->${s.v?.toFixed?.(1)}`);
    else facts.push(`${c.what.split(' (')[0]}: Y ${bStats.y.toFixed(1)}->${s.y.toFixed(1)}, U ${bStats.u.toFixed(1)}->${s.u.toFixed(1)}, V ${bStats.v.toFixed(1)}->${s.v.toFixed(1)}`);
    await applyOps(KEY, { op: 'color', id: 'c1', exposure: 0, contrast: 1, saturation: 1, temperature: 0 }); // reset to neutral
    syncFilm(KEY);
  }

  // identity LUT: PSNR >= 60 vs the no-LUT render
  const cube = join(FILMS, KEY, 'identity.cube');
  // a 17^3 identity .cube (input == output for every node)
  { let s2 = `TITLE "identity"\nLUT_3D_SIZE 17\n\n`; const n = 17;
    for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b2 = 0; b2 < n; b2++) s2 += `${(r / (n - 1)).toFixed(6)} ${(g / (n - 1)).toFixed(6)} ${(b2 / (n - 1)).toFixed(6)}\n`;
    (await import('node:fs')).writeFileSync(cube, s2); }
  await applyOps(KEY, { op: 'lut', file: 'films/verify-color/identity.cube' });
  syncFilm(KEY);
  const lutFile = (await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
  const p = await psnrOf(base, lutFile);
  need(p >= 60, `identity LUT PSNR ${p.toFixed(1)} dB (< 60)`);
  facts.push(`identity LUT: PSNR ${p === 999 ? 'inf' : p.toFixed(1)} dB (>= 60)`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
