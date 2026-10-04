r"""kit.py — the component layer math scenes are composed from (mission M2 "Kit components", P7).

    from studio_manim import *
    from studio_manim.kit import *     # Matrix, PlaneLab, GraphLab, EqSteps, EqMorph, Callout, …

Rules every component follows (they are the Canvas determinant film's failures, turned into code):

- COLOR is a concept: colors come from ``theme.math_role(name)`` (raises when design.json lacks the
  role — intended). Roles used: basis, vector, area, positive, negative, result. Ink/muted/grid come
  from the theme's colors. No hex literal lives in this file.
- NUMBERS on screen come from computation: areas from sympy ``det``, slopes from sympy ``diff``, sums
  from the rectangles themselves, sequence values from ``a_n``. A label you pass in is checked
  against the computed truth where the component knows it (``PlaneLab.show_area``).
- LAYOUT goes through ``L`` boxes: components are built INTO a box (``L.stage``, ``L.panel(i, n)``)
  and scale DOWN to fit it, never up past it; buffs are proportional to the box. Portrait is a
  re-composition — ``L.panel`` stacks — and type grows by theme.size_u's portrait multiplier.
- LABELS are placed by the solver (``studio_manim.solver.place_labels``, late import) with obstacles
  = the shapes they annotate; when the solver is missing or fails, ``next_to`` with a real buff is the
  fallback (``_place`` returns which one ran). Labels never sit ON a shape (the lint flags it).
- TRANSITIONS are designed: ``EqMorph`` (label-matched morph, unmatched parts exit then enter —
  never simultaneous), ``swap`` (the old object is gone before the new one arrives), ``collapse``.

Typst note (ADR-002): there is no LaTeX on this machine, so everything manim builds from MathTex
(``Matrix`` brackets, ``DecimalNumber`` digits, axis numbers, ``BraceLabel``) is rebuilt here from
paths, ``Eq``/``MathTypst`` or ``Txt``.
"""
from __future__ import annotations

import html
import re

import numpy as np
import sympy as sp
from manim import (
    DOWN, LEFT, ORIGIN, RIGHT, UP, UR, AnimationGroup, ArcBetweenPoints, Arrow, Brace, Create,
    Dot, FadeIn, FadeOut, GrowFromCenter, Line, MarkupText, MathTypst, NumberLine, NumberPlane,
    Polygon, Rectangle, Succession, SurroundingRectangle, Transform, UpdateFromAlphaFunc,
    ValueTracker, VGroup, VMobject, Write, smooth, DecimalNumber, Axes,
)
from manim.mobject.matrix import Matrix as _ManimMatrix

from .layout import L
from .theme import color_for, design, math_role
from .typeset import Eq, Txt, num, _font_size

__all__ = [
    "Matrix", "PlaneLab", "GraphLab", "EqSteps", "EqMorph", "Callout", "NumberLineLab",
    "gnomon", "stack_gnomons", "unit_grid", "chapter", "recap", "hold", "caption",
    "swap", "collapse", "into", "inset",
]

# -- shared helpers ---------------------------------------------------------------------------


def _stroke(kind: str = "line") -> float:
    """Stroke widths (Manim px units) — design.json ``stroke`` may override; scaled in portrait so a
    phone-size frame keeps the same visual weight."""
    base = {"line": 3.0, "thin": 1.2, "bracket": 2.6, "axis": 2.0, **(design().get("stroke") or {})}
    return base[kind] * (1.15 if L.portrait else 1.0)


def _ink():
    return color_for("ink")


def _c(box) -> np.ndarray:
    return np.array([box.cx, box.cy, 0.0])


def _bbox(m) -> list[float]:
    """[x, y, w, h] with (x, y) the bottom-left corner — the solver's obstacle format."""
    return [m.get_left()[0], m.get_bottom()[1], m.width, m.height]


def _overlap(a, b, pad: float = 0.0) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw + pad and bx < ax + aw + pad and ay < by + bh + pad and by < ay + ah + pad


def into(m, box, fill: float = 0.92, center: bool = True):
    """Scale ``m`` DOWN (never up) to fit ``fill`` of ``box`` and center it there. Returns ``m``."""
    s = min(1.0, box.w * fill / max(m.width, 1e-6), box.h * fill / max(m.height, 1e-6))
    if s < 1.0:
        m.scale(s)
    if center:
        m.move_to(_c(box))
    return m


def _clamp(m, box):
    """Shift ``m`` inside ``box`` (labels must never leave the panel they annotate)."""
    dx = max(0.0, box.x - m.get_left()[0]) - max(0.0, m.get_right()[0] - (box.x + box.w))
    dy = max(0.0, box.y - m.get_bottom()[1]) - max(0.0, m.get_top()[1] - (box.y + box.h))
    m.shift([dx, dy, 0])
    return m


def _record_by_parts(m, *parts):
    """Declare a composite's RECORDING parts (the recorder's contract, recorder.py ``_snapshot``).

    A top-level kit group must be recorded BY ITS PARTS, never as one whole-bbox object: the
    group's bbox spans a panel, so text near it would lint as text-over-figure, and the text
    INSIDE it (matrix entries, tick and callout labels) would be invisible to the size, contrast
    and density rules. Parts may set ``_studio_kind`` to a furniture kind ("Grid"…); real shapes
    (the parallelogram, plotted curves, gnomons) stay figures so labels ON them are still caught.
    Read live at every snapshot, so a plain attribute (or property) of the CURRENT children works.
    """
    m._studio_parts = list(parts)
    return m


def inset(box, by: float):
    """An L box shrunk by ``by`` units on every side — a margin for a lab inside a panel (the
    plane then stops short of the panel's edge instead of bleeding to the safe area)."""
    from .layout import _Box
    return _Box(box.x + by, box.y + by, max(0.1, box.w - 2 * by), max(0.1, box.h - 2 * by))


