// retime: source-word times -> timeline times, from the edit (never re-transcribe a cut; mission D5, from open-edit).
// A word spoken in clip c at source time s shows at c.at + (s - c.in) / effectiveSpeed(c).
import { clipFrames, grid } from './edit-ops.mjs';

const speedOf = (edit, c) => { const sf = grid(edit).F(c.out) - grid(edit).F(c.in); return sf ? sf / clipFrames(edit, c) : 1; };

// all words of `srcId` mapped onto the timeline, in order. Only clips of the source's video track contribute.
export function retimeWords(edit, srcId, words) {
  const { F } = grid(edit), out = [];
  for (const t of edit.tracks) {
    if (t.kind !== 'video') continue;
    for (const c of [...t.clips].sort((a, b) => F(a.at) - F(b.at))) {
      if (c.src !== srcId || c.freeze) continue;
      const k = speedOf(edit, c), at = c.at, inS = c.in;
      for (const w of words) if (w.start >= inS - 1e-6 && w.end <= c.out + 1e-6) out.push({ ...w, start: at + (w.start - inS) / k, end: at + (w.end - inS) / k, __clip: c.id });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
