// where.mjs — `studio where <film> <t>`: which scene, sentence, animation and file owns a timecode
// (mission M5). A note pinned at 49.27 s must lead straight to the code. The truth is the records
// (trace/timeline per scene+format) + timing.json; this module resolves it and the CLI/GUI share it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMathFilm } from './math.mjs';
import { readJson } from './lib/film.mjs';

export function sceneMap(key) {
  const film = readMathFilm(key);
  const out = [];
  let t = 0;
  for (const s of film.scenes) {
    const dur = readJson(join(film.dir, 'records', film.cfg.formats[0], `${s.id}-timeline.json`), {})?.seconds ?? 0;
    out.push({ scene: s.id, start: t, end: t + dur, seconds: dur });
    t += dur;
  }
  return out;
}

export function resolveWhere(key, t, fmt) {
  const film = readMathFilm(key);
  const f = fmt || film.cfg.formats[0];
  const recDir = join(film.dir, 'records', f);
  const map = sceneMap(key);
  const inScene = map.find((x) => t >= x.start && t < x.end) || map.at(-1);
  if (!inScene) return { error: `no scenes in films/${key}/records — render first` };
  const sceneT = +(t - inScene.start).toFixed(3);
  const timing = readJson(join(film.dir, 'timing.json'), {});
  const sentence = (timing.sentences ?? []).find((s) => t >= s.start && t < s.end)
    || (timing.sentences ?? []).filter((s) => s.scene === inScene.scene).at(-1) || null;
  const trace = readJson(join(recDir, `${inScene.scene}-trace.json`), []);
  const anims = trace.filter((e) => e.kind === 'animation');
  let animation = null, dBest = Infinity;
  for (const a of anims) { const d = Math.abs(a.t - sceneT); if (d <= dBest) { dBest = d; animation = a; } }
  const bookmark = (trace.filter((e) => e.kind === 'bookmark'))
    .find((b) => Math.abs(b.t - t) < 0.75) || null; // the bookmark whose window t sits in
  const overrun = trace.some((e) => e.kind === 'overrun' && Math.abs(e.t - sceneT) < 1.0);
  return {
    film: key, fmt: f, t: +(+t).toFixed(3), scene: inScene.scene, scene_t: sceneT,
    sentence: sentence ? { id: sentence.id, text: sentence.text, start: sentence.start, end: sentence.end } : null,
    animation: animation ? { i: animation.i, name: animation.animation, t: animation.t } : null,
    bookmark: bookmark ? { id: bookmark.id, t: bookmark.t, sentence: bookmark.sentence } : null,
    file: `scenes/${inScene.scene}.py`,
    line: animation?.source_line ?? null,
    overrun,
  };
}

export function resolveNote(key, note) {
  // a notes.json entry { t, fmt, text } — the same resolution the GUI's Notes tab needs
  return { note: { id: note.id, t: note.t, fmt: note.fmt, text: note.text }, ...resolveWhere(key, note.t, note.fmt) };
}
