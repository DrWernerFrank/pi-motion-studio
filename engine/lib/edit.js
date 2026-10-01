// edit.js: footage inside the film canvas (mission D2, ADR-001). An edit film is an ordinary film whose picture comes from edit.json:
//
//   import { editFilm } from '/engine/lib/edit.js';
//   editFilm({ under(ctx, t, S) { … }, over(ctx, t, S) { … } });      // optional graphics hooks, drawn below / above the footage
//
// Frames come from <video> elements on CONFORMED media (CFR, upright, short GOP; see ingest). window.__prepare(t) seeks every needed
// element to the middle of its source frame and awaits `seeked`; draw() then only paints. A frame is a pure function of
// (edit.json, media files, t): no timers, no wall clock, no carried state beyond "which source frame each element currently shows".
import { film } from './runtime.js';
import { activeClip, clipFrames, grid, mapFrame } from './edit-ops.mjs';
import { captionChunks, captions } from './captions.js';
import { drawOverlays, punchInZoom } from './overlays.js';

// source-word times -> timeline times for the caption chunks (same rule as engine/lib/retime.mjs)
  const retime = (ed, srcId, words) => {
    const out = [];
    for (const t of ed.tracks) {
      if (t.kind !== 'video') continue;
      for (const c of [...t.clips].sort((a, b) => G2(ed).F(a.at) - G2(ed).F(b.at))) {
        if (c.src !== srcId || c.freeze) continue;
        const g = G2(ed), sf = g.F(c.out) - g.F(c.in), k = sf ? sf / clipFrames(ed, c) : 1;
        for (const w of words) if (w.start >= c.in - 1e-6 && w.end <= c.out + 1e-6) out.push({ ...w, start: c.at + (w.start - c.in) / k, end: c.at + (w.end - c.in) / k });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  };
  const G2 = (ed) => grid(ed);

  const once = (el, ev, ms = 20000) => new Promise((ok, bad) => {
  const to = setTimeout(() => bad(new Error(`timeout (${ms} ms) waiting for ${ev} on ${el.currentSrc || el.src}`)), ms); // failure guard only
  el.addEventListener(ev, (e) => { clearTimeout(to); ok(e); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(to); bad(new Error(`cannot decode ${el.currentSrc || el.src}: ${el.error && el.error.message}`)); }, { once: true });
});

// Paint `video` into rect {x,y,w,h}. fit: 'cover' (fill, crop) | 'contain'. cam {cx, cy, zoom}: where in the source the crop is centred (0..1) and how far in.
// a clip's colour grade (D8) as a canvas filter string: exposure=brightness, contrast, saturation, warm/cool
export const colorFilter = (col) => {
  if (!col) return 'none';
  const f = [];
  if (col.exposure) f.push(`brightness(${Math.max(0.05, 2 ** col.exposure).toFixed(4)})`);
  if (col.contrast) f.push(`contrast(${col.contrast.toFixed(4)})`);
  if (col.saturation !== undefined) f.push(`saturate(${col.saturation.toFixed(4)})`);
  if (col.temperature) {
    // warm: sepia toward red; cool: hue-rotate toward blue + a slight desat. sepia only ever warms, so the
    // cool path never uses it (the color check caught exactly that: cool pushed V UP instead of down)
    const t = col.temperature;
    if (t > 0) f.push(`sepia(${(t * 0.35).toFixed(3)}) saturate(1.25)`);   // warm: toward red
    else f.push(`hue-rotate(${(-t * 35).toFixed(1)}deg) saturate(0.92)`); // cool: toward blue (measured: U +9/test-card at -20deg; natural footage needs more)
  }
  return f.length ? f.join(' ') : 'none';
};

export function footage(ctx, video, rect, { fit = 'cover', cam = { cx: 0.5, cy: 0.5, zoom: 1 }, radius = 0, filter } = {}) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  const k = (fit === 'contain' ? Math.min(rect.w / vw, rect.h / vh) : Math.max(rect.w / vw, rect.h / vh)) * (cam.zoom || 1);
  const sw = Math.min(vw, rect.w / k), sh = Math.min(vh, rect.h / k);
  const sx = Math.min(Math.max(0, (cam.cx ?? 0.5) * vw - sw / 2), vw - sw), sy = Math.min(Math.max(0, (cam.cy ?? 0.5) * vh - sh / 2), vh - sh);
  const dw = fit === 'contain' ? sw * k : rect.w, dh = fit === 'contain' ? sh * k : rect.h, dx = rect.x + (rect.w - dw) / 2, dy = rect.y + (rect.h - dh) / 2;
  ctx.save();
  if (radius) { ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, radius); ctx.clip(); }
  if (filter) ctx.filter = filter;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

// Camera for a clip in an output format at clip-local time lt (seconds): linear between keyframes, held outside them. Default: centred, no zoom.
export function cameraAt(clip, fmt, lt) {
  const kf = clip.crop?.[fmt];
  if (!kf?.length) return { cx: 0.5, cy: 0.5, zoom: 1 };
  if (lt <= kf[0].t) return kf[0];
  for (let i = 1; i < kf.length; i++) if (lt <= kf[i].t) { const a = kf[i - 1], b = kf[i], u = (lt - a.t) / (b.t - a.t || 1); return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u, zoom: a.zoom + (b.zoom - a.zoom) * u }; }
  return kf.at(-1);
}

