"""s01_plane — PlaneLab: a matrix acts on the plane, then its computed area (kit showcase).

Layout: the matrix in ``panel(0, 2)`` (left in 16:9, top in portrait — a re-composition, not a
scaled copy), the plane lab in ``panel(1, 2)``. The question leaves WHILE the deformation runs
(a designed exit, not a cross-fade); the animation clock paces to the voiced bookmarks (D-019).
The 5 on screen comes from ``lab.area_value()`` (sympy det), never typed.
"""

from manim import Create, FadeOut, Write

from studio_manim import L, StudioScene, Txt, claim, math_role, num
from studio_manim.kit import Matrix, PlaneLab, hold, swap


class Scene(StudioScene):
    scene_id = "s01_plane"

    def construct(self):
        A = [[3, 1], [1, 2]]
        q = Txt("What does a matrix do to area?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        m = Matrix(A).into(L.panel(0, 2))
        m.set_column_colors(math_role("basis"), math_role("vector"))
        lab = PlaneLab(L.panel(1, 2), fit=[A])

        with self.say("s01.1"):                       # 4.62 s; "stretches" at 2.69
            self.play(Write(q), run_time=0.8)
            self.play(FadeOut(q), run_time=0.3)        # the question leaves before the answer arrives
            self.play(Write(m), run_time=0.8)          # "a matrix acts"
            self.play(Create(lab), run_time=self.until("applies"))
            self.play(lab.apply(A), run_time=1.9)      # "stretches into a parallelogram"
        with self.say("s01.2"):                       # 4.11 s; "so" at 2.08
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale factor", says="s01.2")
            area = lab.show_area(num(lab.area_value()))
            swap(self, m, area, run_time=0.9)         # the matrix becomes its area
            self.wait(self.until("lands"))
        hold(self, 1.2)                              # the key result rests (craft 9.6)
