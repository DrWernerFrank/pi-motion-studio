// engine/segment-cache.mjs — the P9 speed layer: the segment render cache.
//
// A render is a concat of independently encoded, frame-aligned mp4 parts (render.mjs). Those parts are units of a
// FIXED grid of frame ranges over the timeline (150 frames at final, 300 at draft, anchored at frame 0; segment k =
// [k*N, min((k+1)*N, total))). Each unit is encoded on its own, so unit boundaries are the only thing that has to
// agree between renders: every code path (cache on, --no-cache, cold, warm, mixed) splits at the SAME grid, which
// makes a deliverable byte-identical however many of its parts were served from the cache. A cached segment simply
// IS a unit encode that already happened; reusing it changes nothing but the wall clock.
//
//   films/<key>/out/.cache/segments/<fmt>/<quality>/<a>-<b>.mp4        frames [a,b) of the timeline, encoded
//                                                  <a>-<b>.mp4.json  sidecar { a, b, hash, frames, recipe, at }
//
// A sidecar's `hash` is the hash of the RENDER INPUTS OF THAT WINDOW: global inputs (the engine render code, the
// film's index.html / design.json / beats.json, film.json's fps/formats/background/motionBlur, the effective rate
// and sub count, a whole-output LUT) plus everything that can paint pixels inside [a,b): the clips that overlap it
// (with their source's media identity), the overlays that overlap it, the caption config and its transcript.
// Hashing per window — not the whole edit.json — is what lets a one-clip change re-encode only the segments that
// clip touches. edit.json's `rev`, the ids of untouched clips and film.json's `duration` are deliberately NOT
// inputs: they change nothing on screen. A source's identity is its ingest key (sha256 over recipe + source +
// params — stable across cache-hit re-ingests, new when the conform recipe or the source bytes change) plus the
// conformed geometry, never media.json's timestamps.
//
// All frame arithmetic is exact rational frames (lib/frames.mjs); nothing here keys on float seconds.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clipFrames, grid } from './lib/edit-ops.mjs';
import { fmtSlug, readJson } from './lib/film.mjs';
import { framesIn, parseFps } from './lib/frames.mjs';
import { mediaDir } from './ingest.mjs';
import { run } from './lib/proc.mjs';
import { ROOT, safePath } from './lib/serve.mjs';

export const RECIPE = 1; // bump when this module's cache layout or hash recipe changes: every cached segment is then stale
export const SEGMENT_FRAMES = { final: 150, draft: 300 };
const EXT = 'mp4';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const H = (parts) => sha(parts.join('\u0000'));
const fileSha = (p) => { try { return sha(readFileSync(p)); } catch { return 'missing'; } };
const writeAtomic = (file, text) => { mkdirSync(dirname(file), { recursive: true }); const t = `${file}.tmp-${process.pid}`; writeFileSync(t, text); renameSync(t, file); };
const ls = (d) => { try { return readdirSync(d); } catch { return []; } };

export const segmentsRoot = (film) => join(film.out, '.cache', 'segments');
export function segmentPath(film, fmt, quality, a, b) { return join(segmentsRoot(film), fmtSlug(fmt), String(quality), `${a}-${b}.${EXT}`); }

// The engine's own render code: if any of it changes, every cached segment is stale. Covers the encoder params
// (render.mjs), the page runtime + edit drawing (lib/*.js), their shared math (lib/*.mjs) and the fonts.
function codeSha() {
  const lines = [];
  const walk = (d, exts) => { for (const e of ls(d).sort()) { const p = join(d, e); if (exts.some((x) => e.endsWith(x)) && statSync(p).isFile()) lines.push(`${e}:${fileSha(p)}`); } };
  walk(join(ROOT, 'engine', 'lib'), ['.js', '.mjs', '.css']);
  walk(join(ROOT, 'engine', 'fonts'), ['.ttf', '.otf']);
  lines.push(`render.mjs:${fileSha(join(ROOT, 'engine', 'render.mjs'))}`);
  return sha(lines.join('\n'));
}

