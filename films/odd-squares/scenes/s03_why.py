from types import SimpleNamespace

import numpy as np
from manim import DL, ORIGIN, RIGHT, UP, UR, Create, FadeIn, FadeOut, Rectangle, Square, Transform, VGroup, Write

from studio_manim import L, Eq, StudioScene, claim, color_for, math_role
from studio_manim.kit import Callout, EqMorph, chapter, gnomon, into, swap

# -- the film's geometry: IDENTICAL in every odd-squares scene file (the scene cache hashes each
#    file on its own, so the helpers are copied, never imported from the film folder) -----------


def stage_boxes():
    """(square box, equation box): side by side in landscape, stacked in portrait (L.panel)."""
    return L.panel(0, 2), L.panel(1, 2)


def unit_for(box, n=5, fill=0.86):
    """One cell's side when an n x n square fills `fill` of the box's short side. The camera pulls
    back as the square grows: squares up to 3x3 share the 3x3 unit (the hook's cell is big)."""
    return min(box.w, box.h) * fill / max(n, 3)


def corner(c, m, u):
    """Bottom-left corner of an m x m square of cells centered on c."""
    return np.array(c, dtype=float) - np.array([m * u / 2, m * u / 2, 0.0])


def ell(k, u):
    """The k-th L (gnomon), in its own color (design.json math.roles gnomon1..5)."""
    return gnomon(k, u, role=f"gnomon{k}", opacity=0.78)  # critic R1: 0.55 was 2.4:1 on cream; 0.78 clears 3:1


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


def dimmed(g, on=True):
    """A copy of an L with its fill knocked back (the old square recedes; the 4th L leads)."""
    d = g.copy()
    if on:
        d[0].set_fill(opacity=0.22).set_stroke(opacity=0.55)  # critic R1: the dimmed floor was invisible (1.17:1)
        d[1].set_stroke(opacity=0.45)
    return d