// A follow camera: critically damped spring + dead zone over track.json samples (D8). Never snaps, never
// jitters: inside the dead zone it holds, outside it eases after the subject at ~200 ms.
// A follow camera: critically damped spring + dead zone over track.json samples (D8). Never snaps, never
// jitters: inside the dead zone it holds, outside it eases after the subject. The spring is genuinely critical
// (d = 2*sqrt(k)): under-damped overshoots, over-damped has sqrt(k - d^2/4) go NaN — the black-frame bug found
// by the reframe check (D-013).
function followCam(track, t, fmt, dz = 0.04) {
  if (!track || !track.boxes?.length) return null;
  const at = (t2) => {
    let i = track.boxes.findIndex((b) => b.t >= t2);
    if (i < 0) i = track.boxes.length;
    const prev = track.boxes[Math.max(0, i - 1)], next = track.boxes[Math.min(track.boxes.length - 1, i)];
    const pick = (b) => (b && b.x !== null && b.x !== undefined ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2 } : null);
    return pick(next) ?? pick(prev);   // a miss holds the last known position
  };
  const target = at(t);
  if (!target) return null;
  const held = (followCam.held ??= {})[fmt] ??= { cx: target.cx, cy: target.cy };
  if (Math.abs(target.cx - held.cx) < dz && Math.abs(target.cy - held.cy) < dz) return { ...held, zoom: 1 };   // dead zone: hold
  // one critically damped spring step of 1/12 s (the render's frame cadence): eases ~85% of the remaining gap
  const k = 170, d = 2 * Math.sqrt(k), tt = 1 / 12;
  const x = 1 - Math.exp(-d * tt) * (1 + d * tt);   // critically damped step response at tt
  held.cx += (target.cx - held.cx) * x;
  held.cy += (target.cy - held.cy) * x;
  return { cx: held.cx, cy: held.cy, zoom: 1 };
}

