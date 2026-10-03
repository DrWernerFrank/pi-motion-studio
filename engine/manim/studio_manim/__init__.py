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

__all__ = [
    "L", "StudioScene", "say", "at", "until",
    "Eq", "Txt", "num",
    "color_for", "math_role", "background",
    "claim", "verify_claims",
    "layout_path", "trace_path", "timeline_path",
]
__version__ = "0.1.0"
