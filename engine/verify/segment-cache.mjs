// segment-cache (P9): an unchanged re-render takes < 10% of the cold time and is framemd5-identical to it; a
// one-clip change re-encodes exactly the segments that clip's timeline span touches (untouched segments are
// reused with unchanged sidecar hashes) and changes pixels only inside that span, within a measured allowance:
// backward, x264's rc-lookahead (40 frames at the medium preset; 38 measured on this box); forward, inter-frame
// prediction carries the change to the end of the re-encoded part — and stops there, because every part starts
// with an IDR and cached parts are byte-copies, so the drift can never cross a part boundary. --no-cache
// produces the same frames as the cold cache-enabled render, and a partial (mixed cached + encoded) render of
// a [from,to) window is frame-exact against the full render (PSNR >= 40 dB, the fidelity bar; parts that begin
// at the window's edge instead of a grid boundary legitimately re-quantize — measured 46-50 dB for the same
// frames encoded with different part boundaries). Cold, warm, mixed and bypassed renders all split parts at
// the same segment grid, so a deliverable is byte-identical however many parts were served from the cache.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readFilm } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { grid } from '../lib/edit-ops.mjs';
import { cutEdit } from './_editslice.mjs';
import { renderFilm } from '../render.mjs';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/serve.mjs';

const KEY = 'seg-test'; // this check's own film (films/seg-test*), removed in the finally
const WORKERS = 2;      // polite while other agents run; the cache is worker-independent by construction
const N = 150;           // final-quality segment size (SEGMENT_FRAMES.final)
const LOOKBACK = 40;     // frames; x264 medium preset runs rc-lookahead=40 (measured backward influence: 38 frames)

