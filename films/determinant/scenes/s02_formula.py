from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import Matrix as SMatrix


class Scene(StudioScene):
    """s02_formula — the 2x2 formula with the worked example (every number computed)."""

    scene_id = "s02_formula"

    def construct(self):
        head = Txt("The two-by-two formula", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        A = SMatrix([[3, 1], [1, 2]])
        formula = Eq(
            r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = {{ad}} - {{bc}}",
            roles={"p1": "positive", "p2": "negative"},
        )
        worked = Eq(r"= 3 \cdot 2 - 1 \cdot 1 = {{5}}", roles={"p1": "result"})
        # the stack is CHAINED then CENTERED as one group in the stage (the first draft chained off
        # a panel-centered matrix and the worked line landed 0.45u BELOW the frame — the gate caught it)
        step = max(0.7, L.stage.h * 0.08)
        formula.next_to(A, DOWN, buff=step)
        worked.next_to(formula, DOWN, buff=step * 0.8)
        from manim import VGroup
        from studio_manim.kit import into
        # critic R3: the card sat small in the top half, bottom 50% empty. Lift it toward the
        # stage's full height (into() only shrinks — pre-scale against the STAGE box, anchored
        # at the group's bottom so it grows DOWN, not into the title band), then fit the safe box.
        from studio_manim.layout import _Box
        g = VGroup(A, formula, worked)
        grow = (L.stage.h * 0.92) / max(g.height, 1e-6)
        g.scale(min(1.6, max(1.0, grow)), about_point=g.get_bottom())
        into(g, _Box(L.safe.x, L.stage.y + L.stage.h * 0.04, L.safe.w, L.stage.h * 0.96), fill=0.94)

        with self.say("s02.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(A), run_time=1.2)
            self.play(Write(formula), run_time=self.until("formula"))
            claim("Matrix([[a, b], [c, d]]).det() == a * d - b * c", about="the general formula, symbolic", says="s02.1")
        with self.say("s02.2"):
            self.play(Write(worked), run_time=self.until("lands"))
            claim("3 * 2 - 1 * 1 == 5", about="the worked example", says="s02.2")
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the same number, computed", says="s02.2")
        self.wait(0.4)
