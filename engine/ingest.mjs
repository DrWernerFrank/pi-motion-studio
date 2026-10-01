// studio ingest: turn a source file into canonical, frame-accurate, browser-decodable media (mission D1).
//   films/<film>/assets/media/<id>/   media.json  conformed.mp4  audio.wav  proxy.mp4  peaks.json  filmstrip.jpg  scenes.json  silence.json  ingest.json
//   films/<film>/assets/media/index.json            the media bin: id -> source path + sha256 (read-only originals; `relink` repairs moved ones)
// Originals are only ever opened for reading. Every derived file is keyed by (source sha256, parameters, recipe); a re-run is a no-op,
// an interrupted run resumes at the first missing step, and a run that fails leaves no partial cache behind.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { frameTime, framesIn, nearestStandardFps, parseFps } from './lib/frames.mjs';
import { readFilm, readJson, writeJson } from './lib/film.mjs';
import { hashFile, probeMedia, resolveSourcePath } from './lib/media.mjs';
import { run } from './lib/proc.mjs';
import { speechProbe } from './lib/speechprobe.mjs';

export const RECIPE = 5; // bump when the conform recipe changes: every cached product is then stale
export const MAX_LONG_SIDE = 1920;
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

export const binDir = (film) => join(film.dir, 'assets', 'media');
export const mediaDir = (film, id) => join(binDir(film), id);
export const readBin = (film) => readJson(join(binDir(film), 'index.json'), { version: 1, sources: {} });
const writeBin = (film, bin) => { mkdirSync(binDir(film), { recursive: true }); writeJson(join(binDir(film), 'index.json'), bin); };

// slug for an id; names with no latin letters (Persian, CJK…) fall back to src-<hash>
export const slugId = (name, sha) => (basename(name, extname(name)).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `src-${sha.slice(0, 6)}`);

// Project rate: --fps, else the film's own fps when it is an edit film, else the nearest standard rate to the source's base rate.
export function projectFps(film, m, opt) {
  if (opt.fps) return parseFps(opt.fps);
  if (film.cfg.kind === 'edit' && film.cfg.fps) return parseFps(film.cfg.fps);
  const v = m.video;
  const base = v.vfr ? Number(v.r_frame_rate.split('/')[0]) / Number(v.r_frame_rate.split('/')[1] || 1) : v.fps_value;
  return nearestStandardFps(base || 30);
}

// The conform filter chain. Order matters: deinterlace and tonemap work on source pixels, then CFR, then one scale that also does the
// colour conversion to bt709 limited range, then SAR 1 + yuv420p. (ffmpeg's autorotate runs before this chain.)
export function conformFilter(m, fps, max = MAX_LONG_SIDE) {
  const v = m.video, vf = [];
  if (v.interlaced) vf.push('yadif=mode=send_frame:parity=auto:deint=all');
  const hdr = v.color.hdr;
  if (hdr) vf.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=mobius:param=0.9:desat=0', 'zscale=t=bt709:m=bt709:r=tv', 'format=yuv420p');
  vf.push(`fps=fps=${fps.str}:start_time=0:round=near`);
  const long = Math.max(v.display_width, v.display_height), k = long > max ? max / long : 1;
  const tw = even(v.display_width * k), th = even(v.display_height * k);
  const matrix = !hdr && (!v.color.matrix || ['unknown', 'unspecified'].includes(v.color.matrix)) ? `:in_color_matrix=${v.display_height >= 720 ? 'bt709' : 'bt601'}` : '';
  // setparams last: the scale filter only tags the matrix, and the encoder takes primaries/transfer/range from the frames
  vf.push(`scale=${tw}:${th}:out_color_matrix=bt709:out_range=tv${matrix}:flags=lanczos`, 'setsar=1', 'format=yuv420p', 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv');
  return { vf: vf.join(','), width: tw, height: th };
}

const gopFor = (fps) => Math.max(12, Math.min(30, Math.round(fps.value / 2)));

async function ffmpeg(args, label) {
  try { return await run('ffmpeg', ['-y', '-nostdin', '-v', 'error', ...args]); }
  catch (e) { throw new Error(`${label} failed: ${String(e.message).split('\n').slice(1).join(' ').trim() || e.message}`); }
}
const probeFile = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f])).out);

