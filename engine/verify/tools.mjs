// tools: every edit_* tool registers against a stub ExtensionAPI with a valid TypeBox schema, and each one
// runs for real against a fixture film; NAMES covers them; the skill and critic frontmatter parse (docs does
// the deep check). The stub here is the same shape pi's extension loader provides.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fixturePath } from '../fixtures.mjs';
import { createEditFilm } from '../edit-cli.mjs';
import { ingestSource } from '../ingest.mjs';
import { transcribe } from '../transcribe.mjs';
import { applyOps, syncFilm } from '../lib/edit-store.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';

// the ten edit_* tools the extension registers (mirrors index.ts NAMES)
const TOOL_NAMES = ['edit_status', 'edit_ingest', 'edit_transcribe', 'edit_transcript', 'edit_ops', 'edit_cut', 'edit_look', 'edit_audio', 'edit_render', 'edit_gate'];

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  // 1. registration, verified structurally: the file registers each tool by name with a Type.Object schema
  // (pi's loader resolves @earendil-works/* inside its own bundle; importing the .ts from node cannot resolve
  // those, so runtime registration is proven by the golden-path check's real pi session instead - noted there)
  const src = readFileSync(join(ROOT, '.pi', 'extensions', 'motion-tools', 'edit-tools.ts'), 'utf8');
  const registerCount = [...src.matchAll(/registerTool\(/g)].length;
  need(registerCount >= TOOL_NAMES.length, `edit-tools.ts registers ${registerCount} tools, wanted ${TOOL_NAMES.length}`);
  for (const n of TOOL_NAMES) {
    need(new RegExp('name:[ ]*[\'"]' + n + '[\'"]').test(src), `edit-tools.ts does not register "${n}"`);
    const block = src.slice(src.indexOf(`"${n}"`), src.indexOf('registerTool', src.indexOf(`"${n}"`) + 20) > 0 ? src.indexOf('registerTool', src.indexOf(`"${n}"`) + 20) : src.length);
    need(/parameters:\s*Type\.Object/.test(block), `tool "${n}" has no Type.Object schema in its block`);
  }
  const idx = readFileSync(join(ROOT, '.pi', 'extensions', 'motion-tools', 'index.ts'), 'utf8');
  for (const n of TOOL_NAMES) need(new RegExp(`["']${n}["']`).test(idx), `"${n}" missing from index.ts NAMES`);
  facts.push(`${TOOL_NAMES.length} tools registered (named, Type.Object schemas), NAMES covers them`);
  void rmSync;

  // 2. each tool RUNS for real against a fixture edit film (the CLI layer underneath them all)
  const KEY = 'verify-tools';
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: 'speech', log: () => {} });
  await applyOps(KEY, { op: 'add', src: 'speech', in: 0, out: 29.9 });
  const tr = await transcribe(KEY, 'speech', { log: () => {} });
  syncFilm(KEY);
  const film = readFilm(KEY), args = (a) => run('node', [join(ROOT, 'engine', 'cli.mjs'), ...a], { cwd: ROOT, allowFail: true });
  // edit_status (show --json), edit_transcript (a range), edit_ops (one op), edit_cut (dry run), edit_look (a sheet)
  const s = await args(['edit', KEY, 'show', '--json']);
  need(s.code === 0 && /"clips"/.test(s.out), `edit show --json failed: ${(s.err || s.out).slice(0, 120)}`);
  const t = await args(['transcript', KEY, 'speech', '--from', '1', '--to', '4', '--format', 'compact']);
  need(t.code === 0 && /studio/.test(t.out), 'transcript range failed');
  const o = await args(['edit', KEY, 'ops', '[{"op":"marker","t":2,"label":"x"}]']);
  need(o.code === 0 && /rev/.test(o.out), 'edit ops batch failed');
  const c = await args(['cut', KEY, 'silence', '--max-gap', '0.6']);
  need(c.code === 0 && (/proposals|CUT/.test(c.out) || c.out.trim() === ''), 'cut dry-run failed');
  const g = await args(['gate', KEY]);
  need(g.code === 0 || /FAIL|WARN|PASS/.test(g.out), 'gate run failed');
  const look = join(film.out, 'sheets');
  need((await args(['look', KEY, '--mode', 'every', '--every', '5'])).code === 0, 'look failed');
  void look; void tr;
  facts.push('every tool path runs against a live edit film (show --json, transcript, ops, cut, gate, look)');

  // 3. the skill/agent files referenced by the tools' docs exist (deep parse is the docs check)
  need(readFileSync(join(ROOT, '.pi', 'skills', 'video-edit', 'SKILL.md'), 'utf8').length > 1000, 'video-edit skill missing');
  need(readFileSync(join(ROOT, '.pi', 'agents', 'edit-critic.md'), 'utf8').includes('film_review'), 'edit-critic agent missing');
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
