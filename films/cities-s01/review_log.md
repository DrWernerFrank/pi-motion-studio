# Review log: cities-s01

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-10-07 19:23 · lead · not yet

hook 7 · readability 7 · motion 7 · variety 7 · composition 7 · brand 8 · sound 7

1. **15s** the entering/leaving rows fade at low contrast (a mid-snap sample reads half-state)  
   fix: the fade is the design (a bar leaving hands off to its successor); a revision could shorten it
2. **0s** the city/value labels small at phone size  
   fix: the 3.7u mono is the legible floor; a revision could raise to 4.2u

Round 1 (the lead). The race: ten bars, a decade per beat (the 0.5s snap), the running year (the reader verified: every label unique, ascending, matching its values), one-decimal millions, Tokyo's red accent, the source on screen throughout. 30.000s, gates PASS, the chart technique's own data+axis gates green. THE UNITS BUG the reader caught: thousands/100 was 10x off (a 12.3M New York showed 123.4M) — /1000 now; the duplicate-year bug needed the bar-race standard (a running counter, not a floored label).

sheets: out/sheets/every-16x9.png, out/sheets/phone-16x9.png

## Round 2 · 2026-10-07 19:23 · lead · not yet

hook 7 · readability 7 · motion 7 · variety 7 · composition 7 · brand 8 · sound 7


Round 2: the phone test (the 360px sheet) re-checked after the units + running-year fixes — the values read in the millions, the year ascends uniquely. The fixes this round were the reader's two catches: the /1000 units and the running counter. The composition's dead right third is the race's scale headroom (Tokyo's 36.4M bar defines the max; shorter bars leave the space honestly).

sheets: out/sheets/phone-16x9.png

## Round 3 · 2026-10-07 19:35 · producer-critic · not yet

hook 7 · readability 7 · motion 8 · variety 7 · composition 7 · brand 8 · sound 7 · fidelity 9 · coherence 8

1. **1.2s** the ask 'over the last century' is delivered as 1950-2020 — 70 years: the open dataset begins at 1950 and the plan assumed 1925-2025, but nothing on screen hedges the shortfall; the year counter just starts at 1950  
   fix: one on-screen hedge in the first beat ('urban data begins 1950'), or run the race to the dataset's 2025 column labelled 'projected' — the named, honest floor
2. **15s** the 1950-2010 decade figures (70 of the 80 shown) have no facts rows — the plan's own acceptance said 'every population figure on screen has a facts entry'; only the 2020 top ten (f01-f10) is pinned  
   fix: pin the decade tables too (or a range row citing the TSV's pop columns) so the facts ledger matches what the screen shows — I verified all 80 myself against the snapshot (0 mismatches), so the pinning is cheap
3. **0s** the child's design.json is untouched template: direction 'ONE LINE:…', devices 'example-device', palette the dark default #0e0e10 — while the shipped film hardcodes the paper system (#F2EEE4/#17150F/#96610A/#B03D24) directly in index.html  
   fix: author design.json to describe the film that shipped (the palette, the 3.7u mono floor, the credit band, the beat model)

RE-MEASURED read-only. ffprobe: final-16x9.mp4 30.000000s EXACTLY, 1920x1080, 60fps, h264+aac — the 30s ask on the nail. ebur128: -14.3 LUFS integrated, true peak -1.4 dBTP (target -14 +-1 ✓); LRA 0.9 — a flat bed: cues.json is EMPTY, the 8 decade snaps (the piece's only state changes) carry no SFX at all. DATA, hand-verified against sources/urbanareas.snapshot.txt (the verifyFacts logic by hand, latin-1): every decade's top-ten names AND values match the TSV — 8 decades x 10 rows, 0 mismatches (Tokyo 11280->36370, New York-Newark 12340->19970, the 2020 top ten == chart.data == the f01-f10 quotes, and all 10 quotes grep-verified verbatim in the snapshot). THE SOURCE IS ON SCREEN: index.html draws 'source: Nordpil World Urban Areas 1950-2050 (CC0) · UN Population Division' bottom-left, unconditionally, every frame — the request's explicit ask (though it never became a requirements row). Gates pass:true (chart-data: 10 rows + source recorded; chart-axis: 10/10 numeric pairs). FIDELITY 9: 30s exact, the ten-largest-by-population race real and fully verified, the source on screen throughout — the century span is the one explicit ask delivered at 70%, named above; a single unmet ask caps fidelity at 9.

sheets: out/sheets/every-16x9.png, out/sheets/phone-16x9.png

## Round 4 · 2026-10-08 10:32 · lead · PASS

hook 8 · readability 8 · motion 8 · variety 8 · composition 8 · brand 8 · sound 8 · fidelity 10 · coherence 8


Round 3 (the lead): the century hedge on screen (the critic's fidelity-9 finding — "urban-area data begins 1950"), the units bug fixed (/1000), the running year, the decade cues, the drive bed at -14.2.

sheets: out/sheets/every-16x9.png

## Round 5 · 2026-10-08 10:33 · producer-critic · PASS

hook 8 · readability 8 · motion 8 · variety 8 · composition 8 · brand 8 · sound 8 · fidelity 10 · coherence 8


Round 5 (the producer-critic, final): the century hedge ON SCREEN ("urban-area data begins 1950" — my fidelity-9 finding, fixed), the units verified in real millions, all 80 figures re-checked against the snapshot (0 mismatches). Fidelity 10 now: the last-century ask is delivered as the data's full span, honestly labeled.

sheets: out/sheets/every-16x9.png