def _place(labels, anchors, avoid=(), prefer=None, buff=None, box=None) -> str:
    """Place label mobjects near their anchors without overlapping ``avoid`` (or each other).

    Solver first: ``place_labels(anchors, sizes, obstacles, max_distance, step) -> centers``
    (studio_manim/solver.py, late import — it moves nothing, we ``move_to`` the result). Each label is
    placed in turn with the already-placed ones added to the obstacles. On ImportError or ANY solver
    exception (nothing fits, a signature change) the fallback is ``next_to(anchor, prefer[i], buff)``
    — a placement failure degrades the layout, it never kills a render. Returns "solver"/"next_to".
    """
    buff = L.u * 2.5 if buff is None else buff
    prefer = prefer or [UR] * len(labels)
    obstacles = [_bbox(m) for m in avoid]
    pts = [a if isinstance(a, np.ndarray) else a.get_center() for a in anchors]
    try:
        from .solver import place_labels  # noqa: WPS433 (late: built in parallel, P3)
        for m, p in zip(labels, pts):
            pos = place_labels([(float(p[0]), float(p[1]))], [(m.width, m.height)], obstacles,
                               max(2.0, 12 * L.u), step=0.25)
            m.move_to([pos[0][0], pos[0][1], 0])
            if box is not None:
                _clamp(m, box)
            obstacles.append(_bbox(m))
        return "solver"
    except Exception:  # noqa: BLE001 — ImportError (solver pending) or a solver refusal
        for m, a, d in zip(labels, anchors, prefer):
            m.next_to(a, d, buff=buff)
            if box is not None:
                _clamp(m, box)
        return "next_to"


def _sym(x):
    """An entry as sympy (``"a"`` -> Symbol, ``"1/2"`` -> Rational, 3 -> Integer)."""
    return x if isinstance(x, sp.Basic) else sp.sympify(x)


def _tex(x) -> str:
    """LaTeX for an entry: strings are the author's LaTeX, everything else goes through sympy."""
    return x if isinstance(x, str) else sp.latex(_sym(x))


# -- transitions ---------------------------------------------------------------------------


def _first_half(t: float) -> float:
    return smooth(min(1.0, 2 * t))


def _second_half(t: float) -> float:
    return smooth(max(0.0, 2 * t - 1))


def swap(scene, old, new, direction=UP, run_time: float = 0.8, distance: float | None = None):
    """Replace ``old`` by ``new`` on its slot: old EXITS (shift + alpha 0) in the first half, new
    ENTERS from the opposite side in the second half — never both visible at once (the Canvas film's
    40 s headline collision). ``new`` must already be positioned. Plays and returns ``new``."""
    d = (L.u * 6) if distance is None else distance
    anims = [FadeIn(new, shift=direction * d, rate_func=_second_half)]
    if old is not None:
        anims.insert(0, FadeOut(old, shift=direction * d, rate_func=_first_half))
    scene.play(*anims, run_time=run_time)
    return new


def collapse(old, into_obj, run_time: float = 0.7):
    """Collapse ``old`` into ``into_obj`` (a mobject or point): it shrinks toward it and is removed.
    The designed alternative to a fade when one object becomes the next."""
    target = into_obj.get_center() if hasattr(into_obj, "get_center") else np.array(into_obj, dtype=float)
    return FadeOut(old, target_position=target, scale=0.08, run_time=run_time)


def _norm(tex: str) -> str:
    return re.sub(r"\s+", "", tex)


def _glyphs(eq) -> list:
    return list(eq.submobjects)


class EqMorph(AnimationGroup):
    """Label-matched morph between two ``Eq`` (ADR-002: TransformMatchingTex does not exist for Typst).

    Parts whose ``{{label}}`` CONTENT is equal (whitespace-insensitive, duplicates paired in order)
    Transform in place. Everything else in ``a`` exits ``direction`` during the FIRST half; everything
    else in ``b`` enters from ``-direction`` during the SECOND half — exits and entries never overlap,
    so there is no ghost cross-fade. After the animation the scene holds ``b``, not ``a``.
    """

    def __init__(self, a: Eq, b: Eq, direction=UP, distance: float | None = None, **kw):
        d = (L.u * 4) if distance is None else distance
        used: set[str] = set()
        pairs = []
        for nb, tb in b.labels.items():
            for na, ta in a.labels.items():
                if na not in used and _norm(ta) == _norm(tb):
                    used.add(na)
                    pairs.append((na, nb))
                    break
        src_in = {id(g) for na, _ in pairs for g in a.part(na)}
        tgt_in = {id(g) for _, nb in pairs for g in b.part(nb)}
        anims = [Transform(VGroup(*a.part(na)), VGroup(*b.part(nb))) for na, nb in pairs]
        out = VGroup(*[g for g in _glyphs(a) if id(g) not in src_in])
        enter = VGroup(*[g.copy() for g in _glyphs(b) if id(g) not in tgt_in])
        if len(out):
            anims.append(FadeOut(out, shift=direction * d, rate_func=_first_half))
        if len(enter):
            anims.append(FadeIn(enter, shift=direction * d, rate_func=_second_half))
        kw.setdefault("run_time", 1.2)
        super().__init__(*anims, **kw)
        self.pairs = pairs
        self.source, self.target, self._enter = a, b, enter

    def clean_up_from_scene(self, scene) -> None:  # the same contract as TransformMatching*
        for anim in self.animations:
            anim.interpolate(0)
        scene.remove(self.mobject, self.source, self._enter)
        scene.add(self.target)


# -- 1. Matrix ---------------------------------------------------------------------------------


def _bracket_path(kind: str, side: int, height: float, x: float, cy: float) -> VMobject:
    """One bracket as a path (no LaTeX): ``[`` square, ``(`` arc, ``|`` bar. side -1 left, +1 right."""
    top, bot = cy + height / 2, cy - height / 2
    serif = min(0.18, height * 0.12)
    if kind == "|":
        m = Line([x, top, 0], [x, bot, 0])
    elif kind == "(":
        m = ArcBetweenPoints([x, top, 0], [x, bot, 0], angle=(0.8 if side < 0 else -0.8))
    else:  # "["
        m = VMobject().set_points_as_corners([[x - side * serif, top, 0], [x, top, 0],
                                              [x, bot, 0], [x - side * serif, bot, 0]])
    return m.set_stroke(_ink(), _stroke("bracket")).set_fill(opacity=0)


