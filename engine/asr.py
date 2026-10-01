"""asr.py: the local word-level ASR provider (ADR-002). One contract, written to transcript.json:

  { "version": 1, "language": "en", "language_probability": 0.99, "provider": "faster-whisper",
    "model": "small", "words": [ { "text": "Welcome", "start": 0.0, "end": 0.42, "confidence": 0.98 } ],
    "segments": [ { "start": 0.0, "end": 1.36, "text": " Welcome to the studio." } ] }

  python asr.py --in <media> --out <transcript.json> [--model small] [--language auto] [--prompt "..."] [--force]

Settings from spike S2 (docs/editing/ADR-002-asr.md): faster-whisper on CPU int8; audio decoded here with
ffmpeg to 16 kHz mono float32 (the venv's PyAV is incompatible with faster-whisper's decode_audio); a
filler-friendly initial_prompt when the language is unknown or English (without it `small` hallucinates
onto trailing silence); condition_on_previous_text=False; beam 5. Word boundaries are then refined against
the audio: Whisper words start up to ~370 ms early/late, so each boundary moves to the nearest energy dip
in +-0.3 s (never past its neighbours). A transcript that exists is never overwritten without --force.
"""
import argparse, json, os, sys, subprocess
import numpy as np

FILLER_PROMPT = "Umm, let me think, like, hmm... Okay, here's what I'm, uh, thinking."
SR = 16000
REFINE = 0.30  # s, the measured Whisper boundary drift window (S2: onsets 0..-376 ms)


def load_audio(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def envelope(x: np.ndarray, win_ms=10) -> np.ndarray:
    w = int(SR * win_ms / 1000)
    n = len(x) // w
    sq = x[: n * w].reshape(n, w).astype(np.float64) ** 2
    return 10 * np.log10(sq.mean(axis=1) + 1e-12)  # dBFS per 10 ms bucket


def refine(words, env, hop):
    """Move each word boundary to the nearest energy dip within +-REFINE s (minima between the words)."""
    if not words:
        return words
    at = lambda t: int(np.clip(t / hop, 0, len(env) - 1))
    out = []
    for i, w in enumerate(words):
        start, end = w["start"], w["end"]
        # boundary to the previous word: the deepest dip in (start-REFINE, start+0.1]
        lo = max(0 if i == 0 else at(words[i - 1]["end"]), at(start) - int(REFINE / hop))
        hi = at(start) + int(0.10 / hop)
        if hi > lo + 1:
            seg = env[lo:hi]
            start = max(0 if i == 0 else words[i - 1]["end"], min(start, (lo + int(np.argmin(seg))) * hop))
        # boundary to the next word: the deepest dip in [end-0.1, end+REFINE)
        lo = at(end) - int(0.10 / hop)
        hi = min(len(env) - 1 if i == len(words) - 1 else at(words[i + 1]["start"]), at(end) + int(REFINE / hop))
        if hi > lo + 1:
            seg = env[lo:hi]
            nxt = len(words) * 10**9 if i == len(words) - 1 else words[i + 1]["start"]
            end = min(nxt, max(w["end"] * 0 + start + 0.02, (lo + int(np.argmin(seg))) * hop))
        out.append({**w, "start": round(max(0, start), 4), "end": round(max(start + 0.01, end), 4)})
    # never let a later word start before an earlier one ends
    for i in range(1, len(out)):
        if out[i]["start"] < out[i - 1]["start"]:
            out[i]["start"] = out[i - 1]["start"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--model", default="small")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--prompt", default=None)
    ap.add_argument("--refine", default="on", choices=["on", "off"])
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if os.path.exists(a.out) and not a.force:
        print(f"[asr] {a.out} already exists (--force to transcribe again)", file=sys.stderr)
        sys.exit(0)
    from faster_whisper import WhisperModel
    dl = os.path.expanduser("~/.local/share/pi-motion-studio/models/whisper")
    m = WhisperModel(a.model, device="cpu", compute_type="int8", download_root=dl)
    audio = load_audio(a.inp)
    lang = None if a.language == "auto" else a.language
    prompt = a.prompt if a.prompt is not None else (FILLER_PROMPT if lang in (None, "en") else None)
    segs, info = m.transcribe(audio, word_timestamps=True, language=lang, initial_prompt=prompt,
                              condition_on_previous_text=False, beam_size=5)
    words = [{"text": w.word.strip(), "start": round(w.start, 4), "end": round(w.end, 4), "confidence": round(w.probability, 4)}
             for s in segs for w in (s.words or []) if w.word.strip()]
    segments = [{"start": round(s.start, 4), "end": round(s.end, 4), "text": s.text.strip()} for s in segs]
    # a trailing word that starts after the last real energy (a hallucinated tail) is dropped
    if words:
        env = envelope(audio)
        speech_end = (np.where(env > env.min() + 12)[0].max() + 1) * 0.01
        words = [w for w in words if w["start"] < speech_end + 0.5]
        if a.refine == "on":
            words = refine(words, env, 0.01)
        segments = [s for s in segments if s["end"] <= speech_end + 0.6]
    doc = {"version": 1, "language": info.language, "language_probability": round(info.language_probability, 4),
           "provider": "faster-whisper", "model": a.model, "refined": a.refine == "on",
           "words": words, "segments": segments, "duration": round(len(audio) / SR, 4)}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"[asr] {a.model}: {len(words)} words, lang {info.language} ({info.language_probability:.2f}) -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
