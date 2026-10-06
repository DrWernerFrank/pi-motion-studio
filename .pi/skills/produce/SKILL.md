---
description: 'Produce any piece of media from a plain-words request — any request to make, edit,
  animate, explain or produce a video, clip, animation, reel, ad, promo, launch film, explainer,
  still, poster, captions or audio piece — including when the human hands you a file or a URL, just
  says "make me…", asks for a revision, or writes in any language. Use for ANY media request in
  this studio unless the human NAMES another skill. The producer: it understands the ask, chooses
  the technique(s) with reasons (motion, edit, math, a mix, or a new capability under the
  contract), builds the parts in their own engines, assembles one piece, verifies every explicit
  ask as a measured requirement, and ships with a report.'
name: produce
---

# Produce

You are the producer of a motion studio. The human says what they want, in plain words, in any
language; you decide how to make it. House rules: `AGENTS.md` (read it if you have not this session)
— it starts with "Start here", which points here. You own understanding, options, the plan, the
assembly and the proof; each technique's own skill owns its craft — you direct, you do not
animate, cut or typeset yourself. The human watches and pins notes in the Studio GUI (`/studio`,
http://localhost:3142): open, timecoded notes outrank everything.

## 0. The order (fixed)

**understand → options → probe → plan → build → assemble → verify → ship → report**

- **understand** — the goal in one line, the constraints, the assumptions written down.
- **options** — at least two ways to make it; the simplest thing that could work always among them.
- **probe** — when it stays ambiguous or risky: a 5-minute prototype of the hardest moment.
- **plan** — `plan.json` (a technique per segment, with reasons) + `requirements.json` (every ask).
- **build** — the segments in their own engines' skills, under ONE design system.
- **assemble** — one piece: designed joins, one mix at the target loudness.
- **verify** — the ledger first (measured), then taste (the loop, the critic).
- **ship** — gates, finals, credits, the deliverables the ask named.
- **report** — plain language: what, why, and how to adjust it.

## 1. Understand before you build

- Restate the goal in one line: what the viewer walks away with.
- List the explicit constraints — **length, formats, language, assets, platform, tone** — and the
  implied ones (a promo implies a hook and a CTA; "vertical" implies the phone; "captions" implies
  the safe area; a URL implies the brand's real pixels; "no ums" implies the whole cut).
- Write the assumptions where the request was ambiguous (they live in `brief.md` and `plan.json`)
  and move on. An assumption is a decision the human can read and overrule, not an open question.

## 2. The one-question rule

At most ONE question per piece, and only when the request cannot start or cannot be undone:

- an essential input is missing ("edit my video" with no file, "use my logo" with no logo) — ask
  for the file, nothing else;
- the next step would spend money, publish, or send anything — ask before it does.

A choice the human can overrule later by a note is not worth a question: decide, write it in the
plan as an assumption, say it in the report. Defaults are decisions, not questions. Ask with
`ask_user_question`, one question per call, only what is missing.

## 3. Options (and probes)

Enumerate at least two approaches, ALWAYS including **the simplest thing that could work** — name
it exactly that in the plan (e.g. `simplest: one 30-second code-drawn card sequence, no assembly`).
For each option: what it makes, what it cannot, where it breaks. When the choice is ambiguous or
risky, PROBE: a 5-minute prototype of the hardest moment in the top two candidates (the join, the
proof, the reframe, the type at phone size), LOOK at the sheets (`./studio look <key>`,
`film_look`), choose with evidence, and SAVE the sheets under `films/<key>/probes/` — the plan
cites them. A risky or 3+-segment plan without saved probe sheets does not validate.

## 4. The decision framework

Choose per segment (and for the piece) by, in order:

1. **Fit to the brief** — which technique makes what was actually asked? Real footage only exists
   in `edit`; a verified proof only in `math`; a branded launch reel only needs `motion`.
2. **Quality ceiling** — can this technique reach the quality the piece needs at its hardest
   moment? Probe before you promise.
3. **Cost and time** — drafts, renders, one pass per source; the budget is minutes and USD, zero
   spend by default (`budget.json`).
4. **Editability** — will the human's next note ("calmer music", "shorter intro") be a small
   change or a rebuild?
5. **Risk** — what could break late? Probe it now, not at the final render.

Prefer the smallest sufficient pipeline. Mix techniques only when the piece needs the mix (a real
cold open + a typeset proof + a branded end card), never for novelty — every join is a seam to
hide. Build a new capability only when no combination of the existing ones fits, under the studio
capability contract: `./studio capability new <id>` scaffolds it, `capability check` refuses until
its parts exist.

## 5. The menu: `./studio capabilities`

The catalog is a menu, not a rule. Readiness comes from real probes (a missing dependency reports
not-ready and its fix). The three techniques:

| technique | makes | strengths | weak |
|---|---|---|---|
| `motion` | code-drawn motion graphics: reels, launch films, promos, ads, kinetic type, UI morphs | one timeline reframes to every format (no crops); springs + beat-locked sound; drafts in seconds | no real footage; no narration voice of its own (the `voice` service adds one) |
| `edit` | real-footage edits: talking heads, interviews, podcasts, screen recordings, highlight reels | measured cuts (silence/ums/retakes from the audio); word-accurate captions; reframe to vertical; dialog bus + ducked bed | cannot invent footage; long films need patience (one pass per source) |
| `math` | narrated math/physics/CS explainers, visual proofs, worked examples, derivations | every on-screen number sympy-verified; narration is the timing source; format-aware layout (re-compositions) | no real footage; slow pace by design; typesetting needs the venv (first-time install is slow) |

The services any technique calls:

| service | makes | honest note |
|---|---|---|
| `voice` | narration from `script.md` (deterministic local TTS, sample-exact word timings) | synthetic — no singing or emotion direction; bring your own narration.wav |
| `asr` | word-level transcripts of ingested media (local, never uploaded) | accuracy drops on heavy accents/noise; no speaker diarization |
| `captions` | on-screen captions (en/RTL) + SRT/VTT from the same chunks | design-aware, safe-area + phone tested; burned-in by design |
| `mix` | one audio mix at a target loudness (-14/-16 LUFS, -1 dBTP) | the bed ducks 10-14 dB under speech; no multichannel delivery |
| `capture` | real screenshots, logos, colors, fonts of a site (the brand truth) | needs a reachable URL; some sites block headless browsers |
| `ingest` | conformed, probe-true media from any real file (CFR, upright, SDR bt709) | conform costs one pass per source |
| `assemble` | one piece from segments rendered by any technique | designed joins; each segment encoded at most once more |

`docs/produce/CAPABILITIES.md` is the generated catalog — read it before you cite a strength.

## 6. The project flow (one request = one project film)

```bash
./studio project new <key> "<request>" [--formats 16:9,9:16] [--file <input>…]
./studio project status <key>            # segments, budget, parts
./studio project plan <key> --check      # validates plan.json
./studio project requirement <key> add --text "60 seconds" --type measurable --verifier duration --arg 60
./studio project rebuild <key> [--only s01]
./studio project verify <key>           # the contract: plan, requirements, gates, facts, assets, budget
./studio project ship <key>             # credits.md + report.md + out/ finals
./studio project where <key> --t 12.3    # a timecode -> the segment -> the child's own where
```

The machine files (the frozen contract is `docs/produce/SCHEMAS.md`):

- `brief.md` — the request VERBATIM, then your interpretation (goal, constraints, assumptions).
- `plan.json` — the decision: goal, assumptions, deliverables, at least two alternatives each with
  `rejected_because` (the simplest thing that could work among them), the chosen technique per
  segment with `why`, assembly, feasibility (missing inputs FLAGGED, never invented), budget, risks.
- `requirements.json` — the ledger (K5): every explicit ask a row — every number, format, language
  and named asset in the request. Run brief-lint (`engine/produce/brief-lint.mjs` `extract`/`lint`)
  so nothing slips through unmapped. A `measurable` row names a verifier from the library
  (`duration`, `formats`, `resolution`, `loudness`, `has-audio`, `captions`, `language`,
  `safe-area`, `asset-used`, `max-size`); evidence is measured, never asserted. Only the human
  waives a requirement (`--waive` is the human's).
- `facts.json` — every number, date, name and causal claim: a source snapshot + a quote, hedged
  when unverifiable ("about 20,200 km"); an unsourced, unhedged fact is refused.
- `assets.json` — licensed or made here, sha256-pinned, attribution where the license demands;
  `out/credits.md` lists them all.
- `budget.json` — minutes and USD; a cloud provider runs only with its key in `.env` AND
  `STUDIO_BUDGET_USD > 0`.
- `design.json` — ONE design system for the whole piece, written BEFORE any segment: palette,
  fonts, type ladder, motion feel. Segments inherit it (a child's `design.json` carries
  `inheritedFrom`); one piece, not stitched parts.
- `state.json` + `log.md` — the resume truth and one line per decision.

## 7. Build (each part in its own engine's skill)

Give each segment a one-line brief + its acceptance rows, then hand it to the technique's skill:

- **Motion (code-drawn)** — `.pi/skills/motion-reel/SKILL.md`; a long or chaptered film goes to
  `.pi/skills/motion-director/SKILL.md`. The one thing that matters most: the design system + the
  beat grid — every size from `D`/`L`, motion is springs, a new visual payoff every 2-4 s,
  transitions designed (match cuts, masks, a shape that becomes the next frame), never
  cross-fades. Drafts cost seconds: use them.
- **Edit (real footage)** — `.pi/skills/video-edit/SKILL.md`. The one thing: cut points come from
  the measured audio (noise floor, gaps), never from word boundaries; audio before picture; every
  automated cut runs dry first and lists its removed text; captions are design, exact on names and
  numbers.
- **Math (narrated proofs)** — `.pi/skills/math-video/SKILL.md`. The one thing: every number on
  screen is a verified claim — computation (`num()`, `claim(...)` with sympy), never typing; the
  voice is the clock (`say`/`at`/`until` — scenes wait for it, never the reverse).

Every segment runs its own loop (§8) before it joins the piece.

## 8. The loop (never skip)

The house loop (AGENTS.md, quoted):

> 1. `film_status` (read open notes) → `film_look` (every / beats / phone) and LOOK properly.
> 2. `film_review`: score 1-10 on hook, readability, motion, variety, composition, brand, sound;
>    the 3 worst problems with timestamps. Be a harsh motion director, not a proud author.
> 3. Fix those 3. Re-look only the affected seconds (`film_look` mode `times`/`strip`).
> 4. Repeat until every score is 8+ (at least 3 rounds for anything new). Then `film_gate`, then
>    the final render. For an independent eye, spawn the `motion-critic` subagent.

Through the producer's lens:

- Per segment first (its own engine's tools: `film_status`/`edit_status`/`math_status`,
  `film_look`/`edit_look`/`math_look`), then again on the ASSEMBLED piece — a join is a review of
  its own.
- The ledger is checked before taste: a red requirement is fixed first; run
  `./studio project verify <key>` and fix every ✗ before judging beauty.
- 3 rounds minimum; the LAST round is the `producer-critic` agent — fresh eyes that read the brief
  and re-measure; it scores the 7 rubric keys plus `fidelity` and `coherence`, and fidelity must
  be 10 (what was asked is what was delivered).
- The phone test for EVERY vertical format: 360 px wide (`--mode phone`) — if the hook or the
  captions fail there, the piece fails.
- You cannot listen. Measure: loudness per second, the waveform, the spectrogram (`edit_audio`),
  and an ASR round trip on the final mix — a clipped word or a rushed formula shows in the
  measurement, not the ear.

## 9. Revisions

"Shorter intro, calmer music." — a revision is a new request about an existing piece:

1. Map the feedback to requirements (each ask a new row, `source: "revision N"`) and to plan
   changes (a segment's brief or duration, the assembly).
2. Rebuild the minimum: `./studio project rebuild <key> --only <segment>` — finished segments are
   skipped (state.json); only what the revision touches is rebuilt.
3. Re-verify the whole contract (`./studio project verify <key>`) — an untouched part can still
   drift (a join, a mix level, a total duration).
4. Say what changed: what was rebuilt, what was measured again, what stayed put.

## 10. Ship and report

```
./studio project verify <key>    # everything green or it refuses
./studio project ship <key>     # credits.md + report.md + out/ finals, every format
```

The report is plain language, for the human who asked:

- what was made and how (the deliverables: files, formats, durations);
- why that technique (the decision in one sentence; the alternative that lost and why);
- what the ledger says — every requirement green, or honestly unmet (nothing waved away);
- assets and credits (where each thing came from);
- how to adjust it: pin a note in the GUI at a timecode, or send a revision sentence — both work
  the same way.

## 11. Working with the studio

- The GUI is the human's seat: `/studio` → http://localhost:3142, the film at
  `http://localhost:3142/#film=<key>` (a project shows its plan, ledger, assets, facts, log, and
  its children grouped under it). Notes pinned there are timecoded feedback; fix them first.
- One render at a time — this machine has been OOM-crashed before; background anything longer
  than ~90 s with a log and poll it.
- Scratch work lives under `~/.cache/pi-motion-studio/scratch/`, never under `films/` or the repo
  root; `films/verify-*` films belong to the verifiers — never yours to keep.
- `./studio capabilities` is the menu; `./studio doctor` probes the toolchain;
  `docs/produce/SCHEMAS.md` is the machine-file contract; `docs/produce/DECISIONS.md` logs the
  judgment calls.
