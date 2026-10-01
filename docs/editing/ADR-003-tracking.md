# ADR-003: subject tracking for reframing

Status: accepted (spike S3, 2026-10-01). Script: `docs/editing/spikes/s3.py`. OpenCV 5.0.0 (headless wheel) in the ML venv, CPU.

## Decision
- **Faces: YuNet** (`face_detection_yunet_2023mar.onnx`, MIT, 233 KB, OpenCV Zoo) via `cv2.FaceDetectorYN`, run on frames downscaled to 640 px wide.
- **Any other subject: `cv2.TrackerMIL` seeded with a box** (the agent or a GUI click gives the box; `follow` mode re-seeds after every cut).
  CSRT/KCF are contrib-only and absent from the headless wheel; DaSiamRPN/Nano need model files and were not needed.
- Both write `track.json` per source (normalized centre, size, confidence, per-frame or at >= 10 Hz), cached by content hash. The camera on top
  (critically damped spring + dead zone, reset on cuts) is JS in the edit runtime (P7); the detector only supplies targets.

## Measured
| | frames | result |
|---|---|---|
| YuNet 1280x720 on the real clip | 1615 | face in 80%, 22-26 ms/frame, raw frame-to-frame centre jitter 2.47 px |
| YuNet 640x360 on the real clip | 1615 | face in 80% (same frames), **7.3 ms/frame**, raw jitter 1.44 px; mean face width 14% of the frame |
| no-face frames | | exactly frames 1-157 and 1444-1615 (title card and end card); every frame of the talking section has a face |
| TrackerMIL seeded on `subject` (known path) | 599 | mean error 2.2 px, p95 3.4 px, max 4.5 px, 0 frames lost, true centre inside the box 100%, 27.7 ms/frame |

## Consequences
- Face tracking is cheap enough to run on every frame at 640 px (1 minute of 30 fps video ~ 13 s); sample at 10-15 Hz for the track file and interpolate.
- No face (title cards, b-roll) is a first-class state: hold the last position with a slow ease to centre; never snap.
- A face detector cannot check the `reframe` fixture (a synthetic disc); that check uses the seeded generic tracker, and the real clip exercises faces.
- Raw jitter is ~1.4 px even on a nearly still speaker, which is why the dead zone is required (a visible 1-2 px crop shimmer otherwise).
