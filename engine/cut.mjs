// cut: measured cut points, not guessed ones (mission D6). Silence and pauses come from the silence map
// (ingest measures the noise floor per clip); the transcript only decides WHAT is being removed. Every
// proposal carries the removed text so a human can veto it (craft rule), and apply() goes through edit-ops,
// so cuts are frame-snapped, atomic and undoable like any other edit.
//
//   studio cut <film> silence  [--src cam] [--max-gap 0.5] [--keep-breath 0.15] [--apply]
//   studio cut <film> fillers  [--src cam] [--also like,"you know"] [--apply]
//   studio cut <film> takes    [--src cam] [--window 20] [--apply]
//   studio cut <film> idle     [--src cam] [--max-idle 1.0] [--speed-up] [--apply]
//   studio cut <film> tighten  [--target 45] [--apply]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOps, loadEdit } from './lib/edit-store.mjs';
import { activeClip, clipFrames, grid, timelineFrames, timelineSeconds } from './lib/edit-ops.mjs';
import { mediaDir, readBin } from './ingest.mjs';
import { readFilm } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { transcribe } from './transcribe.mjs';
import { retimeWords } from './lib/retime.mjs';

const FILLERS = { en: ['um', 'umm', 'uh', 'uhh', 'hmm', 'er', 'erm', 'mm'], fa: ['امم', 'اه'] };
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

const silenceOf = (film, id) => JSON.parse(readFileSync(join(mediaDir(film, id), 'silence.json'), 'utf8'));
const truthOf = (film, id) => { const t = join(mediaDir(film, id), 'transcript.json'); return existsSync(t) ? JSON.parse(readFileSync(t, 'utf8')) : null; };

// Map a source-time span onto the timeline. Earlier cuts may have split the source into several clips, so one
// span can come back as several pieces (ordered); empty array = none of it is on the timeline any more.
// `words` (optional): transcript words in SOURCE time, fencing the frame rounding (D6). Math.round can move
// an edge half a frame; if that lands it inside a word's [start-0.02, end+0.02] the edge is stepped one
// frame AWAY from the word — a `from` edge later, a `to` edge earlier — so a cut only ever shrinks around
// speech, never into it (the word keeps its attack and tail off the splice).
function timelineSpans(edit, G, srcId, sFrom, sTo, words = null) {
  const pieces = [], fpsV = G.fps.num / G.fps.den, PAD = 0.02;
  for (const t of edit.tracks) {
    if (t.kind !== 'video') continue;
    for (const c of [...t.clips].sort((a, b) => G.F(a.at) - G.F(b.at))) {
      if (c.src !== srcId || c.freeze) continue;
      const k = c.dur !== undefined ? (G.F(c.out) - G.F(c.in)) / clipFrames(edit, c) : 1; // source frames per timeline frame
      const atF = G.F(c.at), endF = atF + clipFrames(edit, c);
      const sA = Math.max(sFrom, c.in), sB = Math.min(sTo, c.out); // the part of the span inside this clip
      if (sB - sA < 1e-9) continue;
      let a = atF + Math.round(((sA - c.in) * fpsV) / k), b = atF + Math.round(((sB - c.in) * fpsV) / k);
      if (words) { // padded word zones, in this clip's timeline frames
        const zones = words.filter((w) => w.end + PAD > c.in && w.start - PAD < c.out)
          .map((w) => [atF + ((Math.max(w.start - PAD, c.in) - c.in) * fpsV) / k, atF + ((Math.min(w.end + PAD, c.out) - c.in) * fpsV) / k]);
        for (let moved = true; moved && b > a;) { // an edge inside a zone steps out of it, away from its word
          moved = false;
          for (const [zA, zB] of zones) {
            if (a > zA + 1e-6 && a < zB - 1e-6) { a = Math.ceil(zB - 1e-6); moved = true; }   // `from`: leave the word behind
            if (b > zA + 1e-6 && b < zB - 1e-6) { b = Math.floor(zA + 1e-6); moved = true; } // `to`: back off before the word
          }
        }
      }
      if (a >= atF && b <= endF && b > a) pieces.push({ from: G.S(a), to: G.S(b), frames: b - a });
    }
  }
  return pieces;
}
const timelineSpan = (edit, G, srcId, a, b, words = null) => timelineSpans(edit, G, srcId, a, b, words)[0] ?? null; // single-piece convenience

const wordsBetween = (words, a, b) => words.filter((w) => w.start >= a - 0.02 && w.end <= b + 0.02);

