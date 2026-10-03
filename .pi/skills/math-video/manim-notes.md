# manim-notes.md — the pitfalls we hit (so you don't re-hit them)

Every entry cites where it is recorded (`docs/math/DECISIONS.md` D-NNN, `docs/math/ADR-00N`,
or the commit that fixed it). Trust these over your memory of Manim's API; verify the installed
source when in doubt (`~/.local/share/pi-motion-studio/manim-venv`).

## The frame is CENTERED at (0,0) — D-008

Manim's origin is the frame CENTER (x ∈ [-W/2, +W/2], y UP), not a bottom-left corner. The
Canvas engine's convention (0..W × 0..H) produced a first render with everything crammed
top-right, half off-frame. Never compute a box as `x, y, w, h` from the origin — use `L`
(whose boxes carry explicit `left/right/bottom/top`) and `get_corner`/`next_to`. Geometry
fractions are measured from the TOP of the frame (D-015).

## MathTex/Typst mobjects default to WHITE — D-009

On the paper theme, white math is invisible on cream. `Eq` colors with the theme's ink by
default; raw `MathTypst`/`Typst`/`MathTex` mobjects do not — never add one directly. (Same
entry: text-used math roles carry INK-grade colors; fill-grade colors fail contrast at phone
size.)

## `get_bounding_box` is ManimGL-only — measure with `get_corner(DL/UR)` (commit 023d772)

ManimCE has no `get_bounding_box()` the way ManimGL does: calling it raises, the recorder's
bare `except` swallowed it, and every layout frame recorded `objects: []` (found independently
by two workers). The recorder (and any measurement you write) uses
`m.get_corner(DL), m.get_corner(UR)`.

## `TransformMatchingTex` is MathTex-only — ADR-002

It asserts `MathTexPart`/`tex_string`, which `typst_mobject.py` has neither of — on this
studio's Typst backend it cannot work at all. The kit's `EqMorph`/`EqSteps` do the
label-matching morph (`{{labels}}` are explicit — more robust than substring guessing). Never
import `TransformMatchingTex` into a scene.

## Odd draft dimensions SEGFAULT cairo/x264 — the odd 4:5 (ADR-004; engine/math.mjs)

A draft halves the frame: 4:5 is 1080×1350 → 540×675, and an ODD dimension segfaults the
cairo/x264 encode (measured: 540×675 rc=139, 540×676 fine — the Canvas engine hits the same
wall, see `engine/lib/film.mjs`). The runner even-rounds draft dims; if you ever pick a
resolution yourself, keep BOTH sides even.

## Parallel renders race on `media/Tex` — per-scene media dirs + a worker cap — ADR-004

Two manim processes sharing a `media/` tree race on the Pango `Text` SVG cache: one reads an
SVG another is writing → `ParseError: no element found`, and the poisoned entry fails every
later run until `media/Tex` is cleared. The runner gives EVERY scene its own `--media_dir`
under scratch and caps parallelism by measured RSS (finals one at a time on this machine —
4× 1080p60 collapsed the whole WSL system). Never point two renders at one media dir, never
render into the repo root.

## Also bit us, read before you dig

- **D-006**: the typeset label pass once OOM'd the machine — every Python/Manim process now
  runs under `~/.cache/pi-motion-studio/scratch/cap` (1 GB cgroup, D-007). Run ad-hoc python
  through it too.
- **D-013**: ffmpeg 8 ignores the `-color_*` flags; the mux stamps bt709 via
  `setsar=1`+`scale`+`setparams` WITH the 601→709 conversion.
- **D-016/D-019**: a bookmark's `t` is seconds from ITS SENTENCE's start (not film time);
  `say()` validates the sentence belongs to this scene; overruns are recorded, never rewound.
- **D-020**: the scene cache keys on the scene's REBASED timing slice — an edit re-renders
  only the scenes it actually changes.
- Pure-RTL strings render EMPTY in manim's `Text` — `caption()` shapes them with Pango
  `MarkupText` (Vazirmatn).
