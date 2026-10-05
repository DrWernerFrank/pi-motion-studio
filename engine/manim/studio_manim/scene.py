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

SENTENCE_GAP_S = 0.15  # the narration bus's inter-sentence gap (narration.mjs) — a scene's last
                        # sentence pads through it so picture and audio agree at every seam


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
        # the theme's background (PAPER is cream — the first draft rendered black: never set).
        # The setter re-inits the background pixel array, so this works post-init.
        self.camera.background_color = background()
        # the recorder writes next to the render output (the runner moves them into the film folder)
        out = Path(self.state.get("records_dir") or os.environ.get("STUDIO_RECORDS_DIR", "."))
        out.mkdir(parents=True, exist_ok=True)
        self.rec = recorder.Recorder(out, scene_id=self.scene_id or type(self).__name__,
                                     fmt=self.state.get("format", "16:9"))
        self._sentences: list[dict] = list(self.state.get("timing", {}).get("sentences", []))
        self._next_sentence = 0
        self._scene_own = None            # this scene's sentences (lazy)
        self._scene_offset = None         # its first sentence's film start = the scene's local zero
        self._current_sentence = None
        self._current_local_start = None

    # -- lifecycle ----------------------------------------------------------------
    def construct(self):  # scenes override this
        pass

    def render(self, *args, **kw):
        try:
            super().render(*args, **kw)
        finally:
            if getattr(self, "rec", None):
                self.rec.scene_end()
                self.rec.flush()

    # -- narration (the clock: scenes adapt to the voice, never the other way round) ----------
    def say(self, sentence_id: str | None = None):
        """``with scene.say("s02.1"):`` — play animations under a sentence.

        The sentence's film position is derived from the runner's timing slice (all sentences, but
        only THIS scene's are used — its first sentence's start is the scene's local zero). Entering
        a context SEEKS to the sentence's local start if animations ran short; exiting PADS to the
        sentence's end (``wait``) if they ended early. Animations that overrun are never rewound —
        an ``overrun`` trace entry records the excess (the sync check surfaces it).
        Without timing data (``check`` runs, unvoiced films) the context is a pass-through and
        animations run at their own run_times.
        """
        return _Say(self, sentence_id)

    def at(self, bookmark: str) -> float:
        """Seconds from THIS SENTENCE's start to ``{bookmark}`` (D-016: relative by contract)."""
        s = self._current_sentence
        for b in (s or {}).get("bookmarks", []):
            if b["id"] == bookmark:
                if getattr(self, "rec", None):
                    self.rec.bookmark(bookmark, float(b["t"]), s)
                return float(b["t"])
        return 0.0

    def until(self, bookmark: str) -> float:
        """A run_time that ENDS exactly on the bookmark (relative to the clock's position now)."""
        target = self.at(bookmark)
        elapsed = self._sentence_elapsed()
        return max(0.2, target - elapsed)

    def _sentence_elapsed(self) -> float:
        """Seconds since the current sentence's local start (0.0 without narration)."""
        if self._current_local_start is None:
            return 0.0
        try:
            return max(0.0, self.renderer.time - self._current_local_start)
        except Exception:
            return 0.0

    def _scene_sentences(self) -> list[dict]:
        """Only this scene's sentences, in order (the cache contract: others never affect a scene)."""
        if self._scene_own is None:
            self._scene_own = [s for s in self._sentences if s.get("scene") == self.scene_id]
        return self._scene_own
    def sentence(self, sentence_id: str) -> dict | None:
        for s in self._sentences:
            if s.get("id") == sentence_id:
                return s
        return None

    # -- recording (the lint, `where` and the GUI read these) ----------------------
    def play(self, *animations, **kw):
        name = "; ".join(type(a).__name__ for a in animations) or kw.get("_name", "wait")
        try:
            t0 = self.renderer.time  # renderer.time exists on 0.21 (verified); defensive anyway
        except Exception:
            t0 = None
        super().play(*animations, **kw)
        if getattr(self, "rec", None):
            self.rec.animation(self, name, t0)

    def wait(self, duration: float = 1.0, **kw):
        super().wait(duration, **kw)
        if getattr(self, "rec", None):
            self.rec.animation(self, "wait", None, seconds=duration)


