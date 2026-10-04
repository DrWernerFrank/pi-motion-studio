"""s03_limit — tangent (the derivative as slope). The shared block below is identical in every
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
        return Box(L.stage.x, L.stage.y + L.stage.h * 0.38, L.stage.w, L.stage.h * 0.62)
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
    p = panel()
    g.scale(min(1.5, p.w * 0.9 / g.width, p.h * 0.8 / g.height))
    g.move_to([p.cx, p.cy, 0])
    return e1, e2, s


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


class Scene(StudioScene):
    """s03_limit — THE moment: the gap h shrinks 1 → 1/2 → 1/10 → 0 (the kit's GraphLab.tangent
    tracker ``lab.h``), the secant pivots into the tangent while the live readout on the graph
    (lab._slope: the difference quotient, at h = 0 sympy.diff) runs 3.00 → 2.50 → 2.10 → 2.00.
    h is never shown AS zero next to the quotient: at the landing "h = 0.00" becomes "h → 0"."""

    scene_id = "s03_limit"

    def construct(self):
        lab, ticks = make_lab()
        lab.add(lab.curve)
        ax = lab.axes
        # s02's end state (identical geometry), so the seam is invisible
        head0 = title("Two points, one secant")
        name = name_eq(top=True)
        e1, e2, _ = slope_eqs(1, 2)
        line, dots, _slide = lab.tangent(1, h0=1.0)     # the kit's limit machine: tracker lab.h
        hv = lab.h

        def seg_run():
            hh = max(hv.get_value(), 1e-3)
            return Line(ax.c2p(1, 1), ax.c2p(1 + hh, 1), color=math_role("negative"), stroke_width=5)

        def seg_rise():
            hh = max(hv.get_value(), 1e-3)
            return Line(ax.c2p(1 + hh, 1), ax.c2p(1 + hh, float(f(1 + hh))), color=color_for("ink"),
                        stroke_width=3.5)

        run, rise = seg_run(), seg_rise()
        run.add_updater(lambda m: m.become(seg_run()))
        rise.add_updater(lambda m: m.become(seg_rise()))
        self.add(lab, ticks, head0, name, e1, e2, run, rise, line, dots)

        head = title("Shrink the gap")
        quot = Eq(r"\text{slope} = \frac{(1+h)^2 - 1^2}{h}")
        fs = _font_size("math") * 0.8
        h_head = Eq("h =", font_size=fs)
        h_val = DecimalNumber(hv.get_value(), num_decimal_places=2, mob_class=MathTypst, font_size=fs,
                              color=math_role("negative"))
        h_val.next_to(h_head, RIGHT, buff=L.u * 1.5)
        h_lock = VGroup(h_head, h_val)
        stack = VGroup(quot, h_lock).arrange(DOWN, buff=L.u * 6)
        h_head_h0 = h_head.height
        below_name(stack)
        h_anchor = h_head.get_right()
        h_lock._studio_parts = [h_head, h_val]

        def upd_h(m):
            m.set_value(hv.get_value())
            m.set_color(math_role("negative"))
            m.next_to(h_anchor, RIGHT, buff=L.u * 1.5)

        h_val.add_updater(upd_h)
        readout = live_readout(lab, lambda: lab._slope(1, hv.get_value()))   # slope = 3.00, live
        h_to0 = Eq(r"h \to 0", font_size=fs).scale(h_head.height / h_head_h0).move_to(h_lock)
        lim_e, lim = limit_eq()
        d = L.u * 5

        with self.say("s03.1"):
            self.play(FadeOut(head0, shift=UP * d, rate_func=first_half),
                      FadeOut(name, e1, e2, shift=UP * d, rate_func=first_half),
                      FadeIn(head, shift=UP * d, rate_func=second_half), run_time=0.9)
            self.play(Write(quot), run_time=0.8)
            self.play(FadeIn(h_lock, shift=UP * L.u * 3), FadeIn(readout, shift=UP * L.u * 3), run_time=0.5)
            self.play(hv.animate.set_value(0.5), run_time=self.until("half"), rate_func=smooth)
            claim("(((1 + h)**2 - 1) / h).subs(h, Rational(1, 2)) == Rational(5, 2)",
                  about="h = 1/2: the secant slope 2.5", says="s03.1")
            self.play(hv.animate.set_value(0.1), run_time=self.until("tenth"), rate_func=smooth)
            claim("(((1 + h)**2 - 1) / h).subs(h, Rational(1, 10)) == Rational(21, 10)",
                  about="h = 1/10: the secant slope 2.1", says="s03.1")
        with self.say("s03.2"):
            self.play(hv.animate.set_value(0.0), run_time=self.until("tangent"), rate_func=smooth)
            run.clear_updaters()
            rise.clear_updaters()
            self.remove(run, rise, dots[1])
            line.clear_updaters()                        # h = 0: the secant IS the tangent now
            readout[1].clear_updaters()                  # the readout holds sympy's f'(1)
            h_val.clear_updaters()
            self.play(line.animate.set_stroke(width=TAN_W),
                      FadeOut(h_lock, shift=UP * L.u * 3, rate_func=first_half),
                      FadeIn(h_to0, shift=UP * L.u * 3, rate_func=second_half),
                      Indicate(readout[1], scale_factor=1.35, color=math_role("result")), run_time=0.8)
            pause(self, self.until("two") - 1.5)
            self.play(FadeOut(quot, shift=UP * d, rate_func=first_half),
                      FadeOut(h_to0, shift=UP * d, rate_func=first_half), run_time=0.5)
            self.play(Write(lim_e), run_time=self.until("two"))
            claim("limit(((1 + h)**2 - 1) / h, h, 0) == 2", about="the secants' limit: slope 2", says="s03.2")
            claim("diff(x**2, x).subs(x, 1) == 2", about="the tangent slope at x = 1 (sympy.diff)",
                  says="s03.2")
            claim(f"limit(((1 + h)**2 - 1) / h, h, 0) == {num(lim)}", about="the number on screen", says="s03.2")
        end_scene(self)
