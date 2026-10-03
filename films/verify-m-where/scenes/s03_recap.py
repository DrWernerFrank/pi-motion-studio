from manim import Create, Dot, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s03_recap — the WHERE fixture's last scene: a grid of dots, short plays, tail hops."""

    scene_id = "s03_recap"

    def construct(self):
        dots = VGroup(*[Dot(radius=0.1) for _ in range(12)]).arrange_in_grid(rows=3, buff=0.35)
        dots.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s03.1"):
            for d in dots:
                self.play(Create(d), run_time=0.18)
            self.fill("s03.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
