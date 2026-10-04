"""s06_recap — tangent (the derivative as slope). The shared block below is identical in every
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


def rule_rows(x_eq):
    """d/dx xⁿ for n = 2, 3 and general n — every right side is sympy.diff's (latex'd), never typed.
    One shared scale (up to 1.6 x math; the column fits 90% of the stage's width and 88% of its
    height); every row's '=' sits at ``x_eq`` (the derivation's '=')."""
    n = sp.Symbol("n")
    out = []
    for p in (2, 3, n):
        d = sp.powsimp(sp.simplify(sp.diff(X ** p, X)))
        rhs = tex(d) if p != n else r"n\, x^{n - 1}"
        out.append((Eq(rf"\frac{{d}}{{dx}}\, x^{{{sp.latex(p)}}} {{{{=}}}} {{{{{rhs}}}}}",
                       roles={"p2": "result"}), d))
    left = max(e.part("p1").get_center()[0] - e.get_left()[0] for e, _ in out)
    right = max(e.get_right()[0] - e.part("p1").get_center()[0] for e, _ in out)
    room = 2 * min(x_eq - L.stage.x, L.stage.x + L.stage.w - x_eq) * 0.94
    hsum = sum(e.height for e, _ in out) + 2 * ROW_BUFF
    k = min(1.6, room / (2 * max(left, right)), L.stage.h * 0.88 / hsum)
    for e, _ in out:
        e.scale(k)
        e.shift([x_eq - e.part("p1").get_center()[0], 0, 0])
    return out


ROW_BUFF = L.u * 8


def column_ys(mobs, buff):
    """The y of each mobject when stacked (measured heights) and centered in the stage."""
    col = VGroup(*[m.copy() for m in mobs]).arrange(DOWN, buff=buff)
    col.move_to([L.stage.cx, L.stage.cy, 0])
    return [m.get_center()[1] for m in col]


def derivation():
    """EqSteps of the difference quotient, grown up to 1.3 x (fits 94% of the stage width)."""
    steps = EqSteps(STEPS, L.stage, role="result")
    k = min(1.5, L.stage.w * 0.94 / steps.width)
    steps.scale(k)
    steps.shift([L.stage.cx - steps.get_center()[0], 0, 0])
    return steps


STEPS = [
    r"{{\frac{(x+h)^2 - x^2}{h}}} {{=}} \frac{x^2 + 2xh + h^2 - x^2}{h}",
    r"{{\frac{(x+h)^2 - x^2}{h}}} {{=}} \frac{2xh + h^2}{h}",
    r"{{\frac{(x+h)^2 - x^2}{h}}} {{=}} 2x + h",
    r"\lim_{h \to 0} {{\frac{(x+h)^2 - x^2}{h}}} {{=}} 2x",
]


class Scene(StudioScene):
    """s06_recap — three lines (craft 9.6), each revealed on its words, then the hold."""

    scene_id = "s06_recap"

    def construct(self):
        # s05's end state: the title and the three rule rows in their final slots
        head0 = title("The power rule")
        rows = [e for e, _ in rule_rows(derivation().eqs[-1].part("p2").get_center()[0])]
        for e, y in zip(rows, column_ys(rows, ROW_BUFF)):
            e.shift([0, y - e.get_center()[1], 0])
        self.add(head0, *rows)

        br = "\n" if L.portrait else " "
        last = Eq(r"\frac{d}{dx}\, x^n = {{n\, x^{n - 1}}}", roles={"p1": "result"},
                  font_size=_font_size("math") * 1.6)      # the rule weighs as much as a sentence
        card = recap([
            Txt(f"The derivative is{br}the slope of the tangent.", role="title"),
            Txt(f"The tangent is the limit{br}of the secants.", role="title"),
            last,
        ])
        k = min(1.55, L.stage.w * 0.9 / card.width, L.stage.h * 0.86 / card.height)
        # critic r3: the recap ran 65% empty with a 43% top void. The k cap lifts to 1.55 (the
        # card fills the stage) AND the hold gets a settle: the last line's arrival pulses the
        # rule's role color so the final 3 s are not fully static.
        card.scale(k).move_to([L.stage.cx, L.stage.cy, 0])        # the takeaway fills the stage
        d = L.u * 5

        with self.say("s06.1"):
            self.play(FadeOut(head0, *rows, shift=UP * d), run_time=0.6)
            self.play(FadeIn(card[0], shift=UP * L.u * 3), run_time=0.8)
            claim("diff(x**2, x).subs(x, 1) == limit(((1 + h)**2 - 1) / h, h, 0)",
                  about="the derivative IS the limit of the secant slopes", says="s06.1")
            pause(self, self.until("limit") - 0.3)
            self.play(FadeIn(card[1], shift=UP * L.u * 3), run_time=0.8)
            pause(self, self.until("rule") - 0.3)
            self.play(FadeIn(card[2], shift=UP * L.u * 3), run_time=0.8)
            claim("diff(x**n, x) == n*x**(n - 1)", about="the recap's rule", says="s06.1")
            # critic r5/r6: there_and_back rendered as a ONE-FRAME pop (a deferred-Eq re-render).
            # Two explicit smooth plays, and the second returns to EXACTLY 1.0 (the there_and_back
            # left the rule ~0.5% smaller permanently).
            import manim as _m
            self.play(card[2].animate.scale(1.05), run_time=0.35, rate_func=_m.smooth)
            self.play(card[2].animate.scale(1.0 / 1.05), run_time=0.35, rate_func=_m.smooth)
        hold(self, 1.2)