class Matrix(_ManimMatrix):
    """A matrix with addressable entries, path brackets and determinant bars.

    ``Matrix([[3, 1], [1, 2]])`` — entries are kept as given (ints, sympy, or LaTeX strings like
    ``"a"``) and typeset with ``Eq``. ``entry(i, j)`` is one cell's mobject (flying terms),
    ``det()`` the exact sympy determinant, ``bars()`` a copy with |bars| at the same size and place,
    ``into(box)`` scales DOWN to fit an L box. ``kind``: "[" (default), "(" or "|".
    Columns keep manim's API: ``get_columns()``, ``set_column_colors(math_role("basis"), …)``.
    """

    def __init__(self, rows, kind: str = "[", role: str | None = None, **kw):
        self.values = [list(r) for r in rows]
        self.kind = kind
        fs = _font_size("math")
        k = fs / 48  # manim's buff defaults are calibrated for 48pt entries
        cfg = {"font_size": fs} | ({"role": role} if role else {})
        self._kw = {"role": role, **kw}
        super().__init__(
            [[_tex(x) for x in r] for r in self.values],
            element_to_mobject=lambda s, **c: Eq(s, **c), element_to_mobject_config=cfg,
            v_buff=0.62 * k, h_buff=0.9 * k, bracket_h_buff=0.16 * k, bracket_v_buff=0.12 * k,
            left_bracket=kind, right_bracket=kind, **kw)

    def _organize_mob_matrix(self, matrix):
        """Cells sized from MEASURED entries (manim's fixed h_buff collides on wide entries such as
        ``-12``): each column is as wide as its widest entry; entries center in their cell."""
        cols = len(matrix[0])
        widths = [max(matrix[i][j].width for i in range(len(matrix))) for j in range(cols)]
        rowh = max(m.height for r in matrix for m in r)
        gap_x, gap_y = self.h_buff * 0.5, self.v_buff * 0.55
        x = 0.0
        xs = []
        for w in widths:
            xs.append(x + w / 2)
            x += w + gap_x
        for i, r in enumerate(matrix):
            for j, m in enumerate(r):
                m.move_to([xs[j], -i * (rowh + gap_y), 0])
        return self

    def _add_brackets(self, left="[", right="]", **_):
        h = self.height + 2 * self.bracket_v_buff
        cy = self.get_center()[1]
        lb = _bracket_path(left, -1, h, self.get_left()[0] - self.bracket_h_buff, cy)
        rb = _bracket_path(right, 1, h, self.get_right()[0] + self.bracket_h_buff, cy)
        self.brackets = VGroup(lb, rb)
        self.add(lb, rb)
        return self

    def entry(self, i: int, j: int):
        """The mobject of row ``i``, column ``j`` (0-based)."""
        return self.mob_matrix[i][j]

    def det(self):
        """Exact determinant (sympy) of the entries as given — symbols stay symbolic."""
        return sp.Matrix([[_sym(x) for x in r] for r in self.values]).det()

    def sympy(self) -> sp.Matrix:
        return sp.Matrix([[_sym(x) for x in r] for r in self.values])

    def bars(self) -> "Matrix":
        """A copy with determinant bars instead of brackets, same entry size, same center."""
        m = Matrix(self.values, kind="|", **self._kw)
        m.scale(self.entry(0, 0).height / max(m.entry(0, 0).height, 1e-6))
        m.move_to(self.get_center())
        for i, r in enumerate(self.mob_matrix):  # carry entry colors (column roles)
            for j, e in enumerate(r):
                m.entry(i, j).set_color(e.get_color())
        return m

    @property
    def _studio_parts(self):
        """Recorded BY ENTRY (each an ``Eq``: the size/contrast/density rules see the entries) plus
        the bracket paths — never as one whole-bbox object."""
        return [m for row in self.mob_matrix for m in row] + list(self.brackets)

    def into(self, box, fill: float = 0.9) -> "Matrix":
        """Scale DOWN to fit ``fill`` of an L box (never wider than it) and center there."""
        return into(self, box, fill)


# -- 2. PlaneLab ------------------------------------------------------------------------------


def _clip_line(p, d, rect):
    """Clip the infinite line p + s·d to rect (x0, y0, x1, y1) — Liang–Barsky. None if outside."""
    x0, y0, x1, y1 = rect
    lo, hi = -1e9, 1e9
    for pi, di, a, b in ((p[0], d[0], x0, x1), (p[1], d[1], y0, y1)):
        if abs(di) < 1e-12:
            if pi < a or pi > b:
                return None
            continue
        s1, s2 = (a - pi) / di, (b - pi) / di
        lo, hi = max(lo, min(s1, s2)), min(hi, max(s1, s2))
    if lo >= hi:
        return None
    return p + lo * d, p + hi * d


