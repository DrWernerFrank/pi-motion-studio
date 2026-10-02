// montage: `autoedit --preset montage` on clips12 + song: every cut lands within 1 frame of a beat in
// beats.json, no clip is used twice, the duration is the target +/- 1 beat.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { autoedit } from '../autoedit.mjs';
import { loadEdit } from '../lib/edit-store.mjs';
import { grid, timelineFrames, timelineSeconds } from '../lib/edit-ops.mjs';
import { FILMS } from '../lib/film.mjs';

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const KEY = 'gp-montage-chk', TARGET = 20;
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  try {
    // the preset takes the clips AND the song as sources (its own error message says so)
    const clipsDir = join(fixturePath('clips12'), '..'); // fixturePath gives clip01.mp4: the DIR is its parent
    const clipFiles = (await import('node:fs')).readdirSync(clipsDir).filter((f) => f.endsWith('.mp4')).sort().map((f) => join(clipsDir, f));
    await autoedit(KEY, { preset: 'montage', srcs: [...clipFiles, fixturePath('song')], target: TARGET, log: () => {} });
    // the clips: ingest the 12 (the preset does it itself via --src? drive it exactly like the check: the preset receives the clip folder through its own API - read autoedit's report of how montage finds clips)
    const { readFilm } = await import('../lib/film.mjs');
    const film = readFilm(KEY), edit = loadEdit(KEY).edit, G = grid(edit);
    const beats = JSON.parse(readFileSync(join(film.dir, 'beats.json'), 'utf8')).beats;
    const v1 = edit.tracks.find((t) => t.kind === 'video');
    const used = v1.clips.map((c) => c.src);
    // no clip source used twice (a source can be many files; montage clips are 12 distinct ids)
    const dupes = used.filter((x, i) => used.indexOf(x) !== i);
    need(dupes.length === 0, `sources used twice: ${dupes.join(', ')}`);
    // every cut within 1 frame of a beat
    // the preset shifts the song so its FIRST beat is t=0 (the song rides A1 from its own first beat):
    // a cut at timeline `at` lands on song-time at + beats[0]. The check compares against THAT.
    const start = beats[0];
    const beatsF = beats.map((b) => Math.round((b - start) * G.fps.num / G.fps.den));
    const off = [];
    for (const c of v1.clips) { const f = Math.round(c.at * G.fps.num / G.fps.den); if (!beatsF.some((b) => Math.abs(b - f) <= 1)) off.push(`${c.id}@${c.at.toFixed(2)}s`); }
    need(off.length === 0, `cuts off the beat grid: ${off.slice(0, 5).join(', ')}`);
    // duration = target +/- 1 beat
    const beatLen = beats.length > 1 ? (beats[1] - beats[0]) : 0.5;
    const D = timelineSeconds(edit);
    need(Math.abs(D - TARGET) <= beatLen + 1e-9, `duration ${D.toFixed(2)}s vs target ${TARGET}s (+-1 beat ${beatLen.toFixed(2)}s)`);
    facts.push(`${v1.clips.length} cuts, all within 1 frame of a beat, no source twice, ${D.toFixed(2)}s (target ${TARGET})`);
  } catch (e) {
    bad.push(String(e.message || e).split('\n')[0].slice(0, 160));
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
