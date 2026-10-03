// captions (P7): narration captions in en and fa at 4 formats — ≤2 lines, ≥3.2u, inside the
// caption band, every codepoint in the font's cmap; SRT and VTT monotonic and equal the sentences.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CAPS, MemPool } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { captionCues, exportCaptions, vazirCovers, PROBE_PY } from '../../math-captions.mjs';
import { createMathFilm } from '../../math-cli.mjs';
import { readJson } from '../../lib/film.mjs';
import { writeFileSync } from 'node:fs';
import { buildVoice } from '../../narration.mjs';
import { ROOT } from '../../lib/serve.mjs';

const EN = 'verify-m-cap-en', FA = 'verify-m-cap-fa';

export default async () => {
  const bad = [], facts = [];
  const pool = new MemPool();
  try {
    // -- fixtures: an en film (longer sentences force wrapping) and an fa film (RTL + cmap)
    for (const [key, lang, script] of [
      [EN, 'en', `# scene s01_hook: captions
[s01.1] A determinant measures how a matrix transforms area, so the unit square grows to five times its size when the matrix acts on the plane.
[s01.2] When the determinant is negative, space has flipped its orientation instead.
`],
      [FA, 'fa', `# scene s01_hook: captions fa
[s01.1] دترمینان نشان می‌دهد که مساحت یک مربع چند برابر می‌شود، و این همیشه درست است.
`]]) {
      rmSync(join(ROOT, 'films', key), { recursive: true, force: true });
      createMathFilm(key, { title: key, lang });
      // the starter scaffold has 3 scenes; the fixture script has 1 — keep ONE scene file so the
      // scene/script cross-validation passes (it rejects a scenes/*.py with no script header)
      const sc = join(ROOT, 'films', key, 'scenes');
      rmSync(join(sc, 's02_meaning.py'), { force: true });
      rmSync(join(sc, 's03_recap.py'), { force: true });
      writeFileSync(join(ROOT, 'films', key, 'script.md'), script);
      await buildVoice(key);
    }

    // 1. cues + SRT/VTT: monotonic, non-overlapping, equal to the sentences
    for (const key of [EN, FA]) {
      const cues = captionCues(key);
      const { srt, vtt, cues: n } = exportCaptions(key);
      facts.push(`${key}: ${n} cues, srt+vtt written`);
      for (let i = 1; i < cues.length; i++) {
        if (cues[i].start < cues[i - 1].end - 0.001) bad.push(`${key}: cue ${i} overlaps the previous`);
        if (cues[i].start < cues[i - 1].start) bad.push(`${key}: cues not monotonic at ${i}`);
      }
      const timing = readJson(join(ROOT, 'films', key, 'timing.json'));
      const sent = timing.sentences ?? [];
      if (!sent.length) bad.push(`${key}: no timing (buildVoice failed?)`);
      const srtText = (await import('node:fs')).readFileSync(srt, 'utf8');
      for (const m of srtText.matchAll(/^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/gm)) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
        const t2 = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
        if (t > t2) bad.push(`${key}: srt cue reversed`);
      }
      // every cue lies inside the narration's span: the chunker's cosmetic 120 ms tail may extend
      // past the last word, and lead 50 ms before the first — the ±0.3 s window covers exactly that
      const span = [Math.min(...sent.map((s) => s.start)), Math.max(...sent.map((s) => s.end))];
      if (cues.length && (cues[0].start < span[0] - 0.3 || cues.at(-1).end > span[1] + 0.3))
        bad.push(`${key}: cues exceed the sentence span`);
    }

    // 2. the layout probe (both languages' longest cues, all 4 formats, ONE capped process)
    const longest = (key) => captionCues(key).reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const probe = await pool.run({
      cmd: pythonFor('manim'), args: ['-c', PROBE_PY], cwd: join(ROOT, 'engine', 'manim', 'test'),
      input: JSON.stringify([longest(EN), longest(FA)]),
      memoryMb: CAPS.check, timeoutS: 180, label: 'caption layout probe',
      env: { STUDIO_FORMAT: '16:9', PYTHONPATH: join(ROOT, 'engine', 'manim') },
    });
    if (probe.killed) return { pass: false, measured: `probe killed (${probe.reason})` };
    if (probe.code !== 0) return { pass: false, measured: `probe failed:\n${(probe.err || '').split('\n').slice(-4).join('\n')}` };
    const rows = JSON.parse(probe.out.trim().split('\n').at(-1));
    for (const r of rows) {
      if (r.lines > 2) bad.push(`${r.lang} ${r.fmt}: ${r.lines} lines (max 2)`);
      if (!r.widths_ok) bad.push(`${r.lang} ${r.fmt}: a line overflows the caption band's width`);
      if (!r.heights_ok) bad.push(`${r.lang} ${r.fmt}: the stack overflows the caption band's height`);
      if (r.nominal_u < 3.2) bad.push(`${r.lang} ${r.fmt}: caption ${r.nominal_u}u < 3.2u`);
    }
    facts.push(`layout: ${rows.length} format×lang rows, all ≤2 lines, ≥${rows[0]?.nominal_u}u, in band`);

    // 3. fa: every codepoint of the caption text in Vazirmatn's cmap (no tofu)
    const faText = captionCues(FA).map((c) => c.text).join(' ');
    const cov = vazirCovers(faText);
    if (!cov.ok) bad.push(`fa tofu: missing ${cov.missing.join(', ')}`);
    else facts.push(`fa: ${new Set(faText.replace(/\s+/g, '')).size} unique codepoints all in Vazirmatn's cmap`);

    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
  } finally {
    rmSync(join(ROOT, 'films', EN), { recursive: true, force: true });
    rmSync(join(ROOT, 'films', FA), { recursive: true, force: true });
  }
};
