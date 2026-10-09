// Sound on the same timeline as the picture.
//   grid   film.json music.bpm → beats.json (no track)
//   beats  measure a supplied track with librosa → beats.json
//   sfx    cues.json → out/sfx.wav (synthesized one-shots)
//   music  film.json music → out/music.wav (synthesized score, seeded, deterministic)
//   mix    track|music + sfx → out/mix.wav at -14 LUFS, true peak -1 dB
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readFilm, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

const SR = 48000;

// ── wav i/o ─────────────────────────────────────────────────────────────────
export function writeWav(file, L, R = L) {
  const n = L.length, b = Buffer.alloc(44 + n * 8); // 32-bit float stereo: headroom for the mixer
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36); b.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { b.writeFloatLE(L[i], 44 + i * 8); b.writeFloatLE(R[i], 48 + i * 8); }
  writeFileSync(file, b);
}

// ── deterministic noise ─────────────────────────────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2147483648 - 1; }
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Add a mono voice into a stereo bus with constant-power pan (-1..1).
function addVoice(bus, start, len, fn, gain = 1, pan = 0) {
  const a = Math.max(0, Math.floor(start * SR)), n = Math.floor(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && a + i < bus.L.length; i++) { const v = fn(i / SR, i); bus.L[a + i] += v * gl; bus.R[a + i] += v * gr; }
}
const newBus = (secs) => ({ L: new Float32Array(Math.ceil(secs * SR)), R: new Float32Array(Math.ceil(secs * SR)) });

// ── SFX voices: [length s, fn(t, i, cue, noise)] ────────────────────────────
const VOICES = {
  click: [0.05, (t) => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90) * 0.5],
  tick: [0.03, (t, i, c, nz) => (nz() * 0.5 + Math.sin(2 * Math.PI * 3200 * t)) * Math.exp(-t * 220) * 0.35],
  pop: [0.15, (t) => Math.sin(2 * Math.PI * (600 + 900 * t) * t) * Math.exp(-t * 30) * 0.45],
  thump: [0.5, (t) => Math.sin(2 * Math.PI * (40 + 110 * Math.exp(-t * 18)) * t) * Math.exp(-t * 8) * 0.95],
  impact: [1.2, (t, i, c, nz) => Math.tanh(1.6 * (Math.sin(2 * Math.PI * (38 + 140 * Math.exp(-t * 14)) * t) * Math.exp(-t * 4)
    + nz() * Math.exp(-t * 11) * 0.5))],
  whoosh: [0.45, (t, i, c, nz, st) => { st.lp += (nz() - st.lp) * (0.02 + 0.25 * Math.sin(Math.PI * Math.min(1, t / (c.len || 0.45)))); return st.lp * Math.sin(Math.PI * Math.min(1, t / (c.len || 0.45))) * 1.4; }],
  swipe: [0.25, (t, i, c, nz, st) => { st.lp += (nz() - st.lp) * Math.max(0, 0.35 - t); return (nz() - st.lp) * Math.exp(-Math.pow((t - 0.08) / 0.05, 2)) * 0.5; }],
  riser: [2, (t, i, c, nz, st) => { const L = c.len || 2, p = Math.min(1, t / L); st.lp += (nz() - st.lp) * (0.01 + 0.3 * p * p); return (st.lp * 0.8 + Math.sin(2 * Math.PI * (200 + 900 * p * p) * t) * 0.12) * p * p * (t < L ? 1 : 0); }],
  type: [0.04, (t, i, c, nz) => nz() * Math.exp(-t * 300) * 0.4 + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 400) * 0.15],
  chime: [1.4, (t, i, c) => { const f = c.hz || 1320; return (Math.sin(2 * Math.PI * f * t + 2.2 * Math.sin(2 * Math.PI * f * 3.5 * t) * Math.exp(-t * 6)) * Math.exp(-t * 3.2)) * 0.3; }],
  glitch: [0.18, (t, i, c, nz) => (Math.floor(t * 180) % 2 ? nz() : Math.sign(Math.sin(2 * Math.PI * 220 * t))) * 0.25 * (1 - t / 0.18)],
  shutter: [0.12, (t, i, c, nz) => nz() * (Math.exp(-t * 120) + (t > 0.05 ? Math.exp(-(t - 0.05) * 140) : 0)) * 0.5],
  drop: [1.0, (t) => Math.sin(2 * Math.PI * (80 * Math.exp(-t * 1.5) + 30) * t) * Math.exp(-t * 2.2) * 0.9],
};

