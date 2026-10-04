from manim import Write

from studio_manim import L, Eq, StudioScene, Txt, claim
from studio_manim.kit import recap


class Scene(StudioScene):
    """s06_recap — three lines and the takeaway, held (craft 9.6)."""

    scene_id = "s06_recap"

    def construct(self):
        with self.say("s06.1"):
            group = recap([
                "the area scale factor",
                r"$\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = ad - bc$",
                r"$[3, 1; 1, 2] \to {{5}}$",
            ])
            self.play(group.reveal())
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the recap repeats the verified number", says="s06.1")
            claim("Matrix([[1, 0], [0, 1]]).det() == 1", about="the identity keeps area", says="s06.1")
        self.wait(1.2)  # the recap hold
