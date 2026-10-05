# ADR-002 — Typesetting backend: Typst, with LaTeX authoring via tex2typst (S2)

**Decision.** The studio's default (and only) typesetting backend is **Typst** through Manim's
`Typst`/`MathTypst` (`manim[typst]`, the `typst` 0.15.0 abi3 wheel — a plain pip install, the mission's
sanctioned first route). **Authors write LaTeX**; the studio converts with `tex2typst` 0.6.2
(npm, Apache-2.0) inside a small studio-owned wrapper that also carries the label syntax
(`{{…:label}}` → Typst `{{…:label}}` selection labels; tex2typst strips braces, so the wrapper extracts
labels, converts the content, and re-emits them). The **LaTeX/TinyTeX route was built, measured, and is
not kept** (details below); reviving it is a re-download away (URL + sha256 in THIRD_PARTY).

**Evidence (40-formula battery, `~/.cache/pi-motion-studio/scratch/s2/`).** The battery spans fractions,
radicals, 2×2/3×3 matrices, cases, aligned, big operators, integrals, vectors, `\text`, Greek, primes,
binomials, norms, sets, congruences:

| route | compiled | avg/formula | determinism | named parts |
|---|---|---|---|---|
| MathTypst, LaTeX strings fed directly | **7/40** | 0.05 s | identical points hash | `{{…:label}}` + `.select()` |
| **tex2typst → MathTypst** | **40/40** | **0.05 s** | identical points hash | labels (via the wrapper) |
| MathTex, TinyTeX-1 + lean template | 40/40 | 0.14 s | identical points hash | substrings/`get_part_by_tex` |

Other measurements:
- The lean LaTeX template (`\documentclass{article}` + amsmath/amssymb/xcolor — no babel/standalone
  preview option) is REQUIRED with TinyTeX-1: Manim's default template wants `standalone.cls`
  (missing) and `babel[english]` (language missing), and **TinyTeX-1 ships no `dvisvgm`** — it took
  `tlmgr install dvisvgm standalone preview xcolor` (CTAN reachable) to get the LaTeX route to 40/40.
  TinyTeX-1 tarball: 53.6 MB, installs to ~300 MB. latex+dvisvgm add PATH + texmf-tree coupling that
  every future install must reproduce; `typst` is one abi3 wheel.
- Manim's Typst compile takes `font_paths` — the studio's bundled `engine/fonts/` TTFs plug straight in.
  Custom fonts in the LaTeX route need fontspec/XeLaTeX (not pursued).
- Persian RTL: `Typst` markup with `#set text(dir: rtl)` compiles (width measured; shaping verified
  visually in P2's `look`). On the LaTeX route RTL needs XeLaTeX/babel — heavier than the whole Typst
  wheel.
- Typst failures are concise and point at the token (`unknown variable: inom`) — the `errors` check
  wants "the backend's message, the formula and the fix"; LaTeX's message is a log-file path.
- `TransformMatchingTex` is MathTex-only (it asserts `MathTexPart`/`tex_string`; `typst_mobject.py`
  has neither). The kit therefore owns a label-matching morph for `Eq` (labels are explicit — more
  robust than substring guessing), which satisfies the craft rule's intent (morphs, not cross-fades).
  This is the one thing the LaTeX route would have given for free; measured against everything above,
  it does not justify keeping a 300 MB TeX tree on the default path.
- Mission blocker policy for a failing agent formula is "fix the formula or the converter, add it to
  the 40-formula battery" (§10) — single-backend is the intended shape; the battery is the converter's
  regression test. `\quad` → `quad` compiles; every `\text{}` in the battery round-trips.

**Consequence.** `studio_manim`'s `Eq` is Typst-backed; scenes never write Typst by hand. The `typeset`
check (P2) runs the 40-formula battery through the wrapper (conversion + compile + determinism + labels
+ a deliberately broken formula's error). `studio doctor` probes the typst wheel, not a TeX tree.
The TinyTeX tree (`.TinyTeX/`) and tarball were removed after the measurement; THIRD_PARTY keeps the URL
and sha256 so the LaTeX route can be revived if a formula ever defeats the converter.