// ── the frame window of one render ────────────────────────────────────────────────────────────────────────────────────
// [A, B) in absolute timeline frames at the render's effective rate. `from` must sit on the frame grid (otherwise
// the painted frames fall between timeline frames and no cached segment can stand in for them); `to` only sets the
// frame count, so an odd duration still caches — the count is the same the plain renderer would produce.
export function windowOf(film, { from = 0, to, fps } = {}) {
  const FPS = fps || parseFps(film.cfg.fps);
  const fromS = from ?? 0, toS = Math.min(to ?? film.cfg.duration, film.cfg.duration);
  const total = framesIn(film.cfg.duration, FPS);      // the full timeline, in frames
  const frames = framesIn(toS - fromS, FPS);
  const A = Math.round((fromS * FPS.num) / FPS.den);    // first timeline frame painted
  const B = A + frames;                                // one past the last
  const at = (k) => (k * FPS.den) / FPS.num;
  return { fps: FPS, total, frames, A, B, aligned: frames > 0 && Math.abs(at(A) - fromS) < 2e-6 };
}

// The grid: ordered units covering [A, B). Each unit is the grid segment clipped to the window; `full` marks an
// exact grid segment fully inside the window (the only kind that is cached or written back). A window that runs
// past the timeline's end (an odd `to`) gets one plain tail unit, exactly like the plain renderer would paint.
export function gridUnits(A, B, total, N) {
  const units = [];
  for (let sa = Math.floor(A / N) * N; sa < B;) {
    const sb = Math.min(sa + N, total);
    if (sb <= sa) { // the grid is exhausted (the window runs past the timeline): one plain unit to the end
      if (B > Math.max(sa, A)) units.push({ a: Math.max(sa, A), b: B, segA: sa, segB: B, full: false });
      break;
    }
    const a = Math.max(sa, A), b = Math.min(sb, B);
    if (b > a) units.push({ a, b, segA: sa, segB: sb, full: a === sa && b === sb });
    if (sb >= B) break;
    sa = sb;
  }
  return units;
}

// ffprobe frame count of a finished part (mp4 stores it; null when it cannot be read).
const nbFrames = async (file) => {
  try { const n = Number((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file])).out.trim()); return Number.isInteger(n) && n > 0 ? n : null; }
  catch { return null; }
};

