# Motion Studio: house rules

This folder is a motion design studio. Every film is a program: `films/<key>/index.html` paints any
moment through `window.seek(t)`, headless Chromium walks time, ffmpeg encodes. You direct, animate,
design sound and engineer the render. The prompt is 10% of the video; this harness is the other 90%.

Use `/skill:motion-reel` for a reel, ad, launch or explainer (up to ~60 s).
Use `/skill:motion-director` for long-form, multi-chapter or overnight films.

## Where things live

| Path | What |
|---|---|
| `films/<key>/film.json` | duration, fps, formats, loop, music, shots, gates: the source of truth |
| `films/<key>/design.json` | direction, fonts, palette, type ladder, spring feels, devices. **Written before any code** |
| `films/<key>/brief.md`, `shotlist.md` | intent and the beat-by-beat plan |
| `films/<key>/index.html` | the film: `film({ setup, draw(ctx, t, L) })` |
| `films/<key>/cues.json` | SFX cues `[{ "t": 0.5, "type": "click" }]` on the beat grid |
| `films/<key>/beats.json` | beat grid (measured or gridded). Films read it as `cfg.beats / cfg.downbeats / cfg.hits` |
| `films/<key>/notes.json` | timecoded notes the user pinned in the Studio GUI. **Open notes outrank everything** |
| `films/<key>/reviews.json`, `review_log.md` | critique rounds (via `film_review`) |
| `films/<key>/assets/`, `refs/` | real brand assets (`studio capture`), reference frames (`studio refs`) |
| `films/<key>/out/` | renders, `mix.wav`, `sheets/*.png`, posters |
| `engine/lib/motion.js` | springs, `track`, `life`, `pulse`, `rng`, `noise`, `kineticLine`, `fitPx`, `rrect`… |
| `engine/lib/design.js` | `loadDesign()` → `D.type(ctx, role, L)`, `D.px`, `D.c`, `D.feel` |
| `engine/lib/runtime.js` | `film()`, formats, layout `L` (W, H, u, cx, cy, safe, portrait…) |
| `templates/prompts/` | prompt patterns from the viral posts (one-liner, brand, reference, UI-morph spec, director brief) |

Tools: `film_status`, `film_look` (see your frames), `film_render`, `film_sound`, `film_gate`, `film_review`.
CLI (same engine): `node engine/cli.mjs help`. GUI: `/studio` → http://localhost:3142 (live scrub, renders,
sheets, scores, notes).

## Render contract (the gates enforce it)
- Every film is a pure function of time. `draw(ctx, t, L)` may not depend on the previous frame.
- No `Math.random` (use `rng(seed)` / `hash(n)` / `noise(x)`), no timers, no `requestAnimationFrame`,
  no `Date`/`performance.now`, no CSS transitions/animations, no `will-change`.
- Precompute in `setup(L, cfg)` only what is a pure function of the layout (glyph widths, paths, images).
- Canvas 2D by default. Load images in `setup` (await `img.decode()`). Fonts: the bundled faces in
  `engine/lib/fonts.css`, or `@font-face` with a file in the film folder. Never rely on system fonts.
- Alphas built from springs must be clamped: canvas ignores `globalAlpha` outside [0, 1].
- Lay out with `L` (u = 1% of the short side, `L.safe` for vertical-feed UI), never fixed pixels, so every
  format reframes instead of cropping.

## Look
- Banned defaults: centered title on a gradient, everything fading in, corner labels and frame
  borders, glow on UI chrome, generic particle bursts, stock "tech" blue-purple gradients.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Motion is springs (`spring`, `track`, `life` with `SNAPPY/DEFAULT/HEAVY/PLAYFUL`). Tiny overshoot on
  UI, none on type. A value with more than one target uses `track()`, never a restarted spring.
- Text inside a morphing container enters after the morph starts, leaves before the next (`swapAlpha`).
- Every 2 to 4 seconds something new happens on screen. The first 2 seconds carry the hook.
- Readable at phone size: nothing important under `3.2u`; test with `film_look` mode `phone`.

## Sound
- Synthesized in code unless a track is supplied (`film.json` `track`). Measure a supplied track first.
- State changes on beats, big moments on downbeats, SFX on the half-beat grid or measured hits.
- Loudness -14 LUFS, true peak -1 dB (`film_sound` does it).

