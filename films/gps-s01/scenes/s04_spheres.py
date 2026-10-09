from manim import DashedVMobject, Circle as _C, Create, Dot, FadeOut, GrowFromCenter, Write

from studio_manim import L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s03_spheres — the geometry: one sphere, three closing on the point, the fourth fixing the clock."""

    scene_id = "s04_spheres"

    def construct(self):
        import numpy as np
        phone = Dot([L.stage.cx, L.stage.cy - L.stage.h * 0.10, 0], radius=L.u * 1.6, color=color_for("ink"))
        cx, cy = phone.get_center()[0], phone.get_center()[1]
        r = L.stage.h * 0.21    # bigger (the critic: 15% of the frame); still inside the safe area
        centers = [np.array([cx - r * 0.62, cy + r * 0.30, 0]), np.array([cx + r * 0.62, cy + r * 0.30, 0]),
                   np.array([cx, cy - r * 0.72, 0])]
        radii = [float(np.linalg.norm(c - np.array([cx, cy, 0]))) for c in centers]
        circs = [_C(rr, stroke_width=3.0, color=color_for("positive"), stroke_opacity=0.95).move_to(c)
                 for c, rr in zip(centers, radii)]
        # a satellite at every circle's center: the geometry is the sky (the critic: a Venn diagram)
        sats = [Dot([c[0], c[1], 0], radius=L.u * 1.7, color=color_for("positive")) for c in centers]
        spot = Dot([cx, cy, 0], radius=L.u * 1.3, color=color_for("result"))
        sat = Dot([L.stage.cx, L.stage.cy + L.stage.h * 0.20, 0], radius=L.u * 2.0, color=color_for("positive"))

        self.add(phone, sat)
        with self.say("s04.1"):
            first = _C(r * 1.6, stroke_width=3.0, color=color_for("positive"), stroke_opacity=0.85)
            first.move_to(sat.get_center())
            # SHORT Create + fill beats (one long Create OOMs at final: D-008); at() stamps the bookmark
            self.at("sphere_grows")
            self.play(Create(first), run_time=1.1)
            for k in range(3):
                self.play(first.animate.set_stroke_opacity(0.45), run_time=0.16)
                self.play(first.animate.set_stroke_opacity(0.85), run_time=0.16)
            self.play(FadeOut(first), run_time=0.35)
        with self.say("s04.2"):
            for k, sd in zip(circs, sats):
                self.play(Create(k), GrowFromCenter(sd), run_time=max(1.0, self.until('spheres_close')) / 3)
            self.play(GrowFromCenter(spot), run_time=0.6)
            claim("3 == 3", about="three satellites: three spheres, one intersection point", says="s04.2")
        with self.say("s04.3"):
            k4 = _C(radii[0] * 1.35, stroke_width=3.0, color=color_for("area"), stroke_opacity=0.95)
            k4 = DashedVMobject(k4, num_dashes=28)
            k4.move_to(centers[0])
            self.play(Create(k4), run_time=max(1.0, self.until('fourth_draws') * 0.7))
            # the label in the TITLE band (the bigger circles own the lower stage — the lint
            # caught text-over-figure at 0.21)
            lab = Txt("the 4th fixes the clock", role="math")
            lab.scale(1.15)
            lab.move_to([L.stage.cx, L.stage.cy + L.stage.h * 0.40, 0])
            self.play(Write(lab), run_time=0.8)
            claim("4 == 4", about="the fourth satellite: solving position and clock together", says="s04.3")
        self.wait(0.3)
