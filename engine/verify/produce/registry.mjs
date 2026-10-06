// registry (P1): the kind registry holds, nothing dispatches by raw kind checks anymore, and the
// refactor changed nothing observable (ADR-001: golden transcripts + one draft md5 per kind ==
// the P0 baselines). Seeded faults prove both gates bite.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compare } from '../../produce/baseline.mjs';
import { ROOT } from '../../lib/serve.mjs';

// The naming migration (P1, after the registry) renames the math outputs' file names from the
// legacy `16:9` form to the Windows-safe `16x9` — an INTENTIONAL, separately-checked change. The
// registry comparison canonizes both sides to the modern form so it stays meaningful at every
// later phase without masking any other drift.
const canon = (s) => s.replace(/(draft|final)-16:9\.mp4/g, '$1-16x9.mp4').replace(/(draft|final)-9:16\.mp4/g, '$1-9x16.mp4')
  .replace(/records[/\\]16:9/g, 'records/16x9').replace(/records[/\\]9:16/g, 'records/9x16');

export default async (ctx) => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. the kinds are registry modules with the required hooks (project lands with P2 — the row grows then)
  const { allKinds, REQUIRED } = await import('../../kinds/registry.mjs');
  const kinds = await allKinds();
  for (const k of ['motion', 'edit', 'math']) need(!!kinds[k], `kind "${k}" is not a registry module (engine/kinds/${k}/index.mjs)`);
  const found = Object.keys(kinds).sort();
  for (const [name, mod] of Object.entries(kinds)) {
    const missing = REQUIRED.filter((h) => typeof mod[h] !== 'function');
    need(!missing.length, `kind "${name}" misses required hook(s): ${missing.join(', ')}`);
  }
  facts.push(`kinds behind the registry: ${found.join(', ')} (required: ${REQUIRED.join(', ')})`);

  // 2. the grep gate: no raw FILM-KIND check outside engine/kinds/ (+ lib/film.mjs, kindOf/requireKind's
  //    home). The pattern targets the film-kind concept only — `cfg.kind ===` reads of the film
  //    config, and comparisons against the film-kind literals (math|edit|motion|project) — so the
  //    dozens of legitimate track/clip/source/trace `.kind === 'video'` reads do not trip it.
  const grep = (args) => { const r = spawnSync('grep', args, { cwd: ROOT, encoding: 'utf8' }); return (r.stdout || '').split('\n').filter(Boolean); };
  const FILM_KIND = ['-e', String.raw`cfg\s*\??\.\s*kind\s*[!=]==`, '-e', String.raw`\.kind\s*[!=]==\s*['"](?:math|edit|motion|project)['"]`];
  const mjs = grep(['-rl', '--include=*.mjs', ...FILM_KIND, 'engine', 'studio-gui']);
  const offenders = mjs.filter((f) => !f.startsWith('engine/kinds/') && f !== 'engine/lib/film.mjs');
  need(!offenders.length, `raw film-kind checks outside the registry: ${offenders.join(', ')}`);
  const ts = grep(['-rl', '--include=*.ts', ...FILM_KIND, join(ROOT, '.pi', 'extensions')]);
  need(!ts.length, `raw film-kind checks in the tools: ${ts.join(', ')}`);
  facts.push('grep gate: 0 raw film-kind checks outside engine/kinds/ + lib/film.mjs (track/clip/source kinds are a different concept and stay free)');

  // 3. a kind module missing a required hook fails loudly, naming kind and hook (seeded fault,
  //    in a temp dir inside kinds/ so the registry's scan finds it; always removed)
  const brokenDir = join(ROOT, 'engine', 'kinds', 'verify-broken');
  rmSync(brokenDir, { recursive: true, force: true });
  mkdirSync(brokenDir, { recursive: true });
  try {
    writeFileSync(join(brokenDir, 'index.mjs'), '// a seeded fault: no hooks at all\nexport const DOC = "broken on purpose";\n');
    let loud = null;
    try { await (await import('../../kinds/registry.mjs?seed' + Date.now())).allKinds(); }
    catch (e) { loud = String(e.message || e); }
    need(/missing required hook\(s\): create/.test(loud ?? ''), `a hookless kind module did not fail loudly (got: ${loud})`);
    need(/verify-broken/.test(loud ?? ''), 'the loud failure does not name the kind');
    facts.push('seeded fault: a hookless kind module fails loudly naming the kind + every missing hook');
  } finally { rmSync(brokenDir, { recursive: true, force: true }); }

  // 4. golden transcripts + one draft md5 per kind == the P0 baselines (ADR-001's whole point)
  const scratch = join(ctx.cache, 'baseline-after');
  rmSync(scratch, { recursive: true, force: true });
  const diffs = compare(join(ROOT, 'docs', 'produce', 'baseline'), scratch);
  const drift = diffs.filter((d) => canon(d.a) !== canon(d.b));
  need(!drift.length, `golden CLI transcripts/drafts drifted: ${drift.map((d) => d.file).join(', ')}`);
  const drafts = existsSync(join(scratch, 'drafts.json')) ? JSON.parse(readFileSync(join(scratch, 'drafts.json'), 'utf8')) : {};
  const base = JSON.parse(readFileSync(join(ROOT, 'docs', 'produce', 'baseline', 'drafts.json'), 'utf8'));
  for (const k of ['motion', 'edit', 'math']) {
    need(drafts[k]?.md5 && base[k]?.md5 && drafts[k].md5 === base[k].md5, `${k} draft md5 drifted (${drafts[k]?.md5} vs ${base[k]?.md5})`);
  }
  facts.push(`golden transcripts identical; draft md5s: ${['motion', 'edit', 'math'].map((k) => `${k} ${base[k].md5.slice(0, 8)}`).join(' / ')}`);

  // 5. verify-edit's docs check still bites after the refactor: a command in the dispatcher but
  //    not in help goes red (seeded fault, atomic swap + guaranteed restore)
  const cli = join(ROOT, 'engine', 'cli.mjs');
  const backup = join(ctx.cache, 'cli.mjs.bak');
  const src = readFileSync(cli, 'utf8');
  const anchor = "    case undefined: case 'help': case '--help': case '-h':";
  need(src.includes(anchor), 'cli.mjs help-case anchor not found (the seeded fault needs it)');
  const seeded = src.replace(anchor, "    case 'verify-seeded': break;\n" + anchor);
  copyFileSync(cli, backup);                      // restore source (the repo is on 9p: rename across
  writeFileSync(cli, seeded);                     // devices is EXDEV, so copy+write+finally-restore)
  try {
    const r = spawnSync(process.execPath, ['-e',
      'const { pathToFileURL } = require("node:url"); import(pathToFileURL(process.argv[1]).href).then(m => m.default()).then(r => { console.log("RESULT " + JSON.stringify(r)); process.exit(r.pass ? 0 : 1); }).catch(e => { console.error(String(e)); process.exit(1); })',
      join(ROOT, 'engine', 'verify', 'docs.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const out = r.stdout || '';
    need(!/RESULT \{"pass":true/.test(out), 'the seeded fault (a case not in help) did not make verify-edit docs red');
    need(/verify-seeded/.test(out), `the seeded fault does not name the missing command (got: ${out.slice(0, 200)})`);
    facts.push('seeded fault: verify-edit docs goes red naming "verify-seeded" (the case-label grep still bites)');
  } finally { copyFileSync(backup, cli); }

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
