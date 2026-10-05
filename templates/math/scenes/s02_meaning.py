from manim import DOWN, VGroup, Write

from studio_manim import L, Eq, StudioScene, Txt, claim


class Scene(StudioScene):
    """s02_meaning — the 2x2 formula with a worked example; every number computed.

    The stack is chained with ``next_to`` (measured heights, buff proportional to the stage) and the
    GROUP is centered in the stage — no fixed offsets, so portrait type (x1.5) can never collide
    (the first draft guessed a step and the portrait matrices overlapped).
    """

    scene_id = "s02_meaning"

    def construct(self):
        head = Txt("The two-by-two formula", role="title")
        head.move_to([L.title.cx, L.title.cy, 0])
        A = Eq(
            r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = {{ad}} - {{bc}}",
            roles={"p1": "positive", "p2": "negative"},
        )
        ex = Eq(r"= 3 \cdot 2 - 1 \cdot 1 = {{5}}", roles={"p1": "result"})
        note = Txt("five times the area", role="body")
        buff = max(0.5, L.stage.h * 0.055)
        ex.next_to(A, DOWN, buff=buff)
        note.next_to(ex, DOWN, buff=buff * 0.8)
        # chained, then fitted to the SAFE box (portrait margins cleared — the template ships
        # gates-clean in every format; the starter check enforces it)
        from studio_manim.kit import into
        stack = VGroup(A, ex, note)
        into(stack, L.safe, fill=0.86)

        with self.say("s02.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(A), run_time=self.until("formula_lands"))
        with self.say("s02.2"):
            self.play(Write(ex), run_time=self.until("lands"))     # "Five."
            claim("3 * 2 - 1 * 1 == 5", about="worked example", says="s02.2")
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="the same number, computed", says="s02.2")
            self.play(Write(note), run_time=0.8)
        self.wait(0.5)
