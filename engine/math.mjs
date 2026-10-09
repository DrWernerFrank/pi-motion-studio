// math.mjs — the math-film orchestrator (mission M4).
// Scene cache: content-addressed per (scene, format, quality) — mission §3.8.
// Per scene+format: a scratch media dir (ADR-004's race fix), a generated film_state.json the scene
// reads (design, format, timing slice), one `manim render` through the memory guard (capped.mjs —
// D-007: nothing here can ever take the machine down), then a lossless concat and a single mux
// with bt709 tags (Manim's own MP4s carry none — measured in ADR-004).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CAPS, TIMEOUTS, MemPool, killedMessage } from './lib/capped.mjs';
import { FILMS, fmtSlug, readJson, requireKind, writeJson } from './lib/film.mjs';
import { pythonFor } from './doctor.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const SCRATCH = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'math');
export const SCENE_CACHE = join(homedir(), '.cache', 'pi-motion-studio', 'math-scenes');
const CACHE_VERSION = 2;
const SENTENCE_GAP = 0.15; // the narration bus's inter-sentence gap (narration.mjs) — hashed into keys
export const FORMATS = { // studio geometry (short side 8 units — studio_manim/layout.py agrees)
  '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350],
};

export function readMathFilm(key) {
  const dir = existsSync(join(FILMS, key)) ? join(FILMS, key) : null;
  if (!dir || !existsSync(join(dir, 'film.json'))) throw new Error(`no film.json in films/${key}`);
  const cfg = readJson(join(dir, 'film.json'));
  requireKind(key, cfg, 'math');
  const sceneFiles = existsSync(join(dir, 'scenes'))
    ? readdirSync(join(dir, 'scenes')).filter((f) => f.endsWith('.py')).sort()
    : [];
  return { key, dir, out: join(dir, 'out'), cfg, scenes: sceneFiles.map((f) => ({
    id: f.replace(/\.py$/, ''), file: join(dir, 'scenes', f),
  })) };
}

const sceneId = (f) => f.replace(/\.py$/, '');

// -- the scene cache (§3.8: scene source + kit + design + format + the timing slice it consumes
// + manim version; one changed sentence re-renders only its scene) -----------------------------
/** The scene's OWN sentences REBASED to their starts — everything the clock reads. Absolute film
 * times shift with upstream edits but change nothing a scene draws, so an s01 sentence edit
 * re-renders ONLY s01; later scenes keep their keys and the concat absorbs the shift. */
function rebasedSlice(timing, sceneIdOfFilm, gap) {
  const own = (timing?.sentences ?? []).filter((s) => s.scene === sceneIdOfFilm);
  return own.map((s) => ({
    id: s.id, text: s.text, spoken: s.spoken, samples: s.samples,
    duration: +((s.end ?? 0) - (s.start ?? 0)).toFixed(6),
    words: (s.words ?? []).map((w) => [w.w, +(w.start - s.start).toFixed(5), +(w.end - s.start).toFixed(5)]),
    bookmarks: (s.bookmarks ?? []).map((b) => [b.id, b.t, b.word ?? null]),
  })).concat([['gap', gap]]);
}

function sceneCacheKey({ sceneSource, kit, design, filmCfg, fmt, quality, fps, px, timing, sceneId: sid, manimVer }) {
  const h = createHash('sha256');
  h.update(`v${CACHE_VERSION}\n${sceneSource}\0`);
  for (const [p, c] of kit) h.update(`${p}\0${c}\0`);
  h.update(JSON.stringify(design) + '\0');
  const { duration: _d, ...cfgRest } = filmCfg;  // derived: never a cache invalidator
  h.update(JSON.stringify(cfgRest) + '\0');
  h.update(`${fmt}|${quality}|${fps}|${px[0]}x${px[1]}|${manimVer}\n`);
  h.update(JSON.stringify(rebasedSlice(timing, sid, SENTENCE_GAP)));
  return h.digest('hex').slice(0, 32);
}

