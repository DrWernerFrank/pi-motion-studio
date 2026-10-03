# errors fixture: an empty scene — construct adds and plays nothing.
from studio_manim import StudioScene


class Scene(StudioScene):
    scene_id = "s01_hook"

    def construct(self):
        pass
