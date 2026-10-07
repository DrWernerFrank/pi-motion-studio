// chart (K12, a grown technique): animated data charts: bars racing ranks over time, drawn from a data file the film reads (every figure a sourced fact)
//
// A scaffolded KIND MODULE (ADR-001): the registry (engine/kinds/registry.mjs) scans
// engine/kinds/*/index.mjs, requires the six hooks below as functions and dispatches every
// film command through them (a film.json with "kind": "chart" is this kind; a missing hook
// would make the registry fail loudly, naming this kind and the hook).
//
// create WORKS today (it scaffolds a film folder from templates/film and stamps film.json
// kind: "chart"); the other five hooks are STUBS that throw "not implemented yet: …" until
// you implement them — a motion-based technique simply re-exports motion's hooks (see
// engine/kinds/motion/index.mjs and the implemented example in
// engine/verify/produce/growth.mjs). `studio capability check chart` refuses the capability
// until every stub is gone; README.md (this directory) is the whole contract.
//
// The doctor probe (checkCapability's contract part #3) must be a MODULE export — this line is
// what wires it; engine/kinds/chart/doctor.mjs is the probe itself.
export { doctor } from './doctor.mjs';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

export function create(key, { title, duration, formats, loop, bpm } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key>: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error(`films/${key} already exists`);
  cpSync(join(ROOT, 'templates', 'film'), dir, { recursive: true });   // the motion scaffold
  const cfg = readJson(join(dir, 'film.json'));
  Object.assign(cfg, {
    kind: 'chart',                                   // the stamp: this film IS a chart film
    title: title ?? key, duration: duration ?? cfg.duration,
    formats: formats ?? cfg.formats, loop: loop === undefined ? !!cfg.loop : !!loop,
  });
  cfg.music.bpm = bpm ?? cfg.music.bpm;
  writeJson(join(dir, 'film.json'), cfg);
  // the data file a chart film reads in setup(): rows of [x, y] + the source every figure cites
  writeJson(join(dir, 'chart.json'), { data: [[0, 0]], source: '(fill me in: the URL every figure comes from)', note: 'every on-screen number must trace to this source' });
  return { dir, message: `created films/${key} (kind: chart)\n` +
    `  next: implement the stubbed hooks (studio capability check chart), write brief.md + design.json + index.html\n` +
    `  preview: studio gui  (or open http://localhost:3142/films/${key}/)` };
}

// a MOTION-BASED technique: the film is code-drawn (seek(t), springs, the synth mix) — re-export
// motion's pipeline hooks wholesale; the ONLY thing this kind adds is chart.json (the data the
// film draws) and its two gates (the data + axis checks that make a chart honest).
export { runGates as gate } from './gates.mjs';   // the registry's gate hook: this kind's own gates
export { look, render, ship, sound } from '../motion/index.mjs';

// the capability catalog entry (K2, SCHEMAS "The capability entry") — catalog.json is the DATA;
// this line just serves it. The registry scan carries it into `studio capabilities`
// automatically: no catalog edit, no CLI of its own.
export const capability = readJson(fileURLToPath(new URL('./catalog.json', import.meta.url)));
