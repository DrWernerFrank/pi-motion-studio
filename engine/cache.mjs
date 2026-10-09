// studio cache: where the disk went, and garbage collection of what nothing references.
//   studio cache                 size report (incl. the math caches: entry count + size)
//   studio cache gc [--dry] [--fixtures] [--math-scenes]
//     --math-scenes  remove the WHOLE math scene cache (content-addressed: rebuilt on demand)
//     by default, math scene-cache entries not touched in 14 days are collected (keys are
//     content-addressed, so orphans are stale BY CONSTRUCTION and age is the cheap proxy — D-020)
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib/serve.mjs';
import { CACHE, DATA } from './doctor.mjs';
import { binDir, dirSize, readBin } from './ingest.mjs';
import { SCENE_CACHE } from './math.mjs';            // the math render cache (content-addressed per scene)
import { VOICE_CACHE } from './narration.mjs';      // the math voice cache (content-addressed per sentence)
import { FILMS, readFilm, readJson } from './lib/film.mjs';

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const films = () => (existsSync(FILMS) ? readdirSync(FILMS).filter((f) => existsSync(join(FILMS, f, 'film.json'))) : []);

// The math caches (math.mjs SCENE_CACHE / narration.mjs VOICE_CACHE — imported so they can never
// drift). Entries are content-addressed (sha256 of everything the entry depends on): a needed
// entry removed by gc is simply re-rendered/re-voiced on its next miss, and an orphan is stale by
// construction — mtime age is the cheap proxy for "nothing needed it lately" (D-020).
const SCENE_STALE_MS = 14 * 86400e3;
const cacheEntries = (d) => (existsSync(d) ? readdirSync(d).filter((f) => /^[0-9a-f]{32}$/.test(f) || /^[0-9a-f]{64}$/.test(f)) : []);

export function report() {
  const rows = [];
  for (const k of films()) {
    const film = readFilm(k), media = dirSize(binDir(film)), out = dirSize(film.out);
    if (media || out) rows.push({ where: `films/${k}`, media, out });
  }
  const home = (d) => d.replace(homedir(), '~');
  const other = [CACHE, DATA].flatMap((d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ where: `${home(d)}/${e.name}`, bytes: dirSize(join(d, e.name)) })) : []));
  return { films: rows, other };
}

// What gc would remove, as [path, bytes, why]. Never touches sources, edit.json, transcripts, or anything referenced by a media bin.
// mathScenes defaults from argv (the CLI forwards only --dry/--fixtures today): --math-scenes takes
// the whole scene cache; without it, scene-cache entries older than 14 days are collected anyway.
export function plan({ fixtures = false, mathScenes } = {}) {
  const allScenes = mathScenes ?? process.argv.includes('--math-scenes');
  const items = [], add = (p, why) => { if (existsSync(p)) items.push([p, statSync(p).isDirectory() ? dirSize(p) : statSync(p).size, why]); };
  // a films/verify-* that git tracks is a COMMITTED FIXTURE, never a leftover (the D-026 class:
  // three sweeps ate films/verify-m-kit twice before the guard; gc was a fourth path — a real
  // `studio cache gc` would have deleted the library check's fixture)
  const trackedByGit = (f) => { try { return execSync(`git ls-files -- films/${f}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; } catch { return false; } };
  for (const k of films()) {
    const dir = join(FILMS, k);
    if (/^verify-/.test(k)) { if (!trackedByGit(k)) add(dir, 'temporary verify film'); continue; }
    const film = readFilm(k);
    add(join(film.out, '.parts'), 'unfinished render parts');
    const bd = binDir(film);
    if (!existsSync(bd)) continue;
    const bin = readBin(film);
    for (const e of readdirSync(bd, { withFileTypes: true })) {
      const p = join(bd, e.name);
      if (e.isDirectory()) {
        if (!bin.sources[e.name]) add(p, 'media not in the bin (orphan)');
        else for (const f of readdirSync(p)) if (f.includes('.part.')) add(join(p, f), 'interrupted ingest leftover');
      }
    }
  }
  add(join(CACHE, 'verify'), 'verify scratch');
  if (fixtures) add(join(CACHE, 'fixtures'), 'fixtures (rebuilt on demand)');
  // the math scene cache: whole (--math-scenes) or the 14-day-stale entries (age = the orphan proxy)
  if (allScenes) add(SCENE_CACHE, 'the whole math scene cache (--math-scenes: content-addressed, rebuilt on demand)');
  // the producer's caches: the ASR language-probe slices (content-hashed by mix slice — rebuilt on
  // demand) and the GUI make-run request files (transient by design: a run reads + deletes its own)
  const PRODUCE_ASR = join(homedir(), '.cache', 'pi-motion-studio', 'produce-asr');
  const MAKE_REQ = join(homedir(), '.cache', 'pi-motion-studio', 'make-req');
  if (existsSync(PRODUCE_ASR)) add(PRODUCE_ASR, 'the produce ASR language probes (content-hashed per mix slice, rebuilt on demand)');
  if (existsSync(MAKE_REQ)) add(MAKE_REQ, 'the make runner\'s request files (transient: a run reads + deletes its own; leftovers are orphans)');
  else if (existsSync(SCENE_CACHE)) {
    const cutoff = Date.now() - SCENE_STALE_MS;
    for (const e of readdirSync(SCENE_CACHE)) {
      const p = join(SCENE_CACHE, e);
      if (statSync(p).mtimeMs < cutoff) add(p, `math scene cache entry not touched in 14 days (content-addressed: orphans are stale by construction)${/\.tmp-/.test(e) ? ' — an unfinished cache write' : ''}`);
    }
  }
  return items;
}

export function gc({ dry = false, fixtures = false, mathScenes, log = console.log } = {}) {
  const items = plan({ fixtures, mathScenes });
  let freed = 0;
  for (const [p, bytes, why] of items) { log(`${dry ? 'would remove' : 'removed'}  ${mb(bytes).padStart(10)}  ${p.replace(homedir(), '~')}  (${why})`); freed += bytes; if (!dry) rmSync(p, { recursive: true, force: true }); }
  log(items.length ? `${dry ? 'would free' : 'freed'} ${mb(freed)}` : 'nothing to collect');
  return { items: items.length, freed };
}

export function printReport() {
  const r = report();
  for (const f of r.films) console.log(`${f.where.padEnd(34)} media ${mb(f.media).padStart(10)}   out ${mb(f.out).padStart(10)}`);
  for (const o of r.other) console.log(`${o.where.padEnd(34)} ${mb(o.bytes).padStart(10)}`);
  // the math caches: entry count + size (films/outputs above are the media; these are the caches
  // that make math iteration cheap — the scene render cache and the voice cache)
  for (const [dir, name] of [[SCENE_CACHE, 'math scene cache'], [VOICE_CACHE, 'math voice cache']])
    if (existsSync(dir)) console.log(`${dir.replace(homedir(), '~').padEnd(34)} ${String(cacheEntries(dir).length).padStart(9)} entries ${mb(dirSize(dir)).padStart(10)}  (${name})`);
}
void readJson;
