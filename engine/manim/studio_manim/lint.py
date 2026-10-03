"""lint.py — the layout lint: a pure function over the recorder's records (mission M2, P3).

"Layout is measured, not hoped for." ``violations()`` reads one scene's ``layout.json`` frames (object
geometry at every animation boundary) and reports what breaks the layout contract, each with the
frame's time, the offending object ids and the source line (from ``trace.json`` when it has one):

    offscreen  fail  an object's bbox leaves the frame (aspect "frame") or the safe area ("safe")
    overlap    fail  text over text, or text over a figure, unless the pair is allowed
    size       fail  nominal size < 3.2u for text/math (roles ``tick`` and ``legend``: 2.6u)
    contrast   fail  text color vs the design background < 4.5:1 (WCAG relative luminance)
    density    warn  more than 4 text/math objects alive at one t (``tick`` labels do not count)

Geometry is Manim frame units, CENTERED at (0, 0) (D-008); the safe area is ``layout_for(fmt).safe``
— the same box the scenes compose against, never re-derived here.

``allow_pairs`` lists legitimate overlaps as unordered token pairs. A token matches an object when it
equals the object's ``kind`` (``"NumberPlane"``), its ``role`` (``"tick"``, ``"label"``) or is
``"text"`` and the object is text. The DEFAULT allows text over background furniture — a plane, axes,
a grid or a number line is the page, not a figure (every label of the Canvas films sat on the grid).
Real shapes (Polygon, Square, gnomons, plotted curves) stay violations. Passing ``allow_pairs``
replaces the default: include ``DEFAULT_ALLOW`` to extend it. The same furniture kinds are exempt from
``offscreen`` (a page may bleed past the safe area or the frame).

CLI (for the layout-lint check and ``studio check``):

    python -m studio_manim.lint <records-dir> <design.json> <fmt> [--allow a,b ...]

prints a JSON list of violations over every ``<scene>-layout.json`` in the directory (each carries a
``scene`` key). ``--allow`` pairs ADD to ``DEFAULT_ALLOW`` here (the function's argument replaces it).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .layout import layout_for

FURNITURE = ("NumberPlane", "Axes", "Grid", "NumberLine")
DEFAULT_ALLOW = tuple(("text", k) for k in FURNITURE)

MARGIN = 0.05        # overlap tolerance, frame units: boxes must interpenetrate by more than this
EDGE_EPS = 0.01      # records are rounded to 3 decimals: an edge exactly on the line is inside
FLOOR_BODY = 3.2     # u
FLOOR_SMALL = 2.6    # u, roles tick/legend
SMALL_ROLES = ("tick", "legend")
MIN_CONTRAST = 4.5
MAX_TEXT_ALIVE = 4
DEFAULT_BACKGROUND = "#F2EEE4"  # the paper theme (theme.PAPER), when a design names none


# -- helpers --------------------------------------------------------------------------------
def _hex_rgb(c: str):
    s = c.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) == 8:  # #rrggbbaa: alpha is not part of the ink
        s = s[:6]
    if len(s) != 6:
        raise ValueError(f"not a hex color: {c!r}")
    return tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(c: str) -> float:
    """WCAG 2.x relative luminance of a hex color."""
    def lin(v):
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in _hex_rgb(c))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def background_of(design: dict | None) -> str:
    d = design or {}
    bg = (d.get("colors") or {}).get("background") or d.get("background")
    if bg:
        return bg
    if d.get("theme") == "chalk":
        return "#14161C"
    return DEFAULT_BACKGROUND


def _overlap(a, b, margin=MARGIN) -> bool:
    """Axis-aligned boxes [x, y, w, h] interpenetrate by more than ``margin`` on both axes."""
    ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return ox > margin and oy > margin


def _matches(token: str, o: dict) -> bool:
    return token == o.get("kind") or (o.get("role") is not None and token == o.get("role")) \
        or (token == "text" and bool(o.get("text")))


def _allowed(a: dict, b: dict, allow_pairs) -> bool:
    for p, q in allow_pairs:
        if (_matches(p, a) and _matches(q, b)) or (_matches(p, b) and _matches(q, a)):
            return True
    return False


def _source_line(trace, t):
    """``file:line`` of the trace entry nearest to t (first on ties), if that entry carries one."""
    best, best_d = None, None
    for e in trace or ():
        if not isinstance(e, dict) or e.get("t") is None:
            continue
        d = abs(float(e["t"]) - t)
        if best_d is None or d < best_d:
            best, best_d = e, d
    if best and best.get("file") and best.get("line") is not None:
        return f"{best['file']}:{best['line']}"
    return None


def _outside(b, left, bottom, right, top):
    """Which sides of the box [left..right]x[bottom..top] the bbox crosses, with the overshoot."""
    x, y, w, h = b
    out = {}
    if x < left - EDGE_EPS:
        out["left"] = round(left - x, 3)
    if x + w > right + EDGE_EPS:
        out["right"] = round(x + w - right, 3)
    if y < bottom - EDGE_EPS:
        out["bottom"] = round(bottom - y, 3)
    if y + h > top + EDGE_EPS:
        out["top"] = round(y + h - top, 3)
    return out


# -- the lint ---------------------------------------------------------------------------------
def violations(records, trace, design, fmt, allow_pairs=DEFAULT_ALLOW):
    """Every layout violation in one scene's records.

    records: the ``layout.json`` list ``[{t, objects: [...]}]``; trace: the ``trace.json`` list (or
    None); design: the film's design dict; fmt: "16:9" | "9:16" | "1:1" | "4:5".
    Returns ``[{rule, level, t, ids, detail, source_line}]`` in frame order.
    """
    L = layout_for(fmt)
    s = L.safe
    bg = background_of(design)
    allow_pairs = tuple(tuple(p) for p in (allow_pairs or ()))
    out = []

    for frame in records or ():
        t = float(frame.get("t", 0.0))
        src = _source_line(trace, t)
        objs = [o for o in frame.get("objects") or () if o.get("alive", True)]

        def v(rule, level, ids, detail):
            out.append({"rule": rule, "level": level, "t": t, "ids": list(ids),
                        "detail": detail, "source_line": src})

        for o in objs:
            b = o.get("bbox")
            if not b or o.get("kind") in FURNITURE:
                continue
            fr = _outside(b, L.left, L.bottom, L.right, L.top)
            if fr:
                v("offscreen", "fail", [o["id"]],
                  f"{o.get('kind')} outside the FRAME by " + ", ".join(f"{k} {d}" for k, d in fr.items())
                  + f" (frame {L.W:.3f}x{L.H:.3f} centered)")
                continue
            sf = _outside(b, s.x, s.y, s.x + s.w, s.y + s.h)
            if sf:
                v("offscreen", "fail", [o["id"]],
                  f"{o.get('kind')} outside the SAFE area by " + ", ".join(f"{k} {d}" for k, d in sf.items())
                  + f" (safe x {s.x:.3f}..{s.x + s.w:.3f}, y {s.y:.3f}..{s.y + s.h:.3f})")

        for i, a in enumerate(objs):
            for b in objs[i + 1:]:
                if not (a.get("text") or b.get("text")):
                    continue  # figure over figure is composition, not a lint matter
                if not a.get("bbox") or not b.get("bbox") or not _overlap(a["bbox"], b["bbox"]):
                    continue
                if _allowed(a, b, allow_pairs):
                    continue
                what = "text over text" if (a.get("text") and b.get("text")) else "text over figure"
                v("overlap", "fail", [a["id"], b["id"]],
                  f"{what}: {a.get('kind')}/{a.get('role')} x {b.get('kind')}/{b.get('role')}")

        for o in objs:
            if not o.get("text"):
                continue
            n = o.get("nominal_u")
            if n is not None:
                floor = FLOOR_SMALL if o.get("role") in SMALL_ROLES else FLOOR_BODY
                if float(n) < floor - 1e-9:
                    v("size", "fail", [o["id"]],
                      f"nominal {float(n):.2f}u < {floor}u floor (role {o.get('role')})")
            c = o.get("color")
            if c:
                try:
                    r = contrast_ratio(c, bg)
                except ValueError:
                    r = None
                if r is not None and r < MIN_CONTRAST:
                    v("contrast", "fail", [o["id"]], f"{c} on {bg} = {r:.2f}:1 < {MIN_CONTRAST}:1")

        texts = [o for o in objs if o.get("text") and o.get("role") != "tick"]
        if len(texts) > MAX_TEXT_ALIVE:
            v("density", "warn", [o["id"] for o in texts],
              f"{len(texts)} text/math objects alive > {MAX_TEXT_ALIVE}")
    return out


def lint_dir(records_dir, design, fmt, allow_pairs=DEFAULT_ALLOW):
    """Every ``<scene>-layout.json`` in a records directory -> violations with a ``scene`` key."""
    rd = Path(records_dir)
    out = []
    for lf in sorted(rd.glob("*-layout.json")):
        scene = lf.name[: -len("-layout.json")]
        tf = rd / f"{scene}-trace.json"
        records = json.loads(lf.read_text(encoding="utf-8"))
        trace = json.loads(tf.read_text(encoding="utf-8")) if tf.exists() else None
        for x in violations(records, trace, design, fmt, allow_pairs):
            out.append({"scene": scene, **x})
    return out


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    allow = []
    while "--allow" in argv:
        i = argv.index("--allow")
        allow.append(tuple(argv[i + 1].split(",", 1)))
        del argv[i:i + 2]
    if len(argv) != 3:
        print("usage: python -m studio_manim.lint <records-dir> <design.json> <fmt> [--allow a,b ...]",
              file=sys.stderr)
        return 2
    rdir, dpath, fmt = argv
    design = json.loads(Path(dpath).read_text(encoding="utf-8")) if dpath and Path(dpath).exists() else {}
    res = lint_dir(rdir, design, fmt, tuple(allow) + DEFAULT_ALLOW if allow else DEFAULT_ALLOW)
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
