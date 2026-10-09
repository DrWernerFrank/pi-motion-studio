"""studio_manim — the kit math-film scenes import (mission M2).

    from studio_manim import *            # StudioScene, L, Eq, Txt, num, Matrix, PlaneLab, claim …

A scene is written against the layout ``L`` (never absolute coordinates) so every format is a
re-composition, not a scaled copy. The Node runner (engine/math.mjs) drives `manim` per scene with a
generated ``film_state.json`` (design, format, timing slice); this package reads it — scenes never
parse CLI args or read the film folder themselves.
"""
from .layout import L  # the layout object for the active format (set by StudioScene)
from .scene import StudioScene, say, at, until  # noqa: F401  (narration context managers)
from .typeset import Eq, Txt, num  # noqa: F401
from .theme import color_for, math_role, background  # noqa: F401
from .claims import claim, verify_claims  # noqa: F401
from .recorder import layout_path, trace_path, timeline_path  # noqa: F401

# ── determinism: pin manim's partial-movie encodes to ONE thread (D-016, 2026-10-08) ──────
# Manim writes each animation as a partial MP4 through PyAV's libx264 with default (auto) threads.
# libavcodec drives x264 ENCODING with SLICED threading, whose slice partitioning varies run to
# run: two cold renders of the same scene produce identical decoded frames but ~100k scattered
# differing bytes (measured: odd-squares s01, 1080x1920, profile/size/pts identical) — and the
# varying partial bitstreams then move the seam-trim by a frame, so the assembled final differs
# render to render (the naming check caught it: 9:16 re-rendered to cae7b2… after the frozen
# ledger a06b4b…; decode-level only 5 seam frames moved). thread_count=1 makes the encode
# bit-deterministic; the cost is small (cairo renders on the main thread — the encode is not the
# bottleneck; the fixture renders s01 in ~7s single-threaded).
def _pin_partial_threads():
    try:
        from manim.scene import scene_file_writer as _sfw
        _orig = _sfw._PartialMovieEncodeJob.__init__
        def _det_init(self, *a, **kw):
            _orig(self, *a, **kw)
            try:
                self.stream.codec_context.thread_count = 1
                self.stream.codec_context.thread_type = 0
            except Exception:
                pass
        _sfw._PartialMovieEncodeJob.__init__ = _det_init
    except Exception:
        pass   # manim internals moved: the renders still work, determinism is re-measured by verify-math
_pin_partial_threads()

__all__ = [
    "L", "StudioScene", "say", "at", "until",
    "Eq", "Txt", "num",
    "color_for", "math_role", "background",
    "claim", "verify_claims",
    "layout_path", "trace_path", "timeline_path",
]
__version__ = "0.1.0"
