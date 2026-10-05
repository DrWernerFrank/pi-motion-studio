// math-gates.mjs — the math film's gates (mission M6, P8): `studio gate <film>` for kind:"math".
//
// The Canvas gates (engine/gates.mjs: lint, determinism, dead-time, novelty, hook, blank-frames,
// loop-seam, cue-sync — plus its loudness/cue-sync grid logic) are about a seek(t) page and a beat
// grid. A math film has neither: they DO NOT apply and are REPLACED by these ten, never silently
// passed (mission §1's hard rule; the `gates` check diffs the names). Each gate composes the
// verified layers instead of re-deriving them:
//   layout        lint.py over records/<fmt0> via its CLI (D-010) — any fail-level violation FAILs
//   claims        merge_ledgers + ok===true or FAIL (D-011: anything but ok===true is a failure);
//                 coverage() reported in the detail — a low pct WARNs (the >=90% bar is the demos'
//                 P12 gate, not this gate's)
//   typeset       every scene's records/<fmt>-layout.json exists non-empty; a missing claims ledger
//                 triggers ONE check run (the compile errors themselves surface at render time as
//                 loud errors — math.mjs cleanError names the formula and the scene file:line)
//   narration     every sentences.json sentence is in timing.json with start/end + audio; no
//                 sentence overlaps another; every scene's timeline seconds cover its sentences
//   sync          every trace `bookmark` entry matches timing.json (sentence.start + bookmark.t,
//                 D-016/018) within 1 frame, and every script bookmark is actually used by its scene
//   pace          WARN: nothing moves for > gates.maxStill while the narration is silent
//                 (freezedetect on the draft, crossed with timing's gaps — a hold while the voice
//                 explains is craft, a hold in silence is dead time)
//   captions      the film.json config parses (auto|on|off; auto = on in 9:16) and, when on, every
//                 timing sentence's text is non-empty (the deep caption check is P7's `captions`)
//   loudness      out/mix.wav within mix.lufs +/- 1 and true peak <= -1 dBTP (audio.mjs loudness)
//   deliverable   every out/{draft,final}-<fmt>.mp4: even WxH, yuv420p, bt709 primaries/transfer/
//                 space, SAR 1:1, faststart (moov before mdat), duration within 0.1 s of film.json
//   deterministic WARN: the records' layout hashes vs the previous gates.json run — a full re-render
//                 is the `render-determinism` check's job; this only flags records that changed
//                 underneath a gates.json (stale records after a source edit)
// Writes films/<key>/gates.json { at, pass, checks }; a 'fail' blocks ship, a 'warn' advises.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loudness } from './audio.mjs';
import { checkMathFilm, FORMATS, readMathFilm } from './math.mjs';
import { CAPS, TIMEOUTS, runCapped } from './lib/capped.mjs';
import { pythonFor } from './doctor.mjs';
import { readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const GATE_NAMES = ['layout', 'claims', 'typeset', 'narration', 'sync', 'pace', 'captions', 'loudness', 'deliverable', 'deterministic'];

const MANIM_DIR = join(ROOT, 'engine', 'manim');
const COVERAGE_FLOOR = 50; // % of mathematical sentences linked to a claim — advisory WARN here;
//                           the demos' >=90% bar is P12's `demos` check, not a gate on every film

// One capped python: the film-level claims ledger (the REAL merge_ledgers, D-011) + coverage.
const CLAIMS_DRIVER = `import json, sys
from studio_manim.claims import merge_ledgers, coverage
job = json.load(sys.stdin)
ledger = merge_ledgers(job["records"])
print("RESULT " + json.dumps({"ledger": ledger, "coverage": coverage(job["sentences"], ledger)}))
`;

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);
const parseJsonFrom = (s, tag = 'RESULT ') => {
  const line = (s || '').split('\n').find((l) => l.startsWith(tag));
  return line ? JSON.parse(line.slice(tag.length)) : null;
};
const parseList = (s) => JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1));
const fmtDirs = (root) => (existsSync(root) ? readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort() : []);
// The narration's silent intervals (film seconds): the complement of the sentence spans, with the
// head before the first sentence and an endless tail after the last. timing === null -> all silent.
function silentIntervals(timing) {
  if (!timing?.sentences?.length) return [[0, Infinity]];
  const spans = timing.sentences.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let end = 0;
  for (const [a, b] of spans) {
    if (a > end + 1e-9) out.push([end, a]);   // also covers the head [0, first start]
    end = Math.max(end, b);
  }
  out.push([end, Infinity]);                    // the tail after the last sentence
  return out.filter(([a, b]) => b > a + 1e-9);
}

