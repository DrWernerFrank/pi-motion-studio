import numpy as np
from manim import DL, DOWN, UP, Create, DashedVMobject, FadeIn, FadeOut, Indicate, Line, Transform, Write

from studio_manim import L, Eq, StudioScene, claim, color_for, math_role
from studio_manim.kit import EqMorph, chapter, gnomon

# -- the film's geometry: IDENTICAL in every odd-squares scene file (the scene cache hashes each
#    file on its own, so the helpers are copied, never imported from the film folder) -----------


def stage_boxes():
    """(square box, equation box). r9 (critic, geometric): a one-line 11.5:1 equation can never
    grow in a 6.26u half-panel — 16:9 re-splits 40/60 (the square keeps its visual weight at
    0.8 fill; the equations own 60% and the 2^2 clears the phone floor). Portrait: stacked 50/50."""
    if L.portrait:
        return L.panel(0, 2), L.panel(1, 2)
    from studio_manim.layout import _Box
    # r9 + lint: a 0.5u gutter between the panels (the equation brushed the square's dashed edge)
    # r10: under-dosed (7.49u vs the 8.5-9.6u prescription) — 36/64
    return (_Box(L.stage.x, L.stage.y, L.stage.w * 0.36 - L.u * 0.25, L.stage.h),
            _Box(L.stage.x + L.stage.w * 0.36 + L.u * 0.25, L.stage.y, L.stage.w * 0.64 - L.u * 0.25, L.stage.h))


def unit_for(box, n=5, fill=0.86):
    """One cell's side when an n x n square fills `fill` of the box's short side. The camera pulls
    back as the square grows: squares up to 3x3 share the 3x3 unit (the hook's cell is big)."""
    return min(box.w, box.h) * fill / max(n, 3)


def corner(c, m, u):
    """Bottom-left corner of an m x m square of cells centered on c."""
    return np.array(c, dtype=float) - np.array([m * u / 2, m * u / 2, 0.0])


def ell(k, u):
    """The k-th L (gnomon), in its own color (design.json math.roles gnomon1..5)."""
    return gnomon(k, u, role=f"gnomon{k}", opacity=0.78)  # r10 (critic): the r1 fix landed in s03 only — 0.55 was 2.2:1


def odd_eq(m):
    """1 + 3 + ... + (2m-1) = m^2, each odd number in its L's color, m^2 in the square's."""
    tex = " {{+}} ".join("{{%d}}" % (2 * i - 1) for i in range(1, m + 1)) + " {{=}} {{%d^2}}" % m
    e = Eq(tex)
    for i in range(1, m + 1):
        e.part(f"p{2 * i - 1}").set_color(math_role(f"gnomon{i}"))
    e.part(f"p{2 * m + 1}").set_color(math_role("square"))
    return e


def odd_eqs(ebox, upto):
    """e_1..e_upto at ONE shared scale (fit for e_5), left-aligned: the line grows to the right."""
    widest = odd_eq(5)
    # r6 (critic): grow into the panel's height as well — the ² was a 6.8px speck at 360px
    # r8 (critic, mechanism proven): the width coefficient (~0.88) structurally < the height
    # term — min() could never let height bind. The equations scale to the PANEL'S HEIGHT
    # (they own it), with width as the overflow guard: s = height-scale, capped by width.
    s = ebox.h * 0.8 / widest.height
    if widest.width * s > ebox.w * 0.98:          # overflow: the panel is the guard
        s = ebox.w * 0.98 / widest.width
    x0 = ebox.cx - widest.width * s / 2
    out = []
    for m in range(1, upto + 1):
        e = odd_eq(m).scale(s)
        e.move_to([x0 + e.width / 2, ebox.cy, 0])
        out.append(e)
    return out