export function synthSfx(cues, duration) {
  const bus = newBus(duration + 2);
  for (const c of cues) {
    const v = VOICES[c.type];
    if (!v) throw new Error(`unknown cue type "${c.type}" at ${c.t}s. Known: ${Object.keys(VOICES).join(', ')}`);
    const nz = lcg(Math.round(c.t * 1000) + 7), st = { lp: 0 }, k = c.pitch ?? 1;
    addVoice(bus, c.t, (c.len || v[0]) + 0.05, (t, i) => v[1](t * k, i, c, nz, st), c.gain ?? 1, c.pan ?? 0);
  }
  return bus;
}

// ── music ───────────────────────────────────────────────────────────────────
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10] };
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

// "i", "VI", "iv7" → midi chord (root octave 3) in the given key.
function chordNotes(sym, root, scale) {
  const m = /^([ivIV]+)(7?)$/.exec(sym);
  if (!m) throw new Error(`chord "${sym}": use roman numerals like i, VI, iv7`);
  const deg = ROMAN.indexOf(m[1].toLowerCase());
  const tone = (d) => 48 + root + scale[d % 7] + 12 * Math.floor(d / 7);
  const notes = [tone(deg), tone(deg + 2), tone(deg + 4)];
  if (m[2]) notes.push(tone(deg + 6));
  return notes;
}

// Plucked string (Karplus-Strong), seeded.
function pluck(hz, len, seed, bright = 0.5) {
  const N = Math.max(2, Math.round(SR / hz)), buf = new Float32Array(N), nz = lcg(seed);
  for (let i = 0; i < N; i++) buf[i] = nz() * (0.5 + bright * 0.5);
  const out = new Float32Array(Math.floor(len * SR));
  let idx = 0; const damp = 0.996;
  for (let i = 0; i < out.length; i++) {
    const nxt = (idx + 1) % N; const v = buf[idx];
    buf[idx] = damp * (bright * v + (1 - bright) * 0.5 * (v + buf[nxt]));
    out[i] = v; idx = nxt;
  }
  return out;
}

// Hammered, piano-like tone: slightly inharmonic partials, faster decay for higher partials.
const pianoTone = (hz) => (t) => {
  let v = 0;
  for (let k = 1; k <= 7; k++) v += Math.sin(2 * Math.PI * hz * k * Math.sqrt(1 + 0.0004 * k * k) * t) * Math.exp(-t * (1.1 + 0.7 * k)) / Math.pow(k, 1.25);
  return v * Math.min(1, t / 0.004) * 0.32;
};

// Additive saw with a closing lowpass-like envelope (bandlimited, no aliasing).
const bassTone = (hz, len) => (t) => {
  let v = Math.sin(2 * Math.PI * hz * t) * 0.8;
  const cut = 1 + 7 * Math.exp(-t * 9);
  for (let k = 2; k <= 8; k++) v += Math.sin(2 * Math.PI * hz * k * t) / k * Math.exp(-(k - 1) / cut);
  const env = Math.min(1, t / 0.005) * (t < len - 0.02 ? 1 : Math.max(0, (len - t) / 0.02));
  return Math.tanh(v * 0.9) * env * 0.5;
};

