"""scene.py — ``StudioScene``: the base class math-film scenes write against (mission M2).

It wires together the format-aware frame (M2 layout), the theme, the studio fonts and the recorder
(layout.json / trace.json / timeline.json at every animation boundary). Narration (``say``/``at``/
``until``) reads the runner's timing slice; before P5 the timing may be absent — the API still works
(pads from the animation clock) so the starter renders before voice exists.

The runner (engine/math.mjs) invokes ``manim`` with ``--config`` settings and the env vars:
    STUDIO_FILM_STATE=path/to/film_state.json   (design, format, timing slice, film paths)
    STUDIO_FORMAT=16:9|9:16|1:1|4:5
Scenes subclass ``StudioScene`` and set ``scene_id``; the runner discovers and orders them.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from manim import Scene, logger

from . import recorder
from .layout import L, FRAMES, read_state
from .theme import background

logger.disabled = True  # noqa: B010  (the runner owns output; errors travel as exceptions)


class StudioScene(Scene):
    """A math-film scene. ``self.L`` is the layout for the active format."""

    scene_id: str = ""          # e.g. "s02_meaning" — scenes play in script.md order

    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)
        self.state = read_state()
        self.L = L
        # frame geometry: the unit frame is FIXED per format (short side 8); the runner's --resolution
        # sets pixels. Overriding here keeps Manim's config from drifting between versions.
        w, h = FRAMES[self.state.get("format", "16:9")]
        self.camera.frame_width = w
        self.camera.frame_height = h
        # the recorder writes next to the render output (the runner moves them into the film folder)
        out = Path(self.state.get("records_dir") or os.environ.get("STUDIO_RECORDS_DIR", "."))
        out.mkdir(parents=True, exist_ok=True)
        self.rec = recorder.Recorder(out, scene_id=self.scene_id or type(self).__name__,
                                     fmt=self.state.get("format", "16:9"))
        self._sentences: list[dict] = list(self.state.get("timing", {}).get("sentences", []))
        self._next_sentence = 0

    # -- lifecycle ----------------------------------------------------------------
    def construct(self):  # scenes override this
        pass

    def render(self, *args, **kw):
        try:
            super().render(*args, **kw)
        finally:
            self.rec.flush()

    # -- narration (full timing lives in P5; the API is frozen here) ----------------
    def say(self, sentence_id: str | None = None):
        """``with scene.say("s02.1"):`` — play animations under a sentence; pads if they end early.

        Without timing data (pre-P5 renders), the sentence is whatever is next and no padding runs:
        the starter film renders silent but correctly laid out.
        """
        return _Say(self, sentence_id)

    def at(self, bookmark: str) -> float:
        """Seconds from the sentence's start to ``{bookmark}`` — sync land for an animation."""
        s = self._current_sentence
        for b in (s or {}).get("bookmarks", []):
            if b["id"] == bookmark:
                return float(b["t"])
        return 0.0

    def until(self, bookmark: str) -> float:
        """A run_time that ends exactly on the bookmark."""
        return max(0.2, self.at(bookmark))

    def sentence(self, sentence_id: str) -> dict | None:
        for s in self._sentences:
            if s.get("id") == sentence_id:
                return s
        return None

    # -- recording (the lint, `where` and the GUI read these) ----------------------
    def play(self, *animations, **kw):
        name = "; ".join(type(a).__name__ for a in animations) or kw.get("_name", "wait")
        t0 = self.renderer.time if self.renderer else 0.0
        super().play(*animations, **kw)
        if getattr(self, "rec", None):
            self.rec.animation(self, name, t0)

    def wait(self, duration: float = 1.0, **kw):
        super().wait(duration, **kw)
        if getattr(self, "rec", None):
            self.rec.animation(self, "wait", None, seconds=duration)


class _Say:
    """``with scene.say(id):`` — the narration context (P5 wires the clock; frozen now)."""

    def __init__(self, scene: StudioScene, sentence_id: str | None):
        self.scene, self.want_id = scene, sentence_id

    def __enter__(self):
        s = self.scene
        if self.want_id:
            s._current_sentence = s.sentence(self.want_id)
        elif s._next_sentence < len(s._sentences):
            s._current_sentence = s._sentences[s._next_sentence]
            s._next_sentence += 1
        else:
            s._current_sentence = None
        s.rec.sentence_start(s._current_sentence)
        return self

    def __exit__(self, *exc):
        s = self.scene
        s.rec.sentence_end(s._current_sentence)
        s._current_sentence = None
        return False


def say(scene, sentence_id=None):  # module-level sugar for `from studio_manim import *`
    return scene.say(sentence_id)


def at(scene, bookmark):  # pragma: no cover - sugar; scenes use self.at
    return scene.at(bookmark)


def until(scene, bookmark):
    return scene.until(bookmark)
