"""s03_gnomons — stack_gnomons: 1 + 3 + 5 + 7 = 16 with computed numbers + a caption (kit showcase).

The grid (the page) draws first, then each gnomon lands with ITS term joining a running total in
the right panel — every number is the gnomon's own ``cells`` (2k-1), the result is ``S.total``
(= n^2, claimed). The chapter strip leaves when the proof completes (density: <= 4 text objects
alive). The ``Indicate`` pulses carry the RESULT role's color — manim's default PURE_YELLOW flash
would break "one color per concept" (the look round caught it as a yellow-green smear).
"""

from manim import Create, DOWN, FadeOut, Indicate, RIGHT, Write, VGroup

from studio_manim import L, StudioScene, Eq, claim, math_role, num
from studio_manim.kit import caption, chapter, hold, into, stack_gnomons, unit_grid


class Scene(StudioScene):
    scene_id = "s03_gnomons"

    def construct(self):
        head = chapter("Odd numbers, one square")   # no kicker: at phone size an eyebrow reads
                                                    # as noise (look r5) — and the head STAYS
        # FULL-STAGE composition (the phone round read the two-panel layout as "a third-width grid
        # + dead space"): the square is the hero in the upper stage, the running total directly
        # under it — every number is the gnomon's own ``cells`` (2k-1), the result is ``S.total``.
        S = stack_gnomons(4, L.stage, fill=0.78)
        S.move_to([L.stage.cx, L.stage.y + L.stage.h * 0.62, 0])
        grid = unit_grid(4, S.unit).move_to(S)
        terms = Eq(" + ".join(num(g.cells) for g in S))
        total = Eq("= {{" + num(S.total) + "}}", roles={"p1": "result"})
        line = VGroup(terms, total).arrange(RIGHT, buff=L.u * 2.2)  # "7 = 16" was cramped (r5)
        line.next_to(S, DOWN, buff=L.u * 5)

        with self.say("s03.1"):                       # 5.45 s; "seven" at 4.98
            self.play(Create(grid), head.enter(), run_time=1.0)  # page + title together: no thin
            self.play(Write(terms), run_time=1.4)                # opening frame (look r4/r5)
            for g in S[:-1]:
                self.play(Create(g), run_time=0.75)   # three, five: terms land with their Ls
            self.play(Create(S[-1]), Write(total), run_time=self.until("gnomons"))  # seven, = 16
        with self.say("s03.2"):                       # 3.74 s; "sixteen" at 2.23
            claim("Sum(2*k - 1, (k, 1, 4)) == 16", about="the gnomons' cells", says="s03.2")
            claim("Sum(2*k - 1, (k, 1, n)) == n**2", about="odd numbers make squares", says="s03.2")
            cap = caption(self, "Each L completes a square: sixteen cells in all.")
            self.add(cap)   # the head stays: title + terms + total + caption = 4 text objects
            self.wait(self.until("lands"))
            self.play(Indicate(total, scale_factor=1.1, color=math_role("result")), run_time=0.6)
        hold(self, 1.2)   # the LAST scene: the recap hold extends the film tail (craft 9.6)
