# Producer mission progress

The mission: `templates/prompts/producer.md` (§7 = the checks, §5 = the build order). Working rules:
DECISIONS.md logs every judgment; after any restart read this file first and continue from the
first unchecked box. `Now:`/`Next:` at the bottom are kept current at all times.

## Phases

- [ ] P0 Orientation + baselines + `verify-produce` skeleton (all checks red)
- [ ] P1 Registry (K1), naming migration, hygiene, capability catalog (K2) — registry+catalog+naming DONE, checks landing
- [ ] P2 Project kind (K3), plan (K4), ledger (K5), facts/assets (K6), budget (K7), narration service (S3) — first vertical slice
- [ ] P3 Assembly (K8, spike S2)
- [ ] P4 Producer skill + routing (K9) + producer-critic (K11)
- [ ] P5 Entry points: `studio make` + runner (K10, spike S4), tools, GUI
- [ ] P6 Capability growth (K12)
- [ ] P7 Planning battery (12 briefs + independent references)
- [ ] P8 Hardening (failure matrix)
- [ ] P9 Demos (4 projects, reviews, final verify runs, FINAL_REPORT)

## Checks (§7 — `./studio verify-produce`, every one needs a file + green)

- [x] `env` — doctor reports pi on PATH (0.87.1) + capability readiness table (10/10 real probes) + runner prerequisites; P1 PASS
- [ ] `regress` — `studio regress` + both cheap verify subsets green for the whole mission (check file written; claims-driver path fix landed, re-run pending)
- [ ] `registry` — kinds are modules behind one registry; no raw `cfg.kind ===` outside `engine/kinds/`; golden transcripts + frame md5 == P0 baselines; missing hook fails loudly; seeded-fault docs check (check file written, re-run pending)
- [x] `naming` — 0 Windows-reserved chars in 684 tracked paths + under films/; math outputs `16x9`; 6/6 demo finals re-render byte-identical to the frozen ledger + audio-pair consistency; `media/` + `x-*.json` untracked — P1 PASS
- [x] `capabilities` — `studio capabilities --json` validates (10 entries); readiness from real probes; all 28 invoke commands in help; malformed entries rejected with their path — P1 PASS
- [ ] `services` — motion film + `script.md` → `timing.json` + narration bus at `mix.lufs`; math path byte-identical; captions/mix/capture callable from any kind's hooks
- [ ] `plan` — the validator rejects bad plans (goal, assumptions, capability, acceptance, reasons, <2 alternatives, budget, deliverables); accepts a valid one; flags over-scoping + unknown capabilities; risky choice needs saved probe sheets
- [ ] `ledger` — every verifier passes good media / fails bad media with a message; measurable w/o verifier fails loudly; subjective w/o critic evidence cannot pass; brief-lint flags all numbers/formats/languages/named assets of 10 seeded requests; a non-human waiver refused
- [ ] `facts` — quote-in-snapshot passes; missing quote/snapshot, hedged, unsourced handled by rule; verification offline
- [ ] `assets` — unlicensed asset blocks ship; license parsing (PD/CC0/CC-BY) from recorded fixtures; credits list every attributed asset; sha256 pins hold
- [ ] `budget` — no key / no STUDIO_BUDGET_USD → provider disabled and never called; both → called + logged; usd hard stop + minutes soft/hard stops fire; nothing real ever called
- [ ] `project` — `studio project new/status/list/plan/verify/rebuild/ship/where`; killed run resumes from state.json; note chains through segment to child `where`; revision appends requirements + rebuilds only touched parts; a child lists its parent
- [ ] `single` — projects wrapping one math / one motion / one edit film ship with the child's final unchanged; `project verify` passes
- [ ] `assemble` — composite fixture (math+motion+edit) 16:9 + 9:16: geometry, bt709, duration, A/V, loudness, no black/frozen join, PSNR per segment, design inheritance
- [ ] `skill` — `produce` skill + AGENTS.md "Start here" parse; 4 older skills defer; no duplicate "any video" trigger; the order/framework/one-question/revision/loop named
- [ ] `critic` — `producer-critic` parses, read-only, tools listed, 7 keys + fidelity + coherence, fidelity-10 rule present; `film_review` accepts the round
- [ ] `make` — `studio make` (fake pi): project created, request verbatim by file, loop relaunches until verify passes, stops on budget/STOP/cap, refuses concurrent run, survives quotes/backticks/`$(...)`; `--plan-only`; `--stop`
- [ ] `tools` — every `project_*` tool registered with a `Type.Object` schema in `BY_FILE`; each runs against a fixture project
- [ ] `gui-smoke` — Make dialog creates a project (fake pi); Plan/Requirements/Assets/Facts/Log tabs render; segments show status; children group; a note pins; a rebuild runs; 0 console errors, screenshots looked at
- [ ] `gui-security` — POST w/o token 403; oversized request, traversal/absolute attachment, concurrent run, unknown id refused; request never through a shell; nothing runs outside the job runner
- [ ] `growth` — `capability new` scaffolds; `capability check` refuses until parts exist, accepts when they do; appears in `capabilities` + plan menu; demo D's capability passes; removing a capability keeps the registry consistent
- [ ] `battery` — the 12 stored plans validate; >= 90% of each independent reference's requirements covered; capability sets in the reference's acceptable sets; missing inputs flagged; alternatives stated; no invented inputs
- [ ] `errors` — the P8 matrix fails loud with next steps; prompt injection changes nothing + noted in log.md; killed run + two simultaneous runs handled; partial output never promoted
- [ ] `docs` — `studio help` lists every command; README + AGENTS.md "Start here" + "## Producer"; skill, critic, CAPABILITIES.md, ADR-001..004, THIRD_PARTY.md exist; older doc checks still pass
- [ ] `hygiene` — after a full run no `verify-*` films, no stray root files, git status only intended, scratch empty, cache gc frees the new caches, no credential ever printed
- [ ] `demos` — 4 demo projects: finals in the asked formats, ledgers green, gates PASS, credits + report, facts sourced, assets licensed, spend zero
- [ ] `review` — each demo: >= 3 rounds, last by producer-critic, every score >= 8, fidelity = 10, sheets exist

## P9 final gates

- [ ] Full `./studio verify-produce` from a cold cache: `pass: true`
- [ ] Full `./studio verify-edit` in the background from the final tree (34 checks)
- [ ] Full `./studio verify-math` in the background from the final tree (27 checks)
- [ ] `docs/produce/FINAL_REPORT.md` written (<= ~60 lines)

Now: P1 — registry + catalog + naming done and green (env/naming/capabilities PASS); the registry check re-runs after the compare() fix; then commit P1 and tag slice-0.
Next: P2 (the project kind, plan, ledger, facts, assets, budget, narration service).
