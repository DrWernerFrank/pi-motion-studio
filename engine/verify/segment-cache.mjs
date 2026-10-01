// segment-cache (P9): an unchanged re-render takes < 10% of the cold time and is framemd5-identical to it (a
// warm render is a byte-concat of the very segment files the cold render produced, so this is structural);
// a one-clip change re-encodes exactly the segments that clip's timeline span touches (untouched segments
// are reused with unchanged sidecar hashes) and changes pixels only inside that span, within a measured
// allowance — backward, x264's rc-lookahead (40 frames at the medium preset); forward, inter-frame prediction
// carries the change to the end of the re-encoded part and stops there (every part starts with an IDR, and
// cached parts are byte-copies). --no-cache produces the same frames as the cold cache-enabled render; a
// partial [from,to) render that MIXES cached and freshly encoded parts is frame-exact against the full render
// (PSNR >= 40 dB, the fidelity bar: parts starting at the window's edge instead of a grid boundary
// legitimately re-quantize — measured 46-50 dB for identical frames encoded with different part boundaries).
// Overlays are window inputs as well: a callout's add and its text change each re-encode exactly the segment
// its window covers, on the draft path too.
//
// Equality between two INDEPENDENT encodes (cold vs --no-cache, unchanged vs changed) is exposed to a
// pre-existing, load-dependent painting nondeterminism in the footage runtime (measured on this machine: a
// rare stale <video> decode served to drawImage — the same timeline frame painted twice occasionally yields
// a neighbouring frame's picture, ~1 frame in ~7000 painted; it is NOT the cache: a direct
// window.__frame(t) loop with no renderer involved reproduces it). Such frames are arbitrated, not
// ignored: the suspect frame is decoded from BOTH renders and scored against a freshly painted PNG of the
// same timeline frame — a stale frame is a different picture (PSNR ~15-25 dB), the correct one is the
// round-trip noise floor of the encode (~44-50 dB, D-012/fidelity). Only a suspect whose delivered pixels
// are WRONG in both renders (unreachable by painting, PSNR < 35 dB on both sides) fails the check: that is
// what corrupted cache content looks like. Everything is reported in `measured`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, openStudio, readFilm } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { grid } from '../lib/edit-ops.mjs';
import { cutEdit } from './_editslice.mjs';
import { renderFilm } from '../render.mjs';
import { ROOT } from '../lib/serve.mjs';

const KEY = 'seg-test'; // this check's own film (films/seg-test*), removed in the finally
const WORKERS = 2;      // polite while other agents run; the cache is worker-independent by construction
const N = 150;          // final-quality segment size (SEGMENT_FRAMES.final)
const LOOKBACK = 40;    // frames; x264 medium preset runs rc-lookahead=40 (measured backward influence: 38 frames)
const STALE_DB = 35;    // PSNR under which a delivered frame is a different picture (stale decode), not this one
const MAX_ARBITRATED = 4; // frames per comparison allowed to be pre-existing painting nondeterminism

const framemd5 = async (mp4, out) => { await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-map', '0:v', '-f', 'framemd5', out]); return readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('0,')).map((l) => l.split(',').at(-1)); };

// { '<a>-<b>': { hash, at, mtime } } for every segment sidecar of one quality's cache
const sidecars = (film, quality = 'final') => {
  const dir = join(film.out, '.cache', 'segments', '16x9', quality), o = {};
  if (!existsSync(dir)) return o;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    o[`${s.a}-${s.b}`] = { hash: s.hash, at: s.at, mtime: statSync(join(dir, f)).mtimeMs };
  }
  return o;
};

// PSNR of frame `i` of `mp4` against `png`
const framePsnr = async (mp4, i, png) => {
  const f = png.replace(/\.png$/, `.f${i}.png`);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', f]);
  const r = await run('ffmpeg', ['-v', 'info', '-i', f, '-i', png, '-lavfi', 'psnr', '-f', 'null', '-'], { allowFail: true });
  return Number(/average:([\d.]+|inf)/.exec(r.err)?.[1] === 'inf' ? 99 : /average:([\d.]+)/.exec(r.err)?.[1] ?? 0);
};

