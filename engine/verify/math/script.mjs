// script (P5): the script.md parser and lint, through the REAL path (parseScript -> script.py under the
// memory guard). Stable ids when OTHER sentences are inserted/reordered/removed; bookmarks parse (span ids,
// spoken text, the word each points at); duplicate ids, a missing id and an unknown scene rejected WITH
// LINE NUMBERS; sentences.json round-trips (parse -> write -> parse identical, and script.md regenerated
// from it parses back to the same sentences); the lint flags raw symbols (x^2 = 5 and λ).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMathFilm } from '../../math-cli.mjs';
import { parseScript, sentencesPath } from '../../narration.mjs';
import { runCapped } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { FILMS } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-script';

const BASE = `# Script fixture

# scene s01_hook: the question
[s01.1] What does a determinant actually do? {shows}Watch the unit square{applies} as a matrix acts on the plane.

# scene s02_meaning: the formula
[s02.1] For a two by two matrix, the determinant is ad minus bc.
[s02.2] Here: three times two, minus one times one. {lands}Five.

# scene s03_recap: the takeaway
[s03.1] A determinant is the area scale factor.
`;
// the same film after an edit: a sentence inserted before s01.1, s02.2 moved above s02.1, a new one appended,
// s03.1 untouched — no untouched sentence may change its id, text or bookmarks
const EDITED = `# Script fixture

# scene s01_hook: the question
[s01.7] A new opening line.
[s01.1] What does a determinant actually do? {shows}Watch the unit square{applies} as a matrix acts on the plane.

# scene s02_meaning: the formula
[s02.2] Here: three times two, minus one times one. {lands}Five.
[s02.1] For a two by two matrix, the determinant is ad minus bc.
[s02.9] Inserted in the middle.

# scene s03_recap: the takeaway
[s03.1] A determinant is the area scale factor.
`;

