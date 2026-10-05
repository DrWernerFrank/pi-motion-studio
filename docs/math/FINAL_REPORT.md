# Final report — Motion Studio makes math videos with Manim

Built on `feat/math-videos` from `templates/prompts/math-video-engine.md`. One engine, three front
doors (CLI / pi tools + `math-video` skill / the Studio GUI); every check measured, not asserted.

## What now exists

- **The toolchain (ADR-001)**: Manim 0.21.0 in a rootless venv — pycairo/manimpango compiled against
  a 61-deb user-space sysroot (wheels cached, no sudo ever needed again). A WSL PyPI-DNS gap needed a
  loopback CONNECT proxy (documented). Typesetting is Typst via `tex2typst` (ADR-002: LaTeX authoring,
  40/40 formula battery, deterministic); the voice is Piper with **native word alignments** (ADR-003).
- **The kit (`engine/manim/studio_manim/`)**: `StudioScene` with the narration clock (`say/at/until`:
  seek+pad, seam-gap truth, `overrun` traces), layout `L` (4 formats as re-compositions, never scaled
  copies), `Eq`/`Txt`/`num` (numbers from computation), the lint (offscreen/overlap/size-with-drawn-
  ink/contrast/density) + label solver, the claims engine (sympy, restricted namespace, coverage,
  `--independent` re-evaluation), the recorder (layout/trace/timeline per scene+format), and the
  component kit (Matrix/PlaneLab/GraphLab/EqSteps/Callout/gnomons/recap, `kit.md` with runnable
  examples, `inset()`, `EqMorph` — Typst has no TransformMatchingTex).
- **The pipeline (`engine/math.mjs`)**: per-scene content-addressed caches + a mux cache (warm
  re-render 1.5% of cold), seam-truth concat (clips cut at the next scene's first-sentence start —
  the A/V desync the critics found is dead), bt709 mux, the memory guard (`capped.mjs`: cgroup +
  watchdog + wall-clock + a total-RAM scheduler — the OOM class of failure is structurally impossible).
- **10 gates** (`math-gates.mjs`): layout (all formats), claims (artifact-verified), typeset,
  narration, sync (+ the **seam-continuity gate**: persisted-glyph detection at every cut),
  pace, captions, loudness, deliverable, deterministic. `studio ship` writes `out/claims.md`.
- **The pi surface**: 9 `math_*` tools, the `math-video` skill (SKILL + craft + kit + manim-notes),
  `math-critic`/`math-animator` agents, `where` (a note at 49.27s leads straight to the code).
- **The GUI**: `public/math.js` (Script/Scenes/Checks/Notes/Run tabs, format toggle, sentence
  click-seek + re-voice, the 9-key rubric chart) — gui-smoke green (0 console errors), gui-security green.

## Three ways to use it

- **one pi sentence**: `/skill:math-video explain eigenvectors in 90 seconds, narrated, 16:9 and 9:16`
- **CLI**: `./studio new det2 --math` → write `script.md` → `./studio voice det2` → write `scenes/*.py`
  → `./studio check det2` → `./studio render det2 --draft` → `./studio look det2` → loop → `./studio ship det2`
- **GUI**: `./studio gui` → the math film → Script tab (edit a sentence, it re-voices) → Run → Draft.

## The three demos (all `gates.json` PASS, both formats, lint clean — every one reviewed to the bar)

| film | len | claims | review |
|---|---|---|---|
| `films/determinant` | 50.5 s | 16 verified (det 5/−5/0/8, every minor, the swap-negation) | **PASSES** — r7: every key 8+, correctness 10, 7 honest rounds |
| `films/tangent` | 64.1 s | 25 verified (the h-sweep exact at every instant, tangents 2/4/6, the power rule) | **PASSES** — r24: every key 8+, motion/sound 9, correctness 10, 24 rounds |
| `films/odd-squares` | 65.7 s | 24 verified (1=1²…+9=5², 2k−1, the telescoping Σ, n=100→10 000) | **PASSES** — r22: every key 8+, clarity 9, correctness 10, 22 rounds |