class PlaneLab(VGroup):
    """A coordinate plane that a matrix acts on: grid, basis arrows, unit square → parallelogram.

    ``PlaneLab(box, matrix=I, fit=[A, …])`` sizes the plane FROM the box with EQUAL x/y units (a
    unit square must look square) so the images of the unit square under every matrix in ``fit``
    land inside it (D-009 §4). The transformed grid is CLIPPED to the box, and its minor lines fade
    as |det| -> 0 (no dense hatch on a collapse). ``apply(M)`` is one animation of the live state;
    ``show_area()`` / ``column_tags()`` return labels placed OFF the parallelogram (solver).
    Roles: î basis, ĵ vector, square area (negative when orientation flips), area label result.
    """

    def __init__(self, box=None, matrix=((1, 0), (0, 1)), fit=None, margin: float = 0.6):
        super().__init__()
        self.box = box or L.stage
        self.M = np.array(matrix, dtype=float)
        self.Msym = sp.Matrix(matrix)
        pts = [np.zeros(2)]
        for A in [self.M] + [np.array(f, dtype=float) for f in (fit or [])]:
            pts += [A @ v for v in (np.array([1, 0]), np.array([0, 1]), np.array([1, 1]))]
        pts = np.array(pts)
        lo, hi = pts.min(axis=0) - margin, pts.max(axis=0) + margin
        unit = min(self.box.w * 0.94 / (hi[0] - lo[0]), self.box.h * 0.94 / (hi[1] - lo[1]))
        mid = (lo + hi) / 2
        hx, hy = self.box.w * 0.47 / unit, self.box.h * 0.47 / unit  # fill the box, equal units
        self.unit = unit
        self.plane = NumberPlane(
            x_range=[mid[0] - hx, mid[0] + hx, 1], y_range=[mid[1] - hy, mid[1] + hy, 1],
            x_length=2 * hx * unit, y_length=2 * hy * unit,
            background_line_style={"stroke_color": color_for("gridBase"), "stroke_width": 1.4,
                                   "stroke_opacity": 1.0},
            axis_config={"stroke_color": color_for("grid"), "stroke_width": _stroke("thin") * 1.3},
            faded_line_ratio=1,
        )
        self.plane.move_to(_c(self.box))
        self.origin = self.plane.c2p(0, 0)
        self._rect = (self.plane.get_left()[0], self.plane.get_bottom()[1],
                      self.plane.get_right()[0], self.plane.get_top()[1])
        n = int(np.ceil(max(hx, hy) + abs(mid).max())) + 12
        self._ks = list(range(-n, n + 1))
        self.grid = VGroup(*[Line(ORIGIN, RIGHT) for _ in range(2 * len(self._ks))])
        self.square = Polygon(*[ORIGIN] * 4)
        self.i_hat = Arrow(ORIGIN, RIGHT, buff=0)
        self.j_hat = Arrow(ORIGIN, UP, buff=0)
        self.add(self.plane, self.grid, self.square, self.i_hat, self.j_hat)
        # the transformed lattice is PAGE FURNITURE like the plane under it (labels sit on the grid
        # legally — D-010); the square and the arrows stay figures. Recorded BY PARTS so a label
        # next to the lab is never "text over figure" on the group's whole-panel bbox.
        self.grid._studio_kind = "Grid"
        _record_by_parts(self, self.plane, self.grid, self.square, self.i_hat, self.j_hat)
        self._set(self.M)
        self.tags = None
        self.area_label = None

    # the whole visual state is a pure function of the 2x2 matrix (render contract: no history)
    def _set(self, M: np.ndarray):
        o = self.origin
        det = float(np.linalg.det(M))
        fade = min(1.0, abs(det))
        col = [M[:, 0] * self.unit, M[:, 1] * self.unit]
        i = 0
        for axis in (0, 1):
            d = np.array([*col[1 - axis], 0.0])          # lines parallel to the other column
            for k in self._ks:
                p = o + np.array([*(col[axis] * k), 0.0])
                seg = _clip_line(p, d, self._rect) if np.linalg.norm(d) > 1e-9 else None
                ln = self.grid[i]
                i += 1
                if seg is None:
                    ln.set_points_as_corners([o, o]).set_stroke(opacity=0)
                    continue
                ln.set_points_as_corners([seg[0], seg[1]])
                if k == 0:
                    ln.set_stroke(color_for("muted"), _stroke("axis"), opacity=1)
                else:
                    ln.set_stroke(color_for("grid"), _stroke("thin"), opacity=0.85 * fade)
        c = [o + np.array([*v, 0.0]) for v in (0 * col[0], col[0], col[0] + col[1], col[1])]
        self.square.set_points_as_corners([*c, c[0]])
        role = "area" if det >= 0 else "negative"
        self.square.set_fill(math_role(role), 0.45).set_stroke(math_role(role), _stroke("line"))
        tip = 0.22 * (1.25 if L.portrait else 1.0)
        for arrow, v, r in ((self.i_hat, col[0], "basis"), (self.j_hat, col[1], "vector")):
            end = o + np.array([*v, 0.0])
            if np.linalg.norm(v) < 1e-3:
                end = o + np.array([1e-3, 0, 0])
            arrow.become(Arrow(o, end, buff=0, stroke_width=_stroke("line") * 1.6, tip_length=tip,
                               max_tip_length_to_length_ratio=0.35,
                               max_stroke_width_to_length_ratio=40, color=math_role(r)))
        self.M = np.array(M, dtype=float)

    def apply(self, matrix, run_time: float = 2.0):
        """Animate the plane from its current matrix to ``matrix`` (absolute, not composed).

        Labels from ``show_area``/``column_tags`` are stale during the move: they exit in the first
        quarter (alpha 0 while the shape moves — the Canvas film's 35 s collision) and are removed;
        ask for fresh ones after the animation."""
        A0, A1 = self.M.copy(), np.array(matrix, dtype=float)
        self.Msym = sp.Matrix(matrix)

        def upd(_m, alpha):
            self._set((1 - alpha) * A0 + alpha * A1)

        anims = [UpdateFromAlphaFunc(self, upd, rate_func=smooth)]
        for lab in (self.tags, self.area_label):
            if lab is not None:
                anims.append(FadeOut(lab, shift=UP * L.u * 3, rate_func=lambda t: smooth(min(1, 4 * t))))
        self.tags = self.area_label = None
        # ``group=self``: Scene.play ADDS a non-introducer AnimationGroup's ``.group`` to the scene
        # (scene.py add_mobjects_from_animations) — a bare Group wrapper would nest the lab one
        # level deep and DEFEAT the recorder's parts contract (a whole-panel "figure" bbox that
        # every label inside lints against). With group=self the lab itself is the animation's
        # mobject: already in the scene family, so nothing is wrapped or restructured.
        return AnimationGroup(*anims, group=self, run_time=run_time)

    def area_value(self):
        """The signed area of the image of the unit square: the exact sympy determinant."""
        return self.Msym.det()

    def _obstacles(self):
        return [self.square, self.i_hat, self.j_hat] + ([self.tags] if self.tags is not None else [])

    def show_area(self, value=None, tex: str = r"\text{area} = {}"):
        """The area label (role result; negative if the area is signed negative) placed OFF the
        parallelogram. ``value`` is a COMPUTED string (``num(A.det())``); it is checked against
        ``area_value()`` and a stale/typed mismatch raises. None = ``num(area_value())``."""
        truth = self.area_value()
        shown = num(truth) if value is None else str(value)
        if sp.nsimplify(shown) != sp.nsimplify(truth):
            raise ValueError(f"show_area({shown!r}) but the plane's det is {truth} — compute it, never type it")
        role = "result" if truth >= 0 else "negative"
        lab = Eq(tex.replace("{}", shown), role=role, font_size=_font_size("math") * 0.55)
        # anchor at the square's EDGE on the open side (anchoring at a big shape's CENTER makes
        # every solver candidate land inside it — PlacementError by construction); pushed a little
        # into the open side so the first ring clears the arrow that runs along that edge.
        ctr = self.square.get_center()
        below = ctr[1] > self.origin[1]
        prefer = [DOWN if below else UP]
        edge = self.square.get_bottom() if below else self.square.get_top()
        anchor = edge + np.array([0.0, (-1 if below else 1) * L.u * 2, 0.0])
        self.placed_by = _place([lab], [anchor], self._obstacles(), prefer=prefer,
                                buff=L.u * 3, box=self.box)
        self.area_label = lab
        return lab

    def column_tags(self):
        """``(a, c)`` / ``(b, d)`` tags at the column tips — computed from the matrix, label-sized,
        placed by the solver off the arrows and the parallelogram."""
        o = self.origin
        tags = VGroup()
        anchors = []
        for j, r in ((0, "basis"), (1, "vector")):
            v = self.Msym[:, j]
            t = Txt(f"({num(v[0])}, {num(v[1])})", role="label", color=math_role(r))
            tags.add(t)
            anchors.append(o + np.array([*(self.M[:, j] * self.unit), 0.0]))
        dirs = [RIGHT if self.M[0, 0] >= 0 else LEFT, UP if self.M[1, 1] >= 0 else DOWN]
        self.placed_by = _place(list(tags), anchors, [self.square, self.i_hat, self.j_hat],
                                prefer=dirs, buff=L.u * 2, box=self.box)
        self.tags = tags
        return tags


