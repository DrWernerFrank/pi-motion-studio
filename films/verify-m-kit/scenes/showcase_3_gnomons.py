from manim import LEFT, UR, FadeIn, Write

from studio_manim import L, Eq, StudioScene, claim, num
from studio_manim.kit import EqMorph, caption, chapter, stack_gnomons


class Scene(StudioScene):
    """showcase_3_gnomons — 1 + 3 + 5 + 7 = 4²: gnomons nest into a square while the running sum
    morphs (EqMorph, label-matched). Persian caption: the RTL path of caption()."""

    scene_id = "showcase_3_gnomons"

    def construct(self):
        n = 4
        head = chapter("Odd numbers build squares", kicker="VISUAL PROOF")
        S = stack_gnomons(n, L.panel(0, 2))
        cap = caption(self, "مجموع اعداد فرد متوالی همیشه یک مربع است.")
        sums = []
        for k in range(1, n + 1):
            terms = " {{+}} ".join("{{" + num(2 * i - 1) + "}}" for i in range(1, k + 1))
            tex = terms if k < n else terms + r" = " + num(S.total) + " = " + num(n) + "^2"
            sums.append(Eq(tex).move_to([L.panel(1, 2).cx, L.panel(1, 2).cy, 0]))
        s = min(1.0, L.panel(1, 2).w * 0.9 / sums[-1].width)  # one scale: the longest fits its panel
        for e in sums:
            e.scale(s).align_to(sums[-1], LEFT)  # left-aligned: old terms stay put, new ones append

        self.play(head.enter(), FadeIn(cap))
        self.play(FadeIn(S[0], shift=UR * L.u * 2), Write(sums[0]), run_time=0.7)
        for k in range(1, n):
            self.play(FadeIn(S[k], shift=UR * L.u * 3), EqMorph(sums[k - 1], sums[k]), run_time=0.9)
        claim("Sum(2*k - 1, (k, 1, 4)).doit() == 4**2", about="odd sums", scene=self.scene_id)
        self.wait(1.4)
