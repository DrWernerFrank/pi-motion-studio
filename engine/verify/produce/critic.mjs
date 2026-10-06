// critic (P4): producer-critic.md parses (front matter: name/tools/model), is READ-ONLY (its body
// carries no write instruction beyond the review round it records), lists its tools (film_review),
// scores the 7 rubric keys PLUS fidelity and coherence (all nine named in the body), and carries
// the rule verbatim: fidelity 10 or the project is not done — a single unmet explicit ask caps
// fidelity at 9. And film_review ACCEPTS its round: a seeded project film (kind: "project") takes
// a producer-critic round with the 9 keys all 8-10 and saved sheets, and the entry lands —
// round 1, min >= 8, pass true, every key stored. A seeded write instruction proves the
// read-only lint bites. Front matter parses with the skill check's fold-aware parser.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, writeJson } from '../../lib/film.mjs';
import { addReview, RUBRIC } from '../../review.mjs';
import { loadFm } from './skill.mjs';
import { ROOT } from '../../lib/serve.mjs';

// the write shapes a critic may NEVER instruct (film_review and its cli fallback are the only
// writes it makes; look/status/verify tools read and measure — verify refreshes measured
// statuses, it never changes the piece)
const FORBIDDEN = [
  ['a filesystem write primitive', /writeFileSync|appendFileSync|rmSync|unlinkSync|\bwriteFile\b/],
  ['a git write', /\bgit\s+(add|commit|push|reset|checkout|stash)\b/i],
  ['a mutating studio command', /\.\/studio\s+(new|edit|render|ship|ingest|cut|sound|transcribe|autoedit)\b|\.\/studio\s+project\s+(new|rebuild|ship|requirement)\b|studio\s+capability\s+new/],
  ['an "edit" instruction', /\bedit\s/i],
  ['a shell write', /\brm\s+-rf\b|\btee\s+|>>\s*\S/],
];
const violations = (body) => FORBIDDEN.filter(([, re]) => re.test(body)).map(([w]) => w);

