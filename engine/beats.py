# python engine/beats.py song.wav > beats.json   (studio beats <film> runs this for you)
import sys, json, numpy as np, librosa

y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
beats = librosa.frames_to_time(frames, sr=sr).round(3).tolist()

onset = librosa.onset.onset_strength(y=y, sr=sr)
peaks = librosa.util.peak_pick(onset, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.5, wait=10)

# Downbeat phase: of the 4 possible bar alignments, pick the one whose beats carry the most onset energy.
strength = onset[np.clip(frames, 0, len(onset) - 1)] if len(frames) else np.array([])
phase = int(np.argmax([strength[p::4].sum() for p in range(4)])) if len(strength) >= 4 else 0

json.dump({
    "bpm": float(np.atleast_1d(tempo)[0]),
    "source": "measured",
    "duration": round(len(y) / sr, 3),
    "beats": beats,                  # state changes go here
    "downbeats": beats[phase::4],    # big moments go here
    "hits": librosa.frames_to_time(peaks, sr=sr).round(3).tolist(),  # SFX go here
}, sys.stdout, indent=1)