class Scene(StudioScene):
    """s03_why — the 4th L is a column of 4 and a row of 3; in general k and k-1: 2k-1 = k^2-(k-1)^2."""

    scene_id = "s03_why"

    def construct(self):
        box, ebox = stage_boxes()
        c, u = np.array([box.cx, box.cy, 0.0]), unit_for(box)
        gs = [ell(k, u).shift(corner(c, 5, u)) for k in range(1, 6)]   # the s02 end state
        e5 = odd_eqs(ebox, 5)[-1]
        self.add(*gs, e5)

        # the target figure, built around ORIGIN then fitted into the box as ONE group:
        # the 4x4 (L's 1..4), braces on the 4th L's two arms, their k-labels, the two squares
        o = corner(ORIGIN, 4, u)
        ts = [ell(k, u).shift(o) for k in range(1, 5)]
        col = Rectangle(width=u, height=4 * u).move_to(o + np.array([3.5 * u, 2 * u, 0]))
        row = Rectangle(width=3 * u, height=u).move_to(o + np.array([1.5 * u, 3.5 * u, 0]))
        # the figure is fitted into the box AFTER it is built, so the callouts must not clamp their
        # labels into L.stage while it still sits around ORIGIN (a clamped "3" lands on the square)
        free = SimpleNamespace(x=-1e3, y=-1e3, w=2e3, h=2e3)
        cc = Callout(col, Eq("4", role="measure"), kind="brace", direction=RIGHT, role="measure", box=free)
        rc = Callout(row, Eq("3", role="measure"), kind="brace", direction=UP, role="measure", box=free)
        kc = Eq("k", role="measure").next_to(cc.shape, RIGHT, buff=L.u * 2.2)
        kr = Eq("k-1", role="measure").next_to(rc.shape, UP, buff=L.u * 2.2)
        sq_col = math_role("square")
        inner = Square(3 * u).move_to(o + np.array([1.5 * u, 1.5 * u, 0])).set_stroke(sq_col, 5).set_fill(opacity=0)
        outer = Square(4 * u).move_to(o + np.array([2 * u, 2 * u, 0])).set_stroke(sq_col, 5).set_fill(opacity=0)
        fig = VGroup(*ts, cc, rc, kc, kr, inner, outer)
        into(fig, box, fill=0.94)
        lit = [t.copy() for t in ts]                        # the old square, full color (s03.3)
        dim = [dimmed(t) for t in ts[:3]] + [ts[3]]

        # the equation slot, built as the arms are counted, then generalised, then read as squares:
        # 4 -> 4 + 3 -> 4 + 3 = 7 -> k + (k-1) = 2k-1 -> k^2 - (k-1)^2 = 2k-1 (one left edge: it grows right)
        e4 = Eq(r"{{4}}", roles={"p1": "measure"})
        e43 = Eq(r"{{4}} {{+}} {{3}}", roles={"p1": "measure", "p3": "measure"})
        e47 = Eq(r"{{4}} {{+}} {{3}} {{=}} {{7}}", roles={"p1": "measure", "p3": "measure", "p5": "gnomon4"})
        ek = Eq(r"{{k}} {{+}} {{(k-1)}} {{=}} {{(2k-1)}}", roles={"p1": "measure", "p3": "measure"})
        ek2 = Eq(r"{{k^2}} - {{(k-1)^2}} {{=}} {{(2k-1)}}", roles={"p1": "square", "p2": "square"})
        slot = (e4, e43, e47, ek, ek2)
        wmax = max(e.width for e in slot)
        s = min(1.0, ebox.w * 0.9 / wmax)
        x0 = ebox.cx - wmax * s / 2
        for e in slot:
            e.scale(s)
            e.shift([x0 - e.get_left()[0], ebox.cy - e.get_center()[1], 0])
        ch = chapter("Why the L fits")

        with self.say("s03.1"):
            self.play(FadeOut(e5, shift=UP * L.u * 6), FadeOut(gs[4], shift=UR * u), run_time=0.5)
            self.play(*[Transform(g, d) for g, d in zip(gs[:4], dim)], ch.enter(run_time=0.8),
                      run_time=max(0.8, self.until("col")))
            self.play(cc.create(run_time=1.0), Write(e4, run_time=1.0))
            self.wait(self.until("row"))
            self.play(rc.create(run_time=1.0), EqMorph(e4, e43, run_time=1.0))
            self.wait(self.until("seven"))
            self.play(EqMorph(e43, e47), run_time=0.8)
            claim("4 + 3 == 7", about="column of 4 plus row of 3", says="s03.1")
            claim(f"{gs[3].cells} == 2*4 - 1", about="the 4th L has 7 cells (counted on the gnomon)", says="s03.1")
        with self.say("s03.2"):
            self.wait(self.until("colk"))
            swap(self, cc.label, kc, direction=UP, run_time=0.6)
            self.wait(self.until("rowk"))
            swap(self, rc.label, kr, direction=UP, run_time=0.6)
            self.wait(self.until("total"))
            self.play(EqMorph(e47, ek), run_time=0.9)
            claim("k + (k - 1) == 2*k - 1", about="column of k plus row of k-1", says="s03.2")
            claim(f"{sum(gnomon(j).cells for j in range(1, 6))} == 5**2", about="the L's counted on the kit's gnomons fill 5x5", says="s03.2")
        with self.say("s03.3"):
            self.play(*[Transform(g, t) for g, t in zip(gs[:3], lit[:3])], Create(inner), run_time=0.9)
            self.play(Create(outer), run_time=max(0.6, self.until("diff")))
            self.play(EqMorph(ek, ek2), run_time=0.9)
            claim("k**2 - (k - 1)**2 == 2*k - 1", about="the L is the difference of two squares", says="s03.3")
            claim("4**2 - 3**2 == 7", about="for the 4th L", says="s03.3")
        self.wait(0.15)
