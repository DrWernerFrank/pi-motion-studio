# Craft: techniques as code (canvas 2D, pure functions of t)

`M` = `/engine/lib/motion.js`, `D` = design from `loadDesign()`, `L` = layout, `lt` = seconds since
shot start. Every snippet is deterministic. Mix and adapt; don't paste all of them into one film.

## Kinetic type

```js
// Words rise out of a clip, each on its own spring (the default reveal; beats fading in).
D.type(ctx, 'hero', L); M.kineticLine(ctx, 'Ship it tonight', L.safe.x, L.cy, lt, { color: D.c.ink, feel: D.feel('type'), stagger: D.stagger });

// Scale slam on a downbeat: big → settle, heavy spring, no overshoot on type.
const s = M.lerp(1.35, 1, M.spring(lt, ...M.HEAVY));
ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(s, s); ctx.textAlign = 'center'; ctx.fillText(word, 0, 0); ctx.restore();

// Fit a word to the frame width exactly (poster type).
const px = M.fitPx(ctx, 'LAUNCH', L.safe.w, `"${D.fonts.display}"`, 800); M.font(ctx, px, `"${D.fonts.display}"`, 800, -0.04);

// Text as a window onto an image/video layer: draw image, then keep only the glyphs.
off.globalCompositeOperation = 'source-over'; off.drawImage(img, 0, 0, W, H);
off.globalCompositeOperation = 'destination-in'; off.fillText('WORLD', x, y); ctx.drawImage(off.canvas, 0, 0);

// Per-character stagger from the center outwards.
[...word].forEach((ch, i) => { const d = Math.abs(i - (word.length - 1) / 2); const p = M.spring(lt - d * 0.03, ...M.SNAPPY); /* y offset (1-p)*… */ });

// Typewriter + caret (UI moments).
ctx.fillText(M.typed(str, lt, 24) + (M.caretOn(lt) ? '▍' : ''), x, y);
```

## The morphing container (one shape, never cut)

```js
// states: [[t, {w, h, r, fill}], …]  → every property is a track() so changes chain smoothly.
const k = (prop) => states.map(([t, s]) => [t, s[prop]]);
const w = M.track(t, k('w'), ...M.SNAPPY), h = M.track(t, k('h'), ...M.DEFAULT), r = M.track(t, k('r'), ...M.DEFAULT);
const i = M.beatIndex(t, states.map((s) => s[0]));             // current state
const fill = M.mix(states[Math.max(0, i - 1)][1].fill, states[i][1].fill, M.spring(t - states[i][0], ...M.DEFAULT));
M.rrect(ctx, L.cx - w / 2, L.cy - h / 2, w, h, r); ctx.fillStyle = fill; ctx.fill();
// content swap behind a short blur: in after the morph starts, out before the next
const a = M.swapAlpha(t, states[i][0], states[i + 1]?.[0] ?? 1e9);
ctx.filter = `blur(${(1 - a) * L.u * 1.2}px)`; ctx.globalAlpha = a; drawContent(i); ctx.filter = 'none'; ctx.globalAlpha = 1;
```

## Camera and depth

```js
// One camera for the whole film: position/zoom/rotation tracks; shots live in world space.
const cam = { x: M.track(t, camX, ...M.DEFAULT), y: M.track(t, camY, ...M.DEFAULT), z: M.track(t, camZ, ...M.HEAVY), r: M.track(t, camR, ...M.HEAVY) };
ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(cam.z, cam.z); ctx.rotate(cam.r); ctx.translate(-cam.x, -cam.y); drawWorld(); ctx.restore();

// Parallax: layers move by camera offset × depth factor.
for (const layer of layers) { ctx.save(); ctx.translate(-cam.x * layer.depth, -cam.y * layer.depth); layer.draw(); ctx.restore(); }

// Handheld drift (subtle, seeded).
const dx = M.noise(t * 0.7, 1) * L.u * 0.6, dy = M.noise(t * 0.6, 2) * L.u * 0.6;
```

## Masks, wipes, transitions

