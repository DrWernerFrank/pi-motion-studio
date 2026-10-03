// math-cli.mjs — `studio new <key> --math`, `studio look` for math films (mission M5 slice), and the
// command glue. The render orchestrator lives in math.mjs; this file owns the film scaffold and the
// look pipeline (frames from the DRAFT — math films have no seek(t) page — re-rendered when stale).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderMathFilm, readMathFilm, checkMathFilm } from './math.mjs';
import { FILMS, fmtSlug, readJson, writeJson } from './lib/film.mjs';
import { run, runBuf } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export function createMathFilm(key, { title, formats, lang = 'en', voice } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key> --math: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error(`films/${key} already exists`);
  const tpl = join(ROOT, 'templates', 'math');
  if (!existsSync(join(tpl, 'film.json'))) throw new Error('templates/math/film.json is missing: the repo is incomplete');
  cpSync(tpl, dir, { recursive: true });
  const cfg = readJson(join(dir, 'film.json'));
  Object.assign(cfg, {
    title: title || key,
    formats: formats?.length ? formats : cfg.formats,
    lang, voice: voice || cfg.voice,
  });
  writeJson(join(dir, 'film.json'), cfg);
  return dir;
}

// -- studio look (math films) ---------------------------------------------------------------
// Frames come from the draft MP4 (ffmpeg), composed into one labelled sheet by a bare Chromium page
// (the same painter as stills.mjs, but without a film document — math films have no index.html).
export function mtimeOf(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }

export function draftStale(film, draft) {
  if (!existsSync(draft)) return true;
  const srcs = [
    ...film.scenes.map((s) => s.file),
    join(film.dir, 'design.json'), join(film.dir, 'film.json'), join(film.dir, 'script.md'),
    join(ROOT, 'engine', 'manim', 'requirements.lock'),
    ...readdirSync(join(ROOT, 'engine', 'manim', 'studio_manim')).filter((f) => f.endsWith('.py'))
      .map((f) => join(ROOT, 'engine', 'manim', 'studio_manim', f)),
  ].map(mtimeOf);
  return mtimeOf(draft) < Math.max(...srcs);
}

export function sceneMap(film, fmt) {
  // records/<fmt>/<scene>-timeline.json -> [{ scene, start, end }] (the look labels + `where`)
  const dir = join(film.dir, 'records', fmt);
  const out = [];
  let t = 0;
  for (const s of film.scenes) {
    const tl = readJson(join(dir, `${s.id}-timeline.json`), null);
    const dur = tl?.seconds ?? 0;
    out.push({ scene: s.id, start: t, end: t + dur, seconds: dur });
    t += dur;
  }
  return out;
}

function pickTimes(D, { mode = 'every', every = 0.5, times, at = 0, n = 12, max = 36 } = {}) {
  const clamp = (t) => Math.min(Math.max(0, t), Math.max(0, D - 0.05));
  if (mode === 'times') return (times || []).map((t) => ({ t: clamp(t), label: `${(+t).toFixed(2)}s` }));
  if (mode === 'strip') return Array.from({ length: n }, (_, i) => ({ t: clamp(at + i / 30), label: `${(at + i / 30).toFixed(2)}s` }));
  const step = mode === 'phone' ? 1 : every;
  const count = Math.min(max, Math.floor(D / step) || 1);
  const out = [];
  for (let i = 0; i < count; i++) out.push({ t: clamp(i * step + step / 2), label: `${(i * step + step / 2).toFixed(2)}s` });
  return out;
}

export async function lookMath(key, opts = {}) {
  const film = readMathFilm(key);
  const fmt = opts.fmt || film.cfg.formats[0];
  const mode = opts.mode || 'every';
  const draft = join(film.out, `draft-${fmt}.mp4`);
  if (draftStale(film, draft)) {
    await renderMathFilm(key, { quality: 'draft', fmt });
    film.cfg = readJson(join(film.dir, 'film.json')); // duration synced by the render
  }
  const D = film.cfg.duration || (JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', draft])).out));
  const moments = pickTimes(+D, { ...opts, mode });
  const width = opts.width || (mode === 'phone' ? 360 : moments.length > 12 ? 270 : 360);
  const smap = sceneMap(film, fmt);
  const sentenceAt = (t) => { // timing.json (P5) labels frames with the spoken sentence when present
    const timing = readJson(join(film.dir, 'timing.json'), null);
    if (!timing?.sentences) return '';
    const s = timing.sentences.find((x) => t >= x.start && t < x.end);
    return s ? ` · ${s.id} ${s.text.slice(0, 40)}` : '';
  };
  const frames = [];
  for (const m of moments) {
    const png = await runBuf('ffmpeg', ['-loglevel', 'error', '-ss', String(m.t), '-i', draft,
      '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
    const sc = smap.find((x) => m.t >= x.start && m.t < x.end);
    frames.push({ png: png.toString('base64'), label: `${m.label}${sc ? ` · ${sc.scene}` : ''}${sentenceAt(m.t)}` });
  }
  const file = await composeSheet(frames, {
    title: `${film.key} · ${fmt} · ${mode}${opts.title ? ' · ' + opts.title : ''}`,
    name: opts.name || `${mode}${mode === 'strip' ? '-' + (+opts.at).toFixed(2) : ''}-${fmtSlug(fmt)}`,
    out: join(film.out, 'sheets'),
  });
  return { file, count: frames.length, times: moments.map((m) => +m.t.toFixed(3)) };
}

// One labelled contact sheet from PNG buffers, painted by a bare Chromium page.
async function composeSheet(frames, { title, name, out }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body style="margin:0"><canvas></canvas></body>');
    const cols = Math.min(6, frames.length);
    const data = await page.evaluate(async ({ frames, cols, title }) => {
      const imgs = await Promise.all(frames.map((f) => new Promise((ok) => {
        const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + f.png;
      })));
      const w = imgs[0].width, h = imgs[0].height, gap = 8, lab = 26, head = 40;
      const rows = Math.ceil(imgs.length / cols);
      const c = document.querySelector('canvas');
      c.width = cols * w + (cols + 1) * gap; c.height = head + rows * (h + lab + gap) + gap;
      const x = c.getContext('2d');
      x.fillStyle = '#101012'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#e8e8ea'; x.font = '600 16px "JetBrains Mono", monospace'; x.fillText(title, gap + 2, 26);
      imgs.forEach((img, i) => {
        const cx = gap + (i % cols) * (w + gap), cy = head + Math.floor(i / cols) * (h + lab + gap);
        x.drawImage(img, cx, cy);
        x.strokeStyle = '#2c2c31'; x.lineWidth = 1; x.strokeRect(cx - 0.5, cy - 0.5, w + 1, h + 1);
        x.fillStyle = '#9a9aa2'; x.font = '12px "JetBrains Mono", monospace';
        x.fillText(frames[i].label, cx + 2, cy + h + 16);
      });
      return c.toDataURL('image/png');
    }, { frames, cols, title });
    mkdirSync(out, { recursive: true });
    const file = join(out, `${name}.png`);
    const { writeFileSync: wf } = await import('node:fs');
    wf(file, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    return file;
  } finally { await browser.close(); }
}

// `studio scene <film> <id>` and `studio check <film>` ride the same orchestrator.
export { renderMathFilm, checkMathFilm };
