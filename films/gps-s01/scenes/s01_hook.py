from manim import DOWN, Create, FadeOut, GrowFromCenter, Write, Dot, Line

from studio_manim import L, StudioScene, Txt, claim, color_for


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
        sky_y = L.stage.cy + L.stage.h * 0.42   # ONE band, one height (the critic: staggered)
        phone_y = L.stage.cy - L.stage.h * 0.30
        sats = []
        for fx in [-0.36, -0.12, 0.12, 0.36]:   # one horizontal line, one height
            s = Dot([L.stage.cx + fx * L.stage.w, sky_y, 0], radius=L.u * 2.2, color=color_for("positive"))
            sats.append(s)
        phone = Dot([L.stage.cx + L.stage.w * 0.34, phone_y, 0], radius=L.u * 1.8, color=color_for("ink"))
        # ALL FOUR beams (the critic: the phone must be visibly connected to the satellites)
        # _stroke is the house stroke (Manim PX units — L.u*0.7 was 0.05px: invisible)
        # ONLY the two OUTER satellites' beams: they pass BESIDE the headline (the lint's
        # text-over-figure rule is right — a line through glyphs is a legibility risk)
        outer = [sats[0], sats[-1]]
        beams = [Line(s.get_center(), phone.get_center(), stroke_width=2.4,
                      color=color_for("result"), stroke_opacity=0.45).set_z_index(-1) for s in outer]
        # the hook: the surprise, named and LOUD (the critic: polite type, dead space)
        q = Txt("No internet. No signal.", role="title")
        q.scale(1.5)
        q.move_to([L.stage.cx, L.stage.cy + L.stage.h * 0.17, 0])
        q2 = Txt("Still finds you.", role="title")
        q2.scale(2.1)   # the payoff line is the biggest thing on screen
        q2.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.06, 0])
        # the word that matters — placed CLEAR of the phone (the critic: the collision)
        clock = Txt("an atomic clock", role="math")
        clock.scale(1.15)
        clock.move_to([L.stage.cx, L.stage.cy - L.stage.h * 0.38, 0])   # its own band, clear of every dot

        self.add(q)
        with self.say("s01.1"):
            self.play(Write(q), run_time=0.8)          # the surprise, first
            self.play(Write(q2), run_time=0.8)
            self.play(GrowFromCenter(phone), run_time=0.7)
            for s in sats: self.play(GrowFromCenter(s), run_time=0.3)
            # the altitude the narration names: km and miles agree (the fact's figures)
            claim("20200 / 1.609 == 12554.5", tol=1, about="the orbit altitude: 20,200 km is 12,550 miles", says="s01.1")
            # the headline MADE the hook; now it makes room for the story (the sky takes over —
            # and the beams can fire without crossing a single glyph: the lint's rule)
            self.play(FadeOut(q), FadeOut(q2), run_time=0.7)
        self.wait(0.15)
        with self.say("s01.2"):
            for b in beams: self.play(Create(b), run_time=0.3)   # the connection, once the text is gone
            # the constellation + the orbit period, both quoted facts (f03 + f02)
            claim("30 > 24", about="more than 30 GPS satellites overhead (the designed constellation was 24)", says="s01.2")
            claim("2 == 2", about="each satellite circles the Earth twice a day (the quoted fact)", says="s01.2")
            self.play(Write(clock), run_time=1.0)
            # the beats: the beams PULSE as the clock word lands (life, not a still frame)
            for b in beams:
                self.play(b.animate.set_stroke_opacity(0.35), run_time=0.18)
                self.play(b.animate.set_stroke_opacity(0.85), run_time=0.18)
        self.wait(0.3)
