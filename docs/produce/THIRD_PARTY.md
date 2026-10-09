# Third-party — the producer mission

What this mission downloaded or reused, with licenses and hashes. The earlier missions' records
still hold for their own surfaces (`docs/editing/THIRD_PARTY.md`, `docs/math/THIRD_PARTY.md`):
fonts, models, voices, the real NASA clip, the toolchain. The producer adds:

| What | Where | License | Notes |
|---|---|---|---|
| nothing new was downloaded | — | — | the producer is a composition layer over the existing engine; zero spend, zero network by default (its only network legs — `studio capture`, the facts/assets fetchers — use what the earlier missions already recorded, and the checks run against recorded fixtures) |

## Recorded API *shapes* (not content)

`engine/produce/fixtures/licenses/*.json` are SYNTHETIC metadata blobs written in this repo (the
Wikimedia Commons `extmetadata`, NASA images-api, Internet Archive, and CC0/PD field shapes) so the
license parser is tested offline, exactly as the mission requires (§3.14: "tests run against
recorded API fixtures"). They contain no third-party content — only the field names and license
strings those APIs return, re-typed by hand. A live fetch (a real asset) records URL + license +
sha256 in the using project's `assets.json` (K6), never here.

## Reused from the earlier missions (unchanged, their records hold)

- The ten bundled fonts (engine/fonts) — see `docs/editing/THIRD_PARTY.md`.
- faster-whisper `small`, Piper voices (en_US, en_GB, fa_IR), YuNet, RNNoise — `docs/editing/THIRD_PARTY.md`.
- The public-domain NASA talking-head clip — `docs/editing/THIRD_PARTY.md` (fixtures/real/).
- Manim 0.21.0, Typst/tex2typst, the built wheels — `docs/math/THIRD_PARTY.md`.

Every file this mission fetches during a production (a fact's source snapshot, a licensed asset)
lands in that PROJECT's `sources/`/`assets.json` with its origin + license + sha256 — the
project's own record, not this one.
