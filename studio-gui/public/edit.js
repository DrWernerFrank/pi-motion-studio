// edit.js: the Edit tab — an NLE surface over edit.json, for films with real footage.
// Same vanilla-module style as app.js (no build, no framework, no deps). app.js mounts it:
//   EDIT.init({...}) once, EDIT.setFilm(S, d) per film; the dock (multi-track timeline) shows for
//   edit films, the right panel gets the Edit tab (media bin · inspector · cut proposals · transcript).
//
// Every mutation goes through the server's /api/edit-ops -> edit-store applyOps(film, ops, {baseRev}):
// read rev, send it with the op, and on a 409 'conflict' reload the edit and retry once. Ops run
// in-process in the server (never a spawned CLI per click).
//
// Frame math, snapping and word retiming are the SAME modules the engine and the film page use,
// imported over HTTP — so the GUI can never disagree with the renderer about a frame:
//   /engine/lib/edit-ops.mjs  grid, clipFrames, QUERIES.snap, timelineSeconds …
//   /engine/lib/retime.mjs   retimeWords (source word times -> timeline times)
import { clipFrames, grid, QUERIES, timelineFrames, timelineSeconds } from '/engine/lib/edit-ops.mjs';
import { retimeWords } from '/engine/lib/retime.mjs';

// Filler words, mirrored from engine/cut.mjs (that module imports node:fs, so it cannot be
// browser-imported). Language-aware: keyed by transcript.json's `language`.
const FILLERS = { en: ['um', 'umm', 'uh', 'uhh', 'hmm', 'er', 'erm', 'mm'], fa: ['امم', 'اه'] };
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

let ctx = null;   // { S, esc, post, api, seek, pause, selectFilm, job, reloadPreview, audio, iframe }
let big = null;    // #editTl canvas
const el = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const RULER = 22, GUT = 42, LANE_V = 78, LANE_A = 58;

// ── state ────────────────────────────────────────────────────────────────────────────────────
const E = {
  key: null, edit: null, rev: -1, editMtime: 0, sources: {}, history: { undo: 0, redo: 0 }, loadedOnce: false,
  // view
  zoom: 60, scroll: 0, sel: null, io: null, hover: null, drag: null, dropX: null, dropLane: null, binDrag: null,
  // transport
  playing: false, rate: 0, raf: 0, t0: 0, at0: 0, lastPost: 0, audioMaster: false,
  // per-source media caches
  peaks: {}, imgs: {},
  // transcript pane
  tr: null, trSrc: null, trSearch: '', trSel: null, trSig: '',
  // cut proposals
  cuts: null,
  snapMode: 'all',
};

// ── small helpers ─────────────────────────────────────────────────────────────────────────────
const G = () => grid(E.edit);
const dur = () => Math.max(0.001, timelineSeconds(E.edit));
const endS = (c) => G().S(G().F(c.at) + clipFrames(E.edit, c));
const srcK = (c) => { const g = G(), sf = g.F(c.out) - g.F(c.in); return sf ? sf / clipFrames(E.edit, c) : 1; };
const findClip = (id) => { for (const t of E.edit.tracks) for (const c of t.clips) if (c.id === id) return c; return null; };
const X = (t) => GUT + (t - E.scroll) * E.zoom;
const T = (x) => E.scroll + (x - GUT) / E.zoom;
const frameSnap = (t) => G().S(G().F(t));
const visT = () => Math.max(0.001, (big.clientWidth - GUT) / E.zoom);
const clampScroll = () => { E.scroll = clamp(E.scroll, 0, Math.max(0, dur() - visT())); };
const beats = () => ctx.S.d?.beats?.beats || [];
const wordTimes = () => (E.tr && !E.tr.missing ? E.tr.mapped.flatMap((w) => [w.start, w.end]) : []);