function reverb(bus, mix = 0.22) {
  // Schroeder: 4 parallel damped combs + 2 allpasses per side.
  const combs = [1557, 1617, 1491, 1422], aps = [225, 556];
  const proc = (x, spread) => {
    const y = new Float32Array(x.length);
    for (const c of combs) {
      const n = c + spread, buf = new Float32Array(n); let idx = 0, lp = 0;
      for (let i = 0; i < x.length; i++) {
        const o = buf[idx]; lp = o * 0.7 + lp * 0.3; buf[idx] = x[i] + lp * 0.8; idx = (idx + 1) % n; y[i] += o * 0.25;
      }
    }
    for (const a of aps) {
      const n = a + spread, buf = new Float32Array(n); let idx = 0;
      for (let i = 0; i < y.length; i++) { const b = buf[idx], v = y[i]; const o = -v + b; buf[idx] = v + b * 0.5; y[i] = o; idx = (idx + 1) % n; }
    }
    return y;
  };
  return { L: proc(bus.L, 0), R: proc(bus.R, 23), mix };
}

// music: { bpm, key: "A minor", progression: ["i","VI","III","VII"], style: "drive"|"piano"|"minimal",
//          sections: [{ bars, layers: [...] }], seed }
export function synthMusic(music, duration, loop = false) {
  const bpm = music.bpm || 120, beat = 60 / bpm, bar = beat * 4, step = beat / 4;
  const [keyName, mode = 'minor'] = (music.key || 'A minor').split(' ');
  const root = PC[keyName] ?? 9, scale = SCALES[mode] || SCALES.minor;
  const prog = (music.progression || (mode === 'major' ? ['I', 'V', 'vi', 'IV'] : ['i', 'VI', 'III', 'VII'])).map((s) => chordNotes(s, root, scale));
  const style = music.style || 'drive';
  const bars = Math.ceil(duration / bar);
  const defaults = {
    drive: ['kick', 'clap', 'hat', 'bass', 'arp', 'keys'],
    piano: ['piano', 'bass', 'softkick'],
    minimal: ['kick', 'hat', 'arp'],
  }[style] || ['kick', 'hat', 'bass', 'arp'];
  // Sections: explicit, or intro (1 bar, no drums) → full → last bar with a roll into the end.
  let plan = [];
  if (music.sections) { for (const s of music.sections) for (let b = 0; b < s.bars; b++) plan.push(s.layers); }
  else for (let b = 0; b < bars; b++) {
    if (b === 0 && bars > 3) plan.push(defaults.filter((l) => !['kick', 'clap', 'hat', 'softkick'].includes(l)));
    else if (b === bars - 1 && bars > 3 && !loop) plan.push([...defaults.filter((l) => l !== 'hat'), 'roll']);
    else plan.push(defaults);
  }
  while (plan.length < bars) plan.push(plan[plan.length - 1] || defaults);

  const dry = newBus(duration + 3), wet = newBus(duration + 3);
  const kicks = [];
  const nzSeed = music.seed || 7;
  for (let b = 0; b < bars; b++) {
    const L = new Set(plan[b]), chord = prog[b % prog.length], t0 = b * bar;
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * step; if (t >= duration) break;
      const onBeat = s % 4 === 0;
      if (L.has('kick') && onBeat) { kicks.push(t); addVoice(dry, t, 0.45, (x) => Math.sin(2 * Math.PI * (45 + 120 * Math.exp(-x * 30)) * x) * Math.exp(-x * 7) + (x < 0.004 ? 0.3 : 0), 0.9); }
      if (L.has('softkick') && s === 0) { kicks.push(t); addVoice(dry, t, 0.5, (x) => Math.sin(2 * Math.PI * (45 + 60 * Math.exp(-x * 25)) * x) * Math.exp(-x * 6), 0.55); }
      if (L.has('clap') && (s === 4 || s === 12)) {
        const nz = lcg(nzSeed + b * 16 + s), st = { hp: 0 };
        const clap = (x) => { const n = nz(); st.hp += (n - st.hp) * 0.3; const e = Math.exp(-x * 22) + (x > 0.01 ? Math.exp(-(x - 0.01) * 22) : 0) + (x > 0.022 ? Math.exp(-(x - 0.022) * 16) : 0); return (n - st.hp) * e * 0.35; };
        addVoice(dry, t, 0.3, clap, 1, 0.05); addVoice(wet, t, 0.3, clap, 0.6);
      }
      if (L.has('hat')) {
        const nz = lcg(nzSeed * 31 + b * 16 + s), st = { lp: 0 }, vel = s % 4 === 2 ? 0.5 : s % 2 ? 0.18 : 0.28;
        addVoice(dry, t, 0.06, (x) => { const n = nz(); st.lp += (n - st.lp) * 0.5; return (n - st.lp) * Math.exp(-x * 90); }, vel, 0.3);
      }
      if (L.has('roll') && s >= 8) {
        const nz = lcg(nzSeed * 91 + s), vel = 0.15 + 0.5 * ((s - 8) / 8);
        addVoice(dry, t, 0.1, (x) => nz() * Math.exp(-x * 40), vel * 0.5, -0.1);
      }
      if (L.has('bass') && (style === 'piano' ? s % 8 === 0 : s % 4 === 2)) {
        const len = style === 'piano' ? beat * 1.9 : step * 1.6;
        addVoice(dry, t, len, bassTone(midiHz(chord[0] - 12), len), 0.85);
      }
      if (L.has('arp') && s % 2 === 0) {
        const tones = [...chord, chord[0] + 12, chord[1] + 12];
        const note = tones[[0, 2, 1, 3, 4, 2, 3, 1][(s / 2) % 8]] + 12;
        const pl = pluck(midiHz(note), 0.6, nzSeed * 7 + b * 16 + s, 0.45), g = s % 8 === 0 ? 0.32 : 0.22;
        addVoice(dry, t, 0.6, (x, i) => pl[i] * Math.exp(-x * 3), g, s % 4 === 0 ? -0.35 : 0.35);
        addVoice(wet, t, 0.6, (x, i) => pl[i] * Math.exp(-x * 3), g * 0.8);
      }
      if (L.has('keys') && (s === 0 || s === 6 || s === 10)) {
        for (const [j, n] of chord.entries()) { addVoice(dry, t, 1.2, pianoTone(midiHz(n + 12)), 0.28, (j - 1) * 0.3); addVoice(wet, t, 1.2, pianoTone(midiHz(n + 12)), 0.25); }
      }
      if (L.has('piano')) {
        if (s === 0) for (const [j, n] of chord.entries()) { addVoice(dry, t, 2.5, pianoTone(midiHz(n + 12)), 0.36, (j - 1) * 0.25); addVoice(wet, t, 2.5, pianoTone(midiHz(n + 12)), 0.35); }
        if (s % 2 === 0 && s > 0) {
          const tones = [chord[0] + 24, chord[1] + 24, chord[2] + 24, chord[1] + 24];
          const h = midiHz(tones[(s / 2) % 4]);
          addVoice(dry, t, 1.2, pianoTone(h), 0.2, 0.3); addVoice(wet, t, 1.2, pianoTone(h), 0.25);
        }
      }
    }
  }
  // Sidechain: duck everything but the kick itself under each kick.
  const rv = reverb(wet);
  const out = newBus(duration + 3);
  let ki = 0;
  for (let i = 0; i < out.L.length; i++) {
    const t = i / SR;
    while (ki + 1 < kicks.length && kicks[ki + 1] <= t) ki++;
    const duck = kicks.length && t >= kicks[ki] ? 1 - 0.35 * Math.exp(-(t - kicks[ki]) * 9) : 1;
    out.L[i] = Math.tanh((dry.L[i] + rv.L[i] * rv.mix * duck) * 0.9);
    out.R[i] = Math.tanh((dry.R[i] + rv.R[i] * rv.mix * duck) * 0.9);
  }
  return out;
}

