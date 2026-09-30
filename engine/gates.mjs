// Mechanical gates: things a script can prove, so the critic's eyes go to taste.
// Writes films/<key>/gates.json. A "fail" blocks the final render; a "warn" goes to the critic.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loudness } from './audio.mjs';
import { openStudio, readFilm, readJson, stillPng, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';

const BANNED = [
  [/Math\.random\s*\(/, 'Math.random: use rng(seed) or hash(n) from motion.js'],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'timers: time must come from seek(t) only'],
  [/requestAnimationFrame/, 'requestAnimationFrame: the runtime owns playback'],
  [/Date\.now\s*\(|new Date\s*\(|performance\.now\s*\(/, 'wall clock: frames must not depend on real time'],
  [/\btransition\s*:|@keyframes|\banimation\s*:/, 'CSS animation/transition: not seekable'],
  [/will-change/, 'will-change: blurs scaled text'],
];

// Film code: the film folder and its code subfolders (chapters/, lib/), never out/ assets/ refs/.
function codeFiles(dir, rel = '') {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return ['out', 'assets', 'refs', 'docs', 'node_modules'].includes(e.name) || e.name.startsWith('.') ? [] : codeFiles(dir, r);
    return /\.(html|js|mjs)$/.test(e.name) ? [r] : [];
  });
}

function lint(dir) {
  const hits = [];
  for (const f of codeFiles(dir)) {
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const [re, why] of BANNED) if (re.test(code)) hits.push(`${f}:${i + 1}  ${why}`);
    });
  }
  return hits;
}

const meanAbs = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);

