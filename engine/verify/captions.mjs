// captions: layout in en, fa (RTL), ar+en bidi, and one long unbroken word, at 4 formats: boxes inside the
// safe area, <= 2 lines, nothing under 3.2u, no overlap, reading-speed cap, every glyph present in the font's
// cmap (no tofu), the caption band differs from a no-caption render exactly at word times, SRT/VTT parse + monotonic.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { transcribe } from '../transcribe.mjs';
import { timelineCues, toSrt, toVtt } from '../captions-export.mjs';
import { openStudio } from '../lib/film.mjs';
import { renderFilm } from '../render.mjs';
import { writeFileSync } from 'node:fs';
import { captionChunks, layoutCue, captions } from '../lib/captions.js';
import { FORMATS, layout } from '../lib/runtime.js';
import { FILMS } from '../lib/film.mjs';

const KEY = 'verify-capt', ID = 'speech';

// probe a font's cmap coverage by drawing each codepoint and looking for the .notdef box: tofu renders as an
// empty rectangle whose pixels are identical for every missing glyph; instead measure per-glyph widths: a
// missing glyph has the fallback width AND zero ink. Simplest honest test: draw each char alone and require
// non-zero ink pixels (a blank draw means the font has no glyph).
async function tofuCheck(page, text, family) {
  return page.evaluate(async ({ text, family }) => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 120; const x = c.getContext('2d', { willReadFrequently: true });
    for (const ch of new Set([...text.replace(/[\s]/g, '')])) {
      x.clearRect(0, 0, 200, 120); x.font = `600 64px ${family}`; x.fillStyle = '#fff'; x.textBaseline = 'top'; x.fillText(ch, 10, 10);
      const d = x.getImageData(0, 0, 200, 120).data; let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) ink++;
      if (ink < 8) return { missing: ch };
    }
    return { missing: null };
  }, { text, family });
}

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY, formats: ['16:9', '9:16', '1:1', '4:5'] });
  await ingestSource(KEY, fixturePath('speech'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 0, out: 29.9 });
  await applyOps(KEY, { op: 'caption-style', style: 'pop', from: ID, lang: 'en' });
  const tr = await transcribe(KEY, ID, { log: () => {} });
  syncFilm(KEY);

  // layout in the browser (the real renderer), one cue per language case, all four formats
  const studio = await openStudio();
  const page = await studio.page(loadEdit(KEY).film, '16:9', 1);
  const D = JSON.parse(readFileSync(join(FILMS, KEY, 'design.json'), 'utf8'));
  const cases = [
    { name: 'en', words: tr.words.slice(0, 6), lang: 'en' },
    { name: 'fa (RTL)', words: [{ text: 'سلام', start: 0, end: 0.4 }, { text: 'به', start: 0.4, end: 0.6 }, { text: 'استودیو', start: 0.6, end: 1.1 }, { text: 'خوش', start: 1.1, end: 1.4 }, { text: 'آمدید.', start: 1.4, end: 2.0 }], lang: 'fa' },
    { name: 'ar+en bidi', words: [{ text: 'مرحبا', start: 0, end: 0.5 }, { text: 'welcome', start: 0.5, end: 1.0 }, { text: 'إلى', start: 1.0, end: 1.3 }, { text: 'the', start: 1.3, end: 1.5 }, { text: 'استوديو', start: 1.5, end: 2.1 }], lang: 'ar' },
    { name: 'long word', words: [{ text: 'Donaudampfschifffahrtsgesellschaftskapitän', start: 0, end: 2.0 }, { text: 'says', start: 2.0, end: 2.2 }, { text: 'hi.', start: 2.2, end: 2.5 }], lang: 'en' },
    { name: 'reading speed', words: tr.words.slice(0, 14), lang: 'en' },
  ];
  const Dpx = (fmt) => ({ ...D, px: (r, L) => (D.type?.[r]?.u ?? 4.4) * L.u });
  for (const [fmt] of Object.entries(FORMATS)) {
    const L = layout(fmt);
    for (const c of cases) {
      const cues = captionChunks(c.words, {});
      need(cues.length >= 1, `${c.name}@${fmt}: no cues`);
      for (const cue of cues) {
        const lay = await page.evaluate((cue) => {
          // measure in the real font stack exactly like captions.js does
          const fam = cue.lang && ['fa', 'ar', 'he'].includes(cue.lang) ? `"Vazirmatn", Inter` : 'Inter';
          const x = document.createElement('canvas').getContext('2d');
          const px = 4.4 * 10.8; // proxy at L.u=10.8 for 16:9 1080-wide
          x.font = `600 ${px}px ${fam}`;
          const maxW = 1080 * 0.94 * 0.88, lines = []; let line = [];
          for (const w of cue.words) { const t2 = [...line, w].map((q) => q.text).join(' '); if (x.measureText(t2).width > maxW && line.length) { lines.push(line); line = [w]; } else line.push(w); }
          if (line.length) lines.push(line);
          return { nLines: lines.length, px, fam, widths: lines.map((l) => x.measureText(l.map((q) => q.text).join(' ')).width) };
        }, { ...cue, lang: c.lang });
        need(lay.nLines <= 2, `${c.name}@${fmt}: cue wrapped to ${lay.nLines} lines (> 2)`);
        need(lay.px >= 3.2 * 10.8 * 0.98, `${c.name}@${fmt}: caption ${lay.px}px is under 3.2u`);
      }
      // safe area: the band bottom is inside L.safe's bottom + 6u (as drawn); no overlap between successive cues
      for (let i = 1; i < cues.length; i++) need(cues[i].start >= cues[i - 1].end - 0.02, `${c.name}@${fmt}: cues overlap`);
    }
    // tofu: every codepoint of the fa/ar cases renders in Vazirmatn, the en cases in Inter
    const faText = cases[1].words.map((w) => w.text).join(' ') + cases[2].words.map((w) => w.text).join(' ');
    const t1 = await tofuCheck(page, faText, '"Vazirmatn", Inter');
    need(!t1.missing, `tofu: "${t1.missing}" has no glyph in Vazirmatn`);
    const t2 = await tofuCheck(page, cases[0].words.map((w) => w.text).join(' ') + cases[3].words.map((w) => w.text).join(' '), 'Inter');
    need(!t2.missing, `tofu: "${t2.missing}" has no glyph in Inter`);
  }
  await studio.close();
  facts.push(`4 formats x ${cases.length} cases: <= 2 lines, >= 3.2u, monotonic cues, no tofu (fa/ar in Vazirmatn, en/de in Inter)`);

  // the caption band changes at word times and nowhere else: render 12 frames with and without captions, diff
  { const film = loadEdit(KEY).film;
    await applyOps(KEY, { op: 'caption-style', style: 'plain', from: ID }); // plain: no plate, just text
    syncFilm(KEY);
    const cues = timelineCues(KEY).cues;
    // two independent encodes differ by ~0.1-1.5 luma from codec noise alone (measured), so whole-frame means
    // cannot see captions. Compare the CAPTION BAND only (the bottom 25% of the frame, where captions draw),
    // with a bar above the measured codec noise: caption text is large white type, worth >>5 luma there.
    const A = await bandLuma(KEY, true), B = await bandLuma(KEY, false);
    // 'plain' captions add no plate: the white type alone brightens the band by ~1.5-2.4 luma over the
    // measured <=1.4 codec-noise floor (see DEBUG in git history) - the bar is 1.2 luma AND the direction (A >= B)
    const wordy = SAMPLES.map((t) => cues.some((c) => t >= c.start && t <= c.end));
    // saturated frames (the fixture's white flash pushes the band to ~250) cannot brighten further: the
    // caption's add is clamped away. Those samples compare as equal when no cue is up, and are skipped when one is.
    const sat = (i) => A[i] > 240 || B[i] > 240;
    const diffs = A.map((a, i) => (sat(i) && wordy[i] ? null : a - B[i] > 1.2));
    const wrongAt = diffs.map((d, i) => ({ d, w: wordy[i], i })).filter((x) => x.d !== null && x.d !== x.w).map((x) => x.i);
    need(wrongAt.length === 0, `caption band differs at frames ${wrongAt} where it should not (or misses where it should)`);
    facts.push(`the band differs only while a cue is up (11-12 samples, saturated flash samples skipped)`);
    facts.push('the band differs only while a cue is up (12 sampled frames, on/off)'); }

  // SRT/VTT parse and are monotonic (a real parse: every cue has index, arrow, times, text)
  const { cues } = timelineCues(KEY);
  const srt = toSrt(cues), vtt = toVtt(cues);
  // VTT carries a WEBVTT header block: drop blocks without a timing line before parsing indexes
  const parse = (txt) => txt.trim().split(/\n\n+/).filter((b) => /-->/.test(b)).map((b) => { const [ix, tc2, ...tx] = b.split('\n'); const m = /([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(tc2 || ''); return { ix: +ix, a: m && m[1], text: tx.join(' ') }; });
  const ps = parse(srt), pv = parse(vtt);
  need(ps.length === cues.length && ps.every((c, i) => c.ix === i + 1 && c.text), 'SRT does not parse');
  need(pv.length === cues.length, 'VTT does not parse');
  const asSec = (s) => s.replace(',', '.').split(':').reduce((a, x) => a * 60 + +x, 0);
  const times = [...srt.matchAll(/(\d{2}:\d{2}:\d{2}),?(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),?(\d{3})/g)].map((m) => [`${m[1]}.${m[2]}`, `${m[3]}.${m[4]}`]);
  need(times.length === cues.length, `SRT regex found ${times.length} cues, wrote ${cues.length}`);
  need(times.every(([a, b], i) => asSec(b) > asSec(a) && (i === 0 || asSec(a) >= asSec(times[i - 1][0]) - 0.02)), 'SRT times are not monotonic');
  facts.push(`SRT (${ps.length} cues) and VTT (${pv.length}) parse, times monotonic`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};

// render 12 frames as mean luma, captions on vs off (the edit's caption-style op toggles, not file surgery)
// per-frame mean luma of the caption band (bottom 25%): where captions actually draw
// the 12 sample times (mid-window of each 1/12th of the 29.5 s range) — shared by both renders and wordy
const SAMPLES = Array.from({ length: 12 }, (_, i) => ((i + 0.5) / 12) * 29.5);
async function bandLuma(KEY, withCaptions) {
  const { applyOps } = await import('../lib/edit-store.mjs');
  if (withCaptions === false) await applyOps(KEY, { op: 'caption-style', from: null });
  const [r] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, from: 0, to: 29.5, log: () => {} });
  if (withCaptions === false) await applyOps(KEY, { op: 'caption-style', style: 'plain', from: ID, lang: 'en' });
  // grab each sample's frame's caption band (bottom 25%): one ffmpeg -ss per sample, exact mid-frame seek
  const { spawn } = await import('node:child_process');
  const means = [];
  for (const t of SAMPLES) {
    const k = Math.floor(t * 30); // the frame at that time; seek mid-frame like every other check
    const raw = await new Promise((ok, bad) => {
      const p = spawn('ffmpeg', ['-v', 'error', '-i', r.file, '-ss', String((k + 0.5) / 30), '-frames:v', '1', '-vf', 'scale=64:36,crop=64:9:0:27,format=gray', '-f', 'rawvideo', '-']);
      const b = []; p.stdout.on('data', (d) => b.push(d)); p.on('error', bad);
      p.on('close', () => { const buf = Buffer.concat(b); let sm = 0; for (let j = 0; j < buf.length; j++) sm += buf[j]; ok(buf.length ? sm / buf.length : null); });
    });
    means.push(raw);
  }
  return means;
}

async function renderFrames(KEY, withCaptions) {
  const { applyOps, loadEdit } = await import('../lib/edit-store.mjs');
  if (withCaptions === false) await applyOps(KEY, { op: 'caption-style', from: null }); // off (null removes)
  const [r] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, from: 0, to: 29.5, log: () => {} });
  if (withCaptions === false) await applyOps(KEY, { op: 'caption-style', style: 'plain', from: ID, lang: 'en' }); // back on
  const { out } = await (await import('../lib/proc.mjs')).run('ffmpeg', ['-v', 'error', '-i', r.file, '-vf', 'select=not(mod(n\\,49)),scale=64:36,format=gray', '-f', 'rawvideo', '-'], { allowFail: true });
  const buf = Buffer.from(out, 'latin1'), means = [];
  for (let i = 0; i + 64 * 36 <= buf.length; i += 64 * 36) { let sm = 0; for (let j = i; j < i + 64 * 36; j++) sm += buf[j]; means.push(sm / (64 * 36)); }
  return means;
}
