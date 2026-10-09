# ADR-003 — Assembly: how the segments become one piece (K8, spike S2)

**Decision.** The assembler is `engine/produce/assemble.mjs` (`assemble(key, { fmts })`). The plan's
`assembly` field names the route; the default — confirmed by S2's measurements below — is **the
edit film**: `films/<key>-asm` (kind edit, a child of the project) ingests each segment's final
(the ingest conform is one encode), one clip per segment lands back-to-back on the timeline with
stable ids (`s01`, `s02`, … — a re-assemble rebuilds the SAME edit.json, so the segment cache hits
and the render is byte-identical), per-segment loudness pre-matching lands every part at the mix
target, the dialog bus composites the segments' own audio with the 8 ms anti-click micro-fades at
every join, one mix at `mix.lufs`, and the edit kind's own final render delivers. Every segment is
encoded **once more at most** where the fast paths apply (below); a single-technique project
(`assembly.mode: "single"`, or exactly one segment) skips assembly entirely — `ensureFinals`
copies the child's finals byte-identical (K8: "a thin wrapper never re-encodes").

| plan says | the leg | encodes per segment | when it is chosen |
|---|---|---|---|
| `mode: "single"` / 1 segment | the thin wrapper (`ensureFinals`) | **0** — byte-identical copy | always |
| `transitions: "fade …"` (any mode) | the **xfade leg** (ffmpeg `xfade` + `acrossfade`) | **1** (one pass over the film) | the plan asks for a fade/dissolve |
| `mode: "direct"`, hard cuts | the **concat leg** (concat demuxer, `-c copy`) | **0** — the packets are never re-encoded | the plan names direct; falls back to the edit film, loudly, when a child lacks the format's final or the bitstreams do not concatenate (verified: frame count + duration, else a silent broken file) |
| `mode: "edit-film"` / absent (the default) | the **edit film** | 2 (the ingest conform at crf 16 + the edit render at crf 16) — measured 48.7–61.2 dB end-to-end, visually lossless | everything else; the only leg that takes ANY children (the conform normalizes geometry/rate/color) and carries the studio's whole delivery surface |

## S2 — what was measured (the same three children through both routes)

