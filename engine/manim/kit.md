# kit.md — the math-film components (`studio_manim.kit`)

```
from studio_manim import *          # StudioScene, L, Eq, Txt, num, claim, math_role …
from studio_manim.kit import *      # the components below
```

**Public API (frozen):** `Matrix`, `PlaneLab`, `GraphLab`, `EqSteps`, `EqMorph`, `Callout`,
`NumberLineLab`, `gnomon`, `stack_gnomons`, `unit_grid`, `chapter`, `recap`, `hold`, `caption`,
`swap`, `collapse`, `into`, `inset`.

**House rules the components enforce.** Colors are `math_role(...)` (design.json `math.roles`; a
missing role raises). Every on-screen number is computed (sympy `det`/`diff`/`integrate`, `num()`).
Components are built INTO an `L` box and only ever scale DOWN; portrait stacks `L.panel`s and grows
type by the theme's multiplier. Labels are placed by the solver (`studio_manim.solver`, late import)
with `next_to` as the fallback — never on the shape they annotate. Transitions are morphs,
directional exits or collapses; never a simultaneous cross-fade. No LaTeX exists here (ADR-002):
brackets, digits and tick labels are paths, `Eq`/`MathTypst` or `Txt`. Composites are RECORDED BY
THEIR PARTS (`_studio_parts`): the lint sees the plane as furniture, the square and curves as
figures, and every text inside a group (matrix entries, tick labels) as text.

Every block below is executed by `engine/manim/test/kit-examples.py` (a fresh namespace per block
with `scene` = a dry-run `StudioScene`). A block may set `SKIP = "reason"` to report a skip.

### Matrix
Addressable entries (`entry(i, j)`), path brackets `[`/`(`/`|`, `det()` exact (sympy, entries kept as
given), `bars()` = the same matrix with determinant bars, `into(box)` scales down into an L box.
```python
from studio_manim import L, math_role
from studio_manim.kit import Matrix
A = Matrix([[3, 1], [1, 2]]).into(L.panel(0, 2))
A.set_column_colors(math_role("basis"), math_role("vector"))
assert A.det() == 5 and A.entry(1, 0).get_center()[1] < A.entry(0, 0).get_center()[1]
D = A.bars()
assert abs(D.get_center() - A.get_center()).max() < 1e-6
import sympy as sp
assert sp.expand(Matrix([["a", "b"], ["c", "d"]]).det() - sp.sympify("a*d - b*c")) == 0
```

### PlaneLab
A plane sized FROM its box (equal units), basis arrows (î basis, ĵ vector), unit square → parallelogram.
`apply(M)` animates the live state (grid clipped to the box, labels exit first); `show_area(num(...))`
and `column_tags()` are placed off the parallelogram; `area_value()` is the exact signed area.
```python
from studio_manim import L, num
from studio_manim.kit import PlaneLab
from manim import Create
lab = PlaneLab(L.panel(1, 2), fit=[[[3, 1], [1, 2]]])
scene.play(Create(lab))
scene.play(lab.apply([[3, 1], [1, 2]]))
area = lab.show_area(num(lab.area_value()))
tags = lab.column_tags()
assert lab.area_value() == 5 and lab.placed_by in ("solver", "next_to")
for m in (area, *tags):  # labels stay in the panel
    assert lab.box.x - 1e-6 <= m.get_left()[0] and m.get_right()[0] <= lab.box.x + lab.box.w + 1e-6
```

### GraphLab
Axes in a box, `plot()` = Create the axes then the curve (the lab introduces itself), `secant(x0, x1)`,
`tangent(x0)` = the secant sliding to the limit (tracker `lab.h`), `slope_readout()` = live Eq +
DecimalNumber from the tracker, `riemann(n)` = rectangles with the computed sum beside the exact
integral. The box's top row holds the readouts.
```python
from studio_manim import L
from studio_manim.kit import GraphLab
lab = GraphLab(L.stage, "x**2/4 + 1", x_range=(0, 4))
scene.play(lab.plot())
line, dots, slide = lab.tangent(2, h0=1.5)
readout = lab.slope_readout()
scene.add(line, dots, readout)
scene.play(slide)
assert abs(lab._slope(2, 0) - 1.0) < 1e-12      # f'(2) from sympy.diff
import sympy as sp
r = lab.riemann(8)                                # left sum, dx = 1/2
assert lab.sum_value == sp.Rational(67, 8) and lab.integral_value == sp.Rational(28, 3)
```

### EqSteps / EqMorph
One-line derivation aligned on a labelled `{{=}}`; shared `{{labels}}` (same LaTeX) morph in place,
new parts arrive highlighted (role positive). `EqMorph(a, b)` alone: unmatched parts of `a` exit up in
the first half, unmatched parts of `b` enter in the second — the scene then holds `b`.
```python
from studio_manim import L, Eq
from studio_manim.kit import EqSteps, EqMorph
steps = EqSteps([r"{{(a+b)^2}} {{=}} (a+b)(a+b)",
                 r"{{(a+b)^2}} {{=}} a^2 + ab + ba + b^2",
                 r"{{(a+b)^2}} {{=}} a^2 + 2ab + b^2"], L.stage)
xs = [e.part(next(n for n, t in e.labels.items() if t.strip() == "=")).get_center()[0] for e in steps.eqs]
assert max(xs) - min(xs) < 1e-6                     # aligned on '='
for anim in steps.steps():
    scene.play(anim)
assert steps.eqs[-1] in scene.mobjects and steps.eqs[0] not in scene.mobjects
a, b = Eq("{{ad}} - {{bc}}"), Eq("{{ad}} - {{bc}} = 5")
assert len(EqMorph(a, b).pairs) == 2
```

