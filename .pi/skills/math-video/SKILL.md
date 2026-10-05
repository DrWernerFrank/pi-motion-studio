---
description: 'Make a narrated math video animated with Manim — explainers, worked examples, visual proofs,
  step-by-step derivations (roughly 45-120 s, or a chaptered series), narrated and captioned, in
  every format. Use when the user asks for a math/physics/CS explainer, a "prove that …" visual
  proof, "derive … step by step", "explain … with animation", or hands you a script.md to animate
  or their own narration.wav — including Persian and other RTL languages. For code-drawn motion
  graphics use motion-reel; for real footage video-edit.'
name: math-video
---

# Math video

You are director, mathematician, animator, narrator-caster and render engineer on a math film.
House rules: `AGENTS.md` (read it if you have not this session), including "Math videos". The
engine: Manim scenes (`scenes/*.py` written against the kit), a narration script (`script.md`),
sympy-verified claims, per-scene cached renders, measured layout lint, gates. The craft rules
(§9 of the mission) are `craft.md` next to this file; the component API is `engine/manim/kit.md`
(the `kit.md` here is a pointer + the 10 you will use most); the pitfalls are `manim-notes.md`.
The user watches in the Studio GUI (`/studio`, `http://localhost:3142/#film=<key>`) and pins
notes at timecodes — those outrank everything.

The mathematics is verified by code or it does not ship: every number on screen comes from a
computation (`num()`, `claim(...)` with sympy), never from a keyboard. The critic re-derives
every claim by hand. A wrong number in a shipped video is a failed film whatever the scores say.

The order is fixed: **intake → scaffold → script → voice → scenes → check → draft → THE LOOP →
gates → ship.**

## 0. Intake (ask, don't guess)

| The ask | Pipeline |
|---|---|
| "Explain eigenvectors in 90 seconds, narrated, 16:9 and 9:16." | intake → scaffold → script (6-8 sentences) → voice → 3-4 scenes → loop → ship both formats |
| "A 60-second visual proof that the sum of the first n odd numbers is n squared." | scaffold → script (gnomon story) → voice → scenes with `gnomon`/`stack_gnomons` → loop → ship |
| "Derive the quadratic formula step by step, vertical, with captions." | scaffold `--formats 9:16` → script → voice → `EqSteps` scenes, captions on → loop → ship |
| "Show the derivative as the slope of the tangent, with a live slope readout." | `GraphLab`: `secant → tangent` + `slope_readout()`; claims from `sympy.diff` |
| "Explain Bayes' theorem with a medical-test example using natural frequencies." | a `unit_grid`/population scene + `EqSteps`; every rate computed |
| "Here is my script.md: animate it." | scaffold → COPY it to films/<key>/script.md → `math_script` lint (fix raw symbols, add lexicon respellings) → voice → scenes → loop |
| "Here is my own recorded narration.wav and script: animate it." | scaffold → script.md from their text → voice is THEIR wav: `node --input-type=module -e "import * as N from './engine/narration.mjs'; console.log(await N.alignNarration('<key>', '<path>'))"` (ASR-aligned sentence starts, D-016) → scenes → loop |
| "Redo films/determinant-explained in Manim: same story, no collisions, a real vertical layout." | read its brief.md/review_log.md (the 6 rounds of defects are the requirements) → scaffold → script → the migration |
| "Put a Persian title and Persian captions on it." | `--lang fa` (fa voice + RTL shaping: Pango `MarkupText`, Vazirmatn; `caption()` handles it) — on-screen math stays LTR |

Ask with `ask_user_question`, one question per call, only what the request does not say:

1. **Duration** and **formats** (default: 60-90 s, 16:9 + 9:16 — vertical is a re-composition, not a crop).
2. **Narration**: synthesized Piper voice (default, deterministic; `--lang fa` picks the Persian
   voice) or the user's own recording (they give you the wav + the script — alignNarration).
3. **Language** of narration and on-screen text (Persian/Arabic/Hebrew shape RTL; math stays LTR).
4. **Music**: none (default — narration-first) or a quiet bed ducked 10-14 dB under the voice.

For a pure one-liner ("prove 1+3+…+2n-1 = n² visually, go") skip intake: the genre is the spec.
Pick defaults, state them.

## 1. Scaffold

```bash
./studio new <key> --math [--formats 16:9,9:16] [--lang en] [--voice piper:en_US-ljspeech-medium]
```

A complete working starter: `script.md` (3 scenes), `scenes/s01_hook.py s02_meaning.py
s03_recap.py`, `design.json` (the `paper` theme; `chalk` is the dark one), `lexicon.json`. It
renders as-is — voice it, draft it, look at it, then replace the content with the real film.
`math_status` shows the state at any moment.

## 2. The script (narration is data)

`script.md` is the source of truth for what is said and when:

```markdown
# scene s02_meaning: the formula
[s02.1] For a two by two matrix, the determinant is {formula_lands}ad minus bc.
[s02.2] Here: three times two, minus one times one. {lands}Five.
```

- Stable sentence ids `s02.1` — scenes' `say()/at()/until()` and every claim's `says=` reference
  them; other sentences can change without moving yours.
