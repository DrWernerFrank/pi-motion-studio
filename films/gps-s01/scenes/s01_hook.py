from manim import DOWN, Create, GrowFromCenter, Write, Dot, Line

from studio_manim import L, StudioScene, Txt, color_for


class Scene(StudioScene):
    """s01_hook — the question: a phone, satellites overhead, and a clock.

    The hook is the IMAGE (craft 9.1): the phone at the bottom of a sky holding
    satellites, one beam connecting them (the story's whole idea in one line),
    and the word that explains it — a clock. Everything SIZED FROM L and big
    enough to read at phone size (the critic's 3x rule).
    """

    scene_id = "s01_hook"

    def construct(self):
        # the sky: satellites (BIG dots — the critic: 3x) in the upper band, the phone below
        sky_y = L.stage.cy + L.stage.h * 0.24
        phone_y = L.stage.cy - L.stage.h * 0.22
        sats = []
        for i, fx in enumerate([-0.36, -0.12, 0.12, 0.36]):
            s = Dot([L.stage.cx + fx * L.stage.w, sky_y + (0.05 if i % 2 else -0.03) * L.stage.h, 0],
                    radius=L.u * 2.2, color=color_for("positive"))     # 2.2u: readable at phone size
            sats.append(s)
        phone = Dot([L.stage.cx, phone_y, 0], radius=L.u * 1.8, color=color_for("ink"))
        # ALL FOUR beams (the critic: the phone must be visibly connected to the satellites)
        beams = [Line(s.get_center(), phone.get_center(), stroke_width=L.u * 0.7,
                      color=color_for("result"), stroke_opacity=0.8) for s in sats]
        q = Txt("How does it know?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        # the word that matters — placed CLEAR of the phone (the critic: the collision)
        clock = Txt("an atomic clock", role="math")
        clock.next_to(phone, DOWN, buff=L.u * 3.4)   # well below the dot, no overlap

        self.add(q)
        with self.say("s01.1"):
            self.play(GrowFromCenter(phone), run_time=0.7)
            for s in sats: self.play(GrowFromCenter(s), run_time=0.3)
            for b in beams: self.play(Create(b), run_time=0.3)          # the connection, always on
        self.wait(0.15)
        with self.say("s01.2"):
            self.play(Write(clock), run_time=1.0)
            # the beats: the beams PULSE as the clock word lands (life, not a still frame)
            for b in beams:
                self.play(b.animate.set_stroke_opacity(0.35), run_time=0.18)
                self.play(b.animate.set_stroke_opacity(0.85), run_time=0.18)
        self.wait(0.3)