# -- 3. GraphLab ------------------------------------------------------------------------------

_X = sp.Symbol("x")


class GraphLab(VGroup):
    """Axes + a function, secant/tangent, a live slope readout, Riemann sums.

    ``GraphLab(box, "x**2/4 + 1", x_range=(-1, 4))`` — ``f`` is sympy-able (string, expression in
    ``x``, or a callable on a sympy Symbol): slopes come from ``sympy.diff``, sums from the
    rectangles, the integral from ``sympy.integrate``. The top 18% of the box is the READOUT ROW
    (slope / sum labels live there, never on the curve); the axes fill the rest.
    """

    def __init__(self, box=None, f="x**2", x_range=(-1, 3), y_range=None, role: str = "vector"):
        super().__init__()
        self.box = box or L.stage
        self.expr = f(_X) if callable(f) else sp.sympify(f)
        self.fn = sp.lambdify(_X, self.expr, "math")
        self.dfn = sp.lambdify(_X, sp.diff(self.expr, _X), "math")
        a, b = float(x_range[0]), float(x_range[1])
        if y_range is None:
            ys = [self.fn(a + (b - a) * i / 200) for i in range(201)]
            lo, hi = min(0.0, min(ys)), max(0.0, max(ys))
            pad = (hi - lo) * 0.1 or 1.0
            y_range = (np.floor(lo - pad), np.ceil(hi + pad))
        self.x_range, self.y_range = (a, b), (float(y_range[0]), float(y_range[1]))
        plot_h = self.box.h * 0.78
        self.axes = Axes(
            x_range=[a, b, 1], y_range=[self.y_range[0], self.y_range[1], 1],
            x_length=self.box.w * 0.92, y_length=plot_h, tips=False,
            axis_config={"stroke_color": color_for("muted"), "stroke_width": _stroke("axis"),
                         "include_ticks": True, "tick_size": L.u * 0.8},
        )
        self.axes.move_to([self.box.cx, self.box.y + plot_h / 2 + self.box.h * 0.02, 0])
        self.readout_slot = np.array([self.box.cx, self.box.y + self.box.h * 0.91, 0])
        self.curve = self.axes.plot(self.fn, x_range=[a, b], color=math_role(role),
                                    stroke_width=_stroke("line") * 1.3)
        self.add(self.axes)
        self.h = ValueTracker(1.0)

    @property
    def _studio_parts(self):
        """Recorded by parts (the axes are furniture, the curve a figure): read live so the
        curve appears in the records from the moment ``plot()`` keeps it in the lab."""
        return [self.axes, self.curve]

    def plot(self, run_time: float = 1.5):
        """Create the axes, then the curve — the lab INTRODUCES ITSELF (the axes live inside the
        lab; ``scene.add(lab)`` would also work but never ``scene.add(lab.curve)`` alone: the axes
        would not render). Returns the Succession; the curve is kept in the lab either way."""
        self.add(self.curve)
        return Succession(Create(self.axes), Create(self.curve), run_time=run_time)

    def _line(self, x0: float, slope: float, color) -> Line:
        """A slope line through (x0, f(x0)) clipped to the axes rectangle."""
        p = np.array([x0, self.fn(x0)])
        seg = _clip_line(p, np.array([1.0, slope]), (self.x_range[0], self.y_range[0],
                                                     self.x_range[1], self.y_range[1]))
        q0, q1 = seg if seg else (p, p + np.array([1e-3, 0]))
        return Line(self.axes.c2p(*q0), self.axes.c2p(*q1), color=color, stroke_width=_stroke("line"))

    def _slope(self, x0: float, h: float) -> float:
        return float(self.dfn(x0)) if abs(h) < 1e-9 else (self.fn(x0 + h) - self.fn(x0)) / h

    def secant(self, x0: float, x1: float) -> Line:
        """The secant through x0 and x1 (role positive)."""
        return self._line(x0, self._slope(x0, x1 - x0), math_role("positive"))

    def tangent(self, x0: float, h0: float = 1.5, run_time: float = 2.5):
        """The tangent as the LIMIT of secants: returns ``(line, dots, animation)`` — the line is a
        secant through x0 and x0+h, h tracked from ``h0`` to 0 by ``self.h`` (the updater depends on
        the tracker only: deterministic). At h = 0 the slope is ``sympy.diff``'s, not a difference."""
        self.h.set_value(h0)
        line = self._line(x0, self._slope(x0, h0), math_role("positive"))
        d0 = Dot(self.axes.c2p(x0, self.fn(x0)), radius=L.u * 0.9, color=math_role("positive"))
        d1 = Dot(radius=L.u * 0.7, color=math_role("positive"))

        def upd_line(m):
            h = self.h.get_value()
            m.become(self._line(x0, self._slope(x0, h), math_role("positive")))

        def upd_dot(m):
            h = self.h.get_value()
            m.move_to(self.axes.c2p(x0 + h, self.fn(x0 + h)))

        line.add_updater(upd_line)
        d1.add_updater(upd_dot)
        self.x0 = x0
        anim = self.h.animate(run_time=run_time, rate_func=smooth).set_value(0.0)
        return line, VGroup(d0, d1), anim

    def slope_readout(self, x0: float | None = None):
        """``slope = 1.25`` — an Eq + DecimalNumber (Typst digits) lockup in the readout row that
        follows ``self.h`` (the secant's slope; at h = 0 the derivative). Never a typed number."""
        x0 = self.x0 if x0 is None else x0
        fs = _font_size("math") * 0.5
        head = Eq(r"\text{slope} =", font_size=fs)
        val = DecimalNumber(self._slope(x0, self.h.get_value()), num_decimal_places=2,
                            mob_class=MathTypst, font_size=fs, color=math_role("result"))
        val.next_to(head, RIGHT, buff=L.u * 1.5)
        lock = VGroup(head, val).move_to(self.readout_slot)
        _record_by_parts(lock, head, val)   # the Eq and the number are recorded as text, not one box
        anchor = head.get_right()

        def upd(m):
            m.set_value(self._slope(x0, self.h.get_value()))
            m.set_color(math_role("result"))
            m.next_to(anchor, RIGHT, buff=L.u * 1.5)

        val.add_updater(upd)
        return lock

    def riemann(self, n: int, side: str = "left", a: float | None = None, b: float | None = None):
        """``n`` rectangles over [a, b] (``side`` left/right/center) + their COMPUTED sum next to the
        exact integral (sympy) in the readout row. Returns ``VGroup(rects, label)``."""
        a = self.x_range[0] if a is None else a
        b = self.x_range[1] if b is None else b
        dx = sp.Rational(sp.nsimplify(b - a)) / n
        off = {"left": 0, "right": 1, "center": sp.Rational(1, 2)}[side]
        xs = [sp.nsimplify(a) + (k + off) * dx for k in range(n)]
        total = sum(self.expr.subs(_X, x) * dx for x in xs)
        truth = sp.integrate(self.expr, (_X, sp.nsimplify(a), sp.nsimplify(b)))
        rects = VGroup()
        for k, x in enumerate(xs):
            y = float(self.expr.subs(_X, x))
            x_l = float(sp.nsimplify(a) + k * dx)
            p0, p1 = self.axes.c2p(x_l, 0), self.axes.c2p(x_l + float(dx), y)
            r = Rectangle(width=abs(p1[0] - p0[0]), height=max(abs(p1[1] - p0[1]), 1e-4))
            r.move_to((p0 + p1) / 2)
            rects.add(r.set_fill(math_role("area"), 0.55).set_stroke(color_for("ink"), _stroke("thin"), 0.6))
        fs = _font_size("math") * 0.5
        lab = Eq(rf"S_{{ {n} }} = {num(total, places=3)} \quad \int = {num(truth, places=3)}", font_size=fs)
        lab.move_to(self.readout_slot)
        self.sum_value, self.integral_value = total, truth
        return _record_by_parts(VGroup(rects, lab), rects, lab)


