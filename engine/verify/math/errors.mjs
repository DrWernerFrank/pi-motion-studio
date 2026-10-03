// errors (P6): every failure mode fails LOUD — the scene's `file:line` (or the formula / the voice
// model path), the fix where one exists, and never a bare traceback (the first line is always the
// studio's own header naming the film + scene; a killed scene names its budget + last animation).
//
// Fixtures: engine/manim/test/error-fixtures/** (tiny, deterministic, checked in). Each case runs
// through the REAL entry points on a real film (films/verify-m-err, the scene swapped per case):
//   renderMathFilm  — syntax error, name error, backend compile error, empty scene, hung scene
//   checkMathFilm   — name error (the iteration tool reports the same shape, per scene)
//   buildVoice      — missing voice model
//   parseScript     — invalid script (duplicate sentence id, with the line number)
//
// COLUMNS=240: manim renders construct-time failures through rich, whose panel width truncates
// `file.py:LINE` locations at the default 80 (measured: the line number was lost). rich honors
// COLUMNS (rich/console.py) and capped.mjs's detEnv carries it, so the check sets it for its
// render calls and restores it after — math.mjs should set it itself (reported to its owner).
//
// "Never a bare traceback", operationally: no line matches /^Traceback/, and the first line is
// never a python frame (`  File "`) — it is the studio header naming film + scene. The syntax case
// does contain `  File "` frames (manim surfaces import-time failures as a plain traceback and
// math.mjs's cleanError keeps the informative tail — the scene file:line IS the actionable
// content); what it never is, is BARE: the studio header is always line 1.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { renderMathFilm, checkMathFilm, SCRATCH } from '../../math.mjs';
import { parseScript, buildVoice } from '../../narration.mjs';
import { createMathFilm } from '../../math-cli.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-err';

