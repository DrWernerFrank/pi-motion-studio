from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import Matrix as SMatrix


class Scene(StudioScene):
    """s02_formula — the 2x2 formula with the worked example (every number computed)."""

    scene_id = "s02_formula"

    def construct(self):
        head = Txt("The two-by-two formula", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        A = SMatrix([[3, 1], [1, 2]]).into(L.panel(0, 2))
        formula = Eq(
            r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = {{ad}} - {{bc}}",
            roles={"p1": "positive", "p2": "negative"},
        )
        step = max(1.4, L.stage.h * 0.16)
        formula.next_to(A, DOWN, buff=0.9)
        worked = Eq(r"= 3 \cdot 2 - 1 \cdot 1 = {{5}}", roles={"p1": "result"})
        worked.next_to(formula, DOWN, buff=step * 0.55)

        with self.say("s02.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(A), run_time=1.2)
            self.play(Write(formula), run_time=self.until("formula"))
        with self.say("s02.2"):
            self.play(Write(worked), run_time=self.until("lands"))
            claim("3 * 2 - 1 * 1 == 5", about="the worked example", says="s02.2")
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the same number, computed", says="s02.2")
        self.wait(0.4)
