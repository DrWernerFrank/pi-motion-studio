// math.mjs — the math-film orchestrator (mission M4, first slice of P2).
// Per scene+format: a scratch media dir (ADR-004's race fix), a generated film_state.json the scene
// reads (design, format, timing slice), one `manim render` through the memory guard (capped.mjs —
// D-007: nothing here can ever take the machine down), then a lossless concat and a single mux
// with bt709 tags (Manim's own MP4s carry none — measured in ADR-004).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CAPS, TIMEOUTS, MemPool, killedMessage } from './lib/capped.mjs';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { pythonFor } from './doctor.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const SCRATCH = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'math');
export const FORMATS = { // studio geometry (short side 8 units — studio_manim/layout.py agrees)
  '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350],
};

export function readMathFilm(key) {
  const dir = existsSync(join(FILMS, key)) ? join(FILMS, key) : null;
  if (!dir || !existsSync(join(dir, 'film.json'))) throw new Error(`no film.json in films/${key}`);
  const cfg = readJson(join(dir, 'film.json'));
  if (cfg.kind !== 'math') throw new Error(`films/${key} is kind=${cfg.kind}, not math`);
  const sceneFiles = existsSync(join(dir, 'scenes'))
    ? readdirSync(join(dir, 'scenes')).filter((f) => f.endsWith('.py')).sort()
    : [];
  return { key, dir, out: join(dir, 'out'), cfg, scenes: sceneFiles.map((f) => ({
    id: f.replace(/\.py$/, ''), file: join(dir, 'scenes', f),
  })) };
}

const sceneId = (f) => f.replace(/\.py$/, '');

// -- the render ---------------------------------------------------------------------------
export async function renderMathFilm(key, { quality = 'draft', fmt, from, scene } = {}) {
  const film = readMathFilm(key);
  const formats = fmt ? [fmt] : film.cfg.formats;
  if (film.scenes.length === 0) throw new Error(`films/${key}/scenes/ holds no .py files: nothing to render`);
  const pool = new MemPool();
  const results = [];
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

    const partials = [];
    for (const s of wanted) {
      const work = join(SCRATCH, key, f, s.id);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      const records = join(work, 'records'); mkdirSync(records, { recursive: true });
      const state = {
        format: f, design: readJson(join(film.dir, 'design.json'), {}),
        timing: { sentences: readJson(join(film.dir, 'timing.json'), {}).sentences ?? [] },
        records_dir: records, claims_file: join(records, `${s.id}-claims.json`),
        scene: { id: s.id, file: s.file },
      };
      const stateFile = join(work, 'film_state.json'); writeJson(stateFile, state);
      const r = await pool.run({
        cmd: pythonFor('manim'), args: ['-m', 'manim', 'render', s.file, 'Scene',
          '--media_dir', work, '-o', `${s.id}.mp4`, '--fps', String(fps), '--resolution', `${px[0]},${px[1]}`],
        memoryMb: capMb, timeoutS, cwd: work, label: `${key} ${s.id} ${f}`,
        env: { STUDIO_FILM_STATE: stateFile, STUDIO_FORMAT: f, PYTHONPATH: join(ROOT, 'engine', 'manim') },
      });
      if (r.killed || r.code !== 0) {
        const msg = r.killed ? killedMessage(r, { film: key, scene: s.id, fmt: f, quality })
          : `${key} scene ${s.id} ${f} (${quality}) failed:\n${cleanError(r)}`;
        throw new Error(msg);
      }
      const mp4 = find(join(work, 'videos'), `${s.id}.mp4`);
      if (!mp4) throw new Error(`manim produced no ${s.id}.mp4 under ${work}/videos (cwd ${work})\n${(r.err || '').split('\n').slice(-8).join('\n')}`);
      partials.push({ scene: s, mp4, records, work });
    }
    if (!partials.length) continue;

    // records into the film folder (derived, small, the lint + `where` + GUI read them)
    const recDir = join(film.dir, 'records', f); mkdirSync(recDir, { recursive: true });
    for (const p of partials) for (const x of readdirSync(p.records)) copyFileSync(join(p.records, x), join(recDir, x));

    // concat the scene partials losslessly, then ONE transcode with the delivery tags
    const silent = join(SCRATCH, key, f, 'silent.mp4');
    const listFile = join(SCRATCH, key, f, 'list.txt');
    if (partials.length === 1) copyFileSync(partials[0].mp4, silent);
    else {
      writeFileSync(listFile, partials.map((p) => `file '${p.mp4.replace(/'/g, "'\\''")}'`).join('\n'));
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);
    }
    const out = join(film.out, `${quality}-${f}.mp4`); mkdirSync(film.out, { recursive: true });
    const mix = join(film.out, 'mix.wav');
    const tags = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart'];
    await run('ffmpeg', ['-y', '-v', 'error', '-i', silent,
      ...(existsSync(mix) ? ['-i', mix, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : []),
      ...tags, out]);
    const dur = await secondsOf(out);
    results.push({ file: out, fmt: f, quality, scenes: partials.length, seconds: dur });
  }
  // film.json duration = the first format's real length (all formats share the timeline)
  if (results.length && !scene) {
    const total = results[0].seconds;
    if (Math.abs((film.cfg.duration ?? 0) - total) > 0.01) {
      film.cfg.duration = +total.toFixed(3); writeJson(join(film.dir, 'film.json'), film.cfg);
    }
  }
  rmSync(join(SCRATCH, key), { recursive: true, force: true }); // hygiene: scratch is disposable
  return results;
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
