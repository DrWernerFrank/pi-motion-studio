# The capability catalog (generated 2026-10-07 by `studio capabilities --doc`)

A *technique* makes a piece; a *service* is a reusable capability any technique calls. This
page is generated from the same source as `studio capabilities` — edit the catalog, not this file.

## asr — service

**Makes:** word-level transcripts of ingested audio/video (local ASR).
**Strengths:** local (never uploaded); word boundaries refined against audio; cached by content hash.
**Weak:** accuracy drops on heavy accents/noise; no speaker diarization.
**Needs:** ml-venv + whisper small.
**Invoke:** `studio transcribe <key> <src-id>; studio transcript <key> <src-id> --grep …`
**Gates:** WER <= 15% on speech fixtures, monotonic words.

## assemble — service

**Makes:** one piece from segments rendered by any technique.
**Strengths:** edit-film assembly: captions/reframe/sound/ship already exist; designed joins (no black frames); one loudness pass.
**Weak:** each segment encoded at most once more (K8).
**Needs:** ingest.
**Invoke:** `studio ingest <key> <segment-final.mp4> --id s01 (an edit film assembles); studio project assemble <key> lands with P3`
**Gates:** assemble check: geometry, bt709, A/V within 1 frame, PSNR per segment.

## captions — service

**Makes:** on-screen captions (en/RTL) + SRT/VTT from the same chunks.
**Strengths:** design-aware (3 styles from design.json); safe-area + phone test; fa/ar RTL shaping.
**Weak:** burned-in by design (not toggleable post-render).
**Needs:** Vazirmatn (fa).
**Invoke:** `edit films: edit caption-style op; math: studio sound writes SRT/VTT; studio captions <key>`
**Gates:** <= 2 lines, >= 3.2u, no tofu, monotonic SRT/VTT.

## capture — service

**Makes:** real screenshots, logos, colors and fonts of a site (the brand truth).
**Strengths:** real pixels, never redrawn from imagination; site.json carries palette+fonts.
**Weak:** needs a reachable URL; some sites block headless browsers.
**Needs:** chromium.
**Invoke:** `studio capture <key> <https://url>`
**Gates:** assets/ contains the captures; site.json parses.

## chart — technique

**Makes:** animated data charts: bars racing ranks over time, drawn from a data file (chart.json) the film reads in setup — the GDP/population style pieces.
**Strengths:** the data + axis gates make the chart honest (rows + source + numeric pairs checked mechanically); motion-based: one timeline reframes to every format; the drawn chart is a pure function of (chart.json, t).
**Weak:** no real footage; no narration of its own (the voice service adds one); a chart film needs its data sourced (facts) — the gates check the file, not the truth of the figures.
**Typical:** 10-60 s, 16:9 + 9:16
**Invoke:** `studio new <key> --chart` · `studio look <key>` · `studio render <key> --draft` · `studio sound <key>` · `studio gate <key>` · `studio ship <key>`
**Gates:** chart-data (rows + the source every figure cites), chart-axis (every row a numeric pair).
**Skill:** `.pi/skills/produce/SKILL.md` · **Critic:** `.pi/agents/producer-critic.md`

## edit — technique