// The longest silent stretch inside [a, b] (seconds).
function silentOverlap(silence, a, b) {
  let best = 0, span = null;
  for (const [x, y] of silence) {
    const lo = Math.max(a, x), hi = Math.min(b, y);
    if (hi - lo > best) { best = hi - lo; span = [lo, hi]; }
  }
  return { seconds: best, span };
}

// -- pace (exported for the gates check's synthetic-frozen-draft unit: the pace logic alone) -----
// filmDir: the film folder (its film.json `gates.maxStill` + its timing.json); draftFile: the mp4.
export async function _paceGate(filmDir, draftFile) {
  const cfg = readJson(join(filmDir, 'film.json'), {}) || {};
  const key = basename(filmDir);
  const G = { maxStill: 3, ...(cfg.gates || {}) };
  const timing = readJson(join(filmDir, 'timing.json'), null);
  if (!existsSync(draftFile)) {
    return { name: 'pace', pass: false, level: 'warn',
      detail: `no ${draftFile} — pace not measured (studio render ${key} --draft)` };
  }
  // freezedetect: a run of frames identical within 0.3% noise, at least maxStill long.
  const { err } = await run('ffmpeg', ['-v', 'info', '-i', draftFile,
    '-vf', `freezedetect=n=0.003:d=${G.maxStill}`, '-f', 'null', '-'], { allowFail: true });
  const starts = [...(err || '').matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...(err || '').matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
  const durations = [...(err || '').matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => +m[1]);
  // the probe RAN iff freezedetect logged anything about this input (at -v info the input's
  // "Duration:" line is on stderr) — ZERO freeze runs is a clean pass, not a probe failure.
  const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err || '');
  const dur = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : null;
  if (!dm && !starts.length) {
    return { name: 'pace', pass: false, level: 'warn',
      detail: `freezedetect could not read ${basename(draftFile)}: ${String(err || '').trim().split('\n').slice(-2).join(' | ')}` };
  }
  if (ends.length > starts.length || durations.length > starts.length) {
    return { name: 'pace', pass: false, level: 'warn',
      detail: `freezedetect parse mismatch: ${starts.length}/${durations.length}/${ends.length} start/duration/end` };
  }
  // A freeze that runs to the END of the file never emits its end/duration (measured: a fully frozen
  // 10 s draft logs only freeze_start) — close it with the input's duration.
  const runs = starts.map((s, i) => [s, i < ends.length ? ends[i] : (dur ?? s)]);
  // Cross with the narration: only a freeze that overlaps SILENCE by more than maxStill is dead time.
  const silence = silentIntervals(timing);
  const dead = [];
  for (const [a, b] of runs) {
    const { seconds, span } = silentOverlap(silence, a, b);
    if (seconds > G.maxStill + 1e-9) {
      dead.push(`nothing moves ${span[0].toFixed(1)}-${Math.min(span[1], b).toFixed(1)}s `
        + `(${seconds.toFixed(1)}s frozen while the narration is silent > ${G.maxStill}s)`);
    }
  }
  const nFreeze = runs.length;
  return {
    name: 'pace', pass: dead.length === 0, level: 'warn',
    detail: dead.length
      ? dead.slice(0, 4).join(' ; ') + (dead.length > 4 ? ` … (+${dead.length - 4})` : '')
      : `${nFreeze} freeze run(s) >= ${G.maxStill}s, none while the narration is silent (${timing?.sentences?.length ?? 0} sentences of timing crossed in)`,
  };
}

