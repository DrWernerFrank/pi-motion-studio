// narration.mjs — the narration data pipeline (mission M3): script.md -> sentences.json -> voice ->
// timing.json -> out/mix.wav. Narration is DATA: scenes read timing.json, never hard-code a time.
//
//   parseScript(key)            studio_manim/script.py (manim venv) -> films/<key>/sentences.json
//   buildVoice(key, {only})     piper per sentence (engine/manim/voice.py, ML venv), cached by content in
//                               ~/.cache/pi-motion-studio/voice/<sha256>/{audio.wav, words.json}, then timing.json
//   alignNarration(key, wav)    the human's own narration: engine/asr.py words matched to the sentences
//   buildMix(key)               the narration bus, sample-exact, two-pass loudnorm to mix.lufs (-16)
//
// timing.json (derived, never hand-edited):
//   { version, voice: "piper:<name>" | "human", length_scale, sample_rate, gap, gap_samples, duration, timing,
//     narration?: <wav, human only>,
//     sentences: [{ id, scene, text, spoken, start, end, start_sample, samples, words: [{w, start, end}],
//                   bookmarks: [{id, t, word}], audio?, hash? }] }   (times in seconds on the film clock)
// Sentences play in script order; sentence i starts GAP_S (0.15 s, rounded to whole samples) after the
// previous one ends, so start_sample_i = sum over j < i of (samples_j + gap_samples), exactly. A bookmark's
// t is the start of the first word after its span (the sentence end when the span closes the sentence).
//
// Every python process goes through runCapped (D-007), one at a time (a module-level queue).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCapped } from './lib/capped.mjs';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { pythonFor } from './doctor.mjs';
import { normalize } from './audio.mjs';
import { run, runBuf } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const VOICE_CACHE = join(homedir(), '.cache', 'pi-motion-studio', 'voice');
export const GAP_S = 0.15;
const SCRIPT_PY = join(ROOT, 'engine', 'manim', 'studio_manim', 'script.py');
const VOICE_PY = join(ROOT, 'engine', 'manim', 'voice.py');
const ASR_PY = join(ROOT, 'engine', 'asr.py');
const BATCH = 30; // sentences per piper process (keeps each call far under its 120 s budget)
// local models only: never let a hub library reach for the network
const OFFLINE = { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };

export const timingPath = (key) => join(FILMS, key, 'timing.json');
export const sentencesPath = (key) => join(FILMS, key, 'sentences.json');
const filmDir = (key) => {
  const d = join(FILMS, key);
  if (!existsSync(join(d, 'film.json'))) throw new Error(`no film.json in films/${key}`);
  return d;
};

// -- one python at a time ---------------------------------------------------------------------
let queue = Promise.resolve();
function py(kind, args, { label, timeoutS = 120 } = {}) {
  const job = queue.then(async () => {
    const r = await runCapped(pythonFor(kind), args, { memoryMb: 1024, timeoutS, label, env: OFFLINE });
    if (r.killed) throw new Error(`${label}: KILLED (${r.reason}) — the ${r.reason === 'memory' ? '1 GB memory cap' : `${timeoutS} s budget`} was exceeded`);
    return r;
  });
  queue = job.catch(() => {});
  return job;
}
const lastJson = (s) => { // the last JSON document printed on stdout
  const t = s.trim(), i = Math.max(t.lastIndexOf('\n{'), t.lastIndexOf('\n['));
  return JSON.parse(i >= 0 ? t.slice(i + 1) : t);
};

// -- film voice settings ------------------------------------------------------------------------
export function voiceOf(cfg) {
  const v = cfg.voice && typeof cfg.voice === 'object' ? cfg.voice : { voice: cfg.voice };
  let name = v.voice || v.name || (cfg.lang === 'fa' ? 'piper:fa_IR-amir-medium' : 'piper:en_US-ljspeech-medium');
  if (!name.includes(':')) name = `piper:${name}`;
  const [provider, model] = [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)];
  if (provider !== 'piper') throw new Error(`voice "${name}": only piper voices are wired (ADR-003); bring your own narration with alignNarration`);
  const length_scale = +(v.length_scale ?? cfg.length_scale ?? 1.0);
  return { name, model, length_scale };
}