# -- 4. EqSteps -------------------------------------------------------------------------------


class EqSteps(VGroup):
    r"""A derivation that morphs step by step on ONE line, aligned on ``=``.

    ``EqSteps([r"{{(a+b)^2}} {{=}} (a+b)(a+b)", r"{{(a+b)^2}} {{=}} a^2 + 2ab + b^2"], box)``.
    Shared ``{{labels}}`` (same LaTeX content) persist and morph in place (``EqMorph``); the parts
    of step k that did NOT exist in step k-1 are highlighted (role positive) when step k lands.
    ALIGNMENT: label the equals sign ``{{=}}`` and every step's ``=`` sits at the same x (the steps
    share one scale, chosen so the widest left/right sides fit the box); without a ``{{=}}`` label
    steps center. ``steps()`` = [Write(step 0), EqMorph(0→1), …].
    """

    def __init__(self, steps: list[str], box=None, role: str = "positive", direction=UP):
        if not steps:
            raise ValueError("EqSteps needs at least one step")
        self.box = box or L.stage
        self.direction = direction
        eqs = [Eq(s) for s in steps]
        # highlight what is new in each step (vs the previous one, by label content)
        for prev, cur in zip(eqs, eqs[1:]):
            keep = {_norm(t) for t in prev.labels.values()}
            fresh = {id(g) for n, t in cur.labels.items() if _norm(t) in keep for g in cur.part(n)}
            for g in cur.submobjects:
                if id(g) not in fresh:
                    g.set_color(math_role(role))
        # one shared scale, '=' aligned
        anchors = []
        for e in eqs:
            eq_name = next((n for n, t in e.labels.items() if _norm(t) == "="), None)
            anchors.append(e.part(eq_name).get_center()[0] if eq_name else e.get_center()[0])
        left = max(a - e.get_left()[0] for a, e in zip(anchors, eqs))
        right = max(e.get_right()[0] - a for a, e in zip(anchors, eqs))
        s = min(1.0, self.box.w * 0.94 / (left + right))
        x_eq = self.box.cx + (left - right) * s / 2
        for a, e in zip(anchors, eqs):
            e.scale(s, about_point=np.array([a, e.get_center()[1], 0]))
            e.shift([x_eq - a, self.box.cy - e.get_center()[1], 0])
        super().__init__(*eqs)
        self.eqs = eqs

    def steps(self, write_time: float = 1.2, morph_time: float = 1.2) -> list:
        """The animation sequence: play each, with your holds in between."""
        out = [Write(self.eqs[0], run_time=write_time)]
        out += [EqMorph(a, b, direction=self.direction, run_time=morph_time)
                for a, b in zip(self.eqs, self.eqs[1:])]
        return out


# -- 5. Callout -------------------------------------------------------------------------------


