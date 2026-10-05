# Inspiration: veedstudio/open-edit (Apache-2.0)

Sources read (shallow clone `7f212e0`, outside the repo): `README.md`, `AGENTS.md`, `.claude/skills/open-edit/{SKILL,CUT,TRANSCRIPTION}.md`,
`cli/src/{edl,transcript/transcript-types,commands/speech-probe}.ts`, `NOTICE`. No code was copied; everything below is re-implemented.
Open-edit is agent-only: an agent authors an HTML page, a CLI renders it, and the result is handed to VEED's hosted editor. No GUI of its own.

## What we take

| Idea | Their shape | Ours |
|---|---|---|
| One transcript contract; any provider that writes it qualifies, plus a mapper for Whisper-family JSON | `{ text, chunks:[{ text, timestamp:[s,e], words:[{ text, timestamp:[s,e] }] }] }` | `transcript.json` keeps `words[].{text,start,end,confidence}` and `segments`; a reader/writer for their `chunks/timestamp` shape and a mapper for openai-whisper, whisper.cpp `-oj -ml 1`, WhisperX, `verbose_json` (D5) |
| Cut points are measured from audio, never taken from word boundaries | `speech-probe <video> [--range a:b] [--gap 250] [--window 10]`: per-clip noise floor (10th percentile), threshold, speech onset/decay, sub-threshold gaps >= `--gap` ms | `cut` proposals come from the same idea (noise floor per clip, speech/pause segmentation); same flag names `--gap`/`--window`/`--range` where they apply (D6) |
| EDL applied in one encode | `{ sources:{id:path}, transcripts:{id:path}, ranges:[{ source, start, end, note }] }`, ranges play in the order written, edges snapped to the source frame grid, `--crossfade <ms>`, sources that disagree on fps/colour are refused | `edit.json` is richer (tracks, overlays, captions) but imports/exports exactly this EDL shape; snapping uses integer frames; conform-first so sources always agree (D1, D3) |
| Never re-transcribe a cut; move the timings | `retime-transcript --edl` puts the per-word times onto the cut timeline | `retime` op; verified against a fresh transcription of the cut (`transcript-edit` check) |
| Look before you render, re-render only what changed | `frames --at ... --sheet`, `render --stills`, `render --from --to` reuses the rest | `edit_look` contact sheets with source timecodes; `render --from/--to`; segment cache (D12) |
| Failed loads stop the render | a failed video/image/font load is a wrong render, blank output is an error | same: failures are loud and list the assets; no silent blank render (P12) |
| Per-piece folder holding every dependency | `runs/<key>/` | `films/<key>/` with `assets/media/<id>/` for derived media |
| Footage as a layer; mix with ducking, then loudness | `<video>` layers, `mix-audio` (voice ducks the bed), `mux-audio` at delivery loudness | dialog bus + ducked music + SFX, then the existing two-pass loudnorm (D4) |
| `init`/`doctor` that detects tools and installs in user space; never install machine-global without consent | `init --dry`, `init` | `studio doctor [--fix]` (user space only) |
| Terse delivery: one line at start, path + a sentence or two at the end | "Talking to the user" | `video-edit` skill |

## What we leave

VEED login, credits and hosted transcription; Fabric talking-head generation; lipsync, translation and fal; `veed-project`/`veed-pull`
editor hand-off; TypeScript/pnpm packaging; the provider-choice interview. No account and no paid or hosted dependency on the golden path
(opt-in provider hooks via `.env`, by name).

## Where we go past it

A real editor GUI (theirs hands off to a hosted editor); one timeline exported to four formats with subject-aware reframing; beat-aware
sound design; NTSC-rational frame integers end to end; gates and a critique loop that measure the edit instead of asserting it.

## Field names matched

EDL: `sources`, `transcripts`, `ranges[].{source,start,end,note}`. Transcript: `chunks[].words[].timestamp` (importer/exporter).
Flags: `--gap`, `--window`, `--range` (ms/ms/seconds as theirs), `--crossfade` (ms), `--from`/`--to` (seconds), `--stills`, `--force` (overwrite a transcript).
Frame rate is passed as a rational string (`30000/1001`), never the decimal.
