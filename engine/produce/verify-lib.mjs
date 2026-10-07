// The verifier library (K5): every measurable requirement resolves to a measurement on the actual
// deliverables (ffprobe/ffmpeg/ASR — never a guess). Each verifier: (req, { key, finals }) ->
// { status, evidence, measured }. Seeded bad media must FAIL with a message that names the
// measured value; no finals to measure is a loud red, never a silent green.
//
// Capturing ffmpeg's output: execFileSync returns ONLY stdout (its stderr goes to our stderr),
// so every measurement goes through ff() below — spawnSync with both pipes, non-zero is a throw.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FILMS, readJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

const ff = (args, { timeout = 5 * 60 * 1000 } = {}) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} → exit ${r.status}: ${(r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' | ')}`);
  return { out: r.stdout || '', err: r.stderr || '' };
};

const ffprobe = (file, args) => {
  const r = spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${(r.stderr || '').split('\n').filter(Boolean).slice(-1)}`);
  return JSON.parse(r.stdout);
};

/** The project's video deliverables: out/final-<fmt>.mp4 for every asked format (16x9 slugs). */
export function finalsOf(key, { formats } = {}) {
  const out = join(FILMS, key, 'out');
  if (!existsSync(out)) return [];
  const want = (formats || readJson(join(FILMS, key, 'film.json'), {}).formats || []).map((f) => f.replace(':', 'x'));
  const files = readdirSync(out).filter((f) => /^final-[\w-]+\.mp4$/.test(f));
  return want.map((f) => join(out, `final-${f}.mp4`)).filter(existsSync).concat(
    files.filter((f) => !want.some((w) => f === `final-${w}.mp4`)).map((f) => join(out, f)));
}

const probeVideo = (file) => {
  const j = ffprobe(file, ['-show_entries', 'stream=codec_type,width,height,pix_fmt,sample_aspect_ratio:format=duration', '-select_streams', 'v']);
  return { v: (j.streams || [])[0], duration: +j.format.duration };
};