// -- script -------------------------------------------------------------------------------------
export async function parseScript(key) {
  const dir = filmDir(key);
  const r = await py('manim', [SCRIPT_PY, dir], { label: `script ${key}`, timeoutS: 120 });
  let res;
  try { res = lastJson(r.out); } catch { throw new Error(`script ${key}: parser crashed\n${(r.err || r.out).trim().split('\n').slice(-6).join('\n')}`); }
  if (!res.ok) {
    const e = new Error(`films/${key}/script.md is invalid:\n  ${res.errors.join('\n  ')}`);
    e.errors = res.errors;
    throw e;
  }
  const doc = readJson(sentencesPath(key));
  return { sentences: doc.sentences, scenes: doc.scenes, lint: res.lint, warnings: res.warnings };
}

// -- wav i/o (PCM 16-bit mono; the voice cache's format) ----------------------------------------
export function readWav16(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${file}: not a RIFF wav`);
  let p = 12, fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`${file}: wanted mono 16-bit PCM`);
      const len = Math.min(n, b.length - p - 8) >> 1;
      return { sr: fmt.sr, pcm: new Int16Array(b.buffer.slice(b.byteOffset + p + 8, b.byteOffset + p + 8 + len * 2)) };
    }
    p += 8 + n + (n & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

export function writeWavF32(file, chans, sr) { // 32-bit float, 1 or 2 channels (headroom for the mixer)
  const C = chans.length, n = chans[0].length, b = Buffer.alloc(44 + n * 4 * C);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4 * C, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(C, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4 * C, 28); b.writeUInt16LE(4 * C, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4 * C, 40);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < C; c++, o += 4) b.writeFloatLE(chans[c][i], o);
  writeFileSync(file, b);
}

export function writeWav16(file, pcm, sr) {
  const n = pcm.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, n * 2).copy(b, 44);
  writeFileSync(file, b);
}

// -- the voice ----------------------------------------------------------------------------------
const sha = (s) => createHash('sha256').update(s).digest('hex');
let _engineSha = null;
const engineSha = () => (_engineSha ??= sha(readFileSync(VOICE_PY))); // a voice.py change re-voices (normalizer, level)

// The cache key: sha256(voice + text + length_scale) where text is BOTH the spoken text (words.json
// carries its tokens) and the exact text piper speaks (normalizer + this film's lexicon applied), plus
// voice.py itself. A lexicon edit therefore re-voices only the sentences it actually changes.
export async function voiceKeys(key, sentences, { cacheDir = VOICE_CACHE } = {}) {
  const dir = filmDir(key), cfg = readJson(join(dir, 'film.json')), v = voiceOf(cfg);
  const lex = join(dir, 'lexicon.json');
  mkdirSync(cacheDir, { recursive: true });
  const tmp = join(cacheDir, `.dry-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(sentences.map((s) => ({ text: s.spoken }))));
  try {
    const r = await py('ml', [VOICE_PY, '--dry', '--batch', tmp, ...(existsSync(lex) ? ['--lexicon', lex] : [])], { label: `voice-keys ${key}` });
    if (r.code !== 0) throw new Error(`voice.py --dry failed: ${r.err.trim().split('\n').slice(-4).join('\n')}`);
    const dry = lastJson(r.out);
    return sentences.map((s, i) => {
      const h = sha(JSON.stringify([v.name, s.spoken, dry[i].synth_text, v.length_scale, engineSha()]));
      return { id: s.id, hash: h, dir: join(cacheDir, h), synth: dry[i].synth_text, normalized: dry[i].text_normalized };
    });
  } finally { rmSync(tmp, { force: true }); }
}

