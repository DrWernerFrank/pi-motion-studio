# ADR-003 — Narration voice: Piper, with TTS-native word timings (S3)

**Decision.** The default narration voice is **Piper** (piper-tts 1.8.0 in the ML venv), per language:
`en_US-ljspeech-medium` (default `en`), `en_GB-northern_english_male-medium` (option), `fa_IR-amir-medium`
(`fa`, verified: 5.42 s of Persian synthesized deterministically). Kokoro (kokoro-onnx 0.6.1 + the
v1.0 model) was installed, measured, and **kept only as an installed fallback** — not the default
(below). Word timings come from **Piper's native phoneme alignments**: `PiperVoice.load(...,
include_alignments=True)` (needs the `onnx` package — installed into the ML venv as
`piper-tts[alignment]`) patches the model in memory and each synthesized chunk then carries
`phoneme_alignments: [{phoneme, phoneme_ids, num_samples}]` — sample-exact per-phoneme durations that
the voice layer folds into word boundaries. No ASR round trip needed for timing (ASR remains the
verification oracle), and no proportional-by-character fallback in the default path.

**Evidence (162-word math paragraph: determinants, eigenvalues, Bayes, gnomons, spoken numbers;
`~/.cache/pi-motion-studio/scratch/s3/`).** WER measured with faster-whisper `small` (the studio's
ASR) after normalizing BOTH sides (digits ↔ number words, punctuation) — unnormalized, the "errors"
were almost entirely "5" vs "five" formatting, not intelligibility:

| voice | WER (normalized) | synth speed | deterministic | word timings | Persian |
|---|---|---|---|---|---|
| piper en_US-ljspeech-medium | **0.6%** | 14.1× realtime | identical samples | **native (samples)** | — |
| piper en_GB-northern-english_male-medium | **0.6%** | 19.3× realtime | identical samples | native | — |
| piper fa_IR-amir-medium | (fa ASR weak — see below) | fast | identical samples | native | ✓ |
| kokoro af_heart (v1.0) | **0.6%** | 2.9× realtime | identical samples | **none** (audio only) | ✗ |

Why Piper wins the default despite identical intelligibility: it is 5× faster to synthesize (a
10-minute narration is ~40 s vs ~3.5 min), it is the only one with native word timings (Kokoro returns
audio only — it would force the ASR-timing fallback), it has the Persian voice, and it was already the
studio's installed, battle-tested TTS (the editing mission's speechgen.py is piper with zero noise
scales). Kokoro's advantages (generally more natural prosody) are not measurable here and do not
outweigh that; it stays installed (`~/.local/share/pi-motion-studio/models/kokoro/`, 354 MB) as the
"try another local voice" route of the blocker policy, and `studio doctor` reports it as optional.

Other measurements:
- Piper 1.8's `synthesize(..., include_alignments=)` alone is NOT enough: the alignments populate only
  when `PiperVoice.load(..., include_alignments=True)` patches the model (learned by reading
  `piper/voice.py`; the first probe silently produced `phoneme_alignments=None`).
- Word start times derived from the alignments are sane (`The` 0.070 s, `determinant` 0.685 s,
  `equals` 1.173 s, `five` 1.834 s on a 4.03 s sentence); the end-time arithmetic is the voice layer's
  P5 job (the probe's end times were wrong, not piper's data).
- `piper.phonemize` is exposed — the lexicon (respellings) and the math-to-speech normalizer
  (`x^2` → "x squared") plug in before synthesis.
- ljspeech speaks the paragraph in 61.1 s (≈160 wpm, closest to the ~150 wpm narration target); the GB
  male is brisker (47.7 s, ≈204 wpm; `length_scale` tunes either).
- ASR language detection (1.00 en) works on synthesized narration; `small`'s fa transcription is weak
  (documented in the editing mission's ADR-002) — the `fa` timings therefore come from the TTS
  alignments, not ASR, which is another reason alignments matter.

**Consequence.** `film.json` `voice` defaults to `piper:en_US-ljspeech-medium`; the voice layer
(P5) is piper-with-alignments, sentence-cached by (text, voice, length_scale). The `voice` check's
"WER <= 10%" compares with normalized numbers (a shared normalizer in the check, not a loosened
microphone). Kokoro remains a doctor-reported optional voice; if piper ever mispronounces a term, the
blocker policy routes to the lexicon first, another piper voice second, kokoro third.
