# Decisions

Format: `D-NNN  date  phase  decision / evidence / consequence`.

**D-001 2026-10-01 P0 — `determinant-explainer` is broken at baseline.** `films/determinant-explainer/index.html` is truncated mid-file
(9601 bytes, ends after a helper function, no shot list, no `film({...})` call), so its page never becomes ready. It predates this mission and
the mission forbids touching existing films' content. `docs/editing/baseline.json` records it as `broken` with the reason and `regress-films`
expects exactly that failure; if the film is ever completed, `studio regress --write` re-records it on purpose.

**D-002 2026-10-01 P0 — baseline uses the first format at scale 0.5.** Frame hashes are sha256 of the PNG from `__still(t)` at 8 times
(middle of each eighth, frame-aligned), first format, scale 0.5, plus every gate's verdict level (not its detail text, which carries
timestamps). Gate verdicts depend on local state (`out/mix.wav`, finals) which is gitignored; the baseline was taken on this machine's state.
`gates()` gained `write:false` so a comparison never rewrites a film's `gates.json`.

**D-003 2026-10-01 P0 — verify-edit result files.** `verify-last.json` is written only by a full run. `--only` writes `verify-last-only.json`
and `--quick` writes `verify-last.json` with `quick:true` and cannot pass (checks skipped by `--quick` count as not passing), so a partial run
can never be mistaken for done. Pending (unimplemented) checks count as failing. A skip is honest only for an environment cause.

**D-004 2026-10-01 P0 — check discovery.** Each check is `engine/verify/<id>.mjs` (default export `async (ctx) => { pass, measured, skip? }`);
the runner owns the table (`CHECKS` in `engine/verify-edit.mjs`: id, delivering phase, one-line criterion, slow flag). Later phases add a file,
never edit the runner.

**D-005 2026-10-01 P0 — unknown commands.** `studio <unknown>` prints help to stderr and exits 2; `studio`, `help`, `--help`, `-h` exit 0.
