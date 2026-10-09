# Producer mission progress

**Working mode: LEAD + SUBAGENTS (D-006).** The lead (this agent) decides, freezes interfaces,
integrates shared files (cli.mjs, verify-produce.mjs, index.ts BY_FILE, the registry, README/
AGENTS.md), runs verifiers, commits everything, keeps PROGRESS/DECISIONS; subagents build modules,
checks, GUI, skill, docs, fixtures and demos against `docs/produce/SCHEMAS.md`. Max 3 subagents at
once; spawn only with >= 2 GB free (free -m); one `verify-produce --only <id>` at a time (retry 60s);
nobody runs --clean/full verifies while subagents are active; subagents never commit or touch git.

The mission: `templates/prompts/producer.md` (§7 = the checks, §5 = the build order). Working rules:
DECISIONS.md logs every judgment; after any restart read this file first and continue from the
first unchecked box. `Now:`/`Next:` at the bottom are kept current at all times.

## Work plan (the lead's dispatch table)

| id | what | files owned (disjoint) | depends | acceptance | agent/model | status |
|---|---|---|---|---|---|---|
| W1-plan | plan validator + brief-lint checks | engine/produce/{plan,brief-lint}.mjs, engine/verify/produce/plan.mjs | — | `verify-produce --only plan` | glm-worker | **DONE 1057360** |
| W1-ledger | ledger + verifier library check | engine/produce/{ledger,verify-lib,asr-probe}.mjs, engine/verify/produce/ledger.mjs | — | `--only ledger` | glm-worker | **DONE 0d94d18** (died post-completion; work was on disk, lead verified) |
| W1-fab | facts + assets + budget checks (+ license fixtures) | engine/produce/{facts,assets,budget,fetch}.mjs, engine/produce/fixtures/**, engine/verify/produce/{facts,assets,budget}.mjs | — | `--only facts,assets,budget` | glm-worker | **DONE 951445e** |
| W1-svc | narration service check (motion+script.md) | engine/verify/produce/services.mjs (reports engine needs to lead) | — | `--only services` | glm-worker | **DONE 1fc1249** |
| W2-proj | project lifecycle: resume, where-chain, revision, child-parent; single-technique wrappers | engine/kinds/project/index.mjs, engine/produce/ship.mjs, engine/verify/produce/{project,single}.mjs | W1 | `--only project,single` | glm-worker | **DONE c6494d0** |
| W2-asm | spike S2 + assembly (edit-film assembler, design inheritance, PSNR/geometry) + ADR-003 | engine/produce/assemble.mjs, engine/verify/produce/assemble.mjs, docs/produce/ADR-003-*.md | W2-proj | `--only assemble` | glm-worker | **DONE 47aa82c** (2 timeouts; complete files verified by the lead) |
| W2-skill | produce skill + AGENTS/README sections (lead integrates) + producer-critic + checks | .pi/skills/produce/**, .pi/agents/producer-critic.md, engine/verify/produce/{skill,critic}.mjs | — | `--only skill,critic` | glm-worker | **DONE b2eec31** |
| W2-make | spike S4 + runner + studio make + fake-pi + make check + ADR-004 | engine/produce/runner.mjs, engine/verify/produce/make.mjs, docs/produce/ADR-004-*.md (cli wiring = lead) | SCHEMAS runner | `--only make` | glm-worker | **DONE cf42856** (died post-completion; verified) |
| W2-tools | project_* tools + tools check | .pi/extensions/motion-tools/project-tools.ts (BY_FILE = lead) | W2-proj | `--only tools` | glm-worker | **DONE a271650** |
| W3-gui | Make dialog + public/project.js + server endpoints + gui-smoke/gui-security | studio-gui/**, engine/verify/produce/{gui-smoke,gui-security}.mjs | W2-make (API frozen) | `--only gui-smoke,gui-security` | glm-worker + lead | **DONE 7e5dda0** (worker died at 7m; the lead finished: 2 real bugs found+fixed) |
| W3-grow | capability new/check scaffold + growth check | engine/produce/growth.mjs, templates/capability/**, engine/verify/produce/growth.mjs | K1/K2 | `--only growth` | glm-worker | **DONE 9843c1d** (w3-grow2, verified) |
| W3-bat | the 12-brief battery: fresh critics write references, then plans + check | engine/produce/battery/**, engine/verify/produce/battery.mjs | W2-skill | `--only battery` | fresh GLM critics + lead | **DONE 7a7527a** |
| W4-err | the failure matrix + errors check | engine/verify/produce/errors.mjs (+ small loud-failure fixes via lead) | all | `--only errors` | glm-worker | **DONE f79ae92** (2 timeouts; the file was complete — the lead verified) |
| W4-docs | docs check (help completeness, Producer sections) | engine/verify/produce/docs.mjs (README/AGENTS = lead) | W2 | `--only docs` | lead | **DONE except ADR-003** (00dd1c8; closes when w2-asm lands) |
| W4-hyg | hygiene check + cache gc for the new dirs | engine/verify/produce/hygiene.mjs (cache.mjs = lead) | W1+ | `--only hygiene` | lead | **DONE 00dd1c8** (found + fixed the gc fixture-deletion bug, the D-026 class's 4th path) |
| W5-demoA | demo A `composite`: clip + Pythagoras + end card, 50-70s, 16:9+9:16 | films/composite*/** | W2-asm, W2-skill | demos+review rows green | lead | **DONE c136aef** |
| W5-demoB | demo B `launch-teaser`: 25s vertical from GUI captures | films/launch-teaser*/** | W2 | same | lead | **DONE 8fe8f12** |
| W5-demoC | demo C `gps`: 60s narrated GPS explainer, sourced | films/gps*/** | W2 | same | lead | **DONE 29cd2e2** |
| W5-demoD | demo D `cities`: 30s animated top-10 cities chart (+ the grown capability) | films/cities*/**, engine/kinds/chart/ | W3-grow | same | lead | **DONE 5d47d14** |
| W5-rev | review check over the demos (3+ rounds, critic last, 8+, fidelity 10) | engine/verify/produce/review.mjs | W5 demos | `--only review` | lead + the critic runs | in flight (the critic rounds land, then the check) |
| lead | full verify-produce from cold cache; full verify-edit + verify-math (background); FINAL_REPORT | docs/produce/FINAL_REPORT.md | all | `pass: true` x3 | lead | todo |

## Phases

- [x] P0 Orientation + baselines + `verify-produce` skeleton (all checks red)
- [x] P1 Registry (K1), naming migration, hygiene, capability catalog (K2) — registry+catalog+naming DONE, checks landing
- [x] P2 Project kind (K3), plan (K4), ledger (K5), facts/assets (K6), budget (K7), narration service (S3) — first vertical slice
- [x] P3 Assembly (K8, spike S2)
- [x] P4 Producer skill + routing (K9) + producer-critic (K11)
- [x] P5 Entry points: `studio make` + runner (K10, spike S4), tools, GUI
- [x] P6 Capability growth (K12)
- [x] P7 Planning battery (12 briefs + independent references)
- [x] P8 Hardening (failure matrix)
- [x] P9 Demos (4 projects, reviews, final verify runs, FINAL_REPORT)

## Checks (§7 — `./studio verify-produce`, every one needs a file + green)

- [x] `env` — doctor reports pi on PATH (0.87.1) + capability readiness table (10/10 real probes) + runner prerequisites; P1 PASS
- [x] `regress` — `studio regress` + both cheap verify subsets green for the whole mission (check file written; claims-driver path fix landed, re-run pending)
- [x] `registry` — kinds are modules behind one registry; no raw `cfg.kind ===` outside `engine/kinds/`; golden transcripts + frame md5 == P0 baselines; missing hook fails loudly; seeded-fault docs check (check file written, re-run pending)
- [x] `naming` — 0 Windows-reserved chars in 684 tracked paths + under films/; math outputs `16x9`; 6/6 demo finals re-render byte-identical to the frozen ledger + audio-pair consistency; `media/` + `x-*.json` untracked — P1 PASS
- [x] `capabilities` — `studio capabilities --json` validates (10 entries); readiness from real probes; all 28 invoke commands in help; malformed entries rejected with their path — P1 PASS
- [x] `services` — W1-svc: motion+script.md -> timing.json + narration bus at -14 (math byte-identical, captions kind-agnostic) — DONE
- [x] `services` — motion film + `script.md` → `timing.json` + narration bus at `mix.lufs`; math path byte-identical; captions/mix/capture callable from any kind's hooks
- [x] `plan` — W1-plan: 24 seeded rejects + valid accepted + over-scope-as-error + probes demanded + brief-lint 10/10 — DONE
- [x] `plan` — the validator rejects bad plans (goal, assumptions, capability, acceptance, reasons, <2 alternatives, budget, deliverables); accepts a valid one; flags over-scoping + unknown capabilities; risky choice needs saved probe sheets
- [x] `ledger` — W1-ledger: 10/10 verifiers good+bad, subjective cannot-pass/can-pass, waiver rules, brief-lint 25 asks — DONE
- [x] `ledger` — every verifier passes good media / fails bad media with a message; measurable w/o verifier fails loudly; subjective w/o critic evidence cannot pass; brief-lint flags all numbers/formats/languages/named assets of 10 seeded requests; a non-human waiver refused
- [x] `facts` — W1-fab: offline rules all five legs — DONE
- [x] `facts` — quote-in-snapshot passes; missing quote/snapshot, hedged, unsourced handled by rule; verification offline
- [x] `assets` — W1-fab: 5 license fixtures parsed, pins hold, credits, unlicensed blocks ship — DONE
- [x] `assets` — unlicensed asset blocks ship; license parsing (PD/CC0/CC-BY) from recorded fixtures; credits list every attributed asset; sha256 pins hold
- [x] `budget` — W1-fab: disabled-by-default, usd+minutes stops, nothing real called — DONE
- [x] `budget` — no key / no STUDIO_BUDGET_USD → provider disabled and never called; both → called + logged; usd hard stop + minutes soft/hard stops fire; nothing real ever called
- [x] `project` — W2-proj: the full lifecycle (resume/revision/where/ship/subjective) — DONE
- [x] `project` — `studio project new/status/list/plan/verify/rebuild/ship/where`; killed run resumes from state.json; note chains through segment to child `where`; revision appends requirements + rebuilds only touched parts; a child lists its parent
- [x] `single` — W2-proj: 3 wrappers byte-identical (motion/edit/math), verify exit 0 — DONE
- [x] `single` — projects wrapping one math / one motion / one edit film ship with the child's final unchanged; `project verify` passes
- [x] `assemble` — W2-asm: S2 measured (direct = stream copy, PSNR inf); the composite fixture green on every K8 rule, both formats — DONE
- [x] `assemble` — composite fixture (math+motion+edit) 16:9 + 9:16: geometry, bt709, duration, A/V, loudness, no black/frozen join, PSNR per segment, design inheritance
- [x] `skill` — W2-skill: the produce skill + Start here + the 4 defer clauses + the any-video lint + all 11 body things — DONE
- [x] `skill` — `produce` skill + AGENTS.md "Start here" parse; 4 older skills defer; no duplicate "any video" trigger; the order/framework/one-question/revision/loop named
- [x] `critic` — W2-skill: producer-critic parses/read-only/9 keys/fidelity-10; addReview accepts — DONE
- [x] `critic` — `producer-critic` parses, read-only, tools listed, 7 keys + fidelity + coherence, fidelity-10 rule present; `film_review` accepts the round
- [x] `make` — W2-make: all 11 legs (build/verbatim/argv/clash/hostile/STOP/cap/budget/concurrency/plan-only/recovery) — DONE
- [x] `make` — `studio make` (fake pi): project created, request verbatim by file, loop relaunches until verify passes, stops on budget/STOP/cap, refuses concurrent run, survives quotes/backticks/`$(...)`; `--plan-only`; `--stop`
- [x] `tools` — W2-tools + the lead's BY_FILE wiring: 7 tools, live flow green — DONE
- [x] `tools` — every `project_*` tool registered with a `Type.Object` schema in `BY_FILE`; each runs against a fixture project
- [x] `gui-smoke` — the lead: tabs/nesting/note/job/Make-with-real-build, 0 errors, screenshots looked at — DONE
- [x] `gui-smoke` — Make dialog creates a project (fake pi); Plan/Requirements/Assets/Facts/Log tabs render; segments show status; children group; a note pins; a rebuild runs; 0 console errors, screenshots looked at
- [x] `gui-security` — the lead: 403s/4xx/caps/409 + structural (no shell, request-by-file) — DONE
- [x] `gui-security` — POST w/o token 403; oversized request, traversal/absolute attachment, concurrent run, unknown id refused; request never through a shell; nothing runs outside the job runner
- [x] `growth` — W3-grow2: scaffold refuses naming every stub; verify-chart honest (data+axis gates); the menu grows; removal consistent — DONE
- [x] `growth` — `capability new` scaffolds; `capability check` refuses until parts exist, accepts when they do; appears in `capabilities` + plan menu; demo D's capability passes; removing a capability keeps the registry consistent
- [x] `battery` — 12 plans vs 12 fresh-eye references: 100% coverage, sets honest, flags exact, nothing invented — DONE
- [x] `battery` — the 12 stored plans validate; >= 90% of each independent reference's requirements covered; capability sets in the reference's acceptable sets; missing inputs flagged; alternatives stated; no invented inputs
- [x] `errors` — W4-err: all 13 matrix cases loud with next steps; the injection changed nothing — DONE
- [x] `errors` — the P8 matrix fails loud with next steps; prompt injection changes nothing + noted in log.md; killed run + two simultaneous runs handled; partial output never promoted
- [x] `docs` — the lead: help/Start-here/Producer/CAPABILITIES-current/THIRD_PARTY + the older docs checks green (ADR-003 leg closes with w2-asm)
- [x] `docs` — `studio help` lists every command; README + AGENTS.md "Start here" + "## Producer"; skill, critic, CAPABILITIES.md, ADR-001..004, THIRD_PARTY.md exist; older doc checks still pass
- [x] `hygiene` — the lead: no litter/strays/protected-edits, scratch swept, gc lists the new caches + spares the fixture, 0 credential leaks in 76 files — DONE
- [x] `hygiene` — after a full run no `verify-*` films, no stray root files, git status only intended, scratch empty, cache gc frees the new caches, no credential ever printed
- [x] `demos` — 4 demo projects: finals in the asked formats, ledgers green, gates PASS, credits + report, facts sourced, assets licensed, spend zero
- [x] `review` — each demo: >= 3 rounds, last by producer-critic, every score >= 8, fidelity = 10, sheets exist

## P9 final gates

- [x] Full `./studio verify-produce` from a cold cache: `pass: true`
- [x] Full `./studio verify-edit` in the background from the final tree (34 checks) — 34/34 PASS (74 min, 9d28918), the D-013 fixes green in context
- [x] Full `./studio verify-math` in the background from the final tree (27 checks) — 27/27 PASS (33 min, c380c50) after the D-014/D-015 fixes (one a REAL product bug: the blank math video pane)
- [x] `docs/produce/FINAL_REPORT.md` written (<= ~60 lines)

Now: 17 of 28 checks green and committed (wave 1 + skill/critic + project/single + tools + services + the P1 five + registry). In flight: w2-make2 (the runner; the first worker died mid-spike — its S4 findings were handed to the respawn). The lead's own fixes landed meanwhile: D-007 (the nondeterministic edit mix), AGENTS.md Start here, README Producer, the BY_FILE wiring, cli --arg JSON parsing.
Now: verify-edit 34/34 (9d28918), verify-math 27/27 (c380c50) — and the naming check of the
final verify-produce caught a REAL engine bug: PyAV's sliced-thread x264 partial encodes made
odd-squares' 9:16 final different on every cold render. Root-caused layer by layer (cairo OK,
records OK, partials ~100k scattered byte diffs, 5 seam frames moved), FIXED in the kit (partial
encoders pinned to thread_count=1; proven: identical partials, identical cold finals, tangent
spot-checked), the migration ledger honestly re-frozen (D-016, 3d3daa4), naming PASS. The final
verify-math + verify-produce chain is RUNNING from 3d3daa4; after it: FINAL_REPORT's last lines,
the final commit, done.
Next: poll the chain -> on green write the report's tail -> final commit -> mission completeNow: THE MISSION IS COMPLETE. From the final tree (ef48d1d): verify-produce 28/28 pass:true
(0 failed, 0 skipped, 1154s) · verify-edit 34/34 (63 min) · verify-math 27/27 (30 min, third green
run) · every PROGRESS box ticked · the four demos at the critic bar (every key 8+, fidelity 10) ·
FINAL_REPORT.md written. The tail beyond the 95% estimate found and fixed, at the right layer,
with evidence: D-013 (two check races), D-014 (five checks on pre-migration colon paths), D-015
(five gui-smoke faults, one a REAL product bug — the blank math video pane), D-016 (a REAL engine
nondeterminism: PyAV's sliced-thread partial encodes, root-caused layer by layer, fixed with a
one-thread pin, the golden baseline + migration ledger honestly re-frozen).
Next: nothing — done. (After the report, stop: no new features.)