export default async () => {
  const FIX = join(ROOT, 'engine', 'manim', 'test', 'error-fixtures');
  const dir = join(FILMS, KEY);
  const bad = [], facts = [], firstLines = [];

  const scene = (name) => {
    rmSync(join(dir, 'scenes'), { recursive: true, force: true });
    mkdirSync(join(dir, 'scenes'), { recursive: true });
    copyFileSync(join(FIX, name), join(dir, 'scenes', 's01_hook.py'));
  };
  // one case: run the real entry point, EXPECT a throw, inspect the message; keep going either way
  // (a silent success is itself a failure of the contract; an inspector bug fails loudly).
  const fails = async (name, fn, inspect) => {
    try { await fn(); bad.push(`${name}: the real entry point DID NOT FAIL (it must)`); return null; }
    catch (e) { const msg = String(e.message || e); firstLines.push(`${name}: ${msg.split('\n')[0]}`);
      try { inspect(msg); } catch (x) { bad.push(`${name}: inspector bug: ${x.message}`); } return msg; }
  };
  // the shared "never a bare traceback" shape + case-specific assertions
  const loud = (name, msg, tests) => {
    if (/^Traceback/m.test(msg)) bad.push(`${name}: a line starts with "Traceback" (never a bare traceback)`);
    if (/^\s*File "/.test(msg.split('\n')[0])) bad.push(`${name}: the first line is a python frame, not the studio header`);
    for (const [re, why] of tests) if (!re.test(msg)) bad.push(`${name}: ${why}`);
  };

  const COLS = process.env.COLUMNS;
  process.env.COLUMNS = '240'; // wide rich panels (restored in the finally)
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(SCRATCH, KEY), { recursive: true, force: true });
  createMathFilm(KEY, { title: 'errors fixture' });
  try {
    // -- syntax error: fails at import; the scene file:line is in the tail ---------------------
    scene('syntax-error.py');
    await fails('syntax', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' }), (msg) =>
      loud('syntax', msg, [
        [/^verify-m-err scene s01_hook 16:9 \(draft\) failed/, 'no studio header naming film + scene + format + quality'],
        [/scenes\/s01_hook\.py", line 11\b/, 'the scene file:line is missing (wanted s01_hook.py, line 11)'],
        [/SyntaxError: '\(' was never closed/, 'the SyntaxError itself is missing'],
      ]));

    // -- name error at construct time, through BOTH real paths --------------------------------
    scene('name-error.py');
    await fails('name-render', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' }), (msg) =>
      loud('name-render', msg, [
        [/^verify-m-err scene s01_hook 16:9 \(draft\) failed/, 'no studio header naming film + scene'],
        [/scenes\/s01_hook\.py:12 in construct/, 'the scene file:line is missing (wanted s01_hook.py:12 in construct)'],
        [/NameError: name 'undefined_thing' is not defined/, 'the NameError itself is missing'],
      ]));
    const rows = await checkMathFilm(KEY);
    const row = rows.find((r) => r.scene === 's01_hook');
    if (!row || row.ok !== false) bad.push(`name-check: checkMathFilm must report the scene as ok:false (got ${JSON.stringify(row).slice(0, 120)})`);
    else loud('name-check', row.error, [
      [/scenes\/s01_hook\.py:12 in construct/, 'the row error lacks the scene file:line'],
      [/NameError: name 'undefined_thing' is not defined/, 'the row error lacks the NameError'],
    ]);

    // -- backend compile error: the FORMULA is in the message ---------------------------------
    scene('compile-error.py');
    await fails('compile', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' }), (msg) => {
      loud('compile', msg, [
        [/^verify-m-err scene s01_hook 16:9 \(draft\) failed/, 'no studio header naming film + scene'],
        [/scenes\/s01_hook\.py:11 in construct/, 'the scene file:line is missing (wanted s01_hook.py:11 in construct)'],
        [/TypesetError: typesetting failed/, 'not the typesetting error'],
        [/Unmatched '\\}'/, 'the backend message (Unmatched) is missing'],
      ]);
      // the FORMULA itself, escaping-proof: python's repr doubles backslashes, so accept the raw
      // (\this \{is} broken) or the repr'd (\\this \\{is} broken) spelling — either way it must be there
      const BS = String.fromCharCode(92);
      const rawForm = `${BS}this ${BS}{is} broken`;
      const reprForm = `${BS}${BS}this ${BS}${BS}{is} broken`;
      if (!msg.includes(rawForm) && !msg.includes(reprForm)) bad.push(`compile: the FORMULA is not in the message (wanted ${reprForm})`);
    });

    // -- empty scene: math.mjs's own empty-scene error ----------------------------------------
    scene('empty.py');
    await fails('empty', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' }), (msg) =>
      loud('empty', msg, [
        [/manim produced no s01_hook\.mp4 under/, 'the empty-scene error does not name the missing scene mp4'],
        [/an empty scene adds no frames; give the scene content/, 'the fix ("give the scene content") is missing'],
      ]));

    // -- hung scene: killed at ITS budget, the last animation named ----------------------------
    scene('hung.py');
    const t0 = Date.now();
    await fails('hung', () => renderMathFilm(KEY, { quality: 'check', timeoutS: 25 }), (msg) => {
      const wall = (Date.now() - t0) / 1000;
      loud('hung', msg, [
        [/^KILLED \(time budget\)/, 'not the KILLED (time budget) shape'],
        [/verify-m-err scene s01_hook 16:9 \(check\)/, 'the kill message does not name film + scene + format + quality'],
        [/animation \d+ \(Create\)/, 'the last animation (Create) is not named'],
        [/Fix: profile before optimizing/, 'the fix sentence is missing'],
      ]);
      if (wall < 23 || wall > 40) bad.push(`hung: killed after ${wall.toFixed(1)}s — the 25s per-call budget was not honored`);
      facts.push(`hung killed at its 25s budget in ${wall.toFixed(1)}s, last animation named`);
    });
    // partial output is never promoted: every render above failed — out/ must not exist
    if (existsSync(join(dir, 'out'))) bad.push(`partial output promoted: films/${KEY}/out exists after only-failed renders`);

    // -- missing voice model (buildVoice, via the fixture film) -------------------------------
    scene('empty.py'); // any valid scene; the script is what the voice path parses
    const cfg = readJson(join(dir, 'film.json'));
    cfg.voice = JSON.parse(readFileSync(join(FIX, 'missing-voice.json'), 'utf8')).voice;
    writeJson(join(dir, 'film.json'), cfg);
    await fails('missing-voice', () => buildVoice(KEY), (msg) => {
      const modelPath = join(homedir(), '.local', 'share', 'pi-motion-studio', 'models', 'piper', 'en_US-nonexistent-voice-medium.onnx');
      if (!msg.startsWith(`voice piper:en_US-nonexistent-voice-medium: no model at ${modelPath}`))
        bad.push(`missing-voice: the error must name the model AND the models dir (wanted: ...${modelPath.slice(-70)})`);
      if (!/studio doctor lists the installed voices/.test(msg)) bad.push('missing-voice: the fix pointer (studio doctor) is missing');
      if (/^Traceback/m.test(msg) || /^\s*File "/m.test(msg)) bad.push('missing-voice: a bare traceback (never)');
    });

    // -- invalid script (duplicate sentence id, WITH THE LINE NUMBER) --------------------------
    writeFileSync(join(dir, 'script.md'), readFileSync(join(FIX, 'invalid-script.md'), 'utf8'));
    await fails('invalid-script', () => parseScript(KEY), (msg) => {
      if (!msg.startsWith(`films/${KEY}/script.md is invalid:`)) bad.push('invalid-script: no studio header naming the script');
      if (!/script\.md:6: duplicate sentence id s01\.1 \(first used at line 4\)/.test(msg))
        bad.push('invalid-script: the duplicate sentence id must be reported WITH the line number (script.md:6, first used at line 4)');
      if (/^Traceback/m.test(msg)) bad.push('invalid-script: a bare traceback (never)');
    });

    facts.push('all 7 failure modes loud: file:line (syntax s01_hook.py:11 / name :12 / compile :11), the formula (compile), the empty-scene fix, KILLED+budget+last animation (hung), model+dir (voice), script.md:6 (script)');
    return {
      pass: bad.length === 0,
      measured: bad.length ? bad.join('; ') : `${facts.join('; ')}\nfirst lines:\n  ${firstLines.join('\n  ')}`,
    };
  } finally {
    if (COLS === undefined) delete process.env.COLUMNS; else process.env.COLUMNS = COLS;
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(SCRATCH, KEY), { recursive: true, force: true });
  }
};