export async function buildVoice(key, { only, cacheDir = VOICE_CACHE } = {}) {
  const dir = filmDir(key), cfg = readJson(join(dir, 'film.json')), v = voiceOf(cfg);
  const { sentences } = await parseScript(key);
  if (!sentences.length) throw new Error(`films/${key}/script.md has no sentences`);
  if (only && !sentences.some((s) => s.id === only)) throw new Error(`no sentence ${only} in films/${key}/script.md`);
  const keys = await voiceKeys(key, sentences, { cacheDir });
  // `only` forces that sentence to be voiced again (content-addressed: same text -> same samples);
  // every other sentence comes from the cache, voiced only if missing.
  if (only) rmSync(keys.find((k) => k.id === only).dir, { recursive: true, force: true });
  const todo = keys.filter((k) => !(existsSync(join(k.dir, 'audio.wav')) && existsSync(join(k.dir, 'words.json'))));
  const lex = join(dir, 'lexicon.json');
  const modelPath = join(homedir(), '.local', 'share', 'pi-motion-studio', 'models', 'piper', `${v.model}.onnx`);
  if (todo.length && !v.model.includes('/') && !existsSync(modelPath)) throw new Error(`voice ${v.name}: no model at ${modelPath} (studio doctor lists the installed voices)`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const part = todo.slice(i, i + BATCH);
    const jobs = join(cacheDir, `.jobs-${process.pid}.json`);
    writeFileSync(jobs, JSON.stringify(part.map((k) => ({ text: sentences.find((s) => s.id === k.id).spoken, out: k.dir }))));
    try {
      const r = await py('ml', [VOICE_PY, '--voice', v.model, '--batch', jobs, '--length-scale', String(v.length_scale),
        ...(existsSync(lex) ? ['--lexicon', lex] : [])], { label: `voice ${key} (${part.length} sentences)` });
      if (r.code !== 0) throw new Error(`voice ${key}: piper failed (${part.map((k) => k.id).join(', ')}):\n${r.err.trim().split('\n').slice(-6).join('\n')}`);
    } finally { rmSync(jobs, { force: true }); }
  }
  const timing = assembleTiming(sentences, keys, v);
  writeJson(timingPath(key), timing);
  return { ...timing, voiced: todo.map((k) => k.id) };
}

function assembleTiming(sentences, keys, v) {
  let sr = null, cursor = 0, gap = 0;
  const out = [];
  sentences.forEach((s, i) => {
    const k = keys[i], meta = JSON.parse(readFileSync(join(k.dir, 'words.json'), 'utf8'));
    if (sr === null) { sr = meta.sample_rate; gap = Math.round(GAP_S * sr); }
    if (meta.sample_rate !== sr) throw new Error(`sentence ${s.id}: sample rate ${meta.sample_rate} != ${sr}`);
    if (i > 0) cursor += gap;
    const start = cursor / sr, n = meta.samples, end = (cursor + n) / sr;
    const words = meta.words.map((w) => ({ w: w.w, start: +(start + w.start).toFixed(5), end: +(start + w.end).toFixed(5) }));
    const bookmarks = s.bookmarks.map((b) => ({ id: b.id, t: b.at_word < words.length ? words[b.at_word].start : +end.toFixed(6), word: b.at_word < words.length ? words[b.at_word].w : null }));
    out.push({ id: s.id, scene: s.scene, text: s.text, spoken: s.spoken, start: +start.toFixed(6), end: +end.toFixed(6),
      start_sample: cursor, samples: n, words, bookmarks, timing: meta.timing, audio: join(k.dir, 'audio.wav'), hash: k.hash });
    cursor += n;
  });
  const kinds = new Set(out.map((s) => s.timing));
  return { version: 1, voice: v.name, length_scale: v.length_scale, sample_rate: sr, gap: GAP_S, gap_samples: gap,
    duration: +(cursor / sr).toFixed(6), timing: kinds.size === 1 ? [...kinds][0] : 'mixed', sentences: out };
}

