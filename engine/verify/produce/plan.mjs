// plan (P2): the validator rejects a plan missing the goal, assumptions, a segment's capability,
// acceptance, reasons, fewer than two alternatives, a budget, or deliverables; accepts a valid
// one; flags over-scoping (segment durations vs the target) and unknown capabilities; a risky
// choice requires saved probe sheets. Plus brief-lint's 10 seeded requests (the mission's
// acceptance examples): extract is exact, an empty ledger flags every ask, a mapping one flags none.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, writeJson } from '../../lib/film.mjs';
import { checkPlan, validatePlanFile } from '../../produce/plan.mjs';
import { extract, lint } from '../../produce/brief-lint.mjs';

// a real 60s math-explainer plan: one segment, two alternatives (incl. the simplest thing that
// could work), a budget, feasibility flags — the shape SCHEMAS §plan.json asks for
const BASE = {
  version: 1,
  goal: 'The viewer can say what the Pythagorean theorem claims and why the square-on-each-side proof holds.',
  audience: 'curious adults with no math background',
  assumptions: ['the request means a narrated piece (it says "narrated")', 'a phone is the first screen (both formats asked)'],
  deliverables: [
    { type: 'video', name: 'main', formats: ['16:9', '9:16'], duration: 60 },
    { type: 'captions', name: 'captions' },
  ],
  decision: {
    chosen: 'math',
    why: 'The ask is a narrated visual proof with verified claims — the math technique exists for exactly that (its claims ledger proves every on-screen number).',
    risky: false,
    alternatives: [
      { id: 'motion', rejected_because: 'code-drawn motion cannot typeset a proof or verify a claim; the theorem would be decorative, not proven' },
      { id: 'simplest: a static poster of the theorem', rejected_because: 'a poster cannot animate the proof or carry narration; also no captions' },
    ],
    probes: [],
  },
  segments: [{
    id: 's01', capability: 'math', role: 'the whole piece: statement, visual proof, payoff',
    brief: 'State the theorem, animate the squares on each side until the areas visibly match, land the payoff sentence.',
    duration: 60, inputs: [], film: 'verify-p-plan-s01',
    acceptance: ['the claims ledger is green for every on-screen number', 'narration and animation stay in sync (the sync gate)'],
  }],
  assembly: { mode: 'single', transitions: 'none — one technique, no joins', audio: 'one mix at -14 LUFS' },
  feasibility: { blocked_inputs: [], needs_capability: [] },
  budget: { minutes: 180, usd: 0 },
  risks: ['typesetting needs the venv (first install is slow)'],
};

// one field broken at a time — each rejection must NAME the missing/wrong thing
const MUTANTS = [
  ['goal empty', (p) => { p.goal = ''; }, ['goal']],
  ['goal 5 chars', (p) => { p.goal = 'Math.'; }, ['goal']],
  ['no assumptions', (p) => { p.assumptions = []; }, ['assumptions']],
  ['no deliverables', (p) => { p.deliverables = []; }, ['deliverables']],
  ['video deliverable without formats', (p) => { p.deliverables[0].formats = []; }, ['formats']],
  ['video deliverable without duration', (p) => { delete p.deliverables[0].duration; }, ['duration']],
  ['no decision', (p) => { delete p.decision; }, ['decision']],
  ['why a word, not a sentence', (p) => { p.decision.why = 'ok'; }, ['why']],
  ['no alternatives', (p) => { p.decision.alternatives = []; }, ['alternatives']],
  ['an alternative without rejected_because', (p) => { delete p.decision.alternatives[0].rejected_because; }, ['rejected_because']],
  ['chosen not in the catalog', (p) => { p.decision.chosen = 'magic'; }, ['magic', 'motion']],
  ['chosen a service, not a technique', (p) => { p.decision.chosen = 'voice'; }, ['service', 'technique']],
  ['no segments', (p) => { p.segments = []; }, ['segments']],
  ['segment without capability', (p) => { delete p.segments[0].capability; }, ['capability']],
  ['segment capability unknown', (p) => { p.segments[0].capability = 'hologram'; }, ['hologram', 'math']],
  ['segment capability a service', (p) => { p.segments[0].capability = 'voice'; }, ['service']],
  ['segment without acceptance', (p) => { p.segments[0].acceptance = []; }, ['acceptance']],
  ['segment without duration', (p) => { delete p.segments[0].duration; }, ['duration']],
  ['segment without role', (p) => { delete p.segments[0].role; }, ['role']],
  ['segment without brief', (p) => { delete p.segments[0].brief; }, ['brief']],
  ['no budget', (p) => { delete p.budget; }, ['budget']],
  ['bad assembly mode', (p) => { p.assembly.mode = 'weird'; }, ['assembly.mode', 'weird']],
  ['no feasibility', (p) => { delete p.feasibility; }, ['feasibility']],
  ['duplicate segment ids', (p) => { p.segments.push(structuredClone(p.segments[0])); }, ['twice']],
];

