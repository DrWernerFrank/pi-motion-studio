# ADR-004 — The make runner: `studio make` relaunches pi until the project verifies (K10)

**Decision.** `studio make "<request>"` is a LOOP, not a command. It creates the project (the request
verbatim in `brief.md`), then relaunches `pi -p --session-id <key> @films/<key>/brief.md "Follow the
produce skill for the attached request."` until `studio project verify <key>` is green, a STOP file
appears, the minutes budget is gone, or the relaunch cap is hit. The runner is
`engine/produce/runner.mjs` (`makeRun` / `stopRun`); a thin `case 'make'` in engine/cli.mjs is the
whole CLI surface; the GUI's POST /api/make rides the same functions inside the job runner.

## S4 — what was measured first (the frozen pi interface)

Probes under `~/.cache/pi-motion-studio/scratch/w2-make/` (pi 2.x, `-p` pipe mode):

- `pi -p --session-id lead-s4-a "<msg>"` → exit **0** on success, and a bad flag exits non-zero with
  `Error: Unknown option: …` on stderr (s4-a/s4-b).
- `--session-id` **continues** a session: a second message under the same id answered "banana" from
  the first (s4-c/s4-same: `A=0 B=0`) — so ONE session id per project, reused across every relaunch.
- `@file` works: argv `@<path>` delivered the file's content ("The secret word in this attachment is
  MANGO." → the answer was MANGO; s4-file) — the request can travel by FILE, never by argv text.
- Two **concurrent** pi processes both exit 0 (s4-conc: `EXIT1=0 EXIT2=0 EXIT3=0`) — pi does not
  serialize itself, so the RUNNER must (the lock below).
- **SIGTERM** kills a run cleanly: the wrapper recorded `EXIT=0` from the killed child (s4-kill) —
  so `--stop` may SIGTERM the runner, whose handler TERMs its pi child and unwinds normally.

## The design

**Argv-only, request-by-file.** The request never travels through a shell string after creation:
pi's argv is exactly `['-p', '--session-id', <key>, '@films/<key>/brief.md', 'Follow the produce
skill for the attached request.']` — the request itself lives only in `brief.md`. A hostile request
(`"quotes"`, `` `backticks` ``, `$(rm -rf /)`) arrives verbatim in the brief and nothing expands
(the make check's leg c proves it against the fake-pi's logged argv).

**The key is the session id.** `make-` + a slug of the request's first ~4 significant words
(stopwords dropped, `[a-z0-9-]`, the whole key ≤ 24 chars, trailing words dropped to fit), `-2`,
`-3`… on a clash. One session id per project across relaunches is what makes iteration 2 remember
iteration 1 (S4): the loop is a conversation, not a queue of orphans.

**The loop** (per pi run, in order): spawn pi (argv above, cwd = repo root) → **account the
minutes** (below) → `--plan-only`? validate the plan in-process (`validatePlanFile`) and stop at
'plan-only' with no children built; otherwise **verify in-process** (`verifyProject` from
engine/produce/ship.mjs — no CLI subprocess, the same functions `studio project verify` uses);
green → **'verified'**. Not green → the stop conditions, in order: `films/<key>/STOP` or a repo-root
`STOP` → **'stopped-stop'**; the budget stop → **'stopped-budget'**; then relaunch. After
`STUDIO_MAKE_MAX_RUNS` (default 12) runs without green → **'stopped-cap'** (the cap named in the
reason, with the last verify problems). The result is
`{ key, iterations, outcome, reason?, logFile }`; every line lands timestamped in
`~/.cache/pi-motion-studio/logs/make-<key>.log`.

