// perf-budget (P6, slow): ADR-004's frozen numbers, DRAFT-calibrated (finals are measured at P12
// — this check renders draft/check quality only, per the machine rules).
//
// Fixture: films/verify-m-perf (the template starter, voiced — the class the demos share).
//   1. draft <= 2x realtime in 16:9 — cold render (noCache), wall vs the film's real duration.
//   2. a one-scene draft re-render <= 20 s — the WARM path (a scene-cache hit): the iteration loop.
//   3. a check run vs the cold draft — ADR-004 froze this budget against the FINAL render (probe:
//      7.7 s vs 40.4 s final = 19%), precisely because the dry path is not a fraction of the DRAFT
//      path (57% on the ADR's probe scene; up to 84% measured here on the wait-heavy starter).
//      This check measures the real entry point (checkMathFilm — an UNVOICED dry pass: it passes
//      empty timing and scene.py's pass-through runs animations at their own run_times) AND the
//      same dry path with the film's real timing (the narration-paced clock — the upper bound of
//      the class), and asserts the draft-shape invariant: a check run never costs more than the
//      render. The 25%-of-final bar is measured on the demos at P12.
//      (History, for the record: before scene.py's empty-timing pass-through landed, D-019's strict
//      say() validation aborted every starter scene at its first `with self.say(...)` — `studio
//      check` failed all rows on a voiced film and its 6.8 s wall under-reported the true cost; the
//      working-dry leg below is what quantified that at 15.9 s.)
//   4. peak RSS: killed === false on every scene process (a kill would have thrown KILLED — the
//      enforced bound is the cgroup cap: check 1024 / draft 1536 MB; ADR-004 measured the draft
//      peak at ~920 MB. No /proc sampling: the cap is the wall).
//   5. temp dirs gone: scratch/math/<film> must not exist after any renderMathFilm.
//
// Shared machine: every render runs in a guarded window (pgrep 'bin/python -m man[i]m render',
// 3 tries x 40 s — the [i] keeps the pattern from matching the guard itself), one at a time; a
// measurement that fails its budget while a sibling render overlapped is retried once, when clean.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderMathFilm, checkMathFilm, SCRATCH } from '../../math.mjs';
import { buildVoice } from '../../narration.mjs';
import { createMathFilm } from '../../math-cli.mjs';
import { CAPS, TIMEOUTS, runCapped } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { run } from '../../lib/proc.mjs';

const KEY = 'verify-m-perf';

