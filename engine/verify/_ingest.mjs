// Shared by the ingest checks: one temp film, every fixture ingested once per verify run (modules are cached by the importer).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { ingestSource, mediaDir } from '../ingest.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';

export const SET = { sync: 'sync', vfr: 'vfr-rotated', hlg: 'hlg', noaudio: 'noaudio', podcast: 'podcast', real: 'real-talking-head' };
let done = null;

export function tempFilm(key, cfg = {}) {
  const dir = join(FILMS, key); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'film.json'), JSON.stringify({ title: key, duration: 10, fps: 30, formats: ['16:9'], ...cfg }));
  return readFilm(key);
}

export async function ingestedSet() {
  if (done) return done;
  const film = tempFilm('verify-ingest'), out = {};
  for (const [id, fx] of Object.entries(SET)) {
    const t = Date.now(), r = await ingestSource('verify-ingest', fixturePath(fx), { id, log: () => {} });
    out[id] = { ...r, dir: mediaDir(film, id), wall: Date.now() - t };
  }
  return (done = { film, out });
}

export const ffprobeJson = async (f, extra = []) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', ...extra, '-of', 'json', f])).out);