**The time accounting, once per pi run.** The fake provider costs $0 and `providerStatus('fake')`
is DISABLED by default (no key in .env + no STUDIO_BUDGET_USD — nothing is ever called), and a
disabled `budget.call()` returns `{ok:false, disabled}` WITHOUT logging. A run's minutes are still
real, so the runner appends the row itself — the same `calls[]` shape, `costUsd` always 0 — and
applies the same stops `call()` would: **soft at 80%** (outcome 'stopped-budget' with the wrap-up
note), **hard at 100%** (the same outcome, loudly). `spent_usd` never moves: the studio spends
nothing without permission. (With the provider enabled, `call()` itself logs and enforces.)

**One runner at a time.** `~/.cache/pi-motion-studio/make.lock` = `{pid, key, startedAt}`; a second
`makeRun` while a live pid holds it (or while this process runs one) **throws naming the other
run's key**; a dead pid is taken over loudly. `films/<key>/runner.pid` exists for the duration.
SIGINT/SIGTERM handlers TERM the pi child (a 5s SIGKILL fallback, armed only for THAT child), let
the loop unwind to outcome 'stopped', and the finally drops the pid file + the lock.

**--stop** (`stopRun`): SIGTERM every pid in `films/*/runner.pid` — each runner's own handler kills
its pi child and unwinds; stale pid files are cleaned; the lock goes when it names a stopped run.
Nothing running → a polite refusal. (stopRun never touches a live pid it cannot name.)

**STUDIO_PI_CMD** substitutes the pi binary — split on spaces, so `'node /abs/fake-pi.mjs'` works as
a wrapper. That is the ONLY seam tests use; the real path is `pi` on PATH.

## The fake-pi harness (`engine/produce/fake-pi.mjs`)

A Node script answering pi's interface without a model, driven by env:
`STUDIO_FAKE_PI_MODE=plan|build|fail|flaky|slow`, `STUDIO_FAKE_PI_SLEEP=ms` (sleeps first in ANY
mode — gives a test a window to seed a STOP file or a budget), `STUDIO_FAKE_PI_LOG=<jsonl>` (one
`{at, argv, mode, key}` row per invocation — the argv evidence the check reads).

- **plan** — writes a minimal VALID plan.json (one 6s motion segment, the project's formats, two
  alternatives including the simplest thing that could work, budget, deliverables — zero warnings,
  because verify pushes plan warnings into its whys) plus the matching requirement rows
  (duration 6s ±1s, formats, has-audio) via `ledger.addRequirements`.
- **build** — also builds the piece honestly, in-process: `kinds/project segment()` creates + links
  the child, a moving-circle index.html is written (a circle that never stops moving + a fading
  title — the motion gates pass on their own), then the child's OWN pipeline: `gridBeats`, the
  draft render + gates (the produce loop's build, through `segment()`), the synth soundtrack, the
  FINAL render (the deliverable `verify` needs), gates again, and `ensureFinals` (the
  single-wrapper copy into the project's out/). One render at a time: a pgrep guard waits while any
  other fake-pi is alive.
- **fail** — exit 1 (the cap/STOP/budget legs). **flaky** — fails once (a marker file), then
  behaves as build (the relaunch-recovers leg: verified after exactly 2 runs). **slow** — sleeps
  `STUDIO_FAKE_PI_SLEEP` then behaves as build (the concurrency leg).

Measured (this machine, WSL2/9p): one full build run ≈ 30–60s (a 360-frame 9:16 final renders in
~18s; gates ≈ 8s; sound ≈ 2s), the whole `verify-produce --only make` ≈ 2 min across 3 builds +
6 fast legs.

## Consequences

- The runner owns NO film content: every artifact comes from the real engines (kinds, audio,
  render, gates, ship) — the check's fixtures pass their gates honestly, never asserted.
- `--plan-only` is the cheap path (one pi run, no children) — a plan can be reviewed before any
  build cost is spent.
- The budget ledger is the runner's own accounting when the provider is disabled; enabling a real
  provider later means only adding it to `PROVIDERS` (K7) — `call()` then does the logging itself.
- The GUI rides `makeRun`/`stopRun` verbatim (one at a time → 409 on a second POST /api/make), and
  the runner is a child of the job runner, never of a request handler.