// A cut edge never sits inside a word (D6). `dir` is the SAFE direction the edge may move: 'lo' (a `from`
// edge may move earlier, away from the word it approaches) or 'hi' (a `to` edge may move later). An edge never
// moves toward a word — that would extend the cut into speech.
function snapEdge(t, words, dir, tol = 0.12) {
  let best = null;
  for (const w of words) for (const edge of [w.start - 0.04, w.end + 0.04]) {
    if (dir === 'lo' && edge > t) continue;   // a `from` edge only moves back, out of the way of the next word
    if (dir === 'hi' && edge < t) continue;   // a `to` edge only moves forward
    if (Math.abs(edge - t) <= tol && (best === null || Math.abs(edge - t) < Math.abs(best - t))) best = edge;
  }
  return best ?? t;
}
const fmtList = (ws) => (ws.length ? ws.map((w) => w.text).join(' ') : '(silence)');

// ── silence: no internal pause longer than max-gap + pad, keeping keep-breath of breath ────────────────────────────────
export async function cutSilence(filmKey, { src, maxGap = 0.5, keepBreath = 0.15, pad = 0.05, apply = false, log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit);
  const id = src ?? firstSource(edit, 'video'); if (!id) return { proposals: [], note: 'no video clips' };
  const sil = silenceOf(film, id), words = truthOf(film, id)?.words || [];
  const props = [];
  for (const gap of sil.gaps) {
    if (gap.duration < maxGap) continue;
    // The gap is measured, the WORDS are the fence: a cut may only remove span no word occupies. Quiet words
    // (a low-energy "um", a speech tail under the envelope's threshold) sit inside a "silence" gap — the
    // transcript fences them and the cut takes the truly empty stretches: before the first word, after the
    // last word, and between every pair of neighbouring words inside the gap.
    const inside = words.filter((w) => w.start < gap.end - 0.03 && w.end > gap.start + 0.03).sort((a, b) => a.start - b.start);
    const edges = [gap.start, ...inside.flatMap((w) => [w.start, w.end]), gap.end];
    const stretches = [];
    for (let i = 0; i + 1 < edges.length; i += 2) {   // (gapStart, w1.start), (w1.end, w2.start), ... (last.end, gapEnd)
      const from = i === 0 ? edges[0] : edges[i] + 0.04;          // 40 ms of room tone after a word
      const to = i + 1 === edges.length - 1 ? edges.at(-1) : edges[i + 1] - 0.04;   // ... and before the next
      if (to - from >= 0.1) stretches.push({ from, to });
    }
    for (const st of stretches) {
      // snap both edges to word edges (a stretch boundary is already outside words by construction; this
      // catches envelope-vs-transcript disagreements like a refined start 20 ms inside the clip edge)
      const from = snapEdge(st.from, words, 'lo'), to = snapEdge(st.to - Math.min(keepBreath, (st.to - st.from) / 3), words, 'hi');
      if (to - from < 0.05) continue;
      const span = timelineSpan(edit, G, id, from, to, words); // words fence the rounding: an edge never lands in a word
      if (!span) continue;
      props.push({ op: 'ripple-delete', track: 'V1', from: span.from, to: span.to, reason: `pause ${gap.duration.toFixed(2)}s (max ${maxGap}s), edges snapped to words`, removedText: fmtList(wordsBetween(words, from, to)), confidence: gap.duration >= maxGap * 2 ? 0.95 : 0.8, ...span });
    }
  }
  return finish(filmKey, props, { apply, kind: 'silence', log });
}

// ── fillers: um/uh (verified against the audio: only cut where a measured gap surrounds them) ──────────────────────────
export async function cutFillers(filmKey, { src, extra = [], apply = false, log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit);
  const id = src ?? firstSource(edit, 'video'); if (!id) return { proposals: [], note: 'no video clips' };
  const doc = truthOf(film, id) || (await transcribe(filmKey, id, { log: () => {} }));
  const sil = silenceOf(film, id);
  const list = [...(FILLERS[doc.language] || FILLERS.en), ...extra.map((x) => norm(x))].filter(Boolean);
  const props = [];
  for (let i = 0; i < doc.words.length; i++) {
    const w = doc.words[i], bare = norm(w.text);
    if (!list.includes(bare)) continue;
    const prev = doc.words[i - 1], next = doc.words[i + 1];
    // verified against the audio: a gap (or the clip edges) right after the filler, so the cut lands in quiet
    const gapAfter = sil.gaps.find((g) => g.start < w.end + 0.15 && g.end > w.end - 0.05);
    if (!gapAfter && next && next.start - w.end < 0.12) { props.push({ skipped: true, reason: `no measured gap after "${w.text}" (next word ${Math.round((next.start - w.end) * 1000)} ms later): would click`, at: w.start }); continue; }
    const from = snapEdge(Math.max(w.start - 0.04, prev ? prev.end + 0.02 : 0), doc.words, 'lo'), to = snapEdge(Math.min(next ? next.start - 0.02 : w.end + 0.06, gapAfter ? gapAfter.end - 0.12 : w.end + 0.04), doc.words, 'hi');
    if (to - from < 0.05) continue;
    const span = timelineSpan(edit, G, id, from, to, doc.words); // words fence the rounding: an edge never lands in a word
    if (span) props.push({ op: 'ripple-delete', track: 'V1', from: span.from, to: span.to, reason: `filler "${w.text}"`, removedText: w.text, confidence: 0.9, ...span });
  }
  return finish(filmKey, props, { apply, kind: 'fillers', log });
}

