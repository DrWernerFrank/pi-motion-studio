// Captions are design, not subtitles (mission D7): chunked by punctuation, pauses and measured width, at most
// two lines, inside the format's safe area, clear of the speaker's face when a face box is given, the current
// word in the accent colour, three styles from the design system. Exports .srt/.vtt from the same chunks, so
// what you see is what the file says. RTL (fa/ar/he) renders with canvas direction + shaping; Vazirmatn is bundled.
//
//   import { captions, captionChunks } from '/engine/lib/captions.js';
//   captions(ctx, t, { words, style: 'pop', lang, face: {x,y,w,h} }, L, D);
export const CAPTION_STYLES = ['pop', 'typewriter', 'karaoke', 'plain'];
const READING = 17; // chars/s, the comfortable adult reading speed; a faster cue is split at layout time

// words: [{ text, start, end }] -> cues [{ start, end, words, text, rtl }]
export function captionChunks(words, { maxChars = 42, maxGap = 0.35, maxDur = 2.8, minDur = 0.55, lead = 0.05 } = {}) {
  const cues = []; let cur = [];
  const flush = () => { if (!cur.length) return; cues.push({ start: Math.max(0, cur[0].start - lead), end: cur.at(-1).end + 0.12, words: cur, text: cur.map((w) => w.text).join(' ') }); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = cur.at(-1);
    const punct = /[.!?،؛؟]$/.test(w.text);
    if (prev && (w.start - prev.end > maxGap || (cur.map((x) => x.text).join(' ').length + w.text.length > maxChars) || (w.end - cur[0].start) > maxDur || (punct && prev))) {
      if (punct && w.start - prev.end <= maxGap && cur.map((x) => x.text).join(' ').length + w.text.length <= maxChars) { cur.push(w); flush(); continue; }
      flush();
    }
    cur.push(w);
    if (punct && (words[i + 1]?.start ?? Infinity) - w.end > maxGap) flush();
  }
  flush();
  return cues.filter((c) => c.end - c.start >= 0.2);
}

// the font stack per language (design captions role first, script font for RTL)
const SCRIPT_FONT = { fa: 'Vazirmatn', ar: 'Vazirmatn', he: 'Vazirmatn', fa_IR: 'Vazirmatn' };
const RTL = new Set(['fa', 'ar', 'he', 'fa_IR', 'ar_SA']);

// layout one cue: returns { lines: [..], box: {x,y,w,h}, fontPx, lead } — or null if it cannot fit the caps
export function layoutCue(ctx, cue, L, D, { font, maxLines = 2, minU = 3.2 } = {}) {
  const px = Math.max(minU * 1.4 * L.u, D.px('caption', L)); // nothing under 3.2u (AGENTS.md)
  const family = SCRIPT_FONT[cue.lang] ? `"${SCRIPT_FONT[cue.lang]}", ${font || D.fonts?.ui || 'Inter'}` : font || D.fonts?.ui || 'Inter';
  ctx.font = `600 ${px}px ${family}`;
  const maxW = L.safe.w * 0.94;
  const words = cue.words, lines = []; let line = [];
  for (const w of words) {
    const test = [...line, w].map((x) => x.text).join(' ');
    if (ctx.measureText(test).width > maxW && line.length) { lines.push(line); line = [w]; } else line.push(w);
  }
  if (line.length) lines.push(line);
  if (lines.length > maxLines) { // re-wrap harder: balanced split of the words into <= maxLines
    const per = Math.ceil(words.length / maxLines), ls = [];
    for (let i = 0; i < words.length; i += per) ls.push(words.slice(i, i + per));
    if (ls.length <= maxLines) { lines.length = 0; lines.push(...ls); } else return null;
  }
  const lineH = px * 1.28, w0 = Math.max(...lines.map((l) => ctx.measureText(l.map((x) => x.text).join(' ')).width));
  const h = lines.length * lineH + px * 0.55;
  return { lines, px, family, lineH, w: w0, h, rtl: RTL.has(cue.lang) };
}

// draw the cue active at t (if any) into the caption band at the bottom of the safe area.
// face: the speaker's face box in canvas px ({x,y,w,h}); the cue moves up out of it when needed.
export function captions(ctx, t, { cues, style = 'pop', lang, face, D }, L) {
  const cue = cues?.find((c) => t >= c.start && t <= c.end);
  if (!cue) return null;
  const lay = layoutCue(ctx, { ...cue, lang: cue.lang ?? lang }, L, D ?? {});
  if (!lay) return null;
  ctx.save();
  ctx.direction = lay.rtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'alphabetic';
  const accent = (D && D.c && D.c.accent) || '#ff5a1f';
  const ink = (D && D.c && D.c.ink) || '#ffffff';
  const cx = L.cx, bandBottom = L.safe.y + L.safe.h + L.u * 6; // 6u below the safe area's bottom edge
  let y = bandBottom - lay.h, x = cx - lay.w / 2;
  if (face) { const fy = face.y + face.h; if (y < fy + L.u * 2 && x + lay.w > face.x && x < face.x + face.w) y = Math.max(L.safe.y, face.y - lay.h - L.u * 3); }
  if (style === 'pop') { // a plate behind the words; the current word's cell gets the accent
    ctx.fillStyle = (D && D.c && D.c.plate) || 'rgba(8,8,10,0.78)';
    ctx.beginPath(); ctx.roundRect(x - L.u * 2.2, y - L.u * 1.2, lay.w + L.u * 4.4, lay.h + L.u * 0.8, L.u * 1.2); ctx.fill();
  }
  const chars = cue.text.length, cps = chars / Math.max(0.2, cue.end - cue.start - 0.12);
  let idx = 0;
  lay.lines.forEach((line, li) => {
    const lineY = y + lay.px + li * lay.lineH;
    let wx = lay.rtl ? x + lay.w : x;
    for (const w of line) {
      ctx.font = `600 ${lay.px}px ${lay.family}`;
      const ww = ctx.measureText(w.text + (line.at(-1) === w ? '' : ' ')).width;
      const active = t >= w.start - 0.02 && t <= w.end + 0.03;
      const shown = style === 'typewriter' ? (t >= w.start - 0.02 ? w.text : '') : w.text;
      if (style === 'karaoke' || style === 'pop') ctx.fillStyle = active ? accent : ink;
      else ctx.fillStyle = ink;
      if (shown) ctx.fillText(shown, lay.rtl ? wx - ww : wx, lineY);
      wx += lay.rtl ? -ww : ww; idx += w.text.length;
    }
  });
  ctx.restore();
  void cps; void idx;
  return { cue, layout: lay, box: { x, y, w: lay.w, h: lay.h } };
}
