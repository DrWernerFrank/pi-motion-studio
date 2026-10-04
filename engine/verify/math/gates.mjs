// gates (P8): `studio gate` on a math film runs THE MATH GATES and writes gates.json (mission M6 §7).
//  1. CLEAN FILM PASSES: films/verify-m-gates scaffolded (createMathFilm — the template's script,
//     scenes, design), voiced (buildVoice), mixed (buildMix at mix.lufs), ONE draft render at 16:9
//     (through the shared-render-window guard — this box allows ONE Manim render at a time: pgrep
//     before any render, 3 tries / 120 s, then give up loudly rather than render alongside a sibling),
//     then runMathGates: every gate passes and gates.json is exactly the object it returned.
//  2. SEEDED FAULTS, each FAILING with the right gate name + a timestamp and a detail naming the
//     fault. Each seed is a surgical edit of ONE derived layer of the same film, undone before the
//     next leg (the file's pristine bytes are snapshotted and restored, and the clean legs' gates.json
//     is restored so every leg starts from the same state — the seeds live in records/mix/timing, all
//     derived, so re-creating the film per leg would only re-render identical bytes for nothing).
//       overlap            records/16:9/s01_hook-layout.json: one text object's bbox moved onto
//                         another text's -> the layout gate FAILs with rule=overlap, the frame's t
//                         and both object ids; every other gate still passes (the fault is isolated)
//       false claim        records/16:9/s01_hook-claims.json: ok:true -> ok:false -> the claims gate
//                         FAILs naming the expr (merge_ledgers: a failing copy wins, D-011)
//       missing narration  timing.json deleted -> the narration gate FAILs; sync and captions fail
//                         too (they read the same file) — asserted as exactly that set, recorded
//                         honestly, not hidden
//       loudness off       out/mix.wav rewritten 8 dB quieter (ffmpeg -af volume=-8dB) -> the
//                         loudness gate FAILs with the measured LUFS, and nothing else fails
//  3. A LONG STATIC HOLD (the pace gate): rendering 5 s of frozen frames for real is EXPENSIVE, so
//     the pace logic is driven directly through the `_paceGate(filmDir, draftFile)` export on a
//     SYNTHETIC draft in a scratch film folder: one testsrc frame looped for 10 s (ffmpeg -loop 1)
//     = 10 s of frozen frames, no Manim involved. Its timing.json narrates 0-1 s, so the freeze
//     overlaps silence by 9 s > gates.maxStill 3 -> the gate WARNs with the duration. Two controls
//     prove the crossing is what decides: the same 10 s MOVING (testsrc animates) passes, and the
//     frozen draft with narration covering it passes (a hold while the voice explains is craft, M6).
//  4. THE CANVAS GATES ARE REPLACED, never silently passed: GATE_NAMES is exactly M6's ten, shares
//     NONE of the Canvas-only gates (lint/determinism/dead-time/novelty/hook/blank-frames/loop-seam/
//     cue-sync — verified to be engine/gates.mjs's own add() names, so the list cannot go stale),
//     the only name the two sets share is `loudness` (a concept both film kinds have, with a
//     math-specific implementation: mix.lufs +/-1 and <= -1 dBTP on out/mix.wav), math-gates.mjs
//     does not import the Canvas gates, and the clean run's gates.json holds exactly the ten.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMathFilm } from '../../math-cli.mjs';
import { renderMathFilm } from '../../math.mjs';
import { buildMix, buildVoice } from '../../narration.mjs';
import { GATE_NAMES, runMathGates, _paceGate } from '../../math-gates.mjs';
import { run } from '../../lib/proc.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-gates';
// mission M6's gate list, verbatim (the contract the diff proves) + the Canvas-only gates (§1's
// "replace them, never silently pass them" — the names a math film must NOT carry).
const M6 = ['layout', 'claims', 'typeset', 'narration', 'sync', 'pace', 'captions', 'loudness', 'deliverable', 'deterministic'];
const CANVAS_ONLY = ['lint', 'determinism', 'dead-time', 'novelty', 'hook', 'blank-frames', 'loop-seam', 'cue-sync'];

