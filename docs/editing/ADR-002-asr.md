# ADR-002: local word-level ASR

Status: accepted (spike S2, 2026-10-01). Evidence: fixtures `speech`, `noisy`, `speech-fa` (Piper TTS, known script and times).

## Decision
Default provider: **faster-whisper 1.2.1, model `small`, CPU int8**, in a Python 3.12 venv
(`~/.local/share/pi-motion-studio/ml-venv`, built by `uv`; system Python 3.14 has no ctranslate2 wheels). Audio is decoded
by our own ffmpeg to 16 kHz mono float32 and passed as an array (PyAV in the venv is incompatible with faster-whisper's
`decode_audio`, and ffmpeg is the one decoder we trust). Models live in `~/.local/share/pi-motion-studio/models/`.

## Measured
| | result |
|---|---|
| speed | 29.9 s of speech in 5.1-5.6 s on 12 CPU threads (~0.18x realtime); model load 2.3 s |
| WER, `speech` (fillers excluded, 73 ref words) | 0.0% with the filler prompt; 11.0% without (see below) |
| WER, `noisy` (-32 dB hiss + 50 Hz hum) | 0.0% plain, 1.4% with the prompt |
| language detection | `en` p=1.00, `fa` p=0.99 |
| word midpoints inside true speech (+-50 ms) | 72/75 = 96%; word times monotonic |
| word onset error vs truth | 0 to -376 ms (Whisper words start early/late by 100-400 ms): boundary refinement against the audio is required (D5) |
| GPU | `device=cuda` fails: `libcublas.so.12` missing. CPU int8 is fast enough (1 h podcast ~ 11 min); GPU stays optional and unproven |

## Consequences / rules
- **`initial_prompt` with fillers is mandatory** ("Umm, let me think, like, hmm... Okay, here's what I'm, uh, thinking."). Without it
  `small` hallucinated "Thank you very much for watching the video." onto the trailing silence; with it, no hallucination.
  Whisper also drops some fillers (2 of 3 kept in the prompt run): filler removal must be verified against the audio, never trusted from the transcript alone (D6).
- `condition_on_previous_text=False`, beam 5; trailing words that start after the measured end of speech are dropped (guard against hallucinated tails).
- Non-English: `small` detects Persian correctly but transcribes it badly. Limit documented; use `medium` (about 3x slower on CPU) for non-English when accuracy matters, decided in P12.
- Fallback chain (section 11) stays: whisper.cpp user-space build, openai-whisper CPU, vosk. Not needed so far.

## Rejected
Hosted ASR (privacy + account), `medium` as default (3x slower, no measured need on English), VAD filter (no change in output on these fixtures).
