// hygiene (P11): after the verify work, films/ holds no verify-* films; scratch is disposable;
// git status shows only intended files; studio cache reports the math caches and cache gc frees
// them. Run late in a full run (it measures the verifier's own cleanliness).
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { CAPS } from '../../lib/capped.mjs';
import { ROOT } from '../../lib/serve.mjs';

const HOME = homedir();
const CACHE = join(HOME, '.cache', 'pi-motion-studio');

export default async () => {
  const bad = [], facts = [];
  const du = (p) => { try { return +(execSync(`du -sm '${p}' 2>/dev/null`, { shell: '/bin/bash' }).toString().split('\t')[0] || 0); } catch { return 0; } };

  // 1. films/ holds no verify-* LITTER — but a check's own COMMITTED FIXTURE is intended
  // (films/verify-m-kit is the `library` check's fixture, committed by design: it renders in all
  // four formats and gitignoring it would defeat it).
  const FIXTURES = new Set(['verify-m-kit']);
  const found = readdirSync(join(ROOT, 'films')).filter((f) => /^verify-(m-)?[a-z0-9-]+$/.test(f));
  const stale = found.filter((f) => !FIXTURES.has(f));
  if (stale.length) { for (const f of stale) rmSync(join(ROOT, 'films', f), { recursive: true, force: true }); bad.push(`removed ${stale.length} stale verify-* film(s): ${stale.join(', ')}`); }
  else facts.push(`films/ holds no verify-* litter (fixtures kept: ${[...found].join(', ') || 'none'})`);

  // 2. scratch: disposable by design, but empty of FILM leftovers (the engine removes its own)
  const scratch = join(CACHE, 'scratch');
  const rendering = (() => { try { return execSync('pgrep -f "manim render"').toString().trim().length > 0; } catch { return false; } })();
  const leftovers = existsSync(scratch) && !rendering ? readdirSync(scratch).filter((d) => /^math(\/|$)/.test(d)) : [];
  if (leftovers.length) bad.push(`scratch holds render leftovers with nothing rendering: ${leftovers.join(', ')}`);
  else facts.push('scratch holds no math-render leftovers');

  // 3. git status: nothing under films/ that a check forgot to clean, and no engine/ media leaks
  const gs = execSync('git status --porcelain', { cwd: ROOT }).toString();
  const filmDrops = gs.split('\n').filter((l) => /^\?\?\s+films\/verify-/.test(l));
  if (filmDrops.length) bad.push(`git status carries UNTRACKED verify-* films (${filmDrops.length})`);
  const mediaLeak = existsSync(join(ROOT, 'engine', 'manim', 'media')) || existsSync(join(ROOT, 'engine', 'manim', 'test', 'media'));
  if (mediaLeak) bad.push('a media/ cache leaked into the repo');
  facts.push('git status clean of verify films and media leaks');

  // 4. studio cache reports the math caches (scene + mux + voice) and gc frees them
  const rep = (await run(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'cache'], { cwd: ROOT })).out;
  const knowsScene = /math-scenes|scene cache/i.test(rep), knowsVoice = /voice/i.test(rep);
  if (!knowsScene) bad.push('studio cache does not report the math scene cache');
  if (!knowsVoice) bad.push('studio cache does not report the voice cache');
  else facts.push('cache reports the math caches');
  const sceneMB = du(join(CACHE, 'math-scenes')), voiceMB = du(join(CACHE, 'voice'));
  facts.push(`scene cache ${sceneMB} MB, voice cache ${voiceMB} MB`);
  // gc --math-scenes frees the scene cache without touching anything else
  const before = du(join(CACHE, 'math-scenes'));
  const gc = await run(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'cache', 'gc', '--math-scenes', '--dry'], { cwd: ROOT, allowFail: true });
  if (gc.code === 0 && /math-scenes|scene cache/i.test(gc.out)) facts.push(`cache gc --math-scenes --dry lists ${before} MB to free`);
  else bad.push(`cache gc --math-scenes --dry failed or silent: ${(gc.out || gc.err || '').split('\n').slice(0, 2).join(' | ')}`);

  // 5. the capped guard's caps are intact (a check that lowered them would be a weaken)
  const caps = (await import('../../lib/capped.mjs')).CAPS;
  if (caps.check !== 1024 || caps.draft !== 1536 || caps.final !== 3072)
    bad.push(`CAPS drifted: ${JSON.stringify(caps)} (D-007: check 1024 / draft 1536 / final 3072)`);
  else facts.push('memory caps intact (D-007)');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 500) : facts.join('; ') };
};
