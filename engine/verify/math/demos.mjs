// demos (P12): the three demo films — finals in 16:9 + 9:16, 45-120 s, narrated, gates PASS, lint
// clean in both formats, >= 15 claims each all verified, >= 90% of mathematical sentences linked
// to a claim, no placeholder text. slow (six 1080p60 final renders, serial through the guard).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPS, MemPool } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { renderMathFilm } from '../../math.mjs';
import { runMathGates } from '../../math-gates.mjs';
import { readJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const DEMOS = ['determinant', 'tangent', 'odd-squares'];
const PY = pythonFor('manim');

const lintOf = async (pool, key, fmt) => {
  const r = await pool.run({
    cmd: PY, args: ['-m', 'studio_manim.lint', join(ROOT, 'films', key, 'records', fmt),
      join(ROOT, 'films', key, 'design.json'), fmt],
    cwd: join(ROOT, 'engine', 'manim', 'test'), memoryMb: CAPS.check, timeoutS: 180,
    label: `lint ${key} ${fmt}`, env: { STUDIO_FORMAT: fmt, PYTHONPATH: join(ROOT, 'engine', 'manim') },
  });
  if (r.killed || r.code !== 0) return { error: (r.err || r.out).split('\n').slice(-2).join(' | ') };
  // lint prints pretty (indent=1) JSON, so a violations list spans lines — parse the whole
  // array (the same robust slice math-gates.mjs's parseList uses), never just the last line
  const s = r.out.slice(r.out.indexOf('['), r.out.lastIndexOf(']') + 1);
  return { list: JSON.parse(s || '[]') };
};

export default async () => {
  const bad = [], facts = [], pool = new MemPool();
  for (const key of DEMOS) {
    const dir = join(ROOT, 'films', key);
    const cfg = readJson(join(dir, 'film.json'), {});
    if (cfg.kind !== 'math') { bad.push(`${key} is not a math film`); continue; }

    // 1. the final renders (16:9 + 9:16 — the film's own formats), fresh (no cache games)
    const finals = await renderMathFilm(key, { quality: 'final', noCache: true });
    if (finals.length !== 2) bad.push(`${key}: final render returned ${finals.length} formats`);
    const durs = finals.map((x) => x.seconds);
    const total = durs[0];
    if (!(total >= 45 && total <= 120)) bad.push(`${key}: ${total}s is outside 45-120 s`);
    facts.push(`${key}: finals ${finals.map((x) => `${x.fmt} ${x.seconds}s`).join(' + ')}`);

    // 2. gates on the finals' film (the deliverable probe reads out/final-*)
    const g = await runMathGates(key, { log: () => {}, write: true });
    const failGates = g.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => c.name);
    if (failGates.length) bad.push(`${key}: gates FAIL [${failGates.join(',')}]`);
    else facts.push(`${key}: gates PASS`);

    // 3. lint clean in BOTH formats (the real records)
    for (const fmt of ['16:9', '9:16']) {
      const L = await lintOf(pool, key, fmt);
      if (L.error) bad.push(`${key} ${fmt}: lint crashed ${L.error}`);
      else {
        const fails = L.list.filter((v) => v.level === 'fail');
        if (fails.length) bad.push(`${key} ${fmt}: ${fails.length} lint FAILs (${fails.slice(0, 2).map((v) => `${v.rule}@${v.t}`).join(', ')})`);
      }
    }
    facts.push(`${key}: lint 0 fail both formats`);

    // 4. claims: >= 15, all verified, >= 90% of mathematical sentences linked
    const ledger = new Map();
    for (const fmt of ['16:9', '9:16'])
      for (const f of readdirSync(join(dir, 'records', fmt))) {
        if (!f.endsWith('-claims.json')) continue;
        for (const c of JSON.parse(readFileSync(join(dir, 'records', fmt, f), 'utf8')) || [])
          if (!ledger.has(c.expr + '|' + (c.says ?? ''))) ledger.set(c.expr + '|' + (c.says ?? ''), c);
      }
    const claims = [...ledger.values()];
    const notOk = claims.filter((c) => c.ok !== true);
    if (claims.length < 15) bad.push(`${key}: ${claims.length} claims (< 15)`);
    if (notOk.length) bad.push(`${key}: ${notOk.length} claims not ok`);
    const sentences = readJson(join(dir, 'sentences.json'), {}).sentences ?? [];
    const MATH_WORDS = /equals|^is$|^are$|\bis\b|\bare\b|\btimes\b|\bplus\b|\bminus\b|\bgives\b|\bbecomes\b|\badds\b|\bscales\b|\d/i;
    const mathIds = sentences.filter((s) => MATH_WORDS.test(s.text)).map((s) => s.id);
    const linked = new Set(claims.filter((c) => c.says).map((c) => c.says));
    const linkedMath = mathIds.filter((id) => linked.has(id));
    const pct = mathIds.length ? Math.round((100 * linkedMath.length) / mathIds.length) : 100;
    if (pct < 90) bad.push(`${key}: coverage ${pct}% (${linkedMath.length}/${mathIds.length}) < 90%`);
    facts.push(`${key}: ${claims.length} claims all ok, coverage ${pct}% (${linkedMath.length}/${mathIds.length})`);

    // 5. no placeholder text: sweep the scene sources and script for stub markers
    const PLACEHOLDER = /TODO|FIXME|placeholder|PLACEHOLDER|lorem|\bXX\b|\bTBD\b/i;
    const srcs = readdirSync(join(dir, 'scenes')).map((f) => readFileSync(join(dir, 'scenes', f), 'utf8')).join('\n')
      + readFileSync(join(dir, 'script.md'), 'utf8');
    if (PLACEHOLDER.test(srcs)) bad.push(`${key}: placeholder text present`);
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 600) : facts.join('; ') };
};
