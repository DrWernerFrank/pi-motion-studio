# errors fixture: a hung scene — one real animation, then an infinite loop in construct (line 15).
# The runner must kill it at its wall-clock budget and name the last animation (Create).
from manim import Create, Square

from studio_manim import StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"

    def construct(self):
        self.play(Create(Square(1)), run_time=0.3)
        n = 0
        while True:
            n += 1
