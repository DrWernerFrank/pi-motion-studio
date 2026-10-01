// edit-ops: the timeline as data, and every operation on it as a pure function  edit -> edit'  (mission D3).
// Shared by the CLI, the pi tools, the GUI server and the tests, so they can never disagree.
//
//   edit.json (versioned, diff-friendly; authored in SECONDS, snapped to the project frame grid, 6 decimals):
//     { version, rev, fps: "30000/1001", counter, sources:{ id:{ path, sha256, kind, duration, frames, fps, has_audio } },
//       tracks:[{ id:"V1", kind:"video", clips:[{ id, src, in, out, at, speed?, dur?, freeze?, audio?, crop?, note? }] }, { id:"A1", kind:"audio", clips:[…] }],
//       overlays:[…], captions:null|{…}, markers:[…] }
//   clip.in/out are seconds on the CONFORMED media of `src`; clip.at is the timeline position; the clip is `dur` long when it
//   has a speed change (frame-exact: whole frames), else out-in. All arithmetic runs on integer frames at the rational project rate.
import { frameTime, parseFps, timeFrame } from './frames.mjs';

export const EDIT_VERSION = 1;
export class OpError extends Error { constructor(msg, code = 'invalid') { super(msg); this.name = 'OpError'; this.code = code; } }
const need = (ok, msg, code) => { if (!ok) throw new OpError(msg, code); };

const r6 = (x) => Math.round(x * 1e6) / 1e6;
export const OVERLAY_TYPES = ['title', 'lower-third', 'callout', 'punch-in', 'text', 'logo', 'progress', 'speed-ramp'];
export const CAPTION_STYLES = ['pop', 'typewriter', 'karaoke', 'plain'];

export function newEdit({ fps = 30 } = {}) {
  return { version: EDIT_VERSION, rev: 0, fps: parseFps(fps).str, counter: 0, sources: {},
    tracks: [{ id: 'V1', kind: 'video', clips: [] }, { id: 'A1', kind: 'audio', clips: [] }], overlays: [], captions: null, markers: [] };
}

// ── frame helpers bound to an edit ───────────────────────────────────────────────────────────────────────────────────
export function grid(edit) {
  const fps = parseFps(edit.fps);
  return { fps, F: (sec) => timeFrame(sec, fps), S: (frames) => r6(frameTime(frames, fps)) };
}
// timeline length of a clip in frames
export function clipFrames(edit, c) {
  const { F } = grid(edit);
  if (c.freeze) return Math.max(1, F(c.dur));
  return c.dur !== undefined ? Math.max(1, F(c.dur)) : F(c.out) - F(c.in);
}
export const clipEnd = (edit, c) => grid(edit).F(c.at) + clipFrames(edit, c);
export function timelineFrames(edit) { let n = 0; for (const t of edit.tracks) for (const c of t.clips) n = Math.max(n, clipEnd(edit, c)); return n; }
export const timelineSeconds = (edit) => grid(edit).S(timelineFrames(edit));

const findClip = (edit, id) => { for (const t of edit.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { track: t, clip: c }; } throw new OpError(`no clip "${id}" (clips: ${edit.tracks.flatMap((t) => t.clips.map((c) => c.id)).join(', ') || 'none'})`, 'notfound'); };
const getTrack = (edit, id) => { const t = edit.tracks.find((x) => x.id === id); need(t, `no track "${id}" (tracks: ${edit.tracks.map((x) => x.id).join(', ')})`, 'notfound'); return t; };
const sortTrack = (edit, t) => t.clips.sort((a, b) => grid(edit).F(a.at) - grid(edit).F(b.at) || (a.id < b.id ? -1 : 1));

// Is `v` a finite number of seconds?
const sec = (v, what) => { need(typeof v === 'number' && Number.isFinite(v), `${what} must be a number of seconds, got ${JSON.stringify(v)}`); return v; };

