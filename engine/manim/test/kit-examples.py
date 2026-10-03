"""kit-examples.py — every ```python block in engine/manim/kit.md runs (mission P7, the `library` proof).

    cap 300 <manim-venv>/bin/python engine/manim/test/kit-examples.py [--format 9:16]

Each block runs in a FRESH namespace with ``scene`` = a StudioScene in manim's dry-run mode (no video
written; ``scene.play`` still begins, interpolates and cleans up every animation, so a broken
transition fails here). One line per block: ``ok <component>``, ``SKIP <component> (reason)`` when the
block set ``SKIP = "reason"``, or ``FAIL <component>: <error>``. Exit 0 only when nothing failed.
Run it under the 1 GB cap (D-006/D-007).
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT_MD = HERE.parent / "kit.md"


def blocks(md: str) -> list[tuple[str, str]]:
    """[(component heading, code)] — the nearest ``### heading`` above each ```python block."""
    out, head = [], "?"
    for m in re.finditer(r"^### ([^\n]+)$|^```python\n(.*?)^```", md, re.M | re.S):
        if m.group(1):
            head = m.group(1).strip()
        else:
            out.append((head, m.group(2)))
    return out


def main() -> int:
    fmt = "16:9"
    if "--format" in sys.argv:
        fmt = sys.argv[sys.argv.index("--format") + 1]
    os.environ["STUDIO_FORMAT"] = fmt
    os.environ.setdefault("STUDIO_RECORDS_DIR", tempfile.mkdtemp(prefix="kit-examples-"))
    sys.path.insert(0, str(HERE.parent))

    from manim import config
    config.dry_run = True                    # nothing written to disk
    config.progress_bar = "none"
    config.pixel_width, config.pixel_height = (160, 90) if fmt == "16:9" else (90, 160)
    config.frame_rate = 5
    from studio_manim import StudioScene

    found = blocks(KIT_MD.read_text(encoding="utf-8"))
    if not found:
        print("FAIL kit.md: no ```python blocks")
        return 1
    failed = 0
    for name, code in found:
        t0 = time.time()
        ns = {"__name__": f"kit_example_{name}", "scene": StudioScene()}
        try:
            exec(compile(code, f"kit.md:{name}", "exec"), ns)  # noqa: S102 — our own docs
        except Exception as e:  # noqa: BLE001
            failed += 1
            tb = traceback.extract_tb(e.__traceback__)[-1]
            print(f"FAIL {name}: {type(e).__name__}: {e} (line {tb.lineno} in {tb.filename})")
            continue
        if ns.get("SKIP"):
            print(f"SKIP {name} ({ns['SKIP']})")
        else:
            print(f"ok {name}  ({time.time() - t0:.1f}s)")
    print(f"{len(found)} blocks, {failed} failed ({fmt})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