const loudnessOf = (file) => {   // ebur128 via loudnorm print_format=json: integrated LUFS + true peak
  const { err } = ff(['-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { timeout: 10 * 60 * 1000 });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(err);   // the loudnorm JSON block lands on stderr
  if (!m) throw new Error(`loudnorm produced no JSON for ${file.split('/').pop()}`);
  const j = JSON.parse(m[0]);
  return { lufs: +j.input_i, tp: +j.input_tp, raw: `${j.input_i} LUFS / ${j.input_tp} dBTP` };
};

// A verifier with nothing to measure is a loud red — never a green over zero files.
const pick = (ctx) => ctx.finals || finalsOf(ctx.key);
const NO_FINALS = (ctx, name) => ({
  status: 'red',
  evidence: `no finals under films/${ctx.key}/out/ — the "${name}" verifier has nothing to measure (build the deliverable first)`,
  measured: 'none',
});

// ── the verifiers ────────────────────────────────────────────────────────────────────────────
const VERIFIERS = {
  /** duration <arg> seconds within <tolerance> (default 2s) on every final. */
  duration: async (req, ctx) => {
    const tol = req.tolerance ?? 2;
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'duration');
    const bad = [], lines = [];
    for (const f of files) {
      const d = probeVideo(f).duration;
      if (!Number.isFinite(d) || Math.abs(d - req.arg) > tol) bad.push(`${f.split('/').pop()}: ${Number.isFinite(d) ? d.toFixed(2) : 'unmeasured'}s vs ${req.arg}s ±${tol}`);
      lines.push(`${f.split('/').pop()} ${d.toFixed(2)}s`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** every asked format exists as a final, with the exact geometry of that aspect ratio — 1280x720
   *  is exactly 16:9 the way 1920x1080 is (the shape is the contract; a pixel-count floor is the
   *  resolution verifier's job). Measured w/h, tolerance 2% for odd ladder sizes (854x480 etc.). */
  formats: async (req, ctx) => {
    const RATIO = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
    const want = [].concat(req.arg ?? []);
    if (!want.length) return { status: 'red', evidence: 'verifier formats: arg must list the asked aspect ratios (["16:9","9:16"], …)', measured: 'none' };
    const bad = [], lines = [];
    for (const f of want) {
      const slug = f.replace(':', 'x');
      const file = join(FILMS, ctx.key, 'out', `final-${slug}.mp4`);
      if (!existsSync(file)) { bad.push(`${f}: no out/final-${slug}.mp4`); continue; }
      const { v } = probeVideo(file);
      if (!v) { bad.push(`${f}: final-${slug}.mp4 has no video stream`); continue; }
      const [W, H] = RATIO[f] || [];
      if (!W) { bad.push(`${f}: unknown aspect ratio (known: ${Object.keys(RATIO).join(', ')})`); continue; }
      const got = v.width / v.height, target = W / H;
      if (!(Math.abs(got - target) <= 0.02 * target)) bad.push(`${f}: final-${slug}.mp4 is ${v.width}x${v.height} (${got.toFixed(3)}:1), not ${f} (${target.toFixed(4)}:1)`);
      lines.push(`${f} ${v.width}x${v.height}`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** resolution >= <arg> on the long side (e.g. 1080). */
  resolution: async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'resolution');
    const bad = [], lines = [];
    for (const f of files) {
      const { v } = probeVideo(f);
      if (Math.max(v.width, v.height) < req.arg) bad.push(`${f.split('/').pop()}: ${v.width}x${v.height} (long side ${Math.max(v.width, v.height)}px) < ${req.arg}px`);
      lines.push(`${v.width}x${v.height}`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || `every final >= ${req.arg}px long side (${lines.join(', ')})`, measured: lines.join(', ') };
  },
  /** loudness at <arg> LUFS (default the project's mix.lufs) ± 1, true peak <= -1 dBTP. */
  loudness: async (req, ctx) => {
    const target = req.arg ?? readJson(join(FILMS, ctx.key, 'film.json'), {}).mix?.lufs ?? -14;
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'loudness');
    const bad = [], lines = [];
    for (const f of files) {
      const { lufs, tp, raw } = loudnessOf(f);
      if (!Number.isFinite(lufs) || !Number.isFinite(tp)) bad.push(`${f.split('/').pop()}: no loudness to measure (${raw}) — the mix is silent`);
      else if (Math.abs(lufs - target) > 1 || tp > -1) bad.push(`${f.split('/').pop()}: ${lufs.toFixed(1)} LUFS / ${tp.toFixed(1)} dBTP (want ${target} ±1 / <= -1 dBTP)`);
      if (Number.isFinite(lufs)) lines.push(`${lufs.toFixed(1)} LUFS, ${tp.toFixed(1)} dBTP`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** an audio stream exists (and is not digital silence). */
  'has-audio': async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'has-audio');
    const bad = [], lines = [];
    for (const f of files) {
      const j = ffprobe(f, ['-show_entries', 'stream=codec_type:format=duration', '-select_streams', 'a']);
      const a = (j.streams || [])[0];
      if (!a) { bad.push(`${f.split('/').pop()}: no audio stream`); continue; }
      // mean volume over the first 30 s: digital silence measures -inf / about -91 dB. volumedetect
      // prints its summary at INFO level, so -v error would silence the very number we read.
      const { err } = ff(['-nostats', '-i', f, '-t', '30', '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 3 * 60 * 1000 });
      const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err);
      const mean = m ? +m[1] : -Infinity;   // -inf prints no number: silent by definition
      if (!(mean > -60)) bad.push(`${f.split('/').pop()}: audio is silent (mean ${Number.isFinite(mean) ? `${mean.toFixed(1)} dB` : '-inf dB'})`);
      lines.push(`mean ${Number.isFinite(mean) ? mean.toFixed(1) : '-inf'} dB`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** caption files exist (out/captions.srt) and are non-empty, monotonic. */
  captions: async (req, ctx) => {
    const dir = join(FILMS, ctx.key, 'out');
    const srt = join(dir, 'captions.srt');
    if (!existsSync(srt)) return { status: 'red', evidence: 'no out/captions.srt (burned-in captions still need the sidecar file)', measured: 'missing' };
    const txt = readFileSync(srt, 'utf8');
    const cues = [...txt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g)]
      .map((m) => [+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000, +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000]);
    if (!cues.length) return { status: 'red', evidence: `out/captions.srt holds no cue timestamps (${txt.trim().length} bytes)`, measured: '0 cues' };
    const at = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
    const i = cues.findIndex((t, k) => k > 0 && (t[0] < cues[k - 1][0] || t[1] <= t[0]));
    if (i >= 0) return { status: 'red', evidence: `${cues.length} cues but cue ${i + 1} breaks the order (starts ${at(cues[i][0])}, previous starts ${at(cues[i - 1][0])}, ends ${at(cues[i][1])})`, measured: `${cues.length} cues, non-monotonic` };
    return { status: 'green', evidence: `${cues.length} cues, monotonic (${at(cues[0][0])} → ${at(cues[cues.length - 1][1])})`, measured: `${cues.length} cues` };
  },
  /** the narration's language is <arg> (ASR on the mix, cached; default 'auto' accepts what it hears). */
  language: async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'language');
    const { transcribeMix } = await import('./asr-probe.mjs');
    const r = await transcribeMix(files[0]);
    const heard = `ASR heard ${r.language} (p ${r.probability}, ${r.words} words)`;
    if (req.arg && r.language !== String(req.arg)) return { status: 'red', evidence: `${heard}, want "${req.arg}"`, measured: r.language };
    return { status: 'green', evidence: heard, measured: r.language };
  },
  /** every final's video keeps content inside the platform safe area — measured as YAVG over the
   *  safe band on a still frame: a render that ignored the area leaves the band near-black
   *  (limited-range black is Y=16, so ">= 8" would pass an empty frame — the bar is 20). The real
   *  craft rule lives in the engines' own layout; this catches a render that ignored it entirely. */
  'safe-area': async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'safe-area');
    const bad = [], lines = [];
    for (const f of files) {
      const { v } = probeVideo(f);
      const portrait = v.height > v.width;
      const [x0, y0] = [Math.round(v.width * (portrait ? 0.07 : 0.06)), Math.round(v.height * 0.08)];
      const crop = `crop=${portrait ? `${v.width - 2 * x0}:${Math.round(v.height * 0.72)}:${x0}:${y0}` : `${Math.round(v.width * 0.88)}:${v.height - 2 * y0}:${x0}:${y0}`}`;
      const { out } = ff(['-v', 'error', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', `${crop},signalstats,metadata=print:file=-`, '-f', 'null', '-'], { timeout: 3 * 60 * 1000 });
      const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(out);
      const yavg = m ? +m[1] : NaN;
      if (!(yavg > 20)) bad.push(`${f.split('/').pop()}: the safe band is near-black (YAVG ${Number.isFinite(yavg) ? yavg.toFixed(1) : 'unmeasured'}; black is 16, content reads far higher) — the render ignored the safe area`);
      lines.push(`safe YAVG ${Number.isFinite(yavg) ? yavg.toFixed(1) : '?'}`);
    }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
  /** the named asset (arg: an assets.json id) is actually used by a child (in its film folder, hash-matched). */
  'asset-used': async (req, ctx) => {
    const assets = readJson(join(FILMS, ctx.key, 'assets.json'), []);
    const a = assets.find((x) => x.id === req.arg) || assets.find((x) => x.id === String(req.arg));
    if (!a) return { status: 'red', evidence: `no asset "${req.arg}" in films/${ctx.key}/assets.json`, measured: 'missing' };
    if (!a.sha256) return { status: 'red', evidence: `asset ${a.id} carries no sha256 pin — re-add it so the ledger can prove its use`, measured: 'unpinned' };
    const children = childrenOf(ctx.key);
    for (const child of children) {
      const found = walkHash(join(FILMS, child), a.sha256);
      if (found) return { status: 'green', evidence: `${a.id} used by ${child} (${found})`, measured: found };
      // real footage is INGESTED, not copied: the media bin pins the ORIGINAL's sha256 even
      // though the stored bytes are the conformed cache (the bin is the studio's use record)
      const bin = readJson(join(FILMS, child, 'assets', 'media', 'index.json'), null);
      for (const src of Object.values(bin?.sources ?? {})) {
        if (src.sha256 === a.sha256) return { status: 'green', evidence: `${a.id} ingested by ${child} (the media bin pins the original's sha256)`, measured: `bin:${child}` };
      }
    }
    return { status: 'red', evidence: `${a.id} (sha ${String(a.sha256).slice(0, 8)}…) is not in any child film folder${children.length ? ` (${children.join(', ')})` : ' — the project has no child films yet'}`, measured: 'not used' };
  },
  /** every final <= <arg> MiB. */
  'max-size': async (req, ctx) => {
    const files = pick(ctx); if (!files.length) return NO_FINALS(ctx, 'max-size');
    const bad = [], lines = [];
    for (const f of files) { const mb = statSync(f).size / (1024 * 1024); if (mb > req.arg) bad.push(`${f.split('/').pop()}: ${mb.toFixed(1)} MiB > ${req.arg} MiB`); lines.push(`${mb.toFixed(1)} MiB`); }
    return { status: bad.length ? 'red' : 'green', evidence: bad.join('; ') || lines.join(', '), measured: lines.join(', ') };
  },
};

function childrenOf(key) {
  const pre = `${key}-`;
  return existsSync(FILMS) ? readdirSync(FILMS).filter((f) => f.startsWith(pre) && existsSync(join(FILMS, f, 'film.json'))) : [];
}
function walkHash(dir, want) {   // find a file whose sha256 == want (bounded: skip out/, records/)
  const shaOf = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return null; } };
  const walk = (d, depth) => {
    if (depth > 4) return null;
    for (const f of readdirSync(d)) {
      if (f === 'out' || f === 'records' || f.startsWith('.') || f === 'node_modules') continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) { const r = walk(p, depth + 1); if (r) return r; }
      else if (shaOf(p) === want) return p.replace(ROOT + '/', '');
    }
    return null;
  };
  try { return walk(dir, 0); } catch { return null; }
}

/** Dispatch one measurable requirement. Unknown verifier -> a loud throw (the ledger check proves it). */
export async function verifyRequirement(req, ctx) {
  const v = VERIFIERS[req.verifier];
  if (!v) throw new Error(`requirement ${req.id}: no verifier "${req.verifier}" in the library (${Object.keys(VERIFIERS).join(', ')})`);
  const row = await v(req, ctx);
  return { row: { status: row.status, evidence: row.evidence, measured: row.measured }, measured: row.measured, why: row.evidence };
}
export const VERIFIER_NAMES = Object.keys(VERIFIERS);
