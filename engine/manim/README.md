# engine/manim/: the Python side of math films (mission M2)

`studio_manim` is the kit scenes import. Node orchestrates everything else (`engine/math.mjs`, M4):
it shells out to this venv's `manim` CLI per scene, with a generated `film_state.json` the scenes read.

- `__init__.py`          what `from studio_manim import *` gives a scene
- `scene.py`             `StudioScene`: frame geometry per format, fonts, theme, narration API, sections
- `layout.py`            `L`: u/safe/title/stage/panel/portrait (the Canvas engine's L, in Manim units)
- `typeset.py`           `Eq`/`Txt`/`num()` (LaTeX in, MathTypst out, via tex2typst), color roles
- `recorder.py`          layout.json / trace.json / timeline.json at every animation boundary
- `lint.py`              offscreen/overlap/size/contrast/density rules (P3)
- `solver.py`            label placement (P3)
- `claims.py`            the claim() ledger, sympy namespace (P4)
- `kit.py`               Matrix, PlaneLab, GraphLab, EqSteps, Callout… (P7)

Everything is deterministic: no wall clock, no randomness (or seeded), no network. The runner
(node) sets PYTHONHASHSEED=0, a fixed locale, SOURCE_DATE_EPOCH, PYTHONDONTWRITEBYTECODE=1.
