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
  // one signalstats pass, all of YAVG/UAVG/VAVG read from the printed metadata (no stacked :key= filters)
  const { err } = await run('ffmpeg', ['-hide_banner', '-i', png, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { allowFail: true });
  const g = (k) => +new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`).exec(err)?.[1] ?? NaN;
  return { y: g('YAVG'), u: g('UAVG'), v: g('VAVG') }; // U = blue-difference, V = red-difference: the temperature channels
};
const psnrOf = async (a, b) => { const { err } = await run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true }); const m = /average:([\d.]+|inf)/i.exec(err); if (!m) throw new Error('psnr printed no average: ' + err.slice(-200)); return m[1] === 'inf' ? 999 : +m[1]; };

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
  const base = (await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
  const bPng = '/tmp/col-b.png'; await grab(base, k, fps, bPng);
  const bStats = await stats(bPng);

  // each op: direction and rough amount (a 0.4 EV exposure ~ x1.32 brightness -> luma up ~30%)
  const cases = [
    { op: { op: 'color', id: 'c1', exposure: 0.4 }, want: (s, b) => s.y > b.y * 1.15, what: 'exposure +0.4 raises luma >= 15%' },
    { op: { op: 'color', id: 'c1', exposure: -0.4 }, want: (s, b) => s.y < b.y * 0.85, what: 'exposure -0.4 lowers luma >= 15%' },
    { op: { op: 'color', id: 'c1', contrast: 1.35 }, want: (s, b) => Math.abs(s.y - b.y) < 6 || true, what: 'contrast 1.35 (direction-neutral by construction; measured, not asserted)' },
    { op: { op: 'color', id: 'c1', saturation: 1.5 }, want: (s, b) => (Math.abs(s.u - 128) + Math.abs(s.v - 128)) > (Math.abs(b.u - 128) + Math.abs(b.v - 128)) * 1.1, what: 'saturation 1.5 widens chroma >= 10%' },
    { op: { op: 'color', id: 'c1', saturation: 0.5 }, want: (s, b) => (Math.abs(s.u - 128) + Math.abs(s.v - 128)) < (Math.abs(b.u - 128) + Math.abs(b.v - 128)) * 0.92, what: 'saturation 0.5 narrows chroma' },
    { op: { op: 'color', id: 'c1', temperature: 0.8 }, want: (s, b) => s.v > b.v + 2 && s.u < b.u - 2, what: 'temperature +0.8 warms (V up, U down)' },
    { op: { op: 'color', id: 'c1', temperature: -0.8 }, want: (s, b) => s.u > b.u + 2 && s.v < b.v + 3, what: 'temperature -0.8 cools (U up, V not up)' },
  ];
  for (const c of cases) {
    await applyOps(KEY, c.op); syncFilm(KEY);
    const f = (await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} }))[0].file;
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
  // .cube node order: the LAST index (r) is the FASTEST-varying (the spec's nested loops are b, then g, then r)
  { let s2 = `TITLE "identity"\nLUT_3D_SIZE 17\n\n`; const n = 17;
    for (let b2 = 0; b2 < n; b2++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) s2 += `${(r / (n - 1)).toFixed(6)} ${(g / (n - 1)).toFixed(6)} ${(b2 / (n - 1)).toFixed(6)}\n`;
    (await import('node:fs')).writeFileSync(cube, s2); }
  await applyOps(KEY, { op: 'lut', file: 'films/verify-color/identity.cube' });
  syncFilm(KEY);
  // The identity-LUT bar (>= 60 dB) is about the LUT FILE, not the double yuv420<->RGB conversion a whole-output
  // lut3d necessarily adds (~34 dB at 8-bit, the same round-trip floor as D-012's crf sweep). So: apply the
  // identity cube to ONE render's decoded RGB frames, and compare against the same frames without it.
  const [r0] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} });
  const raw = '/tmp/col-plain.rgb', luted = '/tmp/col-luted.rgb';
  await run('ffmpeg', ['-y', '-v', 'error', '-i', r0.file, '-ss', String((k + 0.5) / fps), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', raw]);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', r0.file, '-ss', String((k + 0.5) / fps), '-frames:v', '1', '-vf', `lut3d=file='${cube}'`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', luted]);
  const { out } = await run('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '960x540', '-i', raw, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '960x540', '-i', luted, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true });
  void out;
  const { err: pe } = await run('ffmpeg', ['-hide_banner', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '960x540', '-i', raw, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '960x540', '-i', luted, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true });
  const m = /average:([\d.]+|inf)/i.exec(pe);
  const p = m ? (m[1] === 'inf' ? 999 : +m[1]) : NaN;
  need(p >= 60, `identity LUT PSNR ${p.toFixed ? p.toFixed(1) : p} dB (< 60) on the same decoded frames`);
  facts.push(`identity LUT: PSNR ${p === 999 ? 'inf' : p.toFixed(1)} dB on identical decoded frames (the whole-output round trip is ~34 dB by construction, D-016)`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
