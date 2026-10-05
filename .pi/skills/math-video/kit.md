# kit.md — the shortlist (the full API is `engine/manim/kit.md`)

**Do not learn the components from this file.** The frozen public API, with runnable examples
(every block executed by `engine/manim/test/kit-examples.py`), is **`engine/manim/kit.md`** —
read that before writing a scene. This page is only the shortlist: the 10 you will use most,
one line each, so you know what exists.

```python
from studio_manim import *          # StudioScene, L, Eq, Txt, num, claim, math_role …
from studio_manim.kit import *     # the components below + swap, collapse, into
```

| Component | One-line contract |
|---|---|
| `Matrix` | Addressable entries (`entry(i,j)`), path brackets, `det()` exact (sympy), `bars()`, `.into(box)` scales down into an L box. |
| `PlaneLab` | A plane sized FROM its box, basis vectors, `apply(M)` animates the grid, `show_area(num(...))` the signed area, `column_tags()` solver-placed. |
| `GraphLab` | Axes in a box, `plot()`, `secant(x0,x1)`, `tangent(x0)` (the limit slide), `slope_readout()` live, `riemann(n)` computed vs exact. |
| `EqSteps` | A derivation: each step morphs from the last, shared `{{labels}}` morph in place, new parts highlighted, aligned on `=`. |
| `EqMorph` | The `TransformMatchingTex` of this studio: unmatched parts of `a` exit up, unmatched parts of `b` enter (ADR-002). |
| `Callout` | A brace or box around a target with the label solver-placed OFF the target (`kind="brace"|"box"`, `avoid=[...]`). |
| `NumberLineLab` | A number line in a box, label-sized ticks, `sequence(a_n, (n0,n1))` dots + tiered value labels. |
| `gnomon` / `stack_gnomons` / `unit_grid` | The L of 2k-1 cells that grows (k-1)² into k²; nested `1+3+…+(2n-1) = n²`; the light cell grid under them. |
| `chapter` / `recap` / `hold` | The title strip (kicker above, left-aligned); the ≤3-line recap centered in the stage; `hold(scene, s)` waits ≥ 1.2 s. |
| `caption` | The narration caption in the `L.caption` band (≤2 balanced lines, RTL shaped by Pango — manim `Text` renders pure-RTL strings empty). |

Transitions everywhere: `swap(scene, old, new, direction)`, `collapse(old, target)`,
`into(m, box)` — designed exits, never a cross-fade.
