from manim import Create, Transform, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab


class Scene(StudioScene):
    """s01_hook — the question: a square grows to five (no title card, craft 9.1)."""

    scene_id = "s01_hook"

    def construct(self):
        q = Txt("What does a determinant do?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        strip = L.stage.h * 0.22
        from studio_manim.layout import _Box
        lab = PlaneLab(_Box(L.stage.x, L.stage.y + strip, L.stage.w, L.stage.h - strip),
                       matrix=[[3, 1], [1, 2]], fit=[[[3, 1], [1, 2]]])
        self.add(lab.plane)
        area = None

        with self.say("s01.1"):
            self.play(Write(q), run_time=1.2)
            self.play(Create(lab.square), run_time=self.until("shows"))
            self.play(lab.apply([[3, 1], [1, 2]], run_time=max(0.8, self.until("applies"))))
        with self.say("s01.2"):
            area = lab.show_area()          # the computed det — verified against area_value() inside
            self.play(Write(area), run_time=self.until("five"))  # lands ON "five times"
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the area scale", says="s01.2")
            claim("Matrix([[3, 1], [1, 2]]).det() * 1 == 5", about="unit square area x det", says="s01.2")
        self.wait(0.4)
