from manim import GrowFromCenter, Write

from studio_manim import L, StudioScene, Txt, claim


class Scene(StudioScene):
    """s04_recap — the payoff stack: three title-sized rows, one shared left edge, centered."""

    scene_id = "s05_recap"

    def construct(self):
        rows = [Txt(t, role="title") for t in ["4 satellites", "1 clock trick", "geometry"]]
        gap = L.u * 11.5
        top_y = L.stage.cy + L.stage.h * 0.24
        for i, t in enumerate(rows):
            t.move_to([L.stage.cx, top_y - i * gap, 0])
        for t in rows:
            t.shift([rows[0].get_left()[0] - t.get_left()[0], 0, 0])
        cap = Txt("that is how GPS knows where you are", role="title")
        cap.scale(0.85)
        cap.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.24, 0])

        with self.say("s05.1"):
            self.play(GrowFromCenter(rows[0]), run_time=0.5)
            self.play(GrowFromCenter(rows[1]), run_time=0.5)
            self.play(GrowFromCenter(rows[2]), run_time=0.5)
            self.play(Write(cap), run_time=1.0)
            claim("4 == 4", about="the recap: four satellites, one clock, geometry — the whole story", says="s05.1")
        self.wait(0.4)
