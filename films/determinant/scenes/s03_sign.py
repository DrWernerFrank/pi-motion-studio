from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab


class Scene(StudioScene):
    """s03_sign — the column swap: -5, flipped orientation.

    The plane's box is the stage MINUS a label strip (a PlaneLab(L.stage) is stage-TALL: anything
    below it lands off-frame — the gate caught exactly that). Group-centered after chaining.
    """

    scene_id = "s03_sign"

    def construct(self):
        head = Txt("Swap the columns", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        strip = L.stage.h * 0.30
        from studio_manim.layout import _Box
        plane_box = _Box(L.stage.x, L.stage.y + strip, L.stage.w, L.stage.h - strip)
        lab = PlaneLab(
            plane_box,
            matrix=[[3, 1], [1, 2]], fit=[[[3, 1], [1, 2]], [[1, 3], [2, 1]]],
        )
        swapped = Eq(r"\det\begin{pmatrix} 1 & 3 \\ 2 & 1 \end{pmatrix} = 1 \cdot 1 - 3 \cdot 2 = {{-5}}",
                     roles={"p1": "negative"})
        note = Txt("negative means flipped", role="body")
        swapped.next_to(lab.plane, DOWN, buff=0.5)
        note.next_to(swapped, DOWN, buff=0.5)
        from manim import VGroup
        VGroup(lab, swapped, note).move_to([L.stage.cx, L.stage.cy, 0])
        self.add(lab.plane)

        with self.say("s03.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(swapped), run_time=self.until("minus"))
            claim("Matrix([[1, 3], [2, 1]]).det() == -5", about="the swapped columns", says="s03.1")
            self.play(lab.apply([[1, 3], [2, 1]], run_time=1.6))
        with self.say("s03.2"):
            self.play(Write(note), run_time=self.until("flipped"))
            claim("Matrix([[1, 3], [2, 1]]).det() < 0", about="a negative determinant flips space", says="s03.2")
        self.wait(0.4)
