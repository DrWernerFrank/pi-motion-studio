# Final report — Motion Studio edits real footage

Built on `feat/real-video-editing` from `templates/prompts/real-video-editing.md`. One engine, three
front doors (CLI / pi tools + `video-edit` skill / the editor GUI); every check of §8 measured, not asserted.

## What now exists

- **Ingest** (`studio ingest <film> <file> --id cam`): ffprobe truth into `media.json`, conform to CFR /
  upright / SDR bt709 / short-GOP (the render contract from ADR-001), proxy, peaks, filmstrip, scenes, a
  measured silence map; content-hash cached; `relink` repairs moved originals by sha256. NTSC rationals
  (`30000/1001`) exact end to end; HLG tonemapped (D-006); VFR/rotation/SAR/interlaced/10-bit/multi-audio
  all conform (hardening matrix).
- **The edit as data** (`engine/lib/edit-ops.mjs`): 20 ops (add trim split delete ripple-delete move
  reorder speed freeze volume fade xfade jcut cam color lut crop-keyframe overlay caption-style marker
  snap) — pure, validated, frame-snapped at the project rate, atomic, undo/redo, `baseRev` 409s. The
  dialog bus composites audio sample-accurately (micro-fades at splices, J/L offsets to the sample,
  atempo for retimes) over a denoised (RNNoise, D-014) source; the music bed ducks 12–14 dB under speech.
- **Measured cutting** (`studio cut`): silence/fillers/takes/idle/tighten — every cut point from the audio,
  the transcript only fences the words; every proposal ships its removed text for human veto (D6).
- **Captions as design** (`engine/lib/captions.js`): chunked, ≤2 lines, ≥3.2u, safe-area aware, face-aware,
  RTL/bidi (Vazirmatn bundled), pop/typewriter/karaoke; `.srt`/`.vtt` from the same chunks (D7).
- **Reframe** (`engine/track.mjs` + the follow camera): YuNet faces at 640 px or a seeded MIL tracker,
  critically damped spring + dead zone (D-013), per-format crop keyframes, blurfill.
- **The GUI editor** (`studio-gui/`): media bin, multi-track timeline with waveform + filmstrip, transcript
  pane (click-seek, strike-through word-range delete), split/trim/ripple/move with snapping, inspector,
  cut-proposal review, undo/redo, live refresh when the agent edits — in-process ops through `edit-ops`,
  token-gated, traversal-proof.
- **pi surface**: ten `edit_*` tools, the `video-edit` skill, the `edit-critic` agent, `studio autoedit`
  with four deterministic presets (talking-head / screen / audiogram / montage).
- **Speed** (D12): a segment cache keyed by per-window render-inputs hashes — an unchanged re-render is
  2.7% of cold; a one-clip change re-encodes only the segments it touches.

## Three ways to use it

- one pi sentence: *"Cut the dead air and the ums out of `~/Videos/interview.mp4`, add captions, give me 9:16 and 16:9"* (the `video-edit` skill)
- CLI: `studio new cut --edit` → `studio ingest cut interview.mp4 --id cam` → `studio transcribe cut cam` → `studio cut cut silence --apply` → `studio cut cut fillers --apply` → `studio edit cut caption-style --from cam` → `studio sound cut` → `studio ship cut`
- GUI: `./studio gui` → Edit tab → drag the source in → scrub the transcript → strike a range → Draft.

## The verify table

`./studio verify-edit` — every row measured; the full run's numbers are in `docs/editing/verify-last.json`.

