"""s01_plane — PlaneLab: a matrix acts on the plane, then its computed area (kit showcase).

16:9: the matrix in the left panel, the lab in the right (inset, so the page stops short of the
safe edge). PORTRAIT is a real re-composition: the matrix becomes a recipe chip in the top strip
and the lab takes the lower two-thirds (a tall box, equal units — the phone round measured the
parallelogram at a quarter of the frame when the lab shared the panel stack). The question leaves
BEFORE the matrix arrives (density + a designed exit); in s01.2 the area label REPLACES the matrix
on its own slot (``swap``: the old is gone before the new lands) on the word "five", pulsed on
the final "five" — the value is ``lab.area_value()`` (sympy det), never typed. No trailing hold: a
MIDDLE scene ends on its narration pad (a hold would push the next scene's voice over this
picture — the first sheet caught 2 s of exactly that).
"""

from manim import Create, FadeOut, Indicate, Write

from studio_manim import L, StudioScene, Txt, claim, math_role, num
from studio_manim.kit import Matrix, PlaneLab, inset, into, swap


class _Below:
    """An L-box view: the lower fraction of a box (portrait re-composition plumbing — the lab
    takes the tall remainder under the matrix chip; the kit reads only w/h/cx/cy)."""

    def __init__(self, b, top=0.32):
        self.x, self.w = b.x, b.w
        self.y, self.h = b.y, b.h * (1 - top)

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2


class Scene(StudioScene):
    scene_id = "s01_plane"

    def construct(self):
        A = [[3, 1], [1, 2]]
        q = Txt("What does a matrix do to area?", role="title")
        q.move_to([L.title.cx, L.title.cy, 0])
        lab = PlaneLab(inset(L.panel(1, 2), L.u * 1.5) if not L.portrait else _Below(L.stage),
                       fit=[A])
        m = Matrix(A)
        if L.portrait:                       # a recipe chip above the page, type already x1.5
            m.move_to([lab.box.cx, L.stage.y + L.stage.h * 0.845, 0])
        else:
            m.scale(1.5)                     # a co-protagonist, not a footnote (look r2)
            into(m, L.panel(0, 2), fill=0.8)
        m.set_column_colors(math_role("basis"), math_role("vector"))

        with self.say("s01.1"):                       # 4.62 s; "stretches" at 2.69
            self.play(Write(q), run_time=0.8)
            self.play(FadeOut(q), run_time=0.3)       # the question leaves before the answer
            self.play(Write(m), run_time=0.8)         # "a matrix acts"
            self.play(Create(lab), run_time=self.until("applies"))
            self.play(lab.apply(A), run_time=1.9)     # "stretches into a parallelogram"
        with self.say("s01.2"):                       # ~4 s; "five" (1st) and "five" (last)
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale factor", says="s01.2")
            area = lab.show_area(num(lab.area_value()))
            if L.portrait:
                area.scale(1.1).move_to(m.get_center())   # its slot: where the chip was
            else:
                area.scale(1.6).move_to(m.get_center())   # a panel-sized result, not a footnote
            self.wait(self.until("swap"))
            swap(self, m, area, run_time=0.9)         # the matrix becomes its area, on "five"
            self.wait(self.until("five"))
            self.play(Indicate(area, scale_factor=1.12, color=math_role("result")),
                      run_time=0.5)                    # the takeaway word (NEVER the default
                                                     # yellow: one color per concept — look r3)
        self.wait(0.05)   # ends the trace on an animation: the recorder's timeline reads
                          # trace[-1].t (a trailing sentence_end carries the sentence's FIRST
                          # animation t — 5.8 s was reported for an 8.9 s scene; recorder.py)
