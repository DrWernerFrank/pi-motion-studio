# errors fixture: a SyntaxError (the unclosed call on line 9). The check expects file:line 9.
from manim import Create, Square

from studio_manim import StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"
    def construct(self):
        self.play(Create(Square(1))