function tcf(t) {
  const fps = G().fps.value, n = Math.max(1, Math.round(fps));
  let f = Math.round((t - Math.floor(t)) * fps), s = Math.floor(t);
  if (f >= n) { f -= n; s += 1; }
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(f)}`;
}

// snapping through the engine's own query (QUERIES.snap), on the edit we already hold.
// Tolerance ~0.1 s, scaled down when zoomed in so it never jumps more than ~9 px.
function snapT(t, forceMode) {
  const frame = frameSnap(t);
  const mode = forceMode || E.snapMode;
  if (mode === 'off' || !E.edit) return frame;
  const g = G(), tol = Math.min(0.1, Math.max(1 / g.fps.value, 9 / E.zoom));
  const wctx = { beats: beats(), words: wordTimes() };
  let best = null;
  for (const k of mode === 'all' ? ['cuts', 'words', 'beats'] : [mode]) {
    let r = null;
    try { r = QUERIES.snap(E.edit, { t, to: k, tolerance: tol }, wctx); } catch { r = null; }
    if (r && r.hit && (best === null || Math.abs(r.snapped - t) < Math.abs(best - t))) best = r.snapped;
  }
  return best ?? frame;
}

function overlaps(track, clip, at) {
  const g = G(), a = g.F(at), b = a + clipFrames(E.edit, clip);
  return track.clips.some((o) => o.id !== clip.id && g.F(o.at) < b && g.F(o.at) + clipFrames(E.edit, o) > a);
}

function lanes() {
  const H = big.clientHeight, vids = E.edit.tracks.filter((t) => t.kind === 'video'), auds = E.edit.tracks.filter((t) => t.kind !== 'video');
  const avail = H - RULER - 10 - (E.edit.overlays?.length ? 16 : 2);
  const hv = Math.min(LANE_V, Math.max(28, Math.floor((avail * 0.58) / Math.max(1, vids.length)) - 4));
  const ha = Math.min(LANE_A, Math.max(22, Math.floor((avail * 0.42) / Math.max(1, auds.length)) - 4));
  const out = []; let y = RULER + 5;
  for (const t of vids) { out.push({ track: t, y, h: hv }); y += hv + 4; }
  for (const t of auds) { out.push({ track: t, y, h: ha }); y += ha + 4; }
  return out;
}
const laneAt = (y) => lanes().find((l) => y >= l.y && y < l.y + l.h) || null;

// ── mount / refresh ──────────────────────────────────────────────────────────────────────────
export const handles = (S) => !!(S && S.d && S.d.edit);

export function init(c) {
  ctx = c; big = el('#editTl');
  E.snapMode = el('#eSnap')?.value || 'all';
  el('#eSnap').onchange = (e) => (E.snapMode = e.target.value);
  el('#eUndo').onclick = () => undoOp();
  el('#eRedo').onclick = () => redoOp();
  el('#eSplit').onclick = () => splitAtPlayhead();
  el('#eRdel').onclick = () => delSelection();
  el('#eMark').onclick = () => addMarker();
  el('#eZoomIn').onclick = () => zoomAt(GUT + visT() * E.zoom * 0.5, 1.45);
  el('#eZoomOut').onclick = () => zoomAt(GUT + visT() * E.zoom * 0.5, 1 / 1.45);
  el('#eFit').onclick = () => fit();
  el('#eDraft').onclick = () => { msg('starting draft render — see the Run tab', true); ctx.job('draft'); };

  big.addEventListener('pointerdown', onDown);
  big.addEventListener('pointermove', onMove);
  big.addEventListener('pointerup', onUp);
  big.addEventListener('pointerleave', () => { if (!E.drag) { E.hover = null; E.hoverSig = null; big.style.cursor = 'default'; draw(); } });
  big.addEventListener('dblclick', onDbl);
  big.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(pos(e).x, Math.exp(-e.deltaY * 0.0022));
    else { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; E.scroll += (d / E.zoom) * (e.shiftKey ? 3 : 1); clampScroll(); draw(); }
  }, { passive: false });
  big.addEventListener('dragover', (e) => { e.preventDefault(); const p = pos(e); E.dropX = p.x; E.dropLane = laneAt(p.y); draw(); });
  big.addEventListener('dragleave', () => { E.dropX = null; E.dropLane = null; draw(); });
  big.addEventListener('drop', onDrop);
  addEventListener('resize', () => draw());
}

export function setFilm(S, d) {
  if (!d || !d.edit) return unmount(S);
  if (E.key !== d.key) {
    Object.assign(E, { key: d.key, edit: null, rev: -1, editMtime: 0, sources: {}, loadedOnce: false, sel: null, io: null, drag: null,
      peaks: {}, imgs: {}, tr: null, trSrc: null, trSel: null, trSig: '', cuts: null, zoom: 60, scroll: 0, playing: false, rate: 0, opNames: [],
      _fitted: false, _ssig: null, hoverSig: null, dropX: null, binDrag: null });
  }
  mount(S);
  load().catch((e) => fail(e));
}

function mount(S) {
  el('#film').classList.add('edit');
  el('#editDock').hidden = false;
  el('#editTabBtn').hidden = false;
  if (S.tab === 'edit') renderTab(S, el('#tabBody'));
  draw();
}
function unmount(S) {
  if (E.playing) pause();
  E.key = null; E.edit = null; E.rev = -1; E.tr = null; E.trSrc = null; E.sel = null; E.drag = null; E.dropX = null;
  el('#film').classList.remove('edit');
  el('#editDock').hidden = true;
  el('#editTabBtn').hidden = true;
  if (S && S.tab === 'edit') { S.tab = 'overview'; }   // app.js's renderTab takes it from here
  const tb = el('#tabBody'); if (tb) tb.__editRoot = null;
}

// Load (or refresh) the edit. Adopts only when the rev actually moved, so an unrelated file
// change in the film folder never clobbers the user's selection, zoom or scroll.
async function load() {
  const r = await ctx.api(`/api/edit?film=${E.key}`);
  if (!r || r.error) { fail(r?.error ? new Error(r.error) : new Error('edit.json failed to load')); return null; }
  if (r.key !== E.key) return null;
  const ssig = JSON.stringify(Object.entries(r.sources || {}).map(([id, s]) => [id, s.kind, s.duration, s.has_transcript, s.original_here]));
  if (r.rev !== E.rev || ssig !== E._ssig) {
    const had = E.loadedOnce;
    Object.assign(E, { edit: r.edit, rev: r.rev, editMtime: r.editMtime, sources: r.sources || {}, history: r.history || E.history, _ssig: ssig, loadedOnce: true,
      opNames: r.ops || E.opNames || [] });
    if (E.sel && !findClip(E.sel)) E.sel = null;                      // selection survives only if the clip does
    if (E.tr && !E.tr.missing) retimeTranscript();
    if (had) ctx.reloadPreview();                                     // the film page reads edit.json at setup: reload it
    if (!E._fitted) { fit(); E._fitted = true; }
    if (!E.trSrc && E.sources) {                                      // the transcript pane follows the film
      const first = E.edit.tracks.find((t) => t.kind === 'video')?.clips?.[0]?.src || trCandidates()[0];
      if (first) loadTranscript(first);
    }
    if (el('#tabBody').__editRoot === E.key) refreshPanel();
    else if (ctx.S.tab === 'edit') renderTab(ctx.S, el('#tabBody'));
  } else E.history = r.history || E.history;
  refresh();
  return r;
}

function adopt(r) {   // a mutation of ours came back: swap in the new edit, keep the view state
  if (!r || r.rev === undefined) return;
  E.edit = r.edit; E.rev = r.rev; E.history = r.history || E.history; E.editMtime = Date.now();   // the edit is now newer than any mix
  if (E.sel && !findClip(E.sel)) E.sel = null;
  if (E.tr && !E.tr.missing) retimeTranscript();
  refresh();
  ctx.reloadPreview();
  refreshPanel();
}

// The 409 story: send baseRev; on 'conflict' reload the edit and retry exactly once.
async function mutate(ops, retry = true) {
  if (!E.edit) return null;
  let r;
  try { r = await ctx.post(`/api/edit-ops?film=${E.key}`, { ops, baseRev: E.rev }); }
  catch (e) {
    if (e.code === 'conflict' && retry) {
      msg('edit changed underneath — reloading and retrying once…');
      await load();
      try { r = await ctx.post(`/api/edit-ops?film=${E.key}`, { ops, baseRev: E.rev }); }
      catch (e2) { return fail(e2), null; }
    } else return fail(e), null;
  }
  if (r.error) return fail(r), null;
  adopt(r);
  return r;
}

async function undoOp() {
  try {
    const r = await ctx.post(`/api/edit-undo?film=${E.key}`, { baseRev: E.rev });
    adopt(r);
  } catch (e) {
    if (e.code === 'conflict') { await load(); try { adopt(await ctx.post(`/api/edit-undo?film=${E.key}`, { baseRev: E.rev })); } catch (e2) { fail(e2); } }
    else fail(e);
  }
}
async function redoOp() {
  try {
    const r = await ctx.post(`/api/edit-redo?film=${E.key}`, { baseRev: E.rev });
    adopt(r);
  } catch (e) {
    if (e.code === 'conflict') { await load(); try { adopt(await ctx.post(`/api/edit-redo?film=${E.key}`, { baseRev: E.rev })); } catch (e2) { fail(e2); } }
    else fail(e);
  }
}

function fail(e) { msg(String(e?.message || e || 'failed')); }
function msg(m, ok = false) {
  const n = el('#eMsg'); if (!n) return;
  n.textContent = m || ''; n.classList.toggle('ok', !!ok && !!m);
  clearTimeout(E._mt); if (m) E._mt = setTimeout(() => { n.textContent = ''; }, 6000);
}

// ── transport ─────────────────────────────────────────────────────────────────────────────────
// J/K/L shuttle. At 1x, if out/mix.wav is newer than edit.json (a `studio sound` ran since the last
// edit), it is the master clock, exactly like the live view of a rendered film; otherwise (or at
// any other rate) the wall clock drives the scrub.
export function play() {
  if (!E.edit) return;
  const S = ctx.S, D = S.d.cfg.duration || dur();
  E.playing = true; S.playing = true; el('#play').textContent = '❚❚';
  E.rate = E.rate || 1;
  if (E.rate === 1) {
    const mix = S.d.files.find((f) => f.name === 'mix.wav');
    E.audioMaster = !!(mix && mix.mtime >= E.editMtime && ctx.audio.src);
    if (E.audioMaster) { ctx.audio.currentTime = S.t; ctx.audio.play().catch(() => {}); }
  } else { E.audioMaster = false; try { ctx.audio.pause(); } catch {} }
  if (S.t >= D - 0.01 && E.rate > 0) S.t = 0;
  E.t0 = performance.now(); E.at0 = S.t;
  cancelAnimationFrame(E.raf); E.raf = requestAnimationFrame(loop);
}
export function pause() {
  E.playing = false; E.rate = 0; ctx.S.playing = false; el('#play').textContent = '▶';
  cancelAnimationFrame(E.raf); E.raf = 0;
  if (!ctx.audio.paused) { try { ctx.audio.pause(); } catch {} }   // pausing a paused element would cancel its preload (ERR_ABORTED)
  if (E.edit) ctx.seek(ctx.S.t);
}
function loop(now) {
  if (!E.playing || !E.edit) return;
  const S = ctx.S, D = S.d.cfg.duration || dur();
  let t = E.audioMaster && E.rate === 1 ? ctx.audio.currentTime : E.at0 + ((now - E.t0) / 1000) * E.rate;
  if (t >= D) {
    if (el('#loopChk').checked && E.rate > 0) { t = 0; E.at0 = 0; E.t0 = now; if (E.audioMaster) ctx.audio.currentTime = 0; }
    else { showT(D); return pause(); }
  }
  if (t <= 0 && E.rate < 0) { showT(0); return pause(); }
  showT(t);
  E.raf = requestAnimationFrame(loop);
}
function showT(t) {   // editor-local time set: tc + both canvases + a throttled postMessage to the film page
  const S = ctx.S;
  S.t = clamp(t, 0, S.d.cfg.duration || dur());
  el('#tc').textContent = S.t.toFixed(2) + 's';
  refresh();
  const now = performance.now();
  if (now - E.lastPost >= 60 && S.frameReady) { E.lastPost = now; try { ctx.iframe.contentWindow.postMessage({ seek: S.t }, '*'); } catch {} }
}
function shuttle(dir) {
  if (!E.edit) return;
  if (!E.playing || Math.sign(E.rate) !== dir) E.rate = dir;
  else E.rate = dir * Math.min(32, Math.abs(E.rate) * 2);
  play();
  msg(`shuttle ${E.rate > 0 ? '+' : ''}${E.rate}×`);
}

// ── keys ──────────────────────────────────────────────────────────────────────────────────────
export function keys(e) {
  if (!E.edit) return false;
  const S = ctx.S;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redoOp() : undoOp(); return true; }
    if (k === 'y') { e.preventDefault(); redoOp(); return true; }
    return false;
  }
  switch (e.key.toLowerCase()) {
    case 'l': e.preventDefault(); shuttle(1); return true;
    case 'j': e.preventDefault(); shuttle(-1); return true;
    case 'k': e.preventDefault(); pause(); return true;
    case 'i': e.preventDefault(); setIO('i'); return true;
    case 'o': e.preventDefault(); setIO('o'); return true;
    case 's': e.preventDefault(); splitAtPlayhead(); return true;
    case 'm': e.preventDefault(); addMarker(); return true;
    case 'delete': case 'backspace': e.preventDefault(); delSelection(); return true;
    case 'escape': E.trSel = null; E.io = null; draw(); refreshTr(); return true;
    case 'arrowleft': case 'arrowright': {
      e.preventDefault();
      const g = G(), dir = e.key === 'arrowright' ? 1 : -1, step = e.shiftKey ? Math.round(g.fps.value) : 1;
      ctx.pause(); ctx.seek(g.S(Math.max(0, g.F(S.t) + dir * step)));
      return true;
    }
    case 'home': e.preventDefault(); ctx.seek(0); return true;
    case 'end': e.preventDefault(); ctx.seek(dur()); return true;
  }
  return false;
}

function setIO(which) {
  if (!E.edit) return;
  const t = frameSnap(ctx.S.t);
  E.io = E.io || {};
  E.io[which] = t;
  if (E.io.i != null && E.io.o != null && E.io.o < E.io.i) { const i = E.io.i; E.io.i = E.io.o; E.io.o = i; msg('I/O swapped'); }
  draw();
}

async function splitAtPlayhead() {
  if (!E.edit) return;
  const g = G(), t = frameSnap(ctx.S.t), ops = [];
  for (const tr of E.edit.tracks) for (const c of tr.clips) {
    const a = g.F(c.at), b = a + clipFrames(E.edit, c), k = g.F(t);
    if (k > a && k < b) ops.push({ op: 'split', id: c.id, t: g.S(k) });
  }
  if (!ops.length) return msg(`nothing under the playhead at ${tcf(t)} to split`);
  const r = await mutate(ops);
  if (r) msg(`split ${ops.length} clip${ops.length > 1 ? 's' : ''} at ${tcf(t)}`, true);
}

async function delSelection() {   // word range > selected clip > I/O range
  if (!E.edit) return;
  if (E.trSel && E.tr && !E.tr.missing) {
    const ws = E.tr.mapped.slice(Math.min(E.trSel.a, E.trSel.b), Math.max(E.trSel.a, E.trSel.b) + 1).filter(Boolean);
    if (!ws.length) { E.trSel = null; } else {
      const from = frameSnap(ws[0].start), to = frameSnap(ws.at(-1).end);
      if (to <= from) { E.trSel = null; } else {
        const r = await mutate([{ op: 'ripple-delete', track: 'V1', from, to }]);
        if (r) { msg(`cut ${ws.length} words (${(to - from).toFixed(2)}s)`, true); E.trSel = null; refreshTr(); }
        return;
      }
    }
  }
  if (E.sel) {
    const r = await mutate([{ op: 'ripple-delete', id: E.sel }]);
    if (r) msg(`ripple-deleted ${E.sel}`, true);
    return;
  }
  if (E.io && E.io.i != null && E.io.o != null && E.io.o > E.io.i) {
    const r = await mutate([{ op: 'ripple-delete', track: 'V1', from: E.io.i, to: E.io.o }]);
    if (r) { msg(`cut the I–O range (${(E.io.o - E.io.i).toFixed(2)}s)`, true); E.io = null; draw(); }
    return;
  }
  msg('select a clip, a word range, or set I/O marks first');
}

async function addMarker() {
  if (!E.edit) return;
  const label = prompt('marker label (shown on the ruler)');
  if (label === null) return;   // prompt returns null only on cancel
  await mutate([{ op: 'marker', t: frameSnap(ctx.S.t), label }]);
}

// ── drawing: the big canvas ───────────────────────────────────────────────────────────────────
function draw() {
  if (!E.edit || el('#editDock').hidden || !big) return;
  const dpr = devicePixelRatio || 1, W = big.clientWidth, H = big.clientHeight;
  if (!W || !H) return;
  if (big.width !== Math.round(W * dpr) || big.height !== Math.round(H * dpr)) { big.width = Math.round(W * dpr); big.height = Math.round(H * dpr); }
  const c = big.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#0e0e11'; c.fillRect(0, 0, W, H);
  clampScroll();
  const d = dur(), S = ctx.S;

  c.save(); c.beginPath(); c.rect(GUT, 0, W - GUT, H); c.clip();
  if (E.io && E.io.i != null && E.io.o != null) {   // the I–O range, like an NLE in/out shading
    c.fillStyle = 'rgba(255,106,61,.07)'; c.fillRect(X(E.io.i), RULER, X(E.io.o) - X(E.io.i), H - RULER);
  }
  drawRuler(c, W);
  for (const l of lanes()) { drawLane(c, l, W); }
  if (E.edit.overlays?.length) drawOverlaysStrip(c, W);
  drawDragPreview(c, W, H);
  if (E.dropX != null) drawDropGhost(c, H);
  // playhead
  const px = X(S.t);
  if (px >= GUT - 1 && px <= W + 1) {
    c.fillStyle = '#fff'; c.fillRect(px - 1, 0, 2, H);
    c.fillStyle = '#111'; c.font = '600 10px ui-monospace, monospace';
    const label = `${tcf(S.t)}`, w = c.measureText(label).width + 10;
    c.fillStyle = '#ececef'; c.beginPath(); c.roundRect(clamp(px - w / 2, GUT, W - w), 3, w, 13, 3); c.fill();
    c.fillStyle = '#111'; c.fillText(label, clamp(px - w / 2, GUT, W - w) + 5, 13);
  }
  c.restore();

  // gutter (over everything)
  c.fillStyle = '#131316'; c.fillRect(0, 0, GUT, H);
  c.strokeStyle = '#26262b'; c.beginPath(); c.moveTo(GUT + .5, 0); c.lineTo(GUT + .5, H); c.stroke();
  c.font = '600 11px Inter, sans-serif'; c.textBaseline = 'middle';
  for (const l of lanes()) {
    c.fillStyle = l.track.kind === 'video' ? '#b4b4bd' : '#7ee0d0';
    c.fillText(l.track.id, 8, l.y + l.h / 2 - 6);
    c.fillStyle = '#5c5c66'; c.font = '10px Inter, sans-serif';
    c.fillText(l.track.kind, 8, l.y + l.h / 2 + 8);
    c.font = '600 11px Inter, sans-serif';
  }
  c.textBaseline = 'alphabetic';
  updateTools();   // tc + rev + undo/redo state ride along with every redraw
}

const RULER_STEPS = [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
function drawRuler(c, W) {
  const d = dur();
  c.fillStyle = '#131316'; c.fillRect(GUT, 0, W - GUT, RULER);
  const step = RULER_STEPS.find((s) => s * E.zoom >= 56) ?? 3600;
  const minor = step / 5;
  c.strokeStyle = '#26262b'; c.lineWidth = 1;
  if (minor * E.zoom >= 8) for (let t = Math.ceil(E.scroll / minor) * minor; t <= E.scroll + visT(); t += minor) {
    const x = Math.round(X(t)) + .5; c.strokeStyle = '#1e1e23'; c.beginPath(); c.moveTo(x, RULER - 5); c.lineTo(x, RULER); c.stroke();
  }
  const t0 = Math.floor(E.scroll / step) * step;
  c.font = '10px ui-monospace, monospace'; c.fillStyle = '#8b8b94'; c.strokeStyle = '#3a3a42';
  for (let i = 0; ; i++) {
    const t = t0 + i * step; if (t > E.scroll + visT() + step) break;
    const x = Math.round(X(t)) + .5;
    if (x < GUT) continue;
    c.beginPath(); c.moveTo(x, RULER - 9); c.lineTo(x, RULER); c.stroke();
    c.fillStyle = '#8b8b94';
    c.fillText(step < 1 ? t.toFixed(1) : rulerLabel(t), x + 3, RULER - 10);
  }
  // beat ticks (when the film has a measured/gridded beat map)
  const B = beats(), down = new Set(ctx.S.d?.beats?.downbeats || []);
  if (B.length) for (const b of B) {
    if (b < E.scroll || b > E.scroll + visT()) continue;
    c.fillStyle = down.has(b) ? '#55555f' : '#303036'; c.fillRect(Math.round(X(b)), RULER - 6, 1, down.has(b) ? 6 : 4);
  }
  // markers (clickable)
  for (const m of E.edit.markers || []) {
    if (m.t < E.scroll - 1 || m.t > E.scroll + visT() + 1) continue;
    const x = Math.round(X(m.t));
    c.fillStyle = '#f5b841'; c.beginPath(); c.moveTo(x, RULER - 12); c.lineTo(x + 7, RULER - 9); c.lineTo(x, RULER - 6); c.closePath(); c.fill();
    c.fillRect(x, RULER - 12, 1.5, 12);
    if (m.label) { c.fillStyle = '#8b8b94'; c.font = '9px Inter, sans-serif'; c.fillText(m.label.slice(0, 24), x + 9, RULER - 5); }
  }
  // open notes, like the motion timeline
  for (const n of (ctx.S.d?.notes || []).filter((n) => !n.done)) {
    if (n.t < E.scroll || n.t > E.scroll + visT()) continue;
    c.fillStyle = '#ff6a3d'; c.fillRect(Math.round(X(n.t)) - 1, RULER - 4, 3, 4);
  }
  // I/O brackets
  if (E.io) for (const [k, lab] of [['i', 'I'], ['o', 'O']]) {
    if (E.io[k] == null) continue;
    const x = Math.round(X(E.io[k]));
    c.strokeStyle = '#ff6a3d'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, RULER); c.lineTo(x, RULER + 9); c.moveTo(x - 4, RULER + 9); c.lineTo(x + 4, RULER + 9); c.stroke();
    c.lineWidth = 1; c.fillStyle = '#ff6a3d'; c.font = '600 9px ui-monospace, monospace'; c.fillText(lab, x + 5, RULER + 8);
  }
}
const rulerLabel = (t) => {
  const s = Math.round(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};

function drawLane(c, l, W) {
  c.fillStyle = l.track.kind === 'video' ? '#131316' : '#10141a';
  c.fillRect(GUT, l.y, W - GUT, l.h);
  c.strokeStyle = '#1b1b20'; c.beginPath(); c.moveTo(GUT, l.y + l.h + 1.5); c.lineTo(W, l.y + l.h + 1.5); c.stroke();
  const g = G();
  const shift = (cl) => {   // ripple-trim preview: later clips on the track slide by the length delta
    if (E.drag?.kind === 'trim' && E.drag.trackId === l.track.id && cl.id !== E.drag.id && g.F(cl.at) >= E.drag.end0F) return (E.drag.lenDeltaF / g.fps.value) * E.zoom;
    return 0;
  };
  for (const cl of [...l.track.clips].sort((a, b) => g.F(a.at) - g.F(b.at))) {
    const a = g.F(cl.at), b = a + clipFrames(E.edit, cl), sh = shift(cl);
    if (g.S(b) < E.scroll - 1 || g.S(a) > E.scroll + visT() + 1) continue;
    drawClip(c, cl, l, g.S(a), g.S(b), sh, W);
  }
}

function drawClip(c, cl, l, at, end, sh, W) {
  const x0 = Math.max(GUT, X(at) + sh), x1 = Math.min(W, X(end) + sh), w = x1 - x0;
  if (w <= 0) return;
  const sel = cl.id === E.sel, vid = l.track.kind === 'video';
  const dragged = E.drag?.kind === 'move' && E.drag.id === cl.id;
  const isAudioSrc = E.edit.sources[cl.src]?.kind === 'audio';
  const y = l.y + 2, h = l.h - 4;

  c.save();
  c.globalAlpha = dragged ? 0.45 : 1;
  // block
  c.beginPath(); c.roundRect(x0 + .5, y + .5, w - 1, h - 1, 5);
  c.fillStyle = sel ? '#2a2a33' : vid ? '#1f1f26' : '#14231f';
  c.fill();
  c.strokeStyle = sel ? '#ff6a3d' : '#3a3a42';
  if (sel) c.lineWidth = 1.5;
  c.stroke(); c.lineWidth = 1;

  const summary = w < 16;   // zoomed way out: a summary bar, no text or thumbs
  if (!summary) {
    // filmstrip thumbnails inside V-track clips (skipped below a sane px per thumb)
    if (vid && !isAudioSrc && !cl.freeze) drawThumbs(c, cl, x0, y, h, w);
    if (vid && cl.freeze) { c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(x0 + 1, y + 1, w - 2, h - 2); }
    // name + badges
    c.font = '600 11px Inter, sans-serif';
    const badges = [cl.speed != null ? `×${cl.speed}` : '', cl.freeze ? '❄' : '', cl.cam ? `cam:${cl.cam}` : '', cl.color ? '◐' : '',
      cl.audio?.gain_db ? `${cl.audio.gain_db}dB` : '', cl.xfade_ms ? `xfade ${cl.xfade_ms}ms` : '', cl.audio?.j_cut_ms ? `j${cl.audio.j_cut_ms}` : '', cl.note ? '⚑' : ''].filter(Boolean).join(' ');
    let label = `${cl.id} · ${cl.src}`;
    const lw = c.measureText(label).width;
    c.save(); c.beginPath(); c.rect(x0 + 2, y, w - 4, 16); c.clip();
    c.fillStyle = 'rgba(10,10,12,.72)'; c.beginPath(); c.roundRect(x0 + 2, y + 2, lw + 10, 13, 3); c.fill();
    c.fillStyle = '#ececef'; c.fillText(label, x0 + 7, y + 12);
    if (badges) { c.font = '10px Inter, sans-serif'; c.fillStyle = '#ff9d7d'; c.fillText(badges, x0 + 12 + lw, y + 12); }
    c.restore();
    // waveform strip along the bottom of every clip whose source has audio
    if (E.edit.sources[cl.src]?.has_audio || isAudioSrc) drawWave(c, cl, x0, y + h * 0.52, w, h * 0.46);
    // xfade join: a shaded diagonal at the boundary
    if (cl.xfade_ms) {
      const jw = Math.max(2, (cl.xfade_ms / 1000) * E.zoom);
      c.fillStyle = 'rgba(126,224,208,.25)'; c.fillRect(x0 - jw, y, jw, h);
    }
  }
  c.restore();

  // cut marks: a tick at each boundary, the length of the lane
  c.strokeStyle = '#3a3a42';
  c.beginPath(); c.moveTo(Math.round(x0) + .5, l.y); c.lineTo(Math.round(x0) + .5, l.y + l.h); c.stroke();
  c.beginPath(); c.moveTo(Math.round(x1) + .5, l.y); c.lineTo(Math.round(x1) + .5, l.y + l.h); c.stroke();

  // trim grips when hovered or dragged
  const hov = E.hover?.id === cl.id && E.hover?.edge;
  if ((hov || (E.drag?.kind === 'trim' && E.drag.id === cl.id)) && w > 10) {
    c.fillStyle = '#ff6a3d';
    const gw = E.drag?.kind === 'trim' && E.drag.id === cl.id ? 3 : 2;
    c.fillRect(x0 + 1, y + h * 0.25, gw, h * 0.5);
    c.fillRect(x1 - 1 - gw, y + h * 0.25, gw, h * 0.5);
  }
}

function drawThumbs(c, cl, x0, y, h, w) {
  const s = E.sources[cl.src], fs = s?.ingest?.conform?.filmstrip;
  if (!fs) return;
  const img = E.imgs[cl.src]?.img;
  if (!img) { fetchImg(cl.src); return; }
  if (!img.complete || !img.naturalWidth) return;
  const pxPerThumb = fs.step * E.zoom;
  if (pxPerThumb < 9) return;   // too far out: flat block instead (graceful degradation)
  const ar = fs.thumb_width / fs.thumb_height, dw = Math.min(w, h * ar), k = srcK(cl);
  c.save(); c.beginPath(); c.roundRect(x0 + 1, y + 1, w - 2, h - 2, 4); c.clip();
  for (let px = 0; px < w; px += dw) {
    const st = cl.in + ((px + dw / 2) / E.zoom) * k;
    const idx = clamp(Math.floor(st / fs.step), 0, fs.count - 1);
    c.drawImage(img, (idx % fs.cols) * fs.thumb_width, Math.floor(idx / fs.cols) * fs.thumb_height, fs.thumb_width, fs.thumb_height, x0 + px, y, dw, h);
  }
  c.restore();
}

function drawWave(c, cl, x0, y, w, h) {
  if (cl.freeze) return;
  const p = fetchPeaks(cl.src);
  if (!p) return;
  const k = srcK(cl), mid = y + h / 2, amp = h / 2 - 1;
  c.fillStyle = 'rgba(126,224,208,.6)';
  const from = Math.max(0, Math.ceil(x0)), to = Math.min(x0 + w, big.clientWidth);
  for (let px = from; px < to; px++) {
    const st = cl.in + ((px - X(cl.at)) / E.zoom) * k;
    const b = Math.floor(st * p.rate) * 2;
    const lo = p.data[b], hi = p.data[b + 1];
    if (lo === undefined) continue;
    const y1 = mid - (hi / p.scale) * amp, y2 = mid - (lo / p.scale) * amp;
    c.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }
}

function drawOverlaysStrip(c, W) {
  const y = big.clientHeight - 16;
  c.fillStyle = '#101014'; c.fillRect(GUT, y, W - GUT, 14);
  c.font = '9px Inter, sans-serif';
  for (const o of E.edit.overlays || []) {
    const x0 = Math.max(GUT, X(o.at)), x1 = Math.min(W, X(o.at + o.dur));
    if (x1 <= x0) continue;
    c.fillStyle = 'rgba(199,125,255,.28)'; c.beginPath(); c.roundRect(x0 + .5, y + 2.5, x1 - x0 - 1, 9, 3); c.fill();
    c.fillStyle = '#c77dff'; c.fillText(`${o.type}${o.props?.text ? `: ${String(o.props.text).slice(0, 20)}` : ''}`, x0 + 4, y + 11);
  }
}

function drawDragPreview(c, W, H) {
  const d = E.drag;
  if (!d) return;
  const g = G();
  if (d.kind === 'trim' && d.p) {
    const l = lanes().find((x) => x.track.id === d.trackId);
    if (!l) return;
    const cl = findClip(d.id);
    const lenF = d.p.outF - d.p.inF, at = d.p.at ?? cl.at;
    const x0 = X(at), x1 = X(g.S(g.F(at) + lenF));
    c.save(); c.globalAlpha = .9;
    c.strokeStyle = '#ff6a3d'; c.setLineDash([4, 3]); c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(x0 + .5, l.y + 2.5, Math.max(2, x1 - x0 - 1), l.h - 5, 5); c.stroke();
    c.setLineDash([]);
    const label = `${d.p.in}s → ${d.p.out}s${d.ripple ? ' (ripple)' : ' (gap)'}`;
    c.font = '10px ui-monospace, monospace'; c.fillStyle = '#ff6a3d';
    c.fillText(label, clamp(x0, GUT + 2, W - 150), l.y - 3);
    c.restore();
  }
  if (d.kind === 'move' && d.p) {
    const l = lanes().find((x) => x.track.id === d.p.trackId);
    if (!l) return;
    const cl = findClip(d.id);
    const x0 = X(d.p.at), x1 = X(g.S(g.F(d.p.at) + clipFrames(E.edit, cl)));
    c.save(); c.globalAlpha = .75;
    c.fillStyle = d.ok ? 'rgba(255,106,61,.22)' : 'rgba(255,77,94,.25)';
    c.beginPath(); c.roundRect(x0 + .5, l.y + 2.5, Math.max(2, x1 - x0 - 1), l.h - 5, 5); c.fill();
    c.strokeStyle = d.ok ? '#ff6a3d' : '#ff4d5e'; c.lineWidth = 1.5; c.stroke();
    c.font = '600 10px Inter, sans-serif'; c.fillStyle = d.ok ? '#ff9d7d' : '#ff4d5e';
    c.fillText(`${d.ok ? '' : 'overlap — '}@${d.p.at}s`, clamp(x0, GUT + 2, W - 120), l.y - 3);
    c.restore();
  }
}

function drawDropGhost(c, H) {
  const x = E.dropX;
  c.save();
  c.strokeStyle = '#3ecf8e'; c.setLineDash([5, 4]); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x + .5, RULER); c.lineTo(x + .5, H); c.stroke();
  if (E.binDrag && E.sources[E.binDrag]) {
    const s = E.sources[E.binDrag], t = snapT(T(x)), w = (s.duration || 1) * E.zoom;
    const l = E.dropLane || lanes()[0];
    if (l) {
      c.fillStyle = 'rgba(62,207,142,.15)'; c.beginPath(); c.roundRect(X(t) + .5, l.y + 2.5, Math.max(2, w - 1), l.h - 5, 5); c.fill();
      c.strokeStyle = '#3ecf8e'; c.setLineDash([]); c.stroke();
      c.font = '600 10px Inter, sans-serif'; c.fillStyle = '#3ecf8e';
      c.fillText(`${E.binDrag} → ${l.track.id} @ ${t.toFixed(2)}s`, X(t) + 4, l.y + 14);
    }
  }
  c.restore();
}

// ── the minimap (the transport bar's small canvas, app.js delegates here) ─────────────────────────
// Every path that changes time ends in refresh(): BOTH canvases + the dock timecode move together,
// whether the change came from here (playback, drags) or from app.js (word click, arrows, SSE reload).
function refresh() { draw(); drawMini(ctx.S); }
function drawMini(S) {
  const t = el('#timeline'); if (!t) return;
  const dpr = devicePixelRatio || 1, W = t.clientWidth, H = 64;
  if (t.width !== W * dpr) { t.width = W * dpr; t.height = H * dpr; }
  const c = t.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#131316'; c.fillRect(0, 0, W, H);
  if (!E.edit) { c.fillStyle = '#8b8b94'; c.font = '11px Inter, sans-serif'; c.fillText('loading edit…', 8, 36); return; }
  const d = dur(), k = W / Math.max(d, 0.001), g = G();
  const rows = lanes();
  rows.forEach((l, i) => {
    const y = 8 + i * 24, h = 18;
    c.fillStyle = l.track.kind === 'video' ? '#101014' : '#0d1412'; c.fillRect(0, y, W, h);
    for (const cl of l.track.clips) {
      const x0 = cl.at * k, x1 = endS(cl) * k;
      c.fillStyle = l.track.kind === 'video' ? '#2b2b33' : '#1d3a30';
      c.fillRect(x0, y + 2, Math.max(1, x1 - x0), h - 4);
    }
    c.fillStyle = '#5c5c66'; c.font = '9px Inter, sans-serif'; c.fillText(l.track.id, 3, y + h / 2 + 3);
  });
  for (const m of E.edit.markers || []) { c.fillStyle = '#f5b841'; c.fillRect(m.t * k - 1, 2, 2, 6); }
  // viewport rectangle
  const vx = (E.scroll / d) * W, vw = Math.max(6, (visT() / d) * W);
  c.strokeStyle = '#ff6a3d'; c.lineWidth = 1.5;
  c.strokeRect(clamp(vx, 0, W - 4) + .5, 1, Math.min(vw, W - clamp(vx, 0, W - 4) - 1), H - 2);
  c.lineWidth = 1;
  // playhead
  c.fillStyle = '#fff'; c.fillRect(S.t * k - 1, 0, 2, H);
}
// app.js calls this on every seek (its own transport, notes, reviews…): the minimap AND the big canvas.
export function drawTimeline(S) { drawMini(S); draw(); }

export function miniDown(e) {
  const t = el('#timeline'), r = t.getBoundingClientRect(), S = ctx.S;
  if (!E.edit || !t) return;   // still loading (or a film switch raced): nothing sane to scrub yet
  const x = e.clientX - r.left, d = dur(), k = r.width / Math.max(d, 0.001);
  const vx = (E.scroll / d) * r.width, vw = Math.max(6, (visT() / d) * r.width);
  const mode = x >= vx && x <= vx + vw ? 'pan' : 'scrub';
  const sx = x, s0 = E.scroll;
  let moved = false;
  try { t.setPointerCapture(e.pointerId); } catch { /* synthetic/edge: proceed without capture */ }
  const move = (ev) => {
    const ex = ev.clientX - r.left;
    moved = true;
    if (mode === 'pan') { E.scroll = clamp(s0 - ((ex - sx) / r.width) * d, 0, Math.max(0, d - visT())); draw(); }
    else { ctx.pause(); const tt = clamp((ex / r.width) * d, 0, d); ctx.seek(tt); E.scroll = clamp(tt - visT() / 2, 0, Math.max(0, d - visT())); draw(); }
  };
  const up = (ev) => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (mode === 'pan' && !moved) {   // a plain click inside the viewport still seeks
      ctx.pause(); ctx.seek(clamp((x / r.width) * d, 0, d)); draw();
    }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
  if (mode === 'scrub') { ctx.pause(); ctx.seek(clamp((x / r.width) * d, 0, d)); E.scroll = clamp(((x / r.width) * d) - visT() / 2, 0, Math.max(0, d - visT())); draw(); }
}

// ── pointer interactions on the big canvas ───────────────────────────────────────────────────
const pos = (e) => { const r = big.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

function hit(x, y) {
  if (!E.edit) return { zone: 'void' };
  if (y <= RULER) {
    for (const m of E.edit.markers || []) if (Math.abs(X(m.t) - x) < 7) return { zone: 'marker', marker: m };
    return { zone: 'ruler' };
  }
  if (x < GUT) return { zone: 'gutter' };
  const l = laneAt(y);
  if (l) {
    const g = G();
    for (const cl of l.track.clips) {
      const x0 = X(cl.at), x1 = X(endS(cl));
      if (x >= x0 - 4 && x <= x1 + 4) {
        const edge = x <= x0 + 6 ? 'l' : x >= x1 - 6 ? 'r' : null;
        return { zone: 'clip', track: l.track, lane: l, clip: cl, edge };
      }
    }
    return { zone: 'lane', track: l.track, lane: l };
  }
  return { zone: 'void' };
}

function onDown(e) {
  if (!E.edit || e.button !== 0) return;
  const p = pos(e), h = hit(p.x, p.y), g = G(), S = ctx.S;
  try { big.setPointerCapture(e.pointerId); } catch { /* a capture-less drag still works */ }
  if (h.zone === 'marker') {
    if (e.shiftKey) return mutate([{ op: 'marker', action: 'remove', id: h.marker.id }]);   // shift-click a marker to remove it
    ctx.pause(); ctx.seek(h.marker.t); return;
  }
  if (h.zone === 'ruler' || h.zone === 'gutter' || h.zone === 'void' || h.zone === 'lane') {
    if (h.zone === 'lane') { E.sel = null; refreshInspector(); }
    E.drag = { kind: 'scrub' };
    ctx.pause(); ctx.seek(snapT(T(p.x), 'frames'));
    return;
  }
  if (h.zone === 'clip') {
    E.sel = h.clip.id; refreshInspector(); draw();
    if (h.edge) {
      const src = E.edit.sources[h.clip.src];
      E.drag = { kind: 'trim', id: h.clip.id, trackId: h.track.id, edge: h.edge, ripple: !e.altKey,
        t0: T(p.x), in0: h.clip.in, out0: h.clip.out, at0: h.clip.at,
        in0F: g.F(h.clip.in), out0F: g.F(h.clip.out), at0F: g.F(h.clip.at), end0F: g.F(h.clip.at) + clipFrames(E.edit, h.clip),
        len0F: clipFrames(E.edit, h.clip), srcFrames: src.frames, p: null, lenDeltaF: 0 };
    } else {
      E.drag = { kind: 'move', id: h.clip.id, fromTrack: h.track.id, grabDt: T(p.x) - h.clip.at,
        p: { at: h.clip.at, trackId: h.track.id, ok: true }, ok: true };
    }
  }
}

function onMove(e) {
  if (!E.edit) return;
  const p = pos(e);
  if (!E.drag) {   // hover: cursor + grips
    const h = hit(p.x, p.y);
    const cur = h.zone === 'clip' ? (h.edge ? 'ew-resize' : 'grab') : h.zone === 'ruler' || h.zone === 'lane' ? 'default' : 'default';
    const sig = JSON.stringify([h.zone, h.clip?.id, h.edge]);
    if (sig !== E.hoverSig) { E.hoverSig = sig; E.hover = h; big.style.cursor = cur; draw(); }
    return;
  }
  const d = E.drag, g = G(), S = ctx.S;
  if (d.kind === 'scrub') { ctx.seek(snapT(T(p.x), 'frames')); return; }
  if (d.kind === 'trim') {
    const cl = findClip(d.id); if (!cl) return;
    const k = srcK(cl), delta = T(p.x) - d.t0;
    if (d.edge === 'r') {
      const endT = snapT(g.S(d.at0F + d.len0F) + delta);       // snap the clip's new END
      const outF = clamp(g.F(d.in0 + (endT - d.at0) * k), d.in0F + 1, d.srcFrames);
      d.p = { in: d.in0, out: g.S(outF), inF: d.in0F, outF };
    } else {
      if (d.ripple) d.p = { in: g.S(clamp(g.F(d.in0 + delta * k), 0, d.out0F - 1)), out: d.out0, at: d.at0, inF: clamp(g.F(d.in0 + delta * k), 0, d.out0F - 1), outF: d.out0F };
      else {
        const atT = snapT(d.at0 + delta);                       // non-ripple: the head moves, snap its new position
        const inF = clamp(g.F(d.in0 + (atT - d.at0) * k), 0, d.out0F - 1);
        const atF = clamp(d.at0F + Math.round((inF - d.in0F) / k), 0, 1e9);
        d.p = { in: g.S(inF), out: d.out0, inF, outF: d.out0F, at: g.S(atF) };
      }
    }
    d.lenDeltaF = (d.p.outF - d.p.inF) - d.len0F;
    draw();
  }
  if (d.kind === 'move') {
    const cl = findClip(d.id); if (!cl) return;
    const l = laneAt(p.y);
    let trackId = d.p.trackId;
    if (l && l.track.id !== trackId) {
      const audioSrc = E.edit.sources[cl.src]?.kind === 'audio';
      if (!(audioSrc && l.track.kind === 'video')) trackId = l.track.id;   // audio-only stays on audio tracks
    }
    const at = Math.max(0, snapT(T(p.x) - d.grabDt));
    const track = E.edit.tracks.find((t) => t.id === trackId);
    d.p = { at, trackId, ok: !overlaps(track, cl, at) };
    draw();
  }
}

function onUp(e) {
  const d = E.drag; E.drag = null;
  if (!d || !E.edit) return draw();
  const g = G();
  if (d.kind === 'trim' && d.p && (d.p.in !== d.in0 || d.p.out !== d.out0)) {
    mutate([{ op: 'trim', id: d.id, in: d.p.in, out: d.p.out, ripple: d.ripple }]);
  } else if (d.kind === 'move' && d.p) {
    const cl = findClip(d.id);
    if (cl && d.p.ok && (d.p.at !== cl.at || d.p.trackId !== d.fromTrack)) {
      const op = { op: 'move', id: d.id, at: d.p.at };
      if (d.p.trackId !== d.fromTrack) op.track = d.p.trackId;
      mutate([op]);
    } else if (cl && !d.p.ok) msg('move would overlap another clip — dropped');
  }
  draw();
}

function onDbl(e) {
  if (!E.edit) return;
  const p = pos(e), h = hit(p.x, p.y);
  if (h.zone === 'clip') { E.sel = h.clip.id; refreshInspector(); ctx.pause(); ctx.seek(h.clip.at); draw(); }
}

function onDrop(e) {
  e.preventDefault();
  const p = pos(e), src = e.dataTransfer.getData('text/studio-src') || E.binDrag;
  E.dropX = null; E.dropLane = null; E.binDrag = null;
  if (!E.edit || !src || !E.sources[src]) return draw();
  const s = E.sources[src];
  const l = laneAt(p.y);
  let track = l?.track.id || 'V1';
  if (s.kind === 'audio' && E.edit.tracks.find((t) => t.id === track)?.kind === 'video') {
    track = (E.edit.tracks.find((t) => t.kind === 'audio') || {}).id || track;
    msg(`"${src}" is audio-only — dropped on ${track} instead`);
  }
  const at = snapT(T(p.x));
  const tr = E.edit.tracks.find((t) => t.id === track);
  const clashes = tr.clips.some((c) => at < endS(c) && at + (s.duration || 0) > c.at);
  const op = { op: 'add', src, at, track };
  if (clashes) op.ripple = true;   // dropped onto existing material: insert, pushing the rest later
  mutate([op]).then((r) => { if (r) { E.sel = null; msg(`added ${src} at ${at.toFixed(2)}s${clashes ? ' (insert)' : ''}`, true); } });
  draw();
}

function zoomAt(px, f) {
  if (!E.edit) return;
  const t = T(px);
  E.zoom = clamp(E.zoom * f, 0.02, 700);
  E.scroll = t - (px - GUT) / E.zoom;
  clampScroll(); draw();
}
function fit() { if (!E.edit || !big) return; E.zoom = clamp((big.clientWidth - GUT) / dur(), 0.02, 700); E.scroll = 0; draw(); }

function fetchPeaks(src) {
  const st = E.peaks[src];
  if (st !== undefined) return st && st.data ? st : null;   // loaded, or tried and there is none
  E.peaks[src] = null;                                       // mark in flight
  fetch(`/api/peaks?film=${E.key}&src=${src}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    // an empty peaks document (a 200: audio-less source, or a stale bin entry) is simply "no waveform"
    .then((p) => { E.peaks[src] = p && Array.isArray(p.data) && p.data.length ? { rate: p.rate || 100, scale: p.scale || 127, data: p.data } : null; draw(); });
  return null;
}
function fetchImg(src) {
  const st = E.imgs[src];
  if (st !== undefined) return;
  E.imgs[src] = {};
  if (!E.sources[src]?.has_filmstrip) { E.imgs[src] = { none: true }; return; }
  const img = new Image();
  img.onload = () => { E.imgs[src] = { img }; draw(); };
  img.onerror = () => { E.imgs[src] = { none: true }; };
  img.src = `/films/${E.key}/assets/media/${src}/filmstrip.jpg`;
}

