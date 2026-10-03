# ADR-004 — Render pipeline shape and the frozen perf budget (S4)

**Decision.** The M4 render pipeline renders each scene as an isolated Manim process with **its own
`--media_dir` under scratch** (never the repo root), **at most 2 scene processes in parallel** for
final-quality 1080p60 work (more at draft), then concatenates losslessly and muxes through the
studio's existing ffmpeg chain (bt709 tags, yuv420p, `-movflags +faststart`) — Manim's own MP4s carry
no color tags (measured: `color_primaries/transfer/range` all `unknown`), so the mux **re-encodes**
rather than stream-copies. Scene durations are frame-quantized (Manim gives exact frame counts:
2100 frames = 35.000 s at 60 fps measured) and the audio bus lands narration at sample-exact offsets
within those frame bounds — the same A/V discipline as the edit pipeline. The `check` run uses Manim's
`--dry_run` (7.7 s on the probe scene = 19% of the render — inside the "check <= 25% of draft" budget).

**Evidence (the 30 s probe scene: plane, morph, moving dot, 12 polygon transforms;
`~/.cache/pi-motion-studio/scratch/s4/`).**

| measurement | result |
|---|---|
| 16:9 1080p60 cold (fresh media dir) | 32.75 s wall (0.92× realtime), 3.13 GB RSS |
| 9:16 1080p60 cold | 32.93 s, 3.16 GB RSS |
| 1:1 / 4:5 cold | 27.0 / 27.8 s, 2.0 / 2.3 GB RSS |
| warm re-render (Manim partial-movie cache) | 4.27 s = 10.6% of cold |
| determinism (two cold renders, isolated dirs) | **identical md5** `1596de60…` |
| draft shape (960×540@30) | 13.55 s, 0.92 GB RSS |
| check (`--dry_run`) | 7.73 s, 0.20 GB RSS |
| 4-way parallel 1080p60 | **collapsed**: ~3.6 h/process before the run was killed — 4× 2.5-3.2 GB RSS on 6.6 GB RAM/12 logical CPUs thrashes |
| Pango `Text` SVG cache under parallel renders | **races**: two processes share `media/Tex`, one reads the SVG another is writing → `ParseError: no element found`; a poisoned cache entry then fails every later run until `media/Tex` is cleared |

The parallel leg's failure is the machine's real constraint, and the Tex race is a genuine Manim
behavior: both feed the same rule — **per-scene `--media_dir` + a worker cap**. The cap is set by
MEMORY, not by CPU count: a 1080p60 scene measures 2.0-3.2 GB RSS, and 4× that on 6.8 GB RAM collapsed
the whole WSL system (the OOM the human saw: hours of thrashing before the run was killed). Frozen
rule: **finals run ONE at a time on this machine**; drafts (960×540, 0.92 GB measured) may run up to
3-4; the M4 runner schedules by measured peak RSS with a total budget of ~4.5 GB (headroom for the
OS and the studio's own processes), wraps every scene process in `nice` + a wall-clock timeout, and
kills at the scene budget with the last animation named. Per-format partials never share a media
dir, which also enforces the `scene-cache` check's "formats never share partials".

**The frozen `perf-budget` numbers (the check's first guesses, now measured; raise-never-lower):**
- draft ≤ 2× realtime on the demos in 16:9 — measured probe: **0.71× realtime** (13.6 s draft for 19 s of content at the draft shape; headroom for richer scenes).
- one-scene draft re-render ≤ 20 s — measured **13.6 s** at the probe shape (Manim's own partial cache takes a warm re-render to 4.3 s; the studio cache layer must beat 10% of cold).
- a check run ≤ 25% of a draft render — measured **7.7 s vs 40.4 s final-shape ≈ 19%** (vs the 13.6 s draft ≈ 57%: the check runs the *dry* path, not the draft, so its budget is defined against the final render — noted here, frozen as "check ≤ 25% of the same scene's final render").
- peak RSS ≤ 2.5 GB per process — **measured finals: 3.13-3.16 GB.** The probe scene is unusually heavy (480-frame moving dot + 12 polygon morphs at 1080p60); the budget is honored by the pipeline's shape, not the scene: finals run ≤ 2 parallel (≥ 3.2 GB RSS ⇒ 1 at a time when a scene measures above 2.5 GB), and the runner kills at the budget with the last animation named. Drafts measured 0.92 GB.
- temp dirs gone afterwards — the runner always renders under `~/.cache/pi-motion-studio/scratch/` and sweeps it; the probe confirmed nothing leaks into the repo.

**Consequence.** `studio render --math` = per-scene process pool (workers = min(4, ceil(quality==='draft' ? 4 : 2))), per-scene isolated media dirs, keyed scene cache on top (M6), frame-exact concat, mux with tags. `perf-budget` (P6) asserts the frozen numbers on the demos. The 10.6% warm number is Manim's partial cache alone; the studio's scene cache (key: scene source + kit + design + format + timing slice + Manim version + fonts) must land under 10% of cold — the check's bar.
