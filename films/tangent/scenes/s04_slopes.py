"""s04_slopes — tangent (the derivative as slope). The shared block below is identical in every
scene file (self-contained scenes keep the scene cache exact); the scene follows it."""
import re

import sympy as sp
from manim import (DOWN, LEFT, RIGHT, UP, Create, DashedLine, DecimalNumber, Dot, FadeIn, FadeOut,
                   GrowFromCenter, Indicate, Line, MathTypst, ValueTracker, VGroup, Write, smooth)

from studio_manim import L, Eq, StudioScene, Txt, claim, color_for, math_role, num
from studio_manim.kit import EqSteps, GraphLab, collapse, hold, into, recap, swap
from studio_manim.typeset import _font_size

# -- the film's shared geometry (identical in every scene file, so the seams are invisible) --------
X = sp.Symbol("x")
F = X**2                        # the curve; every slope on screen comes from sp.diff / sp.limit of it
XR, YR = (0, 3.2), (0, 11)
GAP = 0.15                      # the narration's inter-sentence gap (D-016): a scene ends where the next voice starts


def f(x):
    return F.subs(X, x)


def tex(expr):
    """sympy LaTeX, tight: '2 x' -> '2x', '3 x^{2}' -> '3x^{2}' (Typst renders the space loose)."""
    return re.sub(r"(\d)\s+([a-z])", r"\1\2", sp.latex(expr))


class Box:
    """An L-style box (x, y = bottom-left in Manim's centered frame; w, h; cx, cy)."""

    def __init__(self, x, y, w, h):
        self.x, self.y, self.w, self.h = x, y, w, h
        self.cx, self.cy = x + w / 2, y + h / 2


def graph_box():
    """Panel 0 with its bottom 9% reserved for the tick labels (they sit below the axis, in safe)."""
    p = L.panel(0, 2)
    return Box(p.x, p.y + p.h * 0.09, p.w, p.h * 0.91)


def make_lab():
    """GraphLab of x² in panel 0 (left in 16:9, top in 9:16) + x tick labels BELOW the axis."""
    lab = GraphLab(graph_box(), "x**2", x_range=XR, y_range=YR)
    ticks = VGroup(*[Txt(num(k), role="tick").next_to(lab.axes.c2p(k, 0), DOWN, buff=L.u * 1.2)
                     for k in (1, 2, 3)])
    ticks._studio_parts = list(ticks)          # recorded as text (role tick), not one figure box
    return lab, ticks


def point(lab, x, big=True):
    """A point of the curve (role positive: the secant/tangent family)."""
    return Dot(lab.axes.c2p(x, float(f(x))), radius=L.u * (0.9 if big else 0.7), color=math_role("positive"))


def title(text):
    """The scene headline: left-aligned in L.title (never centered on a gradient)."""
    t = Txt(text, role="title")
    return t.move_to([L.title.x + t.width / 2, L.title.cy, 0])


def panel():
    return L.panel(1, 2)


def name_eq(top=True):
    """y = x² in the curve's color; centered in panel 1 (s01), then parked at its top (s02 on)."""
    e = Eq("y = x^2", role="vector")
    p = panel()
    if top:
        return e.move_to([p.cx, p.y + p.h - e.height / 2 - p.h * 0.06, 0])
    return e.move_to([p.cx, p.cy, 0])


def readout_fs():
    # 0.8 x math: the kit's slope_readout is 0.5 x math (4.5u in 16:9) — unreadable at phone size
    # (round-1 look); same layout, same row, same tracker semantics, bigger type.
    return _font_size("math") * 0.8


def live_readout(lab, value):
    """`slope = 2.00` in the lab's top row, laid out exactly like GraphLab.slope_readout (the same
    row, the same DecimalNumber lockup) but at readout_fs(); ``value()`` reads a tracker through
    the lab's sympy slope (``lab._slope``: the difference quotient, at h = 0 sympy.diff)."""
    fs = readout_fs()
    head = Eq(r"\text{slope} =", font_size=fs)
    val = DecimalNumber(value(), num_decimal_places=2, mob_class=MathTypst, font_size=fs,
                        color=math_role("result"))
    val.next_to(head, RIGHT, buff=L.u * 1.5)
    lock = VGroup(head, val).move_to(lab.readout_slot)
    lock._studio_parts = [head, val]
    anchor = head.get_right()

    def upd(m):
        m.set_value(value())
        m.set_color(math_role("result"))
        m.next_to(anchor, RIGHT, buff=L.u * 1.5)

    val.add_updater(upd)
    return lock


def fit_panel(g, fill=0.9):
    """Scale a panel-1 group down (never up) to fit, centered in the panel."""
    return into(g, panel(), fill=fill)


def end_scene(scene):
    """Close the scene ON THE GLOBAL FRAME GRID at the next scene's first voice start (= this scene's
    last sentence end + the 0.15 s gap): the scene lasts round(E*fps) - round(S0*fps) frames, so
    every scene starts within half a frame of its narration and seams never accumulate drift
    (round-2 measurement: a plain wait(GAP) lost ~1 frame per seam). renderer.time is frame-exact."""
    own = scene._scene_sentences()
    if not own:                                   # check runs / unvoiced: no clock to lock to
        scene.wait(GAP)
        return
    fps = float(scene.camera.frame_rate)
    s0, e = float(own[0]["start"]), float(own[-1]["end"]) + GAP
    target = (round(e * fps) - round(s0 * fps)) / fps
    rem = target - scene.renderer.time
    if rem > 0.5 / fps:
        scene.wait(rem - 0.25 / fps)              # np.arange(0, rem - dt/4, dt) = round(rem*fps) frames


