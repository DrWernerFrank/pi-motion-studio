"""recorder.py — layout.json / trace.json / timeline.json at every animation boundary (M2).

The lint (P3), `studio where` (M5) and the GUI (M7) read these. One recorder per scene render:

    layout.json  [ { t, objects: [ { id, kind, bbox [x,y,w,h], size_u, color, z, alive } ] } ]
    trace.json   [ { t, scene, sentence, animation, file, line } ]
    timeline.json  { scene_id, fmt, started, ended, animations: n, frames: n, seconds: s }

Geometry is measured from the REAL mobject bounding boxes (in frame units; the lint converts to u).
The recorder never writes inside the repo: the runner points ``records_dir`` at scratch.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from manim import DL, UR


class Recorder:
    def __init__(self, out_dir: Path, *, scene_id: str, fmt: str):
        self.dir = Path(out_dir)
        self.scene_id, self.fmt = scene_id, fmt
        self.layout: list[dict] = []
        self.trace: list[dict] = []
        self._anim_i = 0
        self._sentence: dict | None = None
        self._sentence_start_t: float | None = None
        # records land as <scene>-layout.json etc; the runner collects them into the film folder
        self.layout_file = self.dir / f"{scene_id}-layout.json"
        self.trace_file = self.dir / f"{scene_id}-trace.json"
        self.timeline_file = self.dir / f"{scene_id}-timeline.json"

    # -- sentence tracking -------------------------------------------------------
    def sentence_start(self, sentence: dict | None):
        self._sentence = sentence
        self._sentence_start_t = None  # set on the first animation inside the sentence

    def sentence_end(self, sentence: dict | None):
        if self._sentence is not None and self._sentence_start_t is not None:
            self.trace.append({
                "t": self._sentence_start_t, "kind": "sentence_end",
                "scene": self.scene_id, "sentence": (self._sentence or {}).get("id"),
            })
        self._sentence, self._sentence_start_t = None, None

    # -- per-animation snapshot ----------------------------------------------------
    def animation(self, scene, name: str, t0: float | None, *, seconds: float | None = None):
        t = None
        try:
            t = scene.renderer.time
        except Exception:
            t = t0 if t0 is not None else (self.trace[-1]["t"] if self.trace else 0.0)
        if self._sentence is not None and self._sentence_start_t is None:
            self._sentence_start_t = t
        self._anim_i += 1
        objects = self._snapshot(scene)
        self.layout.append({"t": round(float(t), 3), "objects": objects})
        frame = {
            "kind": "animation", "t": round(float(t), 3), "i": self._anim_i,
            "scene": self.scene_id, "sentence": (self._sentence or {}).get("id"),
            "animation": name,
        }
        if seconds is not None:
            frame["seconds"] = round(float(seconds), 3)
        self.trace.append(frame)

    def _snapshot(self, scene) -> list[dict]:
        from .layout import L

        out = []
        for m in scene.mobjects:
            # GEOMETRY: Manim CE 0.21 has no Mobject.get_bounding_box (ManimGL-only — the first draft
            # called it, the bare except swallowed every object, and every layout frame recorded
            # objects: []; found by two wave-1 workers). get_corner(DL/UR) is the CE API that works.
            try:
                dl, ur = m.get_corner(DL), m.get_corner(UR)
                x, y = float(dl[0]), float(dl[1])
                w, h = float(ur[0]) - x, float(ur[1]) - y
            except Exception:
                continue  # a mobject without geometry (camera etc) is not a layout object
            if w <= 0 or h <= 0 or not np.isfinite(w) or not np.isfinite(h):
                continue  # zero-area / degenerate mobject: no layout object
            try:
                # ManimColor on this build exposes to_hex() (NOT .hex — the recorder's color lookup
                # came back null for every text object and the lint's contrast rule never ran on
                # real output; found from the P3 worker's report)
                c = m.color if hasattr(m, "color") else None
                color = c.to_hex() if c is not None else None
            except Exception:
                color = None
            kind = type(m).__name__
            # a text/math object is one the lint sizes: any manim text base OR a studio subclass of
            # one (Txt/Eq subclass Text/MathTypst — the first draft's exact-name test was False for
            # them). MRO walk, not name match.
            TEXT_BASES = {"Text", "MathTypst", "Typst", "Paragraph", "MarkupText", "Tex", "MathTex"}
            is_text = any(c.__name__ in TEXT_BASES for c in type(m).__mro__)
            # role + nominal size for the lint's size rule: the studio classes stash their ladder
            # role on construction (Txt/Eq set _studio_role + _studio_nominal_u; other mobjects
            # carry none and the lint applies its floors by kind)
            role = getattr(m, "_studio_role", None)
            nominal_u = getattr(m, "_studio_nominal_u", None)
            height_u = (h / L.u) if L.u else 0.0
            out.append({
                "kind": kind, "id": f"{self._anim_i}:{out.__len__()}",
                "bbox": [round(x, 3), round(y, 3), round(w, 3), round(h, 3)],
                "height_u": round(height_u, 2), "nominal_u": nominal_u, "role": role,
                "color": color, "z": len(out), "alive": True, "text": is_text,
            })
        return out

    # -- flush ------------------------------------------------------------------
    def flush(self):
        for path, data in ((self.layout_file, self.layout), (self.trace_file, self.trace)):
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1)
        n = len(self.trace)
        secs = self.trace[-1]["t"] if self.trace else 0.0
        with open(self.timeline_file, "w", encoding="utf-8") as f:
            json.dump({"scene_id": self.scene_id, "fmt": self.fmt, "animations": n,
                       "seconds": round(float(secs), 3)}, f, indent=1)


def layout_path(scene_id: str) -> str:
    return str(Recorder.__module__)


def trace_path(scene_id: str) -> str:  # pragma: no cover
    return f"{scene_id}-trace.json"


def timeline_path(scene_id: str) -> str:  # pragma: no cover
    return f"{scene_id}-timeline.json"
