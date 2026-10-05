// docs (P9): the math-video documentation contract, mirroring engine/verify/docs.mjs (the edit
// check): `studio help` lists every command the CLI has TODAY (grep cli.mjs's cases at RUN TIME —
// never require wiring that is still pending: the pending rows are listed, not failed); README and
// AGENTS.md carry "## Math videos"; the skill (SKILL/craft/kit/manim-notes) and the agents exist
// and parse; THIRD_PARTY.md lists every download the pipeline made (sysroot debs, the built wheels
// + sha256, manim, tex2typst, kokoro, TinyTeX); ADR-001..004 exist; manim-notes cites the D-numbers.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { ROOT } from '../../lib/serve.mjs';

// flat frontmatter (same parser as the edit docs check — the format every existing skill/agent uses)
function loadFm(p) {
  try {
    const raw = readFileSync(p, 'utf8');
    const fm = {};
    for (const line of raw.split('---\n')[1].split('\n')) {
      const m = /^([a-z_-]+):\s*(.*)$/.exec(line);
      if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return { ok: true, fm, body: raw.split('---\n').slice(2).join('---\n') };
  } catch { return { ok: false }; }
}

export default async (ctx = {}) => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const root = ctx.root || ROOT;

  // 1. every CLI command that exists today is in the help (grep the cases at run time: the
  //    orchestrator's gate/sound/ship math dispatch + script/voice rows may land in parallel)
  const cli = readFileSync(join(root, 'engine', 'cli.mjs'), 'utf8');
  const cases = [...cli.matchAll(/^    case '([a-z-]+)':/gm)].map((m) => m[1]);
  const help = (await run('node', [join(root, 'engine', 'cli.mjs'), 'help'])).out;
  for (const c of cases) need(new RegExp(`(^|\\s)${c}(\\s|<|$)`).test(help), `studio help does not list "${c}"`);
  // the math rows that must be in the help text today
  for (const row of ['--math', 'scene <film>', 'check <film>', 'where <film>', 'verify-math', '--lang'])
    need(help.includes(row), `studio help does not document "${row}"`);
  facts.push(`help lists all ${cases.length} commands incl. the math rows (new --math, scene, check, where, verify-math)`);
  // the mission's math CLI surface still pending wiring (honest list, never a failure here):
  // check what exists at run time — the orchestrator wires gate/sound/ship + script/voice in parallel
  const pendRows = [];
  if (!cases.includes('script')) pendRows.push('script <film> (parse+lint lives in narration.parseScript / the math_script tool)');
  if (!cases.includes('voice')) pendRows.push('voice <film> (buildVoice lives in narration.mjs / the math_voice tool; studio sound voices+mixes)');
  if (/math film gates land in P8/.test(cli)) pendRows.push('gate math dispatch (P8: engine/math-gates.mjs — the case stops loudly for kind math today)');
  if (/math film ship lands in P8/.test(cli)) pendRows.push('ship math dispatch (P8: gates → final renders → out/claims.md — the case stops loudly for kind math today)');

  // 2. the skill suite exists and parses: SKILL (the fixed order + the loop), craft (§9), kit (the
  //    pointer + the shortlist), manim-notes (the pitfalls with their citations)
  const skill = loadFm(join(root, '.pi', 'skills', 'math-video', 'SKILL.md'));
  need(skill.ok && skill.fm.name === 'math-video' && (skill.fm.description || '').length > 80, 'math-video skill frontmatter incomplete/missing');
  need(/The loop \(never skip\)/.test(skill.body), 'the skill has no "The loop (never skip)" section');
  need(/intake/.test(skill.body) && /scaffold/.test(skill.body) && /## 2\. The script/.test(skill.body) && /voice/.test(skill.body) && /check/.test(skill.body), 'the skill does not carry the fixed order (intake → scaffold → script → voice → scenes → check → draft → loop → gates → ship)');
  need(/math-critic/.test(skill.body) && /correctness/.test(skill.body) && /clarity/.test(skill.body), 'the skill loop does not score correctness + clarity or name math-critic');
  need(/film_review/.test(skill.body), 'the skill loop does not record reviews with film_review');
  const craft = readFileSync(join(root, '.pi', 'skills', 'math-video', 'craft.md'), 'utf8');
  const ci = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  for (const marker of ['One color per concept', 'at most 3-4', '150 words per minute', '>= 1.2 s', 're-composition', 'ducked 10-14 dB'])
    need(ci(marker).test(craft), `craft.md lost the §9 rule "${marker}"`);
  need(craft.includes('design.json') && /math\.roles/.test(craft), 'craft.md does not pin the roles palette');
  const kit = readFileSync(join(root, '.pi', 'skills', 'math-video', 'kit.md'), 'utf8');
  need(kit.includes('engine/manim/kit.md'), 'kit.md does not point at engine/manim/kit.md (the real API doc)');
  for (const c of ['Matrix', 'PlaneLab', 'GraphLab', 'EqSteps', 'EqMorph', 'Callout', 'NumberLineLab', 'gnomon', 'chapter', 'caption'])
    need(kit.includes(c), `kit.md shortlist misses ${c}`);
  const notes = readFileSync(join(root, '.pi', 'skills', 'math-video', 'manim-notes.md'), 'utf8');
  for (const cite of ['D-008', 'D-009', 'ADR-002', 'ADR-004', 'get_corner'])
    need(notes.includes(cite), `manim-notes.md does not cite ${cite}`);
  need(/TransformMatchingTex/.test(notes) && /SEGFAULT|segfault/.test(notes) && /media\/Tex/.test(notes), 'manim-notes.md misses a listed pitfall (TransformMatchingTex / the odd-dimension segfault / the media/Tex race)');
  facts.push('skill math-video (SKILL + craft + kit pointer + manim-notes) parses and carries the loop, §9, the shortlist, the pitfalls');

  // 3. the agents: the critic (fresh eyes, correctness+clarity, re-derivation) and the animator
  const critic = loadFm(join(root, '.pi', 'agents', 'math-critic.md'));
  const animator = loadFm(join(root, '.pi', 'agents', 'math-animator.md'));
  need(critic.ok && animator.ok, 'a math agent frontmatter does not parse');
  need(critic.ok && (critic.fm.tools || '').includes('math_look') && (critic.fm.tools || '').includes('film_review'), 'math-critic cannot look or record');
  need(critic.ok && /independent/.test(critic.body) && /re-derive/.test(critic.body), 'math-critic does not re-derive with --independent');
  need(critic.ok && critic.fm.model === 'moreweb/glm-5.3-max', `math-critic model is ${critic.fm.model}, wanted moreweb/glm-5.3-max (the claude-bridge is rate-limited here)`);
  need(animator.ok && animator.fm.model === 'moreweb/glm-5.3-max' && /ONE scene|one scene/i.test(animator.body), 'math-animator is not a one-scene agent');
  facts.push('agents math-critic + math-animator parse (moreweb/glm-5.3-max, the critic re-derives, the animator owns one scene)');

  // 4. AGENTS.md and README carry the math-video contract
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8'), readme = readFileSync(join(root, 'README.md'), 'utf8');
  need(/## Math videos/.test(agents), 'AGENTS.md has no "## Math videos" section');
  need(/## Real footage/.test(agents), 'AGENTS.md lost its "## Real footage" section (keep every existing section)');
  need(/math-video\/SKILL\.md/.test(agents) && /math-critic/.test(agents) && /last review round/.test(agents), 'AGENTS.md math section incomplete (skill pointer / critic / the last-round rule)');
  need(/## Math videos/.test(readme), 'README has no "## Math videos" section');
  need(/## Real footage/.test(readme), 'README lost its "## Real footage" section (keep every existing section)');
  need(/math-video\/SKILL\.md/.test(readme) && /math-critic/.test(readme), 'README math section incomplete');
  facts.push('AGENTS.md + README carry "## Math videos" (Real footage untouched)');

  // 5. THIRD_PARTY.md lists every download, ADR-001..004 exist
  const tp = readFileSync(join(root, 'docs', 'math', 'THIRD_PARTY.md'), 'utf8');
  for (const row of ['sysroot', 'debs', 'pycairo', 'manimpango', 'manim', 'tex2typst', 'kokoro', 'TinyTeX'])
    need(tp.includes(row), `THIRD_PARTY.md misses "${row}"`);
  need(/manim\s*0\.21\.0/.test(tp), 'THIRD_PARTY.md does not name the pinned manim version (0.21.0)');
  const lock = readFileSync(join(root, 'engine', 'manim', 'requirements.lock'), 'utf8');
  need(/manim==0\.21\.0/.test(lock), 'requirements.lock does not pin manim==0.21.0');
  need(/sha256/.test(tp) && (tp.match(/sha256/g) || []).length >= 5, 'THIRD_PARTY.md lacks the sha256 hashes');
  for (const adr of ['ADR-001-toolchain.md', 'ADR-002-typesetting.md', 'ADR-003-voice.md', 'ADR-004-render.md'])
    need(existsSync(join(root, 'docs', 'math', adr)), `docs/math/${adr} does not exist`);
  facts.push(`THIRD_PARTY.md covers the sysroot debs, the built wheels (+${(tp.match(/sha256/g) || []).length} sha256), manim, tex2typst, kokoro, TinyTeX; ADR-001..004 exist`);

  const pend = pendRows.length ? ` · pending (wired in parallel, not required here): ${pendRows.join('; ')}` : '';
  return { pass: bad.length === 0, measured: `${bad.length ? bad.join('; ') + ' || ' : ''}${facts.join('; ')}${pend}` };
};