def wrap(placed, g_new, c, k, box):
    """The wrap to k x k: the square so far rescales to the new unit (the camera pulls back) and
    slides half a cell down-left (it stays centered on c) while the k-th L — already placed at
    corner(c, k, unit_for(box, k)) — slides in from the upper right and closes around it."""
    uo, un = unit_for(box, k - 1), unit_for(box, k)
    moves = [g.animate.scale(un / uo, about_point=c).shift(DL * un / 2) for g in placed]
    return moves + [FadeIn(g_new, shift=DL * un)]


def bar_under(e, name, color):
    """A short rule under one term of the sum — the pointer that pairs a number with its L."""
    p = e.part(name)
    y = p.get_bottom()[1] - L.u * 1.6
    return Line([p.get_left()[0], y, 0], [p.get_right()[0], y, 0]).set_stroke(color, 8)


class Scene(StudioScene):
    """s02_pattern — the L's keep coming: 3x3, 4x4, 5x5, each L its own color, each lands on a word."""

    scene_id = "s02_pattern"

    def construct(self):
        box, ebox = stage_boxes()
        c, u = np.array([box.cx, box.cy, 0.0]), unit_for(box, 2)
        gs = [ell(1, u).shift(corner(c, 2, u)), ell(2, u).shift(corner(c, 2, u))]  # the s01 end state
        for k in (3, 4, 5):                   # where each L lands, at its own (pulled-back) unit
            gs.append(ell(k, unit_for(box, k)).shift(corner(c, k, unit_for(box, k))))
        eqs = odd_eqs(ebox, 5)
        # lint/r9: the dashed 3rd L (at the big 2x2 unit) reached 0.9u into the equation panel —
        # draw the ghost at the PULLED-BACK unit (the one the real 3rd L will use) so it stays home
        _u3 = unit_for(box, 3)
        ghost = DashedVMobject(ell(3, _u3)[0].shift(corner(c, 3, _u3)).set_fill(opacity=0)
                               .set_stroke(color_for("muted"), 2.5), num_dashes=48)
        self.add(gs[0], gs[1], eqs[1], ghost)
        ch = chapter("Odd numbers make squares")

        def grow(k, run_time):
            # the dashed question of s01 is answered: it clears as the 3rd L slides into its place
            extra = [FadeOut(ghost, run_time=run_time * 0.4)] if k == 3 else []
            self.play(*wrap(gs[:k - 1], gs[k - 1], c, k, box), *extra, EqMorph(eqs[k - 2], eqs[k - 1]),
                      run_time=run_time)

        with self.say("s02.1"):
            self.play(ch.enter(run_time=0.9))
            grow(3, self.until("nine"))
            claim("1 + 3 + 5 == 3**2", about="three L's make the 3 by 3 square", says="s02.1")
        with self.say("s02.2"):
            grow(4, self.until("sixteen"))
            claim("1 + 3 + 5 + 7 == 4**2", about="four L's make the 4 by 4 square", says="s02.2")
            grow(5, self.until("twentyfive"))
            claim("1 + 3 + 5 + 7 + 9 == 5**2", about="five L's make the 5 by 5 square", says="s02.2")
        with self.say("s02.3"):
            e5 = eqs[4]
            bar = bar_under(e5, "p1", math_role("gnomon1"))
            self.wait(self.until("each"))
            for k in range(1, 6):
                col = math_role(f"gnomon{k}")
                nxt = bar_under(e5, f"p{2 * k - 1}", col)
                first = Create(bar) if k == 1 else Transform(bar, nxt)
                self.play(Indicate(gs[k - 1], color=col, scale_factor=1.04), first, run_time=0.55)
            claim("5**2 - 4**2 == 9", about="the 5th L is the step from 4x4 to 5x5", says="s02.3")
            claim("summation(2*k - 1, (k, 1, 5)) == 25", about="the five odd numbers fill 25 cells", says="s02.3")
            self.play(FadeOut(bar), FadeOut(ch, shift=UP * L.u * 4), run_time=0.5)
        self.wait(0.15)
