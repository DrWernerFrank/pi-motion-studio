"""s02_secant — tangent (the derivative as slope). The shared block below is identical in every
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
    """The graph's box. PORTRAIT (critic r3): the plot measured only 17-25% of the 9:16 frame —
    a 2:1-wide box in a tall frame wastes ~45% vertical. Portrait gives the graph 62% of the
    stage's height (a real re-proportion, not a scaled copy); landscape keeps panel 0. The bottom
    9% stays reserved for the tick labels."""
    if L.portrait:
        # critic r6: the full-width window drew a squat ~0.8:1 plot (29% of frame height). A
        # square-ish window (88% w x 62% h) grows the plot and centers it.
        w = L.stage.w * 0.88
        return Box(L.stage.x + (L.stage.w - w) / 2, L.stage.y + L.stage.h * 0.38, w, L.stage.h * 0.62)
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
    """The work column: panel 1 in landscape; the lower 38% of the stage in portrait (the graph
    took 62% — critic r3's re-proportion)."""
    if L.portrait:
        return Box(L.stage.x, L.stage.y, L.stage.w, L.stage.h * 0.38)
    return L.panel(1, 2)


def name_eq(top=True):
    """y = x² in the curve's color; centered in panel 1 (s01), then parked at its top (s02 on)."""
    e = Eq("y = x^2", role="vector")
    p = panel()
    if top:
        return e.move_to([p.cx, p.y + p.h - e.height / 2 - p.h * 0.06, 0])
    return e.move_to([p.cx, p.cy, 0])


def readout_fs():
    # critic r3: 0.8x read ~6px at 360px in 16:9 — the phone test judges the spine's instrument.
    # Full math in 9:16 (18px@360 verified); 1.25x in 16:9 where the HUD row has the room.
    from studio_manim.layout import L
    return _font_size("math") * (1.25 if not L.portrait else 1.0)


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


def slope_eqs(x1, x2):
    """The worked secant slope, every number computed: (f(x2) - f(x1)) / (x2 - x1) = s."""
    y1, y2 = f(x1), f(x2)
    s = sp.Rational(y2 - y1, x2 - x1)
    e1 = Eq(rf"\text{{slope}} = \frac{{{num(y2)} - {num(y1)}}}{{{num(x2)} - {num(x1)}}}")
    e2 = Eq(rf"= {num(s)}", role="result")
    e2.next_to(e1, RIGHT, buff=L.u * 2)
    g = VGroup(e1, e2)
    # portrait: a dedicated 30% EQUATION zone UNDER the (62%) graph — its own band, clear of the
    # curve (the graph-panel strip attempt overlapped the parabola itself). 16:9: the work panel.
    if L.portrait:
        strip = Box(L.stage.x, L.stage.y, L.stage.w, L.stage.h * 0.30)
    else:
        strip = panel()
    g.scale(min(1.5, strip.w * 0.92 / g.width, strip.h * 0.8 / g.height))
    g.move_to([strip.cx, strip.cy, 0])
    return e1, e2, s


class Scene(StudioScene):
    """s02_secant — two points, the chord through them, its slope computed: rise 3 over run 1 = 3."""

    scene_id = "s02_secant"

    def construct(self):
        lab, ticks = make_lab()
        lab.add(lab.curve)
        q = title("How fast is it rising?")          # s01's end state, so the seam is invisible
        name0 = name_eq(top=False)
        P = point(lab, 1)
        self.add(lab, ticks, q, name0, P)

        head = title("Two points, one secant")
        name = name_eq(top=True)
        Q = point(lab, 2, big=False)
        secant = lab.secant(1, 2)
        run = Line(lab.axes.c2p(1, 1), lab.axes.c2p(2, 1), color=math_role("negative"), stroke_width=5)
        rise = Line(lab.axes.c2p(2, 1), lab.axes.c2p(2, 4), color=color_for("ink"), stroke_width=3.5)
        e1, e2, s = slope_eqs(1, 2)

        with self.say("s02.1"):
            swap(self, q, head, direction=UP, run_time=0.8)
            self.play(name0.animate.move_to(name), run_time=0.7)
            pause(self, self.until("p1") - 0.1)
            self.play(Indicate(P, scale_factor=1.6, color=math_role("positive")), run_time=0.8)
            pause(self, self.until("p2") - 0.1)
            self.play(GrowFromCenter(Q), run_time=0.6)
            claim("(x**2).subs(x, 1) == 1", about="the first point (1, 1)", says="s02.1")
            claim("(x**2).subs(x, 2) == 4", about="the second point (2, 4)", says="s02.1")
        with self.say("s02.2"):
            self.play(Create(secant), run_time=1.2)
            pause(self, self.until("rise") - 0.4)
            self.play(Create(run), Create(rise), run_time=0.8)
            self.play(Write(e1), run_time=1.2)
            self.play(Write(e2), run_time=self.until("three"))
            claim("((x**2).subs(x, 2) - (x**2).subs(x, 1)) / (2 - 1) == 3", about="rise 3 over run 1", says="s02.2")
            claim(f"Rational({num(f(2) - f(1))}, {num(2 - 1)}) == {num(s)}",
                  about="the secant slope shown on screen", says="s02.2")
        end_scene(self)
