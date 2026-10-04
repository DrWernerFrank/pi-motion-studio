from manim import Create, Transform, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, num
from studio_manim.kit import PlaneLab


class Scene(StudioScene):
    """s01_hook — the question: a square grows to five (no title card, craft 9.1)."""

    scene_id = "s01_hook"

    def construct(self):
        q = Txt("What does a determinant do?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        strip = L.stage.h * 0.34  # critic R3: the area label needs its own slot at full size in 16:9
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
            # critic R3: the area label at FULL math size in its own slot (the kit's 0.55x default
            # read 2.37u at phone size); the value comes from the computation, never typed
            from studio_manim import Eq as _Eq, num
            from studio_manim.typeset import _font_size
            val = lab.area_value()
            area = _Eq("{{\\text{area}}} = {{" + num(val) + "}}", roles={"p2": "result"})
            area.font_size = _font_size("math")
            area.move_to([L.stage.cx, L.stage.y + L.stage.h * 0.09, 0])
            self.play(Write(area), run_time=self.until("five"))  # lands ON "five times"
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the area scale", says="s01.2")
            claim("Matrix([[3, 1], [1, 2]]).det() * 1 == 5", about="unit square area x det", says="s01.2")
        self.wait(0.4)
