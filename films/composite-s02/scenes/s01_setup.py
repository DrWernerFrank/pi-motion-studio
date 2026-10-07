from manim import Create, Polygon, Write

from studio_manim import L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s01_setup — the triangle, the square on a leg, and the question."""

    scene_id = "s01_setup"

    def construct(self):
        u = L.u * 6.8   # one unit — the triangle owns the stage
        cx, cy = L.stage.cx - u * 2.0, L.stage.cy + u * 0.6
        O = [cx, cy, 0]                       # the right-angle corner (bottom-left)
        P = [cx + 3 * u, cy, 0]               # along the base (leg a=3)
        Q = [cx, cy + 4 * u, 0]               # up the side (leg b=4)
        tri = Polygon(O, P, Q, stroke_width=3.0, stroke_color=color_for("ink"),
                      fill_color=color_for("area"), fill_opacity=0.25)
        # the square on leg a (below the base): O -> P -> down -> down-left
        D1, D2 = [P[0], P[1] - 3 * u, 0], [O[0], O[1] - 3 * u, 0]
        sqA = Polygon(O, P, D1, D2, stroke_width=3.0, stroke_color=color_for("positive"),
                      fill_color=color_for("positive"), fill_opacity=0.18)
        # the leg labels — OUTSIDE every polygon's bbox (the union spans x [O,u*3] y [O-u*3, O+u*4];
        # the labels sit in the clear margins: left, below, right)
        l3 = Txt("3", role="math"); l3.move_to([O[0] - u * 1.2, O[1] - u * 2.2, 0])          # left of the square
        l4 = Txt("4", role="math"); l4.move_to([O[0] - u * 1.2, O[1] + u * 2.0, 0])          # left, mid-height
        l5 = Txt("5", role="math"); l5.move_to([O[0] + u * 3.4, O[1] + u * 3.0, 0])           # right, above the hypotenuse end
        q = Txt("why?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])

        self.add(tri)
        self.add(l3, l4, l5)
        with self.say("s01.1"):
            claim("3 ** 2 + 4 ** 2 == 5 ** 2", about="the 3-4-5 triple: nine plus sixteen is twenty five", says="s01.1")
            self.play(Write(q), run_time=1.0)
        with self.say("s01.2"):
            self.at("squares_draw")
            self.play(Create(sqA), run_time=1.1)
        self.wait(0.3)