### Callout
A brace (label at the brace tip, body-role Txt — an annotation is meant to be read) or a box (label
solver-placed, obstacles = target + box + `avoid`) around a target; the label is never on the target.
`create()` = shape, then label.
```python
from studio_manim import Eq
from studio_manim.kit import Callout
eq = Eq(r"{{ad}} - {{bc}}")
c = Callout(eq.part("p1"), "down diagonal", kind="brace")
b = Callout(eq.part("p2"), "up diagonal", kind="box", role="negative")
scene.add(eq)
scene.play(c.create())
assert c.label.get_top()[1] < eq.get_bottom()[1]       # below, not on, the term
from studio_manim.kit import _overlap, _bbox
assert not _overlap(_bbox(b.label), _bbox(b.shape))
```

### NumberLineLab
A number line in a box, label-sized tick labels (thinned when crowded); `sequence(a_n, (n0, n1))` =
dots at the computed values with value labels tiered above them.
```python
from studio_manim import L
from studio_manim.kit import NumberLineLab
nl = NumberLineLab(L.stage, (0, 1, 0.25))
seq = nl.sequence("1/n", (1, 6))
dots, labels = seq
assert len(dots) == 6 and len(labels) >= 3
assert abs(nl.line.p2n(dots[1].get_center()) - 0.5) < 1e-9
```

### gnomon / stack_gnomons / unit_grid
`gnomon(k)` = the L of 2k−1 cells (arms of k and k−1 cells around the corner) that grows a
(k−1)² square into k²; `stack_gnomons(n, box)` = 1 + 3 + … + (2n−1) = n² nested and centered;
`unit_grid(n, unit)` = a light cell grid to lay under them.
```python
from studio_manim import L
from studio_manim.kit import gnomon, stack_gnomons, unit_grid
assert [gnomon(k).cells for k in (1, 2, 3, 4)] == [1, 3, 5, 7]
g3 = gnomon(3)
assert abs(g3.width - 3) < 1e-6 and abs(g3.height - 3) < 1e-6
S = stack_gnomons(4, L.stage)
assert S.total == 16 and S.width <= L.stage.w and S.height <= L.stage.h
grid = unit_grid(4, S.unit).move_to(S)
```

### chapter / recap / hold
`chapter(title, kicker)` = the title strip in `L.title` (kicker above, left-aligned, `.enter()`);
`recap(lines)` = at most 3 lines (str → body, `"$…$"` → Eq) centered in `L.stage` (`.reveal()`);
`hold(scene, s)` waits at least 1.2 s.
```python
from studio_manim import L
from studio_manim.kit import chapter, recap, hold
ch = chapter("Area scales", kicker="Chapter 2")
assert ch.get_top()[1] <= L.safe.y + L.safe.h + 1e-6 and ch.get_left()[0] >= L.safe.x - 1e-6
scene.play(ch.enter())
rc = recap(["the determinant scales area", r"$\det A = ad - bc$", "zero: space is squashed flat"])
scene.play(rc.reveal())
hold(scene, 1.5)
```

### caption
The narration caption in the `L.caption` band (role caption, ≤ 2 balanced lines, scaled to the band).
RTL text is shaped by Pango (`MarkupText`, Vazirmatn) — manim's `Text` renders pure-RTL strings empty.
```python
from studio_manim import L
from studio_manim.kit import caption
en = caption(scene, "The determinant tells you how much the matrix stretches area.")
fa = caption(None, "دترمینان می‌گوید ماتریس مساحت را چند برابر می‌کند.")
for m in (en, fa):
    assert m.width > 0 and m.width <= L.caption.w + 1e-6 and len(m.submobjects) > 0
assert scene.kit_caption is en
```

### swap / collapse / into / inset
`swap(scene, old, new, direction)` plays old OUT (shift + alpha 0) then new IN on its slot;
`collapse(old, target)` shrinks old into the next object; `into(m, box)` scales down + centers;
`inset(box, by)` shrinks an L box by `by` units on every side (a margin for a lab inside a panel).
```python
from studio_manim import L, Txt
from studio_manim.kit import swap, collapse, into, inset
a = Txt("first", role="title").move_to([L.title.cx, L.title.cy, 0])
b = Txt("second", role="title").move_to(a)
scene.add(a)
swap(scene, a, b)
assert b in scene.mobjects and a not in scene.mobjects
scene.play(collapse(b, [0, 0, 0]))
assert b not in scene.mobjects
big = into(Txt("x" * 200, role="body"), L.panel(0, 2))
assert big.width <= L.panel(0, 2).w
smaller = inset(L.panel(1, 2), L.u * 2)
assert smaller.w == L.panel(1, 2).w - 4 * L.u and smaller.cx == L.panel(1, 2).cx
```
