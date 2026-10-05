// Caption exports (.srt / .vtt) from the SAME chunks the screen shows (mission D7): the file says what you see.
// Words come from the source's transcript, retimed onto the cut timeline (never re-transcribed).
import { readJson } from './lib/film.mjs';
import { loadEdit } from './lib/edit-store.mjs';
import { captionChunks } from './lib/captions.js';
import { retimeWords } from './lib/retime.mjs';
import { mediaDir } from './ingest.mjs';

const tc = (t, sep) => { const ms = Math.round((t % 1) * 1000), s = Math.floor(t); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`; };

export function timelineCues(filmKey, { maxChars = 42, maxGap = 0.35 } = {}) {
  const { film, edit } = loadEdit(filmKey);
  const from = edit.captions?.from ?? edit.tracks.find((t) => t.kind === 'video')?.clips[0]?.src;
  if (!from) throw new Error('no caption source: set edit.json captions.from or add a clip first');
  const doc = readJson(mediaDir(film, from).toString() && mediaDir(film, from) + '/transcript.json');
  if (!doc) throw new Error(`no transcript for "${from}": run \`studio transcribe ${filmKey} ${from}\` first`);
  const words = retimeWords(edit, from, doc.words);
  return { cues: captionChunks(words, { maxChars, maxGap }).map((c) => ({ ...c, lang: edit.captions?.lang ?? doc.language })), lang: edit.captions?.lang ?? doc.language, src: from };
}
export function toSrt(cues) { return cues.map((c, i) => `${i + 1}\n${tc(c.start, ',')} --> ${tc(c.end, ',')}\n${c.text}`).join('\n\n') + '\n'; }
export function toVtt(cues) { return 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${tc(c.start, '.')} --> ${tc(c.end, '.')}\n${c.text}`).join('\n\n') + '\n'; }
