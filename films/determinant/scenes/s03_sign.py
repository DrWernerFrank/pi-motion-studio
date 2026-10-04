from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab, into as _into
from studio_manim.layout import _Box


class Scene(StudioScene):
    """s03_sign — the column swap: -5, flipped orientation.

    PORTRAIT is a re-composition (D-009): plane top panel, equation+note bottom panel. 16:9 keeps
    the side column. (Below/beside a stage-filling plane both overflowed the safe area — the
    gate caught each attempt; panels are the designed answer.)
    """

    scene_id = "s03_sign"

    def construct(self):
        head = Txt("Swap the columns", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        if L.portrait:
            plane_box, eq_col = L.panel(0, 2), L.panel(1, 2)
        else:
            col_w = L.stage.w * 0.42
            plane_box = _Box(L.stage.x, L.stage.y, L.stage.w - col_w, L.stage.h)
            eq_col = _Box(L.stage.x + L.stage.w - col_w, L.stage.y, col_w, L.stage.h)
        lab = PlaneLab(plane_box, matrix=[[3, 1], [1, 2]],
                       fit=[[[3, 1], [1, 2]], [[1, 3], [2, 1]]])
        swapped = Eq(r"\det\begin{pmatrix} 1 & 3 \\ 2 & 1 \end{pmatrix} = 1 \cdot 1 - 3 \cdot 2 = {{-5}}",
                     roles={"p1": "negative"})
        note = Txt("negative means flipped", role="body")
        _into(swapped, eq_col, fill=0.84)
        note.next_to(swapped, DOWN, buff=0.55)
        _into(__import__("manim").VGroup(swapped, note), eq_col, fill=0.86)
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
