// studio cache: where the disk went, and garbage collection of what nothing references.
//   studio cache                 size report
//   studio cache gc [--dry] [--fixtures]
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CACHE, DATA } from './doctor.mjs';
import { binDir, dirSize, readBin } from './ingest.mjs';
import { FILMS, readFilm, readJson } from './lib/film.mjs';

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const films = () => (existsSync(FILMS) ? readdirSync(FILMS).filter((f) => existsSync(join(FILMS, f, 'film.json'))) : []);

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
export function plan({ fixtures = false } = {}) {
  const items = [], add = (p, why) => { if (existsSync(p)) items.push([p, statSync(p).isDirectory() ? dirSize(p) : statSync(p).size, why]); };
  for (const k of films()) {
    const dir = join(FILMS, k);
    if (/^verify-/.test(k)) { add(dir, 'temporary verify film'); continue; }
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
  return items;
}

export function gc({ dry = false, fixtures = false, log = console.log } = {}) {
  const items = plan({ fixtures });
  let freed = 0;
  for (const [p, bytes, why] of items) { log(`${dry ? 'would remove' : 'removed'}  ${mb(bytes).padStart(10)}  ${p.replace(homedir(), '~')}  (${why})`); freed += bytes; if (!dry) rmSync(p, { recursive: true, force: true }); }
  log(items.length ? `${dry ? 'would free' : 'freed'} ${mb(freed)}` : 'nothing to collect');
  return { items: items.length, freed };
}

export function printReport() {
  const r = report();
  for (const f of r.films) console.log(`${f.where.padEnd(34)} media ${mb(f.media).padStart(10)}   out ${mb(f.out).padStart(10)}`);
  for (const o of r.other) console.log(`${o.where.padEnd(34)} ${mb(o.bytes).padStart(10)}`);
}
void readJson;
