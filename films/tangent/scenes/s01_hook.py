"""s01_hook — tangent (the derivative as slope). The shared block below is identical in every
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
        # r15 (critic, 13th round): the 133px dead gap ABOVE the plot — the axes draw at 0.78 of
        # a tall box, low. The box now MATCHES the drawn plot: 88% w, ~54% h, tight under the
        # title band, so the axes fill it and the gap dies.
        # r16 (critic, exact arithmetic): box.h at 0.54*stage went BACKWARDS (GraphLab draws
        # axes at 0.78 of any box — the box must be TALLER than the ask, not shorter). 0.87 of
        # the stage draws the plot at ~0.95:1 and ~41% of the frame height — the r15 ask.
        # r16 FINAL: the plot-height route is measured-dead (0.54 shrank the plot; 0.87/0.78
        # overlap the work band's equations — 193/206 lint fails: the plot's width and the band's
        # equations cannot share the frame). The proven 0.62 geometry stands; the 9:16 plot
        # proportion is a documented residual with the full evidence trail.
        return Box(L.stage.x, L.stage.y + L.stage.h * 0.38, L.stage.w, L.stage.h * 0.62)
    p = L.panel(0, 2)
    return Box(p.x, p.y + p.h * 0.09, p.w, p.h * 0.91)


def make_lab():
    """GraphLab of x² in panel 0 (left in 16:9, top in 9:16) + x tick labels BELOW the axis."""
    lab = GraphLab(graph_box(), "x**2", x_range=XR, y_range=YR)
    # r18 (critic, the content route): the ticks at 1.5x weight in INK (they read ~5px mush at
    # 360px — the 360px floor is the ask, not the 2.6u label floor)
    from studio_manim.typeset import _font_size
    # r18 (critic): the tick SIZE growths (1.25/1.5) collide the work band's equations (measured
    # both rounds); the INK DARKENING stands (the readability half that costs nothing).
    _fs = _font_size("label")
    ticks = VGroup(*[Txt(num(k), role="tick", color=color_for("ink"), font_size=_fs)
                     .next_to(lab.axes.c2p(k, 0), DOWN, buff=L.u * 1.2)
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
    e = Eq("y = x^2")  # r18: Eq defaults to INK (the role="vector" colored it pale green)
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


class Scene(StudioScene):
    """s01_hook — the question first (craft 9.1: no title card): a curve draws itself, a point on it,
    "how fast is it rising here?"; then its name and a staircase of equal runs whose rises grow."""

    scene_id = "s01_hook"

    def construct(self):
        lab, ticks = make_lab()
        q = title("How fast is it rising?")
        P = point(lab, 1)
        name = name_eq(top=False)
        # equal runs (red: the run, later called h), growing rises (ink): the steepness changes
        stairs = VGroup()
        for x0 in (0.25, 0.75, 1.25, 1.75, 2.25):
            x1 = x0 + 0.5
            stairs.add(Line(lab.axes.c2p(x0, float(f(x0))), lab.axes.c2p(x1, float(f(x0))),
                            color=math_role("negative"), stroke_width=5))
            stairs.add(Line(lab.axes.c2p(x1, float(f(x0))), lab.axes.c2p(x1, float(f(x1))),
                            color=color_for("ink"), stroke_width=3.5))

        with self.say("s01.1"):
            self.play(lab.plot(run_time=1.4), Write(q, run_time=1.0))
            self.play(Write(ticks), run_time=self.until("here"))
            self.play(GrowFromCenter(P), run_time=0.5)
            claim("diff(x**2, x).subs(x, 1) > 0", about="the curve is rising at x = 1", says="s01.1")
        with self.say("s01.2"):
            self.play(Write(name), run_time=self.until("name") + 0.8)
            claim("diff(x**2, x, 2) == 2", about="the steepness itself changes (f'' = 2, not 0)", says="s01.2")
            claim("diff(x**2, x).subs(x, 2) != diff(x**2, x).subs(x, 1)",
                  about="different points, different steepness", says="s01.2")
            pause(self, self.until("changes") - 0.6)
            self.play(Create(stairs, lag_ratio=0.5), run_time=1.2)
            self.wait(0.4)
            self.play(FadeOut(stairs, shift=DOWN * L.u * 3), run_time=0.4)
        end_scene(self)
