# ADR-002 — The project kind: one request, many parts (K3–K7)

**Decision.** `kind: "project"` is a film folder that WRAPS one request. `studio project new "<request>"`
creates `films/<key>/` with the request verbatim in `brief.md`, the machine files below, and no
`index.html` of its own (a project is produced through its children; a single-technique project is
a thin wrapper whose final is the child's final — K8, no re-encode).

```
films/<key>/
  film.json     { kind: "project", title, formats, request, parts: ["<key>-s01", …] }
  brief.md      the request VERBATIM, then "## Interpretation" (goal one line, constraints, assumptions)
  plan.json     K4 (validated by studio project plan --check)
  requirements.json  K5 — the ledger
  assets.json   K6 — licensed assets (id, path, sha256, origin, license, attribution, role)
  facts.json    K6 — { id, claim, source_url, quote, snapshot, retrieved_at } (quote must occur in the snapshot)
  budget.json   K7 — { minutes, usd, spent_usd, calls: [] }
  design.json   ONE design system for the whole piece; children inherit (palette, fonts, ladder, feel)
  inputs.json   the human's files: { id, path, sha256 } (read-only, referenced, never moved)
  sources/      snapshots of fetched pages/data (a fact's snapshot lives here)
  log.md        decisions, newest last (what changed and why, one line each)
  state.json    machine state: { phase, segments: { <id>: { status, film, outputs } } } — resumable
  reviews.json  the project's own critique rounds (producer-critic rounds land here)
  out/          final-<fmt>.mp4, poster, captions, credits.md, report.md
```

Children are real films of any kind at `films/<key>-<id>/` whose film.json carries `"parent": "<key>"`.
`studio project <sub>` manages the whole; `where` chains: a note pinned at project time t resolves to
the segment (plan.json's timeline), then to the child's own `where` (scene, sentence, file:line).

**The one-file-per-concern rule.** Every machine file has exactly one writer: plan.json is written by
the producer (an agent) and READ by the tools; requirements.json is appended by `project requirement`
(+ revisions with `source: "revision N"`); state.json is written ONLY by the build/ship tools (the
resume truth); log.md by everything (append-only). A tool that finds a file it does not own in a state
it did not write reports the conflict loudly instead of overwriting.

**Resume.** `state.json` is the truth: a segment that finished (finals exist + gates PASS recorded)
is never rebuilt unless its inputs changed (the rebuild diff). A killed run restarts from the first
unfinished segment; `project rebuild [--only <id>]` rebuilds exactly what a revision touches and
reports the part counts (the check asserts them).

**Ship.** `studio project ship` runs the project verifier first (K5: the plan validates, every
requirement green, gates PASS on the finals, assets/facts/credits clean, budget held, deliverables
probe clean) and refuses otherwise; then it publishes `out/` (finals from assembly or the single
child, poster, captions, credits.md, report.md).

## The plan schema (K4) — `plan.json`

```json
{ "version": 1, "goal": "one line", "audience": "…", "assumptions": ["…"],
  "deliverables": [{ "type": "video", "formats": ["16:9", "9:16"], "duration": 60, "name": "main" }],
  "decision": { "chosen": "composite|<single technique id>", "why": "…", "briefly": "…",
                "alternatives": [{ "id": "…", "rejected_because": "…" }],   // >= 2 incl. the simplest
                "probes": ["probes/p1-sheet.png"] },                        // required when risky
  "segments": [{ "id": "s01", "capability": "edit|motion|math|<grown>", "role": "cold open",
                 "brief": "…", "duration": 8, "inputs": ["input:i1", "asset:a1"],
                 "film": "<key>-s01", "acceptance": ["…"] }],
  "assembly": { "mode": "edit-film|direct|single", "transitions": "…", "audio": "one mix at mix.lufs" },
  "feasibility": { "blocked_inputs": [], "needs_capability": [] },
  "budget": { "minutes": 180, "usd": 0 }, "risks": ["…"] }
```

`studio project plan --check` rejects: no goal, no assumptions, a segment without capability /
acceptance / duration, fewer than two alternatives, no budget, no deliverables; flags over-scoping
(segment durations vs the deliverable target ±20%) and unknown capabilities (not in the catalog);
a risky choice (`risky: true` or an assembly of 3+ techniques) requires saved probe sheets.

## The requirements ledger (K5) — `requirements.json`

```json
[{ "id": "r01", "text": "60 seconds", "type": "measurable", "verifier": "duration",
    "arg": 60, "tolerance": 2, "source": "request", "status": "pending|green|red|waived",
    "evidence": "out/final-16x9.mp4: 60.0s", "waived_by": null },
  { "id": "r02", "text": "narrated", "type": "measurable", "verifier": "has-audio" },
  { "id": "r03", "text": "the teaser feels like their site", "type": "subjective",
    "critic": "producer-critic", "evidence": "round 2: fidelity 10, brand 9" }]
```

Types: `measurable` (a verifier from the library — one without fails loudly), `fact` (a facts.json
entry), `proof` (a math claim), `subjective` (passes ONLY with critic evidence: a review round with
the key scored 8+ and its sheets). `studio brief-lint` extracts numbers, formats, languages and
named assets from the request deterministically and flags any not mapped to a requirement (the
check runs it on 10 seeded requests). Only the human waives a requirement — `project requirement
--waive r02` records `waived_by: "human"`; any other source is refused.

**The verifier library** (`engine/produce/verify-lib.mjs`, ffprobe/ffmpeg-measured, no guessing):
duration, formats, resolution, loudness, has-audio, captions, language (ASR), safe-area, asset-used,
max-size. Each takes the project's finals + the arg and returns { ok, measured, why }.

## Facts, assets, budget (K6/K7)

- `facts.json`: verification is OFFLINE — the quote must occur in the stored snapshot (sources/).
  Rules: quote-in-snapshot passes; missing quote fails; missing snapshot fails; a hedged claim
  (carries `hedged: true` with the hedge text) passes as honest; an unsourced claim fails-unless-hedged.
- `assets.json`: no license → `ship` refuses. License parsing from Wikimedia Commons / NASA /
  Internet Archive API metadata (recorded fixtures; no live calls in checks). `out/credits.md`
  lists every attributed asset. The human's own files are attested by them (`origin: "human"`).
- `budget.json`: `minutes` soft-stops at 80% (wrap up with what exists), hard-stops at 100%;
  `usd` hard-stops. Cloud providers are opt-in (a key in .env + STUDIO_BUDGET_USD > 0; either missing
  → the provider reports disabled and is never called). Every call logs to budget.json. Nothing real
  is ever called in the checks — a fake provider exercises the guard.

## Why this shape

- The project is a FILM FOLDER (not a new top-level entity) so the GUI, the films list, notes, SSE
  watching and reviews all work unmodified; the project kind module + its `view: 'project.js'` give
  it its own tabs (Plan, Requirements, Assets, Facts, Log, Run).
- The ledgers are FILES, not a database: the producer (an agent) reads and appends them through the
  same tools the human can read; `project verify` is a pure function of the folder.
- One design.json flows into every child (K8): children read it via their own design load path; the
  child's create hooks take `design:` and may override ONLY what the plan names.
