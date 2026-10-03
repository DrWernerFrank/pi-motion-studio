"""voice.py: piper narration with native word timings (ADR-003). Runs in the ML venv (piper lives there).

  python voice.py --voice en_US-ljspeech-medium --text "..." --out <dir> [--lexicon lex.json] [--length-scale 1.0]
  python voice.py --voice ... --batch jobs.json [--lexicon ...] [--length-scale ...]   jobs: [{"text", "out"}]
  python voice.py --voice ... --text "..." --dry [--lexicon ...]                         normalized text only
  python voice.py --dry --batch texts.json [--lexicon ...]                               [{text}] -> normalized list

Output per sentence, in <dir>: audio.wav (mono 16-bit at the voice's rate) + words.json
  {text_normalized, sample_rate, samples, duration_s, words: [{w, start, end}], timing: native|proportional}
`w` is the token of the ORIGINAL spoken text (so a bookmark's word index survives normalization).

Voice: a name resolves to ~/.local/share/pi-motion-studio/models/piper/<name>.onnx ("piper:" prefix ok);
a path passes through. Deterministic: noise_scale = noise_w_scale = 0 (same text -> same samples).

The normalizer (applied per whitespace token, BEFORE synthesis; kept small on purpose — the lexicon is
the per-film tool). Symbols are rewritten only when the token is the symbol or the symbol sits between
operands inside the token (x^2, 3×2, a+b); word rules match whole tokens only:
  ^2 / ²  -> squared        ^3 / ³ -> cubed          ^n -> to the n
  × · *   -> times          ÷      -> divided by     = -> equals        + -> plus
  − (any), - (between digits) -> minus              < -> is less than  > -> is greater than
  ≤ -> at most     ≥ -> at least     ≠ -> is not equal to     ≈ -> is approximately
  π -> pi   √ -> square root of   ∑ -> the sum of   ∫ -> the integral of   ∞ -> infinity   ∈ -> in
  λ θ α β -> lambda theta alpha beta
  a/b (digits) -> a over b (1/2 -> one half)        2x2, 2×2 -> two by two     det, det(A) -> determinant (of A)
Lexicon (films/<key>/lexicon.json {"word": "respelling"}) applies AFTER the normalizer: case-insensitive,
word-boundary, longest key first.

Respellings in the stress-capitals convention reach espeak lower-cased (espeak spells capitals out).

Word timings: piper's phoneme alignments (needs load(include_alignments=True) AND
synthesize(include_alignments=True)) give sample-exact durations per phoneme; each token's own phonemes
(espeak on the token alone) are aligned to that stream by edit distance, so context merges ("on the"
-> one phoneme-word) still land on the right tokens. If alignments are missing or under 60% of the
phonemes match, the sentence falls back to proportional-by-characters and says so
(`timing: "proportional"`).
Level: each sentence is set to -20 LUFS (BS.1770 K-weighted, gated) with the sample peak capped at
-1 dBFS, then 4 ms edge fades (speechgen.py precedent: no clicks at joins).
"""
import argparse, json, os, re, sys, wave

MODELS = os.path.expanduser("~/.local/share/pi-motion-studio/models/piper")
TARGET_LUFS = -20.0
PEAK_CAP = 10 ** (-1.0 / 20)
FADE_S = 0.004
PUNCT = set(",.;:!?¡¿—…\"'()-–")

ONES = "zero one two three four five six seven eight nine".split()
SYM = [  # (symbol, words) — whole token, or between operands inside a token
    ("≤", "at most"), ("≥", "at least"), ("≠", "is not equal to"), ("≈", "is approximately"),
    ("×", "times"), ("·", "times"), ("÷", "divided by"), ("=", "equals"), ("+", "plus"), ("−", "minus"),
    ("<", "is less than"), (">", "is greater than"),
    ("√", "square root of"), ("∑", "the sum of"), ("∫", "the integral of"), ("∞", "infinity"), ("∈", "in"),
    ("π", "pi"), ("λ", "lambda"), ("θ", "theta"), ("α", "alpha"), ("β", "beta"),
]
FRAC = {"1/2": "one half", "1/3": "one third", "1/4": "one quarter", "3/4": "three quarters"}
EDGE = re.compile(r"^([\"'(\[]*)(.*?)([\"')\].,;:!?]*)$")


