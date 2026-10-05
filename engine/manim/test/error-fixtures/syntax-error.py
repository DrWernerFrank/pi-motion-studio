# errors fixture: a SyntaxError (the unclosed call on line 11). The check expects file:line 11
# (python reports the line where the paren should have closed, not where it opened).
from manim import Create, Square

from studio_manim import StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"
    def construct(self):
        self.play(Create(Square(1))
