// engine/produce/assemble.mjs — K8 (P3): the assembler. Segments from any engine become one
// piece, in every format the request names, each segment encoded ONCE MORE AT MOST (ADR-003).
//
//   assemble(key, { fmts })        the composite legs, chosen by the plan (ADR-003's S2 table):
//     mode 'single' (or one segment)  the thin wrapper: ship.mjs's ensureFinals copies the child's
//                                     finals byte-identical — assembly is SKIPPED (K8)
//     transitions name a fade         THE XFADE LEG: one ffmpeg pass (one encode per segment),
//                                     designed joins, audio acrossfade + one loudnorm
//     mode 'direct' (hard cuts)       THE CONCAT LEG: the concat demuxer with -c copy (ZERO
//                                     encodes — the measured PSNR is inf) + one audio pass;
//                                     falls back to the edit film, loudly, when a child lacks the
//                                     format's final or the bitstreams do not concatenate
//     else (the default, K8)          THE EDIT FILM: films/<key>-asm (kind edit, a child of the
//                                     project) ingests each child's final — the ingest conform is
//                                     the one generation — clips land back-to-back on the
//                                     timeline, per-segment loudness pre-matching (a volume op),
//                                     the dialog bus composites the segments' own audio with the
//                                     8 ms anti-click micro-fades at every join, one mix at
//                                     mix.lufs, and the edit kind's own final render delivers
//                                     (deterministic: same inputs -> same bytes, its checks prove
//                                     it — the assemble check re-assembles and compares md5)
//   assemblyProbes(key)            the per-segment PSNR inputs + the join windows + the duration
//                                   accounting, read from films/<key>/assembly.json (this module
//                                   is that file's ONLY writer; the check measures the files)
//
// Why the edit film is the default despite S2's numbers (the direct leg measures better on time,
// PSNR and generations): assembly is the piece's final craft pass, not only a concat — the edit
// kind carries overlays, captions, punch-ins, reframing (a child that never rendered the format
// still assembles: the conform normalizes geometry/rate, the render crops), the deterministic
// re-render with the segment cache, and the gates; the direct legs are the measured-better fast
// paths for the narrow cases they fit, named by the plan. ADR-003 holds the table and the choice.
//
// films/<key>-asm is the assembler's MACHINE film: one edit.json per format (per-format source
// ids keep every format's conform cached, so re-assembling one format reuses the others' work);
// its edit.json holds the LAST format built. Nobody hand-renders it — `assemble` owns it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, fmtSlug, readJson, writeJson } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { parseFps } from '../lib/frames.mjs';
import { ingestSource } from '../ingest.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { buildDialog, mixEdit } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { appendLog, setState, stateOf } from '../kinds/project/index.mjs';
import { ensureFinals } from './ship.mjs';
import { loudness } from '../audio.mjs';

const rel = (p) => (p && p.startsWith(FILMS) ? `films/${p.slice(FILMS.length + 1).replace(/\\/g, '/')}` : String(p));
const ASM_FPS = 30;                       // the assembly rate (plan.assembly.fps overrides)
const EDGE_FADE_MS = 8;                   // the dialog bus's anti-click micro-fade, mirrored in the direct legs
const TP_HEADROOM = 0.708;                // -3 dBFS before aac: AAC reconstruction adds ~0.4-0.9 dBTP (S2 measured)

// the plan's transitions text -> the transition the assembler owes (null = hard cuts)
export function transitionsOf(plan) {
  const t = String(plan?.assembly?.transitions ?? '').toLowerCase();
  if (!/fade|dissolve|xfade|cross|blend/.test(t)) return null;
  const ms = Number(/([\d.]+)\s*(?:ms|milliseconds)/.exec(t)?.[1] ?? (/([\d.]+)\s*s\b/.exec(t)?.[1] ? +`${/([\d.]+)\s*s\b/.exec(t)[1]}e3` : NaN));
  return { kind: 'fade', ms: Number.isFinite(ms) && ms >= 100 && ms <= 1000 ? Math.round(ms) : 300 };
}

