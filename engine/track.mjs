"""track.mjs (python): subject tracking written as track.json (mission D8, ADR-003).

Faces: YuNet at 640 px. Any other subject: TrackerMIL seeded with a box (the agent or GUI gives it), re-seeded
every 5 s to correct drift. Sampled at >= 10 Hz; the camera interpolates. A face detector cannot check the
synthetic `subject` fixture and vice versa, so both modes exist.

  ml-venv/bin/python engine/track.mjs --in <media> --out <track.json> [--faces | --seed x,y,w,h] [--hz 12]
"""
import argparse, json, os, subprocess, sys
import numpy as np, cv2

def frames(path, w, h):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h}', '-pix_fmt', 'bgr24', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='inp', required=True); ap.add_argument('--out', dest='out', required=True)
    ap.add_argument('--faces', action='store_true')
    ap.add_argument('--seed')  # "x,y,w,h" in fractions of the frame
    ap.add_argument('--hz', type=float, default=24.0)
    a = ap.parse_args()
    # faces: YuNet at 640 px is plenty (ADR-003). A seeded generic tracker follows fine detail: run it at
    # the source's own resolution (MIL is cheap) so a fast subject does not smear between samples.
    if a.faces: W, H = 640, 360
    else:
        pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', a.inp], capture_output=True, text=True).stdout.strip()
        W, H = (int(x) for x in pr.split(',')) if pr else (640, 360)
        W, H = min(W, 1280), min(H, 1280)
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.inp], capture_output=True, text=True).stdout.strip() or 0)
    fpsn = 30.0
    try:
        r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', a.inp], capture_output=True, text=True).stdout.strip()
        fpsn = eval(r) if r and '0/0' not in r else 30.0
    except Exception: pass
    N = max(1, int(total * fpsn))
    step = max(1, int(round(fpsn / a.hz)))
    out = {'version': 1, 'mode': 'faces' if a.faces else 'seeded', 'source': a.inp, 'hz': fpsn / step, 'W': W, 'H': H, 'boxes': [], 'misses': 0, 'frames': N}
    if a.faces:
        model = os.path.expanduser('~/.local/share/pi-motion-studio/models/opencv/yunet.onnx')
        det = cv2.FaceDetectorYN.create(model, '', (W, H), 0.7, 0.3, 5000)
        i = 0
        for fr in frames(a.inp, W, H):
            if i % step == 0:
                _, f = det.detect(fr)
                if f is not None and len(f):
                    b = f[np.argmax(f[:, -1])]
                    out['boxes'].append({'t': round(i / fpsn, 3), 'x': float(b[0] / W), 'y': float(b[1] / H), 'w': float(b[2] / W), 'h': float(b[3] / H), 'conf': float(b[-1])})
                else:
                    out['misses'] += 1
                    out['boxes'].append({'t': round(i / fpsn, 3), 'x': None})
            i += 1
            if i >= N: break
    else:
        if not a.seed: sys.exit('track: a non-face subject needs --seed x,y,w,h (fractions)')
        sx, sy, sw, sh = [float(x) for x in a.seed.split(',')]
        tr = None
        last = (int(sx * W), int(sy * H), int(sw * W), int(sh * H))  # the seed; afterwards the tracker's own box
        i = 0
        for fr in frames(a.inp, W, H):
            if tr is None or (i and i % max(1, int(fpsn * 5)) == 0):  # re-seed every 5 s at the last good box (drift correction, not a reset)
                tr = cv2.TrackerMIL.create()
                tr.init(fr, tuple(int(v) for v in last))
            ok, b = tr.update(fr)  # update on EVERY frame (cheap): sampling less lets a fast subject slip
            if ok: last = tuple(int(v) for v in b)
            if i % step == 0:  # record at the asked rate
                if ok: out['boxes'].append({'t': round(i / fpsn, 3), 'x': float(b[0] / W), 'y': float(b[1] / H), 'w': float(b[2] / W), 'h': float(b[3] / H), 'conf': 1.0})
                else: out['misses'] += 1; out['boxes'].append({'t': round(i / fpsn, 3), 'x': None})
            i += 1
            if i >= N: break
    with open(a.out, 'w') as f: json.dump(out, f, indent=1)
    hit = len(out['boxes']) - out['misses']
    print(f"[track] {'faces' if a.faces else 'seeded'}: {hit}/{len(out['boxes'])} samples at {out['hz']:.1f} Hz -> {a.out}", file=sys.stderr)

if __name__ == '__main__':
    main()