| check | measured (this machine) |
|---|---|
| env | 12 probes ok (ffmpeg 8.0.1, faster-whisper small int8, YuNet, Chromium H.264 decode) |
| regress-films | 4 motion films byte-identical (8/8 frames ×3, broken one unchanged, D-001) |
| fixtures | 15 deterministic fixtures + real NASA clip, sha256-pinned |
| ingest-probe | media.json == ffprobe on 6 fixtures; Windows/space/é/ü/✓/fa paths; truncated → actionable error, no partial cache |
| ingest-conform | CFR/upright/bt709/yuv420p on 5 fixtures; barcodes 900/900+600/600 exact; HLG luma 124.8 (truth 126.1); cache hit 233 ms; relink by hash |
| frame-exact | 600 output frames across page/draft/final: 0 wrong (VFR→CFR holds dropped slots) |
| av-sync | quick spots +2 ms; 1.5× retime locked; 20-min timeline tail 1 ms (1188 s, 7 clips) |
| rational-fps | 30000/1001 & 24000/1001: exact frame counts, A/V ≤ 0.00 ms, dialog = N×1601.6 samples |
| fidelity | real1080 passthrough vs conformed source: PSNR 41.5 dB (min of 12), SSIM 0.981 |
| parity | page/draft/final ≥ 0.92 SSIM per frame in colour-matched space (D-012) |
| determinism | 1 worker == 4 workers, byte-identical repeat renders, the determinism gate on an edit film |
| edit-ops | 17 ops undo-identity, 20 specific rejections, batch atomicity, stale baseRev 409, 500 random ops (NTSC), EDL round-trip |
| transcribe | WER 0.0% (fillers excluded), lang en@1.00, 95% word midpoints in speech, cache 28 ms, offline |
| transcript-edit | word-range cut within 1 frame; retimed vs fresh ASR 92% within 150 ms |
| cut-silence | word-fenced: 5 cuts, longest word-free stretch < 0.65 s, no clipped starts, no lost words |
| cut-cleanup | 3 fillers + the abandoned take removed, retake kept, 0 words lost, all proposals carry removed text |
| cut-idle | freezedetect on conformed: idles gone (30 → 9.7 s), active stretches whole |
| seams | 17 tone splices click-free, 8 ms micro-fades, J-cut 152 ms honored, no black/frozen at joins |
| captions | en/fa-RTL/ar-bidi/long-word at 4 formats: ≤2 lines, ≥3.2u, no tofu; band differs only at cues; SRT/VTT monotonic |
| overlays | title/lower-third/callout bounded to region+window; punch-in spring monotonic to target, no overshoot |
| reframe | 60/60 subject-in-crop, subject-relative speed/jerk caps, cut reset, no black bars (D-013) |
| formats | one edit → 4 exact geometries, bt709 tags, SAR 1:1, AAC 48 kHz, faststart |
| audio-chain | mix −14.2 LUFS / −1 dBTP; bed ducks 13.8 dB isolated; noisy floor −33.3 → −57.2 dB (−23.9), WER +1.3 pts |
| color | exposure/contrast/saturation/temperature per-channel verified; identity LUT 70.1 dB on decoded frames (D-016) |
| hardening | vfr-phone/rot-180/odd-854/odd-123/SAR-2:1/120fps/10-bit-4:4:4/480i/mono/5.1/2-audio-streams/start-offset-1.48s/sub-1s/still-PNG/.mov-.mkv-.webm-.mts/decode-death — all conform frame-exact |
| segment-cache | cold 94.6 s → warm 2.6 s (2.7%); one-clip change re-encodes 2/6 segments, diffs confined to the changed span; overlay stage verified |
| perf-budget | ingest 0.18×, draft 0.62×, final 2.12× realtime, peak RSS 1010 MB, temp dirs gone |
| gui-smoke | editor flows end-to-end, 0 console errors, 0 failed requests |
| gui-security | tokenless POST → 403; traversal/absolute/dotfile/unknown ids → 4xx everywhere |
| tools | 10 edit_* tools registered with schemas + NAMES; every CLI path runs live |
| docs | 30 commands in help; skill + critic parse; THIRD_PARTY complete |
| golden-path | all 4 autoedit presets unattended (talking-head 4 formats 7/7 gates, screen, audiogram, montage) |
| montage | 12 cuts on measured beats (as heard), no source twice, 20.00 s exact |
| review | demo-cut: 19 rounds (16 by edit-critic), every final score 8+, round-1 min 3 → final 8 |

## The demo

`films/demo-cut/` — a 34.6 s cut of NASA's Scott Kelly anti-bullying PSA (public domain), built with the
real pipeline: cold open on the aphorism, the confession kept whole, the spoken CTA, word- and
sentence-fenced seams, captions (`.srt`/`.vtt`), punch-ins on emphasized words, a slow push through the
confession, a music bed ducked under speech, a faded close with the end card. `out/draft-*.mp4` in four
geometries. The review loop's 19 rounds and every sheet it looked at are in `reviews.json` / `out/sheets/`.

## Skips, fallbacks, limitations (honest)

- `arnndn`'s RNNoise model is fetched into `~/.local/share/…/models/rnnoise/`; without it the cleanup
  falls back to afftdn and logs it (D-014).
- ASR is CPU int8 (`small`): ~0.18× realtime; CUDA is unproven on this box (libcublas missing, ADR-002).
  Non-English: language detect works (`fa` 0.99); `small`'s fa transcription is weak — use `--model medium`
  (3× slower) when accuracy matters. CJK/Indic captions: Vazirmatn covers fa/ar/he; CJK/Indic are
  best-effort, documented, untested.
- The `edit-critic` reads frames through `edit_look` sheets; a full-rate GUI *playback* is still a
  throttled scrub preview (audio is master clock at 1× only when mix.wav is current) — P10's known degradation.
- `filmstrip` thumbnails degrade to flat blocks under ~9 px/thumb at extreme zoom-out.
- The 20-minute av-sync fixture leg makes the full verify ~45–70 min wall time (it's marked `slow` for `--quick`).
- GPU encoders (`h264_nvenc`/`h264_vaapi`) exist in this ffmpeg but are unproven at runtime; libx264 is
  the deterministic baseline (mission §3).

## Decisions worth a human look

`docs/editing/DECISIONS.md` — D-001 (determinant-explainer broken at baseline), D-012 (parity bar 0.92,
colour-matched), D-013 (critical damping: the NaN black-frame bug), D-014 (RNNoise over afftdn; no
compressor), D-015 (ducking measured on the isolated bed), D-016 (identity LUT measured on decoded frames).
Also: ducking −12 dB/150/400 ms; the trim-op ripples by default (gapless) — `ripple:false` leaves the gap.

## NEEDS_USER

Nothing is hard-blocked. Optional: `sudo apt install` of nothing was needed (all user-space). If you want
GPU ASR, the CUDA libs (`libcublas.so.12`) must be installed system-wide — the venv path was not used.