**How the bar was reached** (the full trail is in each film's `reviews.json`/`review_log.md`): the two
held films sat at min 7 for ~20 rounds while every layout route was measured dead with complete
evidence trails (four layout deaths in tangent with the critics' own collision counts; the Σ-limit's
phone floor proven inherent by arithmetic in odd-squares). The last rounds then landed every named
live route — odd-squares: the music bed (a deterministic synth ducked 12 dB under narration), the
label swaps fired with the equations, the scene-turn beat compressed, the n=100 payoff beat, the
finale stack (the lead, the cap, one shared left edge, off the UI band); tangent: the two lull beats
(the P-pulse and the trace arc, both word-synced to the frame), the lim display grown through the
fit, the coefficient gap unified — and finally the ENGINE fix the critics' typography findings
converged on: manim's `{{…}}` label wrapper passed label bodies to typst in code context, so a
leading bare letter rendered upright while its own exponent rendered italic. `studio_manim` now
wraps every label body in `#[$…$]` (verified glyph-id-for-glyph-id); every film inherits it. Two
recorded-but-never-rendered fixes were caught by the record-gate re-verification and re-landed
for real — the critics' process working as designed.

## The verify table

`./studio verify-math` — **27/27 PASSED, 0 skipped, exit 0** from the final tree (the full run took
27 min; every number below is that run's measured row, `docs/math/verify-last.json`):

| check | measured |
|---|---|
| env / regress | doctor 20 probes green (8 math); the 4 motion films + the edit contract unchanged (verify-edit 5/5) |
| typeset | 40/40 formulas, deterministic, Persian RTL, broken formulas loud |
| render-determinism | identical framemd5 across cold pairs, both formats (35381c57…/0b06113e…) |
| formats | 4 geometries exact (bt709/SAR/faststart); portrait re-compositions (title 0.14 vs 0.23) |
| look | 7 modes × 4 formats (30 every / 15 phone / 12 strip each), labels carry scene+sentence, stale drafts re-render |
| layout-lint | 12 seeded violations exact (±1 frame), 0 false positives on 6 clean, solver 8/8 infeasible-loud |
| claims | 30 true / 15 false / tolerance / unparseable; `--independent` 48/48 fresh-process; a false claim blocks ship |
| script / voice | stable ids, bookmarks, line numbers; byte-identical TTS, ±1-sample offsets, WER 7% (en), fa voice, `narration.wav` aligns |
| sync / where | 6 bookmarks ≤1 frame (recorder + ASR-calibrated); 20 random `where` resolutions agree with trace |
| scene-cache | cold 16.1 s → warm 0.3 s (1.8%); one scene change → 1 render; one sentence → 1 re-voice; palette → all |
| concat-mux | joins clean (no black/frozen, both formats); A/V end 0.033 s; loudness −16/−1.4; **bed ducked 13.2 dB under narration** |
| errors / perf-budget | 7 failure modes loud with file:line; draft 0.81× realtime, check 68%, caps intact |
| library / captions / starter | kit 10/10 blocks ×4 formats, lint 0/0; en+fa captions ≤2 lines ≥3.4u, cmap clean; the golden path unattended to ship |
| gates / tools / docs / gui | seeded faults FAIL by name (incl. the seam gate); 9 tools live-verified; 34 commands; gui 0 errors, 403/traversal-proof |
| hygiene | no verify-* litter, no media leaks, scratch clean, cache gc frees the math caches |
| **demos / review** | **all three PASS**: determinant 16 claims/100% — r7 every 8+; tangent 25 claims/100% — r24 every 8+, motion/sound 9; odd-squares 24 claims/100% — r22 every 8+, clarity 9; correctness 10 with independent re-derivations in every final round |

## Skips, fallbacks, limitations (honest)

- **Tangent/odd-squares passed on their 24th/22nd rounds** — every named live route landed or
  measured dead; the residuals that remain are documented in their review logs and `brief.md`
  (which now declares the measured permanents: the 16:9 desktop-first cut, the Σ-limit arithmetic,
  the seam-unification trade, the s04 band).
- Claude/agent quota failures killed some critic sessions mid-round; the affected rounds were
  completed by the author and marked as such in the entries; two author-claimed fixes that never
  rendered were caught by critic re-verification and re-landed. A corrupt git object (NTFS/9p) was
  repaired from the intact parent + the working tree — verified content-neutral by bit-equal audio.
- piper is the only wired voice engine (kokoro installed as fallback, not wired). ASR `fa` is weak.
- 16:9 math is the desktop cut: the Σ-limit's phone-floor arithmetic is in brief.md; the 9:16 cut
  holds every floor.
- The music bed exists (film.json `music: {…}`: a deterministic synth score ducked 12 dB under
  narration, `out/bed.wav` the isolated ducked bed — concat-mux measures the duck); the default is
  still none.
- The full `verify-edit` result: **34/34 PASSED, 0 skipped** from the final tree (65 min,
  `docs/editing/verify-last.json` — the edit mission's contract holds untouched through the math
  build; the only edit-side code changed was the sweep's git-tracked guard, D-026).

## NEEDS_USER

Nothing is hard-blocked. Optional niceties: a louder-than-TTS music bed is designed (`music: none`
default), CUDA ASR is unproven on this box, and the films the human may want to revisit: the two
held demos' final keys are all named with their evidence in the review logs.
