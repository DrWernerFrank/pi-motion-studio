# errors fixture: a backend compile error — a deliberately broken formula on line 11.
from manim import Write

from studio_manim import Eq, StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"

    def construct(self):
        eq = Eq(r"\this \{is} broken")
        self.play(Write(eq), run_time=0.3)
