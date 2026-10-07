from manim import DOWN, LEFT, RIGHT, UP, Create, FadeOut, Polygon, Write

from studio_manim import L, StudioScene, Txt, claim, color_for


class Scene(StudioScene):
    """s02_proof — the rearrangement: the same 7x7, the same four triangles, two leftovers.

    Both tilings verified by area: 4 x 6 = 24 of triangles; 49 - 24 = 25 = 3^2+4^2 = 5^2.
    PINWHEEL: leftovers 3x3 + 4x4. TILT: leftover the tilted 5x5 (the hypotenuse square).
    """

    scene_id = "s02_proof"

    def construct(self):
        u = L.u * 5.6                      # one unit: the 7x7 spans ~3.4 frame units — room for the labels
        x0, y0 = L.stage.cx - 3.5 * u, L.stage.cy - 3.5 * u - L.u * 2

        def T(*pts):
            return Polygon(*[[x0 + p[0] * u, y0 + p[1] * u, 0] for p in pts],
                           stroke_width=2.8, stroke_color=color_for("ink"),
                           fill_color=color_for("area"), fill_opacity=0.42)

        def SQ(*pts, role="positive", fill=True):
            k = Polygon(*[[x0 + p[0] * u, y0 + p[1] * u, 0] for p in pts],
                        stroke_width=3.4, stroke_color=color_for(role))
            if fill: k.set_fill(color_for(role), opacity=0.30)
            return k

        box = SQ((0, 0), (7, 0), (7, 7), (0, 7), role="muted", fill=False)
        box.set_stroke_width(2.0)

        pin = [T((0, 0), (4, 0), (0, 3)), T((4, 0), (4, 3), (0, 3)), T((4, 3), (7, 3), (7, 7)), T((4, 3), (7, 7), (4, 7))]
        sq3 = SQ((4, 0), (7, 0), (7, 3), (4, 3))
        sq4 = SQ((0, 3), (4, 3), (4, 7), (0, 7))
        tilt = [T((0, 0), (4, 0), (0, 3)), T((4, 0), (7, 0), (7, 4)), T((7, 4), (7, 7), (3, 7)), T((0, 3), (0, 7), (3, 7))]
        # T1 is identical in both packings (bottom-left corner): it never moves
        sq5 = SQ((4, 0), (7, 4), (3, 7), (0, 3), role="result")
        # the labels at FIXED clear positions OUTSIDE the 7x7 (no next_to guessing: 3² at the
        # bottom-right corner outside, 4² at the top-left outside, 5² at the right outside —
        # the lint's no-overlap rule, satisfied by construction)
        # the labels FULLY outside the 7x7 bbox: move_to centers, so add the label's own
        # half-width (and the box stroke) — next_to with a real buff does this for us
        l3 = Txt("3²", role="math"); l3.next_to(box, RIGHT, buff=L.u * 1.2).shift([0, -(3.5 - 1.5) * u, 0])
        l4 = Txt("4²", role="math"); l4.next_to(box, UP, buff=L.u * 1.2).shift([(2.0 - 3.5) * u, 0, 0])
        l5 = Txt("5²", role="math"); l5.next_to(box, RIGHT, buff=L.u * 1.2).shift([0, (5.5 - 3.5) * u, 0])

        self.add(box)
        with self.say("s02.1"):
            self.at("four_copies")
            for k in pin: self.play(Create(k), run_time=0.5)
        with self.say("s02.2"):
            self.at("pack_a")
            self.play(Create(sq3), Create(sq4), Write(l3), Write(l4), run_time=1.3)
        with self.say("s02.3"):
            # THE REPACK, SHOWN: the same four triangles SLIDE into the second packing (the
            # critic: two pictures is not a proof — a transformation is). T1 is already in
            # place in both packs; T2-T4 morph to their new positions.
            from manim import ReplacementTransform as RT
            self.play(FadeOut(sq3), FadeOut(sq4), FadeOut(l3), FadeOut(l4), run_time=0.4)
            self.at("pack_b")
            pairs = [(pin[1], tilt[1]), (pin[2], tilt[2]), (pin[3], tilt[3])]
            for a, b in pairs:
                self.play(RT(a, b), run_time=0.8)
            self.play(Create(sq5), Write(l5), run_time=1.2)
        with self.say("s02.4"):
            self.at("both_shown")
            claim("7 ** 2 - 4 * (3 * 4 / 2) == 25", about="the same 7x7 minus the same four triangles: 25 either way", says="s02.4")
            claim("3 ** 2 + 4 ** 2 == 5 ** 2", about="so the leftovers are equal: 9 + 16 = 25", says="s02.4")
        self.wait(0.3)
