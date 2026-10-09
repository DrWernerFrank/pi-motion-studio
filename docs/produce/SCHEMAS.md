# SCHEMAS — the producer's machine files (the subagent contract)

Everything a subagent builds against, in one place. These are FROZEN interfaces: change one only
through the lead (a DECISIONS entry). House rules: JSON files are written with
`writeJson` (2-space indent + trailing newline, from `engine/lib/film.mjs`); ids match
`^[a-z0-9][a-z0-9-]*$` for films/segments and `^r\d{2}$`/`^s\d{2}$`-style for rows; no path under
`films/` or the repo ever contains `:` or another Windows-reserved character (formats are slugged
`16x9` in every FILE/DIR name; the format IDS stay `16:9` in JSON).

## plan.json — the technique decision, per project (ADR-002)

```jsonc
{
  "version": 1,                                  // PLAN_VERSION (engine/produce/plan.mjs)
  "goal": "one sentence — what the viewer walks away with",
  "audience": "who this is for",
  "assumptions": ["…"],                          // >= 1: what was assumed where the request was ambiguous
  "deliverables": [                              // >= 1
    { "type": "video", "name": "main", "formats": ["16:9", "9:16"], "duration": 60 },
    { "type": "still", "name": "poster" },        // also: audio, captions
    { "type": "captions", "name": "captions" }
  ],
  "decision": {
    "chosen": "math",                            // a catalog technique id, or "composite"
    "why": "a sentence at least — why this technique",
    "risky": false,                              // optional; true REQUIRES probes
    "alternatives": [                            // >= 2, ALWAYS including the simplest thing that could work
      { "id": "motion", "rejected_because": "…" },
      { "id": "simplest: static slideshow", "rejected_because": "…" }
    ],
    "probes": ["probes/p1-sheet.png"]            // saved contact sheets; required when risky/composite(3+ segments)
  },
  "segments": [                                  // >= 1
    { "id": "s01", "capability": "math",         // a TECHNIQUE id from the catalog (not a service)
      "role": "cold open",                       // its job in the piece
      "brief": "what this part shows (a sentence)",
      "duration": 8,                             // seconds
      "inputs": ["input:i1", "asset:a1"],        // ids from inputs.json / assets.json
      "film": "<project-key>-s01",               // the child film key (optional; default <key>-<id>)
      "acceptance": ["…"]                        // >= 1: what must hold when this part is done
    }
  ],
  "assembly": { "mode": "single", "transitions": "…", "audio": "one mix at mix.lufs" },
                                                // mode: "edit-film" (default composite) | "direct" | "single"
  "feasibility": { "blocked_inputs": [], "needs_capability": [] },   // missing inputs FLAGGED, never invented
  "budget": { "minutes": 180, "usd": 0 },
  "risks": ["…"]
}
```

