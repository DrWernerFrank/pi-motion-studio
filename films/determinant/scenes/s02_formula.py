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
        VGroup(A, formula, worked).move_to([L.stage.cx, L.stage.cy, 0])

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
