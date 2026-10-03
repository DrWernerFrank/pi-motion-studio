from manim import FadeIn, Create, UP

from studio_manim import L, StudioScene
from studio_manim.kit import NumberLineLab, chapter, hold, recap, swap


class Scene(StudioScene):
    """showcase_5_recap — NumberLineLab + a sequence (computed values, tiered labels), then the recap
    card swapped in (the old content exits before the new arrives)."""

    scene_id = "showcase_5_recap"

    def construct(self):
        head = chapter("A sequence closing in", kicker="LIMITS")
        nl = NumberLineLab(L.stage, (0, 1, 0.25))
        dots, labels = nl.sequence("1/n", (1, 6))
        self.play(head.enter(), Create(nl), run_time=1.0)
        for d, t in zip(dots, list(labels) + [None] * len(dots)):
            anims = [FadeIn(d, scale=0.5)] + ([FadeIn(t, shift=UP * L.u * 2)] if t is not None else [])
            self.play(*anims, run_time=0.3)
        self.wait(0.6)
        rc = recap(["areas scale by the determinant", r"$1 + 3 + \dots + (2n-1) = n^2$",
                    "secants become the tangent"])
        new_head = chapter("Recap")
        from manim import VGroup
        swap(self, VGroup(head, nl, dots, labels), new_head)
        self.play(rc.reveal(0.6))
        hold(self, 1.4)
