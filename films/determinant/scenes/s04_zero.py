from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab


class Scene(StudioScene):
    """s04_zero — det 0: the plane collapses to a line, no inverse."""

    scene_id = "s04_zero"

    def construct(self):
        head = Txt("Zero: squashed flat", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        lab = PlaneLab(L.stage, matrix=[[3, 1], [1, 2]], fit=[[[3, 1], [1, 2]], [[2, 4], [1, 2]]])
        self.add(lab.plane)
        zero = Eq(r"\det\begin{pmatrix} 2 & 4 \\ 1 & 2 \end{pmatrix} = 2 \cdot 2 - 4 \cdot 1 = {{0}}",
                  roles={"p1": "negative"})
        note = Txt("no inverse — it cannot be undone", role="body")

        with self.say("s04.1"):
            self.play(Write(head), run_time=0.9)
            zero.next_to(lab.plane, DOWN, buff=0.7)
            self.play(Write(zero), run_time=1.4)
            claim("Matrix([[2, 4], [1, 2]]).det() == 0", about="the collapse", says="s04.1")
            self.play(lab.apply([[2, 4], [1, 2]], run_time=1.8))
            note.next_to(zero, DOWN, buff=0.6)
            self.play(Write(note), run_time=self.until("cannot"))
            claim("Matrix([[2, 4], [1, 2]]).det() == 0", about="det 0 has no inverse", says="s04.1")
        self.wait(0.4)
