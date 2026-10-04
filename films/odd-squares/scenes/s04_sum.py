import numpy as np
from manim import DOWN, RIGHT, UP, Create, Dot, FadeIn, FadeOut, Transform, VGroup, Write

from studio_manim import L, Eq, StudioScene, claim, color_for, math_role
from studio_manim.kit import EqMorph


SUM = r"{{1}} {{+}} {{3}} {{+}} {{5}} {{+}} {{\cdots}} {{+}} {{(2n-1)}}"
SUM_ROLES = {"p1": "gnomon1", "p3": "gnomon2", "p5": "gnomon3"}


class Scene(StudioScene):
    """s04_sum — the algebraic close: each odd number is a difference of squares; stacked, the
    squares cancel in pairs (telescoping) and n^2 - 0^2 survives."""

    scene_id = "s04_sum"

    def construct(self):
        box = L.stage
        # the sum and its right-hand side are two Eqs: side by side in landscape, stacked in portrait
        # (one 16-glyph line would shrink to unreadable in a 9:16 frame); the rhs morphs on its own
        top = Eq(SUM, roles=SUM_ROLES)
        rq = Eq(r"{{=}} {{?}}")
        r0 = Eq(r"{{=}} {{n^2}} {{- 0^2}}", roles={"p2": "square", "p3": "square"})
        r1 = Eq(r"{{=}} {{n^2}}", roles={"p2": "square"})
        gap = L.u * 2.5
        if L.portrait:
            wide, high = max(top.width, r0.width), top.height + gap * 2 + r0.height
        else:
            wide, high = top.width + gap + r0.width, max(top.height, r0.height)
        s = min(box.w * 0.92 / wide, box.h * 0.5 / high)
        for e in (top, rq, r0, r1):
            e.scale(s)
        if L.portrait:
            top.move_to([box.cx, box.cy + (gap * 2 + r0.height) / 2, 0])
            r0.next_to(top, DOWN, buff=gap * 2)
        else:
            top.move_to([box.cx - (gap + r0.width) / 2, box.cy, 0])
            r0.next_to(top, RIGHT, buff=gap)
            r0.shift([0, top.get_center()[1] - r0.part("p1").get_center()[1], 0])
        for r in (rq, r1):   # every right-hand side starts at the same '='
            r.shift(r0.part("p1").get_center() - r.part("p1").get_center())
        back = top.copy()    # the sum returns at the end with its answer

        # the stack: odd number = k^2 - (k-1)^2, aligned on '='
        rows = [Eq(r"{{1}} {{=}} {{1^2}} {{- 0^2}}", roles={"p1": "gnomon1"}),
                Eq(r"{{3}} {{=}} {{2^2}} {{- 1^2}}", roles={"p1": "gnomon2"}),
                Eq(r"{{5}} {{=}} {{3^2}} {{- 2^2}}", roles={"p1": "gnomon3"}),
                Eq(r"{{(2n-1)}} {{=}} {{n^2}} {{- (n-1)^2}}")]
        pitch = max(r.height for r in rows) * 1.9
        for i, r in enumerate(rows):
            r.shift([-r.part("p2").get_center()[0], -(i if i < 3 else 4) * pitch - r.get_center()[1], 0])
        x_sq = rows[2].part("p3").get_center()[0]
        dots = VGroup(*[Dot([x_sq, -3 * pitch + (j - 1) * pitch * 0.28, 0], radius=L.u * 0.7,
                            color=color_for("ink")) for j in range(3)])
        stack = VGroup(*rows, dots)
        stack.scale(min(box.w * 0.9 / stack.width, box.h * 0.9 / stack.height)).move_to([box.cx, box.cy, 0])

        def vanish(parts, to, run_time=0.5):
            """Equal squares of opposite sign meet and vanish. A part is a selection INSIDE its row:
            FadeOut restores it when it ends, so the glyphs are hidden explicitly afterwards."""
            self.play(*[FadeOut(p, target_position=to, scale=0.1) for p in parts], run_time=run_time)
            for p in parts:
                if p is not dots:
                    p.set_opacity(0)

        def mid(a, b):
            return (a.get_center() + b.get_center()) / 2

        with self.say("s04.1"):
            self.play(Write(top), run_time=1.0)
            self.play(Write(rq), run_time=0.4)
            self.wait(self.until("rewrite"))
            self.play(FadeOut(top, shift=UP * L.u * 6), FadeOut(rq, shift=UP * L.u * 6), run_time=0.4)
            for r in rows[:3]:
                self.play(Write(r), run_time=0.5)
            self.play(Create(dots), run_time=0.3)
            self.play(Write(rows[3]), run_time=0.5)
            claim("1**2 - 0**2 == 1", about="row 1", says="s04.1")
            claim("2**2 - 1**2 == 3", about="row 2", says="s04.1")
            claim("3**2 - 2**2 == 5", about="row 3", says="s04.1")
            claim("n**2 - (n - 1)**2 == 2*n - 1", about="row n", says="s04.1")
        with self.say("s04.2"):
            self.wait(self.until("cancel"))
            pairs = [(rows[0].part("p3"), rows[1].part("p4")),     # +1^2 and -1^2
                     (rows[1].part("p3"), rows[2].part("p4"))]     # +2^2 and -2^2
            pair_index = [0, 1]   # rows whose pair-half just vanished (for the dim)
            # critic R2: the cancellations read as 0.15 s flickers — PRE-FLASH each pair (the eye
            # finds them), STRETCH the vanishes (0.5 -> 0.75 s), and DIM the cancelled rows behind
            for a, b in pairs:
                self.play(a.animate.set_color(math_role("result")).scale(1.25),
                          b.animate.set_color(math_role("negative")).scale(1.25), run_time=0.45)
                vanish([a, b], mid(a, b), run_time=0.75)
                # critic r4: identity tests never fired (part() returns a fresh wrapper) — dim the
                # row whose INDEX matches the pair (pairs are (rows[0], rows[1]) then (rows[1], rows[2]))
                for idx in pair_index:
                    rows[idx].set_opacity(0.45)
            vanish([rows[2].part("p3")], dots.get_center(), run_time=0.7)   # +3^2 into the dots …
            vanish([dots, rows[3].part("p4")], mid(dots, rows[3].part("p4")), run_time=0.75)  # … which meet -(n-1)^2
            self.wait(self.until("survive"))
            lit0, lit3 = rows[0].copy(), rows[3].copy()     # the survivors take the square's color
            lit0.part("p4").set_color(math_role("square"))
            lit3.part("p3").set_color(math_role("square"))
            self.play(Transform(rows[0], lit0), Transform(rows[3], lit3), run_time=0.6)
            claim("summation(k**2 - (k - 1)**2, (k, 1, n)) == n**2 - 0**2", about="the telescoping sum", says="s04.2")
            self.wait(0.4)
            here = VGroup(back, r0).get_center()
            # critic R1 (t≈50.7): the rows fully exited before the answer entered — a ~0.3 s BLANK
            # frame under the words. One AnimationGroup: the rows fade INTO the answer's position
            # while it enters — the collapse and the return overlap, no empty beat.
            from manim import AnimationGroup
            self.play(AnimationGroup(
                *[FadeOut(r, target_position=here, scale=0.3) for r in rows],
                FadeIn(back, shift=DOWN * L.u * 6), Write(r0),
            ), run_time=0.9)
        with self.say("s04.3"):
            self.wait(self.until("result"))
            self.play(EqMorph(r0, r1), run_time=0.8)
            claim("summation(2*k - 1, (k, 1, n)) == n**2", about="the sum of the first n odd numbers", says="s04.3")
            claim("summation(2*k - 1, (k, 1, 100)) == 100**2", about="for every n: n = 100", says="s04.3")
        self.wait(0.15)