/** The assembler's public surface: the project's parts become one piece per format. */
export async function assemble(key, { fmts } = {}) {
  const dir = join(FILMS, key);
  const cfg = readJson(join(dir, 'film.json'), {});
  const plan = readJson(join(dir, 'plan.json'), null);
  if (!plan) throw new Error(`films/${key}/plan.json is empty — write the plan first (studio project plan ${key} --check)`);
  const mode = plan.assembly?.mode ?? 'edit-film';
  const single = mode === 'single' || (plan.segments || []).length <= 1;
  if (single) {   // K8: a single-technique project skips assembly — the child's finals ARE the finals
    const r = ensureFinals(key);
    appendLog(key, `assembly: single — skipped; the child's finals copied byte-identical (${(r.copied || []).join(', ') || 'none yet'})`);
    setState(key, { phase: 'assembled' });
    return { mode: 'single', copied: r.copied, child: r.child };
  }

  // the segments, each with its child film and its measured final (the artifact, not the status)
  const st = stateOf(key);
  const segs = [];
  for (const s of plan.segments || []) {
    const child = st.segments?.[s.id]?.film ?? s.film ?? `${key}-${s.id}`;
    const cdir = join(FILMS, child);
    if (!existsSync(join(cdir, 'film.json'))) throw new Error(`segment ${s.id}: the child films/${child} does not exist — run \`studio project rebuild ${key} --only ${s.id}\` first`);
    const finals = pickFinals(child);
    if (!finals.length) throw new Error(`segment ${s.id}: films/${child} has no finals under out/ — build it first (\`studio project rebuild ${key} --only ${s.id}\`), then assemble`);
    segs.push({ id: s.id, role: s.role ?? s.id, film: child, capability: s.capability, finals });
  }
  const trans = transitionsOf(plan);
  const target = Number.isFinite(+plan.assembly?.lufs) ? +plan.assembly.lufs
    : Number.isFinite(+cfg.mix?.lufs) ? +cfg.mix.lufs : -14;
  const formats = (fmts && fmts.length ? fmts : cfg.formats || ['16:9']).filter((f) => /^[\w:.-]+$/.test(f));
  const out = join(dir, 'out'); mkdirSync(out, { recursive: true });

  const record = { key, at: new Date().toISOString(), mode, transitions: trans, target, fps: parseFps(plan.assembly?.fps ?? ASM_FPS).str, formats: [] };
  let fellBack = null;
  for (const fmt of formats) {
    const slug = fmtSlug(fmt);
    const leg = trans ? 'xfade' : mode === 'direct' ? 'concat' : 'edit-film';
    let r = null;
    if (leg === 'xfade') r = await xfadeLeg(key, segs, fmt, target, trans, { out, slug });
    else if (leg === 'concat') {
      r = await concatLeg(key, segs, fmt, target, { out, slug });
      if (r.fellBack) { fellBack = r.fellBack; console.log(`  ${fmt}: direct fell back -> ${fellBack}`); r = await editFilmLeg(key, segs, fmt, target, plan, cfg, { out, slug }); }
    } else r = await editFilmLeg(key, segs, fmt, target, plan, cfg, { out, slug });
    record.formats.push(r.probe);
    console.log(`  ${fmt}: ${r.leg} -> ${rel(join(out, `final-${slug}.mp4`))}`);
  }
  writeJson(join(dir, 'assembly.json'), record);
  setState(key, { phase: 'assembled' });
  appendLog(key, `assembled (${mode}${trans ? ` + ${trans.ms} ms fades` : ', hard cuts'}): ${record.formats.map((f) => `${f.fmt} via ${f.leg}`).join(', ')}; one mix at ${target} LUFS${fellBack ? `; NOTE: ${fellBack}` : ''}`);
  return { mode, transitions: trans, target, formats: record.formats };
}

