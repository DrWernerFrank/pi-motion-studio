// studio transcribe / studio transcript: the transcript is a contract (mission D5, ADR-002), never a provider.
//   transcribe: run the local ASR on an ingested source, cached by (media sha, model, language, refine) in the
//               source's media folder; a re-run is a cache hit; --force to redo.
//   transcript: read it back in chunks an agent can actually use (seconds ranges, grep, words/compact/srt).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mediaDir, readBin } from './ingest.mjs';
import { pythonFor } from './doctor.mjs';
import { readFilm, readJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';

export const transcriptFile = (film, id) => join(mediaDir(film, id), 'transcript.json');
const hashKey = (bin, id, model, language, refine) => `${bin.sources[id].sha256.slice(0, 16)}:${model}:${language}:${refine}`;

export async function transcribe(filmKey, id, { model = 'small', language = 'auto', refine = true, force = false, log = () => {} } = {}) {
  const film = readFilm(filmKey), bin = readBin(film);
  if (!bin.sources[id]) throw new Error(`no source "${id}" in the media bin: studio ingest ${filmKey} <file> --id ${id} first`);
  const out = transcriptFile(film, id), key = hashKey(bin, id, model, language, refine ? 'on' : 'off');
  const existing = readJson(out, null);
  if (!force && existing && existing.__key === key) { log(`transcript: cached (${existing.words.length} words, ${existing.model})`); return { ...existing, cached: true, file: out }; }
  if (!bin.sources[id].has_audio) throw new Error(`source "${id}" has no audio to transcribe`);
  const wav = join(mediaDir(film, id), 'audio.wav');
  const script = join(await import('node:path').then((p) => p.dirname(new URL('.', import.meta.url).pathname).replace(/\/$/, '')), 'asr.py');
  await run(pythonFor('ml'), [script, '--in', wav, '--out', out, '--model', model, '--language', language, '--refine', refine ? 'on' : 'off', ...(force ? ['--force'] : [])]);
  const doc = readJson(out, null);
  if (!doc) throw new Error('transcription failed (asr.py wrote nothing)');
  const withKey = { ...doc, __key: key };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, JSON.stringify(withKey, null, 1) + '\n');
  log(`transcribe ${id}: ${withKey.words.length} words, lang ${withKey.language} (${withKey.language_probability}) -> ${out.replace(film.dir + '/', '')}`);
  return { ...withKey, cached: false, file: out };
}

// ── the reader: seconds ranges, grep, and formats ─────────────────────────────────────────────────────────────────
const tc = (t) => { const ms = Math.round((t % 1) * 1000), s = Math.floor(t); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };

export function readTranscript(filmKey, id, { from, to, grep, format = 'compact' } = {}) {
  const film = readFilm(filmKey), doc = readJson(transcriptFile(film, id));
  if (!doc) throw new Error(`no transcript for source "${id}": run \`studio transcribe ${filmKey} ${id}\` first`);
  let words = doc.words.map((w) => ({ ...w }));
  if (from !== undefined) words = words.filter((w) => w.end > from);
  if (to !== undefined) words = words.filter((w) => w.start < to);
  if (grep) { const re = new RegExp(grep, 'i'); words = words.filter((w) => re.test(w.text)); }
  if (!words.length) throw new Error(`no words ${from ?? 0}${to ? `-${to}` : ''}${grep ? ` matching "${grep}"` : ''} in ${id}'s transcript`);
  if (format === 'words') return words.map((w) => `${w.start.toFixed(2).padStart(8)} ${w.end.toFixed(2).padStart(8)} ${w.confidence.toFixed(2)} ${w.text}`).join('\n');
  if (format === 'srt') { // one cue per sentence-ish run: break at . ! ? or a gap > 0.6 s, max ~10 words
    const cues = []; let cur = [];
    for (const w of words) { const prev = cur.at(-1); if (cur.length >= 10 || (prev && w.start - prev.end > 0.6) || /[.!?]$/.test(prev?.text || '')) { if (cur.length) cues.push(cur); cur = []; } cur.push(w); }
    if (cur.length) cues.push(cur);
    return cues.map((c, i) => `${i + 1}\n${tc(c[0].start)} --> ${tc(c.at(-1).end)}\n${c.map((w) => w.text).join(' ')}`).join('\n\n');
  }
  // compact: one line per ~8 words with the time range, the format an agent reads by eye
  const lines = []; let cur = [];
  for (const w of words) { const prev = cur.at(-1); if (cur.length >= 8 || (prev && w.start - prev.end > 0.6)) { lines.push(cur); cur = []; } cur.push(w); }
  if (cur.length) lines.push(cur);
  return lines.map((l) => `${l[0].start.toFixed(2).padStart(8)}-${l.at(-1).end.toFixed(2).padStart(8)}  ${l.map((w) => w.text).join(' ')}`).join('\n');
}
void existsSync; void statSync; void readFileSync;