export default async () => {
  const bad = [], facts = [];
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  createMathFilm(KEY, { title: 'script fixture' });
  const put = (src) => writeFileSync(join(dir, 'script.md'), src);
  const rejects = async (src, wantLine, wantWords, what) => {
    put(src);
    try { await parseScript(KEY); bad.push(`${what}: accepted, wanted a rejection`); return null; }
    catch (e) {
      const msg = String(e.message);
      if (!msg.includes(wantLine)) bad.push(`${what}: message lacks the line number "${wantLine}": ${msg}`);
      for (const w of wantWords) if (!msg.toLowerCase().includes(w)) bad.push(`${what}: message lacks "${w}": ${msg}`);
      return msg;
    }
  };
  try {
    // 1. stable ids
    put(BASE);
    const a = (await parseScript(KEY)).sentences;
    put(EDITED);
    const b = (await parseScript(KEY)).sentences;
    const strip = (s) => JSON.stringify({ ...s, line: undefined });
    for (const s of a) {
      const t = b.find((x) => x.id === s.id);
      if (!t) bad.push(`stable ids: ${s.id} vanished after editing OTHER sentences`);
      else if (strip(s) !== strip(t)) bad.push(`stable ids: ${s.id} changed: ${strip(s)} -> ${strip(t)}`);
    }
    if (b.map((s) => s.id).join(',') !== 's01.7,s01.1,s02.2,s02.1,s02.9,s03.1') bad.push(`edited order: ${b.map((s) => s.id)}`);
    else facts.push(`stable ids: ${a.length} untouched sentences identical after insert+reorder (order follows the file)`);

    // 2. bookmarks
    const h = a.find((s) => s.id === 's01.1'), l = a.find((s) => s.id === 's02.2');
    const words = h.spoken.split(' ');
    if (h.spoken !== 'What does a determinant actually do? Watch the unit square as a matrix acts on the plane.') bad.push(`spoken text: ${JSON.stringify(h.spoken)}`);
    if (JSON.stringify(h.bookmarks.map((x) => x.id)) !== '["shows","applies"]') bad.push(`bookmark ids: ${JSON.stringify(h.bookmarks)}`);
    if (words[h.bookmarks[0].at_word] !== 'Watch' || words[h.bookmarks[1].at_word] !== 'as') bad.push(`bookmark words: ${h.bookmarks.map((x) => words[x.at_word])}`);
    if (l.spoken !== 'Here: three times two, minus one times one. Five.' || l.spoken.split(' ')[l.bookmarks[0].at_word] !== 'Five.') bad.push(`s02.2 bookmark/spoken: ${JSON.stringify(l)}`);
    if (h.scene !== 's01_hook' || l.scene !== 's02_meaning') bad.push('scene membership wrong');
    if (!bad.length) facts.push('bookmarks: {shows}->"Watch", {applies}->"as", {lands}->"Five.", spans removed from spoken');

    // 3. rejections with line numbers
    const dupe = BASE.replace('[s02.2] Here', '[s02.1] Here'); // line 8 duplicates line 7
    await rejects(dupe, 'script.md:8', ['duplicate', 's02.1', 'line 7'], 'duplicate id');
    await rejects(BASE.replace('[s02.2] Here', 'Here'), 'script.md:8', ['without a sentence id'], 'missing id');
    await rejects(BASE.replace('[s02.2] Here', '[2.2] Here'), 'script.md:8', ['bad or missing sentence id'], 'malformed id');
    await rejects(BASE.replace('{lands}Five', '{lands Five'), 'script.md:8', ['never closes'], 'unclosed span');
    // unknown scene: a scenes/*.py declares a scene the script never mentions -> named at the .py line
    writeFileSync(join(dir, 'scenes', 's04_extra.py'), 'from studio_manim import *\n\n\nclass Extra(StudioScene):\n    scene_id = "s04_extra"\n');
    const um = await rejects(BASE, 's04_extra.py:5', ['unknown scene', 's04_extra'], 'unknown scene');
    rmSync(join(dir, 'scenes', 's04_extra.py'));
    // a script scene with no .py file only warns
    put(BASE + '\n# scene s09_orphan: no file\n[s09.1] Nobody animates this.\n');
    const w = await parseScript(KEY);
    if (!w.warnings.some((x) => x.includes('s09_orphan') && /script\.md:\d+/.test(x))) bad.push(`orphan scene: no warning (${JSON.stringify(w.warnings)})`);
    if (um) facts.push(`rejected with line numbers: duplicate (script.md:8, first at line 7), missing id, malformed id, unclosed span; unknown scene at ${um.match(/scenes\/\S+:\d+/)?.[0]}; orphan scene warns`);

    // 4. sentences.json round-trips
    put(BASE);
    await parseScript(KEY);
    const j1 = readFileSync(sentencesPath(KEY), 'utf8');
    await parseScript(KEY);
    const j2 = readFileSync(sentencesPath(KEY), 'utf8');
    if (j1 !== j2) bad.push('sentences.json differs between two parses of the same script');
    // script.md regenerated from sentences.json (the GUI edit path) parses back to the same sentences
    const tmp = join(dir, 'out', 'roundtrip');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'doc.json'), j1);
    const prog = `import json,sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'engine', 'manim', 'studio_manim'))})\nimport script as S\nd=json.load(open(sys.argv[1]))\nmd=S.to_markdown(d)\nd2,_=S.parse_text(md)\nstrip=lambda x:[{k:v for k,v in s.items() if k!='line'} for s in x['sentences']]\nprint(json.dumps({'same': strip(d)==strip(d2) and d['scenes']==d2['scenes'], 'md': md}))`;
    const r = await runCapped(pythonFor('manim'), ['-c', prog, join(tmp, 'doc.json')], { memoryMb: 1024, timeoutS: 120, label: 'roundtrip' });
    const rt = JSON.parse(r.out.trim() || '{}');
    if (!rt.same) bad.push(`to_markdown -> parse is not identical (${r.err.trim().slice(-300)})`);
    if (JSON.parse(j1).version !== 1) bad.push('sentences.json version != 1');
    if (j1 === j2 && rt.same) facts.push('sentences.json: re-parse byte-identical; sentences.json -> script.md -> parse identical');

    // 5. the lint
    put(BASE + '[s03.2] The determinant of x^2 = 5 and λ is the eigenvalue.\n');
    const { lint } = await parseScript(KEY);
    const got = lint.filter((x) => x.id === 's03.2').map((x) => x.char);
    for (const c of ['^', '=', 'λ']) if (!got.includes(c)) bad.push(`lint missed '${c}' in s03.2 (got ${JSON.stringify(got)})`);
    if (lint.some((x) => x.id !== 's03.2')) bad.push(`lint false positive: ${JSON.stringify(lint.filter((x) => x.id !== 's03.2'))}`);
    if (got.length === 3) facts.push(`lint flags ${got.join(' ')} in s03.2 (sentence id + char), nothing elsewhere`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
