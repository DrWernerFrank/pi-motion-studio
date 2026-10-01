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
    """Move each word boundary to the nearest energy dip within +-REFINE s (S2: Whisper words start up to ~370 ms
    early or late). Rules: a start may move within (prev_end, start+0.1]; an end within [end-0.1, next_start);
    then a sequential pass makes the result monotonic. Never invents motion beyond the measured window."""
    if not words:
        return words
    N = len(env)
    at = lambda t: int(np.clip(t / hop, 0, N - 1))
    R = int(REFINE / hop)
    H = int(0.10 / hop)
    out = []
    for i, w in enumerate(words):
        prev_end = 0.0 if i == 0 else out[-1]["end"]
        nxt_start = None if i == len(words) - 1 else words[i + 1]["start"]
        start, end = w["start"], w["end"]
        # start: deepest dip in (prev_end, start + 0.1]
        lo, hi = min(at(prev_end) + 1, N - 1), min(at(start) + H, N - 1)
        if hi > lo + 1:
            k = lo + int(np.argmin(env[lo:hi]))
            cand = k * hop
            if prev_end < cand <= start + 0.10:
                start = cand
        start = max(start, prev_end)
        # end: deepest dip in [end - 0.1, end + REFINE), but never past the next word's start
        hi = min(at(end) + R, N - 1) if nxt_start is None else min(at(end) + R, at(nxt_start), N - 1)
        lo = max(at(end) - H, 0)
        if hi > lo + 1:
            k = lo + int(np.argmin(env[lo:hi]))
            cand = k * hop
            if cand >= end - 0.10 and (nxt_start is None or cand <= nxt_start):
                end = cand
        end = max(end, start + 0.01)
        # a word never ends after its (possibly refined) own start+duration+window
        out.append({**w, "start": round(start, 4), "end": round(end, 4)})
    for i in range(1, len(out)):  # monotonic: never start before the previous word starts
        if out[i]["start"] < out[i - 1]["start"]:
            out[i]["start"] = out[i - 1]["start"]
        if out[i]["end"] < out[i]["start"] + 0.01:
            out[i]["end"] = out[i]["start"] + 0.01
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
    seg_iter, info = m.transcribe(audio, word_timestamps=True, language=lang, initial_prompt=prompt,
                                   condition_on_previous_text=False, beam_size=5)
    segs = list(seg_iter)  # a generator can only be walked once: read words and segments from the same list
    words = [{"text": w.word.strip(), "start": round(w.start, 4), "end": round(w.end, 4), "confidence": round(w.probability, 4)}
             for s in segs for w in (s.words or []) if w.word.strip()]
    segments = [{"start": round(s.start, 4), "end": round(s.end, 4), "text": s.text.strip()} for s in segs]
    # a trailing word that starts after the last real energy (a hallucinated tail) is dropped
    if words:
        env = envelope(audio)
        # speech end: same rule as the silence map (floor + max(6, 0.3*spread)), so ASR and cuts agree on what is speech
        floor = float(np.percentile(env, 10)); hi = float(np.percentile(env, 95))
        thr = floor + max(6.0, 0.3 * (hi - floor))
        loud = np.where(env >= thr)[0]
        speech_end = ((loud.max() + 1) * 0.01) if len(loud) else 0.0
        # trailing hallucinations (Whisper invents a sign-off onto silence): a word may neither start after
        # speech ends nor hang 250 ms past the end of the last speech energy (a real word cannot float in quiet)
        words = [w for w in words if w["start"] < speech_end and w["end"] <= speech_end + 0.25]
        if a.refine == "on":
            words = refine(words, env, 0.01)
        segments = [s for s in segments if s["end"] <= speech_end + 0.25]
    doc = {"version": 1, "language": info.language, "language_probability": round(info.language_probability, 4),
           "provider": "faster-whisper", "model": a.model, "refined": a.refine == "on",
           "words": words, "segments": segments, "duration": round(len(audio) / SR, 4)}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"[asr] {a.model}: {len(words)} words, lang {info.language} ({info.language_probability:.2f}) -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