// ── film-level commands ─────────────────────────────────────────────────────
export function gridBeats(key) {
  const film = readFilm(key);
  const bpm = film.cfg.music?.bpm || film.cfg.bpm || 120, D = film.cfg.duration, beat = 60 / bpm;
  const beats = []; for (let t = 0; t < D + 1e-9; t += beat) beats.push(+t.toFixed(4));
  const data = { bpm, source: 'grid', beats, downbeats: beats.filter((_, i) => i % 4 === 0), hits: [] };
  writeJson(join(film.dir, 'beats.json'), data);
  return { file: join(film.dir, 'beats.json'), bpm, beats: beats.length };
}

export function python() {
  if (process.env.STUDIO_PYTHON) return process.env.STUDIO_PYTHON;
  const venv = join(ROOT, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

export async function measureBeats(key) {
  const film = readFilm(key);
  if (!film.cfg.track) throw new Error('film.json has no "track": use `studio grid` for a synthesized score');
  const track = resolve(film.dir, film.cfg.track);
  const { out } = await run(python(), [join(ROOT, 'engine', 'beats.py'), track]);
  writeFileSync(join(film.dir, 'beats.json'), out);
  const data = JSON.parse(out);
  return { file: join(film.dir, 'beats.json'), bpm: data.bpm, beats: data.beats.length, hits: data.hits.length };
}

export function buildSfx(key) {
  const film = readFilm(key);
  const cues = readJson(join(film.dir, 'cues.json'), []);
  const bus = synthSfx(cues, film.cfg.duration);
  const file = join(film.out, 'sfx.wav');
  writeWav(file, bus.L, bus.R);
  return { file, cues: cues.length };
}

export function buildMusic(key) {
  const film = readFilm(key);
  if (film.cfg.track) return { skipped: 'film uses a supplied track' };
  const bus = synthMusic(film.cfg.music || {}, film.cfg.duration, !!film.cfg.loop);
  const file = join(film.out, 'music.wav');
  writeWav(file, bus.L, bus.R);
  return { file };
}

export async function loudness(file) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { allowFail: true });
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(err.slice(err.lastIndexOf('Summary')));
  const P = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(err.slice(err.lastIndexOf('Summary')));
  return { lufs: I ? +I[1] : null, truePeak: P ? +P[1] : null };
}

