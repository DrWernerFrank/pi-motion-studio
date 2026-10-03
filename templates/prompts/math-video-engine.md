# Mission: Motion Studio makes math videos with Manim

> For the human: from the repo root run
> `pi @templates/prompts/math-video-engine.md "Execute the attached mission end to end. Do not stop, do not ask me questions, and do not hand back a plan or a summary until ./studio verify-math passes and every box in docs/math/PROGRESS.md is ticked."`

Motion Studio has two kinds of film: code-drawn motion films (Canvas, `film.json` without a `kind`) and
real-footage edits (`kind: "edit"`, built by the previous mission: read `docs/editing/FINAL_REPORT.md`).
Add a third: **math films** (`kind: "math"`), animated with Manim (Python, Manim Community Edition),
narrated, rendered in every format and judged by the same loop: look at frames, score, fix, gates, ship.
This is a production system, not a wrapper around `manim render`.

Why. `films/determinant-explained` (a 60 s math film hand-drawn on Canvas) needed 6 recorded review
rounds and the same defects kept returning: labels colliding with each other and leaving the frame at
scene boundaries, a 9:16 that was the 16:9 layout stacked with small type, ghost cross-fades, and every
number checked by eye (the critic re-derived det = 5, -5, 0 and 8 by hand). Read its `review_log.md`,
`notes.json` and `brief.md` first. Those failures are what this engine must make impossible, or at least
mechanically detected.

What Manim gives you: typesetting (`MathTex`/`Tex` through LaTeX, `Text` through Pango, and since 0.21
`Typst`/`MathTypst`), coordinate systems and graphs, `ApplyMatrix`, `TransformMatchingTex`, value
trackers and updaters, camera moves, `next_section`, partial-movie caching. What it does not give, and
therefore what you build: format-aware composition (its default frame is 14.22 x 8 units, landscape
only), collision / overflow / size checks, verification of the mathematics, narration timing, and the
studio's loop (look, review, gates, GUI, pi tools). Those five are the product.

One engine, three front doors, all required:
1. the CLI (`./studio ...`)
2. pi: `math_*` tools plus a `math-video` skill, so one sentence works
3. the Studio GUI: scenes, script, checks and notes for a math film

Requests the finished system must handle (your acceptance examples):
- "Explain eigenvectors in 90 seconds, narrated, 16:9 and 9:16."
- "A 60-second visual proof that the sum of the first n odd numbers is n squared."
- "Derive the quadratic formula step by step, vertical, with captions."
- "Show the derivative as the slope of the tangent, with a live slope readout on the graph."
- "Explain Bayes' theorem with a medical-test example using natural frequencies."
- "Here is my script.md: animate it." / "Here is my own recorded narration.wav and script: animate it."
- "Redo films/determinant-explained in Manim: same story, no collisions, a real vertical layout."
- "Put a Persian title and Persian captions on it." (right-to-left on-screen text)

Golden path (the `starter` check automates it, the `review` check judges it): `./studio new demo --math`
-> write `script.md` (narration with bookmarks) -> `./studio voice demo` -> write scenes with the kit ->
`./studio render demo --draft` -> `./studio look demo` -> review rounds -> `./studio gate demo` ->
`./studio ship demo`: 16:9 and 9:16 MP4s with narration, optional captions, every mathematical claim
verified by code, layout lint clean, loudness right.

## 0. Operating contract (re-read after every compaction or restart; this file is `templates/prompts/math-video-engine.md`)

1. You own this mission until section 7 is satisfied. Nobody answers questions while you work: decide,
   log it in `docs/math/DECISIONS.md` (format as in `docs/editing/DECISIONS.md`), continue. The only
   valid early stop is the hard-block rule in section 11, and even then you finish everything that does
   not depend on it. Intake questions via `ask_user_question` belong in the skill, for human use. They
   do not belong in this build.
2. Done means all of: `./studio verify-math` exits 0 and writes `docs/math/verify-last.json` with
   `"pass": true`; every box in `docs/math/PROGRESS.md` is ticked; the three demo films were reviewed by
   the `math-critic` subagent with every score 8+ and `correctness` 10; `docs/math/FINAL_REPORT.md`
   exists; and the full `./studio verify-edit` still passes at the end (run it once from the final tree,
   in the background, it takes about an hour). Not "the core works", not "what remains is polish":
   polish is the product, the user judges the exported video.
3. Never end a turn with a plan, a status update, a list of next steps, an offer ("let me know"), or
   "good stopping point". If you notice yourself writing one, open PROGRESS.md and start the next
   unchecked item. Status lines are fine only when the same message continues with a tool call. Do not
   stop because the task is big, because you have worked for hours, or because context is long: context
   is compacted, that is normal.
4. Memory lives on disk: `docs/math/PROGRESS.md` (checklist, a `Now:` and a `Next:` line),
   `DECISIONS.md`, `git log`. After any restart or compaction read those first and continue from the first
   unchecked item. Never restart from scratch, never redo a finished phase. A supervisor script may
   relaunch you whenever you stop before verify passes, so keep PROGRESS.md current at all times: then a
   relaunch costs nothing, and stopping early gains nothing.
5. Be honest. Never fake or weaken a check: no hard-coded outputs, no skipped required checks, no lowered
   threshold without measured evidence and a DECISIONS entry. A feature that fails on a real video is not
   done. A mathematical error in a shipped video is a failed mission whatever the scores say.
6. Any command that may run longer than ~90 s (installs, model downloads, long renders, the full verify)
   runs in the background with a log (`mkdir -p ~/.cache/pi-motion-studio/logs` once, then
   `nohup ... > ~/.cache/pi-motion-studio/logs/<name>.log 2>&1 &`) and you poll the log. Never block a
   tool call on it.
7. Dogfood. From phase 2 on, drive new capability through the CLI and pi tools the user will use. Every
   capability ships as CLI command + pi tool + a paragraph in the skill + a verify check, in the same
   phase. Do not leave integration for the end.
8. Subagents are allowed. Freeze interfaces in docs first, one owner per file, you own integration and the
   verifier. Fresh-eyes reviews must come from a subagent that did not build the thing.
