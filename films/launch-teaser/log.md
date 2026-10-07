# Production log — launch-teaser

One line per decision, newest last.

- 2026-10-07 10:30  segment s01 (motion) -> films/launch-teaser-s01
- 2026-10-07 10:31  segment s01 gates FAIL — it stays 'building' (fix films/launch-teaser-s01, then: studio project rebuild launch-teaser --only s01)
  dead-time: nothing moves during 4.0-25.0s
- 2026-10-07 18:08  segment s01 (motion) -> films/launch-teaser-s01 (existing film linked)
- 2026-10-07 18:08  segment s01: draft + gates PASS -> done
- 2026-10-07 18:21  shipped: verify green, poster + credits + report written