export default async (ctx) => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // ── 1. the agent parses and declares itself ────────────────────────────────────────────────
  const a = loadFm(join(ROOT, '.pi', 'agents', 'producer-critic.md'));
  need(a.ok, `producer-critic.md does not parse: ${a.bad.join('; ')}`);
  need(a.fm.name === 'producer-critic', `the agent's name is "${a.fm.name}", not "producer-critic"`);
  need(a.fm.model === 'moreweb/glm-5.3-max', `the agent's model is "${a.fm.model}", not "moreweb/glm-5.3-max"`);
  for (const t of ['read', 'bash', 'read_image', 'film_status', 'film_look', 'edit_look', 'math_look', 'edit_audio', 'film_review'])
    need((a.fm.tools || '').includes(t), `the agent's tools miss "${t}"`);
  need((a.fm.tools || '').includes('project_status'), 'the agent\'s tools miss "project_status" (list it; note if the tool is not registered yet)');
  need(a.fm.thinking === 'high' && a.fm['system-prompt'] === 'append' && a.fm['auto-exit'] === 'true',
    'the agent is not thinking: high / system-prompt: append / auto-exit: true like its siblings');

  // ── 2. read-only: no write instruction beyond the review round ──────────────────────────────
  const v = violations(a.body);
  need(!v.length, `producer-critic's body carries write instruction(s): ${v.join(', ')}`);
  need(/read-only/i.test(a.body) && /did not (make|build)/i.test(a.body), 'the body does not declare itself read-only / not the builder');
  // the lint bites: a seeded write instruction is caught
  mkdirSync(ctx.cache, { recursive: true });
  const seededPath = join(ctx.cache, 'critic-seeded.md');
  writeFileSync(seededPath, '---\nname: seeded\n---\n\nWrite it with writeFileSync, then run ./studio render <key>.\n');
  const seededV = violations(readFileSync(seededPath, 'utf8'));
  need(seededV.length === 2 && seededV.includes('a filesystem write primitive') && seededV.includes('a mutating studio command'),
    `the seeded write instruction was not caught (${seededV.join(', ')})`);
  rmSync(seededPath, { force: true });
  facts.push(`read-only: 0 write instructions (${FORBIDDEN.length} patterns hunted; a seeded write caught on both legs)`);

  // ── 3. it records its round: film_review in tools, the writer named, the 9 keys + the rule ──
  const BN = a.body.replace(/\s+/g, ' ');   // phrase checks are wrap-tolerant (the prose folds lines)
  need(/`film_review`/.test(BN), 'the body does not tell the critic to record with film_review');
  need(/engine\/cli\.mjs review/.test(BN), 'the body does not give the film_review fallback writer (same shape, same reviewer)');
  for (const k of [...Object.keys(RUBRIC), 'fidelity', 'coherence'])
    need(BN.includes(k), `the body never names the rubric key "${k}"`);
  need(/hook, readability, motion, variety, composition, brand, sound/.test(BN), 'the 7 base keys are not listed together');
  need(/fidelity 10 or the project is not done/.test(BN), 'the fidelity-10 rule is not present verbatim');
  need(/single unmet explicit ask/.test(BN) && /9 at most/.test(BN), 'the rule that a single unmet explicit ask caps fidelity at 9 is missing');
  need(/deliver what was asked/.test(BN), 'fidelity is not defined (deliver what was asked)');
  need(/one piece, not stitched parts/.test(BN), 'coherence is not defined (one piece, not stitched parts)');

  // ── 4. it reads the ask FIRST and hunts coherence breaks ─────────────────────────────────────
  need(/brief\.md/.test(BN) && /FIRST/.test(BN) && /VERBATIM/i.test(BN), 'the critic does not read brief.md (the request verbatim) first');
  need(/requirements\.json/.test(BN), 'the critic does not read requirements.json');
  need(/ffprobe/.test(BN), 'the critic does not re-measure with ffprobe itself');
  need(/project verify/.test(BN), 'the critic does not re-run studio project verify');
  need(/coherence/.test(BN) && /(type\/color\/pace\/level|continuity across segments)/.test(BN), 'the critic does not hunt continuity breaks across segments');
  need(/join that pops/.test(BN), 'the critic does not hunt a join that pops');
  need(/360 px/.test(BN) && /phone/.test(BN), 'the critic does not phone-test vertical formats at 360 px');
  for (const c of ['loudness per second', 'waveform', 'spectrogram'])
    need(BN.includes(c), `the critic does not measure "${c}" (it cannot listen)`);
  facts.push('the round: film_review named, 9/9 rubric keys + the fidelity-10 rule, ask-first (brief verbatim), measured (ffprobe + verify), coherence hunted');

  // ── 5. film_review ACCEPTS its round: a seeded project film takes a 9-key producer-critic
  //       round (all 8-10, sheets saved) and the entry lands ───────────────────────────────────
  const KEY = 'verify-p-critic';
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  try {
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, 'film.json'), { kind: 'project', title: 'the critic check fixture', formats: ['16:9'], request: '(verify fixture) judge a whole piece against its request', parts: [] });
    const scores = { hook: 9, readability: 8, motion: 9, variety: 8, composition: 9, brand: 9, sound: 8, fidelity: 10, coherence: 9 };
    const round = { scores, problems: [{ t: 12.4, issue: 'the join at s01/s02 pops one frame late', fix: 'extend the crossfade 40ms' }],
      notes: 're-measured: final-16x9.mp4 60.00s 1920x1080; mix -14.0 LUFS; verify re-run green', reviewer: 'producer-critic', sheets: ['sheets/every-16x9.png'] };
    const entry = addReview(KEY, round);
    const stored = JSON.parse(readFileSync(join(dir, 'reviews.json'), 'utf8'));
    need(entry.round === 1, `the round landed as round ${entry.round}, not 1`);
    need(entry.reviewer === 'producer-critic', `the round's reviewer is "${entry.reviewer}"`);
    need(entry.min >= 8, `the round's min score is ${entry.min}, below the 8 bar`);
    need(entry.pass === true, 'a min-8+ round does not pass');
    need(Array.isArray(entry.sheets) && entry.sheets.length === 1, 'the round saved no sheets (the critic must have looked)');
    for (const k of [...Object.keys(RUBRIC), 'fidelity', 'coherence'])
      need(stored[0].scores[k] === scores[k], `the stored round lost the score "${k}"`);
    need(Object.keys(stored[0].scores).length === 9, `the stored round carries ${Object.keys(stored[0].scores).length} keys, not 9`);
    need(/producer-critic/.test(readFileSync(join(dir, 'review_log.md'), 'utf8')), 'the human-readable review log does not name producer-critic');
    facts.push(`film_review accepts the round: 9 keys stored (min ${entry.min}, fidelity ${stored[0].scores.fidelity}), round ${stored[0].round}, pass ${entry.pass}, 1 sheet`);
  } finally { rmSync(dir, { recursive: true, force: true }); }   // the fixture film never outlives the check

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
