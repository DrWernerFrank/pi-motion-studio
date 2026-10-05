"""Deterministic TTS speech with a known script: sentences, fillers, pauses and a flubbed take.

  python speechgen.py --spec spec.json --out speech.wav --truth speech.truth.json [--noise hiss+hum]

spec.json: { "voices": { "a": "/path/voice.onnx" }, "items": [
    { "say": "text", "voice": "a", "kind": "sentence|filler|flub", "length": 1.0 },
    { "pause": 0.8 } ], "roomtone_db": -58 }
Output: mono 22.05 kHz WAV and a truth file with every item's exact start/end in seconds.
Piper's noise scales are zero, so the same spec gives the same samples.
"""
import argparse, json, wave
import numpy as np
from piper import PiperVoice, SynthesisConfig

ap = argparse.ArgumentParser()
ap.add_argument('--spec', required=True); ap.add_argument('--out', required=True); ap.add_argument('--truth', required=True)
ap.add_argument('--noise', default='')
a = ap.parse_args()
spec = json.load(open(a.spec))
voices = {k: PiperVoice.load(v) for k, v in spec['voices'].items()}
sr = next(iter(voices.values())).config.sample_rate
rng = np.random.default_rng(1234)

def say(voice, text, length):
    cfg = SynthesisConfig(length_scale=length, noise_scale=0.0, noise_w_scale=0.0)
    parts = [c.audio_float_array for c in voices[voice].synthesize(text, syn_config=cfg)]
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)

out, truth, t = [], [], 0.0
for it in spec['items']:
    if 'pause' in it:
        n = int(round(it['pause'] * sr)); x = np.zeros(n, dtype=np.float32); kind, text = 'pause', ''
    else:
        x = say(it.get('voice', next(iter(voices))), it['say'], it.get('length', 1.0)); kind, text = it.get('kind', 'sentence'), it['say']
    # 4 ms edge fades so concatenation never clicks
    f = min(len(x), int(0.004 * sr))
    if f: x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
    d = len(x) / sr
    truth.append({'kind': kind, 'text': text, 'start': round(t, 4), 'end': round(t + d, 4)})
    out.append(x); t += d
y = np.concatenate(out)

# Room tone under everything (so every silence has a measurable noise floor), seeded.
rt = 10 ** (spec.get('roomtone_db', -58) / 20)
white = rng.standard_normal(len(y)).astype(np.float32)
y = y + rt * np.convolve(white, np.ones(8) / 8, mode='same')
if 'hiss' in a.noise: y = y + 10 ** (-32 / 20) * rng.standard_normal(len(y)).astype(np.float32)
if 'hum' in a.noise:
    tt = np.arange(len(y)) / sr
    y = y + 10 ** (-34 / 20) * (np.sin(2 * np.pi * 50 * tt) + 0.5 * np.sin(2 * np.pi * 100 * tt) + 0.25 * np.sin(2 * np.pi * 150 * tt)).astype(np.float32)
peak = float(np.max(np.abs(y))); y = y * (0.89 / peak) if peak > 0 else y
pcm = np.clip(y * 32767, -32768, 32767).astype('<i2')
with wave.open(a.out, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
json.dump({'sample_rate': sr, 'duration': round(len(y) / sr, 4), 'items': truth}, open(a.truth, 'w'), indent=1)
print(f'{a.out}: {len(y) / sr:.2f}s, {sum(1 for i in truth if i["kind"] != "pause")} spoken items')