const _mv = new Map();
async function manimVersion(py) {
  if (!_mv.has(py)) { const { out } = await run(py, ['-c', 'import manim; print(manim.__version__)'], { allowFail: true }); _mv.set(py, (out || 'unknown').trim()); }
  return _mv.get(py);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

function kitSources() {
  const dir = join(ROOT, 'engine', 'manim', 'studio_manim');
  return readdirSync(dir).filter((f) => f.endsWith('.py')).sort()
    .map((f) => [`studio_manim/${f}`, readFileSync(join(dir, f), 'utf8')]);
}

// -- the render ---------------------------------------------------------------------------
export async function renderMathFilm(key, { quality = 'draft', fmt, scene, noCache = false, timeoutS: timeoutOverride } = {}) {
  const film = readMathFilm(key);
  const formats = fmt ? [fmt] : film.cfg.formats;
  if (film.scenes.length === 0) throw new Error(`films/${key}/scenes/ holds no .py files: nothing to render`);
  const pool = new MemPool();
  const results = [];
  const counters = { rendered: 0, cached: 0 };
  for (const f of formats) {
    if (!FORMATS[f]) throw new Error(`unknown format ${f}: one of ${Object.keys(FORMATS)}`);
    const [W, H] = FORMATS[f];
    const draft = quality === 'draft';
    // DRAFT dims are even-rounded: 4:5 halves to 540x675 (odd) and cairo/x264 SEGFAULTS at an odd
    // dimension (measured: 540x675 rc=139, 540x676 fine — the Canvas engine hits the same wall,
    // see its comment in lib/film.mjs). Final is already even (1920x1080 etc).
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
    const px = draft ? [even(W / 2), even(H / 2)] : [W, H];
    const fps = draft ? Math.min(30, film.cfg.fps || 60) : (film.cfg.fps || 60);
    const capMb = CAPS[quality], timeoutS = TIMEOUTS[quality];
    const wanted = scene ? film.scenes.filter((s) => s.id === scene) : film.scenes;
    if (scene && !wanted.length) throw new Error(`no scene "${scene}" in films/${key}/scenes/ (${film.scenes.map((s) => s.id).join(', ')})`);

    const timingAll = readJson(join(film.dir, 'timing.json'), {});
    const partials = [];
    for (const s of wanted) {
      const work = join(SCRATCH, key, f, s.id);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      const records = join(work, 'records'); mkdirSync(records, { recursive: true });
      const state = {
        format: f, design: readJson(join(film.dir, 'design.json'), {}),
        timing: { sentences: timingAll.sentences ?? [] },
        records_dir: records, claims_file: join(records, `${s.id}-claims.json`),
        scene: { id: s.id, file: s.file },
      };
      const stateFile = join(work, 'film_state.json'); writeJson(stateFile, state);
      // -- cache: content-addressed per (scene source, kit, design, cfg, fmt/quality/fps/px,
      //    the scene's REBASED timing slice, manim version). A hit reuses the partial + records.
      const key32 = noCache ? null : sceneCacheKey({
        sceneSource: readFileSync(s.file, 'utf8'), kit: kitSources(),
        design: state.design, filmCfg: film.cfg, fmt: f, quality, fps, px,
        timing: timingAll, sceneId: s.id, manimVer: await manimVersion(pythonFor('manim')),
      });
      const cdir = key32 && join(SCENE_CACHE, key32);
      if (cdir && existsSync(join(cdir, `${s.id}.mp4`))) {
        copyFileSync(join(cdir, `${s.id}.mp4`), join(work, `${s.id}.mp4`));
        for (const x of readdirSync(join(cdir, 'records'))) copyFileSync(join(cdir, 'records', x), join(records, x));
        counters.cached += 1;
        partials.push({ scene: s, mp4: join(work, `${s.id}.mp4`), records, work });
        continue;
      }
      const r = await pool.run({
        cmd: pythonFor('manim'), args: ['-m', 'manim', 'render', s.file, 'Scene',
          '--media_dir', work, '-o', `${s.id}.mp4`, '--fps', String(fps), '--resolution', `${px[0]},${px[1]}`],
        memoryMb: capMb, timeoutS: timeoutOverride ?? timeoutS, cwd: work, label: `${key} ${s.id} ${f}`,
        env: { STUDIO_FILM_STATE: stateFile, STUDIO_FORMAT: f, PYTHONPATH: join(ROOT, 'engine', 'manim') },
      });
      if (r.killed || r.code !== 0) {
        const msg = r.killed ? killedMessage(r, { film: key, scene: s.id, fmt: f, quality })
          : `${key} scene ${s.id} ${f} (${quality}) failed:\n${cleanError(r)}`;
        throw new Error(msg);
      }
      const mp4 = find(join(work, 'videos'), `${s.id}.mp4`);
      if (!mp4) throw new Error(`manim produced no ${s.id}.mp4 under ${work}/videos (cwd ${work}) — an empty scene adds no frames; give the scene content\n${(r.err || '').split('\n').slice(-8).join('\n')}`);
      counters.rendered += 1;
      if (cdir) { // populate the cache entry (atomic-ish: write a tmp dir, then rename)
        const tmp = `${cdir}.tmp-${Date.now()}`;
        mkdirSync(join(tmp, 'records'), { recursive: true });
        copyFileSync(mp4, join(tmp, `${s.id}.mp4`));
        for (const x of readdirSync(records)) copyFileSync(join(records, x), join(tmp, 'records', x));
        try { rmSync(cdir, { recursive: true, force: true }); mkdirSync(join(SCENE_CACHE), { recursive: true }); (await import('node:fs')).renameSync(tmp, cdir); }
        catch { rmSync(tmp, { recursive: true, force: true }); } // partial write: never serve it
      }
      partials.push({ scene: s, mp4, records, work });
    }
    if (!partials.length) continue;

    // records into the film folder (derived, small, the lint + `where` + GUI read them)
    const recDir = join(film.dir, 'records', fmtSlug(f)); mkdirSync(recDir, { recursive: true });   // Windows-safe: 16x9, never 16:9
    for (const p of partials) for (const x of readdirSync(p.records)) copyFileSync(join(p.records, x), join(recDir, x));

    // concat the scene partials losslessly, then ONE transcode with the delivery tags.
    // The whole downstream stage is content-addressed too: when EVERY partial came from the scene
    // cache AND the mix is unchanged, the muxed output is byte-reproducible, so a MUX-CACHE entry
    // (keyed on the partial set + mix mtime/size + quality/fmt) skips concat+encode entirely —
    // the warm re-render path (measured: mux dominated it at 18% of cold; the §3.8 target is <10%).
    const out = join(film.out, `${quality}-${fmtSlug(f)}.mp4`); mkdirSync(film.out, { recursive: true });
    const mix = join(film.out, 'mix.wav');
    const mixSig = existsSync(mix) ? `${statSync(mix).mtimeMs.toFixed(0)}:${statSync(mix).size}` : 'none';
    const muxKey = sha(`v${CACHE_VERSION}|${quality}|${f}|${mixSig}|${partials.map((p) => `${p.scene.id}:${sha(readFileSync(p.mp4))}`).join('|')}`);
    const muxCache = join(SCENE_CACHE, 'mux', muxKey);
    if (!noCache && existsSync(join(muxCache, 'out.mp4'))) {
      copyFileSync(join(muxCache, 'out.mp4'), out);
      const dur = await secondsOf(out);
      results.push({ file: out, fmt: f, quality, scenes: partials.length, seconds: dur });
      continue;
    }
    const silent = join(SCRATCH, key, f, 'silent.mp4');
    const listFile = join(SCRATCH, key, f, 'list.txt');
    // SEAM TRUTH (critic round 2: audio sits exactly at timing.json while each clip carried the
    // PREVIOUS scenes' trailing waits — measured +0.40 s by s02, +1.96 s by s06; the payoff landed
    // 1.2 s after its word and -shortest truncated the recap hold). Each scene's clip is trimmed
    // to its OWN last-sentence end (frame-quantized): scenes butt at exact sentence boundaries and
    // the video length matches the narration bus. The LAST scene keeps its full tail (its hold).
    const timingAll2 = timingAll;
    // A/V seam truth (critic r7, measured: video led the voice 0.15s->0.75s across the film):
    // the narration bus keeps the 0.15s inter-sentence gaps BETWEEN scenes too, so each clip must
    // run to the NEXT scene's first-sentence start (not its own last-sentence end — that drops the
    // gaps from the picture only). The LAST scene keeps its full tail (its hold).
    const sceneEndAt = (sid, isLast) => {
      const sents = timingAll2?.sentences ?? [];
      const own = sents.filter((x) => x.scene === sid);
      if (!own.length) return null;
      if (isLast) return null;                       // keep the full tail
      const i = sents.indexOf(own.at(-1));
      const next = sents[i + 1];
      return next ? +(next.start - own[0].start).toFixed(3) : null;  // through the gap, to the next start
    };
    const trimmed = [];
    for (const p of partials) {
      const span = sceneEndAt(p.scene.id, p === partials.at(-1));
      const src = p.mp4;
      if (span == null) { trimmed.push(src); continue; }
      const dst = join(SCRATCH, key, f, `trim-${p.scene.id}.mp4`);
      const { out: fpsOut } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', src]);
      const [n_, d_] = fpsOut.trim().split('/').map(Number);
      const fps = n_ && d_ ? n_ / d_ : 30;
      const frames = Math.round(span * fps);
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-frames:v', String(frames), '-c', 'copy', dst]);
      trimmed.push(dst);
    }
    if (trimmed.length === 1) copyFileSync(trimmed[0], silent);
    else {
      writeFileSync(listFile, trimmed.map((m) => `file '${m.replace(/'/g, "'\\''")}'`).join('\n'));
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);
    }
    // The -color_* flags alone are NOT enough (measured, ffmpeg 8: primaries/transfer came out `unknown`,
    // SAR N/A): the encoder takes them from the frames, so setparams stamps them (as render.mjs does) and
    // setsar=1 gives the deliverable a SAR. Manim's partials are untagged yuv420p converted by PyAV with
    // swscale's default BT.601 matrix, so the scale CONVERTS 601->709 — a bare retag shifted a saturated
    // ink #C0452B to (202,78,38); the conversion keeps it at (188,65,39) vs (191,67,41) at the source.
    const vf = 'setsar=1,scale=in_color_matrix=bt601:in_range=tv:out_color_matrix=bt709:out_range=tv,' +
      'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
    const tags = ['-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart'];
    await run('ffmpeg', ['-y', '-v', 'error', '-i', silent,
      ...(existsSync(mix) ? ['-i', mix, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : []),
      ...tags, out]);
    if (!noCache) { // populate the mux cache (tmp + rename: a partial entry is never served)
      const tmp = `${muxCache}.tmp-${Date.now()}`;
      mkdirSync(join(SCENE_CACHE, 'mux'), { recursive: true });
      mkdirSync(tmp, { recursive: true });
      try { copyFileSync(out, join(tmp, 'out.mp4')); renameSync(tmp, muxCache); }
      catch { rmSync(tmp, { recursive: true, force: true }); }
    }
    const dur = await secondsOf(out);
    results.push({ file: out, fmt: f, quality, scenes: partials.length, seconds: dur });
  }
  // film.json duration = the first format's real length (all formats share the timeline)
  if (results.length && !scene) {
    const total = results[0].seconds;
    if (Math.abs((film.cfg.duration ?? 0) - total) > 0.01) {
      // duration is DERIVED data: keep film.json's mtime, or draftStale (math-cli.mjs) would see a "source"
      // newer than the draft it just made and every look would re-render (measured: the look check caught it)
      const fj = join(film.dir, 'film.json'), { atime, mtime } = statSync(fj);
      film.cfg.duration = +total.toFixed(3); writeJson(fj, film.cfg); utimesSync(fj, atime, mtime);
    }
  }
  rmSync(join(SCRATCH, key), { recursive: true, force: true }); // hygiene: scratch is disposable
  return results.map((r) => ({ ...r, ...counters }));
}

function find(dir, name) {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { const hit = find(p, name); if (hit) return hit; }
    else if (e.name === name) return p;
  }
  return null;
}

