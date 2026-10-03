# Progress — math videos (Manim films, `kind: "math"`)

Now: wave 1 (orchestrated) — layout-lint, claims, typeset, render-determinism GREEN (committed 15b9232,
recorder live: get_corner geometry, MRO text, role+nominal_u, to_hex color). Running: p2 (formats+look),
p5 (script+voice), p7 (kit). Next: integrate their results, verify each, commit, tag slice-1
Next after: wave 2 — narration wiring (scene clock say/at/until, sync, where), scene-cache/errors/perf,
library+captions checks, math gates (P8)

The mission: `templates/prompts/math-video-engine.md` (read it again after every restart/compaction).
Decisions: `docs/math/DECISIONS.md`. The verifier is the contract: `./studio verify-math --list`.

## Phases

- [x] **P0** Orientation: read AGENTS/README/editing docs/engine/GUI/`.pi` + the whole determinant film; `git switch -c feat/math-videos`; `verify-edit --clean` (29 leftover films removed); baseline `studio regress` PASS; PROGRESS/DECISIONS; `verify-math` runner + `regress` check green, all other checks present and red
- [x] **P1** Spikes S1–S4 (toolchain, typesetting, voice, render) + `studio doctor --math` probes; ADR-001..004; `env` written (green on this machine; ticked when the full run proves it)
- [x] **P2** Kit core + first vertical slice: `new --math`, `templates/math/`, `StudioScene`, layout `L`, themes (paper, chalk), typesetting API, the recorder, `render` + `look` for math. Milestone: the starter renders 16:9 + 9:16 and I look at its sheet. Checks: `typeset`, `render-determinism`, `formats`, `look`. Commit + tag `slice-1`
- [ ] **P3** Layout lint + label solver (fixtures with seeded violations). Check: `layout-lint`
- [ ] **P4** Claims (ledger, restricted sympy namespace, coverage, `--independent`). Check: `claims`
- [ ] **P5** Script, voice, timing, sync, `where`, bring-your-own narration. Checks: `script`, `voice`, `sync`, `where`
- [ ] **P6** Render pipeline (scene cache, parallelism, concat, mux, loudness, loud errors, `ship`). Checks: `scene-cache`, `concat-mux`, `errors`, `perf-budget`
- [ ] **P7** Kit library + narration captions. Checks: `library`, `captions`
- [ ] **P8** Math gates + review plumbing (extra rubric keys, `ship` outputs `claims.md`). Check: `gates`
- [ ] **P9** pi surface (`math_*` tools, `math-video` skill with craft/kit/manim-notes, `math-critic` agent, AGENTS.md `## Math videos`, README, help). Checks: `tools`, `docs`, `starter`
- [ ] **P10** GUI (`public/math.js`: video + format toggle, scene/sentence timeline with markers, Script/Scenes/Checks/Notes/Run tabs, SSE, review chart with the math rubric keys). Checks: `gui-smoke`, `gui-security`
- [ ] **P11** Hardening (failure matrix: syntax/name/compile/missing-model/hung/empty/100 scenes/10-min/RTL/lang-switch/assets/narration.wav; `cache gc` knows math caches). Check: `hygiene` (+ `errors` failure cases)
- [ ] **P12** Demos + review + final runs: `determinant` (migration), `tangent`, `odd-squares`, each 45–120 s, 16:9 + 9:16, ≥ 15 claims, ≥ 3 review rounds (last by `math-critic`); cold full `verify-math`; full `verify-edit` in the background; `FINAL_REPORT.md`. Checks: `demos`, `review`

## Checks (mirrors `studio verify-math --list`; tick when it passes in a full run)