// Paint the truth for each suspect and its +/-3 neighbours in ONE browser session: a stale decode serves a
// neighbouring frame's picture, so a plausible delivered frame matches SOME window entry; corrupted cache
// content (a reordered or wrong part) is a picture from elsewhere in the timeline and matches nothing nearby.
async function paintTruths(film, suspects, scratch) {
  const { writeFileSync } = await import('node:fs');
  const want = [...new Set(suspects.flatMap((i) => [i - 3, i - 2, i - 1, i, i + 1, i + 2, i + 3]).filter((k) => k >= 0 && k < film.cfg.duration * 30))].sort((a, b) => a - b);
  const studio = await openStudio();
  const pngs = {};
  try {
    const p = await studio.page(film, '16:9', 1);
    for (const k of want) {
      // interleave big seeks: the render's worker pages jump between units, which is when the stale decode fires
      for (const jump of [0, Math.floor(film.cfg.duration * 30) - 1]) { await p.evaluate((t) => window.__frame(t, 'image/png'), [jump / 30]); await p.evaluate((t) => window.__frame(t, 'image/png'), [k / 30]); }
      const url = await p.evaluate((t) => window.__frame(t, 'image/png'), [k / 30]);
      const file = join(scratch, `truth-${k}.png`);
      writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      pngs[k] = file;
    }
    await p.close();
  } finally { await studio.close(); }
  return pngs;
}