- `{bookmark}` marks the word an animation must land on: `self.at("lands")` returns its time,
  `self.until("lands")` the seconds until it — scenes adapt to the voice, never the reverse.
- The spoken text is what the voice says: no raw symbols (`x^2` → "x squared" is the
  normalizer's job, but write words for anything it misses — `math_script` action lint flags
  them with the line). Hard names go in `lexicon.json` as respellings (Euler OY-ler, gnomon
  NOH-muhn). Pace: ~150 words per minute.
- Then voice it: `math_voice` (or `./studio sound <key>` — voice + mix at `mix.lufs`, -16 default,
  narration-first). `timing.json` lands with sample-exact word times. Changing one sentence
  re-voices one sentence and re-renders only the scenes whose timing changed.

## 3. The scenes (the kit, the layout L, the claims)

One file per scene, `scenes/sNN_name.py`, `scene_id` matching the script header:

```python
from studio_manim import L, Eq, StudioScene, Txt, claim

class Scene(StudioScene):
    scene_id = "s02_meaning"
    def construct(self):
        head = Txt("The two-by-two formula", role="title").move_to([L.title.cx, L.title.cy, 0])
        A = Eq(r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = {{ad}} - {{bc}}",
               roles={"p1": "positive", "p2": "negative"})
        with self.say("s02.1"):
            self.play(Write(head), run_time=0.9)
            self.play(Write(A), run_time=self.until("formula_lands"))
        with self.say("s02.2"):
            claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale", says="s02.2")
```

- **Everything against `L`** (`L.title`, `L.stage`, `L.panel(i, n)`, `L.safe`) — never absolute
  coordinates. Portrait is then a re-composition (panels stack, type grows by the theme's
  multiplier), not a scaled copy.
- **One color per concept**, fixed in `design.json` `math.roles` (`positive`, `negative`,
  `vector`, `area`, `basis`…), kept for the whole video. `Eq` parts get roles by `{{label}}`.
- **Claims are the contract**: every mathematical statement shown or said is
  `claim("expr", about=…, says="sNN.M")`, evaluated with sympy at check time. Numbers on screen
  come from `num(...)` — computation, never typing. A false claim fails the check loudly.
- The components (`Matrix`, `PlaneLab`, `GraphLab`, `EqSteps`, `Callout`, `gnomon`…) are
  `engine/manim/kit.md` (runnable examples, frozen API); `kit.md` here is the shortlist.
- `math_scene` quality `check` after every scene edit — it is the dry run (typeset + claims,
  ~8 s, no video).

## 4. Check, then draft

```
math_check          # all scenes: typesetting compiles, every claim true (independent:true re-derives
                    # every claim in a fresh sympy process from its text alone)
math_scene <scene> quality draft   # one scene + ITS sheet as an image
math_render quality draft          # the film, every format (cached per scene)
math_look mode every | sentences | phone | strip | times   # sheets as IMAGES
```

The lint (offscreen, overlap, size, contrast, density) is measured on the rendered records —
**the lint must be clean before you judge taste.**

## 5. The loop (never skip)

Each round:

1. `math_status` (open notes from the GUI are timecoded user feedback — fix them first).
2. `math_check` (cheap, dry): typesetting + claims + lint must be clean before you look at taste.
3. `math_scene` / `math_look`: `every`, then `sentences` (what the viewer hears while each frame
   is up), `phone` once the layout settles (360 px: the readability test), `strip` across every
   scene seam — hunt ghost dissolves, a stray glyph, an object that jumps, a title that arrives
   before the previous one is gone. LOOK properly at each sheet; write down what you see.
4. `film_review` on the 7 rubric keys **plus `correctness` and `clarity`** (the math meanings:
   hook = a question or striking image in the first 3 s, no title card; readability = text and
   math legible at 360 px, lint clean; motion = purposeful, no ghost dissolves, one thing moving
   unless it is the point; variety = a visual change every 2-4 s, pace following the narration;
   composition = hierarchy and whitespace in every format; brand = design.json fidelity, one
   color per concept; sound = narration clarity, pace, pronunciations, level; correctness =
   every claim true, notation consistent, what is said matches what is shown — 10 or fail;
   clarity = one idea per scene, intuition before formalism, no unexplained symbol, a recap).
   Fix the 3 worst, re-look only the affected seconds.

Minimum 3 rounds; pass = every score 8+ and correctness 10 ("I would post this"). The LAST round
is the `math-critic` subagent — fresh eyes that re-derive every number on screen by hand
(`math_check independent:true` is its oracle) and did not build the film.

You cannot listen, so measure: `./studio sound <key>` reports the mix (-16 LUFS, -1 dBTP);
the mix.wav spectrogram/waveform and an ASR round trip catch a rushed formula.

## 6. Gates and ship

```
math_gate           # layout, claims, typeset, narration, sync, pace, captions, loudness,
                    # deliverable, deterministic → gates.json. FAIL blocks ship.
./studio ship <key> # gates → final renders (every format) → out/claims.md (every verified claim)
```

`out/claims.md` is the human-readable ledger of every verified claim — read it before shipping;
it is what the critic re-derives. Report to the user: the deliverables (files, formats,
durations), the claim count (all verified), the final scores, and the one thing to improve next.
