// scene-cache (P6): unchanged re-render < 10% of cold; one changed scene re-renders only it;
// one changed sentence re-renders only its scene; a palette change invalidates everything;
// formats never share partials. slow (renders) — but each render is draft-serial through the guard.
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SCENE_CACHE, renderMathFilm } from '../../math.mjs';
import { createMathFilm } from '../../math-cli.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';

const KEY = 'verify-m-sc';
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 12);

export default async () => {
  const bad = [], facts = [];
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  rmSync(SCENE_CACHE, { recursive: true, force: true }); // a genuinely cold cache
  createMathFilm(KEY, { title: 'scene-cache fixture' });
  try {
    // keep the TEMPLATE script (the starter scenes say() s01.1/s02.1/s02.2/s03.1 — a custom
    // 3-sentence script made say("s02.2") a hard error, which is the clock's validation working)
    const { buildVoice } = await import('../../narration.mjs');
    await buildVoice(KEY);

    // 1. cold full draft (every scene renders)
    const t0 = Date.now();
    const cold = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    const tCold = (Date.now() - t0) / 1000;
    if (cold[0].rendered !== 3 || cold[0].cached !== 0) bad.push(`cold: rendered ${cold[0].rendered}, cached ${cold[0].cached} (wanted 3/0)`);
    const coldMd5 = md5(join(dir, 'out', 'draft-16:9.mp4'));

    // 2. unchanged warm: < 10% of cold, all cached, byte-identical output
    const t1 = Date.now();
    const warm = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    const tWarm = (Date.now() - t1) / 1000;
    if (warm[0].cached !== 3) bad.push(`warm: cached ${warm[0].cached} (wanted 3)`);
    if (tWarm >= tCold * 0.10) bad.push(`warm re-render ${tWarm.toFixed(1)}s is not < 10% of cold ${tCold.toFixed(1)}s`);
    const warmMd5 = md5(join(dir, 'out', 'draft-16:9.mp4'));
    if (warmMd5 !== coldMd5) bad.push(`warm output differs from cold (${warmMd5} vs ${coldMd5}) — the cache is not transparent`);
    facts.push(`cold ${tCold.toFixed(1)}s (3 rendered) → warm ${tWarm.toFixed(1)}s (${((tWarm / tCold) * 100).toFixed(1)}%, 3 cached), md5 identical`);

    // 3. touch ONE scene's source → only it re-renders; then RESTORE + re-prime (the restore is
    // itself a content change — without re-priming, the next clause would count it)
    const s01 = join(dir, 'scenes', 's01_hook.py');
    const s01Original = readFileSync(s01, 'utf8');
    writeFileSync(s01, s01Original + '\n# a comment: content change\n');
    const r3 = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    if (r3[0].rendered !== 1 || r3[0].cached !== 2) bad.push(`one scene changed: rendered ${r3[0].rendered} cached ${r3[0].cached} (wanted 1/2)`);
    facts.push('one scene source changed -> 1 rendered, 2 cached');
    writeFileSync(s01, s01Original);
    const r3b = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    if (r3b[0].rendered !== 1 || r3b[0].cached !== 2) bad.push(`restore re-prime: rendered ${r3b[0].rendered} cached ${r3b[0].cached} (wanted 1/2)`);

    // 4. change ONE SENTENCE (in s03 — the last scene): re-voice only it, re-render only its scene
    const before = Date.now();
    const scriptPath = join(dir, 'script.md');
    writeFileSync(scriptPath, readFileSync(scriptPath, 'utf8')
      .replace('[s03.1] A determinant is the area scale factor. Five means five times the area.',
               '[s03.1] A determinant is the area scale factor. Five means five times the area, always.'));
    await buildVoice(KEY, { only: 's03.1' });
    const r4 = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    if (r4[0].rendered !== 1 || r4[0].cached !== 2) bad.push(`one sentence changed: rendered ${r4[0].rendered} cached ${r4[0].cached} (wanted 1/2)`);
    facts.push('one sentence re-voiced -> only its scene re-rendered (1/2)');

    // 5. palette change (design.json) -> everything re-renders
    const design = readJson(join(dir, 'design.json'));
    design.colors = { ...design.colors, ink: '#221F18' };
    writeJson(join(dir, 'design.json'), design);
    const r5 = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    if (r5[0].rendered !== 3) bad.push(`design changed: rendered ${r5[0].rendered} (wanted 3 — a palette change invalidates everything)`);
    facts.push('palette change -> 3 rendered');

    // 6. formats never share partials: render 9:16 after 16:9's cache is warm -> 3 rendered (new keys)
    const r6 = await renderMathFilm(KEY, { quality: 'draft', fmt: '9:16' });
    if (r6[0].rendered !== 3) bad.push(`9:16 after 16:9: rendered ${r6[0].rendered} (wanted 3 — formats never share partials)`);
    facts.push('9:16 renders fresh (formats keyed separately)');
    const again = await renderMathFilm(KEY, { quality: 'draft', fmt: '9:16' });
    if (again[0].cached !== 3) bad.push(`9:16 warm: cached ${again[0].cached} (wanted 3)`);

    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
