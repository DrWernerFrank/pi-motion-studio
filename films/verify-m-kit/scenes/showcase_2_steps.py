from manim import DOWN, UP, FadeIn

from studio_manim import L, StudioScene, claim
from studio_manim.kit import Callout, EqSteps, caption, chapter, swap


class Scene(StudioScene):
    """showcase_2_steps — EqSteps morphing on one line aligned on '=', a brace Callout, a caption."""

    scene_id = "showcase_2_steps"

    def construct(self):
        head = chapter("Expanding a square", kicker="ALGEBRA")
        steps = EqSteps([
            r"{{(a+b)^2}} {{=}} (a+b)(a+b)",
            r"{{(a+b)^2}} {{=}} {{a^2}} + ab + ba + {{b^2}}",
            r"{{(a+b)^2}} {{=}} {{a^2}} + {{2ab}} + {{b^2}}",
        ], L.stage)
        cap = caption(self, "Multiply out, then collect the two middle terms.")
        anims = steps.steps()
        self.play(head.enter())
        self.play(anims[0], FadeIn(cap, shift=UP * L.u * 3))
        for a in anims[1:]:
            self.wait(0.5)
            self.play(a)
        last = steps.eqs[-1]
        two_ab = next(n for n, t in last.labels.items() if t.strip() == "2ab")
        note = Callout(last.part(two_ab), "the cross terms", kind="brace", direction=DOWN, box=L.stage)
        self.play(note.create())
        claim("expand((a + b)**2) == a**2 + 2*a*b + b**2", about="the identity", scene=self.scene_id)
        self.wait(1.2)