async function secondsOf(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim());
}

// -- the check run (no video; typesetting + claims + layout in a fraction of a render) ------
export async function checkMathFilm(key, { scene } = {}) {
  const film = readMathFilm(key);
  const rows = [];
  for (const s of scene ? film.scenes.filter((x) => x.id === scene) : film.scenes) {
    const work = join(SCRATCH, key, 'check', s.id); rmSync(work, { recursive: true, force: true });
    mkdirSync(join(work, 'records'), { recursive: true });
    const state = { format: film.cfg.formats[0], design: readJson(join(film.dir, 'design.json'), {}),
      timing: { sentences: [] }, records_dir: join(work, 'records'), claims_file: join(work, 'records', `${s.id}-claims.json`),
      scene: { id: s.id, file: s.file } };
    const stateFile = join(work, 'film_state.json'); writeJson(stateFile, state);
    const r = await new MemPool().run({
      cmd: pythonFor('manim'), args: ['-m', 'manim', 'render', s.file, 'Scene', '--dry_run',
        '--media_dir', work, '--resolution', '960,540', '--fps', '30'],
      memoryMb: CAPS.check, timeoutS: TIMEOUTS.check, cwd: work, label: `${key} ${s.id} check`,
      env: { STUDIO_FILM_STATE: stateFile, STUDIO_FORMAT: film.cfg.formats[0], PYTHONPATH: join(ROOT, 'engine', 'manim') },
    });
    if (r.killed) throw new Error(killedMessage(r, { film: key, scene: s.id, quality: 'check' }));
    if (r.code !== 0) rows.push({ scene: s.id, ok: false, error: cleanError(r) });
    else rows.push({ scene: s.id, ok: true, claims: readJson(join(work, 'records', `${s.id}-claims.json`), []).length });
  }
  rmSync(join(SCRATCH, key, 'check'), { recursive: true, force: true });
  return rows;
}

function cleanError(r) {
  // keep the traceback's most informative lines: the exception, the file:line, and the studio hint.
  // Progress-bar noise (\r-carriage "Animation N: …%|..." lines) is stripped first — one truncated
  // bar fragment was all the 4:5 failure showed the first time (the real traceback was in the tail).
  const lines = (r.err || r.out || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => !/Animation \d+|it\/s|it\]|s\/it\]|\s+\d+%\|/.test(l))
    .filter(Boolean);
  const pick = lines.filter((l) => /studio_manim|scenes\/|Error|error|Exception|line \d+|raise|typesetting failed|CLAIM|Traceback/i.test(l));
  return (pick.length ? pick : lines).slice(-10).join('\n');
}