// ── the render-inputs hashes ─────────────────────────────────────────────────────────────────────────────────────────
function hashCtx(film, { quality, fmt, fps, sub } = {}) {
  const edit = readJson(join(film.dir, 'edit.json'));
  const F = fps || parseFps(film.cfg.fps);
  const lut = edit?.color?.lut ? safePath(edit.color.lut.replace(/^\//, '')) : null; // whole-output 3D LUT (render.mjs bakes it into every part)
  const capFrom = edit?.captions ? (edit.captions.from ?? edit.tracks.find((t) => t.kind === 'video')?.clips[0]?.src) : null; // same resolution as edit.js
  const global = H([
    `recipe ${RECIPE}`, `quality ${quality ?? '*'}`, `fmt ${fmt ?? '*'}`, `rate ${F.str}`, `sub ${sub ?? film.cfg.motionBlur ?? 1}`,
    `film ${JSON.stringify({ fps: film.cfg.fps, formats: film.cfg.formats, background: film.cfg.background, motionBlur: film.cfg.motionBlur })}`,
    `index ${fileSha(join(film.dir, 'index.html'))}`, `design ${fileSha(join(film.dir, 'design.json'))}`, `beats ${fileSha(join(film.dir, 'beats.json'))}`,
    `engine ${codeSha()}`, `lut ${lut ? fileSha(lut) : 'none'}`,
    `edit ${edit ? `v${edit.version} @${parseFps(edit.fps).str}` : 'none'}`, `captions ${edit?.captions ? JSON.stringify(edit.captions) : 'none'}`,
    `transcript ${capFrom ? fileSha(join(mediaDir(film, capFrom), 'transcript.json')) : 'none'}`,
  ]);
  const ctx = { film, edit, fps: F, global, sources: {} };
  // identity of one source: its edit entry (the path is not pixels — relink moves it) + its ingest key and conformed
  // geometry (stable across cache-hit re-ingests) + its tracking data (the `follow` camera reads it).
  ctx.source = (id) => {
    if (ctx.sources[id] !== undefined) return ctx.sources[id];
    const s = edit?.sources?.[id] ?? null;
    const src = s ? { ...s } : null; if (src) delete src.path;
    const m = readJson(join(mediaDir(film, id), 'media.json'));
    const i = m?.ingest ?? {};
    const media = m && { sha: m.source?.sha256 ?? null, kind: m.kind ?? null, key: i.key ?? null, recipe: i.recipe ?? null, params: i.params ?? null,
      conform: i.conform ? { fps: i.conform.fps, width: i.conform.width, height: i.conform.height, frames: i.conform.frames, gop: i.conform.gop } : null };
    return (ctx.sources[id] = H([`src ${JSON.stringify(src)}`, `media ${JSON.stringify(media)}`, `track ${fileSha(join(mediaDir(film, id), 'track.json'))}`]));
  };
  return ctx;
}

// the hash of everything that paints frames inside [a, b): global inputs + the clips/overlays overlapping the window
function windowHash(film, a, b, ctx) {
  const at = (k) => (k * ctx.fps.den) / ctx.fps.num;
  const wa = at(a), wb = at(b), EPS = 1e-6; // edit times are rounded to 6 decimals; overlap tests need that much slack
  const items = [ctx.global];
  if (ctx.edit) {
    const G = grid(ctx.edit), EF = parseFps(ctx.edit.fps);
    for (const t of ctx.edit.tracks) for (const c of t.clips) {
      const atF = G.F(c.at), s = (atF + clipFrames(ctx.edit, c)) * EF.den / EF.num, f = atF * EF.den / EF.num; // the clip's span in seconds
      if (s <= wa + EPS || f >= wb - EPS) continue;
      items.push(`clip ${JSON.stringify(c)} ${ctx.source(c.src)}`);
    }
    for (const o of ctx.edit.overlays) { if (o.at >= wb - EPS || o.at + o.dur <= wa + EPS) continue; items.push(`overlay ${JSON.stringify(o)}`); }
  }
  return H(items);
}

// The film's render-inputs VERSION: every input any segment of this film depends on (the whole edit, all sources).
// One number for reporting and cache audits; the per-segment sidecars use window hashes so unchanged windows survive
// an edit. Changes on any input change (edit, media, design, engine code) — never on a re-ingest cache hit.
export function inputsHash(film) {
  const ctx = hashCtx(film, {});
  const items = [ctx.global];
  if (ctx.edit) {
    for (const t of ctx.edit.tracks) for (const c of t.clips) items.push(`clip ${JSON.stringify(c)} ${ctx.source(c.src)}`);
    for (const o of ctx.edit.overlays) items.push(`overlay ${JSON.stringify(o)}`);
  }
  return H(items);
}

// ── the plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// planRender(film, { quality, fmt, from, to, fps, sub, workers }) -> { total, A, B, N, frames, aligned, units, segments, gaps, hits }
//   units    the ordered frame-exact partition of [A,B) render.mjs turns into parts: { a, b, segA, segB, full, cached, file, hash }
//   segments the grid segments under the window with their cache verdict (the reporting shape)
//   gaps     the maximal uncovered runs — the frames that still have to be encoded
// A cached unit is verified before use: sidecar hash match AND ffprobe nb_frames == its claimed range, else it is
// a miss (a corrupt one is deleted). Never throws for cache reasons; only for a genuinely broken encode (noteSegment).
export async function planRender(film, { quality = 'final', fmt, from = 0, to, workers, fps, sub } = {}) {
  const F = fps || parseFps(film.cfg.fps);
  const N = SEGMENT_FRAMES[quality] ?? SEGMENT_FRAMES.final;
  const win = windowOf(film, { from, to, fps: F });
  const ctx = hashCtx(film, { quality, fmt, fps: F, sub });
  const units = win.aligned ? gridUnits(win.A, win.B, win.total, N) : [];
  let hits = 0;
  for (const u of units) {
    u.cached = false; u.file = null; u.hash = null;
    if (!u.full) continue;
    u.hash = windowHash(film, u.segA, u.segB, ctx);
    const seg = segmentPath(film, fmt, quality, u.segA, u.segB), side = readJson(`${seg}.json`);
    if (side?.hash === u.hash && side.recipe === RECIPE && side.a === u.segA && side.b === u.segB && existsSync(seg)) {
      const n = await nbFrames(seg);
      if (n === u.segB - u.segA) { u.cached = true; u.file = seg; hits++; }
      else { rmSync(seg, { force: true }); rmSync(`${seg}.json`, { force: true }); } // frames mismatch: corrupt, delete
    } else if (existsSync(seg) && !side) rmSync(seg, { force: true });               // a file without its sidecar: an interrupted write
  }
  const gaps = []; let run = null;
  for (const u of units) {
    if (u.cached) { if (run) { gaps.push(run); run = null; } }
    else run = run ? { a: run.a, b: u.b } : { a: u.a, b: u.b };
  }
  if (run) gaps.push(run);
  return { ...win, N, aligned: win.aligned, units, hits,
    segments: units.map((u) => ({ a: u.segA, b: u.segB, cached: u.cached, file: u.cached ? u.file : segmentPath(film, fmt, quality, u.segA, u.segB) })),
    gaps };
}

// Promote a freshly encoded, frame-verified part into the cache (render.mjs calls this after each full-segment gap
// encode). Returns true when cached, false when the cache write itself failed (disk, permissions — the render is
// already complete and fine); throws only when the part is broken (a real ffmpeg failure to surface, not a cache one).
export async function noteSegment(file, a, b, hash, { film, fmt, quality } = {}) {
  if (!film || !fmt || !quality) throw new Error('noteSegment(file, a, b, hash, { film, fmt, quality }) needs the film, format and quality the segment belongs to');
  const n = await nbFrames(file);
  if (n !== b - a) throw new Error(`refusing to cache [${a},${b}) from ${file}: ffprobe counts ${n ?? 'no'} frames, expected ${b - a} — the encode is broken, not the cache`);
  const dest = segmentPath(film, fmt, quality, a, b);
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, tmp); renameSync(tmp, dest); // atomic on the same directory: a reader never sees a partial segment
    writeAtomic(`${dest}.json`, JSON.stringify({ a, b, hash, frames: n, recipe: RECIPE, fmt, quality, at: new Date().toISOString() }, null, 1) + '\n');
    return true;
  } catch (e) {
    rmSync(tmp, { force: true }); rmSync(dest, { force: true }); rmSync(`${dest}.json`, { force: true });
    return false; // the cache write failed (disk, permissions): the render itself is already complete and correct
  }
}

// Bytes + counts, for `studio cache` (wired there; this module only reports).
export function cacheStats(film) {
  const root = segmentsRoot(film), by = {};
  let bytes = 0, segments = 0;
  for (const fmt of ls(root)) for (const q of ls(join(root, fmt))) {
    let b = 0, n = 0;
    for (const f of ls(join(root, fmt, q))) { const p = join(root, fmt, q, f); try { b += statSync(p).size; } catch { /* raced away */ } if (f.endsWith(`.${EXT}`)) n++; }
    by[`${fmt}/${q}`] = { segments: n, bytes: b }; bytes += b; segments += n;
  }
  return { bytes, segments, by };
}
