from manim import DOWN, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab, into as _into
from studio_manim.layout import _Box


class Scene(StudioScene):
    """s04_zero — det 0: the plane collapses to a line, no inverse (portrait: panels)."""

    scene_id = "s04_zero"

    def construct(self):
        head = Txt("Zero: squashed flat", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        if L.portrait:
            plane_box, eq_col = L.panel(0, 2), L.panel(1, 2)
        else:
            # critic r4: the 42% column into()-shrunk the det line to 0.56x (unreadable at 360px).
            # The 16:9 frame is WIDE: the plane keeps 55% and the equation column takes 45%, so the
            # line runs at >= 0.8x; into() caps at exactly fit, never more.
            col_w = L.stage.w * 0.45
            plane_box = _Box(L.stage.x, L.stage.y, L.stage.w - col_w, L.stage.h)
            eq_col = _Box(L.stage.x + L.stage.w - col_w, L.stage.y, col_w, L.stage.h)
        lab = PlaneLab(plane_box, matrix=[[3, 1], [1, 2]],
                       fit=[[[3, 1], [1, 2]], [[2, 4], [1, 2]]])
        zero = Eq(r"\det\begin{pmatrix} 2 & 4 \\ 1 & 2 \end{pmatrix} = 2 \cdot 2 - 4 \cdot 1 = {{0}}",
                  roles={"p1": "negative"})
        note = Txt("no inverse — it cannot be undone", role="body")
        _into(zero, eq_col, fill=0.84)
        # critic R3: the note composes at FULL nominal size below the (scaled) equation — into()
        # group-scaling shrank it to 2.58u, under the 3.2u floor
        note.next_to(zero, DOWN, buff=0.6)
        self.add(lab.plane)

        with self.say("s04.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(zero), run_time=1.4)
            claim("Matrix([[2, 4], [1, 2]]).det() == 0", about="the collapse", says="s04.1")
            self.play(lab.apply([[2, 4], [1, 2]], run_time=1.8))
            self.play(Write(note), run_time=self.until("cannot"))
            claim("Matrix([[2, 4], [1, 2]]).det() == 0", about="det 0 has no inverse", says="s04.1")
        self.wait(0.4)
