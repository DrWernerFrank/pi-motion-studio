# Review log: tangent

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-10-04 15:02 · critic · not yet

hook 7 · readability 7 · motion 7 · variety 7 · composition 7 · brand 8 · sound 7 · correctness 10 · clarity 8

1. **0s** author round 1: built by worker, gate-clean first try  
   fix: critic round 1 findings in review_log

author round 1 — tangent gates PASS; odd-squares contrast+blank-beat fixes applied


## Round 2 · 2026-10-04 15:15 · math-critic · not yet

hook 7 · readability 7 · motion 7 · variety 7 · composition 6 · brand 7 · sound 8 · correctness 10 · clarity 8

1. **23s** The live readouts — the instruments that carry the whole limit argument — are illegible at phone size: at 360px the 16:9 slope=/h= readouts render ~5-6px tall (2.00 vs 2.02 indistinguishable), tick labels are mush, dots near-invisible, the thin amber secant merges with the green curve as one muddy line until 26.5s, and the final "h → 0" is thin pale grey; in 9:16 the mid-scene algebra fraction line (~8px at 360px) is also too small.  
   fix: Scale the mono readout block ~2.5x into a fixed HUD slot (deep amber slope / red h per the color-is-meaning rule), thicken dots, ticks and the secant from the start, and render "h → 0" in the red h-color at full weight.
2. **19.6s** Every scene boundary is a simultaneous full reflow: title swaps while the formula/work block jumps slots (y=x² relocates between s01 and s02; at 47.0→47.5 the d/dx row reflows up ~65px when the lim line exits; 30.5→31.5 swaps title+layout at once) — the eye loses its anchor at each cut (glance-test continuity 6/10).  
   fix: Freeze fixed slots (title / plot / readout / work row) across scenes and change only their content with short cross-fades; never reposition surviving elements mid-film.
3. **38.3s** Chronic empty canvas in the back half and in portrait: s05 runs 60-90% empty in 16:9 (18.5s of stacked equations with big margins, left-of-center), s06 recap is 55-90% empty, top-heavy with a dangling reserved slot (9:16 recap equation crammed 25px under the text, left edges misaligned ~30px); in 9:16 the plot is a wide 2:1 box only ~12-25% of frame height with a dead bottom band (15-45% empty) in every scene — the portrait frame is never re-proportioned.  
   fix: Give 9:16 a taller plot (~45-55% of frame height) and a vertically centered recap block with aligned left edges; in both formats put a small live curve+tangent callback beside the s05 algebra and s06 recap so the ending echoes the spine instead of floating text on paper.

Round 2 by math-critic (vision) — full-res frame forensics on both drafts + the 360px phone test + fresh-sympy oracle (54/54 claims true). Re-derived by hand from the frames: secant readout (4−1)/(2−1)=3 ✓ shown at 17.25-19.5s; the difference quotient ((1+h)²−1)/h = 2+h is EXACT at every sampled readout — h 0.98/0.52/0.51/0.50/0.49/0.46/0.35/0.21/0.13/0.11/0.10/0.02/0.00 → slope 2.98/2.52/2.51/2.50/2.49/2.46/2.35/2.21/2.13/2.11/2.10/2.02/2.00 (verified pairs include the h=0.50 flash at t≈23.4 and the h=0.10 dwell at t≈24.2-25.0); tangent settles 2.00 at x=1, readout settles 4.00 at x=2 and 6.00 at x=3 with mid-sweep transients all exact (2.54=2+0.54, 2.86=2×1.43, 5.02=2×2.51); list rows 2/4/6 ✓; d/dx x²=2x, d/dx x³=3x², d/dx xⁿ=n xⁿ⁻¹ ✓ with the full expand/cancel chain shown on screen (t≈40 x²+2xh+h²−x² → t≈41 2xh+h² → t≈43 2x+h → t≈44 lim → 2x); line geometry matches the equations (secant y=3x−2 crosses the axis at x≈0.67; tangents cross at 0.5/1/1.5 for x=1/2/3). Not correctness issues, but flagged: h=0.50 flashes for only ~0.2s with no dwell while "a half" is spoken over ~1s (h=0.10 dwells ~0.8s and lands perfectly) — sync asymmetry; amber results render upright roman with a wide gap ("2 x", "3 x²", "n xⁿ⁻¹") against italic math elsewhere; d/dx fraction bars are hairline-pale; "h → 0" grey violates the red=h brand rule; lim highlighted amber in s05 but black in s03. Non-issues confirmed: the {name}/{p1} tokens live only in sheet labels (SRT clean, no burned captions); the mid-write "doubled glyphs" are a deliberate stroke-then-fill ink reveal (~0.5s, clears fully); audio is continuous voice, no clipping (max −1.5dB), level drift ≤1dB. Verdict vs the 8+ bar: NOT passing — correctness 10, sound and clarity 8, but composition 6 and hook/readability/motion/variety/brand at 7. The math spine (secant→pivot→live readout→rule) is exemplary; the layout craft lags it.

sheets: out/sheets/every-16x9.png, out/sheets/every-9x16.png, out/sheets/phone-16x9.png, out/sheets/phone-9x16.png
