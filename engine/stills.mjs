// Contact sheets straight from seek(t): no video encode, seconds not minutes.
// This is the "look at your own frames" loop. Sheets land in films/<key>/out/sheets/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeClip, clipFrames, grid, mapFrame } from './lib/edit-ops.mjs';
import { fmtSlug, openStudio, readFilm, readJson, stillPng } from './lib/film.mjs';

// Pick the moments to look at. Returns [{ t, label }]. Async: the timeline (edit films' edit.json —
// the kind's `timeline` hook, ADR-001) is loaded through the kind registry.
export async function pickTimes(film, { mode = 'every', every = 0.5, times, at = 0, n = 12, max = 36 } = {}) {
  const { cfg, dir } = film, D = cfg.duration, fps = film.fps.value;
  const clampT = (t) => Math.min(Math.max(0, t), D - 1 / fps);
  const edit = (await (await import('./kinds/registry.mjs')).hooksFor(film)).timeline?.(film) ?? null;
  let out;
  if (mode === 'cuts') {
    // both sides of every cut on the video tracks: the last frame of the clip that ends and the first of the one that starts
    if (!edit) throw new Error('mode "cuts" is for edit films (films with an edit.json)');
    const { F, S } = grid(edit), pts = [];
    for (const t of edit.tracks.filter((x) => x.kind === 'video')) {
      const cs = [...t.clips].sort((a, b) => F(a.at) - F(b.at));
      cs.forEach((c, i) => { const end = F(c.at) + clipFrames(edit, c), nx = cs[i + 1]; if (nx && F(nx.at) === end) pts.push(end - 1, end); });
    }
    const uniq = [...new Set(pts)].slice(0, max);
    if (!uniq.length) throw new Error('no cuts to look at: the timeline has fewer than two adjacent clips');
    out = uniq.map((k) => ({ t: clampT(S(k) + 0.5 / fps), label: '' }));
  } else
  if (mode === 'times') out = (times || []).map((t) => ({ t: clampT(t), label: `${(+t).toFixed(2)}s` }));
  else if (mode === 'strip') out = Array.from({ length: n }, (_, i) => ({ t: clampT(at + i / fps), label: `${(at + i / fps).toFixed(3)}s` }));
  else if (mode === 'beats') {
    const grid = readJson(join(dir, 'beats.json'));
    if (!grid) throw new Error('no beats.json yet: run `studio beats <film>` (or `studio grid`) first');
    let b = grid.beats.filter((t) => t < D);
    const step = Math.ceil(b.length / max);
    // Look slightly after each beat: that is where the hit's motion is visible.
    out = b.filter((_, i) => i % step === 0).map((t, i) => ({ t: clampT(t + 0.12), label: `beat ${i * step + 1} · ${t.toFixed(2)}s` }));
  } else if (mode === 'shots') {
    const shots = cfg.shots || [];
    if (!shots.length) throw new Error('film.json has no "shots": [{ "t": 0, "name": "hook" }, ...]');
    out = shots.map((s, i) => {
      const end = shots[i + 1]?.t ?? D;
      return { t: clampT(s.t + (end - s.t) * 0.6), label: `${s.name} · ${(s.t + (end - s.t) * 0.6).toFixed(2)}s` };
    });
  } else {
    const count = Math.min(max, Math.floor(D / every));
    const step = D / count;
    out = Array.from({ length: count }, (_, i) => ({ t: clampT(i * step + step / 2), label: `${(i * step + step / 2).toFixed(2)}s` }));
  }
  if (edit) { // say which source timecode each frame shows
    const { F, S } = grid(edit), v = edit.tracks.find((x) => x.kind === 'video');
    out = out.map((m) => { const k = Math.floor(m.t * film.fps.num / film.fps.den + 1e-6), c = v && activeClip(edit, v, k); return { ...m, label: `${m.label ? m.label + ' · ' : `${m.t.toFixed(2)}s · `}${c ? `${c.id} ${c.src} ${S(mapFrame(edit, c, k)).toFixed(2)}s` : 'gap'}` }; });
  }
  return out;
}

// Render the moments at `width` px wide, tile into one labelled PNG. Returns { file, count, times }.
export async function contactSheet(key, opts = {}) {
  const film = readFilm(key);
  const fmt = opts.fmt || film.cfg.formats[0];
  const moments = await pickTimes(film, opts);
  const [W] = { '9:16': [1080], '1:1': [1080], '16:9': [1920], '4:5': [1080] }[fmt];
  const width = opts.width || (moments.length > 12 ? 270 : 360);
  const studio = await openStudio();
  try {
    const page = await studio.page(film, fmt, width / W);
    const frames = [];
    for (const m of moments) frames.push({ ...m, png: (await stillPng(page, m.t)).toString('base64') });
    if (studio.errors.length) throw new Error('film threw:\n' + studio.errors.slice(0, 5).join('\n'));
    const cols = opts.cols || (opts.mode === 'strip' ? Math.min(12, frames.length) : Math.min(6, frames.length));
    const title = `${film.key} · ${fmt} · ${opts.mode || 'every'}${opts.title ? ' · ' + opts.title : ''}`;
    const sheet = await studio.page(film, fmt, width / W); // reuse origin; we paint over it
    const png = await sheet.evaluate(async ({ frames, cols, title }) => {
      const imgs = await Promise.all(frames.map((f) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + f.png; })));
      const w = imgs[0].width, h = imgs[0].height, gap = 8, lab = 26, head = 40;
      const rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * w + (cols + 1) * gap; c.height = head + rows * (h + lab + gap) + gap;
      const x = c.getContext('2d');
      x.fillStyle = '#101012'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#e8e8ea'; x.font = '600 16px "JetBrains Mono", monospace'; x.fillText(title, gap + 2, 26);
      imgs.forEach((img, i) => {
        const cx = gap + (i % cols) * (w + gap), cy = head + Math.floor(i / cols) * (h + lab + gap);
        x.drawImage(img, cx, cy);
        x.strokeStyle = '#2c2c31'; x.lineWidth = 1; x.strokeRect(cx - 0.5, cy - 0.5, w + 1, h + 1);
        x.fillStyle = '#9a9aa2'; x.font = '13px "JetBrains Mono", monospace'; x.fillText(frames[i].label, cx + 2, cy + h + 18);
      });
      return c.toDataURL('image/png');
    }, { frames: frames.map(({ label }, i) => ({ label, png: frames[i].png })), cols, title });
    const dir = join(film.out, 'sheets'); mkdirSync(dir, { recursive: true });
    const name = opts.name || `${opts.mode || 'every'}${opts.mode === 'strip' ? '-' + (+opts.at).toFixed(2) : ''}-${fmtSlug(fmt)}${opts.width ? '-' + opts.width : ''}`;
    const file = join(dir, `${name}.png`);
    writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    return { file, count: frames.length, times: moments.map((m) => +m.t.toFixed(3)) };
  } finally { await studio.close(); }
}

// One full-resolution frame (poster, thumbnail, close inspection).
export async function poster(key, { at = 0, fmt, name = 'poster' } = {}) {
  const film = readFilm(key);
  fmt ||= film.cfg.formats[0];
  const studio = await openStudio();
  try {
    const page = await studio.page(film, fmt, 1);
    const file = join(film.out, `${name}-${fmtSlug(fmt)}.png`);
    writeFileSync(file, await stillPng(page, at));
    if (studio.errors.length) throw new Error('film threw:\n' + studio.errors.slice(0, 5).join('\n'));
    return { file };
  } finally { await studio.close(); }
}
