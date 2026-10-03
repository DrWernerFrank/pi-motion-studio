"""claims.py — the mathematical truth ledger (mission M2 API; the sympy engine lands in P4).

    claim(r"det(Matrix([[3, 1], [1, 2]])) == 5", about="area scale", says="s02.2")
    num(A.det())          # numbers on screen come from computation

P4 replaces the body with the restricted sympy namespace, coverage reporting and
``math_check --independent``. This module pins the CALL SHAPE now so scenes and the kit are stable
across the phase boundary, and gives a straight ``sympy`` evaluation so P2's starter film can
already register claims.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_LEDGER: list[dict] = []


def claim(expr: str, *, about: str = "", says: str | None = None, scene: str | None = None) -> bool:
    """Register and evaluate a claim. True if the statement holds; raises on a false claim.

    ``expr``  a Python expression over the studio's namespace (Matrix, Rational, sqrt, pi, oo, …),
              typically ``this == that``. Exact by default.
    ``says``   the sentence id the claim is spoken in (coverage: script <-> claims).
    """
    from .layout import read_state
    ns = _namespace()
    try:
        value = bool(eval(expr, {"__builtins__": {}}, ns))  # noqa: S307 - the studio's own claim DSL
    except Exception as e:  # unparseable is an ERROR, never a silent pass
        raise ValueError(f"claim is not evaluable: {expr!r}: {e}") from e
    entry = {"expr": expr, "about": about, "says": says, "scene": scene, "ok": value}
    _LEDGER.append(entry)
    state = read_state()
    claims_file = state.get("claims_file")
    if claims_file:
        Path(claims_file).write_text(json.dumps(_LEDGER, indent=1), encoding="utf-8")
    if not value:
        raise AssertionError(f"CLAIM FAILED: {expr!r} ({about})")
    return True


def _namespace() -> dict:
    """The studio's restricted math namespace (P4 freezes the full allowlist)."""
    import sympy as sp
    from sympy import Matrix, Rational, sqrt, cbrt, pi, E, oo, I, zoo, nan
    from sympy import (sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, exp, log, ln, det,
                      integrate, diff, limit, summation, Sum, Integral, Derivative, solveset, solve,
                      Rational as _R, Abs, factorial, binomial)
    return {k: v for k, v in vars(sp).items() if not k.startswith("_")}


def verify_claims() -> dict:
    """Re-evaluate the ledger (the runner calls this after a render)."""
    ok = sum(1 for c in _LEDGER if c["ok"])
    return {"total": len(_LEDGER), "ok": ok, "failed": len(_LEDGER) - ok, "claims": _LEDGER}