// -- words: the shared normalizer (alignment + the WER oracle) ----------------------------------
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
export function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  if (n < 1e6) return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
  return String(n).split('').map((d) => ONES[+d]).join(' ');
}
// lowercase, digits -> number words (12.5 -> twelve point five), punctuation and "and"-free hyphens out
export function normWords(text) {
  return String(text).toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\d+(\.\d+)?/g, (m) => {
      const [a, b] = m.split('.');
      return ` ${numberWords(+a)}${b ? ` point ${b.split('').map((d) => ONES[+d]).join(' ')}` : ''} `;
    })
    .replace(/[-–—/]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/).filter(Boolean);
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const similar = (a, b) => a === b || lev(a, b) <= Math.max(1, Math.floor(0.34 * Math.max(a.length, b.length)));

// Word-level edit-distance alignment (Levenshtein-tolerant substitutions): S, T arrays of strings ->
// pairs [i, j] of matched (similar) words, in order. A global alignment rather than a greedy walk: a
// short common word ("the") can never pull the match off course, and it is still linear in memory per row.
export function alignWords(S, T) {
  const n = S.length, m = T.length, W = m + 1;
  const D = new Float64Array((n + 1) * W), B = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) { D[i * W] = i; B[i * W] = 1; }
  for (let j = 1; j <= m; j++) { D[j] = j; B[j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = D[(i - 1) * W + j - 1] + (S[i - 1] === T[j - 1] ? 0 : similar(S[i - 1], T[j - 1]) ? 0.4 : 1);
      const del = D[(i - 1) * W + j] + 1, ins = D[i * W + j - 1] + 1;
      if (sub <= del && sub <= ins) { D[i * W + j] = sub; B[i * W + j] = 0; }
      else if (del <= ins) { D[i * W + j] = del; B[i * W + j] = 1; }
      else { D[i * W + j] = ins; B[i * W + j] = 2; }
    }
  }
  const pairs = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = B[i * W + j];
    if (i > 0 && j > 0 && b === 0) { if (similar(S[i - 1], T[j - 1])) pairs.push([i - 1, j - 1]); i--; j--; }
    else if (i > 0 && (j === 0 || b === 1)) i--;
    else j--;
  }
  return pairs.reverse();
}

