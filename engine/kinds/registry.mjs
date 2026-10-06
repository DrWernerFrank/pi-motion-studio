// The kind registry (ADR-001): one dispatch for every film kind. A kind is a directory
// engine/kinds/<name>/index.mjs exporting hooks; the registry loads them, validates the required
// set, and answers dispatch through a Proxy that falls back to the motion kind's hook when a kind
// does not define one (a film.json without "kind" IS a motion film — the default kind).
//
//   const { hooksFor, kindModule, allKinds, kindOfFilm } = await import('./kinds/registry.mjs');
//   const K = await hooksFor(key);        // the film's kind, motion-fallback for missing hooks
//   await K.look(key, opts);              // every dispatch goes through here
//
// Raw `cfg.kind ===` checks live only in engine/kinds/** and lib/film.mjs's kindOf (the grep gate).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kindOf, readFilm } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

export const REQUIRED = ['create', 'render', 'look', 'sound', 'gate', 'ship'];
const KINDS_DIR = join(ROOT, 'engine', 'kinds');

let LOADED = null;   // one load per process; the CLI is a fresh process every run, the GUI restarts

/** Every kind module, keyed by its directory name. Loads, self-validates (required hooks fail
 *  loudly, naming kind and hook), refuses duplicate names. */
export async function allKinds() {
  if (LOADED) return LOADED;
  const out = {};
  if (existsSync(KINDS_DIR)) {
    for (const f of readdirSync(KINDS_DIR).sort()) {
      const idx = join(KINDS_DIR, f, 'index.mjs');
      if (!existsSync(idx)) continue;
      const mod = await import(pathToFileURL(idx).href);
      const missing = REQUIRED.filter((h) => typeof mod[h] !== 'function');
      if (missing.length) throw new Error(`kind "${f}" (engine/kinds/${f}/index.mjs) is missing required hook(s): ${missing.join(', ')}`);
      if (out[f]) throw new Error(`two kind modules claim the kind "${f}"`);
      out[f] = mod;
    }
  }
  if (!out.motion) throw new Error('engine/kinds/motion is the fallback kind and must exist (ADR-001)');
  LOADED = out;
  return out;
}

/** A kind module by name (the `new` paths: no film exists yet to dispatch by). */
export async function kindModule(name) {
  const k = await allKinds();
  if (!k[name]) throw new Error(`unknown kind "${name}": known kinds are ${Object.keys(k).join(', ')}`);
  return k[name];
}

/** The film's kind name (kindOf the cfg; motion when the field is absent). */
export function kindOfFilm(keyOrFilm) {
  const film = typeof keyOrFilm === 'string' ? readFilm(keyOrFilm) : keyOrFilm;
  return kindOf(film.cfg);
}

/** The dispatch: the film's kind module, with motion's hook for anything it does not define.
 *  A film.json with an unknown kind behaves as motion (today's === checks simply never matched). */
export async function hooksFor(keyOrFilm) {
  const k = await allKinds();
  const mod = k[kindOfFilm(keyOrFilm)] ?? k.motion;
  const fallback = k.motion;
  return new Proxy(mod, { get: (t, p) => (p in t ? t[p] : fallback[p]) });
}
