// motion.js: the math every film is built from. Pure functions of time only.
// Import in a film:  import { spring, track, rng, ... } from '/engine/lib/motion.js';

// ── basics ──────────────────────────────────────────────────────────────────
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const invlerp = (a, b, x) => clamp((x - a) / (b - a));
export const remap = (x, a, b, c, d) => lerp(c, d, invlerp(a, b, x));
export const smoothstep = (a, b, x) => { const p = invlerp(a, b, x); return p * p * (3 - 2 * p); };
export const TAU = Math.PI * 2;

// Easing, for the rare value that must land at an exact time (wipes, masks).
// Anything that moves an object should be a spring instead.
export const ease = {
  linear: (p) => p,
  outCubic: (p) => 1 - Math.pow(1 - clamp(p), 3),
  inOutCubic: (p) => (p = clamp(p)) < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
  outExpo: (p) => (p = clamp(p)) === 1 ? 1 : 1 - Math.pow(2, -10 * p),
  inOutExpo: (p) => { p = clamp(p); if (p === 0 || p === 1) return p; return p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2; },
  inCubic: (p) => Math.pow(clamp(p), 3),
};

// ── springs ─────────────────────────────────────────────────────────────────
// Closed-form damped spring from 0 to 1, unit mass, released at rest at t = 0.
// x'' = -k (x - 1) - d x'. Deterministic: any t can be evaluated in isolation.
export function spring(t, k = 170, d = 26) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k), z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

// Named feels. Spread one into spring/track: spring(t, ...SNAPPY).
export const SNAPPY = [320, 30];   // buttons, toggles, leading edges (~1% overshoot)
export const DEFAULT = [170, 26];  // cards, containers, camera (no visible overshoot)
export const HEAVY = [90, 20];     // big type, 3D objects, logo lockups (no overshoot, slow settle)
export const PLAYFUL = [200, 12];  // mascots, stickers (visible overshoot)

// A value that changes target several times: one spring per change, summed.
// keys: [[time, value], ...] sorted by time. Stays continuous, stays pure.
export function track(t, keys, k = 170, d = 26) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
  return v;
}

// 2D version for positions: keys: [[time, x, y], ...]
export function track2(t, keys, k = 170, d = 26) {
  return [track(t, keys.map((q) => [q[0], q[1]]), k, d), track(t, keys.map((q) => [q[0], q[2]]), k, d)];
}

// Tab indicator that stretches: leading edge stiffer than trailing edge.
export function indicator(t, stops, width = 120) {
  const lead = track(t, stops, 320, 30), trail = track(t, stops, 140, 22);
  return { left: Math.min(lead, trail), right: Math.max(lead, trail) + width };
}

// Text inside a morphing box: in after the morph starts, out before the next one.
export function swapAlpha(t, tIn, tOut) {
  return Math.min(clamp((t - tIn - 0.08) / 0.12), clamp((tOut - 0.1 - t) / 0.1));
}

// Seamless loop: map any t into [0, dur).
export const loopT = (t, dur) => ((t % dur) + dur) % dur;

// in/out envelope for an element alive in [a, b]: springs in at a, springs out ending at b.
export function life(t, a, b, feel = DEFAULT, outDur = 0.35) {
  return spring(t - a, ...feel) * (1 - spring(t - (b - outDur), ...feel));
}

// ── time structure ──────────────────────────────────────────────────────────
// Local progress 0..1 of t inside [a, b].
export const local = (t, a, b) => clamp((t - a) / (b - a));

// Scenes: [{ from, to, draw(ctx, lt, L, p) }]; draws each scene alive at t
// (overlaps allowed for transitions). lt = seconds since scene start, p = 0..1.
export function playScenes(scenes, ctx, t, L) {
  for (const s of scenes) if (t >= s.from && t < s.to) s.draw(ctx, t - s.from, L, (t - s.from) / (s.to - s.from), t);
}

// Beat grid helpers. beats: sorted array of seconds (from beats.json).
export function beatIndex(t, beats) {
  let lo = 0, hi = beats.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (beats[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
// 1 on the beat, decaying after it. Use for hits, scale pumps, flashes.
export function pulse(t, beats, decay = 8) {
  const i = beatIndex(t, beats);
  return i < 0 ? 0 : Math.exp(-(t - beats[i]) * decay);
}
// A uniform grid when no track exists: bpm → beat times.
export function grid(bpm, duration, offset = 0) {
  const out = [], step = 60 / bpm;
  for (let x = offset; x < duration + 1e-9; x += step) out.push(+x.toFixed(4));
  return out;
}

// ── seeded noise (never Math.random) ────────────────────────────────────────
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
// Stateless hash of an integer (and optional seed) to [0, 1).
export function hash(n, seed = 0) {
  let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Smooth 1D value noise in [-1, 1]. Pure in x, so wobble stays deterministic.
export function noise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
}

// ── color ───────────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a, b, p) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], clamp(p)))).join(',')})`;
}
export function rgba(hex, alpha) { return `rgba(${hexToRgb(hex).join(',')},${clamp(alpha)})`; }

// ── drawing helpers (canvas 2D) ─────────────────────────────────────────────
export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

// Font string with optional tracking in em (applied via ctx.letterSpacing).
export function font(ctx, px, family, weight = 400, trackingEm = 0, style = '') {
  ctx.font = `${style} ${weight} ${px}px ${family}`.trim();
  ctx.letterSpacing = `${(trackingEm * px).toFixed(2)}px`;
}

// Largest px (≤ max) at which text fits maxW with the given family/weight.
export function fitPx(ctx, text, maxW, family, weight = 700, max = 400, trackingEm = 0) {
  font(ctx, 100, family, weight, trackingEm);
  const w = ctx.measureText(text).width;
  return Math.min(max, Math.floor((100 * maxW) / Math.max(1, w)));
}

// Kinetic words: each word rises on its own spring, staggered. Returns total width.
// align: 'left' | 'center'. Words are measured with the current ctx.font.
export function kineticLine(ctx, text, x, y, t, { stagger = 0.06, rise = 0.6, feel = SNAPPY, align = 'left', color, alpha = 1, clip = true } = {}) {
  const words = text.split(' '), space = ctx.measureText(' ').width;
  const widths = words.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  const m = ctx.measureText('Hg'), asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  let cx = align === 'center' ? x - total / 2 : x;
  if (color) ctx.fillStyle = color;
  words.forEach((w, i) => {
    const p = spring(t - i * stagger, ...feel);
    ctx.save();
    if (clip) { ctx.beginPath(); ctx.rect(cx - 4, y - asc - 4, widths[i] + 8, asc + desc + 8); ctx.clip(); }
    ctx.globalAlpha = alpha * clamp(p * 3);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(w, cx, y + (1 - p) * (asc + desc) * rise * 1.6);
    ctx.restore();
    cx += widths[i] + space;
  });
  return total;
}

// Typewriter: characters revealed at cps, with a blinking caret that is a pure function of t.
export function typed(text, t, cps = 22) { return text.slice(0, Math.max(0, Math.floor(t * cps))); }
export const caretOn = (t) => Math.floor(t * 2.2) % 2 === 0;