// the 10 seeded requests (templates/prompts/producer.md's acceptance list): what extract must
// return EXACTLY, and a ledger row whose text maps every ask (so lint flags nothing)
const REQUESTS = [
  { ask: 'Explain how GPS knows where you are, 60 seconds, narrated, vertical and widescreen.',
    ex: { durations: [60], formats: ['16:9', '9:16'], languages: [], assets: [], counts: [] },
    ledger: [{ id: 'r01', text: 'the piece runs 60 seconds, delivered in 16:9 and 9:16' }] },
  { ask: 'Cut my interview ~/Videos/i.mp4 down to 90 seconds, no ums, captions, 9:16.',
    ex: { durations: [90], formats: ['9:16'], languages: [], assets: ['~/Videos/i.mp4'], counts: [] },
    ledger: [{ id: 'r01', text: 'a 90 s cut in 9:16 from ~/Videos/i.mp4' }] },
  { ask: 'A 20-second teaser for https://example.com, vertical, use their look.',
    ex: { durations: [20], formats: ['9:16'], languages: [], assets: [], counts: [] },
    ledger: [{ id: 'r01', text: 'a 20 seconds vertical 9:16 teaser' }] },
  { ask: 'Open on a real clip, explain the Pythagorean theorem with a visual proof, close on an end card.',
    ex: { durations: [], formats: [], languages: [], assets: [], counts: [] },
    ledger: [] },
  { ask: 'An animated chart of the ten biggest cities by population over the last century.',
    ex: { durations: [], formats: [], languages: [], assets: [], counts: [10] },
    ledger: [{ id: 'r01', text: 'the top 10 cities, animated' }] },
  { ask: 'A 30-second promo for my cafe in Persian, logo attached (~/logo.png), warm colors.',
    ex: { durations: [30], formats: [], languages: ['fa'], assets: ['~/logo.png'], counts: [] },
    ledger: [{ id: 'r01', text: '30 seconds in fa with the ~/logo.png logo' }] },
  { ask: 'A 45-second clip with waveform and captions from podcast.mp3.',
    ex: { durations: [45], formats: [], languages: [], assets: ['podcast.mp3'], counts: [] },
    ledger: [{ id: 'r01', text: '45 seconds of waveform from podcast.mp3' }] },
  { ask: 'A calm 10-second looping abstract background, 16:9.',
    ex: { durations: [10], formats: ['16:9'], languages: [], assets: [], counts: [] },
    ledger: [{ id: 'r01', text: '10 seconds, 16:9, loops cleanly' }] },
  { ask: 'Three 45-second vertical highlights from talk.mp4.',
    ex: { durations: [45], formats: ['9:16'], languages: [], assets: ['talk.mp4'], counts: [3] },
    ledger: [{ id: 'r01', text: 'three 45-second highlights in 9:16 cut from talk.mp4' }] },
  { ask: 'A 30-second promo for my cafe, in Persian, logo C:\\Users\\Hp\\logo.png, warm colors.',
    ex: { durations: [30], formats: [], languages: ['fa'], assets: ['C:\\Users\\Hp\\logo.png'], counts: [] },
    ledger: [{ id: 'r01', text: '30 s, language fa, logo at C:\\Users\\Hp\\logo.png' }] },
];

