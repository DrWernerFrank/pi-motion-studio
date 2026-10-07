from manim import DOWN, GrowFromCenter, Write

from studio_manim import Eq, L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s03_recap — the payoff stack: four satellites, one clock, geometry."""

    scene_id = "s03_recap"

    def construct(self):
        # the recap stack, one shared left edge, sized from L (craft: the finale layout)
        rows = [
            Txt("4 satellites", role="body"),
            Txt("1 clock trick", role="body"),
            Txt("geometry", role="body"),
        ]
        # the stack: rows high, the cap LOW and clear of them (the critic: the strike-through)
        for i, t in enumerate(rows):
            t.scale(1.5)
            t.move_to([L.stage.cx - L.stage.w * 0.20, L.stage.cy + L.stage.h * 0.26 - i * L.u * 6.2, 0])
        cap = Txt("that is how GPS knows where you are", role="title")
        cap.scale(0.9)
        cap.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.22, 0])

        with self.say("s03.1"):
            self.play(GrowFromCenter(rows[0]), run_time=0.5)
            self.play(GrowFromCenter(rows[1]), run_time=0.5)
            self.play(GrowFromCenter(rows[2]), run_time=0.5)
            self.play(Write(cap), run_time=1.1)
            claim("4 == 4", about="the recap: four satellites, one clock, geometry — the whole story", says="s03.1")
        self.wait(0.4)
