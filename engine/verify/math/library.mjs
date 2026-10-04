// library (P7): every kit component renders in ALL FOUR formats with zero lint violations and
// zero failed claims; every ```python block in kit.md executes; the public API is frozen in the
// docs. Renders films/verify-m-kit (glm-kit's showcase: s01_plane, s02_steps, s03_gnomons) in
// 16:9/9:16/1:1/4:5 + the examples battery. slow (5 renders) but draft-serial.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CAPS, MemPool } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { renderMathFilm } from '../../math.mjs';
import { run } from '../../lib/proc.mjs';
import { readJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-kit';
const PY = pythonFor('manim');
const ENV = { STUDIO_FORMAT: '16:9', PYTHONPATH: join(ROOT, 'engine', 'manim') };

export default async () => {
  const bad = [], facts = [];
  const pool = new MemPool();
  const dir = join(ROOT, 'films', KEY);
  if (!existsSync(join(dir, 'film.json'))) return { pass: false, measured: 'films/verify-m-kit is missing — the kit showcase is the fixture (glm-kit built it; it is committed)' };

  // 1. the examples battery: every kit.md ```python block, both formats (no render)
  for (const fmt of ['16:9', '9:16']) {
    const r = await pool.run({
      cmd: PY, args: [join(ROOT, 'engine', 'manim', 'test', 'kit-examples.py'), '--format', fmt],
      cwd: join(ROOT, 'engine', 'manim', 'test'), memoryMb: CAPS.check, timeoutS: 300,
      label: `kit examples ${fmt}`, env: { ...ENV, STUDIO_FORMAT: fmt },
    });
    if (r.killed || r.code !== 0) bad.push(`kit-examples ${fmt}: ${(r.err || r.out).split('\n').filter(Boolean).slice(-2).join(' | ')}`);
    else {
      const ok = (r.out.match(/^ok /gm) || []).length, skip = (r.out.match(/^SKIP /gm) || []).length;
      const fail = (r.out.match(/FAIL/g) || []).length;
      if (fail) bad.push(`kit-examples ${fmt}: ${fail} failed blocks`);
      facts.push(`${fmt}: ${ok} ok, ${skip} skip, ${fail} fail`);
    }
  }

  // 2. every component renders in ALL FOUR formats: the showcase film, fresh (cache-invalidated
  //    by design — a stale pass proves nothing)
  const claims = {};
  for (const fmt of ['16:9', '9:16', '1:1', '4:5']) {
    const rows = await renderMathFilm(KEY, { quality: 'draft', fmt, noCache: true });
    const seconds = rows[0]?.seconds ?? 0;
    // lint the real records of this format
    const lint = await pool.run({
      cmd: PY, args: ['-m', 'studio_manim.lint', join(dir, 'records', fmt), join(dir, 'design.json'), fmt],
      cwd: join(ROOT, 'engine', 'manim', 'test'), memoryMb: CAPS.check, timeoutS: 120,
      label: `lint ${fmt}`, env: { ...ENV, STUDIO_FORMAT: fmt },
    });
    const violations = JSON.parse((lint.out || '[]').trim().split('\n').at(-1) || '[]');
    const fails = violations.filter((v) => v.level === 'fail');
    if (fails.length) bad.push(`${fmt}: ${fails.length} lint FAILs (${fails.slice(0, 2).map((v) => `${v.rule}@${v.t}s`).join(', ')})`);
    else facts.push(`${fmt}: ${seconds}s, lint 0 fail (${violations.length} warn)`);
    // claims: every ledger entry ok:true in every format
    const led = [];
    for (const f of readdirSync(join(dir, 'records', fmt))) {
      if (!f.endsWith('-claims.json')) continue;
      for (const c of JSON.parse(readFileSync(join(dir, 'records', fmt, f), 'utf8')) || []) led.push(c);
    }
    const notOk = led.filter((c) => c.ok !== true);
    if (notOk.length) bad.push(`${fmt}: ${notOk.length} failed claims`);
    claims[fmt] = led.length;
  }
  facts.push(`claims: ${JSON.stringify(claims)} all ok`);

  // 3. the API is frozen in the docs: kit.md's component list == kit.py's __all__
  const kitPy = readFileSync(join(ROOT, 'engine', 'manim', 'studio_manim', 'kit.py'), 'utf8');
  const all = /__all__\s*=\s*\[([^\]]+)\]/.exec(kitPy)?.[1].split(',').map((s) => s.trim().replace(/['"]/g, '')) ?? [];
  const kitMd = readFileSync(join(ROOT, 'engine', 'manim', 'kit.md'), 'utf8');
  const missingInDocs = all.filter((n) => !kitMd.includes(n));
  if (missingInDocs.length) bad.push(`API not frozen in kit.md: ${missingInDocs.join(', ')}`);
  else facts.push(`API frozen: ${all.length} names documented`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 500) : facts.join('; ') };
};
