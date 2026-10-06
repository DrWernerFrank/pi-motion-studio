// The P0 baseline capture: golden CLI transcripts (one command sequence per kind) + one draft
// render per kind with its md5, so the registry refactor (K1) can prove "zero behavior change".
//   node engine/produce/baseline.mjs --out docs/produce/baseline        (capture: commit the result)
//   node engine/produce/baseline.mjs --out /tmp/after --compare docs/produce/baseline
// The temp films are films/verify-p-gold* and are always removed (also on failure). Transcripts are
// normalized: render seconds, cache-hit markers and sheet frame counts are stable, wall times are not.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';

const STUDIO = join(ROOT, 'studio');
const GOLD = 'verify-p-gold';                      // films/verify-p-gold{,-edit,-math}
const NASA = join(homedir(), '.cache', 'pi-motion-studio', 'fixtures', 'real', 'talking-head-original.webm');

// wall-clock timings are not behavior: normalize them before comparing. Durations that are
// themselves outputs (a voiced narration's length, a frame count) are deterministic, but the
// safe default is to mask every bare "<n>s" token — the drift a refactor could cause shows up
// in file names, exit codes and prose, which this keeps intact.
export const norm = (s) => s
  .replace(/\((\d+(\.\d+)?)s to render\)/g, '(Ns to render)')
  .replace(/\b(\d+(\.\d+)?)s\b/g, 'Ns');

