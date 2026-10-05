# Craft: the math-film rules (mission §9, verbatim)

The engine is the other 90%; these rules are the product. Every rule below is the mission's §9
as written — the studio-side notes that follow each section say how THIS engine satisfies it.

## Openings and scenes

- Open with a concrete question or image in 3 s; no title card first. One idea per scene. Show
  before telling; introduce notation only after the idea; define every symbol on first use.

Studio: `s01_hook` is a question over a moving picture, never `chapter()` first — the recap
card is for the END.

## Color is meaning

- One color per concept, fixed in `design.json` `math.roles`, kept for the whole video. Never
  reuse a color for something else.

Studio: `math_role("positive")` raises on a missing role; `Eq` parts get roles via
`{{label}}` + `roles={p1: "positive"}`. The palette lives in `design.json`, never in a scene.

## Objects alive and transitions

- At most 3-4 text or math objects alive at once; clear the old before the new; connect
  representations with morphs (`TransformMatchingTex`, `ReplacementTransform`) instead of
  cross-fades; exits are directional or a collapse into the next object.

Studio: the density lint warns above 4 text/math objects; `swap`/`collapse` are the designed
exits. `TransformMatchingTex` is MathTex-only here (ADR-002: Typst backend) — the kit's
`EqMorph` is the label-matching morph that satisfies this rule.

## Pace and narration

- Pace: ~150 words per minute of narration. Reveal an equation as it is introduced (about 1 s),
  hold >= 1 s after it lands; a key result gets a 1.5-2.5 s hold and an emphasis on the
  narration word. Do not read formulas aloud verbatim: say the meaning ("the area scales by
  five"), put the symbols on screen.

Studio: `self.until("lands")` is how a reveal lands on the narration word; `hold(scene, 1.5)`
is the key-result hold. `math_script` action lint reports the word count and the ~wpm.

## Numbers

- Numbers come from computation (`num()`, claims). Use small integers for worked examples; show
  every step when the arithmetic is the lesson.

Studio: `claim("Matrix([[3,1],[1,2]]).det() == 5", says="s02.2")` — sympy decides, a failing
claim fails the check and the gate; `num(...)` renders the computed value. Nothing on screen is
typed by a human.

## Graph and plane scenes

- Graph and plane scenes: label only what the narration mentions, place labels with the solver,
  1-2 colors for vectors, a dim grid.

Studio: `PlaneLab`/`GraphLab` label through `studio_manim.solver` (never on the shape they
annotate); the grid is `design.json` `grid`/`gridBase`.

## Portrait

- Portrait is a re-composition: one object at a time in the middle third, equations stacked,
  captions on.

Studio: scenes are written against `L` (`L.panel(i, n)` stacks, the theme's portrait type
multiplier grows text) — D-009's rules; `captions: auto` turns them on in 9:16.

## The end

- End with a recap in at most 3 lines, the takeaway sentence and a hold of >= 1.2 s.

Studio: `recap([...])` (max 3 lines, `$…$` becomes Eq) + `hold(scene, 1.2)`.

## Music

- Default music: none or a quiet bed ducked 10-14 dB under narration; never compete with the
  voice.

Studio: `music: "none"` is the math default; the mix is narration-first at `mix.lufs` -16.