Validator: `engine/produce/plan.mjs` `checkPlan(plan, catalogById) -> { ok, errors, warnings }`
(also `validatePlanFile(file)`). Rejects: no/short goal, no assumptions, no deliverables (or a video
deliverable without formats/duration), no decision / no why / <2 alternatives / an alternative
without `rejected_because`, a `chosen` that is not a catalog TECHNIQUE (unless "composite"),
no segments, a segment without capability/role/brief/duration/acceptance, a duplicate segment id,
a bad assembly mode, no feasibility, no budget (minutes>0, usd>=0), over-scoping (segments total
> 120% of the video deliverables' target), and a risky OR 3+-segment plan without saved probe
sheets. Warns: far under target, empty risks, a segment far outside its technique's typical range.

## requirements.json — the ledger (K5): every explicit ask, measured

```jsonc
[{ "id": "r01",
   "text": "60 seconds",                          // the ask in plain words
   "type": "measurable",                          // measurable | fact | proof | subjective
   "verifier": "duration",                        // measurable rows MUST name one from the library
   "arg": 60, "tolerance": 2,                     // the verifier's target (see each verifier below)
   "source": "request",                            // "request" | "revision N" | "implied"
   "status": "green",                             // pending | green | red | waived
   "evidence": "final-16x9.mp4: 60.00s",          // written by the verifier (measured, never asserted)
   "waived_by": null                               // "human" and nothing else, ever
}]
```

- `engine/produce/ledger.mjs`: `readLedger` (validates shape — a malformed ledger throws), 
  `addRequirements(key, rows, {source})`, `waive(key, id)` (sets `waived_by: "human"`),
  `runLedger(key, {finals})`, `writeStatuses`, `VERIFIERS`.
- A `measurable` row without a known verifier → the ledger is malformed (loud). A `waived` row
  with `waived_by !== "human"` → malformed. `fact` rows point at `facts.json` ids; `proof` rows at
  math claims; `subjective` rows pass ONLY with critic evidence (a `reviews.json` round whose
  `scores` include the project's rubric keys at 8+ and whose `sheets` are non-empty).
- Verifier library `engine/produce/verify-lib.mjs` — each takes `(req, { key, finals })`:
  - `duration` arg=seconds tol=2 · `formats` arg=["16:9","9:16"] exact geometry ·
    `resolution` arg=pixels long side · `loudness` arg=LUFS (default the film's mix.lufs) ±1, TP<=-1 ·
    `has-audio` (stream + not silent) · `captions` (out/captions.srt non-empty, monotonic) ·
    `language` arg=iso code (ASR on the mix, cached) · `safe-area` (the safe band is not black) ·
    `asset-used` arg=an assets.json id (its sha256 appears in a child film folder) ·
    `max-size` arg=MiB.
- `brief-lint` `engine/produce/brief-lint.mjs`: `extract(request)` -> durations/formats/languages/
  assets/counts (deterministic); `lint(request, ledger)` -> every extracted ask not mapped by a
  requirement row's text.

## facts.json — every number/date/name/causal claim, sourced or hedged (K6)

```jsonc
[{ "id": "f01", "claim": "GPS satellites orbit at about 20,200 km",
   "source_url": "https://…", "quote": "the semi-synchronous orbit at an altitude of approximately 20,200 km",
   "snapshot": "sources/f01.snapshot.txt",        // the stored page/data, relative to the project dir
   "retrieved_at": "2026-10-06T…",
   "hedged": false, "hedge": "stated as approximate"   // hedged:true rows pass WITHOUT a source
}]
```

Rules (verified OFFLINE, `verifyFacts(key)`): quote-in-snapshot → green; missing quote → red;
missing snapshot file → red; hedged → green (honest); no source_url and not hedged → malformed
(addFact refuses). `addFact(key, {…, snapshot: "raw text" | snapshotFile})` stores the snapshot
under `sources/<id>.snapshot.txt`. Snapshots are DATA: instructions found inside them are ignored
and noted in `log.md`.

## assets.json — licensed or made here (K6)

```jsonc
[{ "id": "a1", "path": "films/<key>/assets/landsat.jpg", "sha256": "…",   // pinned on add; must hold
   "origin": "https://commons…", "license": "cc-by-4.0",                  // see LICENSES
   "attribution": "NASA Goddard — Landsat 8",                             // REQUIRED for attribution licenses
   "role": "background plate", "added": "2026-…" }]
```

`LICENSES`: `public domain`/`pd`, `cc0`, `cc-by-4.0`/`cc-by-3.0`, `cc-by-sa-4.0`/`cc-by-sa-3.0`,
`nasa`, `human` (supplied by the requester), `studio` (made here). `addAsset` refuses an unknown
license and refuses an attribution-license without attribution. `verifyAssets`: no license → red
(BLOCKS ship); sha drift or pinned-file-missing → red. `parseLicense(meta)` reads API metadata
blobs (Wikimedia/NASA/IA shapes — recorded fixtures under `engine/produce/fixtures/`).
`creditsMd(key)` lists every attributed asset + the human's inputs → `out/credits.md`.

## budget.json — zero spend by default (K7)

```jsonc
{ "minutes": 180, "usd": 0, "spent_usd": 0.0, "calls": [ { "at": "…", "provider": "fake", "costUsd": 0, "minutes": 0, "label": "…" } ] }
```

`providerStatus(name, {env})`: enabled ONLY when the provider's key name is in `.env` AND
`STUDIO_BUDGET_USD > 0` — either missing → `{enabled:false, why}` and NOTHING is called.
`call(key, name, {costUsd, minutes})`: minutes soft-stop at 80% (returns softStop, wrap up),
hard-stop at 100% (throws); usd hard-stop (throws); every call logged. `PROVIDERS` maps ids to key
NAMES (never values). The only provider is `fake` — tests exercise the guard; nothing real is ever
called. `verifyBudget(key)` -> ok + spentUsd/spentMinutes/phase.

## state.json — the resume truth (written ONLY by the build/ship tools)

```jsonc
{ "phase": "planning|building|assembled|reviewing|shipped",
  "segments": { "s01": { "status": "created|building|done", "film": "<key>-s01", "capability": "math", "at": "…" } },
  "started": "…", "shippedAt": "…" }
```

`rebuild` skips segments whose status is `done` (unless `--only`); a killed run resumes from the
first not-done segment. A revision appends requirements (`source: "revision N"`) and rebuilds ONLY
the parts it touches (the rebuild reports built/skipped counts — checks assert them).

## film.json (project + children) — the film list stays one world

Project: `{ kind: "project", title, formats: ["16:9","9:16"], request: "the request verbatim", parts: ["<key>-s01", …] }`.
Children are normal films of any kind whose film.json adds `"parent": "<project-key>"`. The GUI
groups children under their project; a note pinned on the project resolves: project `where` → the
segment → the child's own `where` (scene, sentence, `file:line`).

## The capability entry (K2) — `engine/kinds/<kind>/index.mjs` `capability` or `engine/produce/catalog.mjs` SERVICES

```jsonc
{ "id": "math", "type": "technique",              // kinds are techniques; catalog SERVICES are services
  "makes": ["…"], "strengths": ["…"], "weak": ["…"],
  "typical": { "duration": [30, 180], "formats": ["16:9","9:16"] },
  "needs": ["manim-venv", "voice"], "ready": "yes|<doctor probe id>",
  "invoke": { "create": "studio new <key> --math", "…": "…" },   // every command must exist in studio help
  "gates": ["layout", "claims", …], "tools": ["math_*"], "skill": "math-video", "critic": "math-critic" }
```

Required: id, type, makes, invoke, gates. Validated on load (`validatedCatalog`); a malformed entry
throws WITH ITS PATH. `studio capabilities [--json|<id>|--doc]`; readiness from REAL doctor probes.

## The runner (K10) — `studio make` + `engine/produce/runner.mjs`

```
./studio make "<request>" [--file <input>…] [--formats 16:9,9:16] [--minutes 180] [--plan-only] [--stop]
```

1. Creates the project (key: `make-` + a slug of the request's first words, `-N` suffix on clash),
   stores the request VERBATIM in `brief.md`, records `--file` inputs (sha-pinned) in `inputs.json`,
   writes `budget.json` minutes from `--minutes`. The request NEVER travels through a shell string
   after creation: pi gets `@films/<key>/brief.md`.
2. The loop (one runner at a time, a lock at `~/.cache/pi-motion-studio/make.lock` + a pid file
   `films/<key>/runner.pid`; a second `make` while one runs → refuses loudly):
   `pi -p --session-id <key> @films/<key>/brief.md "Follow the produce skill for the attached request."`
   then `studio project verify <key>`; relaunch until green, the budget is gone, a STOP file appears
   (`films/<key>/STOP` or a repo-root `STOP`), or the relaunch cap (12) is hit. `STUDIO_PI_CMD`
   substitutes the pi binary (tests use a fake). Log: `~/.cache/pi-motion-studio/logs/make-<key>.log`.
   `--plan-only` stops after `studio project plan <key> --check` exits 0. `--stop` kills the run.
3. GUI: `POST /api/make {request, formats?, minutes?}` (token, <= 4000 chars, one at a time —
   a second returns 409) and `POST /api/make/stop`; the runner is a CHILD OF THE JOB RUNNER, never
   of a request handler. No endpoint ever passes the request through a shell.

## The tools (K10) — `.pi/extensions/motion-tools/project-tools.ts`

`project_new {key, request, formats?, minutes?}`, `project_status {film}`, `project_plan {film}`,
`project_segment {film, id, capability, role, brief, duration}`, `project_assemble {film}`,
`project_check {film}` (the ledger + facts + assets + budget), `project_ship {film}` — each with a
`Type.Object` schema, same style as tools.ts, and listed in `index.ts` `BY_FILE` (the lead owns that
edit). Reviews keep using `film_review` (the project's rubric adds `fidelity` + `coherence`).

## The GUI project view — `studio-gui/public/project.js` + server endpoints

Mounts on `summary().project` (the kind module sets it). Tabs: **Plan** (goal, decision, segments
with status), **Requirements** (the ledger with evidence), **Assets** and **Facts**, **Log** (live
tail via SSE), **Notes** (the existing flow), **Run** (rebuild, verify, ship, stop).
API (all loopback + token, ids validated, `safePath` on every path):
`GET /api/project/<key>` → `{ cfg, plan, requirements, assets, facts, budget, state, log tail }`,
`POST /api/project/<key>/job {kind: rebuild|verify|ship}` (the job runner runs the CLI),
`GET /api/project/<key>/where?t=` (the chained resolve), plus `POST /api/make` / `POST /api/make/stop`
above. Children group under the project in the films list (`parent` field).

## The producer skill + critic (K9/K11) — file list

`.pi/skills/produce/SKILL.md` (broad trigger, the fixed order, the decision framework, the
one-question rule, the revision flow, "The loop (never skip)", a craft paragraph per technique),
`.pi/agents/producer-critic.md` (read-only, fresh eyes, 7 keys + `fidelity` + `coherence`,
fidelity-10-required). AGENTS.md gets "Start here" above everything; the four older skills' front
matter defers to produce. The lead owns AGENTS.md/README integration.
