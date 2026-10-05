"""s02_steps — EqSteps: a derivation that morphs on one line, then a Callout (kit showcase).

``EqSteps`` keeps the shared parts (``{{(a+b)^2}}``, ``{{=}}``, ``{{a^2}}``, ``{{b^2}}``) and
morphs them in place; only the changed middle re-colors (role positive). The Callout brace lands
on the doubled term. The chapter strip + the one equation line + the brace label = 4 text objects.
"""

from manim import DOWN

from studio_manim import L, StudioScene, claim
from studio_manim.kit import Callout, EqSteps, chapter


class Scene(StudioScene):
    scene_id = "s02_steps"

    def construct(self):
        head = chapter("Squaring a sum")   # no kicker: at phone size an eyebrow reads as noise
                                        # (and "EqSteps" as a leaked component name — look r5)
        steps = EqSteps([
            r"{{(a+b)^2}} {{=}} (a+b)(a+b)",
            r"{{(a+b)^2}} {{=}} {{a^2}} + ab + ba + {{b^2}}",
            r"{{(a+b)^2}} {{=}} {{a^2}} + {{2ab}} + {{b^2}}",
        ], L.stage)
        # a hero derivation in landscape, never past the stage in portrait: EqSteps fits the
        # widest step to 94% of the box, so the headroom ratio tells how much may be added back
        # (every '=' stays aligned: all steps share the group center, one uniform scale).
        steps.scale(min(1.45, 0.94 * L.stage.w / steps.width))
        eqs = steps.eqs

        with self.say("s02.1"):                       # 4.56 s; "a plus b" at 2.45
            self.play(head.enter(), run_time=1.0)
            self.play(steps.steps()[0], run_time=self.until("writes"))
        with self.say("s02.2"):                       # 3.55 s; "the mixed" at 1.39
            claim("expand((a+b)**2) == a**2 + 2*a*b + b**2", about="the squared sum", says="s02.2")
            claim("(a+b)*(a+b) == a**2 + 2*a*b + b**2", about="product equals the collected form",
                  says="s02.2")
            self.play(steps.steps()[1], run_time=0.7)   # product -> expanded
            self.play(steps.steps()[2], run_time=self.until("collects"))  # ab + ba -> 2ab
            final = eqs[-1]
            name = next(n for n, t in final.labels.items() if t == "2ab")
            c = Callout(final.part(name), "the mixed term, doubled", kind="brace", direction=DOWN)
            self.play(c.create(), run_time=1.0)
            self.wait(0.4)                           # the result rests; the say-exit pads the rest
        self.wait(0.05)   # ends the trace on an animation (see s01: the recorder's timeline
                          # takes trace[-1].t; a trailing sentence_end under-reports the scene)
        # no trailing hold: a MIDDLE scene must end on its narration pad (its hold would push
        # s03's voice over this picture — caught in the first look round)