// the corners the acceptance list does not reach (word durations, a bare 'fa', punctuation)
const UNITS = [
  ['half a minute of the product', { durations: [30], formats: [], languages: [], assets: [], counts: [] }],
  ['2 minutes on the topic', { durations: [120], formats: [], languages: [], assets: [], counts: [] }],
  ['a video about factor pairs', { durations: [], formats: [], languages: [], assets: [], counts: [] }],
  ['narrated in fa', { durations: [], formats: [], languages: ['fa'], assets: [], counts: [] }],
  ['use ~/logo.png.', { durations: [], formats: [], languages: [], assets: ['~/logo.png'], counts: [] }],
  ['the top 10 cities', { durations: [], formats: [], languages: [], assets: [], counts: [10] }],
  ['square and widescreen', { durations: [], formats: ['16:9', '1:1'], languages: [], assets: [], counts: [] }],
];

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // the real catalog (the wiring: checkPlan takes catalogById, validatePlanFile loads it itself)
  const { validatedCatalog } = await import('../../produce/catalog.mjs');
  const byId = Object.fromEntries((await validatedCatalog()).map((e) => [e.id, e]));

  // ── 1. a valid plan passes; every seeded break is rejected, naming what is missing/wrong ──────
  const okPlan = checkPlan(BASE, byId);
  need(okPlan.ok, `the valid base plan is rejected: ${(okPlan.errors || []).join('; ')}`);
  for (const [label, mutate, wants] of MUTANTS) {
    const p = structuredClone(BASE);
    mutate(p);
    const r = checkPlan(p, byId);
    need(!r.ok, `${label}: the mutated plan is ACCEPTED (want a rejection)`);
    const msg = (r.errors || []).join(' | ');
    for (const w of wants) need(msg.includes(w), `${label}: the rejection does not name "${w}" (${msg.slice(0, 140)})`);
  }
  facts.push(`valid plan accepted; ${MUTANTS.length} seeded bad plans rejected, each naming the missing/wrong thing`);

  // ── 2. over-scoping: 60s of segments against a 30s target is an ERROR carrying both numbers;
  //       far under target is a WARNING (a warning never blocks) ────────────────────────────────
  {
    const p = structuredClone(BASE); p.deliverables[0].duration = 30;
    const r = checkPlan(p, byId);
    need(!r.ok, 'over-scoping: 60s of segments against a 30s deliverable is ACCEPTED');
    const msg = (r.errors || []).join(' | ');
    need(msg.includes('over-scoping'), `the over-scoping rejection does not say so (${msg.slice(0, 140)})`);
    need(msg.includes('60') && msg.includes('30'), `the over-scoping message does not carry both numbers (${msg.slice(0, 140)})`);
  }
  {
    const p = structuredClone(BASE); p.deliverables[0].duration = 90;   // 60s of segments, 90s asked
    const r = checkPlan(p, byId);
    need(r.ok, `far under target must warn, not error (${(r.errors || []).join('; ')})`);
    need((r.warnings || []).some((w) => /target/.test(w)), 'far under target does not warn');
  }
  facts.push('over-scoping 60s vs 30s caught (both numbers in the message); 60s vs 90s target only warns');

  // ── 3. a risky choice requires saved probe sheets ──────────────────────────────────────────
  {
    const p = structuredClone(BASE); p.decision.risky = true;
    const r = checkPlan(p, byId);
    need(!r.ok, 'a risky choice without probe sheets is ACCEPTED');
    const msg = (r.errors || []).join(' | ');
    need(msg.includes('risky') && msg.includes('probe'), `the risky rejection does not name probes (${msg.slice(0, 140)})`);
    p.decision.probes = ['probes/p1-sheet.png'];
    const ok = checkPlan(p, byId);
    need(ok.ok, `a risky choice WITH saved probe sheets is rejected (${(ok.errors || []).join('; ')})`);
  }

  // ── 4. a 3-segment composite needs probes too (and passes with them) ─────────────────────────
  const composite = () => {
    const p = structuredClone(BASE);
    p.decision.chosen = 'composite';
    p.decision.why = 'The piece opens on real footage, proves the claim with typeset math and closes on brand motion — no single technique carries all three.';
    p.decision.alternatives = [
      { id: 'math-only', rejected_because: 'the cold open needs real footage; math cannot open on a real clip' },
      { id: 'simplest: one edit film with typed cards', rejected_because: 'cut cards cannot typeset the proof or verify its claims' },
    ];
    p.assembly = { mode: 'edit-film', transitions: 'designed joins, no black frames', audio: 'one mix at -14 LUFS' };
    p.segments = [
      { id: 's01', capability: 'edit', role: 'cold open', brief: 'A real rooftop clip sets the question: how far is it across, really?', duration: 8, inputs: ['input:i1'], acceptance: ['the clip starts within 0.5s of the piece start'] },
      { id: 's02', capability: 'math', role: 'the proof', brief: 'Animate the square-on-each-side proof until the areas visibly match.', duration: 44, inputs: [], acceptance: ['the claims ledger is green', 'narration and animation stay in sync'] },
      { id: 's03', capability: 'motion', role: 'end card', brief: 'A branded end card lands the payoff sentence and the studio mark.', duration: 8, inputs: [], acceptance: ['the card holds 1.5s of stillness before the cut to black'] },
    ];
    return p;
  };
  {
    const r = checkPlan(composite(), byId);
    need(!r.ok, 'a 3-segment composite without probe sheets is ACCEPTED');
    need((r.errors || []).join(' | ').includes('probe'), 'the composite rejection does not name probes');
    const p = composite(); p.decision.probes = ['probes/p1-sheet.png'];
    const ok = checkPlan(p, byId);
    need(ok.ok, `a 3-segment composite WITH probes is rejected (${(ok.errors || []).join('; ')})`);
  }
  facts.push('risky + 3-segment composites demand probe sheets, accepted once saved');

  // ── 5. brief-lint: extract exact, an empty ledger flags every ask, a mapping one flags none ──
  let asks = 0;
  for (const { ask, ex, ledger } of REQUESTS) {
    const got = extract(ask);
    need(same(got, ex), `extract(${JSON.stringify(ask.slice(0, 44))}…) -> ${JSON.stringify(got)} (want ${JSON.stringify(ex)})`);
    const want = [...ex.durations.map((v) => ['duration', v]), ...ex.formats.map((v) => ['format', v]),
      ...ex.languages.map((v) => ['language', v]), ...ex.assets.map((v) => ['asset', v]), ...ex.counts.map((v) => ['count', v])];
    asks += want.length;
    const flagged = lint(ask, []).unmapped.map((u) => [u.kind, u.value]);
    need(same(flagged, want), `lint(${JSON.stringify(ask.slice(0, 44))}…) with an EMPTY ledger flags ${JSON.stringify(flagged)} (want exactly ${JSON.stringify(want)})`);
    const mapped = lint(ask, ledger).unmapped;
    need(mapped.length === 0, `lint with a mapping ledger still flags ${JSON.stringify(mapped)} for ${JSON.stringify(ask.slice(0, 44))}…`);
  }
  for (const [ask, ex] of UNITS) {
    const got = extract(ask);
    need(same(got, ex), `extract corner ${JSON.stringify(ask)} -> ${JSON.stringify(got)} (want ${JSON.stringify(ex)})`);
  }
  need(lint('90 seconds', [{ text: 'the piece runs 190 seconds' }]).unmapped.length === 1, '"190 seconds" in the ledger must not map a 90-second ask');
  need(lint('45 seconds', [{ text: 'a 45 min piece' }]).unmapped.length === 1, '"45 min" in the ledger must not map a 45-second ask');
  facts.push(`brief-lint: ${REQUESTS.length}/${REQUESTS.length} requests exact (${asks} asks flagged on an empty ledger, 0 on a mapping one; ${UNITS.length} corners)`);

  // ── 6. a real file: the valid plan on disk under films/verify-p-plan (removed even on failure)
  const dir = join(FILMS, 'verify-p-plan');
  try {
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, 'film.json'), { kind: 'project', title: 'verify-p-plan', formats: ['16:9', '9:16'], request: '(verify fixture) a 60s math explainer', parts: [] });
    writeJson(join(dir, 'plan.json'), BASE);
    const r = await validatePlanFile(join(dir, 'plan.json'));
    need(r.ok, `validatePlanFile on a real plan.json: ${(r.errors || []).join('; ')}`);
    need(r.plan?.decision?.chosen === 'math', 'validatePlanFile does not return the parsed plan');
    need(r.catalogById?.math?.type === 'technique', 'validatePlanFile did not load the real catalog (catalogById)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  facts.push(`validatePlanFile green on a real file (catalog: ${Object.keys(byId).length} entries wired)`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
