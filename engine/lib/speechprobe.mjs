// Where speech starts and stops, measured from the audio (mission D6; same idea as open-edit's speech-probe, re-implemented).
// Word boundaries from an ASR are not cut points: the noise floor is measured per clip (a street sits 20 dB above a quiet room),
// speech is whatever clears it, and a gap is a stretch under the threshold that is long enough to cut in.
import { spawn } from 'node:child_process';

const WINDOW_MS = 10, RATE = 16000;

// dBFS of each 10 ms window of the file's first mono channel mix (16 kHz), optionally a [from, to] range in seconds.
export function envelope(file, { from, to } = {}) {
  const args = ['-v', 'error'];
  if (from !== undefined) args.push('-ss', String(from));
  args.push('-i', file);
  if (to !== undefined) args.push('-t', String(to - (from || 0)));
  args.push('-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-');
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', args), chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => (err += d)); p.on('error', bad);
    p.on('close', (code) => {
      if (code !== 0) return bad(new Error(`ffmpeg could not read audio from ${file}: ${err.slice(-200)}`));
      const buf = Buffer.concat(chunks), n = buf.length >> 1, win = (RATE * WINDOW_MS) / 1000, out = new Float32Array(Math.floor(n / win));
      for (let w = 0; w < out.length; w++) { let s = 0; for (let i = w * win; i < (w + 1) * win; i++) { const x = buf.readInt16LE(i * 2) / 32768; s += x * x; } out[w] = 10 * Math.log10(s / win + 1e-12); }
      ok(out);
    });
  });
}

const pct = (arr, q) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };

// env -> { floor, hi, threshold, speechFound, gaps[], segments[] }, times in seconds from the start of `env`
export function probeEnvelope(env, { gapMs = 250, minSpeechMs = 80, rangeStart = 0 } = {}) {
  if (!env.length) return { floor: null, hi: null, threshold: null, speechFound: false, gaps: [], segments: [], windowMs: WINDOW_MS };
  const floor = pct(env, 0.1), hi = pct(env, 0.95), spread = hi - floor;
  const threshold = floor + Math.max(6, 0.3 * spread), speechFound = spread >= 12;
  const dt = WINDOW_MS / 1000, gaps = [], segments = [];
  if (speechFound) {
    let i = 0;
    while (i < env.length) {
      const speech = env[i] >= threshold; let j = i;
      while (j < env.length && (env[j] >= threshold) === speech) j++;
      const a = rangeStart + i * dt, b = rangeStart + j * dt;
      if (speech) { if ((j - i) * WINDOW_MS >= minSpeechMs) segments.push({ start: +a.toFixed(3), end: +b.toFixed(3) }); }
      else if ((j - i) * WINDOW_MS >= gapMs) gaps.push({ start: +a.toFixed(3), end: +b.toFixed(3), duration: +(b - a).toFixed(3) });
      i = j;
    }
  }
  return { floor: +floor.toFixed(1), hi: +hi.toFixed(1), threshold: +threshold.toFixed(1), speechFound, windowMs: WINDOW_MS, gaps, segments };
}

export const speechProbe = async (file, opts = {}) => probeEnvelope(await envelope(file, opts), { ...opts, rangeStart: opts.from || 0 });
