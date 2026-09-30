# Review log: det-film

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-09-29 17:41 · author · not yet

brand 8 · composition 7.5 · hook 8 · motion 7 · readability 7.5 · sound 7 · variety 8

1. **6.3s** the 2×2→3×3 grow morph (letters slide outward, brackets expand, c→d / d→e re-letter squash) was a hard cut for 9 rounds due to a time-base bug; fix just landed, morph never watched in motion  
   fix: watch strip 6.24–6.75; if the inOutCubic reads sluggish before the new cells land, retime gp to outCubic or start the bracket expansion on the first arriving cell
2. **11.5s** the minors step is the conceptual core but its slot math (6.4u pitch, 4.8u cells) is still the smallest math in the film at phone size; source matrix shrank to make room  
   fix: phone-look 9.5–12.8; if slots still read small, raise slot pitch to 7u and drop the matrix to pitch 7.6 (both fit the portrait band)
3. **31.2s** zero case: the box now falls (origin 0.46→0.60) while flattening (elevation 30°→6°) and the vol label tracks it — collision behavior mid-collapse unverified  
   fix: strip 30.5–33; if the label still rides the shrinking box mid-collapse, hold it at yF 0.85 until flatP>0.6 then track down

Author round 1 (after 9 visual fix rounds via sheet reads; sound just mixed). Verified fixed: sum-line unit bug + "undefined" text, off-screen hero lockup, 2×2 mislabeled [a b; d e]→[a b; c d], grow-scene time-base bug (morph never animated), sfx synth infinity bug (engine swipe filter unstable past 0.35s), block→grow hard cut now fades, chip/source double-print, phone-scale pass on minors/captions. Still unverified by eye: the grow morph in motion, the zero-case slab read, final cue-sync feel. 9:16 is the primary format; 16:9 shares the u-system with portrait-adaptive card stacking.


## Round 2 · 2026-09-29 19:08 · author (eyes: antigravity-flash) · not yet

brand 8.5 · composition 7.5 · hook 7.5 · motion 7.5 · readability 8 · sound 7 · variety 7

1. **0s** hook energy: opens with a settling matrix + slow rough circle before det(A)=? lands at 1.3s — vertical-feed viewers decide in the first second  
   fix: rework the open: land det(A)=? BIG within 1.2s (drop the slow circle draw first), consider a 2-frame paper-tear wipe instead of the band wipe, jolt on the first cell slam
2. **13s** variety: 0–26s lives on the same beige grid-paper look; the only big visual change is the 3D box at 27s  
   fix: give each step its own accent treatment: e.g. strike-outs in a second ink tone for step 3, formula cards on torn-paper texture for step 4, a palette flip (ink/paper inversion) entering the meaning scene at 26.5
3. **11s** minors step still smallest math on a true 360px phone despite the 8.8/7.4u bumps (agent passed it at 440px sheet width)  
   fix: on portrait, show ONE minor at a time at ~2.5x scale (cross out → the single 2x2 fills the frame → docks into its slot), 1.2s per minor, then the triple reveal

Round 2 — first round with real eyes since the Claude vision limit: every visual verification this round came from an Antigravity agent on the user's Google AI Pro subscription (the new studio bridge). Verified fixed by the agent's own re-inspection: 6.11s block→grow ghost (fade now ends before the cut), 20.56s mid-flip squash, crossout minors + sign stickers now legible at phone size (matrix 8.8u pitch, slots 7.4u, signs raised clear at slotY−11u). Honest gaps that remain: the Antigravity director called the hook 'static' (stills-bias, but the energy point stands), 65% of runtime shares one beige-grid look (variety), minors step still reads small on a true 360px phone, sound not re-audited by ears this round. Scores reflect verified state, not the agent's harsher stills-based verdicts.

