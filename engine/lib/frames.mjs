// Frame arithmetic. Time inside the edit pipeline is an integer frame count at a rational rate; seconds are
// derived (n * den / num), never accumulated. NTSC rates (24000/1001, 30000/1001, 60000/1001) are exact.

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const NTSC = [[24000, 1001], [30000, 1001], [60000, 1001], [120000, 1001]];

// 30 | 29.97 | "30000/1001" | "29.97" | { num, den } -> { num, den, str, value }
export function parseFps(v) {
  let num, den;
  if (v && typeof v === 'object') ({ num, den } = v);
  else if (typeof v === 'string' && v.includes('/')) [num, den] = v.split('/').map(Number);
  else {
    const x = Number(v);
    if (!(x > 0)) throw new Error(`bad fps ${JSON.stringify(v)}`);
    const ntsc = NTSC.find(([n, d]) => Math.abs(x - n / d) < 0.01);
    if (ntsc) [num, den] = ntsc; else if (Number.isInteger(x)) [num, den] = [x, 1]; else { num = Math.round(x * 1000); den = 1000; }
  }
  if (!(num > 0 && den > 0)) throw new Error(`bad fps ${JSON.stringify(v)}`);
  const g = gcd(num, den); num /= g; den /= g;
  return { num, den, str: den === 1 ? String(num) : `${num}/${den}`, value: num / den };
}

// the standard rate nearest to a measured one (a phone's 29.97 or 30.01 -> 30000/1001 or 30)
const STANDARD = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1], [120, 1]];
export function nearestStandardFps(value) {
  let best = STANDARD[0], bd = Infinity;
  for (const s of STANDARD) { const d = Math.abs(Math.log(s[0] / s[1] / value)); if (d < bd) { bd = d; best = s; } }
  return parseFps({ num: best[0], den: best[1] });
}

// seconds of frame n; frame of a time (nearest by default)
export const frameTime = (n, fps) => (n * fps.den) / fps.num;
export const timeFrame = (t, fps, mode = 'round') => Math[mode]((t * fps.num) / fps.den + (mode === 'round' ? 1e-9 : 0));
export const snapTime = (t, fps, mode = 'round') => frameTime(timeFrame(t, fps, mode), fps);
// frames in a duration, and the exact duration of that many frames
export const framesIn = (seconds, fps) => Math.round((seconds * fps.num) / fps.den);
