"""layout.py — ``L``: the layout contract for math films, in Manim units (mission M2).

The Canvas engine's ``L`` (engine/lib/runtime.js) made one source render four formats by re-framing.
This is its Manim analogue, with one fixed convention:

    PIXEL SIZE  set by the runner (Manim ``--resolution``); the frame in UNITS is:
      16:9  -> 14.222 x 8.000   (Manim's default, kept so 16:9 scenes match every Manim example)
      9:16  ->  8.000 x 14.222  (portrait: swap — the SHORT side is always 8 units)
      1:1   -> 11.314 x 11.314  (equal-area square; short side still 8)
      4:5   ->  9.800 x 12.250
    So ``L.u`` (1% of the short side) is 0.08 units in every format: a 3.2u label is the same
    fraction of the frame everywhere, and portrait is a REAL re-composition because panels stack
    in a 14.2-unit-tall frame, not an 8-unit one.

``L`` is a module-level object the runner's film_state selects — scenes read it, never mutate it.
"""
from __future__ import annotations

import json
import os

# (format -> frame w, h in Manim units). The short side is 8 in every format (ADR-004's convention).
FRAMES = {
    "16:9": (14.222, 8.000),
    "9:16": (8.000, 14.222),
    "1:1": (11.314, 11.314),
    "4:5": (9.800, 12.250),
}
DEFAULT_FORMAT = "16:9"


class _Box:
    """A rectangle in frame units (x, y = left/bottom corner, w, h)."""

    __slots__ = ("x", "y", "w", "h")

    def __init__(self, x: float, y: float, w: float, h: float):
        self.x, self.y, self.w, self.h = x, y, w, h

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def __repr__(self) -> str:  # for traces/logs
        return f"Box({self.x:.2f},{self.y:.2f} {self.w:.2f}x{self.h:.2f})"


class _Layout:
    """Everything geometric a scene may ask for. Units: Manim frame units (short side = 8)."""

    def __init__(self, fmt: str = DEFAULT_FORMAT):
        if fmt not in FRAMES:
            raise ValueError(f"unknown format {fmt!r}: one of {sorted(FRAMES)}")
        self.fmt = fmt
        self.W, self.H = FRAMES[fmt]
        self.cx, self.cy = self.W / 2, self.H / 2
        self.portrait = self.H > self.W
        # 1% of the SHORT side — the Canvas engine's u, identical across formats (0.08 units).
        self.u = min(self.W, self.H) / 100

        # Safe area, the same fractions as engine/lib/runtime.js: portrait x 7%, y 10%, w 86%, h 72%;
        # others x 6%, y 8%, w 88%, h 84%. (Captions live BELOW it, in their own band.)
        if self.portrait:
            sx, sy, sw, sh = 0.07, 0.10, 0.86, 0.72
        else:
            sx, sy, sw, sh = 0.06, 0.08, 0.88, 0.84
        self.safe = _Box(sx * self.W, sy * self.H, sw * self.W, sh * self.H)

        # Slots. ``title``: a headline strip at the top of the safe area.
        self.title = _Box(self.safe.x, self.safe.y + self.safe.h * 0.86, self.safe.w, self.safe.h * 0.14)
        # ``stage``: the main content area (everything below the title).
        self.stage = _Box(self.safe.x, self.safe.y, self.safe.w, self.safe.h * 0.82)
        # ``caption``: the band under the safe area (portrait keeps it bigger).
        cap_h = 0.09 * self.H
        self.caption = _Box(sx * self.W, sy * self.H - cap_h, sw * self.W, cap_h)
        # ``panel(i, n)``: an even split of the stage (portrait stacks, landscape side-by-side).
        self._panel_n = None

    def panel(self, i: int, n: int) -> _Box:
        """The i-th of n panels filling the stage. Portrait: stacked rows; landscape: columns."""
        if not (0 <= i < n):
            raise IndexError(f"panel({i}, {n})")
        s = self.stage
        if self.portrait:
            h = s.h / n
            return _Box(s.x, s.y + s.h - h * (i + 1), s.w, h)
        w = s.w / n
        return _Box(s.x + w * i, s.y, w, s.h)

    def portrait_center_third(self) -> _Box:
        """The middle third of a portrait frame (the re-composition rule's main slot)."""
        return _Box(self.W * 0.10, self.H * 0.36, self.W * 0.80, self.H * 0.26)

    def __repr__(self) -> str:
        return f"L({self.fmt} {self.W:.2f}x{self.H:.2f} u={self.u:.3f} portrait={self.portrait})"


def read_state() -> dict:
    """The runner's film_state.json (design, format, timing slice). Missing = unit-test defaults."""
    path = os.environ.get("STUDIO_FILM_STATE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"format": DEFAULT_FORMAT, "design": {}, "timing": {}, "scene": {}}


def layout_for(fmt: str) -> _Layout:
    return _Layout(fmt)


# The active layout. StudioScene.__init_subclass__/render_entry re-points it per scene+format; module
# level so ``from studio_manim import L`` and scene code both see the same object.
L = layout_for(os.environ.get("STUDIO_FORMAT", DEFAULT_FORMAT))
