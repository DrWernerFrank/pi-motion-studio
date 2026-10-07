from manim import Write

from studio_manim import Eq, L, StudioScene, claim


class Scene(StudioScene):
    """s03_land — the close: the equation earned."""

    scene_id = "s03_land"

    def construct(self):
        eq = Eq(r"{{3^2}} + {{4^2}} = {{5^2}}", roles={"p3": "result"}, font_size=64)
        eq.move_to([L.stage.cx, L.stage.cy + L.u * 4, 0])
        pay = Eq(r"{{9}} + {{16}} = {{25}}", roles={"p3": "result"}, font_size=48)
        pay.move_to([L.stage.cx, L.stage.cy - L.u * 8, 0])

        with self.say("s03.1"):
            self.at("equation_lands")
            self.play(Write(eq), run_time=1.2)
            self.play(Write(pay), run_time=1.0)
            claim("3 ** 2 + 4 ** 2 == 5 ** 2", about="the theorem, stated once more as the close", says="s03.1")
            claim("9 + 16 == 25", about="the numbers, said once more", says="s03.1")
        self.wait(0.3)