def resolve_voice(v):
    v = v[len("piper:"):] if v.startswith("piper:") else v
    if os.sep in v or v.endswith(".onnx"):
        return v
    return os.path.join(MODELS, v + ".onnx")


def norm_core(core):
    """One token's core (edge punctuation stripped) -> its spoken words."""
    if not core:
        return core
    low = core.lower()
    if re.fullmatch(r"(\d)\s*[x×]\s*(\d)", low):
        a, b = re.fullmatch(r"(\d)\s*[x×]\s*(\d)", low).groups()
        return f"{ONES[int(a)]} by {ONES[int(b)]}"
    if low == "det":
        return "determinant"
    m = re.fullmatch(r"det\((.+)\)", core, re.I)
    if m:
        return f"the determinant of {norm_core(m.group(1))}"
    if core in FRAC:
        return FRAC[core]
    if re.fullmatch(r"\d+/\d+", core):
        a, b = core.split("/")
        return f"{a} over {b}"
    s = core
    s = re.sub(r"\^\(?2\)?|²", " squared", s)
    s = re.sub(r"\^\(?3\)?|³", " cubed", s)
    s = re.sub(r"\^\(?([A-Za-z0-9]+)\)?", r" to the \1", s)
    s = re.sub(r"(?<=\d)-(?=\d)", " minus ", s)
    for sym, words in SYM:
        if sym in s:
            s = s.replace(sym, f" {words} ")
    if "*" in s and re.search(r"\w\*\w|^\*$", s):
        s = s.replace("*", " times ")
    return re.sub(r"\s+", " ", s).strip()


def normalize_tokens(spoken):
    """-> [(original_token, normalized_text)] — the normalizer, token by token."""
    toks = spoken.split()
    out = []
    for i, t in enumerate(toks):
        if t == "-" and 0 < i < len(toks) - 1 and re.search(r"\d$", toks[i - 1]) and re.match(r"^\d", toks[i + 1]):
            out.append((t, "minus"))
            continue
        lead, core, trail = EDGE.match(t).groups()
        if "(" in core and trail.startswith(")"):  # det(A) keeps its own parentheses
            core, trail = core + ")", trail[1:]
        n = norm_core(core)
        out.append((t, f"{lead}{n}{trail}" if n else t))
    return out


def apply_lexicon(text, lex):
    if not lex:
        return text
    keys = sorted(lex, key=len, reverse=True)
    pat = re.compile(r"(?<![\w-])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])", re.I)
    low = {k.lower(): v for k, v in lex.items()}
    return pat.sub(lambda m: low[m.group(1).lower()], text)


RESPELL = re.compile(r"\b[A-Za-z]+(?:-[A-Za-z]+)+\b")


def espeak_safe(text):
    """The lexicon's stress-in-capitals respellings (duh-TUR-muh-nuhnt) are for humans: espeak SPELLS an
    upper-case syllable letter by letter ("TUR" -> tee-you-ar, measured). Hyphenated respellings go to
    the synthesizer lower-cased; [[ raw phonemes ]] pass through untouched."""
    parts = re.split(r"(\[\[.*?\]\])", text)
    return "".join(p if p.startswith("[[") else RESPELL.sub(lambda m: m.group(0).lower(), p) for p in parts)


def prepare(spoken, lex):
    """-> (tokens [(orig, final_text)], text_normalized)."""
    pairs = [(o, apply_lexicon(n, lex)) for o, n in normalize_tokens(spoken)]
    return pairs, " ".join(n for _, n in pairs)


