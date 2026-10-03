from manim import DOWN, Create, NumberPlane, Polygon, Square, Transform, Write

from studio_manim import L, Eq, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s01_hook — a question and the moving image, no title card (craft 9.1).

    The plane is SIZED FROM L in both axes (x_length/y_length), so its span — and the transformed
    parallelogram inside it — fits every format's stage: in 9:16 the first draft kept the 16:9
    x_range and the shape clipped the right edge (the portrait sheet caught it).
    """

    scene_id = "s01_hook"

    def construct(self):
        plane = NumberPlane(
            x_range=[-4.5, 4.5, 1], y_range=[-2.75, 2.75, 1],
            x_length=L.stage.w * 0.95, y_length=L.stage.h * 0.80,
            background_line_style={"stroke_width": 1, "stroke_opacity": 0.45},
        )
        plane.move_to([L.stage.cx, L.stage.cy, 0])
        q = Txt("What does a determinant do?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        sq = Square(1).set_stroke(color_for("positive"), 3).set_fill(color_for("positive"), 0.25)
        sq.move_to(plane.c2p(0.5, 0.5))
        par = Polygon(
            plane.c2p(0, 0), plane.c2p(3, 1), plane.c2p(4, 3), plane.c2p(1, 2),
            fill_color=color_for("area"), fill_opacity=0.30,
            stroke_color=color_for("result"), stroke_width=3,
        )
        five = Eq(r"{{\text{area}}} \times {{5}}", roles={"p2": "result"})
        five.next_to(par, DOWN, buff=0.45)

        self.add(plane)
        with self.say("s01.1"):
            self.play(Write(q), run_time=1.2)
            self.play(Create(sq), run_time=self.until("shows"))       # "Watch the unit square"
            self.play(Transform(sq, par), Write(five), run_time=self.until("applies"))  # "as a matrix acts"
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale", says="s01.1")
        self.wait(0.5)