class _Say:
    """``with scene.say(id):`` — the narration context. Timing-aware: seek on entry, pad on exit."""

    def __init__(self, scene: StudioScene, sentence_id: str | None):
        self.scene, self.want_id = scene, sentence_id

    def __enter__(self):
        s = self.scene
        own = s._scene_sentences()
        if not own:
            # UNVOICED films / `check` runs (the runner passes no timing): a pass-through context —
            # animations run at their own run_times (D-019's documented check path). A film whose
            # timing.json exists but lacks THIS scene's sentences is also silent-leg (the sentence
            # belongs to another scene or the film was re-scripted): pad nothing, say nothing.
            s._current_sentence = None
            s._current_local_start = None
            s.rec.sentence_start(None)
            return s
        if self.want_id:
            sent = s.sentence(self.want_id)
            if sent is None:
                raise ValueError(
                    f"say({self.want_id!r}): no such sentence in timing.json "
                    f"(known: {[x.get('id') for x in own] or 'none — was the film voiced?'})")
            if sent.get("scene") != s.scene_id:
                raise ValueError(
                    f"say({self.want_id!r}): that sentence belongs to scene {sent.get('scene')!r}, "
                    f"not this one ({s.scene_id!r}) — move the say() or the sentence")
        elif s._next_sentence < len(own):
            sent = own[s._next_sentence]
            s._next_sentence += 1
        else:
            sent = None  # more say() contexts than sentences: a silent block (legal, unpadded)
        s._current_sentence = sent
        s._current_local_start = None
        if sent is not None and own:
            # the scene's local zero = its FIRST sentence's film start (derived, never stored)
            if s._scene_offset is None:
                s._scene_offset = float(own[0].get("start", 0.0))
            local_start = float(sent.get("start", 0.0)) - s._scene_offset
            elapsed = s._sentence_elapsed()  # 0 while no sentence is current — read raw below
            try:
                now = s.renderer.time
            except Exception:
                now = 0.0
            s._current_local_start = local_start
            if now < local_start - 1e-3:
                # animations so far ran shorter than the sentence's film position: WAIT to it,
                # so the picture lands with the voice ("scenes adapt to the voice")
                s.wait(local_start - now)
        s.rec.sentence_start(sent)
        return self

    def __exit__(self, exc_type, exc, tb):
        s = self.scene
        sent = s._current_sentence
        if sent is not None and exc_type is None:
            try:
                now = s.renderer.time
            except Exception:
                now = None
            if now is not None and s._current_local_start is not None:
                local_end = s._current_local_start + float(sent.get("end", sent.get("start", 0.0))) - float(sent.get("start", 0.0))
                # SEAM GAP: if this is the SCENE'S LAST sentence, pad through the 0.15 s inter-
                # sentence gap too (the narration bus inserts it between sentences — including
                # across scene boundaries; without the pad the picture runs ~0.15 s ahead of the
                # audio at every seam, accumulating; glm-kit measured 0.10–0.30 s).
                own = s._scene_sentences()
                if own and sent is own[-1]:
                    local_end += SENTENCE_GAP_S
                if now < local_end - 1e-3:
                    s.wait(local_end - now)          # pad: the sentence's words finish on screen
                elif now > local_end + 0.05:
                    if getattr(s, "rec", None):
                        s.rec.overrun(sent, round(now - local_end, 3))
        s.rec.sentence_end(sent)
        s._current_sentence = None
        s._current_local_start = None
        return False


def say(scene, sentence_id=None):  # module-level sugar for `from studio_manim import *`
    return scene.say(sentence_id)


def at(scene, bookmark):  # pragma: no cover - sugar; scenes use self.at
    return scene.at(bookmark)


def until(scene, bookmark):
    return scene.until(bookmark)
