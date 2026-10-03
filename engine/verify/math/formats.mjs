// formats (P2): one scene source in 16:9/9:16/1:1/4:5 — exact WxH, yuv420p, bt709 tags, SAR 1:1,
// faststart, fps, duration; and the vertical layout is a RE-COMPOSITION (different panel geometry
// by the layout rule), not a scaled copy: the same scene's records show different object geometry
// per format (title y differs by the portrait rule, not by a scale factor).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderMathFilm } from '../../math.mjs';
import { createMathFilm } from '../../math-cli.mjs';
import { run } from '../../lib/proc.mjs';
import { FILMS, readJson } from '../../lib/film.mjs';

const KEY = 'verify-m-fmt';
const FMTS = ['16:9', '9:16', '1:1', '4:5'];
const DRAFT_PX = { '16:9': [960, 540], '9:16': [540, 960], '1:1': [540, 540], '4:5': [540, 675] };

export default async () => {
  const bad = [], facts = [];
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  createMathFilm(KEY, { title: 'formats fixture' });
  try {
    const durations = {};
    for (const fmt of FMTS) {
      const r = await renderMathFilm(KEY, { quality: 'draft', fmt });
      const file = r[0].file;
      durations[fmt] = r[0].seconds;
      const { out } = await run('ffprobe', ['-v', 'error', '-show_entries',
        'stream=width,height,pix_fmt,color_primaries,color_transfer,color_space,sample_aspect_ratio,avg_frame_rate,codec_name:format=duration', '-of', 'json', file]);
      const p = JSON.parse(out);
      const v = p.streams.find((s) => s.codec_type === undefined || s.codec_type === 'video') || p.streams[0];
      const [W, H] = DRAFT_PX[fmt];
      const want = (k, val) => { if (v[k] !== val) bad.push(`${fmt}: ${k}=${v[k]}, wanted ${val}`); };
      want('width', W); want('height', H); want('pix_fmt', 'yuv420p');
      want('color_primaries', 'bt709'); want('color_transfer', 'bt709'); want('color_space', 'bt709');
      want('sample_aspect_ratio', '1:1');
      if (!/30/.test(v.avg_frame_rate)) bad.push(`${fmt}: fps ${v.avg_frame_rate}, wanted 30 (draft cap)`);
      // faststart: the moov atom before mdat
      const fd = readFileSync(file);
      const moov = fd.indexOf(Buffer.from('moov')), mdat = fd.indexOf(Buffer.from('mdat'));
      if (moov < 0 || (mdat >= 0 && moov > mdat)) bad.push(`${fmt}: not faststart (moov@${moov}, mdat@${mdat})`);
    }
    const durs = Object.values(durations).map((d) => +d.toFixed(2));
    if (new Set(durs).size !== 1) bad.push(`formats disagree on duration: ${JSON.stringify(durations)}`);
    else facts.push(`4 geometries, all tagged, durations equal (${durs[0]}s)`);

    // re-composition, not a scaled copy: the records' title-slot geometry differs by the portrait
    // RULE (safe fractions), not a scale — the 9:16 title's y is a different fraction of its frame.
    const titleY = (fmt) => {
      const rec = join(FILMS, KEY, 'records', fmt, 's01_hook-layout.json');
      if (!existsSync(rec)) return null;
      const frames = readJson(rec, []);
      for (const f of frames) { const t = f.objects.find((o) => o.kind === 'Text');
        if (t) return +(t.bbox[1] + t.bbox[3] / 2).toFixed(2); }
      return null;
    };
    const y16 = titleY('16:9'), y9 = titleY('9:16');
    if (y16 === null || y9 === null) bad.push('no Text object found in records for the re-composition proof');
    else {
      // 16:9 frame: 14.222x8 (centered: y from -4..4); 9:16: 8x14.222 (y from -7.111..7.111)
      const frac16 = (y16 + 4) / 8, frac9 = (y9 + 7.111) / 14.222;
      facts.push(`title y: 16:9 ${frac16.toFixed(2)} vs 9:16 ${frac9.toFixed(2)} of frame height`);
      // same FRACTION would mean a scaled copy; the portrait rule (safe y 10% + title strip) puts
      // it at ~0.155 in portrait vs ~0.135 in landscape — close but derived from different rules;
      // assert they differ by more than nothing, and both sit inside their safe areas
      if (Math.abs(frac16 - frac9) < 1e-6) bad.push('portrait title sits at the landscape fraction: looks like a scaled copy, not a re-composition');
      if (frac9 < 0.08 || frac9 > 0.30) bad.push(`portrait title fraction ${frac9.toFixed(2)} outside the safe title band`);
    }
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 600) : facts.join('; ') };
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
};
void homedir;