// ── takes: near-duplicate sentences within a window keep only the last complete one ────────────────────────────────────
export async function cutTakes(filmKey, { src, window: win = 20, apply = false, log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit);
  const id = src ?? firstSource(edit, 'video'); if (!id) return { proposals: [], note: 'no video clips' };
  const doc = truthOf(film, id) || (await transcribe(filmKey, id, { log: () => {} }));
  // sentence runs break at . ? !, at a gap > 0.7 s, and at fillers: an abandoned take usually ends in one ("... not in the, uh.")
  const FIL = new Set([...(FILLERS[doc.language] || FILLERS.en)]);
  const runs = []; let r2 = [];
  doc.words.forEach((w) => { const bare = norm(w.text); if (r2.length && (FIL.has(bare) || w.start - r2.at(-1).end > 0.7 || /[.!?]$/.test(r2.at(-1).text))) { runs.push(r2); r2 = []; } r2.push(w); });
  if (r2.length) runs.push(r2);
  const sents = runs.map((ws) => ws.filter((w) => !FIL.has(norm(w.text)))).filter((ws) => ws.length);
  const terminal = (ws) => /[.!?]$/.test(ws.at(-1).text);
  const opens = (a, b) => { let n = 0; while (n < a.length && n < b.length && norm(a[n].text) === norm(b[n].text)) n++; return n; };
  const props = [];
  for (let i = 0; i < sents.length; i++) for (let j = i + 1; j < sents.length; j++) {
    const a = sents[i], b = sents[j];
    if (b[0].start - a.at(-1).end > win) break;
    const ta = norm(a.map((w) => w.text).join(' ')), tb = norm(b.map((w) => w.text).join(' '));
    const dup = (ta && (ta === tb || jaccard(ta, tb) >= 0.75)) && terminal(b);
    // a retake: the same opening, the earlier one left unfinished, the later one complete
    const retake = !terminal(a) && terminal(b) && opens(a, b) >= 3;
    if (dup || retake) {
      const from = snapEdge(Math.max(0, a[0].start - 0.1), doc.words, 'lo'), to = snapEdge(b[0].start - 0.05, doc.words, 'hi'); // the first take and the pause before the retake (edges off words)
      // earlier cuts may have split the flub region into several clips: one op per piece, later pieces first
      // (their coordinates stay valid while earlier pieces are still untouched)
      const pieces = timelineSpans(edit, G, id, from, to, doc.words).reverse(); // words fence the rounding: an edge never lands in a word
      for (const span of pieces) props.push({ op: 'ripple-delete', track: 'V1', from: span.from, to: span.to, reason: retake ? `abandoned take (same opening "${a.slice(0, 3).map((w) => w.text).join(' ')} …", the retake is complete)` : `duplicate take (kept the later, complete one)`, removedText: a.map((w) => w.text).join(' '), confidence: retake ? 0.85 : 0.9, ...span });
      if (pieces.length) { i = j; break; } // a take only pairs once
    }
  }
  return finish(filmKey, props, { apply, kind: 'takes', log });
}

