// formats: 9:16, 1:1, 16:9, 4:5 from ONE edit: exact WxH, yuv420p, bt709 tags, SAR 1:1, AAC 48 kHz, +faststart,
// duration = the timeline +- 1 frame. One timeline, four geometries, one encode each.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { buildDialog, mixEdit } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { timelineFrames } from '../lib/edit-ops.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-fmts', ID = 'cam';
const probe = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f])).out);

export default async ({ quick } = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: '30000/1001', title: KEY, formats: ['9:16', '1:1', '16:9', '4:5'] });
  await ingestSource(KEY, fixturePath('real-talking-head'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 5, out: 14 });
  await applyOps(KEY, { op: 'add', src: ID, in: 20, out: 26 });
  syncFilm(KEY);
  await buildDialog(KEY, { log: () => {} }); await mixEdit(KEY);
  const edit = loadEdit(KEY).edit, frames = timelineFrames(edit), fps = readFilm(KEY).fps;

  const q = quick ? 'draft' : 'final';
  for (const fmt of ['9:16', '1:1', '16:9', '4:5']) {
    const [r] = await renderFilm(KEY, { quality: q, fmt, workers: 2, log: () => {} });
    const p = await probe(r.file), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
    const [W, H] = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350] }[fmt];
    const scale = q === 'draft' ? 0.5 : 1;
    need(v.width === W * scale && v.height === H * scale, `${fmt}: ${v.width}x${v.height}, wanted ${W * scale}x${H * scale}`);
    need(v.pix_fmt === 'yuv420p' && v.color_space === 'bt709' && v.color_primaries === 'bt709' && v.color_transfer === 'bt709', `${fmt}: ${v.pix_fmt} ${v.color_space}/${v.color_primaries}/${v.color_transfer}`);
    need((v.sample_aspect_ratio || '0:1') === '1:1', `${fmt}: SAR ${v.sample_aspect_ratio}`);
    need(a && a.sample_rate === '48000' && a.codec_name === 'aac', `${fmt}: audio ${a?.codec_name} ${a?.sample_rate}`);
    const durF = Number(p.format.duration) * fps.value;
    need(Math.abs(durF - frames) <= 1.02, `${fmt}: duration ${p.format.duration}s = ${durF.toFixed(2)} frames, wanted ${frames} (+- 1)`);
    need(Math.abs(+v.nb_frames - frames) <= 1, `${fmt}: ${v.nb_frames} frames, wanted ${frames}`);
    need((p.format.tags?.major_brand || '') !== '' || /mp4/.test(p.format.format_name), `${fmt}: not an mp4`);
    // faststart: the moov sits at the front (a streaming-friendly file)
    const { out: head } = await run('head', ['-c', '64', r.file], { allowFail: true }).catch(() => ({ out: '' }));
    void head;
    const hasMoovEarly = await (async () => { const { out: hex } = await run('xxd', ['-l', '2048', r.file], { allowFail: true }).catch(() => ({ out: '' })); return /moov/.test(hex.slice(0, 400)) || /moov/.test(hex.slice(-400)); })();
    need(hasMoovEarly, `${fmt}: moov not at the head (faststart)`);
    facts.push(`${fmt} ${v.width}x${v.height} ${v.nb_frames}f ${v.color_space}/${v.color_transfer} AAC48k`);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
