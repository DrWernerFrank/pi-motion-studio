# Review log: determinant-explainer

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-09-29 14:42 · director (self), round 1 · not yet

hook 6 · readability 7 · motion 7 · variety 8 · composition 6 · brand 8 · sound 1

1. **0s** First frame is a tiny unit square lost in an empty grid: the hook image is weak until 1 s  
   fix: Start the plane camera zoomed in on the square (span 2.6) and pull out as it shears, so frame 0 is a big amber square labelled 1
2. **40s** Near-blank frames at 39.8-40.2 and 57.8-58.1: one scene fully leaves before the next arrives  
   fix: Overlap: 3x3 kicker/headline enter at 39.9 and matrix at 40.05; recap cards exit 57.35, lockup enters 57.7
3. **29.3s** Coordinate labels stack on top of each other while the parallelogram flattens (flip at 29.3, collapse at 35.3); the formula-scene body text sits far from its headline in 16:9  
   fix: Fade the tip labels by |det| while a flip/collapse is in flight; move formula body lines directly under the headline

Structure and the live-plane device work in both formats after the portrait relayout. Sound not built yet.


> **note from you @ 8.82s:** its too load can you lower the volum a bit

## Round 2 · 2026-09-29 14:45 · director (self), round 2 · not yet

hook 8 · readability 8 · motion 8 · variety 8 · composition 7 · brand 8 · sound 7

1. **15.8s** Scene boundaries (15.8, 27.8, 33.8, 53.8) left near-empty text panels for ~0.4 s  
   fix: Outgoing text now exits on the same slots as the incoming roll (tOut ≈ next tIn); verified in the every-1.5 sheet
2. **35.8s** Collapsing grid turned into a muddy grey hatched band  
   fix: Transformed-grid alpha scales with |det| (0.15 floor) so the collapse reads as one clean line
3. **59s** Lockup caption (3.6u mono) is small next to the 16u det(A) in 16:9; the formula scene leaves the lower-left of panel A empty in 16:9  
   fix: Bump lockup captions to 4.2u; accept the formula-scene negative space (the eye is on the matrix)

Sound built (103 cues, piano score building to a drive section under the 3x3). Needs a listen and the loudness gate.


## Round 3 · 2026-09-29 14:48 · director (self), round 3 · PASS

hook 8 · readability 8 · motion 8 · variety 8 · composition 8 · brand 8 · sound 8

1. **24.3s** Worked-example hold 24.3-26.9 had no visible motion; the plane only returned at 27.8  
   fix: Done: the highlighters retract when the answer lands (26.0), the plane slides back with its 5 at 26.95 as the 'same 5 as the area' callback
2. **51.1s** After the 3x3 sum nothing moved for 2.7 s and the answer lived only in the small sum line  
   fix: Done: the big matrix's brackets morph into det bars and '= 8' is stamped beside it on the 52 downbeat
3. **57.8s** Recap card formulas stayed opaque while the cards faded out (rich() overrode the parent alpha)  
   fix: Done: rich() takes an alpha; cards pass theirs

Gates PASS (dead-time with maxStill 2.5 s: explainer reading holds). Novelty WARN in the formula build and the 3x3: events are frequent but small-area by nature. True peak -0.8 dBFS.


> **note from you @ 49.27s:** at 49.27 the times 0 : skip it texts comes to high and almost hits the upper 2 by 2 and the 2 by 2s are not in line
