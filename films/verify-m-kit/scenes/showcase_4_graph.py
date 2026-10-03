from manim import FadeIn, FadeOut, ReplacementTransform, UP

from studio_manim import L, StudioScene, claim
from studio_manim.kit import GraphLab, chapter


class Scene(StudioScene):
    """showcase_4_graph — GraphLab: a secant slides into the tangent (live slope readout from the
    tracker), then Riemann sums refine (sums computed, the integral beside them)."""

    scene_id = "showcase_4_graph"

    def construct(self):
        head = chapter("Slope, then area", kicker="CALCULUS")
        lab = GraphLab(L.stage, "x**2/4 + 1", x_range=(0, 4))
        self.add(lab)
        self.play(head.enter(), lab.plot(), run_time=1.2)
        line, dots, slide = lab.tangent(2, h0=1.6)
        readout = lab.slope_readout()
        self.play(FadeIn(line), FadeIn(dots), FadeIn(readout), run_time=0.5)
        self.play(slide, run_time=2.0)
        claim("diff(x**2/4 + 1, x).subs(x, 2) == 1", about="slope at 2", scene=self.scene_id)
        self.wait(0.6)
        for m in (line, dots, readout):
            m.clear_updaters()
        r4 = lab.riemann(4)
        self.play(FadeOut(VG(line, dots, readout), shift=UP * L.u * 3), FadeIn(r4), run_time=0.8)
        r16 = lab.riemann(16)
        self.play(ReplacementTransform(r4, r16), run_time=1.0)
        self.wait(1.2)


def VG(*m):
    from manim import VGroup
    return VGroup(*m)
