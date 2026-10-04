from manim import Write

from studio_manim import L, Eq, StudioScene, Txt, claim
from studio_manim.kit import recap


class Scene(StudioScene):
    """s06_recap — three lines and the takeaway, held (craft 9.6)."""

    scene_id = "s06_recap"

    def construct(self):
        with self.say("s06.1"):
            from studio_manim import Eq
            # critic r5: the recap floated at 44-48% fill and dropped the term colors. The
            # formula keeps its ad/bc roles (the color thread from s02), the matrix is the real
            # pmatrix (no shorthand), and the group fits the STAGE (the s05 exemplar).
            group = recap([
                "the area scale factor",
                Eq(r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = {{ad}} - {{bc}}",
                   roles={"p1": "positive", "p2": "negative"}),
                Eq(r"\begin{pmatrix} 3 & 1 \\ 1 & 2 \end{pmatrix} \to {{5}}",
                   roles={"p1": "result"}),
            ])
            from studio_manim.kit import into as _into
            _into(group, L.stage, fill=0.88)
            self.play(group.reveal())
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the recap repeats the verified number", says="s06.1")
            claim("Matrix([[1, 0], [0, 1]]).det() == 1", about="the identity keeps area", says="s06.1")
        self.wait(1.2)  # the recap hold
