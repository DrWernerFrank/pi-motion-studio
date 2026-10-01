"""S3: subject tracking. Face (YuNet) on real footage, and a seeded generic tracker (TrackerMIL) on the synthetic disc.
   ml-venv/bin/python docs/editing/spikes/s3.py"""
import subprocess, time, json, math, os
import numpy as np, cv2
F = os.path.expanduser('~/.cache/pi-motion-studio/fixtures/')
MODEL = os.path.expanduser('~/.local/share/pi-motion-studio/models/opencv/yunet.onnx')

def frames(path, w, h, fps=None, t=None):
    vf = f'scale={w}:{h}' + (f',fps={fps}' if fps else '')
    cmd = ['ffmpeg', '-v', 'error', '-i', path] + (['-t', str(t)] if t else []) + ['-vf', vf, '-pix_fmt', 'bgr24', '-f', 'rawvideo', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE); n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)

# ── 1. YuNet on the real talking head
for W, H in [(1280, 720), (640, 360)]:
    det = cv2.FaceDetectorYN.create(MODEL, '', (W, H), 0.7, 0.3, 5000)
    ts, hits, boxes = [], 0, []
    t0 = time.time(); n = 0
    for fr in frames(F + 'real/talking-head-original.webm', W, H, fps=30):
        t = time.time(); _, f = det.detect(fr); ts.append(time.time() - t); n += 1
        if f is not None and len(f):
            b = f[np.argmax(f[:, -1])]; hits += 1; boxes.append((n, float((b[0] + b[2] / 2) / W), float((b[1] + b[3] / 2) / H), float(b[2] / W), float(b[-1])))
        else: boxes.append((n, None, None, None, 0))
    c = [(x, y) for _, x, y, _, _ in boxes if x is not None]
    xs = np.array([x for x, _ in c]); ys = np.array([y for _, y in c])
    jit = float(np.mean(np.hypot(np.diff(xs), np.diff(ys)))) * W
    print(f'YuNet {W}x{H}: {n} frames, face in {hits} ({100*hits/n:.0f}%), {1000*np.mean(ts):.1f} ms/frame detect-only, '
          f'raw mean frame-to-frame centre jitter {jit:.2f}px, centre range x {xs.min():.2f}-{xs.max():.2f} y {ys.min():.2f}-{ys.max():.2f}, mean face width {np.mean([b[3] for b in boxes if b[3]]):.3f} of frame')
    if W == 640:
        miss = [b[0] for b in boxes if b[1] is None]; runs = []
        for m in miss:
            if runs and m == runs[-1][1] + 1: runs[-1][1] = m
            else: runs.append([m, m])
        print('  no-face runs (frame ranges):', [(a, b) for a, b in runs if b - a >= 5][:12])

# ── 2. Seeded generic tracker on the subject fixture (truth: cx=640+400 sin(2πt/10), cy=360+150 sin(2πt/6.7))
W, H, FPS = 1280, 720, 30
truth = lambda i: (640 + 400 * math.sin(2 * math.pi * (i / FPS) / 10), 360 + 150 * math.sin(2 * math.pi * (i / FPS) / 6.7))
it = frames(F + 'subject.mp4', W, H)
first = next(it); cx, cy = truth(0)
tr = cv2.TrackerMIL.create(); tr.init(first, (int(cx - 60), int(cy - 60), 120, 120))
errs, ts = [], []
for i, fr in enumerate(it, start=1):
    t = time.time(); ok, box = tr.update(fr); ts.append(time.time() - t)
    tx, ty = truth(i); px, py = (box[0] + box[2] / 2, box[1] + box[3] / 2) if ok else (float('nan'), float('nan'))
    errs.append((math.hypot(px - tx, py - ty), ok, bool(ok and abs(px - tx) < box[2] / 2 and abs(py - ty) < box[3] / 2)))
e = np.array([x[0] for x in errs])
print(f'TrackerMIL seeded: {len(errs)} frames, {1000*np.mean(ts):.1f} ms/frame, mean err {np.nanmean(e):.1f}px, p95 {np.nanpercentile(e,95):.1f}px, max {np.nanmax(e):.1f}px, lost {sum(1 for x in errs if not x[1])}, truth inside box {100*sum(x[2] for x in errs)/len(errs):.0f}%')
