# The producer — final report

## What now exists
A plain-words request, through any of three doors, becomes a checked deliverable:
- **The project kind** — `films/<key>/`: the request verbatim, a plan with reasons and alternatives, requirements/facts/assets/budget ledgers, children of any kind under one design system — behind the same registry as motion/edit/math (ADR-001/002).
- **Proof, not vibes** — every explicit ask is a requirement measured by a verifier library or a critic's evidence; every fact is a quote found in a stored snapshot; every asset carries a license; $0 by default with a hard budget stop. **Capability growth** — `studio capability new|check`; the `chart` technique was grown for demo D and stays in the menu.
- **Three doors** — chat with pi (AGENTS.md "Start here" + the `produce` skill), `./studio make` (a Node relaunch loop, ADR-004), and the GUI's "✦ Make" box + the project view (Plan / Requirements / Assets / Facts / Log / Notes / Run).

## Three ways to use it (copy-paste)
1. In pi: `Make a 60-second narrated explainer of how GPS knows where you are, vertical and widescreen.`
2. `./studio make "Cut my interview ~/Videos/i.mp4 down to 90 seconds, no ums, captions, 9:16."`
3. `./studio gui` → **✦ Make** → paste the request → the Plan/Requirements/Log tabs → Run → Ship.

## `./studio verify-produce` — 28/28 PASS (`pass: true`, ~33 min; the final run's row-by-row numbers: `docs/produce/verify-last.json`)
| # | the headline number (all rows: `docs/produce/verify-last.json`) |
|---|---|
| env | pi 0.87.1 on PATH; doctor 0 red rows; 12/12 capabilities ready |
| regress | 4 motion films on the baseline; both cheap subsets 5/5 PASS |
| registry | 5 kinds as modules; 0 raw kind checks outside engine/kinds/; golden transcripts + draft md5 = baseline; seeded docs fault still bites |
| naming | 0 reserved chars in 991 paths; math outputs `16x9`; media/ + x-*.json untracked |
| capabilities | 10 catalog entries valid; 12/12 ready from real probes; 39 invoke commands in help |
| services | math mix md5 identical; motion+script.md → timing + −14.5 LUFS narration bus |
| plan | 24 seeded rejects; valid accepted; over-scope caught; probes demanded |
| ledger | 10/10 verifiers good+bad with measured values; brief-lint 25 asks on 10 requests |
| facts | quote-in-snapshot green; missing quote/snapshot red; hedged green; unsourced refused |
| assets | PD/CC0/CC-BY parsed from recorded fixtures; tamper→red; unlicensed blocks ship |
| budget | disabled by default; $ hard stop held at $0.20; minutes soft+hard stops fire; nothing real called |
| project | full lifecycle: resume, revision (only touched parts rebuilt), where-chain, ship |
| single | 3 wrappers shipped byte-identical to their children; verify exit 0 |
| assemble | both formats: geometry/bt709, A/V <1 ms, −14.1 LUFS, joins clean, PSNR ≥ 48.7 dB, md5-identical re-run |
| skill | trigger fires on any media ask; 4 older skills defer; seeded competitor caught |
| critic | read-only (seeded write caught); 9 keys; fidelity-10 rule present |
| make | 11 legs: verbatim by file, STOP/budget/cap stops, concurrency refused, hostile request safe |
| tools | 7 project_* tools with schemas in BY_FILE; live flow through ship |
| gui-smoke | Make dialog → GUI-started runner verified green; tabs/nesting/note/job; 0 console errors |
| gui-security | 403 tokenless; oversized/traversal/absolute/concurrent/unknown refused; no request through a shell |
| growth | the grown `chart` technique: stub refused naming parts, implemented accepted, removal consistent; its gates name the exact bad row |
| battery | 12 plans vs 12 independent references: 111/111 requirements covered; sets acceptable; missing inputs flagged |
| errors | 13/13 loud with next steps; injection changed nothing; killed + concurrent runs handled |
| docs | 41 commands in help; Start here + ## Producer; ADR-001..004; older doc checks still PASS |
| hygiene | no verify-* films; no strays; scratch swept; 0 credentials in 108 files |
| demos | 4 demos: formats as asked, ledgers green, gates PASS, $0 |
| review | 3–5 rounds each, last by producer-critic, min 8, fidelity 10 |

## The demos (films/, each with credits + report)
- `composite` 69.7 s 16:9+9:16 — a real public-domain NASA clip → narrated sympy-verified Pythagoras → end card (3 kinds, one design system, assembled). `launch-teaser` 25.0 s 9:16 — the studio's own GUI, captured and animated.
- `gps` 61.8 s 16:9 — 31 caption cues, 4 sourced facts (NOAA snapshots). `cities` 30.0 s 16:9 — ten cities over a century, CC0 Nordpil/UN data on screen, 10 facts; **the grown `chart` technique** (its own data/axis gates).

## Honest limitations
- A REAL engine bug found by the final gates and FIXED (D-016): PyAV's sliced-thread x264 partial encodes made math finals non-deterministic at the encode layer (identical frames, different bits, ±1 seam frame) — the kit now pins partial encoders to one thread; proven by identical cold re-renders. The golden math-draft baseline and the migration md5 ledger were honestly re-frozen (motion/edit unchanged).
- The edit gold's mix flaps ±0.2 LUFS only inside the verify context (D-011; root cause open — masked in transcripts, verify-edit owns the ±1 gate).
- Cloud providers are opt-in scaffolding, exercised with a fake provider only (no keys exist to test a real one); adding one is documented.
- Narration is Piper (local); GPU speech recognition unproven. Cosmetic: the sidebar's metadata wraps unevenly on narrow rows. The SSE film-scanner sweeps every film once a second once a client connects (~1.8 s at ~35 films on 9p) — fine for one viewer, worth a real watch mechanism if the GUI serves more.
- Worth a second look: the mix aims TP −2.0 dB (AAC overshoot, D-009) · edit-film as the default assembler (ADR-003) · the runner's relaunch cap · brief-lint's deterministic ask extraction.
- `NEEDS_USER.md`: nothing — no hard blocks were hit.

## The earlier suites, from the final tree (ef48d1d, after every tail fix)
- `./studio verify-edit`: **34/34 PASS** (63 min, `pass: true` — docs/editing/verify-last.json).
- `./studio verify-math`: **27/27 PASS** (30 min, zero skips — docs/math/verify-last.json), third green run, now with D-016's thread pin in the engine.
- The tail's own finds, all fixed at the right layer and re-verified green: five math checks on pre-rename colon paths (D-014); the GUI's math video pane blank since P1 + four check races (D-015); the PyAV sliced-thread nondeterminism (D-016) with the golden baseline and migration ledger honestly re-frozen (motion/edit unchanged).
