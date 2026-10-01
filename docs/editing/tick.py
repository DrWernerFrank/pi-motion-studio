#!/usr/bin/env python3
"""python3 docs/editing/tick.py P1 env fixtures  — tick phases (P#) and checks (ids) in PROGRESS.md; `Now:`/`Next:` via --now/--next."""
import re, sys
p = __file__.rsplit('/', 1)[0] + '/PROGRESS.md'; s = open(p).read(); a = sys.argv[1:]
now = nxt = None
if '--now' in a: i = a.index('--now'); now = a[i + 1]; a = a[:i] + a[i + 2:]
if '--next' in a: i = a.index('--next'); nxt = a[i + 1]; a = a[:i] + a[i + 2:]
for t in a:
    s = re.sub(rf"- \[ \] \*\*{re.escape(t)}\*\*", f"- [x] **{t}**", s) if re.fullmatch(r"P\d+", t) else re.sub(rf"- \[ \] `{re.escape(t)}`", f"- [x] `{t}`", s)
if now: s = re.sub(r"^Now:.*$", "Now: " + now, s, count=1, flags=re.M)
if nxt: s = re.sub(r"^Next:.*$", "Next: " + nxt, s, count=1, flags=re.M)
open(p, 'w').write(s)
