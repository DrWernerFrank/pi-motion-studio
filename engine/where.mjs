// where.mjs — `studio where <film> <t>`: which scene, sentence, animation and file owns a timecode
// (mission M5). A note pinned at 49.27 s must lead straight to the code. The truth is the records
// (trace/timeline per scene+format) + timing.json; this module resolves it and the CLI/GUI share it.
//
// Semantics (the `where` check re-derives each of these from the records independently and asserts
// agreement — engine/verify/math/where.mjs):
//   scene      records/<fmt>/<scene>-timeline.json `seconds`, cumulatively (sceneMap) — PER FORMAT
//              (a portrait scene may round its waits differently, so boundaries are fmt-local).
//   sentence   timing.json: the sentence whose [start, end) contains t; between sentences (the
//              0.15 s bus gaps, scene tails) the one that was last spoken (the last with start <= t).
//   animation  the trace entry PLAYING at t: the first animation whose recorded END is >= the
//              scene-relative t (the recorder stamps renderer.time AFTER the play, so a trace
//              `t` is the animation's END — measured on mathdemo: a Write of run_time 0.9 records
//              t 0.9). Its `start` is the previous entry's end (renders are back-to-back); before
//              the first entry the first, past the last entry the last.
//   file       scenes/<scene>.py; `line` is the trace's `source_line` when the recorder stamps it
//              (it does not yet — recorder.py's docstring promises it, the animation frames lack
//              it; until it does, line is null rather than guessed from the source).
import { join } from 'node:path';
import { readMathFilm } from './math.mjs';
import { readJson } from './lib/film.mjs';

export function sceneMap(key, fmt) {
  const film = readMathFilm(key);
  const f = fmt || film.cfg.formats[0];
  const out = [];
  let t = 0;
  for (const s of film.scenes) {
    const dur = readJson(join(film.dir, 'records', f, `${s.id}-timeline.json`), {})?.seconds ?? 0;
    out.push({ scene: s.id, start: t, end: t + dur, seconds: dur });
    t += dur;
  }
  return out;
}

export function resolveWhere(key, t, fmt) {
  const film = readMathFilm(key);
  const f = fmt || film.cfg.formats[0];
  const recDir = join(film.dir, 'records', f);
  const map = sceneMap(key, f);
  const inScene = map.find((x) => t >= x.start && t < x.end) || map.at(-1);
  if (!inScene) return { error: `no scenes in films/${key}/records — render first` };
  const sceneT = +(t - inScene.start).toFixed(3);
  const timing = readJson(join(film.dir, 'timing.json'), {});
  const sents = timing.sentences ?? [];
  const sentence = sents.find((s) => t >= s.start && t < s.end)
    || sents.filter((s) => s.start <= t).at(-1) || null; // between sentences: the last spoken
  const trace = readJson(join(recDir, `${inScene.scene}-trace.json`), []);
  const anims = trace.filter((e) => e.kind === 'animation');
  // the entry playing at scene_t: the first whose END has not passed (trace order is chronological)
  let ix = anims.findIndex((a) => a.t >= sceneT - 1e-9);
  if (ix < 0) ix = anims.length - 1; // past the last recorded end: the last entry owns the tail
  const a = anims[ix] || null;
  const animation = a ? {
    i: a.i, name: a.animation, t: a.t,
    start: +(anims[ix - 1]?.t ?? 0).toFixed(3), // back-to-back: the previous end is this one's start
  } : null;
  const bookmark = (trace.filter((e) => e.kind === 'bookmark'))
    .find((b) => Math.abs(b.t - t) < 0.75) || null; // the bookmark whose window t sits in
  const overrun = trace.some((e) => e.kind === 'overrun' && Math.abs(e.t - sceneT) < 1.0);
  return {
    film: key, fmt: f, t: +(+t).toFixed(3), scene: inScene.scene, scene_t: sceneT,
    sentence: sentence ? { id: sentence.id, text: sentence.text, start: sentence.start, end: sentence.end } : null,
    animation, bookmark: bookmark ? { id: bookmark.id, t: bookmark.t, sentence: bookmark.sentence } : null,
    file: `scenes/${inScene.scene}.py`,
    line: a?.source_line ?? null,
    overrun,
  };
}

export function resolveNote(key, note) {
  // a notes.json entry { t, fmt, text } — the same resolution the GUI's Notes tab needs
  return { note: { id: note.id, t: note.t, fmt: note.fmt, text: note.text }, ...resolveWhere(key, note.t, note.fmt) };
}