export async function mix(key, { target } = {}) {
  const film = readFilm(key), D = film.cfg.duration;
  target = target ?? film.cfg.mix?.lufs ?? -14; // film.json mix.lufs overrides the -14 default
  const bed = film.cfg.track ? resolve(film.dir, film.cfg.track) : join(film.out, 'music.wav');
  const sfx = join(film.out, 'sfx.wav');
  if (!film.cfg.track && !existsSync(bed)) buildMusic(key);
  if (!existsSync(sfx)) buildSfx(key);
  const bedGain = film.cfg.mix?.music ?? 0.8, sfxGain = film.cfg.mix?.sfx ?? 0.9;
  const fade = film.cfg.loop ? '' : `,afade=t=out:st=${Math.max(0, D - 0.4)}:d=0.4`;
  const pre = join(film.out, '.premix.wav'), file = join(film.out, 'mix.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', bed, '-i', sfx, '-filter_complex',
    `[0:a]aresample=${SR},volume=${bedGain}[a];[1:a]aresample=${SR},volume=${sfxGain}[b];[a][b]amix=inputs=2:normalize=0,atrim=0:${D},apad=whole_dur=${D}${fade}[m]`,
    '-map', '[m]', '-ac', '2', '-c:a', 'pcm_f32le', pre]);
  return { file, ...(await normalize(pre, file, target)) };
}

// Two-pass loudnorm to hit the target precisely, then a true-peak limiter. pre -> file (16-bit PCM). Shared by synthesized and edit mixes.
export async function normalize(pre, file, target) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-i', pre, '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-'], { allowFail: true });
  const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  await run('ffmpeg', ['-y', '-v', 'error', '-i', pre, '-af',
    // TP -2.0 (not -1): the AAC encode overshoots inter-sample peaks by up to ~0.5 dB, so a -1.0
// true-peak WAV ships as -0.5 in the MP4 and fails the <= -1 dBTP delivery gate (measured on
// launch-teaser across three mix attempts; the math films passed at -1.4/-1.5 because their
// material never hit the ceiling). Aiming the WAV at -2.0 leaves the encode's overshoot inside
// the delivery bar. D-009.
`loudnorm=I=${target}:TP=-2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=${SR},alimiter=limit=0.79:level=false:attack=1:release=40`,
    '-c:a', 'pcm_s16le', file]);
  return loudness(file);
}
