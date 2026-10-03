r"""typeset.py — one typesetting name, LaTeX in, mobject out (mission M2; ADR-002).

    Eq(r"\det\begin{pmatrix} a & b \\ c & d \end{pmatrix} = ad - bc")
    Eq("{{ad}} - {{bc}} = 5")           # named parts: .part("p1"), morphs match by label
    Txt("Area scales by five", role="body")
    num(A.det())                        # a computed number, never a typed one

The backend is Typst (``MathTypst``). ``tex2typst`` (npm) converts the LaTeX; this module shells it
per SEGMENT and caches. Labels are piecewise: ``{{ad}} - {{bc}}`` splits into segments, each segment
converts on its own, and the label becomes MathTypst's selection syntax ``{{ converted : name }}``.
No control-character placeholders (the first draft moved labels through conversion via NUL/SOH
markers — fragile and it never terminated: see git history; the bug report is the reason this file
is a single forward pass over the string).

Failure is loud: every path raises with the formula and the backend message, never a silent pass.
"""
from __future__ import annotations

import functools
import json
import os
import subprocess
from pathlib import Path

import warnings
from manim import logger, MathTypst, Text, register_font

logger.disabled = True  # noqa: B010  (the runner owns output; errors travel as exceptions)

# --- the converter (node + tex2typst, bundled under engine/manim/node) ----------------------
_CONVERT_JS = r"""
const { tex2typst } = require(process.env.TEX2TYPST_PATH);
const items = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = {};
for (const [k, tex] of Object.entries(items)) {
  try { out[k] = { ok: true, typst: tex2typst(tex) }; }
  catch (e) { out[k] = { ok: false, err: String(e && e.message || e) }; }
}
process.stdout.write(JSON.stringify(out));
"""


def _converter_js() -> str:
    here = Path(__file__).resolve().parent
    node_dir = here.parent / "node"
    idx = node_dir / "node_modules" / "tex2typst" / "dist" / "index.js"
    if not idx.exists():
        raise RuntimeError(
            "tex2typst not installed under engine/manim/node: run "
            "`npm install --prefix engine/manim/node tex2typst` (ADR-002)")
    return str(idx)


@functools.lru_cache(maxsize=4096)
def _to_typst(tex: str) -> str:
    """LaTeX math -> Typst math via the bundled tex2typst (one tiny node call, cached per segment)."""
    proc = subprocess.run(
        ["node", "-e", _CONVERT_JS], input=json.dumps({"f": tex}),
        capture_output=True, text=True, env={**os.environ, "TEX2TYPST_PATH": _converter_js()},
        timeout=30)
    if proc.returncode != 0:
        raise _TypesetError(tex, f"converter failed: {proc.stderr.strip()[:200]}")
    r = json.loads(proc.stdout)["f"]
    if not r["ok"]:
        raise _TypesetError(tex, f"converter: {r['err'][:200]}")
    return r["typst"]


class _TypesetError(ValueError):
    """A formula that will not typeset — carries the formula and the backend message."""

    def __init__(self, tex: str, why: str):
        super().__init__(f"typesetting failed for {tex!r}: {why}")
        self.tex, self.why = tex, why


def _label_end(tex: str, start: int) -> int:
    """Index of the ``}}`` that closes the label opened at ``start`` (``{{`` at start).

    Brace-AWARE: label content may nest ``{}`` (``{{\\text{area}}}`` — the first draft matched the
    ``\text``'s closing brace against the label's opener and chopped the formula). Depth counts
    inner braces; a ``}`` at depth 0 only closes the label if another ``}`` follows immediately.
    """
    i, depth = start + 2, 0
    while i < len(tex):
        c = tex[i]
        if c == "{":
            depth += 1
        elif c == "}":
            if depth == 0:
                if i + 1 < len(tex) and tex[i + 1] == "}":
                    return i
                raise _TypesetError(tex, f"unbalanced braces in a {{{{…}}}} label at {start} (a single }} at depth 0)")
            depth -= 1
        i += 1
    raise _TypesetError(tex, f"unterminated {{{{…}}}} label at {start}")


def _split_labels(tex: str) -> list[tuple[str, str | None]]:
    """Split on ``{{…}}`` spans: ``[("text", None), ("ad", "p1"), …]``.

    Single FORWARD pass, strictly bounded: each iteration consumes at least the braces it matched,
    so the scan position only advances (``pos = end + 2``) and the loop always terminates. (The
    first draft's ``while "{{" in out`` never re-tested a shrinking `out` and grew without bound
    — the OOM; see D-006.)
    """
    pieces: list[tuple[str, str | None]] = []
    pos = i = 0
    while True:
        start = tex.find("{{", pos)
        if start < 0:
            if pos < len(tex):
                pieces.append((tex[pos:], None))
            return pieces
        end = _label_end(tex, start)
        content = tex[start + 2:end].strip()
        if not content:
            raise _TypesetError(tex, f"empty {{{{}}}} label at position {start}")
        i += 1
        if start > pos:
            pieces.append((tex[pos:start], None))
        pieces.append((content, f"p{i}"))
        pos = end + 2


