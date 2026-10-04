import numpy as np
from manim import DL, UP, FadeIn, VGroup

from studio_manim import L, Eq, StudioScene, Txt, claim, color_for, math_role
from studio_manim.kit import gnomon, hold, into, recap

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
    return gnomon(k, u, role=f"gnomon{k}", opacity=0.55)


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
    """s05_recap — the square rebuilds itself L by L beside three lines; the takeaway held (craft 9.6)."""

    scene_id = "s05_recap"

    def construct(self):
        box, ebox = stage_boxes()
        c = np.array([box.cx, box.cy, 0.0])
        gs = [ell(k, unit_for(box, k)).shift(corner(c, k, unit_for(box, k))) for k in range(1, 6)]
        # critic R2: the takeaway was the smallest text on screen — the hierarchy inverts it:
        # the headline IS the takeaway, at title size, revealed FIRST; the formulas support it
        # critic r3: the finale's SIZE hierarchy was still inverted (title 9u < math 12u in this
        # film's ladder). The takeaway is the film's HERO line — built at hero size, then the
        # stack fits its box (the order inversion of r2 + the scale inversion of r3, both closed).
        from studio_manim.typeset import _font_size
        # r5/r6 (self-review): the portrait finale stayed inverted (Σ 55-60px > headline 28-30px)
        # because recap()'s group fit shrinks every line EQUALLY and the hero's two wrapped lines
        # carry less height than the Σ's — after the fit the Σ wins again. The formulas enter the
        # group PRE-SCALED DOWN (0.62x) so the fit preserves the hierarchy: hero > Σ > k-line.
        from studio_manim.layout import L as _L
        hero = Txt("odd numbers\nstack into squares", role="title",
                   font_size=_font_size("hero") * (1.0 if not _L.portrait else 1.35))
        # critic r4: the portrait finale was still inverted — the hero's TWO LINES each fit the
        # safe width (no shrink needed; the earlier inversion came from the GROUP fit shrinking
        # everything equally). Build the hero at hero size and let recap()'s own fit do its work.
        _sum = Eq(r"\sum_{k=1}^{n} (2k-1) = {{n^2}}", roles={"p1": "square"})
        _kln = Eq(r"{{k^2}} - {{(k-1)^2}} = 2k-1", roles={"p1": "square", "p2": "square"})
        if L.portrait:
            _sum.scale(0.72); _kln.scale(0.72)   # the hero keeps its size lead through the fit
        lines = recap([
            hero,
            _sum,
            _kln,
        ])
        into(lines, ebox, fill=0.9)
        l1, l2, l3 = lines.submobjects  # headline, the sum (the payoff), the k-th L

        with self.say("s05.1"):
            self.add(gs[0])
            self.play(FadeIn(l1, shift=UP * L.u * 3), run_time=0.5)
            for k in range(2, 6):
                self.play(*wrap(gs[:k - 1], gs[k - 1], c, k, box), run_time=0.4)
            claim("summation(2*k - 1, (k, 1, 5)) == 5**2", about="the rebuilt square: five L's", says="s05.1")
            # r7 (critic): the cues were CROSSED — the Σ line must land on "sum", the k-th-L line
            # on "kth" (the narration says the k-th L first, the sum second — see script.md)
            self.wait(self.until("kth"))
            self.play(FadeIn(l3, shift=UP * L.u * 3), run_time=0.7)   # the k-th L line on "kth"
            claim("k**2 - (k - 1)**2 == 2*k - 1", about="recap: the k-th L", says="s05.1")
            self.wait(self.until("sum"))
            self.play(FadeIn(l2, shift=UP * L.u * 3), run_time=0.7)   # the SUM on "sum"
            claim("summation(2*k - 1, (k, 1, n)) == n**2", about="recap: the sum", says="s05.1")
        hold(self, 1.6)
