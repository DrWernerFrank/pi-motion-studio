# Production log — composite

One line per decision, newest last.

- 2026-10-07 18:22  segment s01 (edit) -> films/composite-s01
- 2026-10-07 18:22  segment s01: draft + gates PASS -> done
- 2026-10-07 18:22  segment s02 (math) -> films/composite-s02
- 2026-10-07 18:22  segment s02 gates FAIL — it stays 'building' (fix films/composite-s02, then: studio project rebuild composite --only s02)
  claims: no sentences.json — run studio voice composite-s02 (the script parser writes it)
  narration: no timing.json with sentences — run studio voice composite-s02 first
  sync: no timing.json — run studio voice composite-s02 first ; seams continuous
  captions: captions are ON but out/captions.srt does not exist — studio sound composite-s02 writes it (exportCaptions) ; captions "auto" are ON (auto = on in 9:16) but there is no timing.json — run studio voice composite-s02
  loudness: no out/mix.wav — run studio sound composite-s02 (voice -> mix at mix.lufs)
- 2026-10-07 18:22  segment s03 (motion) -> films/composite-s03
- 2026-10-07 18:22  segment s03 gates FAIL — it stays 'building' (fix films/composite-s03, then: studio project rebuild composite --only s03)
  dead-time: nothing moves during 4.0-8.0s
- 2026-10-07 18:55  assembled (edit-film + 300 ms fades): 16:9 via direct+xfade, 9:16 via direct+xfade; one mix at -14 LUFS
- 2026-10-07 18:58  assembled (edit-film + 300 ms fades): 16:9 via direct+xfade, 9:16 via direct+xfade; one mix at -14 LUFS
- 2026-10-07 18:59  shipped: verify green, poster + credits + report written
- 2026-10-07 19:41  assembled (edit-film + 300 ms fades): 16:9 via direct+xfade, 9:16 via direct+xfade; one mix at -14 LUFS
- 2026-10-08 10:31  shipped: verify green, poster + credits + report written