const sh = (args, cwd = ROOT) => {
  const r = spawnSync(STUDIO, args, { cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');

// One draft render per kind, on a film of that kind that exists on every machine of this studio:
// motion studio-reel, edit demo-cut, math mathdemo (the film names are frozen in this file; the
// math draft name carries the pre-migration colon, the post-migration x — resolve by glob).
const DRAFTS = [
  { kind: 'motion', film: 'studio-reel', fmt: '9:16' },
  { kind: 'edit', film: 'demo-cut', fmt: '16:9' },
  { kind: 'math', film: 'mathdemo', fmt: '16:9' },
];
function draftFile(kind, film, fmt) {
  const out = join(ROOT, 'films', film, 'out');
  const slug = fmt.replace(':', 'x'), legacy = fmt; // 16x9 and (pre-migration) 16:9
  for (const name of [`draft-${slug}.mp4`, `draft-${legacy}.mp4`]) {
    const p = join(out, name);
    if (existsSync(p)) return p;
  }
  return null;
}

// The per-kind command sequences: everything the dispatcher routes by kind today (new/look/render/
// sound/gate + the kind-specific rows). Each row: [args] -> file.
function transcripts(dir) {
  const rows = [
    { file: 'help.txt', args: ['help'] },
    { file: 'new-motion.txt', args: ['new', GOLD, '--duration', '6', '--formats', '9:16'], wipe: true },
    { file: 'motion.txt', args: [['look', GOLD], ['render', GOLD, '--draft'], ['sound', GOLD], ['gate', GOLD]] },
    { file: 'new-edit.txt', args: ['new', `${GOLD}-edit`, '--edit'], wipe: true },
    { file: 'edit.txt', args: [['ingest', `${GOLD}-edit`, NASA, '--id', 'cam'],
      ['edit', `${GOLD}-edit`, 'add', '--src', 'cam', '--in', '1', '--out', '4', '--at', '0'],
      ['look', `${GOLD}-edit`], ['sound', `${GOLD}-edit`], ['gate', `${GOLD}-edit`]] },
    { file: 'new-math.txt', args: ['new', `${GOLD}-math`, '--math'], wipe: true },
    { file: 'math.txt', args: [['check', `${GOLD}-math`], ['sound', `${GOLD}-math`], ['look', `${GOLD}-math`],
      ['gate', `${GOLD}-math`], ['render', `${GOLD}-math`, '--draft']] },
  ];
  const t = {};
  for (const row of rows) {
    const file = join(dir, row.file);
    if (row.args.every((a) => Array.isArray(a))) {           // a sequence: concatenated, in order
      let s = '';
      for (const a of row.args) { const r = sh(a); s += `$ studio ${a.join(' ')}\n${norm(r.out.trim())}\n[exit ${r.code}]\n`; }
      t[row.file] = s;
    } else {
      const r = sh(row.args);
      t[row.file] = `$ studio ${row.args.join(' ')}\n${norm(r.out.trim())}\n[exit ${r.code}]\n`;
    }
    if (row.file === 'edit.txt') {
      // `studio list` rows for the gold films (scoped: the list also carries the studio's other
      // films, which legitimately change over the mission's life)
      const r = sh(['list']);
      const scoped = r.out.split('\n').filter((l) => l.startsWith(GOLD)).join('\n');
      t[row.file] += `$ studio list | grep ${GOLD}\n${scoped}\n[exit ${r.code}]\n`;
    }
    if (t[row.file] !== undefined) writeFileSync(file, t[row.file]);
  }
  return t;
}

function sweep() {   // always: temp films never survive (also on failure — the caller's finally)
  for (const f of [GOLD, `${GOLD}-edit`, `${GOLD}-math`]) {
    const d = join(ROOT, 'films', f);
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
}

function drafts(dir) {
  const out = {};
  for (const d of DRAFTS) {
    // render fresh (the SAME command the user runs — no cache bypass; both runs of this script
    // go through identical code paths, which is exactly the claim under test)
    sh(['render', d.film, '--draft', ...(d.kind === 'math' ? [] : ['--fmt', d.fmt])]);
    const f = draftFile(d.kind, d.film, d.fmt);
    if (!f) throw new Error(`no draft for ${d.kind} (${d.film} ${d.fmt}) — render failed?`);
    out[d.kind] = { film: d.film, fmt: d.fmt, file: f.replace(ROOT + '/', ''),
      bytes: statSync(f).size, md5: md5(f) };
  }
  writeFileSync(join(dir, 'drafts.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

export function capture({ out }) {
  mkdirSync(out, { recursive: true });
  try {
    const t = transcripts(out);
    const d = drafts(out);
    return { files: Object.keys(t), drafts: d };
  } finally { sweep(); }
}

// compare: run the capture into a scratch dir, then diff every file (transcripts normalized at
// capture time, so a byte compare is the contract). Returns the list of differences.
export function compare(baselineDir, scratchDir) {
  const diffs = [];
  const names = readdirSync(baselineDir);
  capture({ out: scratchDir });                       // fresh capture, same code path as the baseline
  for (const n of names) {
    if (n === 'regress.txt') continue;                // recorded separately (the regress baseline)
    const a = readFileSync(join(baselineDir, n), 'utf8'), b = readFileSync(join(scratchDir, n), 'utf8');
    if (a !== b) diffs.push({ file: n, a, b });
  }
  return diffs;
}

// CLI (guarded so the registry check can import this module): --out DIR [--compare BASELINE]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  const c = process.argv.indexOf('--compare');
  if (i < 0) { console.error('usage: node engine/produce/baseline.mjs --out DIR [--compare BASELINE_DIR]'); process.exit(2); }
  const outDir = process.argv[i + 1];
  if (c >= 0) {
    const diffs = compare(process.argv[c + 1], outDir);
    for (const d of diffs) {
      console.log(`!= ${d.file}`);
      const al = d.a.split('\n'), bl = d.b.split('\n');
      for (let k = 0; k < Math.max(al.length, bl.length); k++) if (al[k] !== bl[k]) console.log(`   - ${al[k] ?? ''}\n   + ${bl[k] ?? ''}`);
    }
    console.log(diffs.length ? `baseline: ${diffs.length} file(s) differ` : 'baseline: identical');
    process.exit(diffs.length ? 1 : 0);
  } else {
    const r = capture({ out: outDir });
    // the regress baseline: the four motion films' frame hashes + gate verdicts (docs/editing/baseline.json
    // already holds this — studio regress compares against it; record the verdict for completeness)
    const reg = sh(['regress']);
    writeFileSync(join(outDir, 'regress.txt'), norm(reg.out.trim()) + `\n[exit ${reg.code}]\n`);
    console.log(`captured ${r.files.join(', ')} + regress.txt + drafts.json into ${outDir}`);
    console.log(Object.entries(r.drafts).map(([k, v]) => `  ${k}: ${v.file} md5 ${v.md5}`).join('\n'));
  }
}
