"""theme.py — design.json -> colors, fonts, sizes (one source of truth, mission M2).

The runner's film_state.json carries the film's ``design`` (or the film's design.json is read once).
Defaults here are the two shipped themes (P2): ``paper`` (the determinant film's warm light palette)
and ``chalk`` (a dark one). One color per concept via ``math.roles`` — never reused.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .layout import read_state

PAPER = {
    "name": "paper",
    "background": "#F2EEE4",
    "colors": {"ink": "#17150F", "muted": "#8A8478", "surface": "#FBF9F3",
               "grid": "#CBC2AE", "gridBase": "#E7E1D4"},
    "math": {"roles": {"positive": "#EE9A12", "negative": "#D2462C", "result": "#A86400",
                       "vector": "#3E6F5C", "area": "#B9DE6E", "basis": "#A86400"}},
    "fonts": {"display": "Instrument Serif", "ui": "JetBrains Mono", "body": "Inter"},
    "ladder": {"hero": 16, "title": 9, "math": 9, "body": 3.6, "label": 3.2, "caption": 3.4},
}
CHALK = {
    "name": "chalk",
    "background": "#14161C",
    "colors": {"ink": "#ECEAE3", "muted": "#7B818E", "surface": "#1C1F27",
               "grid": "#2A2F3B", "gridBase": "#20242E"},
    "math": {"roles": {"positive": "#F5B748", "negative": "#F0705A", "result": "#F5B748",
                       "vector": "#69C9A8", "area": "#9BD477", "basis": "#F5B748"}},
    "fonts": {"display": "Space Grotesk", "ui": "JetBrains Mono", "body": "Inter"},
    "ladder": {"hero": 16, "title": 9, "math": 9, "body": 3.6, "label": 3.2, "caption": 3.4},
}

_CACHE: dict | None = None


def design() -> dict:
    """The active film's design dict (film_state's ``design``), or PAPER defaults."""
    global _CACHE
    if _CACHE is None:
        st = read_state()
        d = st.get("design") or {}
        if not d.get("colors"):  # bare design.json: fill from the theme it names
            theme = {"paper": PAPER, "chalk": CHALK}.get(d.get("theme", "paper"), PAPER)
            merged = {**theme, **{k: v for k, v in d.items() if v is not None}}
            _CACHE = merged
        else:
            _CACHE = {**PAPER, **d}
    return _CACHE


def color_for(role: str) -> str:
    d = design()
    return d.get("colors", {}).get(role) or d.get("math", {}).get("roles", {}).get(role) or d["colors"]["ink"]


def math_role(name: str) -> str:
    """One color per concept, fixed for the whole video (craft rule 9.2)."""
    roles = design().get("math", {}).get("roles", {})
    if name not in roles:
        raise KeyError(f"math role {name!r} is not in design.json math.roles: {sorted(roles)} "
                       "(one color per concept — add it there, never reuse another)")
    return roles[name]


def font_for(role: str) -> str:
    d = design()
    fam = {"hero": d["fonts"]["display"], "title": d["fonts"]["display"],
           "math": d["fonts"]["ui"], "body": d["fonts"].get("body", "Inter"),
           "label": d["fonts"]["ui"], "caption": d["fonts"].get("body", "Inter")}.get(role)
    return fam or d["fonts"]["display"]


def size_u(role: str) -> float:
    """A ladder size in u (1% of the short side) — the same fraction in every format.

    PORTRAIT grows type (×1.5 for math/body, ×1.3 for titles): u is a fraction of the SHORT side,
    so in a tall frame the same u fills a much smaller share of the frame's height — the Canvas
    determinant film did this by hand in 9:16 ("15u matrix, 11u formula"); the kit does it by rule.
    The floors still hold everywhere (body >= 3.2u, tick/legend >= 2.6u — the lint's job, P3).
    """
    base = design().get("ladder", {}).get(role, 3.6)
    from .layout import L
    if not L.portrait:
        return base
    mult = {"math": 1.5, "body": 1.5, "label": 1.5, "caption": 1.5,
            "title": 1.3, "hero": 1.2}.get(role, 1.0)
    return base * mult


def background() -> str:
    return design()["background"]