// ── the right-panel Edit tab ──────────────────────────────────────────────────────────────────
export function renderTab(S, root) {
  if (!E.key || E.key !== S.key || !E.edit) { root.innerHTML = `<p class="dim">loading films/${S.key}'s edit…</p>`; return; }
  if (root.querySelector('#ebRoot') && root.__editRoot === E.key) return refreshPanel();
  root.__editRoot = E.key;
  root.innerHTML = `<div id="ebRoot">
    <div id="ebState" class="dim"></div>
    <h3>Media bin</h3><div id="ebBin"></div>
    <h3>Inspector</h3><div id="ebInsp"></div>
    <h3>Cut proposals</h3><div id="ebCuts"></div>
    <h3>Transcript</h3><div id="ebTr"></div>
  </div>`;
  refreshPanel();
}

function refreshPanel() {
  if (!el('#ebRoot') || el('#tabBody').__editRoot !== E.key) return;
  renderBin(); renderInspector(); renderCuts(); renderTr();
}

// ── media bin ────────────────────────────────────────────────────────────────────────────────
function renderBin() {
  const host = el('#ebBin'); if (!host) return;
  const sig = JSON.stringify(Object.entries(E.sources).map(([id, s]) => [id, s.kind, s.duration, s.original_here, s.has_transcript, s.ingest?.products?.length]));
  if (host.__sig === sig) return;
  host.__sig = sig;
  const entries = Object.entries(E.sources);
  host.innerHTML = entries.map(([id, s]) => {
    const pr = s.ingest?.products || [];
    const chip = (label, on) => `<span class="chip ${on ? 'on' : ''}">${label}</span>`;
    const durS = s.duration != null ? `${s.duration.toFixed(1)}s` : '—';
    return `<div class="srcCard ${s.original_here ? '' : 'gone'}" data-src="${id}">
      <div class="srcThumb" draggable="true" title="drag onto a track · double-click appends to V1">${s.kind === 'audio' ? '♪' : '⋯'}</div>
      <div>
        <div class="id">${id} <span class="dim">${s.kind}</span></div>
        <div class="meta">${durS} · ${s.fps ?? '—'} fps · ${s.frames ?? '—'} frames${s.original_here ? '' : ' · <span style="color:var(--bad)">original moved — studio relink</span>'}</div>
        <div class="meta">ingest: ${s.ingest ? `recipe ${s.ingest.recipe} · ${pr.length} products${s.ingest.conform ? ` · conformed ${s.ingest.conform.width}×${s.ingest.conform.height}` : ''}` : 'no media.json — run studio ingest'}</div>
        <div class="chips">${chip('conform', pr.includes('conformed.mp4'))}${chip('proxy', pr.includes('proxy.mp4'))}${chip('filmstrip', pr.includes('filmstrip.jpg'))}${chip('peaks', pr.includes('peaks.json'))}${chip('silence', pr.includes('silence.json'))}${chip('transcript', s.has_transcript)}</div>
        ${s.has_audio && !s.has_transcript ? `<button class="binTrans" data-src="${id}" title="local ASR (faster-whisper), cached by media hash">transcribe</button>` : ''}
      </div>
    </div>`;
  }).join('') || `<p class="dim">no media yet — <code>studio ingest ${E.key} &lt;file&gt; --id cam</code></p>`;
  host.querySelectorAll('.srcThumb').forEach((n) => {
    const card = n.closest('.srcCard'), id = card.dataset.src, s = E.sources[id];
    n.addEventListener('dragstart', (e) => { E.binDrag = id; e.dataTransfer.setData('text/studio-src', id); e.dataTransfer.effectAllowed = 'copy'; });
    n.addEventListener('dblclick', async () => {   // append at the end of V1
      const t = E.edit.tracks.find((x) => x.id === 'V1');
      const end = t ? Math.max(0, ...t.clips.map((c) => endS(c)), 0) : 0;
      const r = await mutate([{ op: 'add', src: id, at: frameSnap(end) }]);
      if (r) msg(`appended ${id} at ${end.toFixed(2)}s`, true);
    });
    if (s?.has_filmstrip && s?.kind !== 'audio') {
      const cv = document.createElement('canvas'); cv.width = 152; cv.height = 92; n.innerHTML = ''; n.appendChild(cv);
      fetchImg(id);
      const paint = () => {
        const st = E.imgs[id];
        if (!st || (!st.img && !st.none)) return setTimeout(paint, 120);   // still loading
        if (!st.img || !st.img.complete || !st.img.naturalWidth) return;   // none or broken: keep the ♪/⋯ placeholder card
        const fs = s.ingest?.conform?.filmstrip; if (!fs) return;
        const idx = clamp(Math.floor((s.duration || 0) / 2 / fs.step), 0, fs.count - 1);
        const cc = cv.getContext('2d');
        cc.drawImage(st.img, (idx % fs.cols) * fs.thumb_width, Math.floor(idx / fs.cols) * fs.thumb_height, fs.thumb_width, fs.thumb_height, 0, 0, cv.width, cv.height);
      };
      paint();
    }
  });
  host.querySelectorAll('.binTrans').forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = 'transcribing…';
    try {
      const r = await ctx.post(`/api/edit-transcribe?film=${E.key}`, { src: b.dataset.src });
      msg(`transcribed ${r.words} words (${r.language}${r.cached ? ', cached' : ''})`, true);
      await load(); await loadTranscript(E.trSrc || b.dataset.src);
    } catch (e) { fail(e); b.disabled = false; b.textContent = 'transcribe'; }
  }));
}