// a child's finals, the asked format first (the assembler prefers the child's own render of the
// format — engine-native reframing beats any crop assembly could do), any final as the fallback
function pickFinals(child) {
  const out = join(FILMS, child, 'out');
  const cfg = readJson(join(FILMS, child, 'film.json'), {});
  if (!existsSync(out)) return [];
  const all = readdirSync(out).filter((f) => /^final-[\w-]+\.mp4$/.test(f));
  const want = (cfg.formats || []).map((f) => `final-${fmtSlug(f)}.mp4`);
  const order = [...want.filter((f) => all.includes(f)), ...all.filter((f) => !want.includes(f))];
  return order.map((f) => ({ file: join(out, f), fmt: f.replace(/^final-/, '').replace(/\.mp4$/, '') }));
}

// ── the edit film (the default) ─────────────────────────────────────────────────────────────
async function editFilmLeg(key, segs, fmt, target, plan, cfg, { out, slug }) {
  const asmKey = `${key}-asm`;
  const fps = parseFps(plan?.assembly?.fps ?? ASM_FPS);
  const formats = cfg.formats || [fmt];
  const adir = join(FILMS, asmKey);
  if (!existsSync(join(adir, 'film.json'))) {
    const { kindModule } = await import('../kinds/registry.mjs');
    await (await kindModule('edit')).create(asmKey, { fps: fps.value, title: `${key} — assembly`, formats });
  }
  // the link: the asm film is a child of the project (the films list groups it under the piece)
  const acfg = readJson(join(adir, 'film.json'), {});
  if (acfg.parent !== key || acfg.music !== null || +acfg.mix?.lufs !== target) {
    writeJson(join(adir, 'film.json'), { ...acfg, parent: key, music: null, mix: { lufs: target } });   // the segments' own audio rides their finals; no bed over them
  }

  // ingest each child's final for THIS format (per-format ids keep every format's conform cached)
  const parts = [];
  for (const s of segs) {
    const native = s.finals.find((f) => f.fmt === slug);
    const use = native ?? s.finals[0];
    const id = `${s.id}-${slug}`;
    await ingestSource(asmKey, use.file, { id, log: () => {} });
    const bin = readJson(join(adir, 'assets', 'media', 'index.json'), { sources: {} });
    const frames = bin.sources[id].frames;
    const dur = +(frames / fps.value).toFixed(6);
    parts.push({ seg: s, id, src: use, frames, dur, reframed: !native });
  }

  // the timeline: deterministic clips (stable ids s01/s02/… so a re-assemble rebuilds the SAME
  // edit.json — the segment cache hits and the render is byte-identical)
  const want = parts.map((p, i) => ({ id: p.seg.id, src: p.id, in: 0, out: p.dur, at: parts.slice(0, i).reduce((n, q) => n + q.dur, 0) }));
  const { edit } = loadEdit(asmKey);
  const same = (clips) => clips.length === want.length && clips.every((c, i) => c.id === want[i].id && c.src === want[i].src
    && Math.abs(c.in - want[i].in) < 1e-9 && Math.abs(c.out - want[i].out) < 1e-9 && Math.abs(c.at - want[i].at) < 1e-9);
  const v1 = edit.tracks.find((t) => t.kind === 'video');
  if (!same(v1?.clips ?? [])) {
    for (const t of edit.tracks) for (const c of [...t.clips]) await applyOps(asmKey, { op: 'delete', id: c.id });
    for (const w of want) await applyOps(asmKey, { op: 'add', id: w.id, src: w.src, in: w.in, out: w.out, at: w.at, note: `${w.id} (${parts.find((p) => p.seg.id === w.id).seg.capability})` });
    syncFilm(asmKey);
  }

  // per-segment loudness pre-matching: each child's final measured (ebur128), a volume op lands
  // every segment at the target so the piece is even before the one normalize (S2: -13.9/-14/-16
  // -> gains 0/+2/0 dB; the assembled mix then measured -13.9 LUFS with no step between parts)
  for (const p of parts) {
    const l = await loudness(p.src.file);
    if (l.lufs === null || !Number.isFinite(l.lufs)) continue;
    const db = Math.max(-12, Math.min(12, +(target - l.lufs).toFixed(1)));
    if (db !== 0) await applyOps(asmKey, { op: 'volume', id: p.seg.id, db });
  }

  // the ONE mix: the dialog bus (the segments' own audio, micro-fades at the joins) + the normalize
  await buildDialog(asmKey, { log: () => {} });
  await mixEdit(asmKey, { target });

  const [r] = await renderFilm(asmKey, { quality: 'final', fmt, log: () => {} });
  const dst = join(out, `final-${slug}.mp4`);
  copyFileSync(r.file, dst);

  let at = 0;
  const segments = parts.map((p) => { const s = { id: p.seg.id, film: p.seg.film, at: +at.toFixed(6), dur: p.dur, ref: p.src.file, refAt: 0, reframed: p.reframed }; at += p.dur; return s; });
  const joins = segments.slice(1).map((s, i) => ({ at: +(segments[i].at + segments[i].dur).toFixed(6), ms: 0, from: +(segments[i].at + segments[i].dur - 0.15).toFixed(3), to: +(segments[i].at + segments[i].dur + 0.15).toFixed(3) }));
  return { leg: 'edit-film', probe: { fmt, slug, leg: 'edit-film', file: dst, fps: fps.str, sum: +at.toFixed(6), overlaps: 0, expected: +at.toFixed(6), joins, segments } };
}

