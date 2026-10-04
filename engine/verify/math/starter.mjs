// starter (P9): the golden path unattended — studio new from templates/math/ -> voice -> render
// (draft) -> gate -> ship, in 16:9 AND 9:16, every gate passing, outputs probe clean. This is the
// check that keeps the scaffold from ever rotting. slow (finals + a ship).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { readJson } from '../../lib/film.mjs';

const KEY = 'verify-m-starter';
const CLI = join(ROOT, 'engine', 'cli.mjs');
const sh = async (...args) => { const r = await run(process.execPath, [CLI, ...args], { cwd: ROOT, allowFail: true });
  return { code: r.code, out: r.out, err: r.err }; };

export default async () => {
  const bad = [], facts = [];
  const dir = join(ROOT, 'films', KEY);
  rmSync(dir, { recursive: true, force: true });
  try {
    // 1. scaffold from the template, unattended
    let r = await sh('new', KEY, '--math', '--title', 'starter golden path');
    if (r.code !== 0) return { pass: false, measured: `new --math failed: ${r.err.slice(0, 200)}` };
    facts.push('scaffolded from templates/math');
    for (const f of ['script.md', 'design.json', 'lexicon.json', 'brief.md', 'film.json', 'scenes/s01_hook.py'])
      if (!existsSync(join(dir, f))) bad.push(`missing ${f} in the scaffold`);

    // 2. voice -> timing + mix (the CLI sound case dispatches for kind: math)
    r = await sh('sound', KEY);
    if (r.code !== 0) bad.push(`sound failed: ${(r.err || r.out).slice(0, 300)}`);
    else facts.push('voiced + mixed via the CLI');
    const timing = readJson(join(dir, 'timing.json'), {});
    if (!(timing.sentences?.length >= 3)) bad.push(`timing.json holds ${timing.sentences?.length ?? 0} sentences`);

    // 3. draft render both formats
    r = await sh('render', KEY, '--draft');
    if (r.code !== 0) bad.push(`render --draft failed: ${(r.err || r.out).split('\n').slice(-4).join(' | ')}`);
    else facts.push('draft rendered (CLI output: ' + r.out.trim().split('\n').at(-1).slice(0, 60) + ')');

    // 4. gate — every gate must pass (warnings allowed)
    r = await sh('gate', KEY);
    if (r.code !== 0) {
      const fails = [...r.out.matchAll(/FAIL\s+(\w+):/g)].map((m) => m[1]);
      bad.push(`gate FAIL: ${fails.join(', ') || (r.out.match(/FAIL[^\n]*/) || ['unknown'])[0]}`);
    } else facts.push('gates: PASS');

    // 5. ship — finals in every format + claims.md
    r = await sh('ship', KEY);
    if (r.code !== 0) bad.push(`ship failed: ${(r.err || r.out).split('\n').slice(-5).join(' | ')}`);
    else {
      const finals = readdirSync(join(dir, 'out')).filter((f) => /^final-.*\.mp4$/.test(f));
      if (!finals.length) bad.push('ship produced no final-*.mp4');
      else facts.push(`shipped: ${finals.join(', ')}`);
      if (!existsSync(join(dir, 'out', 'claims.md'))) bad.push('ship wrote no out/claims.md');
      else facts.push('claims.md written');
    }

    // 6. the deliverable probe: every final is a clean mp4
    for (const f of readdirSync(join(dir, 'out')).filter((x) => /\.mp4$/.test(x))) {
      const p = await run('ffprobe', ['-v', 'error', '-show_entries',
        'stream=width,height,pix_fmt,color_primaries:format=duration', '-of', 'csv=p=0', join(dir, 'out', f)], { allowFail: true });
      const [w, h, pix, prim, dur] = p.out.trim().split(',');
      if (pix !== 'yuv420p') bad.push(`${f}: pix_fmt ${pix}`);
      if (prim && prim !== 'bt709') bad.push(`${f}: primaries ${prim}`);
      facts.push(`${f}: ${w}x${h} ${pix} ${dur}s`);
    }
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 500) : facts.join('; ') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