9. Hygiene. Scratch work lives in `~/.cache/pi-motion-studio/scratch/`, never under `films/`. The only
   temporary films you create are `films/verify-m-*` and they are removed when the run ends, also on
   failure. The previous mission left about 5 GB of `verify-*` temp films behind: do not repeat that.

## 1. What exists (do not rediscover it; read the code before changing it)

| Path | What it is | What it means for you |
|---|---|---|
| `engine/cli.mjs`, `engine/edit-cli.mjs` | `./studio <cmd>`; unknown commands exit 2; `kind: "edit"` dispatch (`new --edit`, `render`, `look`, `sound`) | mirror the pattern: `new --math`, a `math-cli.mjs`; keep `studio help` complete (verify-edit's `docs` check fails on a command the help does not list) |
| `engine/render.mjs`, `engine/stills.mjs`, `engine/gates.mjs`, `engine/audio.mjs` | Chromium-frames pipeline with a segment cache; contact sheets from `seek(t)`; gates; synth music + SFX + `mix()` (two-pass loudnorm, `film.json` `mix.lufs` honored) | math films have no `index.html` and no `seek(t)`: dispatch on `kind` early, keep the output names `out/draft-<fmt>.mp4`, `out/final-<fmt>.mp4`, `out/sheets/*.png`, `gates.json`, `reviews.json` so the GUI, `ship` and `list` keep working |
| `engine/doctor.mjs` | probes with `pythonFor(kind)`, `CACHE=~/.cache/pi-motion-studio`, `DATA=~/.local/share/pi-motion-studio`, models in `DATA/models` | add Manim, typesetting, voice and fonts probes; add `STUDIO_MANIM_PYTHON` |
| `engine/transcribe.mjs`, `engine/asr.py` | local word-level faster-whisper (ML venv, `small` cached), refined against the audio | reuse for narration alignment and for "bring your own voice" |
| `engine/speechgen.py` | deterministic Piper TTS (noise scales 0) with a truth file | the seed of the voice layer |
| `engine/captions-export.mjs`, `engine/lib/captions.js` | SRT/VTT export, caption layout (RTL, safe areas, >= 3.2u) | reuse the rules for narration captions |
| `engine/verify-edit.mjs`, `engine/verify/*.mjs` | the runner and 34 checks of the first mission (D-003: a partial run, `--only` or `--quick`, can never pass or be mistaken for done; D-004: a check is `engine/verify/<id>.mjs` with `default async (ctx) => { pass, measured, skip? }`, the runner owns the table of ids) | build `verify-math` with the same conventions; never change what `verify-edit` does or prints |
| `studio-gui/server.mjs`, `public/app.js`, `public/edit.js` | loopback server, `x-studio-token` on POST, SSE, `JOBS` -> CLI, notes API; `summary()` flags edit films and `app.js` mounts `edit.js` for them | add `public/math.js` the same way (a `math` flag in `summary()`); the 7-key `RUBRIC` chart is hard-coded in `app.js` and `review.mjs` |
| `.pi/extensions/motion-tools/` | `tools.ts` (`film_*`), `edit-tools.ts` (`edit_*`), `index.ts` with `BY_FILE` (file -> tool names, drives subagent registration) | add `math-tools.ts` and a `BY_FILE` entry |
| `.pi/skills/*`, `.pi/agents/*` | motion-reel, motion-director, video-edit; motion-critic, motion-animator, edit-critic | add skill `math-video` and agents `math-critic` (and `math-animator` if you parallelize scenes) |
| `films/determinant-explained/` | the Canvas math film, its brief, 6 review rounds, the user's two pinned notes | demo 1 is its migration; its failures are your requirements |
| `docs/editing/` | the first mission's progress, decisions, ADRs, report | style to mirror in `docs/math/`; do not edit it (`verify-edit` reads `docs/editing/THIRD_PARTY.md`, AGENTS.md `## Real footage` and README `## Real footage`) |

Gotchas: `review.mjs` `addReview` requires the 7 rubric keys but accepts extra keys and takes the minimum
over all of them (so extra keys count toward a pass; the GUI chart shows only the 7). The Canvas gates
(`lint`, `determinism`, `novelty`, `loop seam`...) do not apply to a math film: replace them for
`kind: "math"`, never silently pass them. The real-footage work (37 commits) lives on
`feat/real-video-editing` and is not merged into `main`.

## 2. Environment (probed 2026-10-03; verify, don't assume)

- WSL2 Ubuntu 26.04. Repo `/mnt/c/Users/Hp/Desktop/pi-motion-studio` (NTFS over 9p: big sequential files
  are fine, thousands of small files are slow). Small-file caches, venvs and sysroots go on the WSL
  filesystem (`~/.cache/pi-motion-studio/`, `~/.local/share/pi-motion-studio/`), never in the repo.
- Node v22.23 (on PATH in login shells: `bash -lic`). ffmpeg/ffprobe 8.0.1 (libx264, libx265, libvpx,
  libopus, libass, freetype, zimg; filters incl. loudnorm, ebur128, sidechaincompress, blackdetect,
  freezedetect, psnr, ssim, tile). 12 logical CPUs, ~6.6 GB RAM: no process above 2.5 GB RSS, at most 4
  scene renders in parallel. No OCR (no tesseract): check text by geometry, not by reading pixels.
- Python: system 3.14.4 (do not use it for Manim). `uv` 0.12.21 at
  `~/.local/share/pi-motion-studio/uv-bootstrap/bin/uv`. The ML venv `~/.local/share/pi-motion-studio/ml-venv`
  (Python 3.12.14) holds faster-whisper 1.2.1 (`small` cached), piper-tts 1.8.0, onnxruntime, opencv, numpy
  2.5, scipy, soundfile, av; Piper voices in `~/.local/share/pi-motion-studio/models/piper/`:
  `en_US-ljspeech-medium`, `en_GB-northern_english_male-medium`, `fa_IR-amir-medium`. No sympy, no Manim.
  Create a separate `manim-venv` (Python 3.12, `uv venv --python 3.12`) for Manim and call voice/ASR in the
  ML venv as subprocesses. Several Manim dependencies and `kokoro-onnx` have no Python 3.14 wheels.
- Manim Community Edition 0.21.0 is current on PyPI (released 2026-08-10, Python >= 3.11, numpy >= 2.1,
  av >= 15). Extra `manim[typst]` adds `Typst` and `MathTypst` mobjects that compile Typst markup and math
  to SVG with no TeX installed (the `typst` 0.15 wheel is abi3 manylinux). Typst math syntax differs from
  LaTeX (`sum_(k=1)^n k = (n(n+1))/2`). Manim's API drifts between versions: trust the installed source
  and docs (docs.manim.community) over memory.
- **`pip install manim` fails on this machine as it is.** `pycairo` and `manimpango` publish no Linux
  wheels (sdist only; ManimPango's pyproject asks for setuptools + Cython<3, verify how it locates pango).
  Missing: `pkg-config`, the cairo/pango dev headers, cmake/meson/ninja (pip has them), and all of LaTeX
  (`latex`, `dvisvgm`, `kpsewhich`). Present: gcc, g++, make, the runtime libs `libcairo2`,
  `libpango-1.0-0`, `libpangocairo-1.0-0`. There is no passwordless sudo. apt's package lists are present and
  `archive.ubuntu.com` is reachable; `apt-get download` needs no root. At probe time the dependency
  closure of `libcairo2-dev libpango1.0-dev pkgconf` was 173 packages, 84 of them not installed.
- Fonts: fontconfig sees DejaVu, Lato, Liberation, Ubuntu and Vazirmatn. The studio's bundled TTFs in
  `engine/fonts/` are not visible to Pango until you register them (Manim's `register_font` or a
  fontconfig user directory: verify what works headless).
- The human may have installed system packages before launching. Check first:
  `pkg-config --exists cairo pangocairo && command -v latex dvisvgm`. If they exist, skip the rootless
  routes of S1 and note it in DECISIONS.

## 3. Hard constraints

1. **No regressions.** `studio regress` still passes (the four motion films) and the cheap edit checks
   (`./studio verify-edit --only env,edit-ops,gui-security,tools,docs`) stay green throughout; the full
   `verify-edit` passes at the end. Motion and edit films pay nothing for math features.
2. **Determinism.** Same sources + same seeds = identical frames. Seed every random draw
   (`numpy.random.seed`), no wall clock, no network, no environment reads in scene code. The runner sets
   `PYTHONHASHSEED=0`, a fixed locale and `SOURCE_DATE_EPOCH`.
3. **The mathematics is verified by code.** Every mathematical statement a video shows or says is a
   registered claim evaluated exactly (sympy) at render time; numbers on screen come from computation, never
   from typing. A failing claim fails the gate. The critic re-derives every claim independently.
4. **Layout is measured, not hoped for.** The engine measures every text and math object at every animation
   boundary (bounding box, safe area, overlap, size, contrast) and reports violations with a timecode.
5. **Narration is data.** Timing lives in `timing.json` (sentences, words, bookmarks), never hard-coded in a
   scene. Scenes adapt to the voice, never the other way round. Picture and sound stay within 1 frame
   at any point of a 10-minute film.
6. **Local-first and private.** Voice, alignment and typesetting run locally by default. Cloud voices are
   opt-in through `.env` key names (for example `ELEVENLABS_API_KEY`) and are never used by a gate or a
   check. No script, narration or render leaves the machine otherwise. No account, no paid service.
7. **Sources and derived files.** Sources of truth: `script.md`, the scene files, `design.json`, `film.json`,
   `lexicon.json`. Derived (never hand-edited): `sentences.json`, `timing.json`, `claims.json`, `layout.json`,
   `trace.json`, renders.
8. **Idempotent and cached.** Scene renders are keyed by scene source + kit source + design + format + its
   timing slice + Manim version + fonts; voice by text + voice + parameters. Changing one sentence
   re-voices one sentence and re-renders only the scenes whose timing changed.
9. **Safe for this machine and for the server.** Scene code is Python written by an agent: it runs only in a
   subprocess of the runner, with a timeout, `cwd` in scratch and `PYTHONDONTWRITEBYTECODE=1`, never inside
   the GUI server. The GUI stays loopback-only, token on POST, `safePath` for everything served; new
   endpoints validate ids and paths (no traversal, absolute paths or dotfiles) and never run scene code
   outside the job runner.
10. **House style.** Node: ES modules, no build step, no GUI framework. Python: small modules, short
    docstrings, no framework beyond Manim, sympy and what a spike justifies. Pin versions in
    `engine/manim/requirements.lock`. A new npm dependency needs a DECISIONS entry (default: none).
11. **Language-agnostic.** Narration language is per film (`film.json` `lang`, default `en`). On-screen text
    in Persian, Arabic or Hebrew shapes and aligns correctly (RTL, mixed with LTR math). A Persian Piper voice
    exists; ASR language detection exists.
12. **Git.** The current checkout is `feat/real-video-editing` (not merged): create `feat/math-videos` from it.
    Commit locally at every green milestone and at least hourly (`math: <what> [checks: a,b]`). Never push,
    never rewrite history, never `git clean` or `reset --hard`, never merge into `main`. Do not touch `.env`,
    `.git`, pi/bridge config, or the content of existing films (`demo-cut`, `demo-edit`, `studio-reel`,
    `det-film`, `determinant-*`).
13. **Downloads.** Allowed: pip/uv/npm packages; `apt-get download` of Ubuntu archive packages extracted
    into a user-space sysroot (apt verifies signatures; nothing is installed system-wide); open-licensed
    voices, models and fonts. Record URL + license + sha256 in `docs/math/THIRD_PARTY.md`. Not allowed:
    `curl | bash`, anything that needs an account. One exception, only after the pip/apt routes failed
    twice and with a DECISIONS entry: an official release tarball of TinyTeX or micromamba, sha256 recorded.

## 4. Architecture: decide with evidence, defaults given

**M1 The film kind.** `film.json` `kind: "math"`. A math film is a folder `films/<key>/` with `film.json`
(`kind`, `title`, `fps` an integer, default 60, draft capped at 30 like the Canvas renderer; NTSC rationals
are out of scope for math films; `formats` default `16:9,9:16`, `lang`, `voice`, `captions: auto|on|off` (auto
= on in 9:16), `mix` with `lufs` defaulting to **-16** (narration-first; the user asked for the last math film
quieter, it ended at -17), `music: none|synth|track`), `design.json`, `brief.md`, `script.md`, `lexicon.json`,
`scenes/*.py`, and derived files plus `out/`. `./studio new <key> --math [--formats ...] [--lang en]
[--voice piper:en_US-ljspeech-medium]` copies a complete, working starter from `templates/math/` (script, three
scenes, design, lexicon). The starter is exercised by the `starter` check, so it can never rot.

**M2 The Python package `studio_manim`** (in `engine/manim/`; the runner puts it on `PYTHONPATH`).
- `StudioScene`: reads the film (design, format, timing) from the runner, sets Manim's pixel and frame size
  per format, registers fonts, paints the background, exposes the layout `L` (below), the narration API,
  sections, and a recorder.
- Layout `L`, the analogue of the Canvas engine's `L`: `L.u` (1% of the short side, in Manim units), `L.safe`
  (same fractions as `engine/lib/runtime.js`: portrait x 7%, y 10%, w 86%, h 72%; others x 6%, y 8%, w 88%,
  h 84%), `L.title`, `L.stage`, `L.caption`, `L.panel(i, n)`, `L.portrait`. Scenes are written against
  `L`, never against absolute coordinates, so 9:16 is a re-composition (stage and panels stack), not a scaled
  copy. Fix one convention for the frame size per format and document it.
- Typesetting API behind one name (`Eq`, `Txt`, `num()`), independent of the backend (S2): named parts for
  coloring and `TransformMatchingTex`-style morphs, color roles from `design.json` (`math.roles`, for example
  basis vectors, determinant area, positive, negative: one color per concept, never reused), fonts from the
  design system.
- Recorder: at every animation boundary writes `layout.json` (every text/math/figure object: id, bbox, size,
  color, z, alive), `trace.json` (time -> scene, sentence, animation, `file:line`) and `timeline.json` (what
  played when). The lint, `where`, sync and the GUI read these.
- Lint (`lint.py`): rules `offscreen` (outside the frame or the safe area), `overlap` (text over text, text over
  figure, unless allowed), `size` (nominal font size >= 3.2u; roles `tick` and `legend` >= 2.6u),
  `contrast` (>= 4.5:1 against what is behind), `density` (more than 4 text/math objects alive: warn).
  Violations carry a timecode, object ids and the source line.
- Label placement solver: given an anchor and candidate positions, place labels so they overlap nothing and
  stay near their anchor (the vector tags and area labels that collided in the Canvas film).
- Claims (`claims.py`): `claim("det(Matrix([[3,1],[1,2]])) == 5", about="area scale", says="s02.1")` evaluated
  with sympy in a restricted namespace; exact, symbolic or numeric with tolerance; written to `claims.json`;
  strict mode raises, draft mode records and continues. Unparseable is an error, never a pass. Sentences of
  the script that contain digits or equality words are flagged "mathematical" and must be linked to a claim
  (coverage is reported).
- Kit components (the surface fits on one page of `kit.md`): `Matrix` (addressable entries, brackets,
  determinant bars), `PlaneLab` (plane + basis vectors + apply a matrix + unit square/parallelogram + signed
  area), `GraphLab` (axes, plots, tangent and secant, live slope readout, Riemann sums), `EqSteps` (a
  derivation: each step morphs from the last, the changed part highlighted, aligned on `=`), `Callout`
  (brace/box + label with the solver), number lines and sequences, geometry and dissection helpers for visual
  proofs, chapter and recap cards, narration captions. Transitions are designed (morph, directional exit,
  collapse into the next object), never a ghost cross-fade. You own the API; name things as Manim does.

**M3 Narration pipeline.** `script.md` -> `sentences.json` (stable ids, text, spoken text, bookmarks, scene) ->
voice (provider interface: local Piper by default, Kokoro or another local voice if S3 shows it is clearly
better; optional cloud via `.env`; or the human's own `narration.wav` aligned to the sentences with the
existing ASR) -> `timing.json` (per sentence start/end exact to the sample, words, bookmarks). Pronunciation:
`lexicon.json` respellings plus a small math-to-speech normalizer (`x^2` -> "x squared"); a script lint flags raw
symbols a voice would mangle. The word-timing source is decided in S3 (TTS-native alignments if the voice
exposes them, else ASR on the sentence audio, else proportional by characters, flagged). Scene API sketch,
which you may change:
```markdown
# scene s02_meaning: What the determinant measures
[s02.1] A matrix moves every point of the plane. Watch the unit square {shows}as the matrix acts{applies} on it.
[s02.2] The new area is five times the old one.
```
```python
from studio_manim import *            # StudioScene, Eq, Matrix, PlaneLab, GraphLab, claim, num ...

class Meaning(StudioScene):
    scene_id = "s02_meaning"          # scenes play in the order of script.md
    def construct(self):
        L = self.L
        A = Matrix([[3, 1], [1, 2]], role="A").into(L.panel(0, 2))
        lab = PlaneLab(L.panel(1, 2), matrix=A)
        with self.say("s02.1"):                       # waits for the narration, pads if animations are short
            self.play(Write(A), run_time=self.until("shows"))
            self.at("applies"); self.play(lab.apply())
        with self.say("s02.2"):
            claim("det(Matrix([[3, 1], [1, 2]])) == 5", says="s02.2")
            self.play(lab.show_area(num(A.det())))    # 5 comes from the matrix, not from a keyboard
```

**M4 Render pipeline** (`engine/math.mjs`, Node orchestrator). Per format, scene renders run in parallel
processes (at most 4), each producing a silent partial MP4 plus `layout.json`, `trace.json`, `timeline.json`;
cached per hard constraint 8; concatenated losslessly. Audio is built by `studio sound` (which learns the math
kind) from `timing.json`: the narration bus at exact offsets, an optional music bed ducked under it, then the
existing two-pass loudnorm to `mix.lufs`; muxed as AAC with explicit bt709 tags, `yuv420p`, faststart into
`out/draft-<fmt>.mp4` and `out/final-<fmt>.mp4`. Quality: draft = half resolution, frame rate capped at 30;
final = 1080p class at `film.json` `fps`. Also: `render --scene <id>`, `--from-sentence <id>` (skip ahead:
Manim can start at a given animation), and a `check` run that executes scenes without writing video (lint +
claims + typesetting in a fraction of a render; verify the flag Manim offers, for example `--dry_run`). Manim
writes a `media/` tree: point it at scratch, never the repo root. A hung scene is killed at its budget with
the last animation named.

**M5 Looking and locating.** `./studio look <film> --mode every|sentences|bookmarks|sections|phone|strip|times`
extracts frames from the draft (re-rendering it when stale) into a labelled contact sheet: time, scene,
sentence id and the narration text. `./studio where <film> <t>` answers scene, sentence, animation and
`file:line` for any timecode: a note pinned at 49.27 s must lead straight to the code.

**M6 Gates** (`studio gate` on a math film, written to `gates.json`; FAIL blocks `ship`): `layout` (any lint
violation of rule offscreen, overlap, size or contrast), `claims` (any failed claim, coverage reported),
`typeset` (any compile error), `narration` (every spoken sentence has audio, no overlap, scene runtimes cover
their narration), `sync` (bookmarked animations vs `timing.json`), `pace` (a frame static longer than
`gates.maxStill` while the narration is silent: warn), `captions`, `loudness` (`mix.lufs` +/- 1, true peak <=
-1 dBTP), `deliverable` (WxH, fps, yuv420p, bt709, AAC 48 kHz, faststart, duration), `deterministic` (two draft
renders of the shortest scene hash identically). `ship` also writes `out/claims.md`, a human-readable list of
every verified claim.

**M7 GUI** (`public/math.js`, mounted like `edit.js`): the Rendered video with a format toggle; a timeline of
scenes and sentence ticks with lint issues, claim failures and notes as markers; tabs Script (sentences, click
to seek, edit a sentence and re-voice it), Scenes (status, last render, errors with `file:line`), Checks (lint,
claims, gates), Notes (the existing flow, resolved through `where`), Run (voice, check, draft, render, gate,
ship); live refresh over SSE; the Live view is hidden for math films; the review chart shows the two extra
rubric keys for math films.

**CLI surface (suggested; keep `studio help` coherent with the existing style, one verb then the film key).**
`new <key> --math`, `script <film>` (parse + lint), `voice <film> [--sentence id] [--audio narration.wav]`,
`check <film> [--scene id] [--independent]`, `scene <film> <id> [--draft|--final] [--fmt 9:16]`,
`where <film> <t>`, then the existing `look`, `render`, `sound`, `gate`, `review`, `ship`, `cache`,
`doctor`, plus `verify-math`. Each has a `math_*` tool in M8.

**M8 pi surface.** Tools in `math-tools.ts`: `math_status`, `math_script` (parse and lint), `math_voice`,
`math_scene` (check or draft one scene and return its contact sheet), `math_look`, `math_check` (lint + claims
+ typesetting, with `--independent`: each claim re-evaluated in a fresh sympy process from its text alone),
`math_render`, `math_gate`, `math_where`; reviews keep using `film_review`. Skill `.pi/skills/math-video/`
(`SKILL.md`: a fixed order like the other skills' and a "The loop (never skip)" section, which is section 8
here: `film_status` -> `math_check` -> `math_scene`/`math_look` -> `film_review` -> fix the 3 worst -> look
again, 3 rounds minimum, the last by `math-critic`; pipeline and intake for a human request; `craft.md`
section 9; `kit.md` the API with runnable examples; `manim-notes.md` the pitfalls you hit). Agent `.pi/agents/math-critic.md` (read-only, fresh eyes;
tools `read, math_status, math_look, math_check, film_review`).

**Spikes** (time-box ~45 min each, each ends in `docs/math/ADR-00N-*.md`):
- S1 Toolchain. Manim 0.21 importable and rendering headless in `manim-venv` without sudo. Routes in order:
  (0) the human already installed the system packages; (1) a rootless sysroot: `apt-get download` the closure
  of `libcairo2-dev libpango1.0-dev pkgconf`, `dpkg-deb -x` each into
  `~/.local/share/pi-motion-studio/sysroot`, then build `pycairo` and `manimpango` from sdist with
  `PKG_CONFIG_SYSROOT_DIR`, `PKG_CONFIG_PATH`, `CPATH`, `LIBRARY_PATH`, `LD_LIBRARY_PATH` pointing there and
  `Cython<3`, `meson`, `ninja` from PyPI in the build environment; build the wheels once and keep them in
  `~/.cache/pi-motion-studio/wheels`, install with `--no-index --find-links` so no rebuild is ever needed;
  (2) the exception in constraint 13. Acceptance: a probe scene (`Text`, a formula, a `NumberPlane`, one
  animation) renders to MP4 from the CLI, and `studio doctor` reports it.
- S2 Typesetting. Which backend is the default: LaTeX (only if a user-space TeX installs cleanly, for example a
  TinyTeX tarball plus a lean `TexTemplate` of amsmath/amssymb/xcolor; Manim's default template pulls many
  extra packages) or Typst (`manim[typst]`, no TeX). Test with 40 formulas written the way an agent will write
  them (fractions, radicals, matrices, aligned lines, cases, big operators, integrals, vectors, `\text`, a
  Persian sentence): failure rate, compile time (cached), named-part selection and coloring, font control, RTL,
  deterministic SVG. Agents write LaTeX far more reliably than Typst: before settling for Typst-only
  authoring, evaluate a LaTeX-to-Typst converter (for example the `tex2typst` npm package: check it exists,
  its license and its quality). Decide and record.
- S3 Voice. Piper (installed) against Kokoro (`kokoro-onnx`, Python < 3.14, a model download) or another local
  voice: intelligibility on math narration (numbers, symbols, terms), naturalness, speed, determinism, the
  word-timing source, the Persian voice. Pick the default per language.
- S4 Render. A representative 30 s scene in all four formats: wall time, parallelism, Manim's partial-movie
  cache behaviour, PyAV encoder settings (bt709 tags, crf), how to get exact A/V alignment (frame-quantized
  scene durations vs sample-exact audio), the cost of a check run. Calibrate the `perf-budget` numbers and
  freeze them.

## 5. Build order

Strict up to P2, the first vertical slice. After that phases may overlap, and P10 may run in parallel through
a subagent once the HTTP API is frozen in docs.

**P0 Orientation (no features yet).** Read AGENTS.md, README.md, `docs/editing/{FINAL_REPORT,DECISIONS}.md`,
`engine/{cli,edit-cli,stills,gates,audio,doctor,verify-edit}.mjs`, `studio-gui/`, `.pi/`, and the whole of
`films/determinant-explained/` (brief, review log, notes, `index.html`). `git switch -c feat/math-videos`. Run
`./studio verify-edit --clean` (removes only `verify-*` temp films and the verify cache). Record the baseline
(`./studio regress`). Create `docs/math/PROGRESS.md` (every phase and every check of section 7 as a box, a
`Now:` and a `Next:` line) and `DECISIONS.md`. Write `engine/verify-math.mjs` and
`./studio verify-math [--quick] [--list] [--only <id>] [--clean]` with every check present and red, same
conventions as verify-edit (checks in `engine/verify/math/<id>.mjs`, a `slow` flag, a lock, temp films
`films/verify-m-*`, results file only from a full run). Check: `regress` (and it stays green for the whole
mission). Commit.

**P1 Spikes S1-S4 + `studio doctor` additions.** ADRs. If S1 fails the human may need to run one command: see
section 11. Check: `env`.

**P2 Kit core + the first vertical slice.** `new --math`, `templates/math/`, `StudioScene`, layout `L`, theme
from `design.json` (ship two: `paper`, the light palette of the determinant film, and `chalk`, a dark one),
fonts, typesetting API, the recorder, `studio render` and `look` for math films. Milestone: the starter film
renders in 16:9 and 9:16 and you look at its sheet. Checks: `typeset`, `render-determinism`, `formats`, `look`.
Commit and tag `slice-1`.

**P3 Layout lint + label solver.** Fixtures with seeded violations. Check: `layout-lint`.

**P4 Claims.** Ledger, restricted sympy namespace, coverage, `math_check --independent`. Check: `claims`.

**P5 Script, voice, timing, sync, where.** Parser, TTS providers, lexicon, normalizer, `timing.json`, the
narration API (`say`, `at`, `until`), the audio bus, `where`, bring-your-own-narration alignment. Checks:
`script`, `voice`, `sync`, `where`.

**P6 Render pipeline.** Scene cache, parallelism, concat, mux, loudness, loud errors, `ship`. Checks:
`scene-cache`, `concat-mux`, `errors`, `perf-budget`.

**P7 Kit library + captions.** The components with runnable docs, narration captions, SRT/VTT. Checks:
`library`, `captions`.

**P8 Gates + review plumbing.** Math gates, the extra rubric keys, `ship` outputs. Check: `gates`.

**P9 pi surface.** Tools, skill, craft docs, critic agent, AGENTS.md `## Math videos` (add it; keep `## Real
footage`), README, `studio help`. Checks: `tools`, `docs`, `starter`.

**P10 GUI.** The M7 list. Checks: `gui-smoke`, `gui-security`.

**P11 Hardening.** Failure matrix: a scene syntax error, a name error, a backend compile error, a missing voice
model, a hung scene, an empty scene, 100 scenes, a 10-minute narration, RTL text, a language switch, an image or
SVG asset with a Windows path or spaces, a human-supplied `narration.wav`. Failures are loud and actionable:
`file:line`, the formula, the fix. `studio cache gc` knows the math caches. Checks: `hygiene` (and the
failure cases of `errors`).

**P12 Demos + review + final runs.** Three narrated demo films, each 45-120 s, 16:9 and 9:16, built and
reviewed with the real pipeline: (1) `determinant`: the migration of the Canvas film (must-haves from its
brief: geometric meaning, the 2x2 formula with the worked example [3 1; 1 2] = 5, sign = flipped space (-5),
zero = squashed flat, 3x3 cofactor expansion of [2 1 0; 1 3 1; 0 1 2] = 8, recap); (2) `tangent`: the
derivative as the slope of the tangent on f(x) = x^2 (secant to tangent, live slope readout, the power rule for
n = 2 and 3); (3) `odd-squares`: the visual proof that 1 + 3 + ... + (2n-1) = n^2 with L-shaped gnomons and
the algebraic close. At least 15 claims each, 90% of the mathematical sentences linked to a claim, lint clean,
at least 3 review rounds each, the last by `math-critic`. Then a full `./studio verify-math` from a cold
cache, the full `./studio verify-edit` in the background, then `FINAL_REPORT.md`. Checks: `demos`, `review`.

## 6. The verifier is the contract

`./studio verify-math` prints one row per check with its measured numbers (not just a tick), writes
`docs/math/verify-last.json` (`{ at, gitHead, required, passed, failed[], skipped[], pass }`; `"pass": true`
only from a full run) and exits 0 only if every required check passed. Rules: fixtures are deterministic, checksummed and cached
outside git; it runs its own GUI on a spare port (`STUDIO_PORT`) with temporary films `films/verify-m-*`;
`--quick` (target <= 5 min) skips `slow` checks and can never pass; the full run targets <= 60 min (it runs in
the background). A check may be `skipped` only for an environment cause and every skip is listed in the final
report. Thresholds below are minimums: raise them if you can; lower one only with measured evidence and a
DECISIONS entry. `perf-budget` numbers are first guesses: calibrate in S4, then freeze.

## 7. Definition of Done: the checks

| id | pass when |
|---|---|
| `env` | `studio doctor` resolves Manim (importable, version pinned), cairo/pango, a typesetting backend that compiles a probe formula to SVG, ffmpeg, a TTS voice that speaks, ASR, sympy, and the bundled fonts as seen by Pango; prints versions |
| `regress` | `studio regress` passes and `verify-edit --only env,edit-ops,gui-security,tools,docs` passes |
| `typeset` | 40 formulas (fractions, radicals, matrices, aligned lines, cases, big operators, integrals, vectors, `\text`, colored parts) compile in the default backend; the SVG is non-empty with a plausible bbox; the same input gives the same SVG hash; named parts select and color; a Persian sentence shapes right-to-left with every codepoint in the font's cmap; a deliberately broken formula fails with the backend's message, the formula and the scene `file:line` |
| `render-determinism` | a fixture scene rendered twice from a cold cache in 2 formats gives identical decoded-frame md5 (`-f framemd5`); 1 worker equals 3 workers (if the encoder cannot be made deterministic: evidence in DECISIONS and PSNR >= 60 dB per frame) |
| `formats` | one scene source in 16:9, 9:16, 1:1, 4:5: exact WxH, yuv420p, bt709 tags, fps, SAR 1:1, faststart, duration; lint clean in all four; text >= 3.2u; the vertical layout is a re-composition (panels stacked, positions differ by the layout rule), not a scaled copy |
| `layout-lint` | on 12 fixture scenes with seeded violations (off-frame at t, text over text, tiny text, low contrast, overflow only in one format, 6 objects alive) the lint reports each with the right object ids and time (+/- 1 frame), and gives 0 false positives on 6 clean scenes including legitimate overlaps (axis ticks, brace + label); the solver places 8 crowded labels around a polygon with zero overlaps, each within a set distance of its anchor |
| `claims` | 30 true claims pass (arithmetic, rationals, matrix determinant/inverse/product, derivatives, integrals, limits, identities, inequalities, trig identities); 15 false claims, including subtle sign errors, fail with a message; an unparseable claim is an error; `num()` shows the computed value; a failing claim blocks `ship`; `--independent` agrees with the in-scene result on all 45 |
| `script` | stable sentence ids when other sentences change; bookmarks parse; duplicate or missing ids and unknown scenes are rejected with the line number; `sentences.json` round-trips; the script lint flags raw symbols and mathematical sentences |
| `voice` | the default voice gives byte-identical audio for the same text; `timing.json` sentence offsets equal the concatenated sample offsets (+/- 1 sample); lexicon respellings and the normalizer apply (eigenvector, Euler, Cauchy, det, `x^2`, an integral, a fraction); ASR round trip WER <= 10% on a 120-word math paragraph; sentence loudness within 1.5 LU, peak <= -1 dBFS, no clicks at joins; changing one sentence re-voices only that sentence; works offline; the Persian voice speaks a Persian sentence; a human-supplied `narration.wav` aligns to the sentences |
| `sync` | in a fixture scene with 6 bookmarks every bookmarked animation starts within 1 frame of its bookmark in `timing.json` (recorder) and within 80 ms of the ASR-measured word onset in the rendered video; each scene runs at least as long as its narration; A/V end offset <= 1 frame |
| `where` | for 20 random times `studio where` returns the scene, sentence, animation index and `file:line` that agree with the recorder's trace; a pinned note resolves to the same |
| `look` | every mode (every, sentences, bookmarks, sections, phone, strip, times) works for all formats; frames are labelled with time, scene, sentence id and text; a stale draft is re-rendered first |
| `scene-cache` | an unchanged re-render takes < 10% of the cold time; changing one scene re-renders only it (count asserted); changing one sentence re-voices one sentence and re-renders only the scenes whose timing changed; changing the palette invalidates everything; formats never share partials |
| `concat-mux` | a 12-scene fixture: no black, duplicated or frozen frames at the joins (blackdetect, freezedetect, adjacent-frame hashes); on a 10-minute synthetic film (slow) A/V drift <= 1 frame at the end; loudness `mix.lufs` +/- 1 and true peak <= -1 dBTP; AAC 48 kHz; the music bed is >= 8 dB lower under narration than in the gaps (measured on the isolated bed) |
| `errors` | scene syntax error, name error, backend compile error, missing voice model, a hung scene (killed at its budget, last animation named), an empty scene, an invalid script: each fails loud with `file:line` or the formula and the fix; partial output is never promoted; the CLI and the GUI show the same message; never a bare traceback |
| `library` | every kit component renders in all four formats with zero lint violations and zero failed claims; every ```python run block in `kit.md` executes; each component has a docstring and an example; the public API list is frozen in the docs |
| `captions` | narration captions: layout in en and fa at 4 formats (<= 2 lines, >= 3.2u, safe area, no overlap with lint objects); every codepoint in the font cmap; SRT and VTT are monotonic and equal the sentences |
| `gates` | `studio gate` on a math film runs the math gates and writes `gates.json`; seeded-fault films (overlap, false claim, missing narration, loudness off, a long static hold) each FAIL with the right gate name and timestamp; a clean film passes; the Canvas-only gates are replaced, not silently passed |
| `perf-budget` | calibrated in S4 and frozen; first guesses: draft <= 2x realtime on the demos in 16:9; a one-scene draft re-render <= 20 s; a check run <= 25% of a draft render; peak RSS <= 2.5 GB per process; temp dirs gone afterwards |
| `gui-smoke` | Playwright on a spare port: open a math film; the video plays and the format toggle works; clicking a sentence seeks; editing a sentence and re-voicing updates the status; a seeded error shows with `file:line` in Scenes; Checks lists lint and claims; a pinned note shows its scene and sentence; run a draft; zero console errors, zero failed requests; screenshots saved and looked at |
| `gui-security` | POST without token gives 403; traversal, absolute paths, dotfiles and unknown film ids are rejected on every new endpoint; no endpoint runs scene code outside the job runner or reads a file outside the repo |
| `tools` | every `math_*` tool is registered in `math-tools.ts` with a `Type.Object` schema and listed in `BY_FILE`; each runs against the starter film; skill and agent front matter parse |
| `docs` | `studio help` lists every command; README and AGENTS.md carry `## Math videos`; the skill, `kit.md`, `craft.md` and the critic exist; `docs/math/THIRD_PARTY.md` lists every download (sysroot packages, wheels, voices, models, fonts, TeX if used); ADR-001 to ADR-004 exist |
| `starter` | `studio new` from `templates/math/`, then `voice`, `render`, `gate`, `ship` unattended in 16:9 and 9:16; every gate passes; outputs probe clean |
| `hygiene` | after a full run `films/` holds no `verify-*`, scratch is empty, `git status` shows only intended files, `studio cache` reports sizes and `cache gc` frees the math caches |
| `demos` | the three demo films exist with finals in 16:9 and 9:16, 45-120 s, narrated, gates PASS, lint clean, >= 15 claims each all verified, >= 90% of mathematical sentences linked to a claim, no placeholder text |
| `review` | `reviews.json` of each demo: >= 3 rounds, last by `math-critic`, every score >= 8, `correctness` = 10 with the independent re-derivation recorded in the notes, sheets exist |

## 8. Quality loop on math videos

The pipeline working is not enough; the video has to teach.
- After every visual change: `math_scene` (or `math_check` first, it is cheap), read the sheet, write down what
  you see. The lint must be clean before you judge taste. AGENTS.md's loop applies: `film_status` -> look ->
  review -> fix the 3 worst -> look again, 3 rounds minimum per demo, the last one by `math-critic`.
- Inspect every scene seam: a strip across the boundary. Hunt for ghost dissolves, a stray glyph, an object
  that jumps, a title that arrives before the previous one is gone.
- You cannot listen, so measure: loudness per second, waveform and spectrogram, and an ASR round trip on the
  final mix (it catches mispronounced terms and a voice that rushes a formula).
- Phone test (360 px wide) at 9:16 and 1:1.
- Rubric: the 7 keys with math meanings, plus `correctness` and `clarity`. hook = the first 3 s (a question or
  a striking image, not a title card); readability = text and math legible at 360 px, lint clean; motion =
  animations purposeful, no ghost dissolves, one thing moving at a time unless it is the point; variety = a
  visual change every 2-4 s but pace follows the narration; composition = hierarchy and whitespace in every
  format; brand = `design.json` fidelity and one color per concept throughout; sound = narration clarity,
  pace, pronunciations, bed and level; correctness = every claim true, notation consistent, what is said
  matches what is shown (10 or fail); clarity = one idea per scene, intuition before formalism, no unexplained
  symbol, a recap. Pass = all 8+ and correctness 10. 8 means "I would post this".
- `math-critic` works from the script, `timing.json`, the `sentences` sheets and `math_check --independent`.
  It re-derives every number and formula on screen by hand and records which it re-derived.

## 9. Craft rules (write these into `.pi/skills/math-video/craft.md`)

- Open with a concrete question or image in 3 s; no title card first. One idea per scene. Show before telling;
  introduce notation only after the idea; define every symbol on first use.
- One color per concept, fixed in `design.json` `math.roles`, kept for the whole video. Never reuse a color
  for something else.
- At most 3-4 text or math objects alive at once; clear the old before the new; connect representations with
  morphs (`TransformMatchingTex`, `ReplacementTransform`) instead of cross-fades; exits are directional or a
  collapse into the next object.
- Pace: ~150 words per minute of narration. Reveal an equation as it is introduced (about 1 s), hold >= 1 s after
  it lands; a key result gets a 1.5-2.5 s hold and an emphasis on the narration word. Do not read formulas
  aloud verbatim: say the meaning ("the area scales by five"), put the symbols on screen.
- Numbers come from computation (`num()`, claims). Use small integers for worked examples; show every step
  when the arithmetic is the lesson.
- Graph and plane scenes: label only what the narration mentions, place labels with the solver, 1-2 colors for
  vectors, a dim grid.
- Portrait is a re-composition: one object at a time in the middle third, equations stacked, captions on.
- End with a recap in at most 3 lines, the takeaway sentence and a hold of >= 1.2 s.
- Default music: none or a quiet bed ducked 10-14 dB under narration; never compete with the voice.

## 10. Blockers: what to do instead of stopping

- A dependency will not install: two serious attempts, then the next route (S1 order). A fallback must be real
  and tested, never a stub.
- A voice sounds bad on math: try another local voice, tune `length_scale`, grow the lexicon. Do not ship a
  mispronounced term.
- Typesetting fails on an agent-written formula: fix the formula or the converter, add it to the 40-formula
  battery, never hand-patch an SVG.
- A check looks wrong: fix the check with a DECISIONS entry that shows the evidence. Never delete it.
- Rendering is too slow: profile (Manim animation count, text vs formula compile, encoding, process count)
  before optimizing; use the check run and `--from-sentence` while iterating.
- Tool or context trouble: commit, update PROGRESS.md, continue.

## 11. Hard block (the only reason to stop)

If after the routes of S1 Manim still cannot be imported, write the exact line the human can run once into
`docs/math/NEEDS_USER.md`, for example:
`sudo apt install -y build-essential python3-dev pkg-config libcairo2-dev libpango1.0-dev texlive-latex-extra texlive-fonts-extra texlive-science dvisvgm`
(adapt it to what you measured is missing). Then build everything that does not need Manim first (script,
voice, timing, mixer, gates plumbing, GUI, tools, the verifier), re-check Manim at every phase boundary (the
human may have run the line), and only then report. "I am unsure" is never a block: decide, log, continue.

## 12. Final report (`docs/math/FINAL_REPORT.md`, at most ~50 lines, then stop)

What now exists (CLI, tools, skill, GUI) in a few lines; three copy-paste ways to use it (one pi sentence, one
CLI sequence, one GUI flow); the verify table with every number; where the three demos are; every skip,
fallback and known limitation, honestly (including which route installed Manim and which typesetting backend
won, and why); decisions the human may want to revisit; anything in NEEDS_USER.md; the result of the full
`verify-edit`. After the report, stop: do not start new features.

---

Begin with P0 now.
