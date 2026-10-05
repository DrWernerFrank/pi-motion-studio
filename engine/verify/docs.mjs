// docs: `studio help` lists every command; the real-footage docs exist and parse; THIRD_PARTY.md lists every download.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../lib/proc.mjs';
import { ROOT } from '../lib/serve.mjs';

const loadFm = (p) => { const raw = readFileSync(p, 'utf8'), parts = raw.split('---\n'); try { return { ok: true, fm: JSON.parse(JSON.stringify(require0(parts[1]))), body: parts.slice(2).join('---\n') }; } catch { return { ok: false }; } };
// (yaml-free parse: frontmatter is flat key: value lines — the format every existing skill uses)
function require0(txt) { const o = {}; for (const line of txt.split('\n')) { const m = /^([a-z_-]+):\s*(.*)$/.exec(line); if (m) o[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return o; }

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  // 1. every CLI command is in the help
  const cli = readFileSync(join(ROOT, 'engine', 'cli.mjs'), 'utf8');
  const cases = [...cli.matchAll(/^    case '([a-z-]+)':/gm)].map((m) => m[1]);
  const help = (await run('node', [join(ROOT, 'engine', 'cli.mjs'), 'help'])).out;
  // the help indents commands with their args on one line, description on the next: match the bare word
  for (const c of cases) need(new RegExp(`(^|\\s)${c}(\\s|<|$)`).test(help), `studio help does not list "${c}"`);
  need(/verify-edit/.test(help) && /autoedit/.test(help) && /captions/.test(help) && /transcribe/.test(help), 'help misses the editing commands');
  facts.push(`help lists all ${cases.length} commands`);

  // 2. the skill and the critic parse and carry their tools
  const skill = loadFm(join(ROOT, '.pi', 'skills', 'video-edit', 'SKILL.md'));
  const critic = loadFm(join(ROOT, '.pi', 'agents', 'edit-critic.md'));
  const mskill = loadFm(join(ROOT, '.pi', 'skills', 'motion-reel', 'SKILL.md'));
  need(skill.ok && critic.ok && mskill.ok, 'a frontmatter does not parse');
  need(skill.fm.name === 'video-edit' && skill.fm.description?.length > 80, 'video-edit skill frontmatter incomplete');
  need(/craft|cut on the breath|duck/i.test(skill.body), 'the skill does not carry the craft rules');
  need(/edit_status/.test(critic.body) && /edit_look/.test(critic.body), 'edit-critic does not name its tools');
  need((critic.fm.tools || '').includes('film_review'), 'edit-critic cannot record reviews');
  facts.push('video-edit skill + edit-critic agent parse, craft rules + tools present');

  // 3. AGENTS.md and README carry the real-footage contract
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  need(/## Real footage/.test(agents) && /read-only/.test(agents) && /measured/.test(agents), 'AGENTS.md real-footage section incomplete');
  need(/## Real footage/.test(readme) && /captions|9:16|reframe/i.test(readme), 'README real-footage section incomplete');
  facts.push('AGENTS.md + README real-footage sections present');

  // 4. THIRD_PARTY.md lists every downloaded thing the pipeline uses
  const tp = readFileSync(join(ROOT, 'docs', 'editing', 'THIRD_PARTY.md'), 'utf8');
  for (const row of ['piper-voices', 'faster-whisper', 'yunet', 'Vazirmatn', 'talking-head-original.webm']) need(tp.includes(row), `THIRD_PARTY.md misses ${row}`);
  need(/Public domain/.test(tp) && /sha256/.test(tp), 'THIRD_PARTY.md lacks licenses/hashes');
  // the fonts the engine bundles are accounted for
  const fonts = readFileSync(join(ROOT, 'engine', 'lib', 'fonts.css'), 'utf8');
  if (/Vazirmatn/.test(fonts)) need(/Vazirmatn/.test(tp), 'the bundled Vazirmatn is not in THIRD_PARTY.md');
  facts.push('THIRD_PARTY.md covers models, voices, fonts, the real clip');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