// Bring a source from the media bin into the edit (once). `bin` is films/<key>/assets/media/index.json.
export function ensureSource(edit, id, bin) {
  if (edit.sources[id]) return;
  const b = bin?.sources?.[id];
  need(b, `source "${id}" is not in the media bin: run \`studio ingest <film> <file> --id ${id}\` first`, 'notfound');
  const fps = parseFps(edit.fps);
  need(b.kind === 'audio' || b.fps === fps.str, `source "${id}" was conformed at ${b.fps} fps but this edit runs at ${fps.str}: re-ingest it with --fps ${fps.str}`);
  const frames = b.frames ?? Math.floor(((b.duration || 0) * fps.num) / fps.den);
  edit.sources[id] = { path: b.path, sha256: b.sha256, kind: b.kind, duration: b.duration, frames, fps: b.fps ?? fps.str, has_audio: b.has_audio ?? b.kind !== 'video' };
}

// No two clips on a track overlap (gaps are allowed; the gates report unintended ones).
function checkOverlap(edit, t, what) {
  const { F } = grid(edit), cs = [...t.clips].sort((a, b) => F(a.at) - F(b.at));
  for (let i = 1; i < cs.length; i++) {
    const prevEnd = F(cs[i - 1].at) + clipFrames(edit, cs[i - 1]);
    need(F(cs[i].at) >= prevEnd, `${what}: clip ${cs[i].id} (at ${cs[i].at}s) overlaps ${cs[i - 1].id} (ends ${grid(edit).S(prevEnd)}s) on ${t.id}; use ripple, move it, or trim first`);
  }
}
const shiftAfter = (edit, t, fromFrame, delta, exceptId) => { const { F, S } = grid(edit); for (const c of t.clips) if (c.id !== exceptId && F(c.at) >= fromFrame) c.at = S(F(c.at) + delta); };
const nextId = (edit, prefix = 'c') => { let id; do { id = `${prefix}${++edit.counter}`; } while (edit.tracks.some((t) => t.clips.some((c) => c.id === id)) || edit.overlays.some((o) => o.id === id) || edit.markers.some((m) => m.id === id)); return id; };
const srcOf = (edit, c) => edit.sources[c.src];
const kindOk = (edit, t, c) => need(t.kind === 'audio' || srcOf(edit, c).kind === 'video' || srcOf(edit, c).kind === 'image', `${t.id} is a video track but "${c.src}" is audio only: use an audio track (A1)`);

// source frames of a clip (for speed/dur math)
const srcFrames = (edit, c) => grid(edit).F(c.out) - grid(edit).F(c.in);
function setSpeed(edit, c, speed) {
  const { S } = grid(edit);
  need(typeof speed === 'number' && speed >= 0.1 && speed <= 16, `speed must be between 0.1 and 16, got ${speed}`);
  if (speed === 1) { delete c.speed; delete c.dur; return; }
  c.speed = speed; c.dur = S(Math.max(1, Math.round(srcFrames(edit, c) / speed)));
}

