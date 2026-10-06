# ADR-001 — The kind registry (S1): one dispatch, four kinds, zero behavior change

**Decision.** Every `cfg.kind === '<kind>'` dispatch in the studio moves behind one registry,
`engine/kinds/registry.mjs`. A kind is a directory `engine/kinds/<name>/index.mjs` exporting hooks;
the registry loads every such module at first use, validates the required hooks (a kind missing one
fails loudly, naming kind and hook), and answers every dispatch through a Proxy that falls back to
the motion kind's hook when a kind does not define one. Motion is the fallback because a film.json
without a `kind` field IS a motion film today — the default kind is the behavior every other kind
inherits unless it overrides it.

## The hook set (designed from what the three kinds actually do — every dispatch site mapped)

**Required** (a kind without one fails to load: `kind "math" is missing required hook "ship"`):

| hook | today's dispatch sites | contract |
|---|---|---|
| `create(key, opts)` | cli `new` (--math / --edit / default) | scaffold the film; return the exact `created …` message the CLI prints |
| `render(key, opts)` | cli `render` (math branch / else) | render draft/final; return `[{ file, seconds }]`, the CLI prints each |
| `look(key, opts)` | cli `look` (math branch / else) | contact sheet; return `{ file, count, times }`, the CLI prints once |
| `sound(key, opts)` | cli `sound` + the `sound()` helper (math / edit / motion) | the whole sound pipeline; prints its own (per-kind) lines |
| `gate(key, opts)` | cli `gate` (math / else) | run the gates; return `{ pass }`; the CLI prints the verdict + exit code |
| `ship(key, opts)` | cli `ship` (math / else) | the delivery path; prints its own lines, returns `{ pass }` |

**Optional, motion provides the fallback** (so the fallback IS today's behavior for motion and edit):

| hook | motion's fallback (byte-exact with today) | overrides |
|---|---|---|
| `check(key, opts)` | throw `studio check is for math films (kind: math)` | math: checkMathFilm + its print block |
| `where(key, t, fmt)` | throw `studio where is for math films (kind: math) — edit films have edit_status` | math: resolveWhere + its print block; project: chained (P3) |
| `scene(key, id, opts)` | throw `films/<key> is kind=<cfg.kind>, not math` (what readMathFilm throws today) | math: one-scene render |
| `timeline(film)` | `null` | edit: `edit.json` (stills.pickTimes' cuts mode + source labels) |
| `lutFor(film)` | `''` | edit: the resolved whole-output LUT string (render.mjs:52) |
| `ownFps(cfg)` | `undefined` | edit: `parseFps(cfg.fps)` (ingest projectFps) |
| `summary(cfg, dir)` | `{}` | edit `{ edit: !!edit.json }`, math `{ math: true }`, project `{ project: true }` (GUI flags) |
| `view(key)` | `null` | edit `edit.js`, math `math.js`, project `project.js` (the GUI module to mount) |
| `rubric()` | `[]` | math `['correctness','clarity']`; project `['fidelity','coherence']` (P4) |
| `capability()` | `null` | the K2 catalog entry (P1: all kinds; services live in the catalog module) |
| `doctor(ctx)` | `[]` | kind readiness probes for `studio capabilities` / `doctor` |

`cfg.kind` may be read in exactly two places: `engine/kinds/**` and `engine/lib/film.mjs` (`kindOf`,
the one helper everything else calls — it defaults to `'motion'`, matching today's `cfg.kind ?? motion`
semantics). The verify checks grep for raw kind checks outside those two paths.

## Why a directory per kind

K12 grows capabilities as `engine/kinds/<id>/` with more than the hooks (catalog entry, doctor probe,
gates, a verify check, a tool, a skill paragraph). The built-in kinds use the same shape so a grown
capability is not a second-class citizen. The registry scans `engine/kinds/*/index.mjs`, so a new
capability is picked up by restart (hot registration is `capability check`'s job, P6).

## The migration order (each step keeps the tree green)

1. Registry + `kindOf` + motion kind (the template). The CLI's default paths (new/look/render/sound/
   gate/ship/poster/capture/refs/…) call motion hooks; nothing else moves yet.
2. Edit kind: `new --edit`, the `sound()` edit branch, `timeline`, `lutFor`, `ownFps`, `summary`.
   `render.mjs` / `stills.mjs` / `ingest.mjs` lose their kind checks and call the registry hooks.
3. Math kind: `new --math`, look/render/scene/check/where/sound/gate/ship move wholesale (their print
   blocks move with them, so the golden transcripts stay byte-equal).
4. `studio-gui/server.mjs`: `summary()` flags and the math route's kind check go through the registry.
5. Golden transcripts + draft md5s re-run (`engine/produce/baseline.mjs --compare docs/produce/baseline`)
   — must be identical (path-form normalization only where the P1 naming migration changes file
   names, which this ADR treats as a separate, later step).

## Zero-behavior-change proof

- Golden CLI transcripts: `docs/produce/baseline/*.txt` (captured P0; the comparison normalizes only
  wall-clock `<n>s` tokens). Any drift prints as a diff.
- One draft md5 per kind (`docs/produce/baseline/drafts.json`): studio-reel 9:16 c88ef10c…,
  demo-cut 16:9 6e43dc37…, mathdemo 16:9 38596ccc… — the same render commands re-run.
- `studio regress` (frame hashes + gate verdicts of the four motion films) and both cheap verify
  subsets stay green throughout (the `regress` check of verify-produce).
- The verify-edit `docs` check greps `case` labels in cli.mjs and demands each in `studio help` — the
  command surface is unchanged by this refactor (all `case`s stay); the registry check proves the grep
  still bites with a seeded fault (remove a command from help → docs goes red).