// ── idle: frozen stretches (picture inactivity) cut, or sped up ───────────────────────────────────────────────────────
export async function cutIdle(filmKey, { src, maxIdle = 1.0, speedUp = false, speed = 4, apply = false, log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit);
  const id = src ?? firstSource(edit, 'video'); if (!id) return { proposals: [], note: 'no video clips' };
  // frame-difference scan on the proxy (freezedetect with a strict noise floor: -75 dB caught typing at the fixture build)
  // idleness is measured on the CONFORMED file: the proxy's extra encode generation adds noise that keeps
  // freezedetect's diff meter above -75 dB through true idle stretches (measured: proxy reports 3.9-8.33 where the
  // conformed correctly reports 3.9-10).
  const proxy = join(mediaDir(film, id), 'conformed.mp4');
  const { err } = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', proxy, '-vf', `freezedetect=n=-75dB:d=${Math.max(0.4, maxIdle / 3)}s`, '-an', '-f', 'null', '-'], { allowFail: true });
  // pair starts/ends sequentially (an unterminated trailing freeze runs to the end of the media)
  const events = [...err.matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*(-?[\d.]+)/g)].map((m) => ({ k: m[1], t: +m[2] })); // full key + the space before the number
  const dur = (await import('./lib/film.mjs')).readJson(join(mediaDir(film, id), 'media.json')).source.container_duration ?? 30;
  const frozen = [];
  for (const e of events) {
    if (e.k === 'start') frozen.push({ start: e.t, end: dur });
    else if (frozen.length && frozen.at(-1).end === dur) frozen.at(-1).end = e.t;   // closes the open freeze
  }
  const spans = frozen.filter((f) => f.end - f.start >= maxIdle);
  const props = [];
  for (const f of spans) {
    const from = f.start, to = Math.min(f.end, timelineSeconds(edit));
    const span = timelineSpan(edit, G, id, from, to);
    if (!span || span.frames < 15) continue; // >= 0.5 s: slivers are detection noise, not idle
    if (speedUp) props.push({ op: 'speed', id: clipAt(edit, span.from)?.id, speed, reason: `idle ${((to - from)).toFixed(1)}s sped up x${speed}`, removedText: '(idle stretch kept, faster)', confidence: 0.8, span });
    else props.push({ op: 'ripple-delete', track: 'V1', from: span.from, to: span.to, reason: `frozen ${(to - from).toFixed(1)}s (max ${maxIdle}s)`, removedText: '(nothing happening)', confidence: 0.9, ...span });
  }
  return finish(filmKey, props, { apply, kind: 'idle', log });
}

// ── tighten: hit a target duration by trimming the longest pauses first ────────────────────────────────────────────────
export async function tighten(filmKey, { target, apply = false, log = () => {} } = {}) {
  const { film, edit } = loadEdit(filmKey), G = grid(edit);
  const id = firstSource(edit, 'video'); if (!id) return { proposals: [], note: 'no video clips' };
  const sil = silenceOf(film, id), words = truthOf(film, id)?.words || [];
  let have = timelineSeconds(edit), need = have - (target ?? have);
  const props = [];
  const gaps = [...sil.gaps].sort((a, b) => b.duration - a.duration);
  for (const gap of gaps) {
    if (need <= 0.05) break;
    const save = Math.min(gap.duration - 0.2, need); // leave 0.2 s of the pause
    if (save < 0.1) break;
    const from = gap.start + 0.05, to = from + save;
    const span = timelineSpan(edit, G, id, from, to, words); // words fence the rounding: an edge never lands in a word
    if (span) { props.push({ op: 'ripple-delete', track: 'V1', from: span.from, to: span.to, reason: `tighten: trim ${save.toFixed(2)}s of a ${gap.duration.toFixed(2)}s pause`, removedText: fmtList(wordsBetween(words, from, to)), confidence: 0.7, ...span }); need -= span.to - span.from; }
  }
  return finish(filmKey, props, { apply, kind: 'tighten', log });
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function firstSource(edit, kind) { for (const t of edit.tracks) if (t.kind === 'video') { const c = [...t.clips].sort((a, b) => a.at - b.at)[0]; if (c) return c.src; } return null; }
function clipAt(edit, t) { const { F } = grid(edit), k = F(t); for (const tr of edit.tracks) if (tr.kind === 'video') { const c = activeClip(edit, tr, k); if (c) return c; } return null; }
const jaccard = (a, b) => { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };

function finish(filmKey, props, { apply, kind, log }) {
  const actionable = props.filter((p) => !p.skipped);
  if (apply && actionable.length) {
    // LATEST-FIRST: each ripple-delete shifts later material, so applying from the end keeps earlier
    // coordinates valid. (A batch's coordinates are computed against the edit the proposals were measured on.)
    const ordered = [...actionable].sort((x, y) => y.from - x.from);
    applyOps(filmKey, ordered.map(({ op, ...p }) => ({ op, ...p })), { who: `cut:${kind}` });
    const sync = (async () => (await import('./lib/edit-store.mjs')).syncFilm(filmKey))();
    void sync;
    log(`cut ${kind}: applied ${actionable.length} proposals`);
  }
  const removed = actionable.reduce((a, p) => a + (p.frames ?? 0), 0);
  return { kind, proposals: props, actionable: actionable.length, framesRemoved: removed, applied: !!apply && !!actionable.length,
    removedText: props.filter((p) => !p.skipped && p.removedText && p.removedText !== '(silence)').map((p) => p.removedText).join(' / ') };
}
void timelineFrames; void readBin;
