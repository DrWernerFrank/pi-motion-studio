// runtime.js: turns a film's draw(ctx, t, L) into window.seek(t).
//
//   import { film } from '/engine/lib/runtime.js';
//   film({ setup(L) { ... }, draw(ctx, t, L) { ... } });
//
// URL params:  ?fmt=9x16|1x1|16x9|4x5   ?scale=0.5 (draft pixels)
//              ?render=1 (headless capture: bare canvas, no UI)
//              ?embed=1  (inside the Studio GUI: fitted canvas, parent drives seek)
//              otherwise: standalone preview with a transport bar.
// film.json (next to index.html) is the source of truth for duration, fps, formats, background.

export const FORMATS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350] };
export const fmtKey = (s) => (s || '').replace('x', ':');

export function layout(fmt) {
  const [W, H] = FORMATS[fmt] || FORMATS['9:16'];
  const u = Math.min(W, H) / 100;
  const portrait = H > W * 1.1, landscape = W > H * 1.1, square = !portrait && !landscape;
  // Safe area: vertical feeds put UI over the top ~8% and bottom ~14%.
  const safe = portrait ? { x: W * 0.07, y: H * 0.1, w: W * 0.86, h: H * 0.72 }
    : { x: W * 0.06, y: H * 0.08, w: W * 0.88, h: H * 0.84 };
  return { W, H, u, cx: W / 2, cy: H / 2, fmt, portrait, landscape, square, safe,
    vw: (p) => (W * p) / 100, vh: (p) => (H * p) / 100 };
}

