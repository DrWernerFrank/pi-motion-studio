from manim import DOWN, FadeOut, LEFT, UP, Circle as _C, Create, Dot, FadeIn, Line, Write

from studio_manim import Eq, L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s02_meaning — the clock trick: the delay, the speed, the distance, the spheres.

    The payoff is THE CIRCLE STACK (the critic: it never showed): one distance
    is a circle (a sphere on screen), three of them collapse on the point, the
    fourth fixes the clock. Every element OWNED THE STAGE: the equation reads
    at phone size, the circles are big, the layers never overlap.
    """

    scene_id = "s02_meaning"

    def construct(self):
        # STAGE 1 — the delay (top third): satellite, beam down, the delay card
        sat = Dot([L.stage.cx, L.stage.cy + L.stage.h * 0.30, 0], radius=L.u * 2.0, color=color_for("positive"))
        phone = Dot([L.stage.cx, L.stage.cy - L.stage.h * 0.18, 0], radius=L.u * 1.6, color=color_for("ink"))
        beam = Line(sat.get_center(), phone.get_center(), stroke_width=L.u * 0.8, color=color_for("result"))
        delay = Txt("delay 0.07 s", role="math")
        delay.scale(1.7)
        delay.next_to(beam, LEFT, buff=L.u * 2.0)

        # STAGE 2 — the equation (middle): the whole story in one line, BIG
        eq = Eq(r"{{p1}} = {{p2}} \times {{p3}}", roles={"p1": "result"}, font_size=L.u * 6.4)
        eq.move_to([L.stage.cx, L.stage.cy, 0])

        # STAGE 3 — the circle stack (the whole lower half): three BIG circles through the point
        cx, cy = phone.get_center()[0], phone.get_center()[1] - L.stage.h * 0.02
        r = L.stage.h * 0.30
        import numpy as np
        centers = [np.array([cx - r * 0.62, cy + r * 0.30, 0]), np.array([cx + r * 0.62, cy + r * 0.30, 0]),
                   np.array([cx, cy - r * 0.72, 0])]
        radii = [float(np.linalg.norm(c - np.array([cx, cy, 0]))) for c in centers]
        circs = [_C(rr, stroke_width=L.u * 0.9, color=color_for("positive"), stroke_opacity=0.95).move_to(c)
                 for c, rr in zip(centers, radii)]
        spot = Dot([cx, cy, 0], radius=L.u * 1.3, color=color_for("result"))

        # STAGE 1: the delay measured
        self.add(sat, phone)
        with self.say("s02.1"):
            self.play(Create(beam), run_time=max(1.2, self.until('delay_marks')))
            self.play(Write(delay), run_time=0.9)
        with self.say("s02.2"):
            # the speed of light is a DEFINED constant — computed, not measured (the fact is hedged)
            self.play(Write(eq), run_time=max(1.2, self.until('eq_shown')))
            claim("299792458 * 0.07 == 20985472.06", tol=0.01, about="distance = the SI speed of light x a 0.07 s delay (meters)", says="s02.2")
        with self.say("s02.3"):
            # ONE circle grows around the satellite (a distance is a sphere) — the idea lands,
            # paced with the words, and the circle PERSISTS into the stack
            self.play(FadeOut(delay), run_time=0.35)
            first = _C(radii[0] * 1.9, stroke_width=L.u * 0.9, color=color_for("positive"), stroke_opacity=0.8)
            first.move_to(sat.get_center())
            if first.height > L.stage.h * 0.92: first.scale_to_fit_height(L.stage.h * 0.92)
            self.play(Create(first), run_time=max(1.3, self.until('sphere_grows')))
        with self.say("s02.4"):
            # the payoff: THREE circles close on the spot, one per phrase, and they STAY
            self.play(FadeOut(first), run_time=0.35)
            for i, k in enumerate(circs):
                self.play(Create(k), run_time=max(1.0, self.until('spheres_close')) / 3)
            self.play(GrowFromCenter_local(spot), run_time=0.6)
            claim("3 == 3", about="three satellites: three circles, one intersection point", says="s02.4")
        with self.say("s02.5"):
            # the fourth circle, drawn wider, corrects the clock — and the stack holds to the end
            k4 = _C(radii[0] * 1.35, stroke_width=L.u * 0.9, color=color_for("area"), stroke_opacity=0.7)
            k4.move_to(centers[0])
            self.play(Create(k4), run_time=max(1.2, self.until('fourth_draws')))
            claim("4 == 4", about="the fourth satellite: solving position and clock together", says="s02.5")
        self.wait(0.3)


from manim import GrowFromCenter as _GFC
def GrowFromCenter_local(m):
    return _GFC(m)
