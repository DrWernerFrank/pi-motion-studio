// rational-fps: NTSC rates are exact end to end. A 30000/1001 and a 24000/1001 edit: the frame count is exactly
// the planned count (not rounded floats), the deliverable's A/V durations differ by <= 2 ms, and muxing keeps the rate.
import { join } from 'node:path';
import { run } from '../lib/proc.mjs';
import { cutEdit } from './_editslice.mjs';
import { buildDialog, mixEdit } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { parseFps } from '../lib/frames.mjs';

const probe = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f])).out);

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  for (const [id, rate, cuts, cutLen, gap] of [['ntsc-1', '30000/1001', 12, 25, 20], ['ntsc-2', '24000/1001', 10, 12, 15]]) {
    const { film, plan } = await cutEdit(`verify-rf-${id}`, 'sync', { fps: rate, cuts, cutLen, gap });
    const frames = plan.reduce((a, p) => a + p.frames, 0), F = parseFps(rate);
    need(Math.abs(film.cfg.duration - frames / F.value) < 1e-6,
      `${rate}: film.json duration ${film.cfg.duration}s is not exactly ${frames} frames (${(frames / F.value).toFixed(6)}s)`);
    const d = await buildDialog(`verify-rf-${id}`, { log: () => {} });
    await mixEdit(`verify-rf-${id}`);
    const [r] = await renderFilm(`verify-rf-${id}`, { quality: 'final', fmt: '16:9', workers: 2, log: () => {} });
    const p = await probe(r.file), v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
    need(v.r_frame_rate === F.str && v.avg_frame_rate === F.str, `${rate}: stream rate ${v.r_frame_rate}/${v.avg_frame_rate} is not ${F.str}`);
    need(+v.nb_frames === frames, `${rate}: ${v.nb_frames} frames rendered, ${frames} planned`);
    const av = Math.abs(+v.duration - +a.duration) * 1000;
    need(av <= 2, `${rate}: A/V durations differ by ${av.toFixed(2)} ms (video ${v.duration}, audio ${a.duration})`);
    need(Math.abs(+p.format.duration - frames / F.value) < 0.01, `${rate}: container duration ${p.format.duration}`);
    const dd = (d.samples / 48000) * 1000 - (frames / F.value) * 1000; // dialog.wav must be exactly the timeline length
    need(Math.abs(dd) <= 1, `${rate}: dialog.wav length is ${dd.toFixed(2)} ms off the timeline`);
    facts.push(`${rate}: ${frames} frames exact, A/V within ${av.toFixed(2)} ms, dialog ${d.samples} samples`);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