// ── the operations ────────────────────────────────────────────────────────────────────────────────────────────────────
export const OPS = {
  // add { src, in?, out?, at?, track?="V1", speed?, id?, ripple?, note? }
  add(edit, a, ctx = {}) {
    ensureSource(edit, a.src, ctx.bin);
    const { F, S } = grid(edit), t = getTrack(edit, a.track ?? 'V1'), s = edit.sources[a.src];
    const inF = F(a.in === undefined ? 0 : sec(a.in, 'in')), outF = a.out === undefined ? s.frames : F(sec(a.out, 'out'));
    need(inF >= 0 && inF < outF, `add: in ${S(inF)}s must be before out ${S(outF)}s`);
    need(outF <= s.frames, `add: out ${S(outF)}s is beyond the end of "${a.src}" (${S(s.frames)}s, ${s.frames} frames)`);
    const c = { id: a.id ?? nextId(edit), src: a.src, in: S(inF), out: S(outF), at: 0 };
    need(!edit.tracks.some((x) => x.clips.some((y) => y.id === c.id)), `add: clip id "${c.id}" already exists`);
    kindOk(edit, t, c);
    if (a.speed !== undefined) setSpeed(edit, c, a.speed);
    if (a.note) c.note = String(a.note);
    if (a.audio) c.audio = { ...a.audio };
    if (a.duck) c.duck = { ...a.duck };
    const end = t.clips.reduce((n, x) => Math.max(n, F(x.at) + clipFrames(edit, x)), 0);
    const atF = a.at === undefined ? end : F(sec(a.at, 'at'));
    need(atF >= 0, 'add: at must be >= 0');
    c.at = S(atF);
    if (a.ripple) shiftAfter(edit, t, atF, clipFrames(edit, c));
    t.clips.push(c); sortTrack(edit, t); checkOverlap(edit, t, 'add');
    return edit;
  },

  // trim { id, in?, out?, ripple? }: head trims keep the remaining picture where it is (at moves with the new in-point)
  trim(edit, a) {
    const { F, S } = grid(edit), { track: t, clip: c } = findClip(edit, a.id);
    need(!c.freeze, `trim: ${c.id} is a freeze frame; change its length with speed or freeze`);
    need(a.in !== undefined || a.out !== undefined, 'trim: give in and/or out');
    const s = srcOf(edit, c), oldIn = F(c.in), oldOut = F(c.out), oldLen = clipFrames(edit, c), oldAt = F(c.at);
    const inF = a.in === undefined ? oldIn : F(sec(a.in, 'in')), outF = a.out === undefined ? oldOut : F(sec(a.out, 'out'));
    need(inF >= 0 && inF < outF, `trim ${c.id}: in ${S(inF)}s must be before out ${S(outF)}s`);
    need(outF <= s.frames, `trim ${c.id}: out ${S(outF)}s is beyond the end of "${c.src}" (${S(s.frames)}s)`);
    const headDelta = a.in === undefined ? 0 : Math.round((inF - oldIn) / ((oldOut - oldIn) / oldLen)); // timeline frames removed from the head
    c.in = S(inF); c.out = S(outF);
    if (c.speed) setSpeed(edit, c, c.speed);
    c.at = S(oldAt + headDelta);
    if (a.ripple) shiftAfter(edit, t, oldAt + oldLen, F(c.at) + clipFrames(edit, c) - (oldAt + oldLen), c.id);
    sortTrack(edit, t); checkOverlap(edit, t, 'trim');
    return edit;
  },

  // split { id, t }: t is a timeline time strictly inside the clip. Both halves keep exact frame counts.
  split(edit, a) {
    const { F, S } = grid(edit), { track: tr, clip: c } = findClip(edit, a.id), atF = F(c.at), len = clipFrames(edit, c), tF = F(sec(a.t, 't'));
    need(tF > atF && tF < atF + len, `split ${c.id}: t=${S(tF)}s is not inside the clip (${c.at}s to ${S(atF + len)}s)`);
    const left = tF - atF, right = len - left, id2 = a.id2 ?? nextId(edit);
    need(!edit.tracks.some((x) => x.clips.some((y) => y.id === id2)), `split: id "${id2}" already exists`);
    const b = { ...structuredClone(c), id: id2, at: S(tF) };
    if (c.freeze) { c.dur = S(left); b.dur = S(right); }
    else {
      const sf = srcFrames(edit, c), cut = c.dur !== undefined ? Math.round((left * sf) / len) : left, inF = F(c.in);
      need(cut > 0 && cut < sf, `split ${c.id}: too close to an edge for a whole source frame`);
      c.out = S(inF + cut); b.in = S(inF + cut);
      if (c.dur !== undefined) { c.dur = S(left); b.dur = S(right); }
    }
    if (c.audio?.fade_ms) { b.audio = { ...c.audio, fade_ms: [8, c.audio.fade_ms[1]] }; c.audio = { ...c.audio, fade_ms: [c.audio.fade_ms[0], 8] }; } // the new join gets the micro-fade
    delete b.xfade_ms; // a split makes a fresh cut: no inherited crossfade on the new join
    tr.clips.push(b); sortTrack(edit, tr);
    return edit;
  },

  // delete { id }: removes the clip and leaves a gap
  delete(edit, a) { const { track: t, clip: c } = findClip(edit, a.id); t.clips.splice(t.clips.indexOf(c), 1); return edit; },

  // ripple-delete { id } | { track?, from, to, all? }: remove a clip, or a timeline range (splitting clips at its edges), and close the gap
  'ripple-delete'(edit, a) {
    const { F, S } = grid(edit);
    const range = (t, fromF, toF) => {
      for (const edge of [fromF, toF]) { const hit = t.clips.find((c) => F(c.at) < edge && F(c.at) + clipFrames(edit, c) > edge); if (hit) OPS.split(edit, { id: hit.id, t: S(edge) }); }
      t.clips = t.clips.filter((c) => !(F(c.at) >= fromF && F(c.at) + clipFrames(edit, c) <= toF));
      shiftAfter(edit, t, toF, -(toF - fromF));
    };
    if (a.id !== undefined) {
      const { track: t, clip: c } = findClip(edit, a.id), atF = F(c.at), len = clipFrames(edit, c);
      if (a.all) { for (const o of edit.tracks) if (o !== t) range(o, atF, atF + len); }
      t.clips.splice(t.clips.indexOf(c), 1); shiftAfter(edit, t, atF + len, -len);
      return edit;
    }
    const t = getTrack(edit, a.track ?? 'V1'), fromF = F(sec(a.from, 'from')), toF = F(sec(a.to, 'to'));
    need(toF > fromF, `ripple-delete: to ${S(toF)}s must be after from ${S(fromF)}s`);
    range(t, fromF, toF);
    if (a.all) for (const o of edit.tracks) if (o !== t) range(o, fromF, toF);
    return edit;
  },

  // move { id, at, track? }
  move(edit, a) {
    const { F, S } = grid(edit), { track: from, clip: c } = findClip(edit, a.id), to = a.track ? getTrack(edit, a.track) : from;
    need(F(sec(a.at, 'at')) >= 0, 'move: at must be >= 0');
    if (to !== from) { kindOk(edit, to, c); from.clips.splice(from.clips.indexOf(c), 1); to.clips.push(c); }
    c.at = S(F(a.at)); sortTrack(edit, to); checkOverlap(edit, to, 'move');
    return edit;
  },

  // reorder { track?, order:[ids] }: lay the clips out back to back in this order, starting where the first one started
  reorder(edit, a) {
    const { F, S } = grid(edit), t = getTrack(edit, a.track ?? 'V1');
    need(Array.isArray(a.order) && a.order.length === t.clips.length && new Set(a.order).size === a.order.length && a.order.every((id) => t.clips.some((c) => c.id === id)),
      `reorder: order must list each of ${t.id}'s clips exactly once (${t.clips.map((c) => c.id).join(', ')})`);
    let at = Math.min(...t.clips.map((c) => F(c.at)));
    for (const id of a.order) { const c = t.clips.find((x) => x.id === id); c.at = S(at); at += clipFrames(edit, c); delete c.xfade_ms; }
    sortTrack(edit, t); return edit;
  },

  // speed { id, speed, ripple?=true }
  speed(edit, a) {
    const { F } = grid(edit), { track: t, clip: c } = findClip(edit, a.id);
    need(!c.freeze, 'speed: cannot retime a freeze frame');
    const oldLen = clipFrames(edit, c), atF = F(c.at);
    setSpeed(edit, c, a.speed);
    if (a.ripple !== false) shiftAfter(edit, t, atF + oldLen, clipFrames(edit, c) - oldLen, c.id);
    sortTrack(edit, t); checkOverlap(edit, t, 'speed'); return edit;
  },

  // freeze { id, t, dur }: hold the frame at timeline time t for dur seconds (the rest of the track moves later)
  freeze(edit, a) {
    const { F, S } = grid(edit), { track: tr, clip: c } = findClip(edit, a.id), atF = F(c.at), tF = F(sec(a.t, 't')), durF = F(sec(a.dur, 'dur'));
    need(durF >= 1, 'freeze: dur must be at least one frame');
    need(!c.freeze && tF >= atF && tF < atF + clipFrames(edit, c), `freeze: t=${S(tF)}s must fall on a frame of ${c.id}`);
    let rightId = c.id;
    if (tF > atF) { OPS.split(edit, { id: c.id, t: S(tF) }); rightId = tr.clips.find((x) => x.at === S(tF) && x.id !== c.id)?.id; }
    const right = tr.clips.find((x) => x.id === rightId), srcF = F(right.in);
    shiftAfter(edit, tr, tF, durF, undefined);
    const fz = { id: nextId(edit), src: right.src, freeze: true, in: S(srcF), out: S(srcF + 1), at: S(tF), dur: S(durF) };
    tr.clips.push(fz); sortTrack(edit, tr); return edit;
  },

  // volume { id, db }
  volume(edit, a) { const { clip: c } = findClip(edit, a.id); need(typeof a.db === 'number' && a.db >= -60 && a.db <= 24, `volume: db must be -60..24, got ${a.db}`); c.audio = { ...(c.audio || {}), gain_db: a.db }; if (a.db === 0 && !c.audio.fade_ms && !c.audio.mute) delete c.audio; return edit; },

  // fade { id, in_ms?, out_ms? }: audio fades at the clip's edges (default micro-fade 8 ms)
  fade(edit, a) {
    const { clip: c } = findClip(edit, a.id), cur = c.audio?.fade_ms || [8, 8], len = clipFrames(edit, c);
    const fi = a.in_ms ?? cur[0], fo = a.out_ms ?? cur[1], { fps } = grid(edit);
    for (const [v, w] of [[fi, 'in_ms'], [fo, 'out_ms']]) need(typeof v === 'number' && v >= 0 && v <= 10000, `fade: ${w} must be 0..10000`);
    need((fi + fo) / 1000 <= (len * fps.den) / fps.num + 1e-9, `fade: ${fi}+${fo} ms is longer than the clip (${Math.round((len * fps.den * 1000) / fps.num)} ms)`);
    c.audio = { ...(c.audio || {}), fade_ms: [fi, fo] }; return edit;
  },

  // xfade { a, b, ms }: a crossfade at the join of two adjacent clips (rendered from P5; the model records it now)
  xfade(edit, x) {
    const { F } = grid(edit), A = findClip(edit, x.a), B = findClip(edit, x.b);
    need(A.track === B.track, `xfade: ${x.a} and ${x.b} are on different tracks`);
    need(F(A.clip.at) + clipFrames(edit, A.clip) === F(B.clip.at), `xfade: ${x.b} does not start exactly where ${x.a} ends (no gap or overlap allowed)`);
    need(typeof x.ms === 'number' && x.ms >= 0 && x.ms <= 5000, 'xfade: ms must be 0..5000');
    const { fps } = grid(edit), maxMs = (Math.min(clipFrames(edit, A.clip), clipFrames(edit, B.clip)) * fps.den * 1000) / fps.num / 2;
    need(x.ms <= maxMs + 1e-9, `xfade: ${x.ms} ms is more than half of the shorter clip (${Math.floor(maxMs)} ms)`);
    if (x.ms === 0) delete B.clip.xfade_ms; else B.clip.xfade_ms = x.ms; return edit;
  },

  // crop-keyframe { id, fmt, t, cx, cy, zoom? }: the camera for one output format; t is clip-local seconds
  'crop-keyframe'(edit, a) {
    const { clip: c } = findClip(edit, a.id), { F, S } = grid(edit);
    need(['9:16', '1:1', '16:9', '4:5'].includes(a.fmt), `crop-keyframe: fmt must be 9:16, 1:1, 16:9 or 4:5, got ${a.fmt}`);
    for (const k of ['cx', 'cy']) need(typeof a[k] === 'number' && a[k] >= 0 && a[k] <= 1, `crop-keyframe: ${k} must be 0..1 (fraction of the source), got ${a[k]}`);
    const zoom = a.zoom ?? 1; need(zoom >= 1 && zoom <= 8, `crop-keyframe: zoom must be 1..8, got ${zoom}`);
    const t = S(F(sec(a.t ?? 0, 't'))); need(t >= 0 && F(t) < clipFrames(edit, c), `crop-keyframe: t=${t}s is outside the clip`);
    const kf = (c.crop ||= {})[a.fmt] ||= []; const i = kf.findIndex((k) => k.t === t);
    const next = { t, cx: r6(a.cx), cy: r6(a.cy), zoom: r6(zoom) }; if (i >= 0) kf[i] = next; else kf.push(next);
    kf.sort((p, q) => p.t - q.t); return edit;
  },

  // overlay { action:"add"|"update"|"remove", id?, type?, at?, dur?, props? }
  overlay(edit, a) {
    const { F, S } = grid(edit), act = a.action ?? 'add';
    if (act === 'remove') { const i = edit.overlays.findIndex((o) => o.id === a.id); need(i >= 0, `overlay: no overlay "${a.id}"`, 'notfound'); edit.overlays.splice(i, 1); return edit; }
    if (act === 'update') {
      const o = edit.overlays.find((x) => x.id === a.id); need(o, `overlay: no overlay "${a.id}"`, 'notfound');
      if (a.at !== undefined) o.at = S(F(sec(a.at, 'at'))); if (a.dur !== undefined) { need(F(a.dur) >= 1, 'overlay: dur must be at least one frame'); o.dur = S(F(a.dur)); } if (a.props) o.props = { ...o.props, ...a.props };
      return edit;
    }
    need(OVERLAY_TYPES.includes(a.type), `overlay: type must be one of ${OVERLAY_TYPES.join(', ')}, got ${a.type}`);
    need(F(sec(a.at, 'at')) >= 0 && F(sec(a.dur, 'dur')) >= 1, 'overlay: at >= 0 and dur >= one frame');
    const id = a.id ?? nextId(edit, 'o'); need(!edit.overlays.some((o) => o.id === id), `overlay: id "${id}" already exists`);
    edit.overlays.push({ id, type: a.type, at: S(F(a.at)), dur: S(F(a.dur)), props: { ...(a.props || {}) } });
    edit.overlays.sort((p, q) => F(p.at) - F(q.at) || (p.id < q.id ? -1 : 1)); return edit;
  },

  // caption-style { style?, from?, font?, accent?, position?, overrides? }
  'caption-style'(edit, a) {
    if (a.style !== undefined) need(CAPTION_STYLES.includes(a.style), `caption-style: style must be one of ${CAPTION_STYLES.join(', ')}, got ${a.style}`);
    if (a.overrides !== undefined) need(Array.isArray(a.overrides) && a.overrides.every((o) => Number.isInteger(o.word) && typeof o.text === 'string'), 'caption-style: overrides is [{ word: <index>, text }]');
    const { op, ...rest } = a; void op;
    edit.captions = { ...(edit.captions || { style: 'pop' }), ...rest }; return edit;
  },

  // marker { action?:"add"|"remove", t?, label?, id? }
  marker(edit, a) {
    const { F, S } = grid(edit);
    if ((a.action ?? 'add') === 'remove') { const i = edit.markers.findIndex((m) => m.id === a.id); need(i >= 0, `marker: no marker "${a.id}"`, 'notfound'); edit.markers.splice(i, 1); return edit; }
    need(F(sec(a.t, 't')) >= 0, 'marker: t must be >= 0');
    const id = a.id ?? nextId(edit, 'm'); need(!edit.markers.some((m) => m.id === id), `marker: id "${id}" already exists`);
    edit.markers.push({ id, t: S(F(a.t)), label: String(a.label ?? '') }); edit.markers.sort((p, q) => p.t - q.t || (p.id < q.id ? -1 : 1)); return edit;
  },
};