```js
// Iris / circle reveal of the next shot.
const R = Math.hypot(L.W, L.H) * M.spring(t - tCut, ...M.DEFAULT);
ctx.save(); ctx.beginPath(); ctx.arc(ox, oy, R, 0, M.TAU); ctx.clip(); drawNextShot(); ctx.restore();

// Band wipe: N staggered bars cover, then uncover into the next shot (a designed cut).
for (let i = 0; i < N; i++) { const p = M.spring(t - tCut - i * 0.03, ...M.SNAPPY); ctx.fillRect(0, (i * L.H) / N, L.W * p, L.H / N + 1); }

// Match cut: the last element of shot A is exactly the first element of shot B (same box, same color).
// Whip pan: camera x track jumps a full frame in ~0.25 s; the renderer's motion blur does the smear.
```

## Cursor doing real actions

```js
const [cx, cy] = M.track2(t, cursorKeys, 260, 28);                    // [[t, x, y], …], arrive 0.15 s before the click
const click = clicks.find((c) => t >= c && t < c + 0.4);
const press = click ? 1 - 0.15 * Math.sin(Math.PI * Math.min(1, (t - click) / 0.16)) : 1;
if (click) { const p = (t - click) / 0.4; ctx.strokeStyle = M.rgba(D.c.ink, 0.5 * (1 - p)); ctx.lineWidth = L.u * 0.3; ctx.beginPath(); ctx.arc(cx, cy, L.u * (1 + 5 * M.ease.outCubic(p)), 0, M.TAU); ctx.stroke(); }
ctx.save(); ctx.translate(cx, cy); ctx.scale(press * L.u * 0.22, press * L.u * 0.22); ctx.fill(new Path2D('M0 0 L0 17 L4.5 12.5 L7.5 19.5 L10 18.5 L7 11.5 L13 11.5 Z')); ctx.restore();
// add a "click" cue at each click time in cues.json
```

## Data that draws itself

```js
// Line chart reveal: dash offset from path length.
ctx.setLineDash([len, len]); ctx.lineDashOffset = len * (1 - M.spring(lt, ...M.DEFAULT)); ctx.stroke(path); ctx.setLineDash([]);
// Counter rolling to a number (tabular figures: mono face).
const v = Math.round(M.lerp(0, 12480, M.spring(lt, ...M.HEAVY))).toLocaleString('en-US');
// Bars grow staggered from the baseline with SNAPPY.
```

## Real product screenshots

```js
// setup: const img = new Image(); img.src = './assets/desktop.png'; await img.decode();
// Crop a region (sx, sy, sw, sh in image px) into a rounded card, scroll it with a track.
const sy = M.track(t, [[0, 0], [3.2, 900], [4.4, 1600]], ...M.DEFAULT);
ctx.save(); M.rrect(ctx, x, y, w, h, L.u * 2); ctx.clip(); ctx.drawImage(img, 0, sy, img.width, img.width * h / w, x, y, w, h); ctx.restore();
// Zoom into a feature: scale around its center with HEAVY; dim the rest with a spotlight mask.
```

## Texture and finish

```js
// Film grain, deterministic: precompute 8 noise tiles in setup, pick by frame at 24 fps.
const g = grain[Math.floor(t * 24) % grain.length]; ctx.globalAlpha = 0.06; ctx.drawImage(g, 0, 0, L.W, L.H); ctx.globalAlpha = 1;
// Seeded layouts: const r = M.rng(42); build positions in setup, animate with springs staggered by distance.
// Stagger by distance from an origin: delay = Math.hypot(x - ox, y - oy) / L.W * 0.4.
```

## Gotchas

- `ctx.globalAlpha` outside [0, 1] is **silently ignored** (the previous alpha stays). Springs overshoot, so
  `1 - spring(...)` goes slightly negative: always `M.clamp(...)` an alpha built from springs.
- Set `ctx.filter = 'none'` and `globalAlpha = 1` back after use (or wrap in save/restore).
- `measureText` depends on the current font and `letterSpacing`: set the font before measuring.

## Loops

- The last frame must equal the first: design the end state as the start state; for periodic motion
  use `Math.sin(M.TAU * t / cfg.duration * k)` with integer `k`; springs must have settled by the seam.
- `film_gate` checks the seam (`loop-seam`).

## Showreel shot menu (pick 6-8, each a different technique)

kinetic type slam · morphing container · type-as-mask over imagery · lattice/grid bloom · camera fly-through
of a type world · data drawing itself · split-screen match cut · iris into a new palette · 3D-ish card
stack (scale + y offset + shadow) · liquid blob metaball (sum of radial fields thresholded on a small
canvas, scaled up) · stroke-drawn logo lockup · counter + chart proof moment · outro that sets up the loop
