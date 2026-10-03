from manim import Create, RIGHT, Triangle, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s02_meaning — the WHERE fixture's middle scene; stamps the {hits} bookmark (at() records
    the bookmark trace entry resolveWhere reports near it)."""

    scene_id = "s02_meaning"

    def construct(self):
        row = VGroup(*[Triangle() for _ in range(8)]).arrange(RIGHT, buff=0.22).scale(0.5)
        row.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s02.1"):
            self.at("hits")  # stamp {hits}: the where check resolves t near it to this bookmark
            for tr in row:
                self.play(Create(tr), run_time=0.18)
            self.fill("s02.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