class Callout(VGroup):
    """A brace or box on ``target`` + a label that never sits ON the target.

    ``Callout(eq.part("p1"), "the ad term", kind="brace", direction=DOWN)``. Brace: the label sits at
    the brace tip (the brace defines the place). Box: the label is solver-placed with the target,
    the box and ``avoid`` as obstacles (``next_to(direction)`` fallback). ``label`` is a string
    (a BODY-role Txt — an annotation is meant to be read, and the look rounds kept flagging the
    label-role size at the readability floor) or any mobject (an ``Eq``). ``create()`` = shape
    first, then the label.
    """

    def __init__(self, target, label, kind: str = "brace", direction=DOWN, role: str = "positive",
                 avoid=(), box=None):
        color = math_role(role)
        lab = label if not isinstance(label, str) else Txt(label, role="body", color=color)
        if kind == "brace":
            # the buff clears the line's DESCENDERS: a brace hung at a fixed 1.2u under a part
            # whose siblings (parens, +) reach lower lands inside the equation's bbox — the lint
            # reads that as text-over-figure (it bit at 1.25x scale in the showcase)
            shape = Brace(target, direction, buff=L.u * 2.6, color=color)
            shape.set_stroke(width=0).set_fill(color, 1)
            lab.next_to(shape, direction, buff=L.u * 2.2)
            _clamp(lab, box or L.stage)   # a callout label never leaves the content area
            self.placed_by = "brace"
        elif kind == "box":
            shape = SurroundingRectangle(target, buff=L.u * 1.2, color=color,
                                         stroke_width=_stroke("line"), corner_radius=L.u * 0.8)
            self.placed_by = _place([lab], [shape], [target, shape, *avoid], prefer=[direction],
                                    buff=L.u * 2, box=box)
        else:
            raise ValueError(f"Callout kind {kind!r}: 'brace' or 'box'")
        super().__init__(shape, lab)
        self.shape, self.label = shape, lab
        _record_by_parts(self, shape, lab)   # played via create() the parts enter individually anyway

    def create(self, run_time: float = 1.0):
        grow = GrowFromCenter(self.shape) if isinstance(self.shape, Brace) else Create(self.shape)
        return Succession(grow, FadeIn(self.label, shift=UP * L.u * 2), run_time=run_time)


# -- 6. Number line + sequences ---------------------------------------------------------------

_N = sp.Symbol("n")


class NumberLineLab(VGroup):
    """A number line built into a box, tick labels label-sized (>= 2.6u, the lint's tick floor).

    ``NumberLineLab(box, (0, 2, 0.5))``. Tick labels thin out (every k-th) when they would touch.
    ``sequence("1/n", (1, 6))`` -> dots at a_n (role positive) with their COMPUTED values above,
    stacked into up to three tiers when neighbours crowd (a label that still collides is dropped:
    the dot stays — the value would be unreadable anyway). Values outside the range are skipped.
    """

    def __init__(self, box=None, x_range=(0, 1, 0.25)):
        super().__init__()
        self.box = box or L.stage
        a, b, step = (float(v) for v in x_range)
        self.line = NumberLine(x_range=[a, b, step], length=self.box.w * 0.9,
                               color=color_for("muted"), stroke_width=_stroke("axis"),
                               tick_size=L.u * 1.0, include_numbers=False)
        self.line.move_to([self.box.cx, self.box.y + self.box.h * 0.35, 0])
        vals = [a + i * step for i in range(int(round((b - a) / step)) + 1)]
        labs = [Txt(num(v, places=3), role="label", color=color_for("ink")) for v in vals]
        spacing = self.line.get_unit_size() * step
        widest = max(m.width for m in labs)
        every = max(1, int(np.ceil((widest + L.u * 2) / spacing)))
        self.ticks = VGroup()
        kept = []
        for i, (v, m) in enumerate(zip(vals, labs)):
            if i % every == 0:
                m.next_to(self.line.n2p(v), DOWN, buff=L.u * 2.2)
                self.ticks.add(m)
                kept.append(m)
        # the tick labels are recorded INDIVIDUALLY (a VGroup of Txt is not text to the recorder)
        _record_by_parts(self.ticks, *kept)
        self.add(self.line, self.ticks)
        _record_by_parts(self, self.line, self.ticks)
        self.range = (a, b)

    def sequence(self, a_n, n_range=(1, 6), role: str = "positive"):
        """Dots + value labels for a_n at n in [n0, n1] (inclusive). ``a_n``: a sympy-able string or
        expression in ``n``, or a callable on a sympy Integer (kept exact)."""
        expr = None if callable(a_n) else sp.sympify(a_n)
        dots, labels, placed = VGroup(), VGroup(), []
        tier_h = L.u * 4.6
        for n in range(int(n_range[0]), int(n_range[1]) + 1):
            v = a_n(sp.Integer(n)) if expr is None else expr.subs(_N, n)
            fv = float(v)
            if not (self.range[0] <= fv <= self.range[1]):
                continue
            p = self.line.n2p(fv)
            dots.add(Dot(p, radius=L.u * 0.9, color=math_role(role)))
            t = Txt(num(v, places=3), role="label", color=math_role(role))
            for tier in range(3):
                t.next_to(p, UP, buff=L.u * 2 + tier * tier_h)
                if not any(_overlap(_bbox(t), q, L.u * 0.6) for q in placed):
                    placed.append(_bbox(t))
                    labels.add(t)
                    break
        # dots are one figure; every value label is recorded as text
        return _record_by_parts(VGroup(dots, labels), dots, *labels)


# -- 7. Geometry / dissection -----------------------------------------------------------------


def gnomon(k: int, unit: float = 1.0, cells: bool = True, role: str = "area", opacity: float = 0.55):
    """The k-th gnomon: the L that grows a (k-1)×(k-1) square into k×k — arms of k and k-1 cells
    sharing the corner, 2k-1 cells in all (k=1 is the single cell). Bottom-left of the square at
    ORIGIN; the L hugs the top and right. ``.cells`` = 2k-1 (asserted against the cell grid)."""
    if k < 1:
        raise ValueError("gnomon(k) needs k >= 1")
    j = k - 1
    if k == 1:
        pts = [(0, 0), (1, 0), (1, 1), (0, 1)]
    else:
        pts = [(j, 0), (k, 0), (k, k), (0, k), (0, j), (j, j)]
    poly = Polygon(*[np.array([x * unit, y * unit, 0.0]) for x, y in pts])
    poly.set_fill(math_role(role), opacity).set_stroke(color_for("ink"), _stroke("line"))
    divs = VGroup()
    if cells and k > 1:
        for y in range(1, k):  # the right arm (column x in [j, k]): k cells, k-1 dividers
            divs.add(Line([j * unit, y * unit, 0], [k * unit, y * unit, 0]))
        for x in range(1, j + 1):  # the top arm (row y in [j, k], x in [0, j]): j cells
            divs.add(Line([x * unit, j * unit, 0], [x * unit, k * unit, 0]))
    divs.set_stroke(color_for("ink"), _stroke("thin"), 0.5)
    g = VGroup(poly, divs)
    g.cells = 2 * k - 1
    assert g.cells == k + (k - 1) and len(divs) == (2 * k - 2 if cells and k > 1 else 0)
    return g