export function wer(ref, hyp) {
  const r = normWords(ref), h = normWords(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return { wer: prev[h.length] / Math.max(1, r.length), ref: r.length, hyp: h.length, errors: prev[h.length] };
}

// -- bring your own narration -------------------------------------------------------------------
export async function alignNarration(key, wavPath) {
  const dir = filmDir(key), cfg = readJson(join(dir, 'film.json'));
  const wav = resolve(wavPath);
  if (!existsSync(wav)) throw new Error(`no narration file at ${wav}`);
  const { sentences } = await parseScript(key);
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate:format=duration', '-of', 'json', wav])).out);
  const sr = +probe.streams[0].sample_rate, dur = +probe.format.duration;
  mkdirSync(join(dir, 'out'), { recursive: true });
  const tr = join(dir, 'out', 'narration.transcript.json');
  // ASR is ~0.5-1x realtime on this CPU: the budget scales with the file (never under 120 s)
  const r = await py('ml', [ASR_PY, '--in', wav, '--out', tr, '--force', '--language', cfg.lang || 'auto'],
    { label: `asr ${key}`, timeoutS: Math.max(120, Math.ceil(dur * 1.5) + 60) });
  if (r.code !== 0 || !existsSync(tr)) throw new Error(`asr ${key} failed:\n${r.err.trim().split('\n').slice(-6).join('\n')}`);
  const T = readJson(tr).words;

  // the script side: each spoken token -> its normalized words (the voice normalizer, no lexicon)
  const tmp = join(dir, 'out', '.align-dry.json');
  writeFileSync(tmp, JSON.stringify(sentences.map((s) => ({ text: s.spoken }))));
  const dr = await py('ml', [VOICE_PY, '--dry', '--batch', tmp], { label: `align-normalize ${key}` }).finally(() => rmSync(tmp, { force: true }));
  const dry = lastJson(dr.out);
  const S = [], owner = []; // flattened script words and their [sentence, token]
  dry.forEach((d, si) => d.tokens.forEach((t, ti) => normWords(t.say).forEach((w) => { S.push(w); owner.push([si, ti]); })));
  const Tw = [], Towner = [];
  T.forEach((w, k) => normWords(w.text).forEach((x) => { Tw.push(x); Towner.push(k); }));
  const pairs = alignWords(S, Tw);

  // per token: the matched ASR words' extent; unmatched tokens are interpolated between neighbours
  const flat = []; // [{si, ti, start, end}]
  dry.forEach((d, si) => d.tokens.forEach((_, ti) => flat.push({ si, ti, start: null, end: null })));
  const idx = new Map(flat.map((f, i) => [`${f.si}:${f.ti}`, i]));
  for (const [i, j] of pairs) {
    const f = flat[idx.get(`${owner[i][0]}:${owner[i][1]}`)], w = T[Towner[j]];
    f.start = f.start === null ? w.start : Math.min(f.start, w.start);
    f.end = f.end === null ? w.end : Math.max(f.end, w.end);
  }
  // ASR word starts drift INTO the preceding silence or the previous word's tail (asr.py's refine moves a
  // start to an energy dip; measured 130-390 ms early at sentence starts). Two snaps, both measured on the
  // audio: a sentence's first word starts at the onset after the longest pause within -0.3..+0.6 s of the
  // ASR start (sentences are separated by pauses); any other word that starts in silence moves forward
  // to the first frame of speech, never past its own end.
  const env = await envelope(wav), hop = 0.01, N = env.db.length;
  const fr = (t) => Math.min(N - 1, Math.max(0, Math.floor(t / hop)));
  const loud = (t) => env.db[fr(t)] >= env.thr;
  flat.forEach((f, i) => {
    if (f.start === null) return;
    if (f.ti === 0) {
      const lo = fr(f.start - 0.3), hi = fr(f.start + 0.6);
      let best = null, runStart = null;
      for (let k = lo; k <= hi + 1; k++) {
        const quiet = k <= hi && env.db[k] < env.thr;
        if (quiet && runStart === null) runStart = k;
        // the file's start counts as an endless pause (the first sentence has no pause before it to find)
        const len = (a, b) => (a === 0 ? Infinity : b - a);
        if (!quiet && runStart !== null) { if (!best || len(runStart, k) > len(...best)) best = [runStart, k]; runStart = null; }
      }
      if (best && best[1] - best[0] >= (best[0] === 0 ? 1 : 5) && best[1] < hi + 1) { f.start = +(best[1] * hop).toFixed(3); f.end = Math.max(f.end, f.start + 0.05); return; }
    }
    if (loud(f.start)) return;
    for (let t = f.start; t < Math.min(f.end, f.start + 0.4); t += hop) if (loud(t)) { f.start = +t.toFixed(3); break; }
  });
  const matched = flat.filter((f) => f.start !== null).length;
  if (matched < flat.length * 0.5) throw new Error(`narration ${wavPath}: only ${matched}/${flat.length} script words were found in it — is it the narration of this script?`);
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].start !== null) continue;
    let j = i; while (j < flat.length && flat[j].start === null) j++;
    const a = i > 0 ? flat[i - 1].end : 0, b = j < flat.length ? flat[j].start : dur, k = j - i;
    for (let q = 0; q < k; q++) { flat[i + q].start = a + (b - a) * q / k; flat[i + q].end = a + (b - a) * (q + 1) / k; flat[i + q].interpolated = true; }
    i = j - 1;
  }
  const out = sentences.map((s, si) => {
    const toks = flat.filter((f) => f.si === si), spokenToks = dry[si].tokens;
    const words = toks.map((f) => ({ w: spokenToks[f.ti].w, start: +f.start.toFixed(4), end: +f.end.toFixed(4), ...(f.interpolated ? { matched: false } : {}) }));
    const start = words[0].start, end = words.at(-1).end;
    return { id: s.id, scene: s.scene, text: s.text, spoken: s.spoken, start, end,
      start_sample: Math.round(start * sr), samples: Math.round((end - start) * sr), words,
      bookmarks: s.bookmarks.map((b) => ({ id: b.id, t: b.at_word < words.length ? words[b.at_word].start : end, word: b.at_word < words.length ? words[b.at_word].w : null })),
      timing: 'asr' };
  });
  const timing = { version: 1, voice: 'human', narration: wav, sample_rate: sr, gap: null, gap_samples: null,
    duration: +dur.toFixed(6), timing: 'asr', matched: +(matched / flat.length).toFixed(4), sentences: out };
  writeJson(timingPath(key), timing);
  return timing;
}