TAN_W = 6                       # the tangent's stroke (the secants are the kit's thinner line)


def pause(scene, seconds):
    """Wait only when there is time to wait (until() may already be past: manim rejects wait(0))."""
    if seconds > 0.02:
        scene.wait(seconds)


def first_half(t):
    return smooth(min(1.0, 2 * t))


def second_half(t):
    return smooth(max(0.0, 2 * t - 1))


def below_name(g):
    """Center ``g`` in panel 1 (the algebra panel; y = x² has left it by s03), grown up to 1.5 x
    so the algebra fills 90% of the panel's width (round-2 look: it floated small)."""
    p = panel()
    k = min(1.5, p.w * 0.9 / g.width, p.h * 0.8 / g.height)
    g.scale(k)
    g.move_to([p.cx, p.cy, 0])
    return g


def limit_eq():
    """lim_{h→0} ((1+h)² − 1²)/h = 2 — the 2 from sympy.limit, never typed."""
    h = sp.Symbol("h")
    lim = sp.limit(((1 + h) ** 2 - 1) / h, h, 0)
    e = Eq(rf"\lim_{{h \to 0}} \frac{{(1+h)^2 - 1^2}}{{h}} = {{{{{num(lim)}}}}}", roles={"p1": "result"})
    return below_name(e), lim


def rows_and_formula():
    """x = 1, 2, 3 -> slope 2, 4, 6 (sympy.diff at each x), then slope = 2x (sympy.diff itself)."""
    dF = sp.diff(F, X)
    rows = VGroup(*[Eq(rf"x = {num(k)}: \quad \text{{slope}} = {{{{{num(dF.subs(X, k))}}}}}",
                       roles={"p1": "result"}) for k in (1, 2, 3)])
    rows.arrange(DOWN, buff=L.u * 4, aligned_edge=LEFT)
    below_name(rows)
    formula = Eq(rf"\text{{slope}} = {{{{{tex(dF)}}}}}", roles={"p1": "result"})
    below_name(formula)
    return rows, formula, dF


def tangent_at(lab, x):
    return lab._line(x, lab._slope(x, 0), math_role("positive")).set_stroke(width=TAN_W)


class Scene(StudioScene):
    """s04_slopes — the tangent rides the curve, the readout follows it live (2 → 4 → 6) and the
    pattern lands: slope = 2x."""

    scene_id = "s04_slopes"

    def construct(self):
        lab, ticks = make_lab()
        lab.add(lab.curve)
        xt = ValueTracker(1.0)
        # s03's end state (identical geometry)
        head0 = title("Shrink the gap")
        lim_e, _ = limit_eq()
        line = tangent_at(lab, 1)
        dot = point(lab, 1)
        readout = live_readout(lab, lambda: lab._slope(xt.get_value(), 0))   # f'(x) from sympy.diff
        self.add(lab, ticks, head0, lim_e, line, dot, readout)

        line.add_updater(lambda m: m.become(tangent_at(lab, xt.get_value())))
        dot.add_updater(lambda m: m.move_to(lab.axes.c2p(xt.get_value(), float(f(xt.get_value())))))
        head = title("The slope at every point")
        rows, formula, dF = rows_and_formula()
        d = L.u * 5

        with self.say("s04.1"):
            self.play(FadeOut(head0, shift=UP * d, rate_func=first_half),
                      FadeIn(head, shift=UP * d, rate_func=second_half),
                      collapse(lim_e, rows[0], run_time=0.9),
                      FadeIn(rows[0], rate_func=second_half), run_time=0.9)
            claim("diff(x**2, x).subs(x, 1) == 2", about="row x = 1: slope 2", says="s04.1")
            self.play(xt.animate.set_value(2), run_time=self.until("x2"), rate_func=smooth)
            self.play(Write(rows[1]), run_time=0.6)
            claim("diff(x**2, x).subs(x, 2) == 4", about="at x = 2 the slope is 4", says="s04.1")
            self.play(xt.animate.set_value(3), run_time=self.until("x3"), rate_func=smooth)
            self.play(Write(rows[2]), run_time=0.6)
            claim("diff(x**2, x).subs(x, 3) == 6", about="at x = 3 the slope is 6", says="s04.1")
        with self.say("s04.2"):
            line.clear_updaters()
            dot.clear_updaters()
            readout[1].clear_updaters()
            pause(self, self.until("double") - 0.5)
            self.play(collapse(rows, formula, run_time=0.5))
            self.play(Write(formula), run_time=0.8)
            claim("diff(x**2, x) == 2*x", about="the slope is always twice x", says="s04.2")
            claim(f"diff(x**2, x) == {dF}", about="the formula on screen", says="s04.2")
        end_scene(self)
