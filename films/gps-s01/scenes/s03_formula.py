from manim import Write

from studio_manim import Eq, L, StudioScene, Txt, claim, color_for
from manim import Write


class Scene(StudioScene):
    """s02_formula — the delay measured, then the equation that turns it into distance."""

    scene_id = "s03_formula"

    def construct(self):
        # the words, SHORT (the memory guard's split rule); the narration carries the full phrase
        eq = Eq(r"{{\text{distance}}} = {{\text{speed}}} \times {{\text{delay}}}",
                roles={"p1": "result"}, font_size=64)
        eq.move_to([L.stage.cx, L.stage.cy + L.stage.h * 0.14, 0])   # centered as a BLOCK with the payoff
        # the payoff number, said next: about 21,000 km — BIG under the equation
        about = Txt("~ 21,000 km", role="title")
        about.scale(1.6)
        about.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.14, 0])

        with self.say("s03.1"):
            # SHORT Write + hold beats (a long Write holds every partial frame: the memory cap,
            # D-008); at() stamps the bookmark so the sync gate sees it animated to
            self.at("eq_shown")
            self.play(Write(eq), run_time=1.3)
            self.play(Write(about), run_time=1.0)   # the payoff number, the biggest text on screen
            for k in range(2):
                self.play(about.animate.set_color(color_for("result")), run_time=0.14)
                self.play(about.animate.set_color(color_for("ink")), run_time=0.14)
            claim("299792458 * 0.07 == 20985472.06", tol=0.01, about="distance = the SI speed of light x the 0.07 s delay (meters)", says="s03.1")
        self.wait(0.3)
