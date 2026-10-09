# Review log: composite-s01

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-10-07 19:35 · producer-critic · not yet

hook 6 · readability 7 · motion 7 · variety 6 · composition 7 · brand 6 · sound 7 · fidelity 9 · coherence 8

1. **7.9s** the cut truncates the astronaut mid-name: edit.json c1 out=8.0 lands inside 'Kelly.' (the transcript has it at 7.87-8.34s) and dialog.wav ends at full level (max 0.0 dB in its last 0.3s) — the 0.3s crossfade softens the level but the word never completes  
   fix: out=8.4 (the word ends at 8.34) — the assembled piece becomes 69.73s, still inside the 50-70 ask; or land the cut in the clip's 6.27-6.82s silence and retime the seam
2. **0s** the first 6s are the clip's own dark sting: first-frame contrast 0.3 (the gates want >3), flat frames at 0/4.8/5.0s, and the first spoken word ('Hi.') is at 6.0s of a 7.9s segment — a slow open  
   fix: in=5.9 (open on the face saying 'Hi' — the sting loses nothing), or 0.5s of sting then a paper pre-roll card that carries the seam
3. **0s** the child's own ledgers are unfilled templates: brief.md is the blank edit scaffold and design.json's direction/devices/reference are placeholder text while the real system lives in s02/s03's files  
   fix: author them: the child brief (the cold open's job — a real face, the questions it sets up) and the design direction line

RE-MEASURED read-only. ffprobe: s01 finals 7.90s, 1920x1080 + 1080x1920, 30fps, h264+aac. THE REAL CLIP, pixel-verified in the delivered finals: the assembled final-16x9's frame at t=2.0 vs the conformed NASA fixture at t=2.1 = PSNR 43.9 dB; the 9:16 frame vs the fixture's center-crop = 34.3 dB — the real footage is in both formats, not a placeholder; the fixture's sha256 (f3dd2f87…) == a1 == the media bin's index.json pin. ebur128 of the assembled piece: -14.4 LUFS / -2.0 dBTP in both formats. The join at 7.9s: RMS windows ramp -25.6 to -16.1 dB with no discontinuity — the 0.3s crossfade works. Gates pass:true (hook/blank-frames warn — the clip's own sting, real footage keeps its truth). FIDELITY 9: the segment's real-footage ask is delivered and pixel-verified, but the plan's own acceptance 'ends on the question' is NOT met — the used span 0.1-8.0s contains no question at all (the source is an anti-bullying PSA; the cut lands mid-name instead). Judged from the ledgers, the gates and my own probes; the lead looked at the seam probes.

sheets: out/sheets/project-composite-s01.png