Fixture: a motion segment (6 s, a code-drawn circle that never stops moving, 30 fps), an edit
segment (3 s, the NASA talking-head fixture ingested, one clip cut to its least-frozen window),
a math segment (a fresh narrated scene with verified claims — 6.77 s in the spike, 19.73 s in the
check's fixture), each rendered to a 16:9 final at 30 fps; then both routes on the same inputs.
Every number below is from the actual files (ffprobe/ffmpeg `psnr`/`blackdetect`/`freezedetect`/
`ebur128`); the PSNR comparisons trim **both** sides to the same window (an untrimmed reference
mispairs frames and reports garbage — measured: the same pair read 64.1 dB trimmed vs 40.1 dB
with the reference left full).

| | edit-film (the default) | direct (concat + one audio pass) | direct + xfade (0.3 s fades) |
|---|---|---|---|
| wall time (16:9, 28.7 s film) | 74.2 s both formats (~30 s per format: ingest 6.9 s · mix 2.5 s · render 22.9 s) | 4.7 s | 12.1 s |
| encode generations per segment | 2 (conform crf 16 + render crf 16) | **0** (stream copy) | 1 (the one pass) |
| PSNR per segment vs its own final | **61.2 / 51.5 / 60.1 dB** (9:16: 61.1 / 48.7 / 60.2) | **inf / inf / inf** — bit-identical packets | whole-segment 41.7 / 20.1 / 26.8 dB; **pure windows 65.6 / 55.0 / 64.0 dB** |
| A/V (stream durations) | **< 1 ms** | 19 ms (< 1 frame at 30 fps) | 16 ms |
| joins (blackdetect + freezedetect over ±0.15 s windows) | 2 clean | 2 clean | 2 clean (the fade windows probe clean too) |
| loudness (ebur128 I / true peak) | −13.8 LUFS / −1.2 dBTP | −14.4 LUFS / −2.1 dBTP | −14.3 LUFS / −2.2 dBTP |
| duration | sum, exact | sum, exact | **sum − 2×0.3 s, exact** (28.133 s = 28.734 − 0.6) |

Two findings that shaped the legs:

- **AAC reconstruction adds true peak.** A mix limited at −1.48 dBFS measured −0.6 dBTP after one
  AAC generation (the reconstruction overshoots by ~0.4–0.9 dB, content-dependent). Every leg now
  limits at **−3 dBFS before the AAC** (`alimiter=limit=0.708:level=0`, the studio's `normalize()`
  then lands the loudness): measured −2.1/−2.2 dBTP on the assembled files, inside the ≤ −1 dBTP
  contract with margin.
- **A crossfade frame is a new picture, by design.** During a 0.3 s fade the frame is a blend of
  two unrelated segments, so whole-segment PSNR through a transition is bounded by the blend
  fraction (a 3 s segment with fades at both ends loses 20 % of its frames to the blend: 20.1 dB),
  not by the encode — the re-encode itself measures 60+ dB (the pure windows). The honest fidelity
  assertion for a transition-bearing assembly is therefore the **pure windows ≥ 40 dB** (measured
  55.0–65.6), plus clean joins and exact overlap accounting; the whole-segment figures are reported
  as-is and never compared against a copy-fidelity bar. `assemblyProbes(key)` returns both windows
  per segment (`at`/`dur` including the fade, `pure` excluding it) so the check measures each
  against the right contract.

## Why the edit film stays the default (direct beat it on the raw numbers)

On time, PSNR and generations the direct leg **wins** for the narrow case it fits (4.7 s vs 74.2 s;
inf vs 51–61 dB; 0 vs 2 encodes). It is kept — as `mode: "direct"` and the automatic leg for fade
transitions — and the assembler verifies its own concat (frame count + duration after the copy,
falling back to the edit film loudly if the children's bitstreams do not concatenate, because
`-c copy` across mixed encoders can produce a broken file silently). But the **default** stays the
edit film, per K8's own reason: assembly is the piece's final craft pass, not only a concat —

- it takes **any children**: the ingest conform normalizes geometry, frame rate and color (a child
  that never rendered the asked format still assembles — the conform + the edit render's crop
  reframe it, logged as `reframed` in `assembly.json`), while the direct legs need every child's
  own final in the format and a compatible bitstream;
- it carries the studio's **whole delivery surface** on the assembled piece: overlays, captions,
  punch-ins, per-clip color, the crop camera, J-cuts — an assembly title card or a callout over a
  join is an edit-film op, not a new pipeline;
- it is **deterministic and resumable**: stable clip ids rebuild the identical edit.json, the
  segment cache serves the second render, and a re-assemble is byte-identical (measured: md5 equal,
  6.3 s warm) — the concat leg is fast but stateless;
- its sound path is the **dialog bus**: per-segment loudness pre-matching (each child's final
  measured with ebur128, a `volume` op lands every segment at the target — measured
  −13.9/−14.0/−16.0 LUFS in → 0/+2/0 dB), the 8 ms micro-fades at every join (no clicks), one
  two-pass loudnorm at `mix.lufs`.

## The pieces

**`films/<key>/assembly.json`** (written only by the assembler): per format — the leg that built
it, the file, the fps, the measured `sum`, `overlaps`, `expected` (sum − overlaps), the join
windows (`from`/`to`/`ms` — the check's blackdetect/freezedetect windows), and per segment the
window in the assembled film, the reference (the child's final), `reframed` when it assembled
from a fallback format, and `pure` (the no-fade window) for transition-bearing legs.
`assemblyProbes(key)` reads it back and verifies the files it names still exist — the check
measures everything from the actual files, never from the record's claims.

**Transitions.** `plan.assembly.transitions` is free text; a fade/dissolve/xfade with a duration
(100–1000 ms, default 300) takes the xfade leg — one encode per segment, `acrossfade` on the audio
with the same duration and the same pre-match gains, the studio's `normalize()` for the one mix.
The edit film's own timeline already *records* crossfades (`xfade_ms` on the clip, edit-ops) but
its render composites one layer per track (`engine/lib/edit.js` `layersAt`), so a designed
crossfade inside the edit timeline needs the draw to paint the outgoing clip with an alpha ramp
over the incoming one across the `xfade_ms` window — **reported to the lead** (the model is ready;
the render side is a shared-file change). Until it lands, transitions ride the measured xfade leg
and `assembly.json` says so per format.

**One mix.** The target is `plan.assembly.lufs` → the project's `film.json mix.lufs` → **−14 LUFS**
(the studio default). The segments' own audio rides their finals' tracks — assembly never
re-synthesizes a bed under them (`films/<key>-asm` carries `music: null`).

**What a single-technique project skips.** `mode: "single"` (or exactly one segment): assembly is
skipped — the child's finals ARE the project's finals, copied byte-identical by `ensureFinals`
(with its captions), and `assembly.json` records `mode: "single"` with what was copied.

## The check

`engine/verify/produce/assemble.mjs` (the `assemble` row, slow) builds the composite fixture
honestly — the motion child animates through every frame, the edit child is the real NASA clip cut
to its least-frozen window, the math child is a fresh 2-beat scene with verified claims, each child
gates-PASS and renders BOTH asked formats through its own engine — then assembles through **all
three legs** (direct → xfade → the default edit-film last, so the fixture's out/ holds the default
deliverable) and measures: exact geometry per format, yuv420p/bt709/SAR 1:1/faststart, duration =
sum − overlaps within one frame, A/V within one frame, loudness at the target with TP ≤ −1 dBTP,
no black or frozen frame at any join, per-segment PSNR ≥ 40 dB against each child's own final
(inf for the direct leg, the pure windows for a transition-bearing one), the project's palette +
fonts in every child's `design.json` (`inheritedFrom`), state `assembled` with both formats'
finals in `out/`, a re-assemble that is byte-identical, and `studio project verify` **GREEN** on the
assembled piece. Runtime ~10 min cold, ~4 min warm (the manim scene cache).
