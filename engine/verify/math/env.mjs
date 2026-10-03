// env (P1): `studio doctor --math` resolves the math toolchain. The check shells the CLI so the
// probes run exactly as the user sees them (doctor's own probes: Manim pinned against
// engine/manim/requirements.lock, pycairo/manimpango wheels, sympy, a probe formula through the
// typesetting backend -> SVG, the bundled fonts through Pango, a voice that speaks, ASR, ffmpeg).
// The plain editing `env` check stays verify-edit's; this one is the math contract's row.
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { ROOT } from '../../lib/serve.mjs';

export default async () => {
  const r = await run(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'doctor', '--math'], { cwd: ROOT, allowFail: true });
  const lines = r.out.split('\n').filter((l) => /^(ok|FAIL|warn)/.test(l));
  const bad = lines.filter((l) => /^FAIL/.test(l));
  const mathRows = lines.filter((l) => /Manim|pycairo|sympy|Typst|Pango|piper|Persian voice|kokoro/.test(l));
  const measured = `${lines.length} probes (${mathRows.length} math), ${bad.length} red` +
    (bad.length ? `: ${bad.map((l) => l.replace(/^FAIL\s+/, '').split(/\s{2,}/)[0]).join(', ')}` : '');
  return { pass: r.code === 0 && bad.length === 0, measured };
};