export async function gates(key, { log = console.log } = {}) {
  const film = readFilm(key), cfg = film.cfg, D = cfg.duration, fmt = cfg.formats[0];
  const G = { maxStill: 1.5, maxNoNovelty: 4, ...(cfg.gates || {}) };
  const checks = [];
  const add = (name, pass, detail, level = 'fail') => { checks.push({ name, pass, level: pass ? 'pass' : level, detail }); log(`${pass ? 'PASS' : level.toUpperCase()}  ${name}: ${detail}`); };

  const lintHits = lint(film.dir);
  add('lint', lintHits.length === 0, lintHits.length ? lintHits.join('\n') : 'no timers, randomness, wall clock or CSS animation');

  const studio = await openStudio();
  try {
    // Determinism: same t, two pages, different seek histories → identical pixels.
    const a = await studio.page(film, fmt, 0.5), b = await studio.page(film, fmt, 0.5);
    const T = [0.11, 0.37, 0.73, 0.94].map((p) => +(p * D).toFixed(3));
    const ha = []; for (const t of T) ha.push(sha(await stillPng(a, t)));
    const hb = []; for (const t of [...T].reverse()) { await b.evaluate((x) => window.seek(x), D * 0.5); hb.unshift(sha(await stillPng(b, t))); }
    const bad = T.filter((_, i) => ha[i] !== hb[i]);
    add('determinism', bad.length === 0, bad.length ? `frames differ depending on seek history at ${bad.join(', ')}s: state is carried between frames` : `4 frames identical across seek orders`);
    await b.close();

    // Motion scan at 10 samples/s on a 64px signature.
    const step = 0.1, sigs = [], times = [];
    for (let t = 0; t < D; t += step) { times.push(+t.toFixed(2)); sigs.push(await a.evaluate(([t]) => window.__sig(t, 64), [t])); }
    const diffs = sigs.slice(1).map((s, i) => meanAbs(s, sigs[i]));

    // Dead time: runs where nothing moves.
    const still = [];
    let runStart = null;
    diffs.forEach((d, i) => {
      if (d < 0.25) { if (runStart === null) runStart = times[i]; }
      else { if (runStart !== null && times[i] - runStart >= G.maxStill) still.push([runStart, times[i]]); runStart = null; }
    });
    if (runStart !== null && D - runStart >= G.maxStill) still.push([runStart, D]);
    add('dead-time', still.length === 0, still.length ? `nothing moves during ${still.map(([x, y]) => `${x.toFixed(1)}-${y.toFixed(1)}s`).join(', ')}` : `something moves in every ${G.maxStill}s window`);

    // Novelty: a visual event = at least 2% of the frame changes noticeably within 0.5 s. Calibrated so
    // small UI moments on a dark frame count, while a slow drift or a settled hold does not.
    const frac = (x, y) => { let n = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 24) n++; return n / x.length; };
    const big = [0]; for (let i = 5; i < sigs.length; i++) if (frac(sigs[i], sigs[i - 5]) >= 0.02) big.push(times[i]); big.push(D);
    const gaps = []; for (let i = 1; i < big.length; i++) if (big[i] - big[i - 1] > G.maxNoNovelty) gaps.push([big[i - 1], big[i]]);
    add('novelty', gaps.length === 0, gaps.length ? `no big change during ${gaps.map(([x, y]) => `${x.toFixed(1)}-${y.toFixed(1)}s`).join(', ')}` : `a new visual event at least every ${G.maxNoNovelty}s`, 'warn');

    // Hook: frame 0 is not empty and the first 2 s change a lot.
    const f0 = sigs[0], move2 = Math.max(...sigs.slice(1, 21).map((s) => meanAbs(s, f0)));
    add('hook', std(f0) > 3 && move2 > 8, `first frame contrast ${std(f0).toFixed(1)} (want >3), max change in first 2s ${move2.toFixed(1)} (want >8)`, 'warn');

    // Blank frames (fades to flat color).
    const blanks = times.filter((_, i) => std(sigs[i]) < 1.5);
    add('blank-frames', blanks.length === 0, blanks.length ? `flat frames at ${blanks.slice(0, 8).join(', ')}s${blanks.length > 8 ? ' …' : ''}` : 'no flat frames', 'warn');

    // Loop seam: frame(D) must equal frame(0) and the frame before the seam must be close to it.
    if (cfg.loop) {
      const s0 = await a.evaluate(() => window.__sig(0, 64));
      const sD = await a.evaluate((d) => window.__sig(d, 64), D);
      const sPrev = await a.evaluate((d) => window.__sig(d, 64), D - 1 / cfg.fps);
      const seam = meanAbs(sD, s0), jump = meanAbs(sPrev, s0);
      add('loop-seam', seam < 1 && jump < 4, `frame(${D}) vs frame(0) differ by ${seam.toFixed(2)} (want <1); last frame → first ${jump.toFixed(2)} (want <4)`);
    }
    await a.close();
    if (studio.errors.length) add('runtime-errors', false, studio.errors.slice(0, 5).join('\n'));
  } finally { await studio.close(); }

  // Sound.
  const mixWav = join(film.out, 'mix.wav');
  if (existsSync(mixWav)) {
    const l = await loudness(mixWav);
    const want = film.cfg.mix?.lufs ?? -14;
    add('loudness', l.lufs !== null && Math.abs(l.lufs - want) <= 1 && (l.truePeak ?? 0) <= -0.5, `${l.lufs} LUFS (want ${want} ±1), true peak ${l.truePeak} dBFS`, 'warn');
  } else add('loudness', false, 'no out/mix.wav yet: run `studio sound <film>`', 'warn');
  const grid = readJson(join(film.dir, 'beats.json')), cues = readJson(join(film.dir, 'cues.json'), []);
  if (grid && cues.length) {
    const half = grid.beats.flatMap((b, i) => [b, grid.beats[i + 1] !== undefined ? (b + grid.beats[i + 1]) / 2 : b]);
    const hits = grid.hits || [];
    const off = cues.filter((c) => !c.free && ![...half, ...hits].some((b) => Math.abs(b - c.t) < 0.03));
    add('cue-sync', off.length === 0, off.length ? `${off.length} cues off the half-beat grid: ${off.slice(0, 6).map((c) => `${c.type}@${c.t}`).join(', ')} (mark intentional ones "free": true)` : `${cues.length} cues on the grid`, 'warn');
  }

  // Deliverable, if rendered.
  const finals = readdirSync(film.out).filter((f) => /^final-.*\.mp4$/.test(f) && !f.includes('.silent'));
  for (const f of finals) {
    const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,pix_fmt', '-of', 'json', join(film.out, f)]);
    const p = JSON.parse(out), dur = +p.format.duration;
    const hasAudio = p.streams.some((s) => s.codec_type === 'audio'), pix = p.streams.find((s) => s.codec_type === 'video')?.pix_fmt;
    add(`deliverable ${f}`, Math.abs(dur - D) < 0.1 && pix === 'yuv420p', `${dur.toFixed(2)}s, ${pix}, ${hasAudio ? 'with' : 'NO'} audio`, 'warn');
  }

  const result = { at: new Date().toISOString(), pass: checks.every((c) => c.level !== 'fail'), checks };
  writeJson(join(film.dir, 'gates.json'), result);
  return result;
}
