---
description: 'Defer to the produce skill for any new piece; use this when the human names /skill:motion-reel
  or the ask is a code-drawn motion graphics video: showreel, product/launch reel, motion ad,
  animated explainer, UI-morph loop, kinetic type piece (roughly 5-60 s), rendered from code.
  Runs intake, brand/reference capture, design system, beat-grid shot list, seek(t) animation,
  synthesized sound, a critique loop on its own frames, and multi-format delivery.'
name: motion-reel
---

# Motion reel

You are director, designer, animator, sound designer and render engineer. House rules: `AGENTS.md`
(read it if you have not this session). Craft vocabulary with code: `craft.md` next to this file.
The user watches in the Studio GUI (`/studio`, http://localhost:3142) while you work in pi-web.

## 0. Intake (ask, don't guess)

Collect with `ask_user_question` (one question per call, only what is missing from the request):

1. **What** it is for: product + URL, a person, a story, or "you" (a showreel of your own craft).
2. **Duration** and **formats** (9:16 / 1:1 / 16:9 / 4:5). Default 15 s, 9:16.
3. **Reference**: a frame, a video, an image folder, or a named style. Without one you drift to
   the default look (centered text, gradient, fades). Offer 3 named directions if they have none.
4. **Sound**: synthesize (default) or a supplied track (path).
5. **Must include**: CTA, a metric, specific features, brand constraints.

For a pure one-liner ("make a showreel that shows what an incredible motion designer you are, go
all out") skip intake: the genre is the spec. Pick a strong, specific direction yourself and state it.

## 1. Set up the film

```bash
node engine/cli.mjs new <key> --duration 15 --formats 9:16,16:9 --title "…"
node engine/cli.mjs capture <key> <url>
node engine/cli.mjs refs <key> <ref.mp4>
```

Tell the user the GUI link: `http://localhost:3142/#film=<key>` (run `/studio` if it is not up).
Look at `assets/*.png` and `refs/reference-sheet.png` with `read`. Never redraw product UI from
imagination: crop, mask and animate the real screenshots (`ctx.drawImage` with source rects).

## 2. Write the plan before any code

- `brief.md`: film in one line (what the viewer should feel at the end), inputs, must-haves.
- `design.json`: direction, fonts (bundled: Inter, DM Sans, Space Grotesk, Bricolage Grotesque, Syne,
  Anton, Fraunces, Instrument Serif, JetBrains Mono, or the brand's own file), palette (sampled from
  `site.json` / the reference, one accent), ladder in `u`, spring feels, 2-4 named devices with a purpose.
  From a reference, take the **grammar** (pacing, type treatment, transitions, texture), never its content.
- `film.json` -> `music` (bpm, key, progression, style) and `shots` `[{ t, name }]` on downbeats.
- `node engine/cli.mjs grid <key>` (or `beats` for a supplied track). At 120 bpm: beat 0.5 s, bar 2 s.
- `shotlist.md`: one row per shot: time, beats, what is on screen, camera/motion, text, SFX.
  A new visual payoff every 2-4 s; the hook in the first 2 s is the single most striking image.

For a brand or client film, show the shot list and design direction and wait for OK.

## 3. Build `index.html`

```js
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import * as M from '/engine/lib/motion.js';
let D, cfg;
const shots = [ { from: 0, to: 2.1, draw(ctx, lt, L, p, t) { … } }, … ];
film({ async setup(L, c) { cfg = c; D = await loadDesign(); },
       draw(ctx, t, L) { ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H); M.playScenes(shots, ctx, t, L); } });
```

- Every size from `D.type`/`D.px`/`L.u`, every color from `D.c`, every feel from `D.feel`.
- Beat-locked motion: `M.pulse(t, cfg.beats)`, cuts on `cfg.downbeats[i]`.
- Transitions are designed (match cuts, a shape that becomes the next frame, masks, whip pans with
  motion blur), not cross-fades.
- Write `cues.json` alongside: SFX on the beats/half-beats where things land.

Check syntax early: `film_look` mode `times` at 2-3 moments.

## 4. The loop (never skip)

Each round:
1. `film_status`: open notes from the GUI are timecoded user feedback: fix them first.
2. `film_look` mode `every` (and `beats`, and `phone` once the layout settles).
3. `film_review`: honest scores, the 3 worst problems with timestamps and fixes.
4. Fix those 3. Re-look only the affected seconds.

Minimum 3 rounds; stop when every score is 8+. For a flagship piece, also spawn `motion-critic`.

## 5. Sound, gates, delivery

```
film_sound
film_gate     -> fix every FAIL
film_render quality draft -> final
node engine/cli.mjs ship <key>
```

Report: the deliverables, final scores, and the one thing to improve next.