// Queries: read-only, return a value instead of a new edit.
export const QUERIES = {
  // snap { t, to:"frames"|"cuts"|"beats"|"words", tolerance? (seconds) } -> { t, snapped, to }
  snap(edit, a, ctx = {}) {
    const { F, S } = grid(edit), t = sec(a.t, 't'), tol = a.tolerance ?? 0.1, to = a.to ?? 'frames';
    need(['frames', 'cuts', 'beats', 'words'].includes(to), 'snap: to must be frames, cuts, beats or words');
    const frameT = S(F(t));
    if (to === 'frames') return { t, snapped: frameT, to, hit: true };
    const pool = to === 'cuts' ? edit.tracks.flatMap((x) => x.clips.flatMap((c) => [F(c.at), F(c.at) + clipFrames(edit, c)])).map(S) : to === 'beats' ? (ctx.beats || []) : (ctx.words || []);
    let best = null; for (const p of pool) if (Math.abs(p - t) <= tol && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return { t, snapped: best === null ? frameT : S(F(best)), to, hit: best !== null };
  },
};

export const OP_NAMES = Object.keys(OPS);

// Apply one op to a copy of the edit. Returns the new edit (rev untouched: the store owns revisions).
export function applyOp(edit, op, ctx = {}) {
  const name = op.op ?? op.name;
  if (QUERIES[name]) throw new OpError(`"${name}" is a query, not an edit: use query()`);
  need(OPS[name], `unknown op "${name}" (ops: ${OP_NAMES.join(', ')})`);
  const next = structuredClone(edit);
  OPS[name](next, op, ctx);
  validateEdit(next);
  return next;
}
export const query = (edit, q, ctx) => { const n = q.op ?? q.name; need(QUERIES[n], `unknown query "${n}"`); return QUERIES[n](edit, q, ctx); };

// Structural + timing invariants. Throws OpError naming the first violation.
export function validateEdit(edit) {
  need(edit && edit.version === EDIT_VERSION, `edit.json version ${edit?.version} is not supported (this build reads ${EDIT_VERSION})`);
  const { F, S } = grid(edit), seen = new Set();
  need(Array.isArray(edit.tracks) && edit.tracks.length > 0, 'edit has no tracks');
  const trackIds = new Set();
  for (const t of edit.tracks) {
    need(!trackIds.has(t.id) && ['video', 'audio'].includes(t.kind), `bad track ${t.id}/${t.kind}`); trackIds.add(t.id);
    for (const c of t.clips) {
      need(!seen.has(c.id), `duplicate clip id ${c.id}`); seen.add(c.id);
      const s = edit.sources[c.src]; need(s, `clip ${c.id}: unknown source "${c.src}"`);
      for (const k of ['in', 'out', 'at']) need(typeof c[k] === 'number' && c[k] === S(F(c[k])), `clip ${c.id}: ${k}=${c[k]} is not on the frame grid`);
      need(F(c.in) >= 0 && F(c.out) > F(c.in) && F(c.out) <= s.frames, `clip ${c.id}: source range ${c.in}-${c.out}s is outside "${c.src}" (0-${S(s.frames)}s)`);
      need(F(c.at) >= 0, `clip ${c.id}: negative position`);
      if (c.dur !== undefined) need(c.dur === S(F(c.dur)) && F(c.dur) >= 1, `clip ${c.id}: dur=${c.dur} is not whole frames`);
      if (c.speed !== undefined) need(c.speed >= 0.1 && c.speed <= 16 && c.dur !== undefined, `clip ${c.id}: speed needs dur and 0.1..16`);
      if (c.freeze) need(c.dur !== undefined, `clip ${c.id}: freeze needs dur`);
    }
    checkOverlap(edit, t, 'validate');
  }
  for (const o of edit.overlays) { need(!seen.has(o.id), `duplicate id ${o.id}`); seen.add(o.id); need(F(o.dur) >= 1 && F(o.at) >= 0, `overlay ${o.id}: bad time`); }
  for (const m of edit.markers) { need(!seen.has(m.id), `duplicate id ${m.id}`); seen.add(m.id); }
  return true;
}

// ── EDL (open-edit's shape): { sources:{id:path}, ranges:[{ source, start, end, note }] } ─────────────────────────────────────
export function toEdl(edit, { track = 'V1' } = {}) {
  const t = getTrack(edit, track), cs = [...t.clips].sort((a, b) => grid(edit).F(a.at) - grid(edit).F(b.at));
  for (const c of cs) need(!c.freeze && c.speed === undefined, `EDL cannot carry speed changes or freezes (clip ${c.id}); export a version without them`);
  const used = [...new Set(cs.map((c) => c.src))];
  return { sources: Object.fromEntries(used.map((id) => [id, edit.sources[id].path])), ranges: cs.map((c) => ({ source: c.src, start: c.in, end: c.out, ...(c.note ? { note: c.note } : {}) })) };
}
export function fromEdl(edl, { fps, bin }) {
  need(edl && typeof edl.sources === 'object' && Array.isArray(edl.ranges) && edl.ranges.length > 0, 'EDL needs "sources" and a non-empty "ranges"');
  let edit = newEdit({ fps });
  // a source id that is in the bin with the same path wins; otherwise match by path (an EDL from elsewhere names its own ids)
  const idFor = (srcId) => { const path = edl.sources[srcId]; need(path, `EDL range names unknown source "${srcId}"`); return bin.sources[srcId]?.path === path ? srcId : Object.entries(bin.sources).find(([, b]) => b.path === path)?.[0] ?? null; };
  for (const r of edl.ranges) {
    const id = idFor(r.source); need(id, `EDL source "${r.source}" (${edl.sources[r.source]}) is not ingested: run \`studio ingest\` first`, 'notfound');
    edit = applyOp(edit, { op: 'add', src: id, in: r.start, out: r.end, ...(r.note ? { note: r.note } : {}) }, { bin });
  }
  return edit;
}