// ── inspector ─────────────────────────────────────────────────────────────────────────────────
const COLOR_DEFAULTS = { exposure: 0, contrast: 1, saturation: 1, temperature: 0 };
function renderInspector() {
  const host = el('#ebInsp'); if (!host) return;
  if (host.__rev === E.rev && host.__sel === E.sel) return;
  if (host.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;   // typing: don't clobber
  host.__rev = E.rev; host.__sel = E.sel;
  const c = E.sel && E.edit ? findClip(E.sel) : null;
  if (!c) { host.innerHTML = '<p class="dim">Select a clip on the timeline. Trim its edges, drag it, S splits at the playhead, Del ripple-deletes.</p>'; return; }
  const col = { ...COLOR_DEFAULTS, ...(c.color || {}) };
  // The clip note: edit-ops has no op that changes it after `add` (engine gap, reported) — this build's
  // op list comes from the server, so the field flips to editable the moment a `note` op lands there.
  const noteOp = (E.opNames || []).includes('note');
  const num = (k, v, attrs = '') => `<input data-k="${k}" type="number" step="any" ${attrs} value="${v}">`;
  host.innerHTML = `
    <div class="insp">
      <label>clip</label><span class="ro">${c.id} · ${c.src} (${E.edit.sources[c.src]?.kind ?? '?'}) · in ${c.in}s → out ${c.out}s @ ${c.at}s · ${endS(c) - c.at}s${c.freeze ? ' · FREEZE' : ''}</span>
      <label>speed</label>${num('speed', c.speed ?? 1, 'min="0.1" max="16" step="0.05"')}
      <label>volume dB</label>${num('db', c.audio?.gain_db ?? 0, 'min="-60" max="24" step="0.5"')}
      <label>fade in/out ms</label><span>${num('fin', c.audio?.fade_ms?.[0] ?? 8, 'min="0" max="10000" step="10"')}${num('fout', c.audio?.fade_ms?.[1] ?? 8, 'min="0" max="10000" step="10"')}</span>
      <label>j-cut ms</label>${num('jcut', c.audio?.j_cut_ms ?? 0, 'min="-2000" max="2000" step="10" title="0 = none"')}
      <label>cam</label><select data-k="cam">${['center', 'follow', 'blurfill', 'keyframes'].map((m) => `<option ${((c.cam ?? 'center') === m) ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label>exposure</label>${num('exposure', col.exposure, 'min="-2" max="2" step="0.05"')}
      <label>contrast</label>${num('contrast', col.contrast, 'min="0.5" max="2" step="0.05"')}
      <label>saturation</label>${num('saturation', col.saturation, 'min="0" max="2" step="0.05"')}
      <label>temperature</label>${num('temperature', col.temperature, 'min="-1" max="1" step="0.05"')}
      <label>note</label><input data-k="note" value="${ctx.esc(c.note ?? '')}" ${noteOp
        ? 'placeholder="why this clip is here"'
        : `readonly title="read-only in this build: no op changes a clip note after add (engine gap, reported) — editable automatically once edit-ops ships a note op"`}>
    </div>
    <div class="inspBtns">
      <button class="primary" id="inspSave">Save (one ops batch)</button>
      <button id="inspDel" title="ripple-delete: close the gap">⇤ ripple-delete</button>
      <button id="inspGap" title="delete: leave a gap">delete (gap)</button>
    </div>`;
  el('#inspSave').onclick = async () => {
    const v = (k) => parseFloat(host.querySelector(`[data-k="${k}"]`).value);
    const ops = [];
    if (v('speed') !== (c.speed ?? 1)) ops.push({ op: 'speed', id: c.id, speed: v('speed'), ripple: false });
    if (v('db') !== (c.audio?.gain_db ?? 0)) ops.push({ op: 'volume', id: c.id, db: v('db') });
    if (v('fin') !== (c.audio?.fade_ms?.[0] ?? 8) || v('fout') !== (c.audio?.fade_ms?.[1] ?? 8)) ops.push({ op: 'fade', id: c.id, in_ms: v('fin'), out_ms: v('fout') });
    if (v('jcut') !== (c.audio?.j_cut_ms ?? 0)) ops.push({ op: 'jcut', id: c.id, ms: v('jcut') === 0 ? -1 : v('jcut') });
    const cam = host.querySelector('[data-k="cam"]').value;
    if (cam !== (c.cam ?? 'center')) ops.push({ op: 'cam', id: c.id, mode: cam });
    const color = {};
    let cdirty = false;
    for (const k of Object.keys(COLOR_DEFAULTS)) if (v(k) !== col[k]) { color[k] = v(k); cdirty = true; }
    if (cdirty) ops.push({ op: 'color', id: c.id, ...color });
    if (noteOp) {   // rides the same batch the moment the engine has the op (assumed shape: { op:'note', id, note })
      const note = host.querySelector('[data-k="note"]').value;
      if (note !== (c.note ?? '')) ops.push({ op: 'note', id: c.id, note });
    }
    if (!ops.length) return msg('nothing changed');
    el('#inspSave').blur();
    const r = await mutate(ops);
    if (r) msg(`saved ${ops.length} op${ops.length > 1 ? 's' : ''} → rev ${r.rev}`, true);
  };
  el('#inspDel').onclick = () => mutate([{ op: 'ripple-delete', id: c.id }]);
  el('#inspGap').onclick = () => mutate([{ op: 'delete', id: c.id }]);
}

// ── cut proposals ────────────────────────────────────────────────────────────────────────────
const CUT_KINDS = [['silence', 'Silence', 'pauses longer than 0.5 s (measured from the silence map, breath kept)'], ['fillers', 'Fillers', 'um/uh verified against a measured gap'], ['takes', 'Takes', 'abandoned or duplicate takes, keep the complete one'], ['tighten', 'Tighten', 'trim the longest pauses toward a target'], ['idle', 'Idle', 'frozen stretches (freezedetect scan — slow)']];
function renderCuts() {
  const host = el('#ebCuts'); if (!host) return;
  const sig = JSON.stringify([E.cuts?.v, E.rev]);
  if (host.__sig === sig) return;
  host.__sig = sig;
  const head = `<div class="cutKinds">${CUT_KINDS.map(([k, l, t]) => `<button data-kind="${k}" title="${t}" ${E.cuts?.state === 'running' && E.cuts?.kind === k ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  if (!E.cuts) { host.innerHTML = head + '<p class="dim">Measured cuts, dry-run: every row shows what would go and why; accept applies just that one as a ripple-delete.</p>'; }
  else if (E.cuts.state === 'running') { host.innerHTML = head + '<p class="dim">measuring…</p>'; }
  else {
    const ps = E.cuts.proposals || [];
    host.innerHTML = head + (ps.length ? ps.map((p, i) => {
      const { reason, removedText, confidence, frames, span, skipped, at, ...op } = p;
      if (p.__applied) return `<div class="cutRow done"><span class="t">✓ ${p.from ?? ''}s</span><div class="why"><span class="txt dim">applied — ${ctx.esc(reason)}</span></div><span class="dim">done</span></div>`;
      if (p.__rejected) return `<div class="cutRow done"><span class="t">✕ ${p.from ?? ''}s</span><div class="why"><span class="txt dim">rejected — ${ctx.esc(reason)}</span></div><span class="dim">kept</span></div>`;
      if (p.skipped) return `<div class="cutRow skip" title="${ctx.esc(p.reason || '')}"><span class="t">SKIP</span><div class="why"><span class="txt">${ctx.esc(p.reason || '')}</span></div><span class="dim">—</span></div>`;
      const durTxt = p.to != null && p.from != null ? `${p.from}s → ${p.to}s (${(p.to - p.from).toFixed(2)}s · ${frames ?? '?'}f)` : `${p.at?.toFixed?.(2) ?? ''}s`;
      return `<div class="cutRow" data-i="${i}">
        <span class="t">${durTxt}</span>
        <div class="why"><span class="txt">${ctx.esc(reason)}</span>${removedText ? `<span class="dim">removed: “${ctx.esc(String(removedText).slice(0, 140))}”</span>` : ''}</div>
        <span class="btns"><button class="acc" title="apply this one as a ripple-delete">✂ accept</button><button class="rej">✕</button></span>
      </div>`;
    }).join('') : `<p class="dim">no ${E.cuts.kind} cuts found (nothing safe to remove).</p>`) +
      `<p class="dim">${E.cuts.actionable ?? 0} actionable${E.cuts.framesRemoved ? ` · ${(E.cuts.framesRemoved / 30).toFixed(2)}s of frames` : ''}</p>`;
    host.querySelectorAll('.cutRow[data-i] .acc').forEach((b) => (b.onclick = () => acceptCut(+b.closest('.cutRow').dataset.i)));
    host.querySelectorAll('.cutRow[data-i] .rej').forEach((b) => (b.onclick = () => { const p = E.cuts.proposals[+b.closest('.cutRow').dataset.i]; p.__rejected = true; renderCuts(); }));
  }
  host.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => runCuts(b.dataset.kind)));
}

async function runCuts(kind) {
  E.cuts = { kind, v: (E.cuts?.v || 0) + 1, state: 'running', proposals: [] };
  renderCuts();
  try {
    const r = await ctx.post(`/api/edit-cuts?film=${E.key}`, { kind, src: E.trSrc || undefined });
    E.cuts = { ...r, kind, v: E.cuts.v, state: 'done' };
    msg(`${kind}: ${r.actionable ?? 0} proposals`, true);
  } catch (e) { E.cuts = { kind, v: E.cuts.v, state: 'done', proposals: [], error: String(e.message || e) }; fail(e); }
  renderCuts();
}
async function acceptCut(i) {
  const p = E.cuts?.proposals?.[i]; if (!p || p.skipped) return;
  const { reason, removedText, confidence, frames, span, skipped, at, ...op } = p;
  const r = await mutate([op]);
  if (r) { p.__applied = true; E.cuts.v++; renderCuts(); if (E.cuts.kind !== 'idle') runCuts(E.cuts.kind); }  // coordinates shifted: re-measure
}

// ── transcript pane ───────────────────────────────────────────────────────────────────────────
function trCandidates() {
  const ids = Object.entries(E.sources).filter(([, s]) => s.has_audio || s.has_transcript).map(([id]) => id);
  return ids.length ? ids : Object.keys(E.sources);
}
async function loadTranscript(src) {
  E.trSrc = src || E.trSrc || trCandidates()[0];
  E.tr = null; E.trSel = null; E.trSig = '';
  renderTr();
  if (!E.trSrc) return;
  const r = await fetch(`/api/transcript?film=${E.key}&src=${E.trSrc}`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (E.key !== ctx.S.key) return;
  // A missing transcript is a 200 empty state from the server ({ words: [], transcribed: false }), never a 404:
  // the pane shows the transcribe affordance instead of an error. A real transcript has words and no flag.
  const present = !!(r && !r.error && r.transcribed !== false && Array.isArray(r.words));
  E.tr = present ? { src: E.trSrc, language: r.language, words: r.words, mapped: [] }
    : { src: E.trSrc, missing: true, empty: !!(r && !r.error), error: r?.error || null };
  retimeTranscript();
}
function retimeTranscript() {   // source word times -> timeline times, through the SAME retimer the captions use
  if (!E.tr) return;
  if (E.tr.missing) { renderTr(); return; }
  E.tr.mapped = retimeWords(E.edit, E.tr.src, E.tr.words);
  E.trSel = null;
  renderTr();
}
function renderTr() {
  const host = el('#ebTr'); if (!host) return;
  const sig = JSON.stringify([E.trSrc, E.tr?.missing, E.tr?.mapped?.length, E.rev, E.trSel?.a, E.trSel?.b]);
  if (host.__sig === sig) return;
  host.__sig = sig;
  const cands = trCandidates();
  const tr = E.tr;
  if (!tr) { host.innerHTML = '<p class="dim">loading transcript…</p>'; return; }
  if (tr.missing) {
    // the empty state is an affordance, not an error: nothing to read yet, so offer to make it
    const why = tr.empty ? 'no transcript yet — transcribe it (local ASR, cached by media hash) to cut by words and flag fillers' : (tr.error || 'no transcript');
    host.innerHTML = `<div class="trHead"><select id="trSrc">${cands.map((id) => `<option ${id === tr.src ? 'selected' : ''}>${id}</option>`).join('')}</select><span class="dim">${ctx.esc(tr.src)}</span></div>
      <div class="trEmpty"><p class="dim">${ctx.esc(why)}</p><button id="trDo" class="primary">✎ transcribe ${ctx.esc(tr.src)}</button></div>`;
    host.querySelector('#trSrc').onchange = (e) => loadTranscript(e.target.value);
    host.querySelector('#trDo').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'transcribing…';
      try { const r = await ctx.post(`/api/edit-transcribe?film=${E.key}`, { src: tr.src }); msg(`transcribed ${r.words} words (${r.language})`, true); await load(); await loadTranscript(tr.src); }
      catch (err) { fail(err); e.target.disabled = false; e.target.textContent = '✎ transcribe ' + tr.src; }
    };
    return;
  }
  const words = tr.mapped;
  const fillers = new Set((FILLERS[tr.language] || FILLERS.en).map(norm));
  let hits = 0;
  let re = null;
  if (E.trSearch) { try { re = new RegExp(E.trSearch, 'i'); } catch { re = null; } }
  const spans = words.map((w, i) => {
    const isFill = fillers.has(norm(w.text));
    const hit = re ? re.test(w.text) : true;
    if (re && hit) hits++;
    const sel = E.trSel && i >= Math.min(E.trSel.a, E.trSel.b) && i <= Math.max(E.trSel.a, E.trSel.b);
    const title = `timeline ${w.start.toFixed(2)}–${w.end.toFixed(2)}s${w.__clip ? ` · clip ${w.__clip}` : ''} · conf ${(w.confidence ?? 1).toFixed(2)}${isFill ? ' · filler' : ''}${w.partial ? ' · partially cut at a clip edge' : ''}`;
    return `<span class="w${isFill ? ' fill' : ''}${w.partial ? ' part' : ''}${re && !hit ? ' dim2' : ''}${re && hit ? ' hit' : ''}${sel ? ' sel' : ''}" data-i="${i}" title="${ctx.esc(title)}">${ctx.esc(w.text)}</span> `;
  }).join('');
  const selN = E.trSel ? Math.abs(E.trSel.b - E.trSel.a) + 1 : 0;
  const selS = E.trSel ? (() => { const ws = words.slice(Math.min(E.trSel.a, E.trSel.b), Math.max(E.trSel.a, E.trSel.b) + 1); return ws.length ? (ws.at(-1).end - ws[0].start) : 0; })() : 0;
  host.innerHTML = `
    <div class="trHead">
      <select id="trSrc" title="which source's words">${cands.map((id) => `<option ${id === tr.src ? 'selected' : ''}>${id}</option>`).join('')}</select>
      <input id="trSearch" placeholder="--grep regex" value="${ctx.esc(E.trSearch)}" spellcheck="false">
      <span class="dim" id="trCount">${tr.language} · ${tr.words.length} words · ${words.length} on the timeline${E.trSearch ? ` · ${hits} hits` : ''}</span>
    </div>
    ${selN ? `<div class="trBar"><b>${selN} words · ${selS.toFixed(2)}s</b><button class="primary" id="trCut">✂ ripple-delete (Del)</button><button id="trClr">esc</button></div>` : ''}
    <div class="trWords" id="trWords">${spans || '<span class="dim">no words from this source are on the timeline (all cut away?)</span>'}</div>
    <p class="dim" style="font-size:11px">click a word = seek · shift-click = select a range (strike-through preview) · Delete = ripple-cut · orange = filler (${tr.language})</p>`;
  const wordsEl = host.querySelector('#trWords');
  wordsEl.scrollTop = host.__scroll || 0;
  wordsEl.onscroll = () => { host.__scroll = wordsEl.scrollTop; };
  host.querySelector('#trSrc').onchange = (e) => loadTranscript(e.target.value);
  const si = host.querySelector('#trSearch');
  // search without rebuilding the pane: focus and scroll stay where they are
  si.oninput = () => {
    E.trSearch = si.value;
    let re2 = null; try { re2 = new RegExp(E.trSearch, 'i'); } catch { re2 = null; }
    let hits2 = 0;
    host.querySelectorAll('.w').forEach((n) => {
      const hit = re2 ? re2.test(words[+n.dataset.i].text) : true;
      if (re2 && hit) hits2++;
      n.classList.toggle('dim2', !!re2 && !hit);
      n.classList.toggle('hit', !!re2 && hit);
    });
    host.querySelector('#trCount').textContent = `${tr.language} · ${tr.words.length} words · ${words.length} on the timeline${E.trSearch ? ` · ${hits2} hits` : ''}`;
  };
  host.querySelector('#trCut')?.addEventListener('click', () => delSelection());
  host.querySelector('#trClr')?.addEventListener('click', () => { E.trSel = null; host.__sig = ''; renderTr(); });
  host.querySelectorAll('.w').forEach((n) => {
    const i = +n.dataset.i;
    n.onclick = (ev) => {
      ctx.pause();
      if (ev.shiftKey && E.trSel) E.trSel = { a: E.trSel.a, b: i };
      else { E.trSel = { a: i, b: i }; ctx.seek(words[i].start); }
      host.__sig = ''; renderTr();
    };
  });
}

function updateTools() {
  if (!el('#eTc')) return;
  el('#eTc').textContent = E.edit ? `${tcf(ctx.S.t)} · ${ctx.S.t.toFixed(2)}s` : '';
  el('#eMeta').textContent = E.edit ? `rev ${E.rev} · ${dur().toFixed(2)}s · ${timelineFrames(E.edit)}f · ↶${E.history.undo} ↷${E.history.redo}` : '';
  el('#eUndo').disabled = !E.history.undo;
  el('#eRedo').disabled = !E.history.redo;
}

// clear + force a transcript pane rebuild (used after cuts and word-selection changes)
function refreshTr() { const h = el('#ebTr'); if (h) { h.__sig = ''; renderTr(); } }

// select the clip -> the inspector follows (used from the canvas handlers). Switches the transcript pane to
// the clip's source when that source has words, so clicking around a multi-source edit follows the picture.
function refreshInspector() {
  const host = el('#ebInsp');
  if (host) { host.__rev = null; renderInspector(); }
  const c = E.sel ? findClip(E.sel) : null;
  if (c && E.tr && !E.tr.missing && E.tr.src !== c.src && E.sources[c.src]?.has_transcript) loadTranscript(c.src);
}

// a slow poll so the inspector catches up once the user blurs an input it was protecting
// (its own refresh refuses to rebuild the form while an input inside it is focused)
setInterval(() => {
  const host = el('#ebInsp');
  if (host && E.edit && host.__rev !== E.rev && !(host.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON')) renderInspector();
}, 1500);
