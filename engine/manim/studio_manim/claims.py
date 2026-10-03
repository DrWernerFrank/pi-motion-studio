"""claims.py — the mathematical truth ledger (mission §3 constraint 3, M2 "Claims").

    claim("Matrix([[3, 1], [1, 2]]).det() == 5", about="area scale", says="s02.2")
    claim("sqrt(2) == 1.414", tol=1e-3, about="the decimal on screen")
    num(A.det())          # numbers on screen come from computation (typeset.num)

Every mathematical statement a film shows or says is a registered claim, evaluated EXACTLY with
sympy when the scene runs. A false claim raises ``AssertionError`` (the scene fails, the render is
blocked — loud, never silent); an expression that cannot be evaluated raises ``ValueError`` (an
ERROR: never a pass, never a "false claim").

The claim language
------------------
A Python expression over a RESTRICTED namespace — sympy names only, no builtins (``_NAMES`` is the
allowlist): Matrix, Rational, Integer, Float, sqrt, cbrt, pi, E, I, oo, zoo, nan, exp, log, ln,
sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, Abs, sign, floor, ceiling/ceil, factorial,
binomial, det, transpose, inverse, diff, integrate, limit, summation, product, solve, solveset, Sum,
Product, Integral, Derivative, Limit, simplify, expand, factor, trigsimp, radsimp, together, apart,
cancel, latex, N, srepr, symbols, Symbol, Eq, Ne, Lt, Le, Gt, Ge, And, Or, Not, im, re, conjugate,
gcd, lcm, prime, isprime, nextprime, div, Mod (and ``%``).
Pre-defined symbols (no ``symbols()`` call needed): ``x y z n k t h a b c A v f``.
The expression is checked before it runs (``_validate``): unknown names, ``_private`` attributes,
lambdas, comprehensions and assignments are rejected as not evaluable.

Truth
-----
A top-level single comparison is decided side by side:
  ``==``  exact — Matrices entrywise, symbolic sides by ``simplify(lhs - rhs) == 0`` (so
          ``sin(x)**2 + cos(x)**2 == 1`` holds); with ``tol=`` (absolute tolerance) the numeric
          difference must satisfy ``|N(lhs - rhs)| <= tol``.
  ``!=``  the negation of ``==``.
  ``< <= > >=``  sympy's own comparison; an undecidable one (free symbols) is NOT evaluable.
Anything else (chained comparisons, ``And``/``Or``, ``Eq(...)``) must evaluate to a boolean
(a still-symbolic relational gets one ``simplify``); a non-statement (``claim("5")``) is an error.

The ledger
----------
Each claim appends ``{expr, about, says, scene, ok, value[, tol][, error]}`` to the in-process
ledger, written to the runner's ``state.claims_file`` (records/<fmt>/<scene>-claims.json).
``merge_ledgers(records_dir)`` is the film-level ledger, ``coverage(sentences, ledger)`` the
script <-> claims link report, and ``python -m studio_manim.claims --independent ledger.json``
re-derives every claim from its text alone in a fresh process (mission M8).

Strict by default; a runner state with ``"claims_mode": "record"`` (draft) records a false claim
and continues with a warning on stderr. Unevaluable claims raise in every mode.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

_LEDGER: list[dict] = []

_NAMES = (
    "Matrix Rational Integer Float sqrt cbrt pi E I oo zoo nan exp log ln sin cos tan asin acos atan "
    "atan2 sinh cosh tanh Abs sign floor ceiling factorial binomial det transpose diff integrate limit "
    "summation product solve solveset Sum Product Integral Derivative Limit simplify expand factor "
    "trigsimp radsimp together apart cancel latex N srepr symbols Symbol Eq Ne Lt Le Gt Ge And Or Not "
    "im re conjugate gcd lcm prime isprime nextprime div Mod"
).split()
SYMBOLS = "x y z n k t h a b c A v f".split()

_ALLOWED_NODES = (
    ast.Expression, ast.Compare, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Call, ast.Attribute,
    ast.Name, ast.Constant, ast.Tuple, ast.List, ast.keyword, ast.Load, ast.Subscript, ast.Slice,
    ast.operator, ast.unaryop, ast.cmpop, ast.boolop,
)

_NS: dict | None = None


def _namespace() -> dict:
    """The studio's restricted math namespace: the ``_NAMES`` allowlist + the pre-defined symbols."""
    global _NS
    if _NS is None:
        import sympy as sp
        ns = {name: getattr(sp, name) for name in _NAMES if hasattr(sp, name)}
        ns["ceil"] = sp.ceiling
        ns["inverse"] = lambda M: sp.Matrix(M).inv()
        ns.update({s: sp.Symbol(s) for s in SYMBOLS})
        missing = [name for name in _NAMES if name not in ns]
        if missing:  # a sympy upgrade renamed something: fail at import, not in a scene
            raise ImportError(f"claims namespace: sympy lacks {missing}")
        _NS = ns
    return dict(_NS)