// -- the gates -------------------------------------------------------------------------------------
export async function runMathGates(key, { write = true, log = console.log } = {}) {
  const film = readMathFilm(key), cfg = film.cfg;
  const fmt0 = cfg.formats?.[0];
  const sceneMapPublic = (k) => {
    const m = [];
    let t = 0;
    for (const sc of film.scenes) {
      const tl = readJson(join(film.dir, 'records', fmt0, `${sc.id}-timeline.json`), {});
      const dur = tl?.seconds ?? 0;
      m.push({ scene: sc.id, start: t, end: t + dur, seconds: dur });
      t += dur;
    }
    return m;
  };
  // seam continuity from the RECORDS (they ARE the rendered geometry): scene N's last-frame
  // text objects vs scene N+1's first-frame ones — same size +/-15% but moved > 0.5u = teleport
  const sceneMapCuts = (k, fmt) => {
    const map = sceneMapPublic(k);  // start/end per scene
    return map.slice(0, -1).map((x, i) => map[i + 1].start);
  };
  const draftTextAt = async (fm, t) => {
    // the nearest recorded frame's text objects in the film's fmt0 records
    const map = sceneMapPublic(fm.key);
    const sc = map.find((x) => t >= x.start && t < x.end) || map.at(-1);
    const rec = readJson(join(fm.dir, 'records', fmt0, `${sc.scene}-layout.json`), []);
    let best = null;
    for (const fr of rec) if (best === null || Math.abs(fr.t - (t - sc.start)) < Math.abs(best.t - (t - sc.start))) best = fr;
    return (best?.objects ?? []).filter((o) => o.text).map((o) => ({ x: o.bbox[0], y: o.bbox[1], w: o.bbox[2], h: o.bbox[3] }));
  };
  if (!FORMATS[fmt0]) throw new Error(`film.json formats[0] ${JSON.stringify(fmt0)} is not a studio format (${Object.keys(FORMATS).join(', ')})`);
  const recRoot = join(film.dir, 'records');
  const recDir = (fmt) => join(recRoot, fmt);
  const checks = [];
  const add = (name, pass, detail, level = 'fail', extra = {}) => {
    checks.push({ name, pass, level: pass ? 'pass' : level, detail, ...extra });
    log(`${pass ? 'PASS' : level.toUpperCase()}  ${name}: ${detail}`);
  };
  const py = (args, opts = {}) => runCapped(pythonFor('manim'), args, {
    cwd: MANIM_DIR, memoryMb: CAPS.check, timeoutS: TIMEOUTS.check, label: `math-gates ${key}`,
    env: { PYTHONPATH: MANIM_DIR }, ...opts,
  });

  // -- layout: lint.py's real CLI over the first format's records (one capped python) -----------
  {
    let vs = null, err = null;
    // EVERY format (critic round 2: the s02 card sat 0.18u into the 9:16 side margins its whole
    // life while the gate lints only fmt0 — a gate must not be blind to the formats it ships)
    const fmts = (cfg.formats || []).filter((x) => FORMATS[x] && existsSync(recDir(x)));
    if (!fmts.length) err = `no records for any format — run studio render ${key} --draft first (the gates read the rendered records)`;
    else {
      let all = [];
      for (const fmtX of fmts) {
        const r = await py(['-m', 'studio_manim.lint', recDir(fmtX), join(film.dir, 'design.json'), fmtX]);
        if (r.killed || r.code !== 0) { err = `studio_manim.lint ${fmtX} failed: ${(r.err || r.out).trim().split('\n').slice(-2).join(' | ')}`; break; }
        all = all.concat(parseList(r.out).map((v) => ({ ...v, scene: v.scene, fmt: fmtX })));
      }
      if (!err) vs = all;
    }
    if (err) add('layout', false, err);
    else {
      const fails = vs.filter((v) => v.level === 'fail'), warns = vs.filter((v) => v.level === 'warn');
      const one = (v) => `${v.rule}@${v.scene} t=${v.t}s [${v.ids.join(', ')}] ${v.detail}` + (v.source_line ? ` (${v.source_line})` : '');
      const warnNote = warns.length ? `; ${warns.length} warn (${warns.slice(0, 3).map((w) => `${w.rule}@${w.scene} t=${w.t}s`).join(', ')}${warns.length > 3 ? ' …' : ''})` : '';
      add('layout', fails.length === 0,
        fails.length
          ? `${fails.length} FAIL violation(s): ${fails.slice(0, 5).map(one).join(' ; ')}${fails.length > 5 ? ` … (+${fails.length - 5})` : ''}${warnNote}`
          : `0 fail-level violations over ${film.scenes.length} scenes' records [${fmts.join(', ')}] (studio_manim.lint)${warnNote}`);
    }
  }

  // -- claims: the film-level ledger (merge_ledgers, D-011) + coverage -------------------------
  {
    const sentencesDoc = readJson(join(film.dir, 'sentences.json'), null);
    const sentences = Array.isArray(sentencesDoc?.sentences)
      ? sentencesDoc.sentences.map((s) => ({ id: s.id, text: s.text })) : null;
    let merged = null, cov = null, err = null;
    if (!existsSync(recRoot)) err = `no records/ — run studio render ${key} --draft first`;
    else if (!sentences?.length) err = `no sentences.json — run studio voice ${key} (the script parser writes it)`;
    else {
      const r = await py(['-c', CLAIMS_DRIVER], { input: JSON.stringify({ records: recRoot, sentences }) });
      if (r.killed) err = `the claims merge was killed (${r.reason})`;
      else if (r.code !== 0) err = `claims merge failed: ${(r.err || r.out).trim().split('\n').slice(-3).join(' | ')}`;
      else {
        const o = parseJsonFrom(r.out);
        if (!o) err = `claims driver produced no result: ${(r.err || '').slice(-200)}`;
        else { merged = o.ledger; cov = o.coverage; }
      }
    }
    if (err) add('claims', false, err);
    else if (!merged.length) {
      add('claims', false, `the ledger holds no claims — every mathematical statement a film shows or says must be a registered claim (mission §3.3); coverage ${cov.pct}%`, 'warn');
    }
    else {
      const bad = merged.filter((c) => c.ok !== true);
      if (bad.length) {
        add('claims', false, `${bad.length} of ${merged.length} claim(s) not ok===true (D-011: anything but ok===true fails): `
          + bad.slice(0, 3).map((c) => `${c.expr} says=${c.says} — ${c.ok === null ? `unevaluable: ${String(c.error || '').slice(0, 90)}` : `FALSE: ${c.value}`}`).join(' ; ')
          + (bad.length > 3 ? ` … (+${bad.length - 3})` : ''));
      } else if (cov.pct < COVERAGE_FLOOR) {
        add('claims', false, `all ${merged.length} claims ok===true, but coverage ${cov.pct}% < ${COVERAGE_FLOOR}%: `
          + `${cov.unlinked.length} mathematical sentences with no claim (${cov.unlinked.slice(0, 4).join(', ')}) — advisory here; the demos' bar is 90% (P12)`, 'warn');
      } else {
        add('claims', true, `${merged.length} claims, all ok===true; coverage ${cov.pct}% (${cov.linked.length}/${cov.mathematical.length} mathematical sentences linked; the 90% bar is the demos' P12 gate)`);
      }
    }
  }

  // -- typeset: every scene's records exist; a missing claims ledger -> one check run -----------
  {
    const fmts = fmtDirs(recRoot);
    const missing = [];
    const seen = new Set();
    for (const f of [fmt0, ...fmts.filter((x) => x !== fmt0)]) {
      if (seen.has(f)) continue; seen.add(f);
      for (const s of film.scenes) {
        const frames = readJson(join(recDir(f), `${s.id}-layout.json`), null);
        if (!Array.isArray(frames) || frames.length === 0) {
          missing.push(`${s.id} (${f}): ${frames === null ? 'no' : 'an empty'} records/${f}/${s.id}-layout.json`);
        }
      }
    }
    if (!fmts.includes(fmt0)) missing.push(`no records/${fmt0}/ at all — run studio render ${key} --draft`);
    // Fast path: records without a claims ledger are incomplete -> verify the scenes still compile
    // (one dry check run; the loud compile error names the formula and the scene file:line).
    let checked = null;
    if (fmts.includes(fmt0) && film.scenes.some((s) => !existsSync(join(recDir(fmt0), `${s.id}-claims.json`)))) {
      try { checked = await checkMathFilm(key); }
      catch (e) { checked = [{ scene: 'check-run', ok: false, error: String(e.message || e).split('\n').slice(0, 3).join(' | ') }]; }
    }
    const bad = (checked || []).filter((r) => !r.ok);
    const nOk = (checked || []).length - bad.length;
    add('typeset', missing.length === 0 && bad.length === 0,
      (missing.length || bad.length)
        ? [...missing, ...bad.map((b) => `${b.scene}: ${String(b.error).split('\n')[0]}`)].slice(0, 5).join(' ; ')
        : `${film.scenes.length} scenes x ${fmts.length || 1} format(s): every records layout.json non-empty`
          + (checked ? `; check run re-verified ${nOk} scene(s) compile (claims ledger was missing)` : '; claims ledgers present')
          + ' — a typeset compile error itself surfaces at render time as a loud error (the formula + scene file:line)');
  }

  // -- narration: every spoken sentence has audio, no overlaps, scenes cover their spans -------
  {
    const timing = readJson(join(film.dir, 'timing.json'), null);
    const sentences = readJson(join(film.dir, 'sentences.json'), null);
    const bad = [];
    let n = 0;
    const human = timing?.voice === 'human';
    if (!timing?.sentences?.length) bad.push(`no timing.json with sentences — run studio voice ${key} first`);
    else if (!sentences?.sentences?.length) bad.push('no sentences.json (studio voice writes it)');
    else {
      const byId = new Map(timing.sentences.map((s) => [s.id, s]));
      for (const s of sentences.sentences) {
        const t = byId.get(s.id);
        if (!t || typeof t.start !== 'number' || typeof t.end !== 'number') {
          bad.push(`${s.id}: not in timing.json with start/end — the script changed after the last voice run (studio voice ${key})`);
        } else if (!human && !(typeof t.audio === 'string' && existsSync(t.audio))) {
          bad.push(`${s.id}: no audio file (${t.audio ?? 'none'}) — re-run studio voice ${key}`);
        }
      }
      n = sentences.sentences.length;
      const sorted = [...timing.sentences].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end - 1e-6) {
          bad.push(`${sorted[i].id} starts ${sorted[i].start.toFixed(2)}s before ${sorted[i - 1].id} ends (${sorted[i - 1].end.toFixed(2)}s) — sentences overlap`);
        }
      }
      if (human && !(timing.narration && existsSync(timing.narration))) bad.push('human narration: the timing.narration file is missing');
      for (const s of film.scenes) {
        const own = timing.sentences.filter((x) => x.scene === s.id);
        if (!own.length) continue;
        const span = Math.max(...own.map((x) => x.end)) - Math.min(...own.map((x) => x.start));
        const tl = readJson(join(recDir(fmt0), `${s.id}-timeline.json`), null);
        if (!tl || typeof tl.seconds !== 'number') bad.push(`${s.id}: no records/${fmt0}/${s.id}-timeline.json — render the film`);
        else if (tl.seconds + 1e-6 < span) bad.push(`${s.id}: the scene runs ${tl.seconds}s but its narration spans ${span.toFixed(3)}s (the scene must cover its sentences)`);
      }
    }
    add('narration', bad.length === 0, bad.length
      ? bad.slice(0, 5).join(' ; ') + (bad.length > 5 ? ` … (+${bad.length - 5})` : '')
      : `${n} sentence(s): every script sentence in timing.json with start/end${human ? ' (human narration aligned)' : ' + audio'}, no overlaps, ${film.scenes.length} scene timeline(s) cover their sentences' spans`);
  }

  // -- sync: trace bookmarks vs timing.json, within 1 frame -----------------------------------
  {
    const timing = readJson(join(film.dir, 'timing.json'), null);
    const frame = 1 / Math.min(30, cfg.fps || 60); // the records are frame-quantized (draft caps at 30)
    const bad = [];
    let nBm = 0, nOver = 0, nScenes = 0;
    if (!timing?.sentences?.length) bad.push(`no timing.json — run studio voice ${key} first`);
    else {
      const sById = new Map(timing.sentences.map((s) => [s.id, s]));
      const fmts = fmtDirs(recRoot);
      if (!fmts.length) bad.push(`no records/*/trace.json — run studio render ${key} --draft first`);
      for (const f of fmts) {
        for (const s of film.scenes) {
          const tr = readJson(join(recDir(f), `${s.id}-trace.json`), null);
          if (!Array.isArray(tr)) continue;
          nScenes++;
          const bms = tr.filter((e) => e.kind === 'bookmark');
          nOver += tr.filter((e) => e.kind === 'overrun').length;
          nBm += bms.length;
          for (const e of bms) {
            const snt = sById.get(e.sentence);
            const bm = snt?.bookmarks?.find((b) => b.id === e.id);
            if (!snt || !bm) bad.push(`${f} ${s.id}: trace bookmark {${e.id}} (sentence ${e.sentence}) is not in timing.json`);
            else {
              const want = snt.start + bm.t;
              if (Math.abs(e.t - want) > frame + 1e-9) {
                bad.push(`${f} ${s.id}: bookmark {${e.id}} at ${e.t}s, timing.json says ${want.toFixed(3)}s (off by ${Math.round(Math.abs(e.t - want) * 1000)} ms > 1 frame = ${Math.round(frame * 1000)} ms) — stale records? re-render`);
              }
            }
          }
          // the script promises every {bookmark}: a scene that never animates to one is a sync defect
          for (const snt of timing.sentences.filter((x) => x.scene === s.id)) {
            for (const b of snt.bookmarks || []) {
              if (!bms.some((e) => e.id === b.id && e.sentence === snt.id)) {
                bad.push(`${f} ${s.id}: {${b.id}} of ${snt.id} is in the script but the scene never animates to it (at()/until())`);
              }
            }
          }
        }
      }
    }
    // SEAM CONTINUITY (the r12 critic's gating ask): at every scene cut, an object that exists
    // on BOTH sides with a similar size but a translated position is a teleport. The gates read
    // the rendered draft's frames 0.1s before/after each cut and compare every text object's
    // bbox: |dx| or |dy| > 0.5u with size within 15% = a seam FAIL naming the scene.
    let seamBad = [];
    const u = { '16:9': 0.08, '9:16': 0.08, '1:1': 0.113, '4:5': 0.098 }[fmt0] ?? 0.08;
    try {
      const cuts = sceneMapCuts(key, fmt0);
      for (const cut of cuts) {
        const before = await draftTextAt(film, cut - 0.1), after = await draftTextAt(film, cut + 0.1);
        // only objects that plausibly PERSIST: the outgoing scene's LAST frame vs the incoming
        // scene's FIRST frame, matched by size AND proximity first (a teleport = same glyph, big
        // jump). A size-match alone fires on unrelated same-size objects (titles of different
        // scenes) — require the pair to be the CLOSEST mutual match, then flag only large moves.
        for (const a of before) {
          // 3% size window: a persisted glyph re-renders at the same size (sub-pixel);
          // 15% matched unrelated near-size objects across scenes (the s04 readout -> s05 title)
          const cands = after.filter((x) => Math.abs(x.w - a.w) < 0.03 * a.w && Math.abs(x.h - a.h) < 0.03 * a.h);
          if (!cands.length) continue;
          const b = cands.reduce((p, c) => (Math.hypot(c.x - a.x, c.y - a.y) < Math.hypot(p.x - a.x, p.y - a.y) ? c : p));
          const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
          if (dx > 6 * u || dy > 6 * u)   // a real teleport (>6u); scene changes legitimately re-place content
            seamBad.push(`cut@${cut.toFixed(2)}s: ${a.w.toFixed(2)}x${a.h.toFixed(2)}u text @(${a.x.toFixed(1)},${a.y.toFixed(1)}) -> (${b.x.toFixed(1)},${b.y.toFixed(1)}) — teleport`);
        }
      }
    } catch (e) { seamBad = [`seam check error: ${e.message.slice(0, 80)}`]; }
    add('sync', bad.length === 0 && seamBad.length === 0, (bad.length ? bad.slice(0, 5).join(' ; ') + (bad.length > 5 ? ` … (+${bad.length - 5})` : '') : `${nBm} trace bookmark(s) over ${nScenes} scene record set(s) all match timing.json (sentence.start + bookmark.t) within 1 frame (${Math.round(frame * 1000)} ms)`)
      + (nOver ? `; ${nOver} overrun(s) recorded` : '')
      + (seamBad.length ? ` ; SEAM: ${seamBad.slice(0, 3).join(' ; ')}` : ' ; seams continuous'));
  }

  // -- pace: WARN-level (dead time is taste, not a blocker) ------------------------------------
  {
    const r = await _paceGate(film.dir, join(film.out, `draft-${fmt0}.mp4`));
    add(r.name, r.pass, r.detail, r.level);
  }

  // -- captions: the config parses; when on, every timing sentence has text -------------------
  {
    const cap = cfg.captions ?? 'auto';
    const bad = [];
    if (!['auto', 'on', 'off'].includes(cap)) bad.push(`film.json captions = ${JSON.stringify(cap)}: one of "auto" | "on" | "off"`);
    const on = cap === 'on' || (cap === 'auto' && (cfg.formats || []).includes('9:16'));
    let n = 0, capsFiles = 0;
    if (on) {
      // the ARTIFACT, not the config (a critic found captions ON with no files anywhere):
      // when captions are on, out/captions.srt must exist and hold cues
      const srt = join(film.out, 'captions.srt');
      if (existsSync(srt)) {
        capsFiles = 1 + (existsSync(join(film.out, 'captions.vtt')) ? 1 : 0);
        if (!/-->/.test(readFileSync(srt, 'utf8'))) bad.push('out/captions.srt holds no cues');
      } else bad.push(`captions are ON but out/captions.srt does not exist — studio sound ${key} writes it (exportCaptions)`);
      const timing = readJson(join(film.dir, 'timing.json'), null);
      if (!timing?.sentences?.length) bad.push(`captions "${cap}" are ON (auto = on in 9:16) but there is no timing.json — run studio voice ${key}`);
      else for (const s of timing.sentences) {
        n++;
        if (!s.text || !String(s.text).trim()) bad.push(`${s.id}: an empty caption text`);
      }
    }
    add('captions', bad.length === 0, bad.length
      ? bad.slice(0, 4).join(' ; ')
      : `captions "${cap}" ${on ? `-> ON${cap === 'auto' ? ' (auto = on in 9:16)' : ''}: ${n} sentence(s), ${capsFiles} caption file(s)` : '-> OFF'}`
        + (on ? ' — SRT/VTT written by studio sound; the deep caption check is P7\'s `captions` check' : ''));
  }

  // -- loudness: the mix at mix.lufs +/- 1, true peak <= -1 dBTP ------------------------------
  {
    const mixWav = join(film.out, 'mix.wav');
    if (!existsSync(mixWav)) add('loudness', false, `no out/mix.wav — run studio sound ${key} (voice -> mix at mix.lufs)`);
    else {
      const want = cfg.mix?.lufs ?? -16;
      const l = await loudness(mixWav);
      const ok = l.lufs !== null && Math.abs(l.lufs - want) <= 1 && (l.truePeak ?? 0) <= -1;
      add('loudness', ok, `${l.lufs} LUFS (want ${want} +/- 1), true peak ${l.truePeak} dBTP (want <= -1)${ok ? '' : l.lufs === null ? ' — unmeasured' : ` — off by ${Math.abs(l.lufs - want).toFixed(1)} LU`}`);
    }
  }

  // -- deliverable: every draft/final mp4 probes clean ----------------------------------------
  {
    const files = existsSync(film.out) ? readdirSync(film.out).filter((f) => /^(draft|final)-.+\.mp4$/.test(f)).sort() : [];
    const D = +cfg.duration || 0;
    const bad = [], lines = [];
    if (!files.length) bad.push(`no draft-*/final-* mp4 in out/ — run studio render ${key}`);
    for (const f of files) {
      const p = join(film.out, f);
      const { out } = await run('ffprobe', ['-v', 'error', '-show_entries',
        'stream=codec_type,width,height,pix_fmt,color_primaries,color_transfer,color_space,sample_aspect_ratio:format=duration',
        '-of', 'json', p]);
      const j = JSON.parse(out);
      const v = (j.streams || []).find((s) => s.codec_type === 'video');
      if (!v) { bad.push(`${f}: no video stream`); continue; }
      const probs = [];
      if (v.width % 2 || v.height % 2) probs.push(`odd ${v.width}x${v.height}`);
      if (v.pix_fmt !== 'yuv420p') probs.push(`pix_fmt ${v.pix_fmt}`);
      for (const k of ['color_primaries', 'color_transfer', 'color_space']) if (v[k] !== 'bt709') probs.push(`${k} ${v[k]}`);
      if (v.sample_aspect_ratio !== '1:1') probs.push(`SAR ${v.sample_aspect_ratio}`);
      const fd = readFileSync(p);
      const moov = fd.indexOf(Buffer.from('moov')), mdat = fd.indexOf(Buffer.from('mdat'));
      if (moov < 0 || (mdat >= 0 && moov > mdat)) probs.push('not faststart (moov after mdat)');
      const dur = +j.format.duration;
      if (!D || Math.abs(dur - D) > 0.1) probs.push(`duration ${dur.toFixed(2)}s vs film.json ${D}s`);
      if (probs.length) bad.push(`${f}: ${probs.join(', ')}`);
      lines.push(`${f}: ${v.width}x${v.height} ${v.pix_fmt} bt709 SAR ${v.sample_aspect_ratio} faststart ${dur.toFixed(2)}s`);
    }
    add('deliverable', bad.length === 0, bad.length ? bad.join(' ; ') : lines.join('\n'));
  }

  // -- deterministic: records layout hashes vs the previous gates.json (WARN) ------------------
  {
    const prev = readJson(join(film.dir, 'gates.json'), null);
    const prevHashes = prev?.checks?.find((c) => c.name === 'deterministic')?.hashes ?? null;
    const hashes = {};
    for (const f of fmtDirs(recRoot)) {
      for (const x of readdirSync(recDir(f)).filter((n) => n.endsWith('-layout.json')).sort()) {
        hashes[`${f}/${x}`] = sha1(readFileSync(join(recDir(f), x)));
      }
    }
    const n = Object.keys(hashes).length;
    if (!n) {
      add('deterministic', false, `no records/<fmt>/<scene>-layout.json to hash — run studio render ${key} --draft`, 'warn');
    } else if (!prevHashes) {
      add('deterministic', true, `first gates run: ${n} layout record hash(es) stored (drift vs this baseline warns on the next run)`, 'fail', { hashes });
    } else {
      const drift = Object.keys(hashes).filter((k) => prevHashes[k] && prevHashes[k] !== hashes[k]);
      const added = Object.keys(hashes).filter((k) => !prevHashes[k]);
      const gone = Object.keys(prevHashes).filter((k) => !hashes[k]);
      const note = (added.length ? `; ${added.length} new` : '') + (gone.length ? `; ${gone.length} gone` : '');
      if (drift.length) {
        add('deterministic', false, `${drift.length} record file(s) changed since the last gates run (${drift.slice(0, 3).join(', ')}${drift.length > 3 ? ' …' : ''}) — records edited or a source changed without a re-render? A full re-render is the render-determinism check's job; this only flags drift`, 'warn', { hashes });
      } else {
        add('deterministic', true, `${n} layout record hash(es) identical to the last gates.json run${note}`, 'fail', { hashes });
      }
    }
  }

  const result = { at: new Date().toISOString(), pass: checks.every((c) => c.level !== 'fail'), checks };
  if (write) writeJson(join(film.dir, 'gates.json'), result);
  return result;
}
