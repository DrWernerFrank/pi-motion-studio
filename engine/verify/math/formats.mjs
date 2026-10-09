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
import { FILMS, readJson, fmtSlug } from '../../lib/film.mjs';

const KEY = 'verify-m-fmt';
const FMTS = ['16:9', '9:16', '1:1', '4:5'];
// draft = half the final geometry, EVEN-rounded (math.mjs: 540x675 segfaults cairo/x264, so 4:5 is 540x674)
const DRAFT_PX = { '16:9': [960, 540], '9:16': [540, 960], '1:1': [540, 540], '4:5': [540, 674] };
// the text kinds the recorder emits (the kit's Txt/Eq subclass Text/MathTypst; `text: true` is the recorder's flag)
const isText = (o) => o.text === true || /^(Text|Txt|MarkupText|Paragraph)$/.test(o.kind);

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
        'stream=codec_type,width,height,pix_fmt,color_primaries,color_transfer,color_space,sample_aspect_ratio,avg_frame_rate,codec_name:format=duration', '-of', 'json', file]);
      const p = JSON.parse(out);
      const v = p.streams.find((s) => s.codec_type === 'video');
      if (!v) { bad.push(`${fmt}: no video stream`); continue; }
      const [W, H] = DRAFT_PX[fmt];
      const want = (k, val) => { if (v[k] !== val) bad.push(`${fmt}: ${k}=${v[k]}, wanted ${val}`); };
      want('width', W); want('height', H); want('pix_fmt', 'yuv420p');
      want('color_primaries', 'bt709'); want('color_transfer', 'bt709'); want('color_space', 'bt709');
      want('sample_aspect_ratio', '1:1');
      if (v.avg_frame_rate !== '30/1') bad.push(`${fmt}: fps ${v.avg_frame_rate}, wanted 30 (draft cap)`);
      // faststart: the moov atom before mdat
      const fd = readFileSync(file);
      const moov = fd.indexOf(Buffer.from('moov')), mdat = fd.indexOf(Buffer.from('mdat'));
      if (moov < 0 || (mdat >= 0 && moov > mdat)) bad.push(`${fmt}: not faststart (moov@${moov}, mdat@${mdat})`);
    }
    facts.push(FMTS.map((f) => DRAFT_PX[f].join('x')).join('/') + ' yuv420p bt709 SAR1:1 30/1 faststart');
    const durs = Object.values(durations).map((d) => +d.toFixed(2));
    if (new Set(durs).size !== 1) bad.push(`formats disagree on duration: ${JSON.stringify(durations)}`);
    else facts.push(`4 geometries, all tagged, durations equal (${durs[0]}s)`);

    // re-composition, not a scaled copy: the records' title-slot geometry differs by the portrait
    // RULE (safe fractions), not a scale — the 9:16 title's y is a different fraction of its frame.
    const titleY = (fmt) => {
      const rec = join(FILMS, KEY, 'records', fmtSlug(fmt), 's01_hook-layout.json');
      if (!existsSync(rec)) return null;
      const frames = readJson(rec, []);
      // the recorder stamps `role` on kit text (title/body/math/label/caption): the title slot is the proof
      for (const f of frames) { const objs = f.objects || [];
        const t = objs.find((o) => o.role === 'title') || objs.find(isText);
        if (t) return +(t.bbox[1] + t.bbox[3] / 2).toFixed(2); }
      return null;
    };
    const y16 = titleY('16:9'), y9 = titleY('9:16');
    if (y16 === null || y9 === null) bad.push('no Text object found in records for the re-composition proof');
    else {
      // 16:9 frame: 14.222x8 (centered: y from -4..4); 9:16: 8x14.222 (y from -7.111..7.111). Manim's y
      // points UP (D-008), so the fraction FROM THE TOP of the frame is (H/2 - y) / H — the title band
      // (0.08-0.30) and the safe-area rules are measured from the top.
      const frac16 = (4 - y16) / 8, frac9 = (64 / 9 - y9) / (128 / 9);
      facts.push(`title y: 16:9 ${frac16.toFixed(2)} vs 9:16 ${frac9.toFixed(2)} of frame height`);
      // same FRACTION would mean a scaled copy; the portrait rule (safe y 10% + title strip) puts
      // it at ~0.155 in portrait vs ~0.135 in landscape — close but derived from different rules;
      // assert they differ by more than nothing, and both sit inside their safe areas
      if (Math.abs(frac16 - frac9) < 1e-6) bad.push('portrait title sits at the landscape fraction: looks like a scaled copy, not a re-composition');
      if (frac9 < 0.08 || frac9 > 0.30) bad.push(`portrait title fraction ${frac9.toFixed(2)} outside the safe title band`);
    }
    // text >= 3.2u: every text object's NOMINAL size (the kit's role size, recorded as nominal_u) in all
    // four formats. A bbox height is not a type size (descenders, multi-line), so only nominal_u is judged.
    let minU = Infinity, nText = 0;
    for (const fmt of FMTS) for (const scene of ['s01_hook', 's02_meaning', 's03_recap']) {
      for (const f of readJson(join(FILMS, KEY, 'records', fmtSlug(fmt), `${scene}-layout.json`), [])) {
        for (const o of (f.objects || []).filter(isText)) {
          if (typeof o.nominal_u !== 'number') continue;
          nText++; minU = Math.min(minU, o.nominal_u);
          if (o.nominal_u < 3.2) bad.push(`${fmt} ${scene}: ${o.kind} ${o.id} at ${o.nominal_u}u < 3.2u`);
        }
      }
    }
    if (!nText) bad.push('no text object with nominal_u in any format\'s records (recorder schema)');
    else facts.push(`${nText} text snapshots, min nominal ${minU.toFixed(2)}u`);
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 600) : facts.join('; ') };
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
};
void homedir;