def _validate(tree: ast.AST, ns: dict) -> None:
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ValueError(f"{type(node).__name__} is not allowed in a claim")
        if isinstance(node, ast.Name) and node.id not in ns:
            raise ValueError(f"unknown name {node.id!r} (not in the claims namespace)")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError(f"private attribute {node.attr!r}")


def _run(node: ast.AST, ns: dict):
    code = compile(ast.Expression(body=node), "<claim>", "eval")
    return eval(code, {"__builtins__": {}}, ns)  # noqa: S307 - validated, builtin-free claim DSL


def _is_matrix(v) -> bool:
    from sympy.matrices import MatrixBase
    return isinstance(v, MatrixBase)


def _truth(v):
    """A sympy/Python boolean -> bool; anything still symbolic -> None (undecided)."""
    from sympy import Basic, simplify
    from sympy.logic.boolalg import BooleanAtom
    if isinstance(v, bool):
        return v
    if isinstance(v, BooleanAtom):
        return bool(v)
    if (isinstance(v, Basic) and v.is_Relational) or getattr(v, "is_Boolean", False):
        s = simplify(v)
        if isinstance(s, BooleanAtom):
            return bool(s)
    return None


def _equal(lhs, rhs, tol) -> bool:
    from sympy import Abs, Basic, N, simplify, sympify
    if tol is not None:
        try:
            d = sympify(lhs) - sympify(rhs)
        except Exception as e:
            raise ValueError(f"a tolerance claim needs numeric sides: {e}") from e
        if _is_matrix(d):
            vals = [N(Abs(e), 30) for e in d]
        else:
            vals = [N(Abs(d), 30)]
        if any(not val.is_number or val.free_symbols for val in vals):
            raise ValueError("a tolerance claim needs numeric sides (free symbols left)")
        return all(bool(val <= tol) for val in vals)
    if _is_matrix(lhs) or _is_matrix(rhs):
        if not (_is_matrix(lhs) and _is_matrix(rhs)) or lhs.shape != rhs.shape:
            return False
        return all(simplify(p - q) == 0 for p, q in zip(lhs, rhs))
    if isinstance(lhs, Basic) or isinstance(rhs, Basic):
        try:
            lhs, rhs = sympify(lhs), sympify(rhs)
        except Exception:
            return bool(lhs == rhs)
        if lhs == rhs:
            return True
        if getattr(lhs, "is_Boolean", False) or getattr(rhs, "is_Boolean", False):
            return False
        d = simplify(lhs - rhs)
        if d == 0:
            return True
        if not d.free_symbols and d.is_zero is True:
            return True
        return False
    return bool(lhs == rhs)  # lists (solve), tuples, plain Python values


def evaluate(expr: str, *, tol: float | None = None) -> tuple[bool, str]:
    """Decide a claim from its text alone (no ledger). Returns (ok, value); ValueError if not evaluable."""
    if not isinstance(expr, str) or not expr.strip():
        raise ValueError(f"claim is not evaluable: {expr!r}: empty")
    ns = _namespace()
    try:
        tree = ast.parse(expr.strip(), mode="eval")
        _validate(tree, ns)
        body = tree.body
        if isinstance(body, ast.Compare) and len(body.ops) == 1:
            lhs, rhs = _run(body.left, ns), _run(body.comparators[0], ns)
            op = body.ops[0]
            sym = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">",
                   ast.GtE: ">="}.get(type(op))
            if sym is None:
                raise ValueError(f"{type(op).__name__} is not a claim comparison")
            value = f"{_show(lhs)} {sym} {_show(rhs)}"
            if sym in ("==", "!="):
                eq = _equal(lhs, rhs, tol)
                return (eq if sym == "==" else not eq), value
            ok = _truth(_run(body, ns))
            if ok is None:
                raise ValueError(f"the inequality cannot be decided ({value})")
            return ok, value
        result = _run(body, ns)
        ok = _truth(result)
        if ok is None:
            raise ValueError(f"not a statement that evaluates to true/false (got {_show(result)})")
        return ok, _show(result)
    except ValueError as e:
        raise ValueError(f"claim is not evaluable: {expr!r}: {e}") from e
    except Exception as e:  # syntax, sympy errors, … — unparseable is an ERROR, never a pass
        raise ValueError(f"claim is not evaluable: {expr!r}: {type(e).__name__}: {e}") from e


def _show(v) -> str:
    s = str(v)
    return s if len(s) <= 200 else s[:197] + "..."