// 10 ms energy envelope (dBFS) of any audio file at 16 kHz + a speech threshold (asr.py's noise-floor rule,
// floored at 35 dB under the speech level).
async function envelope(file) {
  const raw = await runBuf('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']);
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.length & ~3))), w = 160, n = Math.floor(x.length / w);
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * w; k < (i + 1) * w; k++) s += x[k] * x[k]; db[i] = 10 * Math.log10(s / w + 1e-12); }
  const sorted = [...db].sort((a, b) => a - b), pct = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const floor = pct(0.10), hi = pct(0.95);
  // asr.py's rule, floored at 35 dB under the speech level (a TTS gap is digital silence: floor ~ -120 dB)
  return { db, thr: Math.max(floor + Math.max(6, 0.3 * (hi - floor)), hi - 35) };
}

// -- the mix ------------------------------------------------------------------------------------
export async function buildMix(key) {
  const dir = filmDir(key), cfg = readJson(join(dir, 'film.json'));
  const timing = readJson(timingPath(key), null);
  if (!timing) throw new Error(`films/${key}/timing.json is missing: run studio voice ${key} first`);
  const target = cfg.mix?.lufs ?? -16;
  const narrEnd = timing.sentences.reduce((a, s) => Math.max(a, s.end), 0);
  let D = +cfg.duration || 0, warning = null;
  if (!D) D = narrEnd + 0.5;
  else if (D < narrEnd) { warning = `film duration ${D}s is shorter than the narration (${narrEnd.toFixed(2)}s): the mix runs to the narration end + 0.5 s`; D = narrEnd + 0.5; }
  mkdirSync(join(dir, 'out'), { recursive: true });
  const pre = join(dir, 'out', '.narration-premix.wav'), file = join(dir, 'out', 'mix.wav');
  if (timing.voice === 'human') {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', timing.narration, '-af', `apad=whole_dur=${D},atrim=0:${D}`, '-ac', '2', '-c:a', 'pcm_f32le', pre]);
  } else {
    const sr = timing.sample_rate, bus = new Float32Array(Math.round(D * sr));
    for (const s of timing.sentences) {
      const { sr: r, pcm } = readWav16(s.audio);
      if (r !== sr) throw new Error(`${s.id}: ${s.audio} is ${r} Hz, timing says ${sr}`);
      if (pcm.length !== s.samples) throw new Error(`${s.id}: audio has ${pcm.length} samples, timing says ${s.samples} (re-run studio voice ${key})`);
      for (let i = 0, o = s.start_sample; i < pcm.length && o < bus.length; i++, o++) bus[o] += pcm[i] / 32768;
    }
    writeWavF32(pre, [bus, bus], sr);
  }
  try {
    const r = await normalize(pre, file, target);
    return { file, lufs: r.lufs, truePeak: r.truePeak, duration: +D.toFixed(3), ...(warning ? { warning } : {}) };
  } finally { rmSync(pre, { force: true }); }
}

// voice cache entries (for the "one sentence re-voices alone" contract and `studio cache`)
export const voiceCacheEntries = (cacheDir = VOICE_CACHE) => existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => /^[0-9a-f]{64}$/.test(f)) : [];