# -- BS.1770 loudness (K-weighting biquads re-derived for any sample rate, as pyloudnorm does) ----
def lufs(x, sr):
    import numpy as np
    from scipy.signal import lfilter
    G, Q, fc = 4.0, 1 / np.sqrt(2), 1681.974450955533
    K = np.tan(np.pi * fc / sr); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    fc, Q = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * fc / sr)
    a2 = [1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K)]
    y = lfilter([1, -2, 1], a2, lfilter(b1, a1, x.astype(np.float64)))
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    if len(y) < blk:
        y = np.pad(y, (0, blk - len(y)))
    z = np.array([np.mean(y[i:i + blk] ** 2) for i in range(0, len(y) - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[lk > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z2 = z[(-0.691 + 10 * np.log10(z + 1e-20)) > rel]
    return float(-0.691 + 10 * np.log10((z2 if len(z2) else z).mean()))


STRESS = {"ˈ", "ˌ"}
SKIP = {" ", "^", "$", "_"}


def align_tokens(token_ph, stream):
    """Edit-distance alignment of the tokens' own phonemes (espeak on each token alone, concatenated)
    against the synthesized phoneme stream [(phoneme, start, end)]. espeak changes words in context
    ("on the" -> one phoneme-word, "a" -> ɐ/ə), so counting words is not enough; aligning phonemes is.
    -> per token (start_sample, end_sample) or None (no phoneme matched), and the matched fraction."""
    A = [(p, i) for i, ph in enumerate(token_ph) for p in ph]
    n, m = len(A), len(stream)
    if not n or not m:
        return [None] * len(token_ph), 0.0
    D = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        D[i][0] = i
    for j in range(1, m + 1):
        D[0][j] = j
    for i in range(1, n + 1):
        ai, Di, Dp = A[i - 1][0], D[i], D[i - 1]
        for j in range(1, m + 1):
            Di[j] = min(Dp[j] + 1, Di[j - 1] + 1, Dp[j - 1] + (0 if ai == stream[j - 1][0] else 1))
    owner = [None] * m  # stream phoneme -> token
    i, j, same = n, m, 0
    while i > 0 and j > 0:
        sub = D[i - 1][j - 1] + (0 if A[i - 1][0] == stream[j - 1][0] else 1)
        if D[i][j] == sub:
            owner[j - 1] = A[i - 1][1]; same += A[i - 1][0] == stream[j - 1][0]; i -= 1; j -= 1
        elif D[i][j] == D[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    spans = [None] * len(token_ph)
    for k, t in enumerate(owner):
        if t is None:
            continue
        s, e = stream[k][1], stream[k][2]
        spans[t] = (s, e) if spans[t] is None else (min(spans[t][0], s), max(spans[t][1], e))
    for t in range(1, len(spans)):  # monotonic: a context merge never lets a word start before its predecessor
        if spans[t] and spans[t - 1] and spans[t][0] < spans[t - 1][1]:
            spans[t] = (spans[t - 1][1], max(spans[t][1], spans[t - 1][1]))
    return spans, same / max(n, m)


class Voice:
    def __init__(self, model):
        from piper import PiperVoice
        self.v = PiperVoice.load(model, include_alignments=True)
        self.sr = self.v.config.sample_rate

    def token_phonemes(self, text):
        return [p for sent in self.v.phonemize(text) for p in sent if p not in SKIP and p not in STRESS and p not in PUNCT]

    def synth(self, spoken, lex, length_scale):
        import numpy as np
        from piper import SynthesisConfig
        pairs, text = prepare(spoken, lex)
        cfg = SynthesisConfig(length_scale=length_scale, noise_scale=0.0, noise_w_scale=0.0, normalize_audio=False)
        audio, stream, native, off = [], [], True, 0  # stream: (phoneme, start_sample, end_sample)
        for c in self.v.synthesize(espeak_safe(text), syn_config=cfg, include_alignments=True):
            x = c.audio_float_array
            al = c.phoneme_alignments
            if al is None:
                native = False
            else:
                pos, pending = off, None  # a stress mark's samples belong to the phoneme it stresses
                for a in al:
                    ph, n = a.phoneme, int(a.num_samples)
                    if ph in STRESS:
                        pending = pos if pending is None else pending
                    elif ph in SKIP or ph in PUNCT:
                        pending = None
                    else:
                        stream.append((ph, pending if pending is not None else pos, pos + n)); pending = None
                    pos += n
                if pos - off != len(x):
                    native = False  # alignments do not cover the audio: do not trust them
            audio.append(x)
            off += len(x)
        x = np.concatenate(audio) if audio else np.zeros(0, dtype=np.float32)
        sr = self.sr
        words, spans, matched = [], [None] * len(pairs), 0.0
        if native:
            spans, matched = align_tokens([self.token_phonemes(espeak_safe(nt)) for _, nt in pairs], stream)
        if native and matched >= 0.6 and any(spans):
            for k, ((o, _), sp) in enumerate(zip(pairs, spans)):
                if sp is None:  # nothing espeak spoke for this token (a lone dash): zero length between neighbours
                    t = words[-1]["end"] if words else 0.0
                    words.append({"w": o, "start": t, "end": t})
                    continue
                words.append({"w": o, "start": round(sp[0] / sr, 5), "end": round(sp[1] / sr, 5)})
            timing = "native"
        else:
            total = sum(len(o) + 1 for o, _ in pairs) or 1
            D, acc = len(x) / sr, 0
            for o, _ in pairs:
                s = acc / total * D
                acc += len(o) + 1
                words.append({"w": o, "start": round(s, 5), "end": round(acc / total * D, 5), "timing": "proportional"})
            timing = "proportional"
        # level: -20 LUFS, sample peak <= -1 dBFS; then the edge fades
        if len(x):
            g = 10 ** ((TARGET_LUFS - lufs(x, sr)) / 20)
            pk = float(np.max(np.abs(x))) * g
            if pk > PEAK_CAP:
                g *= PEAK_CAP / pk
            x = x * g
            f = min(len(x) // 2, int(round(FADE_S * sr)))
            if f:
                x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
        pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
        return pcm, {"text_normalized": text, "sample_rate": sr, "samples": int(len(pcm)),
                     "duration_s": round(len(pcm) / sr, 6), "words": words, "timing": timing}


def write_out(out, pcm, meta):
    os.makedirs(out, exist_ok=True)
    with wave.open(os.path.join(out, "audio.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(meta["sample_rate"]); w.writeframes(pcm.tobytes())
    with open(os.path.join(out, "words.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="en_US-ljspeech-medium")
    ap.add_argument("--text"); ap.add_argument("--out"); ap.add_argument("--batch")
    ap.add_argument("--lexicon"); ap.add_argument("--length-scale", type=float, default=1.0)
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    lex = {}
    if a.lexicon and os.path.exists(a.lexicon):
        with open(a.lexicon, encoding="utf-8") as f:
            lex = json.load(f)
    if a.dry:  # --batch with --dry: [{text}] -> one JSON list (the node side's cache keys, one process)
        def dry(t):
            pairs, text = prepare(t or "", lex)
            return {"text_normalized": text, "synth_text": espeak_safe(text), "tokens": [{"w": o, "say": n} for o, n in pairs]}
        if a.batch:
            print(json.dumps([dry(j["text"]) for j in json.load(open(a.batch, encoding="utf-8"))], ensure_ascii=False))
        else:
            print(json.dumps(dry(a.text), ensure_ascii=False))
        return 0
    model = resolve_voice(a.voice)
    if not os.path.exists(model):
        print(f"[voice] no piper model at {model} (studio doctor lists the installed voices)", file=sys.stderr)
        return 2
    jobs = json.load(open(a.batch, encoding="utf-8")) if a.batch else [{"text": a.text, "out": a.out}]
    if any(not j.get("text") or not j.get("out") for j in jobs):
        print("[voice] every job needs text and out (--text/--out or --batch)", file=sys.stderr)
        return 2
    V = Voice(model)
    for j in jobs:
        pcm, meta = V.synth(j["text"], lex, a.length_scale)
        tmp = j["out"].rstrip("/") + ".tmp"
        write_out(tmp, pcm, meta)
        if os.path.isdir(j["out"]):
            import shutil; shutil.rmtree(j["out"])
        os.replace(tmp, j["out"])  # atomic: a cache entry is either complete or absent
        print(json.dumps({"out": j["out"], "samples": meta["samples"], "timing": meta["timing"], "words": len(meta["words"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