## The loop: before you show anything
1. `film_status` (read open notes) → `film_look` (every / beats / phone) and LOOK properly.
2. `film_review`: score 1-10 on hook, readability, motion, variety, composition, brand, sound;
   the 3 worst problems with timestamps. Be a harsh motion director, not a proud author.
3. Fix those 3. Re-look only the affected seconds (`film_look` mode `times`/`strip`).
4. Repeat until every score is 8+ (at least 3 rounds for anything new). Then `film_gate`, then the
   final render. For an independent eye, spawn the `motion-critic` subagent.

## Secrets
API keys live in `.env` (never in a prompt, brief or screenshot). Refer to them by name:
"the ElevenLabs key is `ELEVENLABS_API_KEY` in `.env`".

## Real footage

`studio new <key> --edit` starts an edit film: real footage (phone clips, talking heads, podcasts,
screen recordings) cut in the same studio, same loop, same gates. Pipeline and craft rules:
`.pi/skills/video-edit/SKILL.md`. The last review round is the `edit-critic` agent.

- Originals are read-only (sha-pinned in the media bin; `studio relink` repairs a moved one by hash).
  Ingest conforms (CFR, upright, SDR bt709, short GOP); `media.json` and the silence map are the truth
  about a source, conformed media is a cache.
- `films/<key>/edit.json` is the timeline as data: ops only (`studio edit <film> <op> --k v`, undo/redo,
  stale `base-rev` conflicts), every op frame-snapped at the project's rational fps. Never hand-edit it.
- Cut points are measured from the audio (noise floor, gaps), never from word boundaries. Every
  automated cut (`studio cut <kind>`) runs dry first and lists its removed text so a human can veto.
- Captions are design, not subtitles: 3 styles from `design.json`, the per-format safe area, the phone test.
- Audio first: the dialog bus is built from the timeline, the music bed ducks 10-14 dB under speech, and
  -14 LUFS / -1 dBTP is the mixer's job (`studio sound`), never a hand-tuned guess.

## Math videos

`studio new <key> --math` starts a math film: Manim scenes, a narration script, sympy-verified
claims, per-scene cached renders, measured layout lint and the same loop and gates. Pipeline
and craft rules: `.pi/skills/math-video/SKILL.md` (the kit API is `engine/manim/kit.md`; the
pitfalls are in its `manim-notes.md`). In pi it is one sentence (the `math-video` skill):

```
/skill:math-video explain eigenvectors in 90 seconds, narrated, 16:9 and 9:16
/skill:math-video a 60-second visual proof that 1 + 3 + … + (2n-1) = n²
cut/skill:math-video here is my script.md and my own narration.wav: animate it
```

The CLI underneath (the math rows that exist today):

| Command | Example |
|---|---|
| `./studio new <key> --math` | scaffold a math film (script.md, scenes/, design.json, lexicon.json) |
| `./studio look <key> --mode every\|sentences\|bookmarks\|sections\|phone\|strip\|times` | labelled contact sheets from the draft (re-rendered when stale) |
| `./studio render <key> --draft` | cached per scene, all formats; `--final` ships at film fps |
| `./studio scene <key> <scene-id> [--draft\|--final] [--fmt 9:16]` | render ONE scene for fast iteration |
| `./studio check <key> [--scene <id>]` | dry run: typesetting + claims, no video |
| `./studio where <key> --t 49.27` | which scene, sentence, animation and file:line owns a timecode |
| `./studio sound <key>` | narration voice + mix at `mix.lufs` (−16, narration-first) → out/mix.wav |

Everything the mathematics says on screen is a registered `claim` evaluated with sympy — numbers
come from computation, never typing; `--independent` re-derives each claim in a fresh process.
The narration is data (`script.md` → timing.json): scenes wait for the voice (`say`/`at`/`until`),
never the reverse. The review loop is AGENTS.md's with two extra rubric keys (correctness,
clarity); **the last review round is the `math-critic` agent** (fresh eyes that re-derive every
number by hand). Gates and `./studio ship <key>` are wired for math films (gates → finals → `out/claims.md`).