export async function editFilm(hooks = {}) {
  let edit, G, vids = {}, total = 0, strict = false, cues = null, D = null, tracks = {};
  const state = { edit: null, layers: [] };

  // the layers visible at absolute frame k: [{ track, clip, srcFrame, video }] bottom to top
  const layersAt = (k) => edit.tracks.filter((t) => t.kind === 'video').map((track) => {
    const clip = activeClip(edit, track, k);
    return clip && edit.sources[clip.src].kind !== 'audio' ? { track, clip, srcFrame: mapFrame(edit, clip, k), video: vids[`${track.id}:${clip.src}`] } : null;
  }).filter(Boolean);
  const frameOf = (t) => Math.max(0, Math.min(total - 1, Math.floor((t * G.fps.num) / G.fps.den + 1e-6)));

  return film({
    async setup(L, cfg) {
      edit = await fetch('./edit.json', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('edit.json not found next to index.html'); return r.json(); });
      G = grid(edit); state.edit = edit; strict = new URLSearchParams(location.search).get('render') === '1';
      total = Math.max(...edit.tracks.flatMap((t) => t.clips.map((c) => G.F(c.at) + clipFrames(edit, c))), 1);
      const missing = [];
      await Promise.all(edit.tracks.filter((t) => t.kind === 'video').flatMap((t) => [...new Set(t.clips.map((c) => c.src))].map(async (src) => {
        if (edit.sources[src].kind === 'audio') return;
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = `./assets/media/${src}/conformed.mp4`;
        v.__j = -1; vids[`${t.id}:${src}`] = v;
        try { await once(v, 'loadeddata'); } catch (e) { missing.push(`${src}: ${e.message}`); }
      })));
      if (missing.length) throw new Error(`footage failed to load (re-run \`studio ingest\`?):\n${missing.join('\n')}`);
      // design.json drives the caption/overlay look; captions come from the `from` source's transcript (retimed)
      try { D = await (await import('./design.js')).loadDesign('./design.json'); } catch { D = null; } // the wrapper (D.px/D.c/D.fonts), not the raw file
      if (edit.captions) {
        const from = edit.captions.from ?? edit.tracks.find((x) => x.kind === 'video')?.clips[0]?.src;
        const doc = from && await fetch(`./assets/media/${from}/transcript.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!doc) throw new Error(`edit.json wants captions from "${from}" but there is no transcript: run \`studio transcribe ${'<film>'} ${from}\``);
        const tl = retime(edit, from, doc.words);
        cues = captionChunks(tl, { maxChars: edit.captions.maxChars, maxGap: edit.captions.maxGap });
        state.captions = { cues, style: edit.captions.style || 'pop', lang: edit.captions.lang || doc.language };
      }
      // track.json per source (face or seeded): the `follow` camera reads it
      for (const id of new Set(edit.tracks.flatMap((x) => x.clips.map((c) => c.src)))) {
        const doc = await fetch(`./assets/media/${id}/track.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (doc) tracks[id] = doc;
      }
      if (hooks.setup) await hooks.setup(L, cfg, state);
    },
    // Seek every video element this frame needs to the middle of its source frame, and wait for it. Repeated sub-frame times hit the cache.
    async prepare(t) {
      const k = frameOf(t), layers = layersAt(k);
      await Promise.all(layers.map(async (ly) => {
        const v = ly.video, want = ly.srcFrame;
        if (v.__j === want) return;
        const p = once(v, 'seeked'); v.currentTime = (want + 0.5) / G.fps.value; await p; v.__j = want;
      }));
      state.k = k;
    },
    draw(ctx, t, L, cfg) {
      const k = frameOf(t), layers = layersAt(k);
      state.t = t; state.k = k; state.layers = layers; state.fps = G.fps;
      if (hooks.under) hooks.under(ctx, t, L, state);
      // punch-ins are camera moves: the footage draw below consumes the active ones
      const punches = (edit.overlays ?? []).filter((o) => o.type === 'punch-in' && t >= o.at && t <= o.at + o.dur);
      for (const ly of layers) {
        if (strict && ly.video.__j !== ly.srcFrame) throw new Error(`footage not prepared for t=${t}: ${ly.clip.src} shows source frame ${ly.video.__j}, needs ${ly.srcFrame} (await __prepare(t) before seek(t))`);
        const lt = (k - G.F(ly.clip.at)) * G.fps.den / G.fps.num;
        const trk = tracks[ly.clip.src];
        let cam = ly.clip.crop?.[L.fmt] ? cameraAt(ly.clip, L.fmt, lt) : trk && (ly.clip.cam === 'follow' || edit.captions?.cam === 'follow') ? followCam(trk, (ly.clip.in + lt * (ly.clip.speed || 1)), L.fmt) : { cx: 0.5, cy: 0.5, zoom: 1 };
        if (ly.clip.cam === 'follow' && trk) cam = { ...(cam ?? {}), ...followCam(trk, ly.clip.in + lt * (ly.clip.speed || 1), L.fmt) };
        for (const p of punches) { const lt2 = t - p.at; cam = { ...cam, zoom: cam.zoom * punchInZoom(lt2, { dur: p.dur, zoom: p.props.zoom ?? 1.18 }), cx: p.props.cx ?? cam.cx, cy: p.props.cy ?? cam.cy }; break; }
        footage(ctx, ly.video, { x: 0, y: 0, w: L.W, h: L.H }, { cam, filter: colorFilter(ly.clip.color) });
      }
      drawOverlays(ctx, t, L, D, edit.overlays, cfg);
      if (state.captions) captions(ctx, t, { cues: state.captions.cues, style: state.captions.style, lang: state.captions.lang, face: state.face ?? undefined, D }, L);
      if (hooks.over) hooks.over(ctx, t, L, state);
    },
  });
}
