from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import Matrix as SMatrix


class Scene(StudioScene):
    """s05_3x3 — the cofactor expansion: every minor computed, the answer 8."""

    scene_id = "s05_3x3"

    def construct(self):
        head = Txt("Three by three: little two-by-twos", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        A = SMatrix([[2, 1, 0], [1, 3, 1], [0, 1, 2]])
        expansion = Eq(
            r"= 2\begin{vmatrix} 3 & 1 \\ 1 & 2 \end{vmatrix} - 1\begin{vmatrix} 1 & 1 \\ 0 & 2 \end{vmatrix} + 0",
        )
        expansion.next_to(A, DOWN, buff=0.8)
        worked = Eq(r"= 2 \cdot 5 - 1 \cdot 2 + 0 = {{8}}", roles={"p1": "result"})
        worked.next_to(expansion, DOWN, buff=0.7)

        from manim import VGroup
        from studio_manim.kit import into
        into(VGroup(A, expansion, worked), L.safe, fill=0.86)  # fit the SAFE box: portrait margins cleared (critic R2)

        with self.say("s05.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(A), run_time=1.2)
            self.play(Write(expansion), run_time=self.until("expand"))
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="minor 1", says="s05.1")
            claim("Matrix([[1, 1], [0, 2]]).det() == 2", about="minor 2", says="s05.1")
        with self.say("s05.2"):
            self.play(Write(worked), run_time=self.until("eight"))
            claim("2 * 5 - 1 * 2 + 0 == 8", about="the cofactor sum", says="s05.2")
            claim("Matrix([[2, 1, 0], [1, 3, 1], [0, 1, 2]]).det() == 8", about="the 3x3 itself, computed", says="s05.2")
        self.wait(0.4)
