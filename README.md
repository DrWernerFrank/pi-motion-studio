# pi motion studio

Motion design rendered from code, driven by pi. Every film is a program: `films/<key>/index.html`
paints any moment through `window.seek(t)`, headless Chromium walks time, ffmpeg encodes. pi directs,
animates, designs sound, and looks at its own frames until the critique scores reach 8.

> The prompt is 10% of the video. This harness is the other 90%.

## Start

```bash
cd ~/Desktop/pi-motion-studio        # /mnt/c/Users/Hp/Desktop/pi-motion-studio
./studio gui                         # Studio GUI → http://localhost:3142 (or double-click "Motion Studio.cmd")
pi                                   # or pi-web: New chat in this folder
```

Then, in pi or pi-web:

```
/skill:motion-reel make a 20s launch reel for https://example.com, 9:16 + 16:9
/skill:motion-reel make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are, like it's your showreel for a résumé. go all out.
/skill:motion-director <paste or dictate a director's brief>   (long form, chapters, overnight)
```

Watch the film take shape in the GUI while pi works: live scrubbing of the film's own `seek(t)`, the
rendered MP4s, contact sheets, gate results and score history. **Pin a note at a timecode** (Notes tab,
or press `n`) and pi picks it up as a top-priority fix at its next round.

## What's in it

| | |
|---|---|
| `AGENTS.md` | house rules pi reads every run: render contract, banned looks, sound, the critique loop |
| `.pi/skills/motion-reel/` | the reel pipeline (intake → assets → design → shot list → build → loop → ship) + `craft.md`, a technique vocabulary with canvas code |
| `.pi/skills/motion-director/` | long-form: director's brief skeleton, workflow gates, chapter subagents, overnight rules |
| `.pi/agents/motion-critic.md` | harsh critic that only looks at frames and scores them (fresh eyes) |
| `.pi/agents/motion-animator.md` | animates one chapter / shot range in parallel |
| `.pi/extensions/motion-tools/` | tools `film_status`, `film_look` (returns the contact sheet as an image), `film_render`, `film_sound`, `film_gate`, `film_review`; `/studio` starts the GUI |
| `engine/` | renderer, stills, gates, audio synth + mix, asset capture, CLI |
| `engine/lib/motion.js` | closed-form springs, `track()` (one spring per change), `life`, `pulse`, seeded `rng`/`noise`, `kineticLine`, `fitPx` … |
| `engine/fonts/` | 10 open-licensed faces (Inter, DM Sans, Space Grotesk, Bricolage Grotesque, Syne, Anton, Fraunces, Instrument Serif, JetBrains Mono) |
| `studio-gui/` | the web GUI (no build step) |
| `templates/film/` | what `studio new` copies; `templates/prompts/` the prompt patterns from the trend |
| `films/studio-reel/` | a finished demo film: 12 s, 9:16 + 16:9, 3 critique rounds, all gates pass |

## CLI

`./studio help` lists everything. The ones you'll use:

```bash
./studio new launch --duration 20 --formats 9:16,1:1,16:9 [--loop]
./studio capture launch https://example.com     # real screenshots, logos, colors, fonts
./studio refs launch ~/Downloads/ref.mp4        # reference frames every 0.5 s + sheet
./studio look launch --mode every|beats|shots|strip|phone|times
./studio render launch --draft                  # half-res 30 fps, seconds
./studio sound launch                           # music + sfx → mix at -14 LUFS
./studio gate launch                            # mechanical checks → gates.json
./studio ship launch                            # sound → gates → final all formats → posters → sheets
```

Speed on this machine: a look (24 stills) takes ~3 s, a draft render ~1 s per film second, and a final
render (1080p60, 4× motion blur, 4 parallel workers) ~6 s per film second per format.

## How a film works

```js
import { film } from '/engine/lib/runtime.js';
import { loadDesign } from '/engine/lib/design.js';
import * as M from '/engine/lib/motion.js';
let D, cfg;
film({
  async setup(L, c) { cfg = c; D = await loadDesign(); },
  draw(ctx, t, L) {                       // a pure function of t: no timers, no Math.random, no carried state
    ctx.fillStyle = D.c.bg; ctx.fillRect(0, 0, L.W, L.H);
    D.type(ctx, 'hero', L);
    M.kineticLine(ctx, 'Hello', L.safe.x, L.cy, t, { color: D.c.ink, feel: M.SNAPPY });
  },
});
```

`L` is the layout for the current format (`W, H, u` = 1% of the short side, `cx, cy`, `safe`), so one
timeline renders 9:16, 1:1, 16:9 and 4:5 by reframing instead of cropping. `design.json` holds every font,
size, color and spring feel; `film.json` holds duration, fps, formats, music and shots.

## Gates (`./studio gate`)

lint (no `Math.random`/timers/`Date`/CSS animation) · determinism (same pixels regardless of seek order) ·
dead time · novelty (a visual event every ≤ 4 s) · hook · blank frames · loop seam · loudness (-14 LUFS,
-1 dBTP) · cue sync (SFX on the half-beat grid) · deliverable probe. FAIL blocks `ship`.

## Notes

- pi talks to Claude through `claude-bridge` here (direct `anthropic/*` calls from pi hit the "extra
  usage" limit on this account). The agents use `claude-bridge/claude-opus-5-5`; change `model:` in
  `.pi/agents/*.md` to taste.
- Keys for voice/video APIs go in `.env` and are referred to by name only.
- The two earlier attempts on the Desktop (`motion-studio`, `motion-studio-google`) were left untouched.
- Inspired by the "Opus 5.5 motion design" course (movez) and veedstudio/open-edit (per-run folders,
  design system written first, mechanical gates, preview server).