- [x] `regress` (P0) `studio regress` passes and `verify-edit --only env,edit-ops,gui-security,tools,docs` passes *(verified via `--only regress` at P0; no full run can pass yet)*
- [ ] `env` (P1) doctor resolves Manim (pinned), cairo/pango, a typesetting backend, ffmpeg, a TTS voice, ASR, sympy, the bundled fonts as Pango sees them
- [x] `typeset` (P2) *verified --only* 40 formulas compile deterministically; named parts select+color; Persian shapes RTL; a broken formula fails with formula + file:line
- [x] `render-determinism` (P2) *verified --only* fixture scene twice from cold cache, 2 formats: identical framemd5; 1 worker == 3 workers *(slow)*
- [ ] `formats` (P2) one scene → 4 exact geometries; lint clean; text >= 3.2u; portrait is a re-composition *(slow)*
- [x] `look` (P2) *verified --only* every mode works for all formats, frames labelled, a stale draft re-rendered first
- [x] `layout-lint` (P3) *verified --only* 12 seeded violations reported with ids + time ± 1 frame; 0 false positives on 6 clean scenes; the solver places 8 crowded labels
- [x] `claims` (P4) *verified --only* 30 true / 15 false claims; unparseable = error; `num()` computed; `--independent` agrees on all 45
- [x] `script` (P5) *verified --only* stable sentence ids; bookmarks parse; dup/missing/unknown rejected with line numbers; round-trips; lint flags raw symbols
- [x] `voice` (P5) *verified --only* byte-identical TTS; offsets ± 1 sample; lexicon + normalizer; WER <= 10% round trip; one-sentence re-voice; offline; fa voice; `narration.wav` aligns
- [ ] `sync` (P5) 6 bookmarks within 1 frame of `timing.json` and 80 ms of ASR word onset; scenes cover narration; A/V end <= 1 frame
- [ ] `where` (P5) 20 random times resolve to scene/sentence/animation/`file:line` agreeing with `trace.json`
- [ ] `scene-cache` (P6) unchanged re-render < 10% cold; one scene change re-renders only it; one sentence re-voices one; palette invalidates all; formats never share *(slow)*
- [ ] `concat-mux` (P6) no black/dup/frozen at joins; 10-min A/V drift <= 1 frame; loudness; bed >= 8 dB under narration *(slow)*
- [ ] `errors` (P6) syntax/name/compile/missing-model/hung/empty/invalid-script fail loud with `file:line` or the formula + fix; CLI and GUI agree; never a bare traceback
- [ ] `perf-budget` (P6) calibrated in S4 then frozen *(slow)*
- [ ] `library` (P7) every kit component renders in 4 formats, 0 lint violations, 0 failed claims; kit.md code blocks execute *(slow)*
- [ ] `captions` (P7) en + fa at 4 formats: <= 2 lines, >= 3.2u, safe area, no tofu; SRT/VTT monotonic
- [ ] `gates` (P8) seeded faults FAIL with the right gate name + timestamp; a clean film passes; Canvas-only gates replaced
- [ ] `tools` (P9) every `math_*` tool registered with a schema + BY_FILE; each runs on the starter film
- [ ] `docs` (P9) help complete; README + AGENTS.md `## Math videos`; skill, kit.md, craft.md, critic; THIRD_PARTY; ADR-001..004
- [ ] `starter` (P9) new → voice → render → gate → ship unattended in 16:9 + 9:16 *(slow)*
- [ ] `gui-smoke` (P10) Playwright: play, format toggle, click-seek a sentence, edit + re-voice, seeded error, Checks, pinned note, a draft; 0 console errors
- [ ] `gui-security` (P10) tokenless POST 403; traversal/absolute/dotfile/unknown ids rejected on every new endpoint
- [ ] `hygiene` (P11) no `verify-*` films after a run; scratch empty; git status clean; `cache gc` frees the math caches
- [ ] `demos` (P12) three demos: finals in both formats, 45–120 s, narrated, gates PASS, lint clean, >= 15 claims, >= 90% linked, no placeholder text *(slow)*
- [ ] `review` (P12) each demo: >= 3 rounds, last by `math-critic`, every score >= 8, correctness 10 with the independent re-derivation recorded

## Done means

- [ ] `./studio verify-math` exits 0 and `docs/math/verify-last.json` has `"pass": true` (from a cold cache, full run)
- [ ] every box above is ticked
- [ ] the three demos reviewed by `math-critic`: every score 8+, `correctness` 10
- [ ] `docs/math/FINAL_REPORT.md` exists
- [ ] the full `./studio verify-edit` passes from the final tree (run once, in the background, after verify-math — see DECISIONS D-002)

## Known problems

- `films/determinant-explainer` is truncated and cannot render (pre-existing; the editing mission's D-001 — the baseline expects exactly that).
- `pip install manim` is expected to fail as-is (no cairo/pango dev headers, no LaTeX, no passwordless sudo): S1 routes in order — check the human's packages first (`pkg-config --exists cairo pangocairo && command -v latex dvisvgm`), then the rootless sysroot.
- Scratch and caches live under `~/.cache/pi-motion-studio/` (WSL fs), never in the repo (NTFS over 9p is slow for thousands of small files).
