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

const once = (el, ev, ms = 20000) => new Promise((ok, bad) => {
  const to = setTimeout(() => bad(new Error(`timeout (${ms} ms) waiting for ${ev} on ${el.currentSrc || el.src}`)), ms); // failure guard only
  el.addEventListener(ev, (e) => { clearTimeout(to); ok(e); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(to); bad(new Error(`cannot decode ${el.currentSrc || el.src}: ${el.error && el.error.message}`)); }, { once: true });
});

// Paint `video` into rect {x,y,w,h}. fit: 'cover' (fill, crop) | 'contain'. cam {cx, cy, zoom}: where in the source the crop is centred (0..1) and how far in.
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

export async function editFilm(hooks = {}) {
  let edit, G, vids = {}, total = 0, strict = false;
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
      for (const ly of layers) {
        if (strict && ly.video.__j !== ly.srcFrame) throw new Error(`footage not prepared for t=${t}: ${ly.clip.src} shows source frame ${ly.video.__j}, needs ${ly.srcFrame} (await __prepare(t) before seek(t))`);
        const lt = (k - G.F(ly.clip.at)) * G.fps.den / G.fps.num;
        footage(ctx, ly.video, { x: 0, y: 0, w: L.W, h: L.H }, { cam: cameraAt(ly.clip, L.fmt, lt) });
      }
      if (hooks.over) hooks.over(ctx, t, L, state);
    },
  });
}