def _compose(tex: str) -> tuple[str, dict[str, str]]:
    """LaTeX with ``{{labels}}`` -> Typst with selection labels + the label map.

    Plain segments and label CONTENTS convert individually (cached); the label itself is emitted
    as ``{{ converted_content : name }}`` so Manim's ``.select(name)`` picks exactly that part.
    """
    out: list[str] = []
    labels: dict[str, str] = {}
    for content, name in _split_labels(tex):
        if name is None:
            conv = _to_typst(content) if content.strip() else content
            # pad: the converter sometimes strips spaces around symbols ("\\times" -> "times"),
            # and `}}times{{` could glue into one identifier. Typst math ignores padding.
            out.append(f" {conv} " if conv.strip() else conv)
        else:
            labels[name] = content
            out.append(f" {{{{ {_to_typst(content)} : {name} }}}} ")
    return "".join(out), labels


# --- the font-size contract ------------------------------------------------------------------
# Calibrated on this Manim (0.21, frame short side 8u): MathTypst(font_size=48) renders a simple
# ``x^2`` at ~0.72u of x-height — i.e. 48pt ≈ the 9u "math" ladder role. PT_PER_U is that ratio.
PT_PER_U = 48 / 9


def _font_size(role: str) -> float:
    from .theme import size_u
    return PT_PER_U * size_u(role)


def _color(role: str | None):
    if role is None:
        return None
    from .theme import color_for
    return color_for(role)


class Eq(MathTypst):
    """A typeset equation: LaTeX in, MathTypst mobject out.

    ``{{…}}`` marks a named part: ``Eq("{{ad}} - {{bc}} = 5").part("p1")``. Parts color via
    ``roles={"p1": "positive"}`` (design.json math.roles — one color per concept) or the whole
    equation via ``role=``. ``labels`` maps names to their LaTeX content (for morphs).
    """

    def __init__(self, tex: str, *, font_size: float | None = None,
                 roles: dict[str, str] | None = None, role: str | None = None, **kw):
        typst, labels = _compose(tex)
        from .theme import color_for
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # default color = the theme's INK (MathTypst's own default is white — on the paper
            # theme it was near-invisible; the first sheet caught it)
            super().__init__(typst, font_size=font_size if font_size is not None
                             else _font_size("math"), color=color_for("ink"), **kw)
        if role:
            self.set_color(color_for(role))
        if roles:
            for name, design_role in roles.items():
                part = self.part(name)
                part.set_color(_color(design_role))
        self.labels = labels

    def part(self, name: str):
        """The submobject group of one named part (``{{…}}`` -> p1, p2, … in order)."""
        g = self.select(name)
        if g is None or (hasattr(g, "submobjects") and not g.submobjects):
            raise KeyError(f"no part {name!r} in this Eq (labels: {sorted(self.labels)})")
        return g


class Txt(Text):
    """Typeset text through Pango at a design-ladder size, in a design font.

    KIT RULE: never wider than the safe area — a line that does not fit is SCALED to fit (the
    lint's `offscreen` rule would flag it otherwise; the first portrait sheet caught the s01 title
    running off both edges at the portrait type multiplier).
    """

    def __init__(self, text: str, *, role: str = "body", font: str | None = None,
                 font_size: float | None = None, color=None, **kw):
        from .theme import font_for, size_u
        from .layout import L
        family = font or font_for(role)
        c = color if color is not None else _color(role)
        file = font_path(family)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if file:
                with register_font(file):
                    super().__init__(text, font=family,
                                     font_size=font_size if font_size is not None
                                     else _font_size(role), color=c, **kw)
            else:
                super().__init__(text, font=family,
                                 font_size=font_size if font_size is not None
                                 else _font_size(role), color=c, **kw)
        if self.width > L.safe.w:
            self.scale_to_fit_width(L.safe.w * 0.98)


def font_path(family: str) -> str | None:
    """The studio's bundled TTF for a family name (engine/fonts), else None (system font).

    Self-verifying: walks up from this file until it finds the directory that holds ``fonts/``
    (engine/), so no ``parents[N]`` index can silently point somewhere else (it did, twice).
    """
    here = Path(__file__).resolve().parent          # …/engine/manim/studio_manim
    fonts = None
    for cand in [here, *here.parents]:
        if (cand / "fonts" / "Inter.ttf").exists():
            fonts = cand / "fonts"
            break
    if fonts is None:
        return None  # not run from the studio tree: the caller falls back to system fonts
    known = {
        "Inter": "Inter.ttf", "DM Sans": "DMSans.ttf", "Space Grotesk": "SpaceGrotesk.ttf",
        "Syne": "Syne.ttf", "Anton": "Anton.ttf", "Fraunces": "Fraunces.ttf",
        "Bricolage Grotesque": "BricolageGrotesque.ttf",
        "Instrument Serif": "InstrumentSerif-Regular.ttf",
        "Instrument Serif Italic": "InstrumentSerif-Italic.ttf",
        "JetBrains Mono": "JetBrainsMono.ttf",
    }
    rel = known.get(family)
    return str(fonts / rel) if rel else None


def num(x, *, places: int | None = None) -> str:
    """A computed number as typeset-ready text: never type a result by hand (mission §3.3).

    ``places`` rounds the VALUE (not the display): num(5.0) -> "5", num(1/3, places=3) -> "0.333".
    """
    f = float(x)
    if places is not None:
        f = round(f, places)
    if f == int(f):
        return str(int(f))
    return repr(f) if places is None else f"{f:.{places}f}"
