# Progress

Now: P1 — spike S1 (footage in Chromium) needs the ffmpeg-only fixtures first: build `engine/fixtures.mjs` (sync barcode clip, vfr-rotated, hlg, noaudio, noisy, subject, screen, clips12 + song)
Next: S2 ASR (uv + Python 3.12 ML venv, faster-whisper small int8), S3 tracker (OpenCV YuNet), ADR-001..003, then P2 ingest

## Phases

- [x] **P0** Orientation: read code, INSPIRATION.md, branch, baseline, PROGRESS/DECISIONS, verify-edit + doctor skeletons, unknown commands exit non-zero
- [ ] **P1** Spikes S1 (footage in Chromium) S2 (ASR) S3 (tracking) + fixtures generator; ADR-001..003
- [ ] **P2** Ingest: media.json, conform, proxy, peaks, filmstrip, scenes, silence map, caches, relink, doctor green
- [ ] **P3** Edit model + first vertical slice: edit.json, ops + undo, edit.js (footage, __prepare), new --edit, render, edit_look + core edit_* tools; tag slice-1
- [ ] **P4** Transcribe + text-based editing
- [ ] **P5** Cut intelligence + seams
- [ ] **P6** Captions + on-footage graphics
- [ ] **P7** Reframe + formats
- [ ] **P8** Audio chain + color
- [ ] **P9** Speed: segment cache, partial re-render, budgets
- [ ] **P10** GUI editor
- [ ] **P11** pi surface + autoedit (tools, skill, critic agent, studio autoedit, AGENTS.md, README, help)
- [ ] **P12** Hardening: edge matrix, loud failures, cache gc, security pass
- [ ] **P13** Demo + review rounds, cold full verify, FINAL_REPORT.md

## Checks (mirrors `studio verify-edit --list`; tick when it passes in a full run)

- [ ] `env` (P2) doctor resolves ffmpeg, ffprobe, node, ML python, ASR model, tracker model, Chromium H.264 decode
- [x] `regress-films` (P0) the four motion films: gate verdicts and baseline frame hashes unchanged
- [ ] `fixtures` (P1) all fixtures generated + checksummed, plus a real open-licensed talking-head clip with its license
- [ ] `ingest-probe` (P2) media.json equals ffprobe truth; Windows/space/unicode paths; truncated file fails clearly
- [ ] `ingest-conform` (P2) CFR, upright, SDR bt709 tags, yuv420p; HLG luma within 6; cache hit < 2 s; relink by hash
- [ ] `frame-exact` (P3) 12 cuts on sync + vfr-rotated: 0 frames of error in preview and final
- [ ] `av-sync` (P3) beep vs flash <= 20 ms at start/middle/end, across 1.5x, and in the last 30 s of a 20-min timeline
- [ ] `rational-fps` (P3) 30000/1001 and 24000/1001: exact frame count, A/V durations within 2 ms
- [ ] `fidelity` (P3) passthrough edit vs ffmpeg decode: PSNR >= 40 dB, SSIM >= 0.98
- [ ] `parity` (P3) live seek, draft and final agree on 10 frames per fixture (SSIM >= 0.95)
- [ ] `determinism` (P3) identical per-frame md5 across runs; 4 workers equal 1 worker; determinism gate passes
- [ ] `edit-ops` (P3) every op round-trips under undo; invalid ops rejected; stale baseRev conflicts; 500 random ops; EDL round-trip
- [ ] `transcribe` (P4) WER <= 15% on speech; monotonic words; >= 90% in speech; cache hit; offline
- [ ] `transcript-edit` (P4) word-range delete cuts within 30 ms; retimed transcript >= 90% within 150 ms
- [ ] `cut-silence` (P5) no pause beyond max + pad, no clipped word start, no word lost
- [ ] `cut-cleanup` (P5) ums removed, flub removed with last take kept, everything else kept, removed text listed
- [ ] `cut-idle` (P5) no frozen stretch beyond max; active stretches untouched; speed-up keeps audio locked
- [ ] `seams` (P5) no clicks at 20 cuts, micro-fade >= 5 ms, no black/frozen at seams, J/L offsets honored
- [ ] `captions` (P6) layout in en/fa/ar+en/long word at 4 formats; safe area, <= 2 lines, >= 3.2u, no tofu, SRT/VTT valid
- [ ] `overlays` (P6) title, lower third, callout, punch-in change pixels only in their region and window
- [ ] `reframe` (P7) subject inside crop >= 95% of frames; speed/jerk caps; resets on cuts
- [ ] `formats` (P7) 9:16, 1:1, 16:9, 4:5 from one edit: WxH, yuv420p, bt709, SAR 1:1, AAC 48k, faststart, duration
- [ ] `audio-chain` (P8) -14 +/- 1 LUFS, <= -1 dBTP, music >= 8 dB under speech, noise floor -6 dB on noisy
- [ ] `color` (P8) exposure/contrast/saturation/temperature move as expected; identity LUT PSNR >= 60
- [ ] `segment-cache` (P9) unchanged re-render < 10% of cold; one-clip change re-encodes only its segments
- [ ] `perf-budget` (P9) ingest <= 0.5x, draft <= 1x, final <= 3x realtime; peak RSS <= 2.5 GB; temp dirs gone
- [ ] `gui-smoke` (P10) Playwright on a spare port: editor flows, zero console errors, zero failed requests
- [ ] `gui-security` (P10) no token gives 403; traversal/absolute/dotfile/unknown id rejected on every new endpoint
- [ ] `tools` (P11) every edit_* tool registers with a valid schema and runs on a fixture; skill + agent front matter parse
- [ ] `docs` (P11) studio help lists every command; README, AGENTS.md, skill, critic agent exist; THIRD_PARTY.md complete
- [ ] `golden-path` (P11) studio autoedit on every preset, unattended; talking-head exports 4 formats; gate PASS
- [ ] `montage` (P11) every cut within 1 frame of a beat; no clip twice; duration = target +/- 1 beat
- [ ] `review` (P13) demo reviews.json: >= 3 rounds, last by edit-critic, every score >= 8, sheets exist

## Done means

- [ ] `./studio verify-edit` exits 0 and `docs/editing/verify-last.json` has `"pass": true`
- [ ] every box above is ticked
- [ ] demo film reviewed by `edit-critic`, every score 8+
- [ ] `docs/editing/FINAL_REPORT.md` exists

## Known problems

- `./studio doctor` is red for `asr` and `tracker` until spikes S2/S3 install them (so `env` fails, correctly).
- `films/determinant-explainer` is truncated and cannot render (pre-existing, see D-001).
