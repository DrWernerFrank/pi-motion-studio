"""solver.py — deterministic label placement (mission M2, P3).

    place_labels(anchors, sizes, obstacles, max_distance, step=0.25) -> [(cx, cy), ...]

Greedy and deterministic: labels are placed in the order given. For each, candidate centers sit at
the 8 compass directions around its anchor (fixed order E, NE, N, NW, W, SW, S, SE — unit vectors)
at radii step, 2*step, 3*step … up to ``max_distance``; the first candidate whose box (center ± size/2,
grown by a 0.05 margin) overlaps no obstacle and no label already placed wins. The margin is the
lint's overlap tolerance, so a solved layout is lint-clean by construction. If no candidate fits, it
raises ``PlacementError`` naming the label and how many candidates it tried — never a silent
overlap. (The vector tags and area labels that collided in the Canvas determinant film are the reason.)

Units are Manim frame units; boxes are ``[x, y, w, h]`` (left/bottom corner), as in ``layout.json``.

CLI (for the layout-lint check):  python -m studio_manim.solver < case.json
  case: {"anchors": [[x,y]...], "sizes": [[w,h]...], "obstacles": [[x,y,w,h]...],
         "max_distance": d, "step": 0.25}
  prints {"ok": true, "positions": [[cx,cy]...]} or {"ok": false, "error": "...", "label": i}.
"""
from __future__ import annotations

import json
import math
import sys

MARGIN = 0.05
_D = math.sqrt(0.5)
DIRECTIONS = (  # E, NE, N, NW, W, SW, S, SE
    ("E", 1.0, 0.0), ("NE", _D, _D), ("N", 0.0, 1.0), ("NW", -_D, _D),
    ("W", -1.0, 0.0), ("SW", -_D, -_D), ("S", 0.0, -1.0), ("SE", _D, -_D),
)


class PlacementError(ValueError):
    def __init__(self, index: int, tries: int, why: str):
        super().__init__(f"label {index}: no position within reach after {tries} tries ({why})")
        self.index, self.tries = index, tries


def _hits(a, b) -> bool:
    """Boxes [x, y, w, h] intersect (open intervals: touching is not overlapping)."""
    return (min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]) > 0
            and min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]) > 0)


def label_box(center, size, margin: float = 0.0):
    (cx, cy), (w, h) = center, size
    return [cx - w / 2 - margin, cy - h / 2 - margin, w + 2 * margin, h + 2 * margin]


def place_labels(anchors, sizes, obstacles, max_distance, step=0.25):
    """Centers for each label (same order as ``anchors``), or raise ``PlacementError``."""
    if len(anchors) != len(sizes):
        raise ValueError(f"{len(anchors)} anchors but {len(sizes)} sizes")
    if step <= 0 or max_distance <= 0:
        raise ValueError("step and max_distance must be > 0")
    fixed = [list(map(float, o)) for o in obstacles]
    placed_boxes = []
    positions = []
    n_r = int(math.floor(max_distance / step + 1e-9))
    for i, ((ax, ay), size) in enumerate(zip(anchors, sizes)):
        tries, hit = 0, None
        for k in range(1, n_r + 1):
            r = k * step
            for _name, dx, dy in DIRECTIONS:
                tries += 1
                c = (ax + dx * r, ay + dy * r)
                if math.hypot(c[0] - ax, c[1] - ay) > max_distance + 1e-9:
                    continue
                box = label_box(c, size, MARGIN)
                if any(_hits(box, o) for o in fixed) or any(_hits(box, p) for p in placed_boxes):
                    continue
                hit = c
                break
            if hit:
                break
        if hit is None:
            raise PlacementError(i, tries, f"anchor ({ax:.3f}, {ay:.3f}), size {tuple(size)}, "
                                           f"max_distance {max_distance}, step {step}")
        positions.append((round(hit[0], 6), round(hit[1], 6)))
        placed_boxes.append(label_box(hit, size))  # the placed label itself (its margin is on the next)
    return positions


def main():
    case = json.load(sys.stdin)
    try:
        pos = place_labels(case["anchors"], case["sizes"], case.get("obstacles", []),
                           case["max_distance"], case.get("step", 0.25))
        print(json.dumps({"ok": True, "positions": [list(p) for p in pos]}))
    except PlacementError as e:
        print(json.dumps({"ok": False, "error": str(e), "label": e.index, "tries": e.tries}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
