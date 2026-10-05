import numpy as np
from manim import DL, Create, DashedVMobject, FadeIn, Write

from studio_manim import L, Eq, StudioScene, claim, color_for, math_role
from studio_manim.kit import EqMorph, gnomon

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
    s = min(1.0, ebox.w * 0.9 / widest.width)
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


class Scene(StudioScene):
    """s01_hook — no title card: one cell, an L of three wraps it, a 2x2 square (craft 9.1)."""

    scene_id = "s01_hook"

    def construct(self):
        box, ebox = stage_boxes()
        c, u = np.array([box.cx, box.cy, 0.0]), unit_for(box, 2)
        g1 = ell(1, u).shift(corner(c, 1, u))
        g2 = ell(2, u).shift(corner(c, 2, u))
        e1, e2 = odd_eqs(ebox, 2)
        # the question: where the next L would go (dashed, muted) — s02 fills it
        # r10 (critic): the s02 ghost's sibling — the dashed 3rd L at the big unit brushes the
        # hook equation; draw it at the pulled-back unit (stays home)
        _u3 = unit_for(box, 3)
        ghost = DashedVMobject(ell(3, _u3)[0].shift(corner(c, 3, _u3)).set_fill(opacity=0)
                               .set_stroke(color_for("muted"), 2.5), num_dashes=48)

        with self.say("s01.1"):
            self.add(g1)
            self.play(Write(e1), run_time=0.7)
            claim("1 == 1**2", about="one cell is a 1 by 1 square", says="s01.1")
            self.wait(self.until("wrap"))
            # the number and the shape arrive together: the 3 in the L's color as the L closes
            self.play(*wrap([g1], g2, c, 2, box), EqMorph(e1, e2), run_time=self.until("four"))
            claim("1 + 3 == 2**2", about="one plus three is the 2 by 2 square", says="s01.1")
            claim(f"{g2.cells} == 2*2 - 1", about="the L around one cell has 3 cells (counted on the gnomon)", says="s01.1")
        with self.say("s01.2"):
            self.play(Create(ghost), run_time=1.0)
        self.wait(0.15)  # the 0.15 s sentence gap: the next scene starts on its own first sentence
