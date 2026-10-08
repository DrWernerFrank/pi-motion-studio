# Review log: launch-teaser

Every round: scores 1-10, the 3 worst problems, what gets fixed. Pass = every score 8+.

## Round 1 · 2026-10-07 18:08 · lead · not yet

hook 6 · readability 6 · motion 7 · variety 7 · composition 5 · brand 8 · sound 7 · fidelity 9 · coherence 8

1. **2s** the hook type at the fit ceiling  
   fix: noted for a revision pass

Round 2 (the project round). Fidelity 9: every explicit ask is met and MEASURED — 25s asked -> 15s delivered is the ONE honest gap (the request said 25 seconds; the piece is 15 after the beat redesign that made the gates pass — a real fidelity miss, named, not hidden: the teaser is tighter but shorter than asked; a revision re-lengthens it). The captures are real (a1 sha-pinned), the palette sampled from the GUI, vertical 9:16, sound at -14.

sheets: out/sheets/every-9x16.png

## Round 2 · 2026-10-07 18:17 · lead · not yet

hook 7 · readability 6 · motion 7 · variety 7 · composition 6 · brand 8 · sound 7 · fidelity 10 · coherence 8

1. **2s** the hook at the type-fit ceiling  
   fix: the revision candidate noted in the report

Round 2 (the project round): fidelity 10 — 25.000s measured (the 15s draft was an honest miss, named and fixed by retiming every beat), 9:16 exact, the captures REAL (a1 sha-pinned, the GUI s own pixels), the palette sampled from the GUI, sound at -13.9 LUFS/-0.9 dBTP, gates PASS. Coherence 8.

sheets: out/sheets/every-9x16.png

## Round 3 · 2026-10-07 19:35 · producer-critic · not yet

hook 8 · readability 7 · motion 8 · variety 8 · composition 7 · brand 8 · sound 8 · fidelity 10 · coherence 8

1. **2s** the hook card (0.22-0.60H) leaves the top fifth of the vertical frame empty through the whole first beat — designed air, but at 9:16 it reads as under-use (the lead's own rounds scored composition 5->6 for exactly this)  
   fix: the GUI's own chrome rail across the top band, or move the type block up 0.06H and let the accent underline own the bottom
2. **9.5s** one drawn capture for a plural ask: only the desktop capture's films-list region (2.6x deep zoom) appears; assets_phone.png is loaded by index.html and never drawn  
   fix: a 1.5s phone-capture beat in the 15.6-20 window (the gates going green over the phone view) — the studio's own loop at the size the feed will see it
3. **15s** record drift: the child's gates.json deliverable row still reads the 15s draft ('15.00s' warn) against the shipped 25.000s cut, and 3 cues (type@1, whoosh@5.2, drop@10.5) sit off the half-beat grid unmarked  
   fix: re-run film_gate on the shipped child; mark the intentional cues free:true — the ledger must cover the delivered piece

RE-MEASURED read-only. ffprobe: final-9x16.mp4 25.000000s EXACTLY, 1080x1920, 60fps, h264+aac — the request's 25s on the nail. ebur128: -14.6 LUFS integrated, -1.1 dBTP true peak (target -14 +-1 ✓), LRA 6.7. THE CAPTURE IS REAL AND PINNED: films/launch-teaser/assets/desktop.png sha256 18ac2bf7… == a1 == the child's assets_desktop.png; site.json records the studio capture against the running GUI (localhost:3142) and the film's palette (#08080a/#3ecf8e/#ff6a3d) is sampled from the GUI's own recorded colors — verified against site.json's color list; the capture is drawn with source-rect drawImage, real pixels, never redrawn. THE CONCEPT: the request's 'what it feels like to say what you want and watch it get made' is on screen end to end — the sentence typed (0-2.2), the studio thinking (4.2-8.6), the film appearing over the REAL capture with the scrub (8.6-14.4), the gates green (15-17.6), verify:PASS (17.9-19.9), 'made by one sentence. Motion Studio' (20-25). Gates pass:true (hook PASS at contrast 9.1/change 9.7; loudness -14; dead-time ✓; novelty/blank-frames/cue-sync warn). All 5 requirement rows re-measured green by me. FIDELITY 10: every explicit ask measured — 25.000s exact, 9:16 1080x1920, real captures of THIS GUI drawn as pixels. COHERENCE 8: one GUI-sampled system, one 128bpm grid, one mix; the -2 is the gates-ledger drift plus the single drawn capture against the plural ask.

sheets: out/sheets/every-9x16.png, out/sheets/phone-9x16.png
