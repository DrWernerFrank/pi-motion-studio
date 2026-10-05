# errors fixture: a NameError at construct time (undefined_thing on line 12).
from manim import Create, Square

from studio_manim import StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"

    def construct(self):
        self.play(Create(Square(1)), run_time=0.3)
        self.play(Create(undefined_thing), run_time=0.3)
