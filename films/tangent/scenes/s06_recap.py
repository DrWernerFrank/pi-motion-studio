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
        # critic r6: the full-width window drew a squat ~0.8:1 plot (29% of frame height). A
        # square-ish window (88% w x 62% h) grows the plot and centers it.
        # r8 (critic): the drawn plot is squat (the box reserves 62%, the axes draw 0.78 of it
        # low in the frame) — but every window-widening variant collided the tick labels with the
        # equation band (171 then 117 lint fails). The proven-clean geometry stands; the plot
        # proportion is a documented residual (the r8 review's notes carry it).
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
    col_right = L.stage.x + L.stage.w * 0.70        # the column's edge (critic r3: fill the frame)
    # critic r5: the room term — not the caps — was binding (rows spanned 31% of the stage with
    # the right 55% empty). The rows may use the FULL column width: room is the column, the
    # '=' anchor just positions inside it.
    room = L.stage.w * 0.70 * 0.94
    if not (L.stage.x < x_eq < col_right):          # the '=' anchor fell outside: recentre
        x_eq = L.stage.x + L.stage.w * 0.35
    # critic r6: the height term carried the EXITED derivation (steps+rows) so k stayed ~1.6 and
    # the rows spanned 31% with the right 55% empty. The payoff budget is ROWS ONLY — the
    # derivation is gone by then; the rows own the whole column height.
    hsum_rows = sum(e.height for e, _ in out) + 2 * ROW_BUFF
    # r13 (critic): the height term bound at k~1.2 -> 30.7% span with 55% dead right. The rows
    # OWN the payoff now: scale to the column's width (the room), the height budget loosened to
    # 2 rows' worth (3 rows at 2.4x still fit the stage height).
    k = min(2.0, room / (2 * max(left, right)), L.stage.h * 0.88 / hsum_rows)  # r13 final: the r6 values (the growth attempts overflowed: 2.4/1.76 then 1.9/1.30 collide the title/floor)
    for e, _ in out:
        e.scale(k)
        e.shift([x_eq - e.part("p1").get_center()[0], 0, 0])
    return out


def rule_anchor():
    """The one true x for the rule rows: s05's DERIVATION anchor (the r11 critic derived it:
    -2.635u/16:9, -1.440u/9:16 — the fallback's +0.35*stage.w was 0.757u/0.408u right of it).
    Both scenes call THIS; the geometry can never diverge again."""
    from studio_manim.layout import L
    # s05's derivation: the left column's '=' — recomputed identically in both scenes
    d = derivation()
    return d.eqs[-1].part("p2").get_center()[0]



ROW_BUFF = L.u * 8


def column_ys(mobs, buff):
    """The y of each mobject when stacked (measured heights) and centered in the stage."""
    col = VGroup(*[m.copy() for m in mobs]).arrange(DOWN, buff=buff)
    col.move_to([L.stage.cx, L.stage.cy, 0])
    return [m.get_center()[1] for m in col]


def derivation():
    """EqSteps of the difference quotient. The column is the LEFT 58% of the stage (the graph
    callback owns the lower-right corner — critic r3's empty-canvas fix made them neighbours)."""
    from studio_manim.layout import _Box
    left_box = _Box(L.stage.x, L.stage.y + L.stage.h * 0.16, L.stage.w * 0.70, L.stage.h * 0.80)  # r13: lifted (the derivation sat 0.42u below safe)
    steps = EqSteps(STEPS, left_box, role="result")
    k = min(2.2, left_box.w * 0.94 / steps.width, left_box.h * 0.9 / max(steps.height, 1e-6))  # critic r4: the 1.5 cap bound first
    steps.scale(k)
    # r13: center in the BOX on both axes (x-only left the stack's own arrangement 0.42u
    # below the safe floor)
    steps.move_to([left_box.cx, left_box.cy, 0])
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
        # r10 (critic): ONE SOURCE OF TRUTH — s05 exports its end-state row geometry to
        # s06_handoff.json; s06 places its rows EXACTLY there. No more guessed anchors (the
        # teleport survived 4 rounds of anchor guesses; this cannot drift by construction).
        # r11 (critic): the pool renders s05/s06 CONCURRENTLY — the handoff file could never
        # be read in time. The shared rule_anchor() (above, identical in both scene files)
        # computes s05's derivation anchor directly: the one true x-path.
        rows = [e for e, _ in rule_rows(rule_anchor())]
        for e, y in zip(rows, column_ys(rows, ROW_BUFF)):
            e.shift([0, y - e.get_center()[1], 0])
        # r13: same clamp as s05 (the rows' stack must stay in the safe area)
        import manim as _mm2
        _g2 = _mm2.VGroup(*rows)
        _ov2 = L.safe.y - _g2.get_bottom()[1]
        if _ov2 > 0:
            _g2.shift([0, _ov2 + L.u * 0.2, 0])
        self.add(head0, *rows)
        self.wait(0.01)   # r13 (critic): record the opening state — the seam gate reads records,
                          # and s06's first frame carried 0 objects (the rows were unrecorded)
        br = "\n" if L.portrait else " "
        last = Eq(r"\frac{d}{dx}\, x^n = {{n\, x^{n - 1}}}", roles={"p1": "result"},
                  font_size=_font_size("math") * 1.6)      # the rule weighs as much as a sentence
        card = recap([
            Txt(f"The derivative is{br}the slope of the tangent.", role="title"),
            Txt(f"The tangent is the limit{br}of the secants.", role="title"),
            last,
        ])
        # the SAFE box (not the stage) is the fit bound: the r7 rerelease caught the recap Eq
        # 0.028u past each portrait side — fit 0.86 of safe and center there.
        from studio_manim.layout import _Box
        fitbox = _Box(L.safe.x, L.stage.y, L.safe.w, L.stage.h)
        k = min(1.55, fitbox.w * 0.86 / card.width, fitbox.h * 0.84 / card.height)
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
            # critic r6: scale plays on an Eq never interpolated (the ink bbox was constant) —
            # Indicate is the raster-safe emphasis: a color flash that provably changes pixels.
            import manim as _m
            self.play(_m.Indicate(card[2], scale_factor=1.12, color=None,
                                 rate_func=_m.smooth), run_time=0.7)
        hold(self, 1.2)