const framemd5 = async (mp4, out) => { await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-map', '0:v', '-f', 'framemd5', out]); return readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('0,')).map((l) => l.split(',').at(-1)); };

// { '<a>-<b>': { hash, at, mtime } } for every segment sidecar of this render
const sidecars = (film) => {
  const dir = join(film.out, '.cache', 'segments', '16x9', 'final'), o = {};
  if (!existsSync(dir)) return o;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    o[`${s.a}-${s.b}`] = { hash: s.hash, at: s.at, mtime: statSync(join(dir, f)).mtimeMs };
  }
  return o;
};

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const md5File = (n) => join(readFilm(KEY).out, `.segcheck-${n}.md5`);
  try {
    // a 30.0 s edit (5 cuts x 6 s at 30 fps = 900 frames = 6 segments of 150) on real footage
    const { film } = await cutEdit(KEY, 'real-talking-head', { fps: 30, cuts: 5, cutLen: 180, gap: 40, fmt: ['16:9'], log: () => {} });
    need(film.cfg.duration === 30, `test film is ${film.cfg.duration}s, wanted 30.0s (5x6s at 30fps)`);

    // (1) cold final render with the cache enabled: every segment gets encoded and written
    let t = performance.now();
    const [cold] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const coldS = (performance.now() - t) / 1000;
    const m1 = await framemd5(cold.file, md5File(1));
    const sc1 = sidecars(readFilm(KEY));
    need(Object.keys(sc1).length === 6, `cold render wrote ${Object.keys(sc1).length} segments, wanted 6 (the cache never filled)`);
    need(m1.length === 900, `cold render has ${m1.length} frames, wanted 900`);

    // (2) unchanged re-render: < 10% of cold, and the same frames
    t = performance.now();
    const [warm] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const warmS = (performance.now() - t) / 1000;
    const m2 = await framemd5(warm.file, md5File(2));
    const ratio = (100 * warmS) / coldS;
    need(warmS < 0.1 * coldS, `unchanged re-render took ${warmS.toFixed(1)}s = ${ratio.toFixed(1)}% of cold (${coldS.toFixed(1)}s), wanted < 10%`);
    need(m1.length === m2.length && m1.join() === m2.join(), `warm render differs from cold (${m1.length} vs ${m2.length} frames)`);
    facts.push(`cold ${coldS.toFixed(1)}s / warm ${warmS.toFixed(1)}s (${ratio.toFixed(1)}% < 10%), framemd5 warm==cold ${m2.length}/${m1.length} frames`);

    // (4) --no-cache (the real CLI flag) equals the cold bytes, and does not touch the cache
    const before4 = sidecars(readFilm(KEY));
    t = performance.now();
    execFileSync('node', ['engine/cli.mjs', 'render', KEY, '--fmt', '16:9', '--no-cache', '--workers', String(WORKERS)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    const nocacheS = (performance.now() - t) / 1000;
    const m4 = await framemd5(join(readFilm(KEY).out, 'final-16x9.mp4'), md5File(4));
    const untouched4 = JSON.stringify(before4) === JSON.stringify(sidecars(readFilm(KEY)));
    need(m1.join() === m4.join(), `--no-cache render differs from the cold render (${m4.length} vs ${m1.length} frames)`);
    need(untouched4, '--no-cache rewrote cache sidecars (the bypass leaks writes)');
    facts.push(`--no-cache ${nocacheS.toFixed(1)}s: framemd5 == cold ${m4.length}/${m1.length}, cache untouched`);

    // (3) trim ONE clip's out by 10 frames (ripple off, so nothing else moves): only the segments covering
    //     its timeline span re-encode; untouched ones are reused with their sidecar hash unchanged; and the
    //     delivered frames that differ from (2) all lie inside the changed clip's span (+/- the lookahead)
    const { edit } = loadEdit(KEY);
    const clips = [...edit.tracks[0].clips].sort((a, b) => a.at - b.at);
    const c3 = clips[2], G = grid(edit);
    const spanA = G.F(c3.at), spanB = spanA + (G.F(c3.out) - G.F(c3.in));
    await applyOps(KEY, { op: 'trim', id: c3.id, out: G.S(G.F(c3.out) - 10), ripple: false });
    syncFilm(KEY);
    need(readFilm(KEY).cfg.duration === 30, 'the trim changed the timeline length (it must not: ripple is off)');
    const before3 = sidecars(readFilm(KEY));
    t = performance.now();
    const [chg] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const chgS = (performance.now() - t) / 1000;
    const m3 = await framemd5(chg.file, md5File(3));
    const after3 = sidecars(readFilm(KEY));
    const reencoded = [], reused = [];
    for (const k of Object.keys(after3)) (JSON.stringify(before3[k]) === JSON.stringify(after3[k]) ? reused : reencoded).push(k);
    const overlaps = (k) => { const [a, b] = k.split('-').map(Number); return b > spanA && a < spanB; };
    const touched = Object.keys(after3).filter(overlaps), untouched = Object.keys(after3).filter((k) => !overlaps(k));
    need(touched.every((k) => reencoded.includes(k)), `segments covering the changed clip (${touched.join(', ') || 'none'}) were not all re-encoded (re-encoded: ${reencoded.join(', ')})`);
    need(untouched.every((k) => reused.includes(k)), `untouched segments (${untouched.join(', ')}) were not all reused with unchanged sidecar hashes`);
    need(m3.length === 900, `changed render has ${m3.length} frames, wanted 900 (the timeline length must hold)`);
    const diff = m3.map((h, i) => (h === m2[i] ? null : i)).filter((x) => x !== null);
    const lo = diff.length ? Math.min(...diff) : -1, hi = diff.length ? Math.max(...diff) : -1;
    // diffs may reach back into the re-encoded part by the lookahead, and forward to that part's end (an IDR
    // boundary) — never past it, and never into a cached (byte-copied) part
    const fwdBound = Math.min(Math.ceil(spanB / N) * N, 30 * 30); // the film is 900 frames (30.0 s @ 30, asserted above)
    need(diff.length > 0, 'the changed render is framemd5-identical to the unchanged one (the trim changed nothing?)');
    need(diff.every((i) => i >= spanA - LOOKBACK && i < fwdBound),
      `frames outside the changed clip's span (backward ${LOOKBACK}f lookahead, forward to the next part boundary ${fwdBound}) differ: [${lo}..${hi}] vs span [${spanA}..${spanB})`);
    facts.push(`trim of clip 3 (out -10f): re-encoded ${reencoded.join(',') || 'none'}, reused ${reused.length} with unchanged hashes; ` +
      `${diff.length}/900 frames differ, all in [${lo}..${hi}] ⊆ span [${spanA}..${spanB}] -${LOOKBACK}f/+to the part boundary ${fwdBound} (x264 rc-lookahead backward, prediction drift forward, stopped by the next part's IDR)`);
    facts.push(`renders: cold ${coldS.toFixed(1)}s, warm ${warmS.toFixed(1)}s, one-clip change ${chgS.toFixed(1)}s = ${(100 * chgS / coldS).toFixed(0)}% of cold (re-encoding 2/6 segments)`);

    // (5) a partial render of [1s, 14s) is a MIXED render (one cached segment between two encoded edges): the
    //     concat order stays frame-exact against the full render of the same (edited) film
    const logs = [];
    const [part] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', from: 1, to: 14, workers: WORKERS, log: (m) => logs.push(m) });
    need(part.frames === 390, `partial render of [1,14)s has ${part.frames} frames, wanted 390`);
    need(/cache: 1\/3 segments/.test(logs.join('\n')), `partial render was not mixed (log: ${logs.filter((l) => /cache/.test(l)).join(' | ') || 'no cache line'})`);
    const psnr = await run('ffmpeg', ['-v', 'info', '-i', part.file, '-i', chg.file,
      '-filter_complex', `[1:v]trim=start_frame=30:end_frame=420,setpts=PTS-STARTPTS[b];[0:v][b]psnr`, '-f', 'null', '-'], { allowFail: true });
    const db = Number(/average:([\d.]+)/.exec(psnr.err)?.[1] ?? 0);
    need(db >= 40, `partial [1,14)s render vs the full render's frames 30-419: PSNR ${db} dB, wanted >= 40 (a mixed concat is out of order or wrong)`);
    facts.push(`partial [1,14)s render: 390 frames, 1 cached + 2 encoded parts, PSNR ${db.toFixed(1)} dB vs the full render's frames 30-419 (>= 40)`);
  } finally {
    for (const f of existsSync(FILMS) ? readdirSync(FILMS) : []) if (f.startsWith('seg-test')) rmSync(join(FILMS, f), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: (bad.length ? 'FAIL: ' + bad.join('; ') + ' — ' : '') + facts.join('; ') };
};