**Makes:** real-footage edits: interviews, talking heads, podcasts, screen recordings, highlight reels.
**Strengths:** measured cuts (silence/ums/retakes from the audio); word-accurate captions; reframe to vertical; dialog bus + ducked bed.
**Weak:** cannot invent footage; long films need patience (one pass per source).
**Typical:** 5-90 s, 16:9 + 9:16 + 1:1 + 4:5
**Needs:** real footage (the human's files).
**Invoke:** `studio new <key> --edit` · `studio ingest <key> <file> --id cam` · `studio transcribe <key> cam` · `studio cut <key> silence --apply` · `studio look <key>` · `studio render <key> --draft` · `studio sound <key>` · `studio gate <key>` · `studio ship <key>`
**Gates:** edit gates (the verify-edit contract), frame-exact, av-sync, captions.
**Skill:** `.pi/skills/video-edit/SKILL.md` · **Critic:** `.pi/agents/edit-critic.md`

## ingest — service

**Makes:** conformed, probe-true media from any real file (CFR, upright, SDR bt709).
**Strengths:** NTSC rationals exact; HLG tonemapped; relink by hash; silence map + filmstrip.
**Weak:** conform costs one pass per source.
**Needs:** ffmpeg + ffprobe.
**Invoke:** `studio ingest <key> <file> --id <src-id>`
**Gates:** media.json == ffprobe, ingest-conform (CFR/bt709/yuv420p).

## math — technique

**Makes:** narrated math/physics/CS explainers, visual proofs, worked examples, derivations.
**Strengths:** every on-screen number sympy-verified (claims ledger); narration is the timing source; format-aware layout (re-compositions).
**Weak:** no real footage; slow pace by design; typesetting needs the venv (first-time install).
**Typical:** 30-180 s, 16:9 + 9:16 + 1:1 + 4:5
**Needs:** manim-venv, voice.
**Invoke:** `studio new <key> --math` · `studio look <key>` · `studio check <key>` · `studio render <key> --draft` · `studio gate <key>` · `studio ship <key>`
**Gates:** layout, claims, typeset, narration, sync, pace, captions, loudness, deliverable, deterministic.
**Skill:** `.pi/skills/math-video/SKILL.md` · **Critic:** `.pi/agents/math-critic.md`

## mix — service

**Makes:** one audio mix at a target loudness (music bed + SFX + narration/dialog).
**Strengths:** loudnorm to -14/-16 LUFS, -1 dBTP; bed ducked 10-14 dB under speech; measured, not guessed.
**Weak:** no multichannel delivery.
**Needs:** ffmpeg.
**Invoke:** `studio sound <key> (any kind)`
**Gates:** loudness gate (LUFS ±1, <= -1 dBTP).

## motion — technique

**Makes:** code-drawn motion graphics: reels, launch films, promos, ads, kinetic type, UI morphs.
**Strengths:** one timeline reframes to every format (no crops); springs + beat-locked sound; fast drafts (seconds).
**Weak:** no real footage; no narration voice of its own (the voice service adds one).
**Typical:** 5-60 s, 9:16 + 1:1 + 16:9 + 4:5
**Invoke:** `studio new <key> --duration 20 --formats 9:16,16:9` · `studio look <key>` · `studio render <key> --draft` · `studio sound <key>` · `studio gate <key>` · `studio ship <key>`
**Gates:** lint, determinism, dead-time, novelty, hook, blank-frames, loop-seam, loudness, cue-sync, deliverable.
**Skill:** `.pi/skills/motion-reel/SKILL.md` · **Critic:** `.pi/agents/motion-critic.md`

## project — technique

**Makes:** one piece from a plain-words request: any technique, any mix, assembled and verified against the ask.
**Strengths:** requirements ledger with measured verifiers; facts + assets + budget ledgers; resume from state.json; revisions rebuild only what they touch.
**Weak:** an extra layer over the techniques (worth it only when the ask is more than one technique can carry).
**Typical:** 5-300 s, 16:9 + 9:16 + 1:1 + 4:5
**Invoke:** `studio project new <key> "<request>"` · `studio project plan <key> --check` · `studio project rebuild <key>` · `studio project verify <key>` · `studio project ship <key>`
**Gates:** project verify: the plan validates, every requirement green, child gates PASS, assets/facts/credits clean, budget held.
**Skill:** `.pi/skills/produce/SKILL.md` · **Critic:** `.pi/agents/producer-critic.md`

## voice — service

**Makes:** narration from a script (deterministic local TTS, native word timings).
**Strengths:** sample-exact word timings; deterministic; en/en_GB/fa voices; bring-your-own narration.wav (ADR-003).
**Weak:** synthetic voice; no singing or emotion direction.
**Needs:** piper voices.
**Invoke:** `film.json voice + script.md (any kind) — studio sound <key>`
**Gates:** timing.json start/end/words per sentence, narration bus at mix.lufs.
