# ADR-001: footage inside the canvas (decides D2)

Status: accepted (spike S1, 2026-10-01). Harness: `docs/editing/spikes/s1.{html,mjs}`, `s1-color.mjs`. Chromium 153 (Playwright headless shell), 12-core WSL2, software decode.
Media: `sync` fixture (frame-index barcode) conformed three ways, plus a real clip. Seek target is the middle of frame n, `(n + 0.5) / fps`.

## Decision
Footage is a `<video>` element on **conformed** media (CFR at the project fps, upright, bt709 tags, yuv420p, H.264 with a keyframe
every 15 frames and no B-frames). A frame is produced by: set `currentTime = (n + 0.5)/fps`, await `seeked`, `drawImage`. Nothing else:
no `requestVideoFrameCallback`, no polling. `window.__prepare(t)` (awaitable) does this for every layer; every caller (render, stills,
gates, GUI) awaits it before `seek(t)`/`__still(t)`. The ffmpeg frame-feed alternative is not needed and stays a documented fallback.

## Measured
| media | random seeks (500) wrong | sequential (300) wrong | ms/seek random | ms/frame sequential |
|---|---|---|---|---|
| 720p, GOP 15, no B | 0 | 0 | 25.0 | 24.2 |
| 720p, all-intra | 0 | 0 | 17.0 | 16.0 |
| 1080p, GOP 15, no B | 0 | 0 | 53.3 | 33.3 |

- **Frame exactness: 0 errors in 2400 seeks** (barcode read back from the canvas equals the planned frame), also for 30000/1001 (real clip).
- `requestVideoFrameCallback` never fires in headless: every wait hits its 450 ms guard. Rejected; `seeked` + `drawImage` is already exact.
- Determinism: four pages loading the same media in parallel returned identical PNG hashes for 7 frames (random-access order included).
- Short GOP vs all-intra: both exact; all-intra seeks ~30% faster but the file is ~56% bigger (30.4 vs 19.5 MB for 30 s of 720p at crf 16). Conformed render media is short-GOP; the low-res scrubbing proxy is all-intra (D1).
- `canPlayType('video/mp4; codecs="avc1.640028"')` = "probably" and real decode works, including High 4:4:4 Predictive (not needed).
- **Colour vs an ffmpeg decode** (bt709 limited -> full RGB, same frame, barcode strip excluded):
  - natural footage (real NASA clip): PSNR **50.6 / 46.4 / 43.7 dB**, signed bias < 1.7 levels: the `fidelity` bar (>= 40 dB) is reachable through `<video>`.
  - `testsrc2` (six fully saturated primaries on the limited-range gamut edge): **34 dB**, offset concentrated in blue. Same on a 4:4:4 conform, so it is not chroma upsampling; it is rounding/clamping at the gamut boundary. A bt601 reading is worse (28 dB), full-range-as-limited much worse (25 dB), so the matrix/range handling is correct.
  - Consequence: `fidelity` and `parity` thresholds are measured on natural footage (the real clip); synthetic saturated test patterns are for geometry and timing only.
- Estimated render cost (to be calibrated in P9): one worker ~24 ms/frame at 720p, ~33 ms at 1080p before overlays and x264; four workers scale across cores.

## Consequences
- `engine/lib/edit.js` exposes `footage(ctx, clip, t, rect, opts)` over `<video>` elements, one per source/layer, plus `window.__prepare(t)`.
- Time is frames: the seek target is computed from the integer frame and the rational fps, never from accumulated float seconds.
- Media served to the browser must live inside the repo (`films/<key>/assets/media/<id>/`), because the server only serves under the repo root.
- A source whose conform is stale or missing is a loud error, never a fallback to the original.
