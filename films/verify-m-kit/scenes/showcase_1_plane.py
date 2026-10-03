from manim import RIGHT, Create, FadeIn, ReplacementTransform, Write, UP

from studio_manim import L, Eq, StudioScene, claim, math_role, num
from studio_manim.kit import Matrix, PlaneLab, chapter


class Scene(StudioScene):
    """showcase_1_plane — Matrix + PlaneLab: the matrix acts, the area label is the computed det.

    Landscape: matrix | plane side by side; portrait: L.panel stacks them (re-composition)."""

    scene_id = "showcase_1_plane"

    def construct(self):
        A = [[3, 1], [1, 2]]
        head = chapter("What a matrix does to area", kicker="DETERMINANT")
        M = Matrix(A).into(L.panel(0, 2), fill=0.55)
        M.set_column_colors(math_role("basis"), math_role("vector"))
        lab = PlaneLab(L.panel(1, 2), fit=[A])

        self.play(head.enter())
        self.play(Write(M), Create(lab), run_time=1.2)
        self.play(lab.apply(A), run_time=2.0)
        tags = lab.column_tags()
        area = lab.show_area(num(lab.area_value()))
        self.play(FadeIn(tags, shift=UP * L.u * 2), FadeIn(area, shift=UP * L.u * 2), run_time=0.6)
        D = M.bars()
        val = Eq("= " + num(D.det()), role="result").next_to(D, RIGHT, buff=L.u * 2)
        self.play(ReplacementTransform(M, D), run_time=0.8)
        self.play(Write(val), run_time=0.6)
        claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale", scene=self.scene_id)
        self.wait(1.2)