// Run one step unless its product exists and was made with this key. Output goes to <file>.part.<ext>, then an atomic rename.
async function step(ctx, name, file, fn) {
  const state = ctx.state;
  if (!ctx.force && state.steps[name] === ctx.key && existsSync(file)) { ctx.log(`  ${name}: cached`); return false; }
  const part = file.replace(/(\.[^.]+)$/, '.part$1'); rmSync(part, { force: true });
  const t0 = Date.now();
  await fn(part);
  renameSync(part, file);
  state.steps[name] = ctx.key; writeJson(join(ctx.dir, 'ingest.json'), state);
  ctx.log(`  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return true;
}

// Ingest one source into a film. Returns the media record (media.json).
export async function ingestSource(filmKey, srcArg, opt = {}) {
  const film = readFilm(filmKey), log = opt.log || console.log;
  const src = await resolveSourcePath(srcArg);
  const bin = readBin(film);
  const prevByPath = Object.entries(bin.sources).find(([, s]) => s.path === src);
  const hashInfo = await hashFile(src, prevByPath?.[1]);
  const m = await probeMedia(src, { sha256: hashInfo.sha256, hash_kind: hashInfo.hash_kind, size: hashInfo.size, mtimeMs: hashInfo.mtimeMs });
  if (m.kind === 'none') throw new Error(`${basename(src)} has no video or audio stream. Nothing was ingested.`);
  const id = opt.id || prevByPath?.[0] || slugId(src, m.source.sha256);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`bad source id "${id}": lowercase letters, digits, dashes`);
  const other = bin.sources[id];
  if (other && other.path !== src && other.sha256 !== m.source.sha256 && !opt.force) throw new Error(`source id "${id}" is already taken by ${other.path}: pass --id <other>`);

  const audioIdx = opt.audioStream !== undefined ? Number(opt.audioStream) : m.audio_used;
  if (audioIdx !== null && audioIdx !== undefined && !m.audio.some((a) => a.index === audioIdx)) throw new Error(`${basename(src)} has no audio stream ${audioIdx} (streams: ${m.audio.map((a) => a.index).join(', ') || 'none'})`);
  m.audio_used = audioIdx ?? null;
  const fps = m.video ? projectFps(film, m, opt) : null, max = opt.max ? Number(opt.max) : MAX_LONG_SIDE, still = Number(opt.stillSeconds || 5);
  const params = { fps: fps?.str, max, audio: m.audio_used, still: m.kind === 'image' ? still : undefined, proxy: opt.proxy !== false };
  const key = createHash('sha256').update(JSON.stringify({ RECIPE, sha: m.source.sha256, params })).digest('hex').slice(0, 16);

  const dir = mediaDir(film, id), existed = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const state = readJson(join(dir, 'ingest.json'), { steps: {} });
  if (state.key && state.key !== key) state.steps = {}; // different source or parameters: nothing cached applies
  state.key = key; state.recipe = RECIPE;
  const ctx = { dir, state, key, force: !!opt.force, log };
  const f = (n) => join(dir, n);
  const t0 = Date.now(), made = [];
  log(`ingest ${id}: ${m.kind}${m.video ? ` ${m.video.display_width}x${m.video.display_height}${m.video.rotation ? ` (rotated ${m.video.rotation})` : ''} ${m.video.fps}fps${m.video.vfr ? ' VFR' : ''}${m.video.color.hdr ? ' ' + m.video.color.hdr.toUpperCase() + ' HDR' : ''}` : ''} -> ${fps ? fps.str + ' fps' : 'audio only'}`);
  try {
    let conform = null;
    if (m.video) {
      const { vf, width, height } = conformFilter(m, fps, max), gop = gopFor(fps);
      const input = m.kind === 'image' ? ['-loop', '1', '-framerate', fps.str, '-t', String(still), '-i', src] : ['-i', src];
      if (await step(ctx, 'conform', f('conformed.mp4'), (out) => ffmpeg([...input, '-map', `0:${m.video.index}`, '-vf', vf, '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
        '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0', '-pix_fmt', 'yuv420p', ...TAGS, '-movflags', '+faststart', '-an', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-f', 'mp4', out], 'conform'))) made.push('conform');
      const c = await probeFile(f('conformed.mp4')), cv = c.streams.find((s) => s.codec_type === 'video');
      const srcDur = m.kind === 'image' ? still : m.video.duration || m.source.container_duration, outDur = Number(cv.duration || c.format.duration);
      if (srcDur && outDur < srcDur * 0.98 - 0.1) throw new Error(`decoding ${basename(src)} stopped at ${outDur.toFixed(1)}s of ${srcDur.toFixed(1)}s: the file is truncated or corrupt. Nothing was ingested.`);
      conform = { fps: fps.str, fps_value: fps.value, width, height, frames: Number(cv.nb_frames) || framesIn(outDur, fps), duration: outDur, gop, source_vfr: m.video.vfr, rotation_baked: m.video.rotation, tonemapped: !!m.video.color.hdr, deinterlaced: m.video.interlaced, filter: vf };
      if (opt.proxy !== false) {
        const [pw, ph] = width >= height ? [even((360 * width) / height), 360] : [360, even((360 * height) / width)];
        if (await step(ctx, 'proxy', f('proxy.mp4'), (out) => ffmpeg(['-i', f('conformed.mp4'), '-vf', `scale=${pw}:${ph}:flags=bicubic,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '1', '-bf', '0', '-an', '-movflags', '+faststart', '-f', 'mp4', out], 'proxy'))) made.push('proxy');
        // thumbnails: at most 120, 12 per row, one sprite sheet
        const dur = conform.duration, stepS = Math.max(1, Math.ceil(dur / 120)), n = Math.max(1, Math.ceil(dur / stepS)), cols = Math.min(12, n), rows = Math.ceil(n / cols), tw = 160, th = even((tw * ph) / pw);
        if (await step(ctx, 'filmstrip', f('filmstrip.jpg'), (out) => ffmpeg(['-i', f('proxy.mp4'), '-vf', `fps=1/${stepS},scale=${tw}:${th},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '4', '-update', '1', '-f', 'image2', out], 'filmstrip'))) made.push('filmstrip');
        conform.filmstrip = { file: 'filmstrip.jpg', cols, rows, thumb_width: tw, thumb_height: th, count: n, step: stepS };
        if (await step(ctx, 'scenes', f('scenes.json'), async (out) => {
          const r = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', f('proxy.mp4'), '-vf', 'scdet=threshold=10', '-an', '-f', 'null', '-'], { allowFail: true });
          const cuts = [...r.err.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)].map((x) => ({ t: +x[2], score: +x[1] }));
          writeFileSync(out, JSON.stringify({ threshold: 10, cuts }, null, 1));
        })) made.push('scenes');
      }
    }
    if (m.audio_used !== null) {
      const a = m.audio.find((x) => x.index === m.audio_used);
      if (await step(ctx, 'audio', f('audio.wav'), (out) => ffmpeg(['-i', src, '-map', `0:${a.index}`, '-vn', '-af', 'aresample=async=1:first_pts=0', '-ar', '48000', ...(a.channels > 2 ? ['-ac', '2'] : []), '-c:a', 'pcm_s16le', '-f', 'wav', out], 'audio'))) made.push('audio');
      if (await step(ctx, 'peaks', f('peaks.json'), async (out) => {
        const raw = await new Promise((ok, bad) => { const p = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', f('audio.wav'), '-ac', '1', '-ar', '8000', '-f', 's16le', '-']), b = []; p.stdout.on('data', (d) => b.push(d)); p.on('error', bad); p.on('close', (c) => (c ? bad(new Error('peaks: ffmpeg failed')) : ok(Buffer.concat(b)))); });
        const per = 80, buckets = Math.ceil(raw.length / 2 / per), data = new Array(buckets * 2);
        for (let b = 0; b < buckets; b++) { let lo = 0, hi = 0; for (let i = b * per; i < Math.min(raw.length / 2, (b + 1) * per); i++) { const x = raw.readInt16LE(i * 2); if (x < lo) lo = x; if (x > hi) hi = x; } data[b * 2] = Math.round((lo / 32768) * 127); data[b * 2 + 1] = Math.round((hi / 32768) * 127); }
        writeFileSync(out, JSON.stringify({ rate: 100, scale: 127, channels: 1, buckets, data }));
      })) made.push('peaks');
      if (await step(ctx, 'silence', f('silence.json'), async (out) => writeFileSync(out, JSON.stringify({ source: 'audio.wav', gap_ms: 250, ...(await speechProbe(f('audio.wav'))) }, null, 1)))) made.push('silence');
    }

    const au = m.audio_used !== null ? m.audio.find((x) => x.index === m.audio_used) : null;
    const wavDur = au ? (statSync(f('audio.wav')).size - 44) / (48000 * 2 * Math.min(2, au.channels)) : null; // 16-bit PCM at 48 kHz, <= 2 channels
    const rec = { ...m, id, ingest: { key, recipe: RECIPE, params, at: new Date().toISOString(), conform, audio_duration: wavDur, products: readdirSync(dir).filter((x) => !x.startsWith('.') && !x.includes('.part.') && x !== 'ingest.json').sort() } };
    writeJson(f('media.json'), rec);
    bin.sources[id] = { path: src, sha256: m.source.sha256, hash_kind: m.source.hash_kind, size: m.source.size, mtimeMs: m.source.mtimeMs, kind: m.kind, duration: conform?.duration ?? wavDur, fps: fps?.str ?? null, key, ingested_at: rec.ingest.at };
    writeBin(film, bin);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    log(made.length ? `ingest ${id}: done in ${secs}s (${made.join(', ')})` : `ingest ${id}: cache hit (${secs}s): nothing to do`);
    return { ...rec, cached: made.length === 0, seconds: +secs, dir };
  } catch (e) {
    for (const x of readdirSync(dir)) if (x.includes('.part.')) rmSync(join(dir, x), { force: true });
    if (!existed) rmSync(dir, { recursive: true, force: true }); // no partial cache for a source that never ingested
    throw e;
  }
}

// ── relink: find moved originals by size, then sha256 ────────────────────────────────────────────────────────────────────
function* walk(dir, depth) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) yield* walk(p, depth - 1); } else if (e.isFile()) yield p;
  }
}

export async function relink(filmKey, { search = [], log = console.log } = {}) {
  const film = readFilm(filmKey), bin = readBin(film), report = { ok: [], repaired: [], missing: [] };
  for (const [id, s] of Object.entries(bin.sources)) {
    const here = existsSync(s.path) && statSync(s.path).size === s.size && (await hashFile(s.path, s)).sha256 === s.sha256;
    if (here) { report.ok.push(id); continue; }
    const roots = [...search, dirname(s.path), dirname(dirname(s.path))].filter((d, i, a) => d && existsSync(d) && a.indexOf(d) === i);
    let found = null;
    for (const root of roots) {
      for (const cand of walk(root, 4)) {
        if (statSync(cand).size !== s.size) continue;
        if ((await hashFile(cand)).sha256 === s.sha256) { found = cand; break; }
      }
      if (found) break;
    }
    if (!found) { report.missing.push(id); log(`relink ${id}: not found (was ${s.path}); pass --search <dir>`); continue; }
    log(`relink ${id}: ${s.path} -> ${found}`);
    bin.sources[id] = { ...s, path: found, mtimeMs: statSync(found).mtimeMs }; report.repaired.push({ id, from: s.path, to: found });
    const mj = readJson(join(mediaDir(film, id), 'media.json')); if (mj) { mj.source.path = found; mj.source.name = basename(found); writeJson(join(mediaDir(film, id), 'media.json'), mj); }
    const edit = readJson(join(film.dir, 'edit.json')); if (edit?.sources?.[id]) { edit.sources[id].path = found; writeJson(join(film.dir, 'edit.json'), edit); }
  }
  if (report.repaired.length) writeBin(film, bin);
  return report;
}

// ── cache: size report and garbage collection ────────────────────────────────────────────────────────────────────────────
const dirSize = (d) => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); n += e.isDirectory() ? dirSize(p) : statSync(p).size; } } catch { /* gone */ } return n; };
export { dirSize };