export async function film(spec) {
  const q = new URLSearchParams(location.search);
  const cfg = await fetch('./film.json', { cache: 'no-store' }).then((r) => r.json());
  // beats.json (measured or gridded) rides along as cfg.beats / cfg.downbeats / cfg.hits.
  const grid = await fetch('./beats.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (grid) Object.assign(cfg, { beats: grid.beats, downbeats: grid.downbeats, hits: grid.hits || [], bpm: grid.bpm ?? cfg.bpm });
  const fmt = fmtKey(q.get('fmt')) || (cfg.formats && cfg.formats[0]) || '9:16';
  const scale = Number(q.get('scale') || 1);
  const mode = q.get('render') ? 'render' : q.get('embed') ? 'embed' : 'preview';
  const L = layout(fmt);
  // fps may be a rational string ("30000/1001"): the numeric rate is for UI stepping only; frames themselves are integers (frames.mjs)
  const fpsNum = (v) => { if (typeof v === 'string' && v.includes('/')) { const [a, b] = v.split('/').map(Number); return a / b; } return Number(v) || 60; };
  const duration = cfg.duration, fps = fpsNum(cfg.fps);

  document.documentElement.style.cssText = 'margin:0;background:#000;';
  document.body.style.cssText = 'margin:0;overflow:hidden;background:' + (mode === 'render' ? '#000' : '#0b0b0c') + ';';
  const canvas = document.createElement('canvas');
  canvas.id = 'c';
  canvas.width = Math.round(L.W * scale);
  canvas.height = Math.round(L.H * scale);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });

  // Fonts: every declared @font-face must be loaded before the first paint.
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  await document.fonts.ready;

  if (spec.setup) await spec.setup(L, cfg);

  const seek = (t) => {
    // map logical W×H onto the integer canvas exactly (fractional preview scales would leave a half row)
    ctx.setTransform(canvas.width / L.W, 0, 0, canvas.height / L.H, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.fillStyle = cfg.background || '#000';
    ctx.fillRect(0, 0, L.W, L.H);
    spec.draw(ctx, t, L, cfg);
  };
  window.seek = seek;

  // Footage films (edit.js) must load frames asynchronously before they can paint: spec.prepare(t) does that, and every caller of a
  // frame awaits it through __frame / __sigFrame. For motion films these are the plain __still / __sig, so nothing changes for them.
  window.__prepare = spec.prepare ? (t) => spec.prepare(t, L, cfg) : null;

  // Helpers for the renderer and the gates (same page, no state carried).
  window.__still = (t, type = 'image/png', quality) => { seek(t); return canvas.toDataURL(type, quality); };
  const sigCanvas = document.createElement('canvas');
  window.__sig = (t, w = 64) => {
    seek(t);
    const h = Math.max(1, Math.round((w * canvas.height) / canvas.width));
    sigCanvas.width = w; sigCanvas.height = h;
    const s = sigCanvas.getContext('2d', { willReadFrequently: true });
    s.drawImage(canvas, 0, 0, w, h);
    const d = s.getImageData(0, 0, w, h).data, out = new Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    return out;
  };
  window.__frame = async (t, type = 'image/png', quality) => { if (spec.prepare) await spec.prepare(t, L, cfg); return window.__still(t, type, quality); };
  window.__sigFrame = async (t, w = 64) => { if (spec.prepare) await spec.prepare(t, L, cfg); return window.__sig(t, w); };
  window.__film = { duration, fps, fpsRational: cfg.fps, kind: cfg.kind || 'motion', fmt, W: L.W, H: L.H, scale, formats: cfg.formats || [fmt], beats: cfg.beats || null };

  if (mode === 'render') { if (spec.prepare) await spec.prepare(0, L, cfg); seek(0); window.__ready = true; return; }

  // Fit canvas to the viewport for embed + preview.
  const fit = () => {
    const pad = mode === 'preview' ? 64 : 0;
    const k = Math.min(innerWidth / L.W, (innerHeight - pad) / L.H);
    canvas.style.cssText = `display:block;margin:0 auto;width:${L.W * k}px;height:${L.H * k}px;`;
  };
  addEventListener('resize', fit); fit();

  if (mode === 'embed') {
    // The Studio GUI drives time via postMessage or direct window.seek calls.
    addEventListener('message', async (e) => { if (e.data && e.data.seek != null) { if (spec.prepare) await spec.prepare(e.data.seek, L, cfg); seek(e.data.seek); } });
    if (spec.prepare) await spec.prepare(Number(q.get('t') || 0), L, cfg);
    seek(Number(q.get('t') || 0));
    window.__ready = true;
    parent.postMessage({ filmReady: { duration, fps, fmt, W: L.W, H: L.H } }, '*');
    return;
  }

  // Standalone preview: a small transport. requestAnimationFrame is fine here, never in render mode.
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:56px;display:flex;gap:12px;align-items:center;padding:0 16px;font:13px/1 ui-monospace,monospace;color:#ddd;background:#141416;';
  bar.innerHTML = `<button id="pp" style="width:64px">play</button><input id="sc" type="range" min="0" max="${duration}" step="${1 / fps}" value="0" style="flex:1"><span id="tc">0.00s</span>
    <select id="fm">${(cfg.formats || [fmt]).map((f) => `<option ${f === fmt ? 'selected' : ''}>${f}</option>`).join('')}</select>`;
  document.body.appendChild(bar);
  const audio = new Audio('./out/mix.wav');
  let playing = false, t0 = 0, start = 0, cur = 0;
  const show = async (t) => { cur = t; if (spec.prepare) await spec.prepare(t, L, cfg); seek(t); bar.querySelector('#sc').value = t; bar.querySelector('#tc').textContent = t.toFixed(2) + 's'; };
  const loop = (now) => {
    if (!playing) return;
    let t = t0 + (now - start) / 1000;
    if (t >= duration) { t0 = 0; start = now; t = 0; audio.currentTime = 0; }
    show(t); requestAnimationFrame(loop);
  };
  const toggle = () => {
    playing = !playing; bar.querySelector('#pp').textContent = playing ? 'pause' : 'play';
    if (playing) { t0 = cur; start = performance.now(); audio.currentTime = cur; audio.play().catch(() => {}); requestAnimationFrame(loop); } else audio.pause();
  };
  bar.querySelector('#pp').onclick = toggle;
  bar.querySelector('#sc').oninput = (e) => { if (playing) toggle(); show(Number(e.target.value)); };
  bar.querySelector('#fm').onchange = (e) => { q.set('fmt', e.target.value.replace(':', 'x')); location.search = q.toString(); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.code === 'ArrowRight') show(Math.min(duration, cur + (e.shiftKey ? 1 : 1 / fps)));
    if (e.code === 'ArrowLeft') show(Math.max(0, cur - (e.shiftKey ? 1 : 1 / fps)));
  });
  await show(Number(q.get('t') || 0));
  window.__ready = true;
}
