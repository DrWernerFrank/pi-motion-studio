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
      // a word that STRADDLES a clip edge is still on the timeline (partially): keep it, clipped to the clip
      // (its outside part is genuinely gone with the cut). Full words keep their exact times.
      for (const w of words) {
        if (w.end <= c.in + 1e-6 || w.start >= c.out - 1e-6) continue;      // entirely outside this clip
        const sA = Math.max(w.start, c.in), sB = Math.min(w.end, c.out);
        out.push({ ...w, start: at + (sA - c.in) / k, end: at + (sB - c.in) / k, __clip: c.id, partial: sA > w.start + 1e-6 || sB < w.end - 1e-6 });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
