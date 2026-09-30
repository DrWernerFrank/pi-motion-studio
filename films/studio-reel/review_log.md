# Review log: studio-reel

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-09-29 12:55 · author (round 1, before fixes) · not yet

hook 6 · readability 5 · motion 7 · variety 8 · composition 6 · brand 7 · sound 3

1. **6.5s** contact-sheet tiles are tiny and show random bars: unreadable at phone size, and they are not the film  
   fix: tiles become real thumbnails: drawFrame(t) recursively, 4x3 / 5x3 grid, frame aspect
2. **4s** chart ticks, dashed target and leftover curve stay behind the Render button  
   fix: retract ticks and target with the erase at 3.5s
3. **0s** frame 0 is empty; 16:9 type too small and lockup small; faint seams in the band wipe  
   fix: start the hook mid-rise; landscape scale 1.45/1.6; pixel-snapped bands + solid fill

no sound yet


## Round 2 · 2026-09-29 12:55 · author · not yet

hook 7 · readability 7 · motion 8 · variety 9 · composition 7 · brand 8 · sound 3

1. **1s** portrait hook: lower half of the frame is empty for 2s  
   fix: mono time readout under the block (t = 0.25 s · frame 015) ticking: the device that proves it is a program
2. **2.8s** spring() label and lockup tagline too small at 360px  
   fix: label x1.35, tagline x1.35
3. **0s** no sound yet  
   fix: cues on the grid + synthesized drive score, film_sound



## Round 3 · 2026-09-29 12:58 · author · PASS

hook 8 · readability 8 · motion 8 · variety 9 · composition 8 · brand 8 · sound 8

1. **2.9s** quiet stretch while the curve settles (gate data: <1% change 2.9-3.6s)  
   fix: done: overshoot 23% annotation pops at the peak on beat 5
2. **4.5s** button label faded out before the cursor clicked it (phone test)  
   fix: done: label holds through the click, morph starts 4.72
3. **10s** iris revealed an empty frame; half-row edge artifact at fractional preview scales  
   fix: done: lockup starts 80ms earlier; runtime maps W×H onto the integer canvas

sound scored from the cue plan vs the beat grid and the measured mix (-14.1 LUFS, -1.1 dBTP), not by ear. Next improvement: the lockup end (11.3-12s) is calm; a final beat-locked accent pulse would land the ending harder.


