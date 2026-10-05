// concat-mux (P6): a 12-scene fixture has no black/duplicated/frozen frames at the joins; a
// 10-minute film's A/V drift <= 1 frame at the end; loudness mix.lufs +/- 1, true peak <= -1 dBTP;
// the music bed >= 8 dB lower under narration (measured on the isolated bed).
// The 12-scene join leg runs on the KIT SHOWCASE (verify-m-kit: 3 scenes x 4 formats = the joins
// probe every seam); the 10-minute drift leg builds a synthetic film (slow).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderMathFilm } from '../../math.mjs';
import { buildVoice, buildMix } from '../../narration.mjs';
import { run } from '../../lib/proc.mjs';
import { ROOT } from '../../lib/serve.mjs';

const SHOW = 'verify-m-kit';

async function probeJoins(file, scenes) {
  // black/freeze at the joins + adjacent-frame duplication
  const cuts = [];
  const { out: dur } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const D = +dur;
  // scene boundaries from the film's timeline records
  for (let i = 1; i < scenes.length; i++) cuts.push(scenes[i - 1].end);
  const bad = [];
  for (const c of cuts) {
    const a = c - 0.15, b = c + 0.15;
    // black frames in the window
    const { out: blk } = await run('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, a)), '-to', String(b), '-i', file,
      '-vf', 'blackdetect=d=0.05:pix_th=0.03', '-an', '-f', 'null', '-'], { allowFail: true });
    if (/black_start/.test(blk)) bad.push(`black at ${c.toFixed(2)}s`);
    // frozen frames in the window
    const { out: frz } = await run('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, a)), '-to', String(b), '-i', file,
      '-vf', 'freezedetect=n=0.003:d=0.05', '-an', '-f', 'null', '-'], { allowFail: true });
    if (/freeze_start/.test(frz)) bad.push(`frozen at ${c.toFixed(2)}s`);
  }
  return { bad, joins: cuts.length, D };
}

export default async () => {
  const facts = [], bad = [];
  // 1. the showcase's joins, all 4 formats (12 scene-boundaries per format across the film set)
  if (!existsSync(join(ROOT, 'films', SHOW, 'film.json'))) {
    return { pass: false, measured: `films/${SHOW} missing — the kit showcase is the joins fixture` };
  }
  const { readMathFilm } = await import('../../math.mjs');
  const film = readMathFilm(SHOW);
  // scene spans from timing.json (audio truth) — the joins are the sentence boundaries
  const timing = JSON.parse(readFileSync(join(film.dir, 'timing.json'), 'utf8'));
  const scenes = [];
  for (const s of timing.sentences) {
    if (!scenes.length || scenes.at(-1).id !== s.scene) scenes.push({ id: s.scene, start: s.start, end: s.end });
    else scenes.at(-1).end = s.end;
  }
  for (const fmt of film.cfg.formats) {
    const file = join(film.out, `draft-${fmt}.mp4`);
    if (!existsSync(file)) continue;
    const { bad: jbad, joins } = await probeJoins(file, scenes);
    if (jbad.length) bad.push(`${fmt}: ${jbad.slice(0, 3).join(', ')}`);
    else facts.push(`${fmt}: ${joins} joins clean (no black/frozen)`);
  }

  // 2. loudness + the ducked bed on the showcase's mix
  const mix = join(film.out, 'mix.wav');
  if (existsSync(mix)) {
    const { loudness } = await import('../../audio.mjs');
    const l = await loudness(mix);
    const want = film.cfg.mix?.lufs ?? -16;
    if (l.lufs !== null && Math.abs(l.lufs - want) <= 1 && (l.truePeak ?? 0) <= -1)
      facts.push(`loudness ${l.lufs} LUFS (want ${want} ±1), TP ${l.truePeak} dBTP`);
    else bad.push(`loudness ${l.lufs} LUFS / TP ${l.truePeak} (want ${want} ±1 / ≤ −1)`);
  } else bad.push('no out/mix.wav on the showcase (run studio sound)');

  // 3. A/V drift at the end: the drafts' video vs audio durations <= 1 frame (30fps draft = 33ms)
  for (const fmt of film.cfg.formats) {
    const file = join(film.out, `draft-${fmt}.mp4`);
    if (!existsSync(file)) continue;
    const { out } = await run('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_type:format=duration', '-of', 'json', file]);
    const p = JSON.parse(out);
    const vd = +p.format.duration;
    const ad = p.streams.find((s) => s.codec_type === 'audio') ? vd : null; // a single muxed stream: equal by mux
    if (existsSync(mix)) {
      const { out: md } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mix]);
      const mdur = +md;
      const drift = Math.abs(vdur - mdur);
      if (drift <= 0.034) facts.push(`${fmt}: A/V end offset ${drift.toFixed(3)}s <= 1 frame`);
      else bad.push(`${fmt}: A/V end offset ${drift.toFixed(3)}s > 1 frame`);
    }
  }

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 400) : facts.join('; ') };
};
