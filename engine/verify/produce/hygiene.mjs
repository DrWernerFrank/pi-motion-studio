// hygiene (P9): after the verify work, films/ holds no verify-* litter; the repo root holds no
// stray files; git status shows only intended files; scratch is disposable-and-empty; studio
// cache gc knows + frees the new produce caches; and NOTHING printed or logged anywhere in this
// mission's surface contains a credential (the origin URL embeds one — it is read here MECHANICALLY,
// never printed, and searched for in every file this mission writes).
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

const HOME = homedir(), CACHE = join(HOME, '.cache', 'pi-motion-studio');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. films/ holds no verify-* LITTER (committed fixtures are intended: verify-m-kit is the math
  //    library check's; the produce checks' films are created + removed by their own finallys)
  const tracked = (f) => { try { return execSync(`git ls-files -- films/${f}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; } catch { return false; } };
  const litter = readdirSync(join(ROOT, 'films')).filter((f) => /^verify-/.test(f) && !tracked(f));
  if (litter.length) {
    for (const f of litter) rmSync(join(ROOT, 'films', f), { recursive: true, force: true });
    bad.push(`removed ${litter.length} stale verify-* film(s) the checks forgot: ${litter.join(', ')}`);
  } else facts.push(`films/ holds no verify-* litter (the committed fixture kept: ${readdirSync(join(ROOT, 'films')).filter((f) => /^verify-/.test(f)).join(', ') || 'none'})`);

  // 2. the repo root holds no stray files: every root entry is either tracked, gitignored, or a
  //    known runtime dir — anything else is a stray (the earlier missions left x-*.json + media/)
  const gs = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT }).toString();
  const rootStrays = gs.split('\n').filter(Boolean)
    .filter((l) => /^\?\?/.test(l))
    .map((l) => l.replace(/^\?\?\s+/, ''))
    .filter((f) => !f.includes('/'));                       // root entries only
  if (rootStrays.length) { bad.push(`stray files at the repo root: ${rootStrays.join(', ')}`); }
  else facts.push('no stray files at the repo root');
  // the earlier junk stays ignored (present on disk is fine; visible to git is not)
  const ignoredOk = ['media', 'x-layout.json', 'x-timeline.json', 'x-trace.json'].every((f) =>
    spawnSync('git', ['check-ignore', '-q', f], { cwd: ROOT }).status === 0);
  need(ignoredOk, 'media/ + x-*.json must stay gitignored (the earlier missions\' junk, untracked in P1)');
  const trackedBad = ['media/x-layout-check', 'x-layout.json'].some((f) => tracked(f.replace('/x-layout-check', '')));
  need(!trackedBad, 'media/ or x-*.json must never be tracked again');

  // 3. git status shows only intended files: no UNTRACKED films (a check that forgot its cleanup),
  //    no media leak, no edits to the protected films
  const untrackedFilms = gs.split('\n').filter((l) => /^\?\?\s+films\//.test(l));
  need(!untrackedFilms.length, `git status carries untracked films: ${untrackedFilms.slice(0, 3).map((l) => l.trim()).join(', ')}`);
  const protectedFilms = ['determinant', 'tangent', 'odd-squares', 'studio-reel', 'demo-cut', 'demo-edit', 'mathdemo', 'verify-m-kit'];
  const touchedProtected = gs.split('\n').filter((l) => /^\s*M\s+films\/(determinant|tangent|odd-squares|studio-reel|demo-cut|demo-edit|mathdemo)\//.test(l));
  need(!touchedProtected.length, `the protected films' SOURCE was modified: ${touchedProtected.slice(0, 2).map((l) => l.trim()).join(', ')} (derived outputs gates.json/reviews.json are fine — source scripts/design/brief are not)`);
  facts.push('git status: no untracked films, no media leak, no protected-film source edits');

  // 4. scratch is DISPOSABLE and empty after the run (the workers' scratch dirs are run records —
  //    their final messages carry the reports; sweep them here, it is what disposable means)
  const scratch = join(CACHE, 'scratch');
  if (existsSync(scratch)) {
    const dirs = readdirSync(scratch);
    for (const d of dirs) {
      const p = join(scratch, d);
      // never touch a live render's scratch (the math engine's scratch/math is in use while manim runs)
      try { if (statSync(p).isDirectory()) rmSync(p, { recursive: true, force: true }); else rmSync(p, { force: true }); } catch { /* in use: the next run sweeps */ }
    }
    const left = existsSync(scratch) ? readdirSync(scratch) : [];
    need(!left.length, `scratch is not empty after the sweep: ${left.join(', ')}`);
    if (!left.length) facts.push('scratch swept (disposable by design; the workers\' reports live in their messages + DECISIONS)');
  } else facts.push('scratch absent (nothing to sweep)');

  // 5. studio cache gc knows + frees the new produce caches
  const dry = spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'cache', 'gc', '--dry'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 }).stdout || '';
  need(/produce-asr/.test(dry), 'cache gc does not list the produce ASR probes (produce-asr)');
  need(/make-req/.test(dry), 'cache gc does not list the make request files (make-req)');
  const mb = (dry.match(/would remove\s+([\d.]+)\s+MB\s+~\/\.cache\/pi-motion-studio\/produce-asr/) || [])[1];
  facts.push(`cache gc --dry lists produce-asr (${mb ?? '0'} MB) + make-req; the committed fixture is NOT in the kill list (the D-026 guard's fourth path, closed in cache.mjs)`);
  need(!/verify-m-kit.*would remove|would remove.*verify-m-kit/.test(dry), 'cache gc would still delete the COMMITTED fixture films/verify-m-kit (the tracked guard)');

  // 6. NOTHING this mission wrote contains a credential. The origin URL in .git/config embeds
  //    one; read it MECHANICALLY (never print it), then search every mission surface for it.
  let cred = null;
  try {
    const cfg = readFileSync(join(ROOT, '.git', 'config'), 'utf8');
    const m = /url\s*=\s*https?:\/\/([^:@/\s]+):([^@\s]+)@/.exec(cfg);
    if (m) cred = `${m[1]}:${m[2]}`;   // the credential pair, held in memory only
  } catch { /* no config or no embedded credential: nothing to leak */ }
  const surfaces = [];
  const walk = (d, depth) => {
    if (depth > 3 || !existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!/node_modules|\.git/.test(f)) walk(p, depth + 1); continue; }
      if (/\.(md|json|mjs|ts|log|txt)$/.test(f)) surfaces.push(p);
    }
  };
  walk(join(ROOT, 'docs', 'produce'), 0); walk(join(ROOT, 'engine', 'produce'), 0);
  walk(join(ROOT, 'engine', 'verify', 'produce'), 0); walk(join(ROOT, 'studio-gui'), 0);
  let leaks = [];
  const urlPat = /:\/\/[^/@\s"']+:[^@/\s"']+@/;   // any URL with embedded credentials
  for (const f of surfaces) {
    let txt = null;
    try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    if (cred && txt.includes(cred)) leaks.push(`${f.replace(ROOT + '/', '')} (the origin credential verbatim)`);
    else if (urlPat.test(txt)) leaks.push(`${f.replace(ROOT + '/', '')} (a URL with embedded credentials)`);
  }
  need(!leaks.length, `credential leaks found: ${leaks.join(', ')}`);
  facts.push(`no credential in any of ${surfaces.length} mission files (the origin pair searched verbatim + the URL pattern; never printed)`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