export default async () => {
  const dir = join(FILMS, KEY);
  const bad = [], facts = [];
  const scratchOf = () => join(SCRATCH, KEY);

  // -- the render window guard (shared machine: never overlap a sibling's manim render) --------
  const busyCount = async () => { const r = await run('pgrep', ['-f', 'bin/python -m man[i]m render'], { allowFail: true }); return r.code === 0 ? r.out.split('\n').filter(Boolean).length : 0; };
  const waitClean = async (label) => {
    for (let i = 0; i < 3; i++) { if ((await busyCount()) === 0) return true; await new Promise((r) => setTimeout(r, 40000)); }
    bad.push(`${label}: no clean render window after 120s (shared machine)`);
    return false;
  };
  const timed = async (label, fn) => {
    const clean = await waitClean(label);
    const t0 = Date.now(), r = await fn(), s = (Date.now() - t0) / 1000;
    return { s, r, clean, overlap: await busyCount() };
  };

  rmSync(dir, { recursive: true, force: true });
  rmSync(scratchOf(), { recursive: true, force: true });
  createMathFilm(KEY, { title: 'perf-budget fixture' });
  try {
    await buildVoice(KEY); // the film's real narration timing (cached by content — cheap)

    // -- 1. the COLD draft (noCache: a genuinely cold render, no silent scene-cache hits) -------
    let cold = await timed('cold draft', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9', noCache: true }));
    if (cold.r[0].rendered !== 3 || cold.r[0].cached !== 0) bad.push(`cold draft: rendered ${cold.r[0].rendered}, cached ${cold.r[0].cached} (noCache must render all 3 scenes)`);
    const duration = readJson(join(dir, 'film.json')).duration;
    let ratio = cold.s / duration;
    if (ratio > 2 && (!cold.clean || cold.overlap > 0)) { // a sibling polluted the window: one retry, when clean
      facts.push(`cold draft ${cold.s.toFixed(1)}s = ${ratio.toFixed(2)}x realtime with a concurrent render in the window — remeasuring once, clean`);
      cold = await timed('cold draft (retry)', () => renderMathFilm(KEY, { quality: 'draft', fmt: '16:9', noCache: true }));
      ratio = cold.s / duration;
    }
    if (ratio > 2) bad.push(`draft = ${ratio.toFixed(2)}x realtime (budget <= 2x: wall ${cold.s.toFixed(1)}s for ${duration}s of film, ADR-004 probe measured 0.71x)`);
    if (existsSync(scratchOf())) bad.push(`scratch/math/${KEY} still exists after the cold draft (the runner must sweep it)`);
    else facts.push(`cold draft ${cold.s.toFixed(1)}s for ${duration}s = ${ratio.toFixed(2)}x realtime (<= 2x, ADR-004 probe 0.71x); scratch swept`);

    // -- 2. the one-scene path: cold (whatever the shared cache holds), then WARM (the loop) ---
    const one1 = await timed('one-scene cold', () => renderMathFilm(KEY, { scene: 's01_hook', quality: 'draft', fmt: '16:9' }));
    facts.push(`one-scene #1: ${one1.s.toFixed(1)}s (rendered ${one1.r[0].rendered}, cached ${one1.r[0].cached})`);
    const one2 = await timed('one-scene warm', () => renderMathFilm(KEY, { scene: 's01_hook', quality: 'draft', fmt: '16:9' }));
    if (one2.r[0].cached !== 1) bad.push(`one-scene warm: cached ${one2.r[0].cached} (wanted the scene-cache hit)`);
    if (one2.s > 20) bad.push(`warm one-scene re-render ${one2.s.toFixed(1)}s (budget <= 20s, ADR-004 probe 13.6s cold / 4.3s warm)`);
    if (existsSync(scratchOf())) bad.push(`scratch/math/${KEY} still exists after the one-scene render (the runner must sweep it)`);
    facts.push(`warm one-scene re-render ${one2.s.toFixed(1)}s (<= 20s; the iteration loop)`);
    // killed === false, structurally: every render above RESOLVED (a killed scene throws KILLED)
    const renders = [cold.r[0], one1.r[0], one2.r[0]];
    if (renders.some((x) => x.killed)) bad.push('a render result reports killed (impossible here: a kill throws)');
    facts.push('killed=false on every scene process (a kill throws KILLED; the enforced bound is the cgroup cap: check 1024 / draft 1536 MB — ADR-004 measured the draft peak at ~920 MB)');

    // -- 3. the check run: the real entry point, and the working dry path ----------------------
    let chk = await timed('checkMathFilm', () => checkMathFilm(KEY));
    if (chk.s >= cold.s && (!chk.clean || chk.overlap > 0)) {
      facts.push(`checkMathFilm ${chk.s.toFixed(1)}s with a concurrent render in the window — remeasuring once, clean`);
      chk = await timed('checkMathFilm (retry)', () => checkMathFilm(KEY));
    }
    const chkOk = chk.r.filter((x) => x.ok).length;
    facts.push(`checkMathFilm ${chk.s.toFixed(1)}s = ${((chk.s / cold.s) * 100).toFixed(0)}% of the cold draft (${chkOk}/${chk.r.length} scenes ok${chkOk < chk.r.length ? ' — ROWS FAILING: reported' : ''}; an unvoiced dry pass — checkMathFilm passes empty timing, so scene.py runs animations at their own run_times)`);
    if (chk.s >= cold.s) bad.push(`checkMathFilm ${chk.s.toFixed(1)}s cost more than the ${cold.s.toFixed(1)}s draft render (a check run never may)`);

    // the same dry path with the film's REAL timing (the narration-paced clock — the upper bound
    // of the check-run class): checkMathFilm's exact argv, one capped process per scene.
    const dryRun = async () => {
      const timingAll = readJson(join(dir, 'timing.json'), {});
      const out = [];
      for (const s of ['s01_hook', 's02_meaning', 's03_recap']) {
        const work = join(scratchOf(), 'dryfix', s); mkdirSync(join(work, 'records'), { recursive: true });
        const state = { format: '16:9', design: readJson(join(dir, 'design.json'), {}),
          timing: { sentences: timingAll.sentences ?? [] }, records_dir: join(work, 'records'),
          claims_file: join(work, 'records', `${s}-claims.json`), scene: { id: s, file: join(dir, 'scenes', `${s}.py`) } };
        const stateFile = join(work, 'film_state.json'); writeJson(stateFile, state);
        const r = await runCapped(pythonFor('manim'), ['-m', 'manim', 'render', join(dir, 'scenes', `${s}.py`), 'Scene', '--dry_run',
          '--media_dir', work, '--resolution', '960,540', '--fps', '30'],
          { memoryMb: CAPS.check, timeoutS: TIMEOUTS.check, cwd: work, label: `${KEY} ${s} dry`,
            env: { STUDIO_FILM_STATE: stateFile, STUDIO_FORMAT: '16:9', PYTHONPATH: join(ROOT, 'engine', 'manim') } });
        out.push({ scene: s, code: r.code, killed: r.killed });
      }
      return out;
    };
    let dry = await timed('working dry path', dryRun);
    if (dry.s >= cold.s && (!dry.clean || dry.overlap > 0)) {
      facts.push(`the working dry path ${dry.s.toFixed(1)}s with a concurrent render in the window — remeasuring once, clean`);
      dry = await timed('working dry path (retry)', dryRun);
    }
    const dryFails = dry.r.filter((x) => x.code !== 0 || x.killed);
    if (dryFails.length) bad.push(`the working dry path failed: ${JSON.stringify(dryFails)}`);
    if (dry.s >= cold.s) bad.push(`the working dry path ${dry.s.toFixed(1)}s cost more than the ${cold.s.toFixed(1)}s draft (a check run never may)`);
    facts.push(`working dry path (real timing) ${dry.s.toFixed(1)}s = ${((dry.s / cold.s) * 100).toFixed(0)}% of the cold draft (ADR-004: the budget is frozen vs the FINAL render — probe 19%; draft-shape 57% on its scene) — the 25%-of-final bar is measured on the demos at P12`);
    rmSync(join(scratchOf(), 'dryfix'), { recursive: true, force: true }); // this leg's own scratch
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratchOf(), { recursive: true, force: true });
  }
};
