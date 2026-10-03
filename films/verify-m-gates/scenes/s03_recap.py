from manim import DOWN, Create, VGroup, Write

from studio_manim import L, Eq, StudioScene, Txt, claim


class Scene(StudioScene):
    """s03_recap — three lines and the takeaway, held (craft 9.6: hold >= 1.2 s).

    Chained with ``next_to`` + the group centered in the stage (measured heights — a guessed step
    made the portrait matrices collide in the first draft).
    """

    scene_id = "s03_recap"

    def construct(self):
        head = Txt("Recap", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        one = Txt("the area scale factor", role="body")
        two = Eq(r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = ad - bc")
        three = Eq(r"\begin{pmatrix} 3 & 1 \\ 1 & 2 \end{pmatrix} \to {{5}}", roles={"p1": "result"})
        buff = max(0.5, L.stage.h * 0.06)
        two.next_to(one, DOWN, buff=buff)
        three.next_to(two, DOWN, buff=buff)
        VGroup(one, two, three).move_to([L.stage.cx, L.stage.cy, 0])

        with self.say("s03.1"):
            self.play(Write(head), run_time=0.7)
            for m in (one, two, three):
                self.play(Create(m), run_time=0.8)
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="recap repeats the verified number", says="s03.1")
            claim("Matrix([[1, 0], [0, 1]]).det() == 1", about="the identity keeps area", says="s03.1")
        self.wait(1.2)  # the recap hold
