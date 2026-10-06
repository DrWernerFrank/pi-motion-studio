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

**D-003 2026-10-06 P1 — the naming migration is render-identical; one pre-migration file was stale.**
`studio migrate-names --all` renamed 29 derived paths (math films' `draft-16:9.mp4` → `draft-16x9.mp4`,
`records/16:9/` → `records/16x9/`, handoffs, the sheet paths inside reviews.json; tracked ones via
`git mv`, so history follows) plus the 262 tracked lint-fixture paths; `media/` and `x-*.json` untracked
+ ignored (173 + 3 files kept on disk). Zero raw-format path constructors remain (every site goes
through `fmtSlug`; the format IDS stay `16:9`). Proof: pre-migration final md5s were recorded
(`baseline/math-names-pre.md5`) before any rename; fresh re-renders reproduce 5/6 byte-identical.
The 6th — odd-squares `final-9:16` — was STALE ON DISK, not changed by the migration: its last review
(Round 22) was 13:40 but its mix/bed/timing were rebuilt at 16:14 by the math mission's final verify
run, and the file was never re-rendered after that, so it muxed an earlier audio state. Evidence the
fresh render is the correct one: the current pair is internally consistent (both formats mux the same
mix — byte-identical audio streams, `ffmpeg -map 0:a -f md5`), and a second re-render reproduces
`a06b4b79` exactly. Consequence: the naming check compares against a FROZEN post-migration ledger
(`baseline/math-names.md5`) and asserts re-render stability + audio-pair consistency — the durable
contract — rather than the one-off pre-migration comparison.

**D-004 2026-10-06 P1 — the registry's shape (ADR-001) and the two migration surprises.**
`engine/kinds/{motion,edit,math}/index.mjs` behind `engine/kinds/registry.mjs`: REQUIRED hooks are
own exports (a kind that inherits motion's render/look/gate/ship RE-EXPORTS them — the inheritance is
declared, not silent; the first load of the edit kind failed the validator exactly as designed and the
re-export is the fix), optional hooks fall back to motion's (the default kind: a film.json without
"kind" IS a motion film). `kindOf`/`requireKind` in lib/film.mjs are the only sanctioned raw readers
(the grep gate allows engine/kinds/** + that one file); every dispatch site (cli 8, render, stills,
ingest, server 2, math.mjs's guard, math-tools.ts's guard) now goes through the registry or those
helpers. `pickTimes`/`projectFps` became async (their kind hooks load modules) — no caller needed
them synchronously. Surprises: (1) `execFileSync().status` does not exist — execFileSync returns
stdout, so "is this path tracked/ignored" must use spawnSync or a try/catch (bit twice: naming.mjs's
tracked() and the naming check's gitIgnored); (2) the concurrent-render race: two renders of the same
film delete each other's scratch work dir mid-manim (FileNotFoundError from pathlib.cwd) — one render
at a time is a machine rule, not a suggestion (glm-worker's brief already says so).
Golden proof: `engine/produce/baseline.mjs --compare` → "baseline: identical" (transcripts + drafts +
regress; only wall-clock `<n>s` tokens normalized).

**D-005 2026-10-06 P1 — the baseline is re-captured at each phase's commit; the fmtDirs bug it caught.**
The P0 baseline (registry-migration proof: "baseline: identical" at 11:30, before any P1 feature)
stays recorded in git history; P1's own additions — `migrate-names`/`capabilities` in help, the
slugged math draft names — are INTENTIONAL drift, so the committed baseline is re-captured at P1's
commit and the registry check thereafter guards against unintended drift between commits. The
re-capture immediately caught a real bug the naming migration had introduced: `math-gates`'s
`fmtDirs()` returned raw DIRECTORY names (now `16x9`) while every gate compares against the RAW
format id (`16:9`), so `fmts.includes(fmt0)` was silently false and the typeset gate failed loudly
with "no records/16x9/ at all" on a film whose records existed. Fix: `fmtDirs` resolves the KNOWN
formats' slugged dirs and returns raw ids (the gates' messages already print `records/<slug>/`).
Swept the same class repo-wide: the records joins in verify/math/{demos,library,gui-smoke,where}
now slug the dir (the lint CLI's fmt ARG stays raw — it computes safe boxes); demos.mjs and
gui-security.mjs's raw film-kind reads became kindOf (same semantics, the sanctioned helper); the
grep gate targets the film-kind concept (`cfg.kind` reads + film-kind literals) so the dozens of
legitimate track/clip/source/trace `.kind === 'video'` reads do not trip it.

**D-006 2026-10-06 P2 — Working mode: the lead builds nothing big; subagents build.**
Per the human's change of mode (2026-10-06): the lead keeps decisions/ADRs, interface freezing
(SCHEMAS.md), shared-file integration (cli.mjs, verify-produce.mjs, index.ts BY_FILE, the registry,
README/AGENTS.md), all git commits, PROGRESS/DECISIONS, verifier runs, and <15-min fixes; everything
else goes to subagents. Constraints: max 3 concurrent, spawn only with >= 2 GB free, one
`verify-produce --only` at a time (retry after 60 s), nobody runs --clean/full verifies while
subagents are active, subagents never commit or run git state commands, never print the origin URL,
and never edit shared files (they report exact lines instead). Default worker glm-worker
(moreweb/glm-5.3-max — claude-bridge is rate-limited on this account; on a Claude rate-limit failure
respawn on GLM and note it). Reviews/critics run on a different agent+model than the builder; GLM
cannot see images (its read_image proxy uses the Claude quota — batch the looking). Every report is
verified by the lead (run the acceptance commands, read the diff, `studio regress` if engine files
changed) before any commit. The dispatch table lives in PROGRESS.md; interfaces in SCHEMAS.md.

**D-007 2026-10-06 P2 — the golden baseline caught a real engine bug: the edit mix was nondeterministic.**
Symptom: the registry check's transcript comparison drifted on edit.txt (-13.9 vs -14.1 LUFS across
two gold-film captures). Isolation (measured, scratch/w1 diagnostics): dialog.wav + music.wav were
byte-identical across two fresh films with the same source; the PREMIX (the
sidechaincompress+amix+afade chain over those exact files) gave 3 different md5s in 3 runs; the
same chain with `-filter_threads 1` gave 3 identical md5s, byte-equal to the last multithreaded run
— ffmpeg 8.0.1's sidechaincompress is run-to-run frame-scheduling-nondeterministic with multiple
filter threads (same audio result class, different bytes). Fix: `mixEdit` (and the audio-chain
check's two sidechain legs) pin `-filter_threads 1` (cost: nothing — one pass over seconds of
audio). Consequence: mix.wav is now a deterministic function of (dialog, music) — the golden
baseline's edit.txt is stable across captures, and the earlier missions' measured-loudness checks
are unaffected (they never compared mix bytes). This is the pattern the baseline exists for: an
intentional-drift re-capture surfaced an unintentional one.
