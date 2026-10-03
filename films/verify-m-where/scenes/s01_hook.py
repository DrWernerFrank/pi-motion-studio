from manim import Create, RIGHT, Square, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s01_hook — the WHERE fixture: a DENSE trace (every play/wait <= 0.2 s, the sentence tail
    chopped into 0.15 s hops instead of one long say()-exit pad), so any timecode sits within
    0.2 s of a recorded animation END and the resolver's answer is checkable to the entry."""

    scene_id = "s01_hook"

    def construct(self):
        row = VGroup(*[Square(0.42) for _ in range(9)]).arrange(RIGHT, buff=0.18)
        row.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s01.1"):
            for sq in row:
                self.play(Create(sq), run_time=0.18)
            self.fill("s01.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        """Wait out the sentence's tail in short hops (max(0.04, ...) so every wait is at least
        one frame long — manim floors a wait to whole frames and a sub-frame wait would spin)."""
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
