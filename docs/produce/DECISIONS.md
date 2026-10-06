# Decisions

Format: `D-NNN  date  phase  decision / evidence / consequence` (mirrors `docs/math/DECISIONS.md`).

**D-001 2026-10-06 P0 — branch and baseline.** `feat/producer` from `origin/main` (70930e4, the merge of
both earlier missions; local `main` is stale and untouched). Baselines captured in P0 under
`docs/produce/baseline/`: `studio regress` output, golden CLI transcripts (help + list), one draft
render per kind with its md5 (motion `studio-reel`, edit `demo-cut`, math `mathdemo`), and the two cheap
verify subsets. The registry refactor (K1) must reproduce all of these byte-for-byte (transcripts modulo
time fields). The human's modified `templates/prompts/run-until-done.sh` (producer wiring, uncommitted
upstream) is kept as delivered and committed on this branch with the mission.

**D-002 2026-10-06 P0 — verify-produce mirrors the two earlier runners.** Same conventions as
verify-math/verify-edit (their D-002/D-003/D-004): checks in `engine/verify/produce/<id>.mjs`
(default export `async (ctx) => { pass, measured, skip? }`), a check with no file is `pending` = red,
`--quick` skips `slow` checks and can never pass, `--only` writes `verify-last-only.json`, a full run is
the only thing that writes `"pass": true`, one lock (`produce-verify.lock`), temp films `films/verify-p-*`
swept at end-of-run with the mtime + git-tracked guards (the third-sweep rule, math D-029/D-026).
`regress` runs before every check that creates films (the spawned sweeps). Slow set is a first guess
(marked per check), frozen with measured runtimes later.