def claim(expr: str, *, about: str = "", says: str | None = None, scene: str | None = None,
          tol: float | None = None, strict: bool | None = None) -> bool:
    """Register and evaluate a claim. True if the statement holds; raises on a false claim.

    ``expr``   a statement over the claims namespace, typically ``this == that``. Exact by default.
    ``about``  what the claim means on screen (shown in the failure).
    ``says``   the sentence id the claim is spoken in (coverage: script <-> claims).
    ``tol``    absolute tolerance for a numeric ``==`` claim.
    ``strict`` None = the runner's ``claims_mode`` (default strict: a false claim raises).
    """
    try:
        from .layout import read_state
        state = read_state()
    except Exception:
        state = {}
    if scene is None:
        scene = (state.get("scene") or {}).get("id")
    entry = {"expr": expr, "about": about, "says": says, "scene": scene}
    if tol is not None:
        entry["tol"] = tol
    try:
        ok, value = evaluate(expr, tol=tol)
    except ValueError as e:
        entry.update(ok=None, value=None, error=str(e))
        _record(entry, state)
        raise
    entry.update(ok=ok, value=value)
    _record(entry, state)
    if not ok:
        msg = f"CLAIM FAILED: {expr!r} ({about}) evaluated as {value}"
        if strict is None:
            strict = state.get("claims_mode", "strict") != "record"
        if strict:
            raise AssertionError(msg)
        print(f"WARNING {msg} [claims_mode=record]", file=sys.stderr)
    return ok


def _record(entry: dict, state: dict) -> None:
    _LEDGER.append(entry)
    claims_file = state.get("claims_file")
    if claims_file:
        Path(claims_file).write_text(json.dumps(_LEDGER, indent=1), encoding="utf-8")


def verify_claims() -> dict:
    """Re-evaluate the in-process ledger from the expressions (the runner calls this after a render)."""
    rows = []
    for c in _LEDGER:
        try:
            ok, _ = evaluate(c["expr"], tol=c.get("tol"))
        except ValueError:
            ok = None
        rows.append({**c, "ok": ok})
    good = sum(1 for c in rows if c["ok"] is True)
    return {"total": len(rows), "ok": good, "failed": len(rows) - good, "claims": rows}


def merge_ledgers(records_dir) -> list[dict]:
    """The film-level ledger: every */*-claims.json under ``records_dir`` (one per format x scene),
    deduplicated by (expr, says). Deterministic order (sorted paths); a failing copy wins."""
    root = Path(records_dir)
    files = sorted(set(root.glob("*-claims.json")) | set(root.glob("*/*-claims.json")))
    merged: dict[tuple, dict] = {}
    for f in files:
        try:
            entries = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise ValueError(f"unreadable claims ledger {f}: {e}") from e
        for c in entries:
            key = (c.get("expr"), c.get("says"))
            if key not in merged or (merged[key].get("ok") is True and c.get("ok") is not True):
                merged[key] = c
    return list(merged.values())


_MATH_WORDS = re.compile(
    r"\b(equals|is|are|times|plus|minus|gives|becomes|adds|subtracts|multiplies|scales)\b", re.I)


def is_mathematical(text: str) -> bool:
    return bool(re.search(r"\d", text or "")) or bool(_MATH_WORDS.search(text or ""))


def coverage(sentences, ledger) -> dict:
    """Script <-> claims: which mathematical sentences (digit or equality word) a claim links to.

    ``sentences`` [{id, text}]; ``ledger`` claim entries whose ``says`` is a sentence id (or a list).
    Returns {mathematical: [ids], linked: [ids], unlinked: [ids], pct} (pct of mathematical linked).
    """
    said = set()
    for c in ledger:
        s = c.get("says")
        for sid in (s if isinstance(s, (list, tuple)) else [s]):
            if sid:
                said.add(sid)
    math_ids = [s["id"] for s in sentences if is_mathematical(s.get("text", ""))]
    linked = [i for i in math_ids if i in said]
    pct = round(100.0 * len(linked) / len(math_ids), 1) if math_ids else 100.0
    return {"mathematical": math_ids, "linked": linked,
            "unlinked": [i for i in math_ids if i not in said], "pct": pct}


def _independent(path: str) -> int:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    ledger = data.get("claims", []) if isinstance(data, dict) else data
    rows = []
    for c in ledger:
        try:
            ok, _ = evaluate(c["expr"], tol=c.get("tol"))
        except ValueError as e:
            ok, err = None, str(e)
        else:
            err = None
        row = {"expr": c["expr"], "ok": ok, "agrees": ok == c.get("ok")}
        if err:
            row["error"] = err
        rows.append(row)
    print(json.dumps(rows))
    return 0 if all(r["agrees"] for r in rows) else 1


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(prog="python -m studio_manim.claims")
    ap.add_argument("--independent", metavar="LEDGER", required=True,
                    help="re-evaluate every claim in LEDGER from its text alone; exit 0 iff all agree")
    sys.exit(_independent(ap.parse_args().independent))