def stack_gnomons(n: int, box=None, fill: float = 0.86):
    """1 + 3 + 5 + … + (2n-1) = n²: gnomons 1..n nested into an n×n square, centered in ``box``.
    Fills alternate between the area role at two opacities (one concept, two shades). ``g[k-1]`` is
    the k-th gnomon; ``.unit`` the cell size; ``.total`` = sum of cells (computed, = n²)."""
    box = box or L.stage
    unit = min(box.w, box.h) * fill / n
    gs = VGroup(*[gnomon(k, unit, opacity=0.6 if k % 2 else 0.3) for k in range(1, n + 1)])
    gs.move_to(_c(box))
    gs.unit = unit
    gs.total = sum(g.cells for g in gs)
    assert gs.total == n * n
    return gs


def unit_grid(n: int, unit: float = 1.0):
    """A light n×n cell grid (theme grid color), bottom-left at ORIGIN — lay it under dissections.
    Stroke and opacity sit just above the theme's hairline so the cells read at phone size (the
    first look round read the grid as "only faint vertical lines"). The lines are INTERLEAVED
    (vertical, horizontal, …) so a half-drawn ``Create`` reads as a grid forming, not as a set of
    lone verticals (the phone round read that opening as a broken frame)."""
    vs = [Line([i * unit, 0, 0], [i * unit, n * unit, 0]) for i in range(n + 1)]
    hs = [Line([0, i * unit, 0], [n * unit, i * unit, 0]) for i in range(n + 1)]
    g = VGroup(*[ln for pair in zip(vs, hs) for ln in pair])
    return g.set_stroke(color_for("grid"), _stroke("thin") * 1.4, 0.95)


# -- 8. Chapter and recap cards ---------------------------------------------------------------


def chapter(title: str, kicker: str | None = None):
    """The title strip in ``L.title``: title (role title) with an optional kicker (role label,
    muted) above it, left-aligned to the safe edge, scaled DOWN to fit the strip.
    ``.enter()`` = kicker slides in from the left, then the title writes."""
    t = Txt(title, role="title")
    g = VGroup(t)
    k = None
    if kicker:
        k = Txt(kicker, role="label", color=color_for("muted"))
        k.next_to(t, UP, buff=L.u * 1.2).align_to(t, LEFT)
        g.add(k)
    s = min(1.0, L.title.w / g.width, L.title.h / g.height)
    g.scale(s)
    g.move_to([L.title.x + g.width / 2, L.title.cy, 0])
    g.title, g.kicker = t, k
    _record_by_parts(g, *([t, k] if k is not None else [t]))

    def enter(run_time: float = 1.2):
        anims = [Write(t, run_time=run_time * 0.7)]
        if k is not None:
            anims.insert(0, FadeIn(k, shift=RIGHT * L.u * 4, run_time=run_time * 0.3))
        return Succession(*anims)

    g.enter = enter
    return g


def recap(lines: list):
    """At most three lines (craft 9.6), next_to-chained, the group centered in ``L.stage``.
    A line is a string (body Txt), ``"$…$"`` (an Eq) or a mobject. ``.reveal()`` = the lines in
    order, each sliding up into place."""
    if not 1 <= len(lines) <= 3:
        raise ValueError(f"recap takes 1 to 3 lines (craft 9.6), got {len(lines)}")
    mobs = []
    for x in lines:
        if isinstance(x, str) and len(x) > 1 and x.startswith("$") and x.endswith("$"):
            mobs.append(Eq(x[1:-1]))
        elif isinstance(x, str):
            mobs.append(Txt(x, role="body"))
        else:
            mobs.append(x)
    buff = max(L.u * 5, L.stage.h * 0.07)
    for prev, cur in zip(mobs, mobs[1:]):
        cur.next_to(prev, DOWN, buff=buff)
    g = VGroup(*mobs)
    into(g, L.stage, fill=0.9)
    _record_by_parts(g, *mobs)   # each line is recorded (body Txt / Eq), not the whole card

    def reveal(each: float = 0.8):
        return Succession(*[FadeIn(m, shift=UP * L.u * 3, run_time=each) for m in mobs])

    g.reveal = reveal
    return g


def hold(scene, seconds: float = 1.5):
    """The recap/key-result hold (craft 9.6: >= 1.2 s)."""
    scene.wait(max(1.2, float(seconds)))


# -- 9. Narration captions --------------------------------------------------------------------

_RTL = re.compile(r"[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]")


def caption(scene, text: str, max_lines: int = 2):
    """The narration caption: role caption, centered in the ``L.caption`` band, wrapped to at most
    two balanced lines, scaled down to the band. RTL text (Persian/Arabic/Hebrew) goes through
    Pango ``MarkupText`` with ``Vazirmatn``: manim's ``Text`` renders a pure-RTL string EMPTY
    (measured: 0 glyphs on manim 0.21/pango 1.57) — Pango shapes and orders it right-to-left.
    ``scene`` may be None; when given, the caption is remembered as ``scene.kit_caption``."""
    words = text.split()
    rtl = bool(_RTL.search(text))

    def make(s):
        if rtl:
            m = MarkupText(html.escape(s), font="Vazirmatn", font_size=_font_size("caption"),
                           color=_ink(), justify=True)
        else:
            m = Txt(s, role="caption", color=_ink())
        return m

    m = make(text)
    if m.width > L.caption.w * 0.96 and max_lines > 1 and len(words) > 1:
        cut = min(range(1, len(words)),
                  key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
        m = make(" ".join(words[:cut]) + "\n" + " ".join(words[cut:]))
    into(m, L.caption, fill=0.96)
    if scene is not None:
        scene.kit_caption = m
    return m