// ── the concat leg (mode 'direct': zero encodes) ───────────────────────────────────────────
async function concatLeg(key, segs, fmt, target, { out, slug }) {
  const missing = segs.filter((s) => !s.finals.some((f) => f.fmt === slug));
  if (missing.length) return { fellBack: `direct needs every child's final-${slug}.mp4; ${missing.map((s) => `films/${s.film}`).join(', ')} lack(s) it — assembling through the edit film (the conform + the crop reframe)` };
  const parts = [];
  for (const s of segs) {
    const src = s.finals.find((f) => f.fmt === slug).file;
    parts.push({ seg: s, src, dur: await durationOf(src), lufs: await lufsOf(src) });
  }
  const work = join(out, `.asm-${slug}-direct`); mkdirSync(work, { recursive: true });
  try {
    // video: the concat demuxer, stream copy — the segments' pixels are NEVER re-encoded
    writeFileSync(join(work, 'list.txt'), parts.map((p) => `file '${p.src}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c', 'copy', '-an', join(work, 'silent.mp4')]);
    // verify the copy actually concatenated (mixed codecs/geometry can produce a broken file silently)
    const gotFrames = await framesOf(join(work, 'silent.mp4'));
    const wantFrames = parts.reduce((n, p) => n + Math.round(p.dur * parseFps(ASM_FPS).value), 0);
    const gotDur = await durationOf(join(work, 'silent.mp4'));
    const sum = parts.reduce((n, p) => n + p.dur, 0);
    if (Math.abs(gotFrames - wantFrames) > 1 || Math.abs(gotDur - sum) > 0.05) {
      return { fellBack: `the children's finals did not concatenate cleanly at -c copy (${gotFrames} frames / ${gotDur.toFixed(3)}s, expected ${wantFrames} / ${sum.toFixed(3)}s) — assembling through the edit film (the conform normalizes every part)` };
    }
    // one audio pass: pre-match gains + 8 ms edge fades, concat, the studio's two-pass loudnorm
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], db = dbTo(target, p.lufs);
      await ffmpeg(['-i', p.src, '-map', '0:a', '-af',
        `volume=${db}dB,afade=t=in:st=0:d=${EDGE_FADE_MS / 1000},afade=t=out:st=${Math.max(0, p.dur - EDGE_FADE_MS / 1000).toFixed(3)}:d=${EDGE_FADE_MS / 1000}`,
        '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', join(work, `a${i}.wav`)]);
    }
    writeFileSync(join(work, 'alist.txt'), parts.map((_, i) => `file 'a${i}.wav'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'alist.txt'), '-c', 'copy', join(work, 'premix.wav')]);
    const { normalize } = await import('../audio.mjs');
    await normalize(join(work, 'premix.wav'), join(work, 'mix.wav'), target);
    const dst = join(out, `final-${slug}.mp4`);
    await ffmpeg(['-i', join(work, 'silent.mp4'), '-i', join(work, 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', `alimiter=limit=${TP_HEADROOM}:level=0:attack=5:release=50`, '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', dst]);
    let at = 0;
    const segments = parts.map((p) => { const s = { id: p.seg.id, film: p.seg.film, at: +at.toFixed(6), dur: p.dur, ref: p.src, refAt: 0 }; at += p.dur; return s; });
    const joins = segments.slice(1).map((s, i) => ({ at: +(segments[i].at + segments[i].dur).toFixed(6), ms: 0, from: +(segments[i].at + segments[i].dur - 0.15).toFixed(3), to: +(segments[i].at + segments[i].dur + 0.15).toFixed(3) }));
    return { leg: 'direct', probe: { fmt, slug, leg: 'direct', file: dst, fps: parseFps(ASM_FPS).str, sum: +at.toFixed(6), overlaps: 0, expected: +at.toFixed(6), joins, segments } };
  } finally { for (const f of readdirSync(work)) if (/\.(wav|mp4|txt)$/.test(f)) rmSync(join(work, f), { force: true }); }
}

// ── the xfade leg (the plan's transitions: one encode, designed joins) ──────────────────────
async function xfadeLeg(key, segs, fmt, target, trans, { out, slug }) {
  const X = trans.ms / 1000;
  const missing = segs.filter((s) => !s.finals.some((f) => f.fmt === slug));
  if (missing.length) throw new Error(`transitions need every child's final-${slug}.mp4: ${missing.map((s) => `films/${s.film}`).join(', ')} lack(s) it — rebuild the child in this format (\`studio project rebuild ${key} --only ${missing[0].id}\`) or write assembly.transitions: 'hard cuts'`);
  const parts = [];
  for (const s of segs) {
    const src = s.finals.find((f) => f.fmt === slug).file;
    parts.push({ seg: s, src, dur: await durationOf(src), lufs: await lufsOf(src) });
  }
  const work = join(out, `.asm-${slug}-xfade`); mkdirSync(work, { recursive: true });
  try {
    // video: [i] -> xfade chains -> ONE encode (each segment's pixels re-encoded exactly once)
    // xfade needs MATCHED inputs: the children of different kinds render at different rates
    // (edit 30, math/motion 60) and geometries — normalize every part to the assembly format
    // first (fps + scale + SAR + pix_fmt), THEN the fade chain. Found live on the composite demo
    // (s01 30fps x s02 60fps: 'first input link parameters do not match').
    const W = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] }[fmt];
    let vf = parts.map((_, i) =>
      `[${i}:v]setpts=PTS-STARTPTS,fps=${ASM_FPS},scale=${W[0]}:${W[1]}:flags=lanczos,setsar=1,format=yuv420p[v${i}]`).join(';');
    let cur = 'v0';
    parts.slice(1).forEach((_, i) => {
      const off = parts.slice(0, i + 1).reduce((n, q) => n + q.dur, 0) - (i + 1) * X;
      const last = i + 2 >= parts.length;
      vf += `;[${cur}][v${i + 1}]xfade=transition=fade:duration=${X}:offset=${off.toFixed(6)}${last ? ',setsar=1,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv,format=yuv420p' : ''}[x${i + 1}]`;
      cur = `x${i + 1}`;
    });
    await ffmpeg([...parts.flatMap((p) => ['-i', p.src]), '-filter_complex', vf, '-map', `[${cur}]`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', '-an', join(work, 'silent.mp4')]);
    // audio: pre-match gains + edge fades, acrossfade chains (the same X), one loudnorm
    let af = parts.map((p, i) => {
      const fades = [i > 0 ? `afade=t=in:st=0:d=${X}` : null, i + 1 < parts.length ? `afade=t=out:st=${(p.dur - X).toFixed(6)}:d=${X}` : null].filter(Boolean);
      return `[${i}:a]volume=${dbTo(target, p.lufs)}dB${fades.length ? ',' + fades.join(',') : ''}[a${i}]`;
    }).join(';');
    let acur = 'a0';
    parts.slice(1).forEach((_, i) => { af += `;[${acur}][a${i + 1}]acrossfade=d=${X}[j${i + 1}]`; acur = `j${i + 1}`; });
    af += `;[${acur}]aresample=48000,pan=stereo|c0=c0|c1=c1[premix]`;
    await ffmpeg([...parts.flatMap((p) => ['-i', p.src]), '-filter_complex', af, '-map', '[premix]', '-c:a', 'pcm_f32le', join(work, 'premix.wav')]);
    const { normalize } = await import('../audio.mjs');
    await normalize(join(work, 'premix.wav'), join(work, 'mix.wav'), target);
    const dst = join(out, `final-${slug}.mp4`);
    await ffmpeg(['-i', join(work, 'silent.mp4'), '-i', join(work, 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', `alimiter=limit=${TP_HEADROOM}:level=0:attack=5:release=50`, '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', dst]);

    // the probe: the segment windows INCLUDE their fades (a fade frame is a new picture by design —
    // ADR-003), so each segment also names its PURE window, the honest fidelity reference
    let acc = 0;
    const segments = [], joins = [];
    parts.forEach((p, i) => {
      const start = i === 0 ? 0 : acc - X;            // this part's content begins (blended in)
      const end = start + p.dur;                      // …and runs to its own last frame
      const head = i > 0 ? X + 0.05 : 0;              // skip the blend-in (plus one guard frame)
      const tail = i + 1 < parts.length ? X + 0.05 : 0;
      const pure = { from: +(start + head).toFixed(6), dur: +(p.dur - head - tail).toFixed(6) };
      segments.push({ id: p.seg.id, film: p.seg.film, at: +start.toFixed(6), dur: p.dur, ref: p.src, refAt: 0, pure });
      if (i + 1 < parts.length) joins.push({ at: +end.toFixed(6), ms: trans.ms, from: +(end - X - 0.05).toFixed(3), to: +(end + 0.2).toFixed(3) });
      acc = end;
    });
    const sum = parts.reduce((n, p) => n + p.dur, 0), overlaps = (parts.length - 1) * X;
    return { leg: 'direct+xfade', probe: { fmt, slug, leg: 'direct+xfade', file: dst, fps: parseFps(ASM_FPS).str, sum: +sum.toFixed(6), overlaps: +overlaps.toFixed(6), expected: +(sum - overlaps).toFixed(6), joins, segments } };
  } finally { for (const f of readdirSync(work)) if (/\.(wav|mp4)$/.test(f)) rmSync(join(work, f), { force: true }); }
}

// ── assemblyProbes: the check's inputs (everything the measurements need, nothing asserted) ──
export function assemblyProbes(key) {
  const rec = readJson(join(FILMS, key, 'assembly.json'), null);
  if (!rec) throw new Error(`films/${key}/assembly.json is missing — run the assembler first (assemble('${key}'))`);
  for (const f of rec.formats || []) {
    if (!existsSync(f.file)) throw new Error(`films/${key}/assembly.json names ${rel(f.file)} but it is gone — re-assemble`);
    for (const s of f.segments || []) if (!existsSync(s.ref)) throw new Error(`the ${f.fmt} record's segment ${s.id} names ${rel(s.ref)} but it is gone — re-assemble`);
  }
  return rec;
}

// ── small measured helpers (every number in assembly.json comes from ffmpeg, never a guess) ──
function ffmpeg(args) { return run('ffmpeg', ['-y', '-v', 'error', ...args]); }
const durationOf = async (file) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).out.trim());
const framesOf = async (file) => { const n = Number((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file])).out.trim()); return Number.isInteger(n) && n > 0 ? n : Math.round((await durationOf(file)) * parseFps(ASM_FPS).value); };
async function lufsOf(file) { const l = await loudness(file); return Number.isFinite(l.lufs) ? l.lufs : null; }
const dbTo = (target, lufs) => (lufs === null ? 0 : Math.max(-12, Math.min(12, +(target - lufs).toFixed(1))));