// the single-render slot (hard rule): pgrep before ANY render; 3 tries, 40 s apart (120 s max).
const renderBusy = async () => {
  const r = await run('pgrep', ['-f', 'manim render'], { allowFail: true });
  return r.code === 0 && !!(r.out || '').trim();
};
async function renderWindow(facts) {
  for (let i = 1; i <= 3; i++) {
    if (!(await renderBusy())) return true;
    facts.push(`render window busy (${i}/3), waiting 40 s for the single-render slot`);
    await new Promise((ok) => setTimeout(ok, 40000));
  }
  return !(await renderBusy());
}
const iso = (s) => { const d = Date.parse(s); return Number.isFinite(d) ? d : null; };

export default async (ctx = {}) => {
  const t0 = Date.now();
  const cache = ctx.cache || join(tmpdir(), 'verify-math');
  const dir = join(FILMS, KEY);
  const pace = join(cache, 'gates-pace');
  const bad = [], facts = [];
  let cleanGatesJson = null; // the clean legs' gates.json, restored before every seeded leg

  rmSync(dir, { recursive: true, force: true });
  rmSync(pace, { recursive: true, force: true });
  try {
    // ---- 1. the clean film passes ----------------------------------------------------------------
    createMathFilm(KEY, { title: 'gates fixture' });
    const voiced = await buildVoice(KEY);
    await buildMix(KEY);
    { // captions ride the narration (studio sound writes them; the fixture mirrors it)
      const { exportCaptions } = await import('../../math-captions.mjs');
      const c = exportCaptions(KEY);
      facts.push(`captions: ${c.cues} cues -> srt+vtt`);
    }
    facts.push(`scaffold+voice+mix: ${voiced.sentences.length} sentences, ${voiced.duration.toFixed(2)} s of narration (${voiced.voice})`);
    if (!(await renderWindow(facts))) {
      return { pass: false, measured: 'no clean render window within 120 s (another render holds the single slot) — re-run the check when the slot is free' };
    }
    const tr0 = Date.now();
    const renders = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    facts.push(`draft 16:9 rendered in ${((Date.now() - tr0) / 1000).toFixed(0)} s (${renders[0].scenes} scenes, ${renders[0].seconds.toFixed(2)} s, ${renders[0].cached} cached / ${renders[0].rendered} rendered)`);

    const tClean = Date.now();
    const clean = await runMathGates(KEY, { log: () => {} });
    const onDisk = readJson(join(dir, 'gates.json'), null);
    cleanGatesJson = readFileSync(join(dir, 'gates.json'), 'utf8');

    if (clean.pass !== true) bad.push(`the clean film does not pass: ${clean.checks.filter((c) => !c.pass).map((c) => `${c.name}(${c.level}) ${String(c.detail).split('\n')[0]}`).join(' | ')}`);
    const names = clean.checks.map((c) => c.name);
    if (JSON.stringify(names) !== JSON.stringify(GATE_NAMES)) bad.push(`gate table [${names.join(', ')}] != GATE_NAMES [${GATE_NAMES.join(', ')}]`);
    if (JSON.stringify(GATE_NAMES) !== JSON.stringify(M6)) bad.push(`GATE_NAMES != mission M6's list: [${GATE_NAMES.join(', ')}] vs [${M6.join(', ')}]`);
    if (clean.pass) {
      const at = iso(clean.at);
      if (at === null || at < tClean - 2000 || at > Date.now() + 2000) bad.push(`gates.json timestamp ${clean.at} is not this run's`);
      if (!onDisk || onDisk.pass !== true || onDisk.checks?.length !== GATE_NAMES.length) bad.push(`gates.json on disk disagrees with the returned object (pass=${onDisk?.pass}, ${onDisk?.checks?.length} checks)`);
      const warns = clean.checks.filter((c) => !c.pass);
      if (warns.length) facts.push(`clean film: 10/10 gates PASS (${warns.length} at warn level: ${warns.map((w) => w.name).join(', ')} — a warn advises, it does not block)`);
      else facts.push(`clean film: 10/10 gates PASS, none even at warn level`);
      facts.push(`gate table: ${clean.checks.map((c) => `${c.name}=${c.pass ? 'pass' : c.level}`).join(' ')}`);
    }

    // helpers for the seeded legs: run gates from the SAME clean starting state, assert the timestamp
    const seedRun = async (label) => {
      writeFileSync(join(dir, 'gates.json'), cleanGatesJson); // every leg starts from the clean baseline
      const t = Date.now();
      const g = await runMathGates(KEY, { log: () => {} });
      const at = iso(g.at);
      if (at === null || at < t - 2000 || at > Date.now() + 2000) bad.push(`${label}: gates.json timestamp ${g.at} is not this run's`);
      const failed = g.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => c.name);
      return { g, failed, at };
    };
    const gate = (g, name) => g.checks.find((c) => c.name === name);
    const oneLine = (s) => String(s).replace(/\s+/g, ' ');

    // ---- 2a. overlap: a text bbox moved onto another text -> the LAYOUT gate --------------------
    {
      const layout = join(dir, 'records', '16:9', 's01_hook-layout.json');
      const pristine = readFileSync(layout, 'utf8');
      const frames = JSON.parse(pristine);
      const fi = frames.findIndex((f) => (f.objects || []).filter((o) => o.text && o.bbox && o.alive !== false).length >= 2);
      if (fi < 0) bad.push('overlap seed: no records frame holds 2 text objects to collide');
      else {
        const texts = frames[fi].objects.filter((o) => o.text && o.bbox && o.alive !== false);
        const [base, victim] = [texts[0], texts.at(-1)];
        const ids = [base.id, victim.id], t = frames[fi].t;
        victim.bbox = [...base.bbox]; // the seeded collision: the same box as another text object
        writeFileSync(layout, JSON.stringify(frames));
        try {
          const { g, failed } = await seedRun('overlap');
          const lay = gate(g, 'layout');
          if (!lay || lay.pass !== false) bad.push(`overlap seed: the layout gate did not fail (${lay ? lay.pass : 'missing'})`);
          else {
            for (const want of ['overlap', `t=${t}s`, ...ids]) if (!lay.detail.includes(want)) bad.push(`overlap seed: the layout detail lacks "${want}": ${oneLine(lay.detail).slice(0, 200)}`);
            if (failed.join(',') !== 'layout') bad.push(`overlap seed: FAILs were [${failed.join(', ')}], wanted exactly [layout] (the fault is isolated to the records)`);
            else facts.push(`overlap seed: layout FAIL "${oneLine(lay.detail).slice(0, 110)}" (t=${t}s, ids ${ids.join('/')}), 9 other gates pass`);
          }
        } finally { writeFileSync(layout, pristine); }
      }
    }

    // ---- 2b. a false claim: ok:true -> ok:false -> the CLAIMS gate ------------------------------
    {
      const claims = join(dir, 'records', '16:9', 's01_hook-claims.json');
      const pristine = readFileSync(claims, 'utf8');
      const led = JSON.parse(pristine);
      if (led[0]?.ok !== true) bad.push(`false-claim seed: the pristine first entry is ok=${led[0]?.ok}, nothing to flip`);
      else {
        const expr = led[0].expr, says = led[0].says;
        led[0].ok = false;
        writeFileSync(claims, JSON.stringify(led));
        try {
          const { g, failed } = await seedRun('false claim');
          const cl = gate(g, 'claims');
          if (!cl || cl.pass !== false) bad.push(`false-claim seed: the claims gate did not fail (${cl ? cl.pass : 'missing'})`);
          else {
            for (const want of [expr, `says=${says}`]) if (!cl.detail.includes(want)) bad.push(`false-claim seed: the claims detail lacks "${want}": ${oneLine(cl.detail).slice(0, 200)}`);
            if (failed.join(',') !== 'claims') bad.push(`false-claim seed: FAILs were [${failed.join(', ')}], wanted exactly [claims]`);
            else facts.push(`false-claim seed: claims FAIL naming "${expr.slice(0, 40)}" (says=${says}); merge_ledgers took the failing copy (D-011), 9 other gates pass`);
          }
        } finally { writeFileSync(claims, pristine); }
      }
    }

    // ---- 2c. missing narration: timing.json deleted -> the NARRATION gate ----------------------
    {
      const timing = join(dir, 'timing.json');
      const pristine = readFileSync(timing, 'utf8');
      rmSync(timing);
      try {
        const { g, failed } = await seedRun('missing narration');
        const nar = gate(g, 'narration');
        if (!nar || nar.pass !== false) bad.push(`missing-narration seed: the narration gate did not fail (${nar ? nar.pass : 'missing'})`);
        else if (!nar.detail.includes('timing.json')) bad.push(`missing-narration seed: the narration detail does not name timing.json: ${oneLine(nar.detail).slice(0, 200)}`);
        // sync and captions read timing.json too: they fail with it (asserted, not hidden)
        if (failed.join(',') !== 'narration,sync,captions') bad.push(`missing-narration seed: FAILs were [${failed.join(', ')}], wanted exactly [narration, sync, captions] (all three read timing.json)`);
        else facts.push(`missing-narration seed: narration FAIL "${oneLine(nar.detail).slice(0, 90)}"; sync+captions fail with it (they read the same file)`);
      } finally { writeFileSync(timing, pristine); }
    }

    // ---- 2d. loudness off: mix.wav 8 dB quieter -> the LOUDNESS gate ---------------------------
    {
      const mix = join(dir, 'out', 'mix.wav');
      const pristine = readFileSync(mix);
      const quiet = join(dir, 'out', '.mix-quiet.wav');
      await run('ffmpeg', ['-y', '-v', 'error', '-i', mix, '-af', 'volume=-8dB', quiet]);
      copyFileSync(quiet, mix);
      try {
        const { g, failed } = await seedRun('loudness off');
        const lo = gate(g, 'loudness');
        const m = /(-?[\d.]+) LUFS \(want/.exec(lo?.detail || '');
        if (!lo || lo.pass !== false) bad.push(`loudness seed: the loudness gate did not fail (${lo ? lo.pass : 'missing'})`);
        else if (!m || +m[1] > -22) bad.push(`loudness seed: the detail does not carry the measured LUFS (<= -22): ${oneLine(lo.detail).slice(0, 200)}`);
        if (failed.join(',') !== 'loudness') bad.push(`loudness seed: FAILs were [${failed.join(', ')}], wanted exactly [loudness] (the mix feeds only that gate; the mp4 was muxed from the good mix)`);
        else if (lo && m) facts.push(`loudness seed: loudness FAIL "${oneLine(lo.detail).slice(0, 90)}" (measured ${m[1]} LUFS, 8 dB under mix.lufs -16), 9 other gates pass`);
      } finally { writeFileSync(mix, pristine); rmSync(quiet, { force: true }); }
    }

    // ---- 3. a long static hold: the PACE gate on a synthetic frozen draft (documented above) ----
    {
      mkdirSync(join(pace, 'out'), { recursive: true });
      writeJson(join(pace, 'film.json'), { kind: 'math', title: 'pace unit', fps: 30, formats: ['16:9'], gates: { maxStill: 3 } });
      const draft = join(pace, 'out', 'draft-16:9.mp4');
      const timing = (sentences) => writeJson(join(pace, 'timing.json'), { version: 1, voice: 'piper:en_US-ljspeech-medium', duration: 10, sentences });
      const say = (id, start, end) => ({ id, scene: 's01_hook', text: 'One sentence of narration.', spoken: 'One sentence of narration.', start, end, bookmarks: [] });
      // 10 s of frozen frames: ONE testsrc frame, looped — no Manim render involved
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-frames:v', '1', join(pace, 'frame.png')]);
      await run('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-i', join(pace, 'frame.png'), '-t', '10', '-r', '30', '-pix_fmt', 'yuv420p', draft]);
      // (a) the frozen draft with narration only in 0-1 s: the freeze overlaps 9 s of silence -> WARN
      timing([say('s01.1', 0, 1)]);
      const dead = await _paceGate(pace, draft);
      const dur = /([\d.]+)s frozen/.exec(dead.detail || '');
      if (dead.pass !== false || dead.level !== 'warn' || !dur || +dur[1] < 8) bad.push(`pace unit: the frozen draft should warn with the duration, got ${JSON.stringify(dead).slice(0, 220)}`);
      else facts.push(`static-hold unit (synthetic, no render): 10 s frozen draft, narration 0-1 s -> pace WARN "${oneLine(dead.detail)}"`);
      // (b) control: the same 10 s MOVING (testsrc animates) -> no freeze run -> pass
      const live = join(pace, 'out', 'draft-live.mp4');
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=10', '-pix_fmt', 'yuv420p', live]);
      const moving = await _paceGate(pace, live);
      if (moving.pass !== true) bad.push(`pace unit control: a moving draft must pass, got ${JSON.stringify(moving).slice(0, 220)}`);
      else facts.push('pace control: the same 10 s moving -> pass (0 freeze runs)');
      // (c) control: the frozen draft NARRATED for its whole length -> the hold is craft, pass
      timing([say('s01.1', 0, 10)]);
      const narrated = await _paceGate(pace, draft);
      if (narrated.pass !== true) bad.push(`pace unit control: a frozen draft under narration must pass (M6: a hold while the voice explains is craft), got ${JSON.stringify(narrated).slice(0, 220)}`);
      else facts.push('pace control: the frozen draft narrated 0-10 s -> pass (a hold while the voice explains is craft)');
      // and the real clean film's pace row (from leg 1) is reported in its table fact
    }

    // ---- 4. the Canvas gates are replaced, not silently passed ---------------------------------
    {
      const shared = GATE_NAMES.filter((n) => CANVAS_ONLY.includes(n));
      if (shared.length) bad.push(`the math gates did not REPLACE the Canvas gates: [${shared.join(', ')}] is a Canvas-only gate name carried by a math film`);
      const src = readFileSync(join(ROOT, 'engine', 'gates.mjs'), 'utf8');
      const canvasAdds = [...src.matchAll(/\badd\((['"`])([^'"`]+)\1/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, '').trim());
      for (const n of CANVAS_ONLY) if (!canvasAdds.includes(n)) bad.push(`engine/gates.mjs has no add('${n}') — the Canvas-only list has gone stale, update CANVAS_ONLY`);
      const overlap = canvasAdds.filter((n) => GATE_NAMES.includes(n));
      const SHARED = ['loudness', 'deliverable']; // shared concepts, math-specific implementations
      const stray = overlap.filter((n) => !SHARED.includes(n));
      if (stray.length) bad.push(`math x Canvas gate-name overlap [${stray.join(', ')}]: shared concepts are loudness + deliverable (both with math implementations); any OTHER name means a Canvas gate is being silently passed`);
      else facts.push(`Canvas-only gates absent; shared names [${SHARED.join(', ')}] carry math-specific implementations`);
      if (/from\s+'\.\/gates\.mjs'/.test(readFileSync(join(ROOT, 'engine', 'math-gates.mjs'), 'utf8'))) bad.push('math-gates.mjs imports the Canvas gates — a math film must run the math gates, never silently pass the Canvas ones');
      if (clean.checks?.length === GATE_NAMES.length) facts.push(`Canvas-only gates [${CANVAS_ONLY.join(', ')}] absent from the math set (replaced by layout/pace/deterministic…); the only shared name is loudness (shared concept, math implementation: mix.lufs ±1, <= -1 dBTP on out/mix.wav); gates.json holds exactly [${GATE_NAMES.join(', ')}]`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true }); // hygiene: no films/verify-* left behind
    rmSync(pace, { recursive: true, force: true });
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  return { pass: bad.length === 0, measured: (bad.length ? `FAIL: ${bad.join('; ')} || ` : '') + facts.join('; ') + ` [${secs}s]` };
};
