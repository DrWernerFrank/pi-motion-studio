"""s03_gnomons — stack_gnomons: 1 + 3 + 5 + 7 = 16 with computed numbers + a caption (kit showcase).

The grid appears first (the empty square), then each gnomon grows it, the last landing on the
word "seven". The total on screen comes from ``S.total`` (the cells the shapes actually contain,
= 16), the identity is a claim, and the caption lands in the ``L.caption`` band.
"""

from manim import Create, Write

from studio_manim import L, StudioScene, Eq, claim, num
from studio_manim.kit import caption, chapter, hold, into, stack_gnomons, unit_grid


class Scene(StudioScene):
    scene_id = "s03_gnomons"

    def construct(self):
        head = chapter("Odd numbers, one square", kicker="Gnomons")
        S = stack_gnomons(4, L.panel(0, 2))
        grid = unit_grid(4, S.unit).move_to(S)
        total = Eq("1 + 3 + 5 + 7 = " + "{{" + num(S.total) + "}}", roles={"p1": "result"})
        into(total, L.panel(1, 2), fill=0.72)

        with self.say("s03.1"):                       # 5.45 s; "seven" at 4.98
            self.play(head.enter(), run_time=1.0)
            self.play(Create(grid), run_time=0.8)
            for g in S[:-1]:
                self.play(Create(g), run_time=0.75)   # one, three, five
            self.play(Create(S[-1]), run_time=self.until("gnomons"))  # seven
        with self.say("s03.2"):                       # 3.74 s; "sixteen" at 2.23
            claim("Sum(2*k - 1, (k, 1, 4)) == 16", about="the gnomons' cells", says="s03.2")
            claim("Sum(2*k - 1, (k, 1, n)) == n**2", about="odd numbers make squares", says="s03.2")
            cap = caption(self, "Each L completes a square: sixteen cells in all.")
            self.add(cap)
            self.play(Write(total), run_time=1.1)
            self.wait(self.until("lands"))
        hold(self, 1.4)