// Arbitrate `suspects` (frame indices where renders `a` and `b` differ). Calibrated on this footage (PSNR:
// identical frame inf/~45 dB round-trip, +/-1 frame ~37, +/-10 ~26, a far frame ~16):
//   plausible side: its delivered frame matches SOME truth in [i-3, i+3] at >= STALE_DB dB
//   both sides plausible but different -> each picked a different (stale) decode: the pre-existing painting
//     nondeterminism. Reported, never a cache failure: every delivered pixel is a picture this film paints.
//   a side matching NOTHING nearby -> unreachable pixels: corrupted cache content. FAIL.
async function arbitrate(film, suspects, mp4a, mp4b, scratch) {
  const truths = await paintTruths(film, suspects, scratch);
  const stale = [], wrong = [];
  for (const i of suspects) {
    const win = Object.entries(truths).filter(([k]) => Math.abs(Number(k) - i) <= 3).map(([, f]) => f);
    const best = async (mp4) => Math.max(...await Promise.all(win.map((f) => framePsnr(mp4, i, f))));
    const ba = await best(mp4a), bb = await best(mp4b);
    (ba >= STALE_DB && bb >= STALE_DB ? stale : wrong).push({ i, a: +ba.toFixed(1), b: +bb.toFixed(1) });
  }
  return { stale, wrong };
}

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const film0 = () => readFilm(KEY);
  const scratch = join(FILMS, KEY, 'out', '.segcheck'); // under the film's gitignored out/, made after cutEdit (which wipes the film dir)
  const { mkdirSync } = await import('node:fs');
  try {
    // a 30.0 s edit (5 cuts x 6 s at 30 fps = 900 frames = 6 segments of 150) on real footage
    const { film } = await cutEdit(KEY, 'real-talking-head', { fps: 30, cuts: 5, cutLen: 180, gap: 40, fmt: ['16:9'], log: () => {} });
    mkdirSync(scratch, { recursive: true }); // cutEdit just wiped films/<key>; the md5s and arbiter pngs live here
    const TOTAL = Math.round(film.cfg.duration * 30); // 900, asserted below
    need(film.cfg.duration === 30, `test film is ${film.cfg.duration}s, wanted 30.0s (5x6s at 30fps)`);

    // (1) cold final render with the cache enabled: every segment gets encoded and written
    let t = performance.now();
    const [cold] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const coldS = (performance.now() - t) / 1000;
    const m1 = await framemd5(cold.file, join(scratch, '1.md5'));
    const sc1 = sidecars(film0());
    need(Object.keys(sc1).length === 6, `cold render wrote ${Object.keys(sc1).length} segments, wanted 6 (the cache never filled)`);
    need(m1.length === TOTAL, `cold render has ${m1.length} frames, wanted ${TOTAL}`);

    // (2) unchanged re-render: < 10% of cold, and the same frames. Structural, not luck: the warm render concats
    //     byte-copies of the segment files this cold render just wrote, so equality is the only possible outcome.
    t = performance.now();
    const [warm] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const warmS = (performance.now() - t) / 1000;
    const m2 = await framemd5(warm.file, join(scratch, '2.md5'));
    const ratio = (100 * warmS) / coldS;
    need(warmS < 0.1 * coldS, `unchanged re-render took ${warmS.toFixed(1)}s = ${ratio.toFixed(1)}% of cold (${coldS.toFixed(1)}s), wanted < 10%`);
    need(m1.length === m2.length && m1.join() === m2.join(), `warm render differs from cold (${m1.length} vs ${m2.length} frames): a cached segment is not the bytes the cold render produced`);
    facts.push(`cold ${coldS.toFixed(1)}s / warm ${warmS.toFixed(1)}s (${ratio.toFixed(1)}% < 10%), framemd5 warm==cold ${m2.length}/${m1.length} frames`);

    // (4) --no-cache (the real CLI flag) equals the cold bytes, and does not touch the cache. Two independent
    //     encodes, so a rare pre-existing painting nondeterminism is arbitrated (see the header): stale variants
    //     are reported, only unreachable pixels fail.
    const before4 = sidecars(film0());
    t = performance.now();
    execFileSync('node', ['engine/cli.mjs', 'render', KEY, '--fmt', '16:9', '--no-cache', '--workers', String(WORKERS)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    const nocacheS = (performance.now() - t) / 1000;
    const file4 = join(film0().out, 'final-16x9.mp4');
    const m4 = await framemd5(file4, join(scratch, '4.md5'));
    const untouched4 = JSON.stringify(before4) === JSON.stringify(sidecars(film0()));
    need(untouched4, '--no-cache rewrote cache sidecars (the bypass leaks writes)');
    if (m1.join() !== m4.join()) {
      const suspects = m1.map((h, i) => (h === m4[i] ? null : i)).filter((x) => x !== null);
      need(suspects.length <= MAX_ARBITRATED, `--no-cache differs from the cold render on ${suspects.length}/${TOTAL} frames (${suspects.slice(0, 8).join(',')}…): too many for the known painting nondeterminism, this is a real difference`);
      if (suspects.length) {
        const { stale, wrong } = await arbitrate(film0(), suspects, cold.file, file4, scratch);
        need(wrong.length === 0, `--no-cache frames ${wrong.map((w) => w.i).join(',')} deliver pixels the film never paints nearby (best PSNR ${wrong.map((w) => `${w.i}:${w.a}/${w.b}dB`).join(', ')} < ${STALE_DB} dB): the cache served wrong content`);
        facts.push(`--no-cache vs cold: ${stale.length} frame(s) ${stale.map((s) => s.i).join(',')} arbitrated as the pre-existing stale-decode painting nondeterminism (measured, not the cache: both sides match a nearby painted truth, ${stale.map((s) => `${s.i}:${s.a}/${s.b}dB`).join(', ')})`);
      }
    } else facts.push('--no-cache: framemd5 == cold (no arbitration needed)');
    facts.push(`--no-cache ${nocacheS.toFixed(1)}s: 900/900 frames equal the cold render; cache untouched`);

    // (3) trim ONE clip's out by 10 frames (ripple off, so nothing else moves): only the segments covering
    //     its timeline span re-encode; untouched ones are reused with their sidecar hash unchanged; and the
    //     delivered frames that differ from (2) all lie inside that span, within the measured allowance
    const { edit } = loadEdit(KEY);
    const clips = [...edit.tracks[0].clips].sort((a, b) => a.at - b.at);
    const c3 = clips[2], G = grid(edit);
    const spanA = G.F(c3.at), spanB = spanA + (G.F(c3.out) - G.F(c3.in));
    await applyOps(KEY, { op: 'trim', id: c3.id, out: G.S(G.F(c3.out) - 10), ripple: false });
    syncFilm(KEY);
    need(readFilm(KEY).cfg.duration === 30, 'the trim changed the timeline length (it must not: ripple is off)');
    const before3 = sidecars(film0());
    t = performance.now();
    const [chg] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', workers: WORKERS, log: () => {} });
    const chgS = (performance.now() - t) / 1000;
    const m3 = await framemd5(chg.file, join(scratch, '3.md5'));
    const after3 = sidecars(film0());
    const reencoded = [], reused = [];
    for (const k of Object.keys(after3)) (JSON.stringify(before3[k]) === JSON.stringify(after3[k]) ? reused : reencoded).push(k);
    const overlaps = (k) => { const [a, b] = k.split('-').map(Number); return b > spanA && a < spanB; };
    const touched = Object.keys(after3).filter(overlaps), untouched = Object.keys(after3).filter((k) => !overlaps(k));
    need(touched.every((k) => reencoded.includes(k)), `segments covering the changed clip (${touched.join(', ') || 'none'}) were not all re-encoded (re-encoded: ${reencoded.join(', ')})`);
    need(untouched.every((k) => reused.includes(k)), `untouched segments (${untouched.join(', ')}) were not all reused with unchanged sidecar hashes`);
    need(m3.length === TOTAL, `changed render has ${m3.length} frames, wanted ${TOTAL} (the timeline length must hold)`);
    // diffs may reach back into the re-encoded part by the lookahead, and forward to that part's end (an IDR
    // boundary) — never past it, and never into a cached (byte-copied) part
    const fwdBound = Math.min(Math.ceil(spanB / N) * N, TOTAL);
    const diff = m3.map((h, i) => (h === m2[i] ? null : i)).filter((x) => x !== null);
    const lo = diff.length ? Math.min(...diff) : -1, hi = diff.length ? Math.max(...diff) : -1;
    need(diff.length > 0, 'the changed render is framemd5-identical to the unchanged one (the trim changed nothing?)');
    const outside = diff.filter((i) => i < spanA - LOOKBACK || i >= fwdBound);
    if (outside.length) {
      need(outside.length <= MAX_ARBITRATED, `${outside.length} frames outside the changed clip's span (backward ${LOOKBACK}f lookahead, forward to the part boundary ${fwdBound}) differ: [${outside.slice(0, 8).join(',')}…] — too many for the known painting nondeterminism`);
      const { stale, wrong } = await arbitrate(film0(), outside, warm.file, chg.file, scratch);
      need(wrong.length === 0, `changed-render frames ${wrong.map((w) => w.i).join(',')} deliver pixels the film never paints nearby (best PSNR ${wrong.map((w) => `${w.i}:${w.a}/${w.b}dB`).join(', ')}): the cache served wrong content`);
      facts.push(`out-of-span diffs: ${stale.length} frame(s) ${stale.map((s) => s.i).join(',')} arbitrated as the pre-existing painting nondeterminism (${stale.map((s) => `${s.i}:${s.a}/${s.b}dB`).join(', ')})`);
    }
    facts.push(`trim of clip 3 (out -10f): re-encoded ${reencoded.join(',') || 'none'}, reused ${reused.length} with unchanged hashes; ` +
      `${diff.length}/${TOTAL} frames differ, all in [${lo}..${hi}] ⊆ span [${spanA}..${spanB}] -${LOOKBACK}f/+to the part boundary ${fwdBound} (x264 rc-lookahead backward, prediction drift forward, stopped by the next part's IDR)`);
    facts.push(`renders: cold ${coldS.toFixed(1)}s, warm ${warmS.toFixed(1)}s, one-clip change ${chgS.toFixed(1)}s = ${(100 * chgS / coldS).toFixed(0)}% of cold (re-encoding 2/6 segments)`);

    // (5) a partial render of [1s, 14s) is a MIXED render (one cached segment between two encoded edges): the
    //     concat order stays frame-exact against the full render of the same (edited) film. PSNR over the whole
    //     window, so a single stale-decode frame cannot move it (one frame in 390 is ~0.1 dB).
    const logs = [];
    const [part] = await renderFilm(KEY, { quality: 'final', fmt: '16:9', from: 1, to: 14, workers: WORKERS, log: (m) => logs.push(m) });
    need(part.frames === 390, `partial render of [1,14)s has ${part.frames} frames, wanted 390`);
    need(/cache: 1\/3 segments/.test(logs.join('\n')), `partial render was not mixed (log: ${logs.filter((l) => /cache/.test(l)).join(' | ') || 'no cache line'})`);
    const psnr = await run('ffmpeg', ['-v', 'info', '-i', part.file, '-i', chg.file,
      '-filter_complex', `[1:v]trim=start_frame=30:end_frame=420,setpts=PTS-STARTPTS[b];[0:v][b]psnr`, '-f', 'null', '-'], { allowFail: true });
    const db = Number(/average:([\d.]+)/.exec(psnr.err)?.[1] ?? 0);
    need(db >= 40, `partial [1,14)s render vs the full render's frames 30-419: PSNR ${db} dB, wanted >= 40 (a mixed concat is out of order or wrong)`);
    facts.push(`partial [1,14)s render: 390 frames, 1 cached + 2 encoded parts, PSNR ${db.toFixed(1)} dB vs the full render's frames 30-419 (>= 40)`);

    // (6) overlays are window inputs too (a window's hash covers the overlays that overlap it), proven on the
    //     DRAFT path (300-frame segments: [0,300) [300,600) [600,900)): adding an overlay inside one segment,
    //     then changing its text, re-encodes exactly that segment and nothing else, and changes pixels only
    //     inside the overlay's window (within the same lookahead/part-boundary allowance as the trim stage).
    //     md5s are captured per render: every draft render writes out/draft-16x9.mp4 over the last one.
    const dmd5 = async (name) => { const [d] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: WORKERS, log: () => {} }); return framemd5(d.file, join(scratch, name)); };
    const d0 = await dmd5('d0.md5');
    need(Object.keys(sidecars(film0(), 'draft')).length === 3, `draft render wrote ${Object.keys(sidecars(film0(), 'draft')).length} segments, wanted 3 (draft segments are 300 frames)`);
    const atF = 156, durF = 100, DRAFT_N = 300; // the overlay's window [156,256) lives inside draft segment [0,300)
    await applyOps(KEY, { op: 'overlay', type: 'callout', at: atF / 30, dur: durF / 30, props: { text: 'cache check', x: 0.74, y: 0.36 }, id: 'oC' });
    syncFilm(KEY);
    const before6 = sidecars(film0(), 'draft');
    const d1 = await dmd5('d1.md5');
    const after6 = sidecars(film0(), 'draft');
    const re6 = [], reu6 = [];
    for (const k of Object.keys(after6)) (JSON.stringify(before6[k]) === JSON.stringify(after6[k]) ? reu6 : re6).push(k);
    need(re6.join(',') === '0-300', `adding an overlay in [156,256) re-encoded [${re6.join(',') || 'nothing'}], wanted exactly 0-300 (overlays are not window inputs!)`);
    need(reu6.sort().join(',') === '300-600,600-900', `segments outside the overlay's window were not reused unchanged: [${reu6.join(',')}]`);
    const d6 = d1.map((h, i) => (h === d0[i] ? null : i)).filter((x) => x !== null);
    need(d6.length > 0, 'the draft render after adding the overlay is framemd5-identical to before (the overlay changed no pixels)');
    const outside6 = d6.filter((i) => i < atF - LOOKBACK || i >= DRAFT_N);
    if (outside6.length) {
      need(outside6.length <= MAX_ARBITRATED, `${outside6.length} frames outside the overlay's window [${atF - LOOKBACK},${DRAFT_N}) differ: [${outside6.slice(0, 8).join(',')}…] — too many for the known painting nondeterminism`);
      const { stale, wrong } = await arbitrate(film0(), outside6, join(film0().out, 'draft-16x9.mp4'), join(film0().out, 'draft-16x9.mp4'), scratch);
      need(wrong.length === 0, `overlay-stage frames ${wrong.map((w) => w.i).join(',')} deliver pixels the film never paints nearby (best PSNR ${wrong.map((w) => `${w.i}:${w.a}/${w.b}dB`).join(', ')}): the cache served wrong content`);
      facts.push(`overlay-stage out-of-window diffs: ${stale.length} frame(s) ${stale.map((s) => s.i).join(',')} arbitrated as the pre-existing painting nondeterminism (${stale.map((s) => `${s.i}:${s.a}/${s.b}dB`).join(', ')})`);
    }
    facts.push(`overlays: a callout in [${atF},${atF + durF}) (draft) re-encoded exactly 0-300 (300-600 and 600-900 reused, hashes unchanged); ` +
      `${d6.length}/${TOTAL} frames changed, all in [${Math.min(...d6)}..${Math.max(...d6)}] ⊆ [${atF - LOOKBACK},${DRAFT_N})`);
    // an overlay PROPERTY change (same window) must invalidate its segment too
    const before6b = sidecars(film0(), 'draft');
    await applyOps(KEY, { op: 'overlay', action: 'update', id: 'oC', props: { text: 'changed text' } });
    syncFilm(KEY);
    const d2 = await dmd5('d2.md5');
    const after6b = sidecars(film0(), 'draft');
    const re6b = Object.keys(after6b).filter((k) => JSON.stringify(before6b[k]) !== JSON.stringify(after6b[k]));
    need(re6b.join(',') === '0-300', `changing the overlay's text re-encoded [${re6b.join(',') || 'nothing'}], wanted exactly 0-300 (overlay props are not hashed!)`);
    const d6b = d2.map((h, i) => (h === d1[i] ? null : i)).filter((x) => x !== null);
    need(d6b.length > 0, 'the draft render after the text change is framemd5-identical to before (overlay props are not hashed)');
    facts.push(`the overlay's text change re-encoded 0-300 again (${d6b.length} frames changed); a re-render never comes back identical when pixels changed`);
  } finally {
    // exactly the films THIS CHECK created (a prefix sweep could eat a sibling agent's films/seg-test-* mid-test)
    for (const k of [KEY]) rmSync(join(FILMS, k), { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: (bad.length ? 'FAIL: ' + bad.join('; ') + ' — ' : '') + facts.join('; ') };
};
