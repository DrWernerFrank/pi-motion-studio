// skill (P4): the produce skill is the studio's front door — a BROAD trigger (any request to make,
// edit, animate, explain or produce any media, any language, a file or a URL or just "make me…"),
// the fixed order, the decision framework, the one-question rule, the revision flow, the loop
// (with the phone test and the craft paragraphs per technique). AGENTS.md's "Start here" points
// here (the lead's section: asserted to EXIST — if it is missing the check fails with exactly
// 'lead must add Start here to AGENTS.md'); the four older skills defer, so exactly ONE skill
// claims the "any video/piece" trigger. A seeded competing skill proves the lint bites.
// Front matter parses the flat folded format every skill uses (yaml-free, continuation-aware —
// the docs checks' parser drops folded lines; here the deferral clause must be READ).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const SKILLS = join(ROOT, '.pi', 'skills');

// flat front matter with folded single-quoted scalars (the format every skill/agent uses).
// Returns { ok, fm, body, bad } — ok false when a quoted scalar never closes.
export function loadFm(p) {
  const raw = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return { ok: false, fm: {}, body: raw, bad: ['no --- front matter block'] };
  const fm = {}, bad = [];
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([a-z][a-z_-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let val = kv[2];
    const opens = val.startsWith("'") && !(val.endsWith("'") && val.length > 1);
    if (opens) {                                   // a folded scalar: read until the closing '
      const buf = [val.slice(1)];
      let closed = false;
      while (i + 1 < lines.length) {
        const nxt = lines[++i].trim();
        if (nxt.endsWith("'") && !nxt.endsWith("''")) { buf.push(nxt.slice(0, -1)); closed = true; break; }
        buf.push(nxt);
      }
      if (!closed) bad.push(`front matter key "${kv[1]}": an unclosed quoted scalar`);
      val = buf.join(' ').replace(/\s+/g, ' ').trim();
    } else val = val.replace(/^['"]|['"]$/g, '');
    fm[kv[1]] = val.replace(/''/g, "'");
  }
  return { ok: bad.length === 0, fm, bad, body: raw.slice(m[0].length) };
}

// the broad "any video/piece" trigger: exactly ONE skill (produce) may claim it. The defer clause
// ("Defer to the produce skill for any new piece") is a ROUTING statement, not a claim.
const BROAD = /\bany (video|piece|media request|request to make)\b|use (it )?whenever the user asks for a video/i;

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // ── 1. the produce skill exists and its front matter parses with a BROAD trigger ───────────
  const skill = loadFm(join(SKILLS, 'produce', 'SKILL.md'));
  need(skill.ok, `the produce skill does not parse: ${skill.bad.join('; ')}`);
  need(skill.fm.name === 'produce', `the produce skill's name is "${skill.fm.name}", not "produce"`);
  const d = skill.fm.description || '';
  need(d.length > 300, `the produce trigger is thin (${d.length} chars) — it must catch ANY media request`);
  for (const phrase of ['any request to make, edit, animate, explain or produce', 'video', 'reel', 'ad',
    'still', 'audio', 'file or a URL', 'make me', 'any language', 'NAMES another skill'])
    need(d.includes(phrase), `the produce trigger does not carry "${phrase}" (it must fire on any media ask)`);
  facts.push(`produce skill parses; trigger ${d.length} chars, fires on any media ask in any language`);

  // ── 2. AGENTS.md "Start here" exists and points here (the lead's section; if it is missing
  //       the row goes red on exactly this leg) ────────────────────────────────────────────────
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const start = /## Start here[\s\S]*?(?=\n## |$)/.exec(agents);
  need(!!start, 'lead must add Start here to AGENTS.md');
  if (start) need(/\.pi\/skills\/produce\/SKILL\.md/.test(start[0]) && /produce/.test(start[0]),
    'the AGENTS.md "Start here" section does not point at the produce skill — lead must add Start here to AGENTS.md');
  facts.push('AGENTS.md "Start here" present and points at the produce skill');

  // ── 3. the four older skills defer: front matter parses, description leads with the clause ──
  const OLD = ['motion-reel', 'math-video', 'video-edit', 'motion-director'];
  for (const name of OLD) {
    const s = loadFm(join(SKILLS, name, 'SKILL.md'));
    need(s.ok, `the ${name} skill does not parse: ${s.bad.join('; ')}`);
    need(s.fm.name === name, `the ${name} skill's name is "${s.fm.name}"`);
    need(/^Defer to the produce skill/.test((s.fm.description || '').trim()),
      `the ${name} skill's description does not start with "Defer to the produce skill"`);
  }
  facts.push(`the ${OLD.length} older skills parse and defer to produce (leading clause)`);

  // ── 4. no two skills claim the "any video" trigger: exactly one (produce) across the dir ────
  const claims = [];
  for (const f of readdirSync(SKILLS)) {
    const s = loadFm(join(SKILLS, f, 'SKILL.md'));
    if (!s.ok) { bad.push(`.pi/skills/${f}/SKILL.md does not parse: ${s.bad.join('; ')}`); continue; }
    if (BROAD.test(s.fm.description || '')) claims.push(s.fm.name || f);
  }
  need(claims.length === 1 && claims[0] === 'produce',
    `${claims.length} skills claim the "any video/piece" trigger (${claims.join(', ')}) — exactly one may: produce`);
  facts.push(`broad-trigger lint: ${claims.length === 1 ? 'produce alone claims it' : claims.join(', ')}`);

  // ── 5. a seeded competing skill is caught (the lint bites, and names it) ────────────────────
  const seeded = join(SKILLS, 'verify-broken-skill');
  rmSync(seeded, { recursive: true, force: true });
  try {
    mkdirSync(seeded, { recursive: true });
    writeFileSync(join(seeded, 'SKILL.md'),
      `---\ndescription: 'Make a video of anything. Use whenever the user asks for a video, reel or ad.'\nname: verify-broken-skill\n---\n\n# seeded fault\n`);
    const seededClaims = [];
    for (const f of readdirSync(SKILLS)) {
      const s = loadFm(join(SKILLS, f, 'SKILL.md'));
      if (s.ok && BROAD.test(s.fm.description || '')) seededClaims.push(s.fm.name || f);
    }
    need(seededClaims.length === 2 && seededClaims.includes('verify-broken-skill'),
      `a seeded competing skill was not caught (claims: ${seededClaims.join(', ')})`);
    const s2 = loadFm(join(seeded, 'SKILL.md'));
    need(!/^Defer to the produce skill/.test(s2.fm.description), 'the seeded skill reads as deferring (the defer lint would miss it)');
    facts.push('seeded fault: a competing "any video" skill is caught and flagged (removed again)');
  } finally { rmSync(seeded, { recursive: true, force: true }); }

  // ── 6. the body names the order, the framework, the rule, the flow, the loop, the rest ──────
  const B = skill.body;
  const BN = B.replace(/\s+/g, ' ');   // phrase checks are wrap-tolerant (the prose folds lines)
  const has = (c) => BN.includes(c);

  need(/## 0\. The order \(fixed\)/.test(B), 'the skill has no "The order (fixed)" section');
  const order = /understand → options → probe → plan → build → assemble → verify → ship → report/.exec(B);
  need(!!order, 'the fixed order (understand → options → probe → plan → build → assemble → verify → ship → report) is not named');
  for (const stage of ['understand', 'options', 'probe', 'plan', 'build', 'assemble', 'verify', 'ship', 'report'])
    need(new RegExp(`\\*\\*${stage}\\*\\*`).test(B), `the order's stage "${stage}" is not spelled out`);

  need(/## 1\. Understand before you build/.test(B), 'no "Understand before you build" section');
  for (const c of ['length, formats, language, assets, platform, tone', 'implied', 'assumptions'])
    need(has(c), `the understand section does not cover "${c}"`);

  need(/## 2\. The one-question rule/.test(B), 'no "The one-question rule" section');
  need(/At most ONE question/i.test(BN), 'the one-question rule does not cap at one question');
  need(/cannot start/.test(BN) && /spend money, publish, or send/.test(BN), 'the one-question rule does not name its two exceptions');
  need(/overrule later by a note/.test(BN), 'the one-question rule does not send overrulable choices to the plan');

  need(/## 4\. The decision framework/.test(B), 'no "The decision framework" section');
  for (const c of ['Fit to the brief', 'Quality ceiling', 'Cost and time', 'Editability', 'Risk',
    'smallest sufficient pipeline', 'Mix techniques only when the piece needs the mix',
    'Build a new capability only when no combination', 'capability new'])
    need(has(c), `the decision framework does not name "${c}"`);

  need(has('the simplest thing that could work'), 'the options section does not demand "the simplest thing that could work"');
  need(/probes\//.test(B) && /5-minute prototype/.test(BN), 'the probe flow (a 5-minute prototype, sheets saved to probes/) is not named');

  need(/## 5\. The menu: `\.\/studio capabilities`/.test(B), 'the menu section (studio capabilities) is missing');
  for (const svc of ['voice', 'asr', 'captions', 'mix', 'capture', 'ingest', 'assemble'])
    need(new RegExp('\\| *`' + svc + '` *\\|').test(B), `the services table does not cite "${svc}"`);
  need(/CAPABILITIES\.md/.test(B), 'the skill does not point at the generated CAPABILITIES.md');

  for (const cmd of ['project new', 'project status', 'project plan', 'project rebuild', 'project verify', 'project ship', 'project where'])
    need(has(cmd), `the project flow does not name "studio ${cmd}"`);
  for (const f of ['brief.md', 'plan.json', 'requirements.json', 'facts.json', 'assets.json', 'budget.json', 'design.json', 'state.json'])
    need(has(f), `the project flow does not name "${f}"`);
  need(/SCHEMAS\.md/.test(B), 'the skill does not cite the frozen machine-file contract (SCHEMAS.md)');
  need(/brief-lint/.test(B), 'the skill does not run brief-lint (every number/format/language/named asset must map to a requirement)');
  need(/snapshot \+ a quote/.test(BN) && /hedged/.test(BN), 'the facts rule (source snapshot + quote, hedged when unverifiable) is missing');
  need(/ONE design system/.test(BN) && /BEFORE any segment/.test(BN), 'the one-design-system-before-any-segment rule is missing');

  for (const craft of ['.pi/skills/motion-reel/SKILL.md', '.pi/skills/motion-director/SKILL.md',
    '.pi/skills/video-edit/SKILL.md', '.pi/skills/math-video/SKILL.md'])
    need(B.includes(craft), `no craft paragraph points at ${craft}`);
  for (const one of ['never cross-fades', 'never from word boundaries', 'never typing'])
    need(has(one), `the craft paragraphs miss their one-thing ("${one}")`);

  need(/## 8\. The loop \(never skip\)/.test(B), 'no "The loop (never skip)" section');
  for (const c of ['`film_status` (read open notes)', '`film_review`', 'Fix those 3', 'film_gate'])
    need(B.includes(c), `the quoted house loop is missing its "${c}" step`);
  need(/3 rounds minimum/.test(BN) && /producer-critic/.test(BN), 'the loop does not demand 3 rounds minimum, the last by producer-critic');
  need(/ledger is checked before taste/.test(BN) && /red requirement is fixed first/.test(BN), 'the loop does not check the ledger before taste');
  need(/ASSEMBLED piece/.test(BN), 'the loop does not also run on the assembled piece');
  for (const c of ['loudness per second', 'waveform', 'spectrogram', 'ASR round trip'])
    need(has(c), `the loop cannot listen but does not measure "${c}"`);
  need(/phone/.test(BN) && /360 px/.test(BN) && /EVERY vertical format/.test(BN), 'the phone test for every vertical format is missing');

  need(/## 9\. Revisions/.test(B), 'no "Revisions" section');
  for (const c of ['revision N', '--only <segment>', 'Re-verify', 'what changed'])
    need(has(c), `the revision flow does not name "${c}"`);

  need(/plain language/.test(BN) && /why that technique/.test(BN) && /ledger says/.test(BN) && /credits/.test(BN) && /revision sentence/.test(BN),
    'the report contract (plain language, why that technique, the ledger, credits, how to adjust) is incomplete');

  need(/#film=/.test(B), 'the tail does not give the GUI film link');
  need(/One render at a time/.test(BN), 'the tail does not state the one-render-at-a-time rule');
  need(/~\/\.cache\/pi-motion-studio\/scratch\//.test(B), 'the tail does not say where scratch lives');
  need(/films\/verify-/.test(B), 'the tail does not say films/verify-* belong to the verifiers');

  facts.push('body carries the order (9 stages), the framework (5 criteria), the one-question rule (2 exceptions), the probe flow, the menu (3 techniques + 7 services), the project flow (8 machine files), 4 craft paragraphs, the loop (ledger-first, 3 rounds, phone, 4 audio measurements), the revision flow and the report');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
