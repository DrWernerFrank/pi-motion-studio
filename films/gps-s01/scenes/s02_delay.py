from manim import LEFT, Create, Dot, Line, Write

from studio_manim import L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s02_delay — the phone measures the delay (the facts derive it)."""

    scene_id = "s02_delay"

    def construct(self):
        # the beam IS the stage: a wide measured band down the middle, the delay number HUGE on it
        sat = Dot([L.stage.cx, L.stage.cy + L.stage.h * 0.34, 0], radius=L.u * 2.4, color=color_for("positive"))
        phone = Dot([L.stage.cx, L.stage.cy - L.stage.h * 0.22, 0], radius=L.u * 2.0, color=color_for("ink"))
        beam = Line(sat.get_center(), phone.get_center(), stroke_width=9.0, color=color_for("result"), stroke_opacity=0.5)
        delay = Txt("delay ~ 0.07 s", role="title")
        delay.scale(1.9)
        # ON the band, centered UNDER it (either side of a mid-frame beam overflows at 1.9x: the lint)
        delay.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.36, 0])

        self.add(sat, phone)
        with self.say("s02.1"):
            # NEVER stretch one Create across a long sentence (manim buffers the intermediate frames:
            # a 8s Create at 1080p60 = ~500 frames held -> the memory cap kills it; measured, D-008).
            # Pace with SHORT beats: the beam draws (1.2s), then a travel-dot rides it beat by beat.
            self.play(Create(beam), run_time=1.2)
            ride = Dot([sat.get_center()[0], sat.get_center()[1], 0], radius=L.u * 1.0, color=color_for("result"))
            self.add(ride)
            steps = 6
            for i in range(steps):
                f = (i + 1) / steps
                mid = [sat.get_center()[0] + (phone.get_center()[0] - sat.get_center()[0]) * f,
                       sat.get_center()[1] + (phone.get_center()[1] - sat.get_center()[1]) * f, 0]
                self.play(ride.animate.move_to(mid), run_time=max(0.3, self.until('delay_marks') / steps * 0.6))
            self.play(Write(delay), run_time=0.9)
            # the delay DERIVED from the carried facts (20,200 km / c ~= 0.0674 s)
            claim("20200000 / 299792458 == 0.0674", tol=0.001, about="the delay: the 20,200 km orbit divided by the speed of light (seconds)", says="s02.1")
        self.wait(0.3)
