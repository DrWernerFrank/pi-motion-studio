// autoedit: `studio autoedit <film> --preset …` — the deterministic pipeline of real-video-editing D10.
// No LLM anywhere: every choice is a measurement (the silence map, transcript word density, beats.json,
// the face tracker) or a fixed craft rule from the video-edit skill (§8). The agent runs the same engine
// functions by hand and adds what only judgment can (which lines are the highlights, the hook, emphasis);
// autoedit is the floor, not the editor. Every timeline change goes through applyOps (validated, atomic,
// undoable — never a hand-written edit.json), and the report says exactly what was removed. Drafts render
// by default ("drafts often"); --final ships finals and requires the gates to pass.
//
//   talking-head  ingest → transcribe → cut silence/fillers/takes → title (first sentence, ≤6 words) →
//                 captions pop → reframe (follow when a face is tracked + alternating punch-ins) → sound
//                 → gates → draft renders of every format
//   screen        ingest → transcribe (skipped, said out loud, when the recording has no audio) →
//                 cut idle → cut silence (tighter) → captions typewriter → sound → gates → drafts
//   audiogram     (an audio-only source) ingest → transcribe → the densest contiguous ~target s of speech
//                 as A1 clips → the studio's own picture (waveform + captions, written into index.html)
//                 → sound → gates → 16:9 + 9:16 drafts
//   montage       ingest clips + song → measured beats → clip i on chosen beat i (each clip once) → the
//                 song on A1 → title → sound → gates → drafts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createEditFilm, describe } from './edit-cli.mjs';
import { ingestSource, mediaDir, readBin } from './ingest.mjs';
import { transcribe } from './transcribe.mjs';
import { cutFillers, cutIdle, cutSilence, cutTakes, tighten } from './cut.mjs';
import { applyOps, loadEdit, syncFilm } from './lib/edit-store.mjs';
import { clipFrames, grid, timelineFrames, timelineSeconds } from './lib/edit-ops.mjs';
import { retimeWords } from './lib/retime.mjs';
import { buildDialog, mixEdit } from './edit-audio.mjs';
import { gates } from './gates.mjs';
import { renderFilm } from './render.mjs';
import { measureBeats } from './audio.mjs';
import { pythonFor } from './doctor.mjs';
import { FILMS, readFilm, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const PRESETS = {
  'talking-head': { formats: ['16:9', '9:16', '1:1', '4:5'], target: null }, // the golden path exports all four
  screen: { formats: ['16:9'], target: null },
  audiogram: { formats: ['16:9', '9:16'], target: 60 },
  montage: { formats: ['16:9'], target: 30 },
};

const rel = (f) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f);
const fmtS = (s) => `${s.toFixed(2)}s`;
const SENT_END = /[.!?،؛؟]$/; // sentence enders, latin + arabic-script (the transcripts are language-agnostic)

export async function autoedit(filmKey, { preset, srcs = [], target, id, final = false, log = console.log } = {}) {
  if (!preset || !PRESETS[preset]) throw new Error('studio autoedit <film> --preset talking-head|screen|audiogram|montage [--src <file>…] [--target 60] [--final] [--id cam]');
  if (!filmKey) throw new Error('studio autoedit <film> --preset <preset> [--src <file>…]');
  const say = (m) => log(m);
  const report = { preset, film: filmKey, steps: [] };
  const step = (line) => report.steps.push(line);

  // 1. the film: create it when missing (`studio new <key> --edit`), never reshape an existing one
  if (!existsSync(join(FILMS, filmKey, 'film.json'))) {
    const dir = createEditFilm(filmKey, { formats: PRESETS[preset].formats });
    say(`created ${rel(dir)} (edit film, formats ${PRESETS[preset].formats.join(', ')})`);
  }
  const ctx = { filmKey, say, report, step, target: target ?? PRESETS[preset].target };

  // 2. ingest (cached by content hash: a re-run is a no-op). --id applies to a single source, like the CLI.
  for (const src of srcs) {
    const r = await ingestSource(filmKey, src, { id: srcs.length === 1 && id ? id : undefined });
    say(`ingest ${r.id}: ${r.kind} ${r.cached ? 'cache hit' : r.seconds + 's'}${r.ingest.conform ? ` (${r.ingest.conform.frames} frames @ ${r.ingest.conform.fps})` : ''}`);
  }

  // 3. the preset
  if (preset === 'talking-head') await talkingHead(ctx);
  else if (preset === 'screen') await screenPreset(ctx);
  else if (preset === 'audiogram') await audiogram(ctx);
  else await montagePreset(ctx);

  // 4. sound: the dialog bus builds itself from the timeline → out/mix.wav at the loudness target
  say('── sound');
  await buildDialog(filmKey, { log: say });
  const mix = await mixEdit(filmKey);
  say(`${rel(mix.file)}  ${mix.lufs} LUFS, true peak ${mix.truePeak} dBFS`);
  step(`mix: ${mix.lufs} LUFS, true peak ${mix.truePeak} dBFS`);

  // 5. gates — never weakened; a FAIL is reported (and blocks --final)
  say('── gates');
  const g = await gates(filmKey, { log: say });
  report.gates = { pass: g.pass, fails: g.checks.filter((c) => !c.pass && c.level === 'fail').map((c) => c.name) };
  step(`gates: ${g.pass ? 'PASS' : `FAIL (${report.gates.fails.join(', ')})`}`);

  // 6. ship: drafts of every format by default (--final ships finals, but only through passing gates)
  say(final ? (g.pass ? '── final render (all formats)' : '── gates failed: rendering drafts, not finals — fix the FAILs, then --final') : '── draft render (all formats)');
  const renders = await renderFilm(filmKey, { quality: final && g.pass ? 'final' : 'draft', fmt: 'all', log: say });
  step(`renders: ${renders.map((r) => `${rel(r.file)} (${r.frames} frames, ${r.seconds}s)`).join(', ')}`);
  report.rendered = renders.map((r) => rel(r.file));

  // 7. the compact report
  const { film, edit } = loadEdit(filmKey);
  say(`\n── report\n  ${describe(film, edit).split('\n')[0]}\n  ${report.steps.map((s) => `  ${s}`).join('\n').trim()}`);
  report.pass = g.pass;
  return report;
}

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────

// the speech source: what the timeline shows, else the first video source in the bin
function speechSource(edit, bin) {
  const onTimeline = edit.tracks.find((t) => t.kind === 'video')?.clips[0]?.src;
  if (onTimeline) return onTimeline;
  const ids = Object.keys(bin.sources);
  return ids.find((k) => bin.sources[k].kind === 'video' && bin.sources[k].has_audio) ?? ids.find((k) => bin.sources[k].kind === 'video') ?? null;
}

// the cuts work on what is on the timeline: put the whole source on V1 when it is empty (at 0, one clip)
function ensureOnTimeline(ctx, srcId) {
  const { edit } = loadEdit(ctx.filmKey);
  if (edit.tracks.some((t) => t.kind === 'video' && t.clips.length)) return false;
  applyOps(ctx.filmKey, [{ op: 'add', src: srcId, note: 'autoedit: the whole source, before the cuts' }], { who: 'autoedit' });
  syncFilm(ctx.filmKey);
  return true;
}

// apply a cut pass and record it (frames → seconds at the edit's own rational fps)
async function cut(ctx, kind, pass) {
  const r = await pass();
  if (!r.actionable) { ctx.say(`cut ${kind}: nothing to do`); return r; }
  const { edit } = loadEdit(ctx.filmKey), { fps } = grid(edit);
  ctx.step(`cut ${kind}: ${r.actionable} cut(s), ${fmtS((r.framesRemoved * fps.den) / fps.num)} out${r.removedText ? ` — removed: "${r.removedText}"` : ''}`);
  return r;
}

// a title card, idempotent: the same id every run, so a re-run updates instead of stacking
function ensureTitle(ctx, text) {
  const { edit } = loadEdit(ctx.filmKey);
  const op = edit.overlays.some((o) => o.id === 'title')
    ? { op: 'overlay', action: 'update', id: 'title', at: 0.4, dur: 2.4, props: { text } }
    : { op: 'overlay', type: 'title', id: 'title', at: 0.4, dur: 2.4, props: { text } };
  applyOps(ctx.filmKey, [op], { who: 'autoedit' });
}

// captions on. captions.js sizes its type from the design.json ladder (D.px('caption', L)), so make sure
// the rung exists — the shared template may not carry it yet. Nothing under 3.2u is enforced there.
function setCaptions(ctx, style, from) {
  applyOps(ctx.filmKey, [{ op: 'caption-style', style, from }], { who: 'autoedit' });
  const film = readFilm(ctx.filmKey), file = join(film.dir, 'design.json'), d = readJson(file);
  if (d && !(d.ladder || []).some((r) => r.role === 'caption')) {
    writeJson(file, { ...d, ladder: [...(d.ladder || []), { role: 'caption', u: 4.6, weight: 600, trackingEm: 0 }] });
    ctx.say('  design.json: added the caption rung to the type ladder (u 4.6)');
  }
}

// a rebuild preset lays its own clips: clear the tracks first (through ops, one undo step)
function clearClips(ctx) {
  const { edit } = loadEdit(ctx.filmKey);
  const ids = edit.tracks.flatMap((t) => t.clips.map((c) => c.id));
  if (ids.length) applyOps(ctx.filmKey, ids.map((cid) => ({ op: 'delete', id: cid })), { who: 'autoedit' });
}

// ── talking-head ──────────────────────────────────────────────────────────────────────────────────

async function talkingHead(ctx) {
  const { filmKey, say } = ctx;
  const bin = readBin(readFilm(filmKey)), { edit } = loadEdit(filmKey);
  const srcId = speechSource(edit, bin);
  if (!srcId) throw new Error(`no footage in the bin: studio autoedit ${filmKey} --preset talking-head --src <file>`);
  if (!bin.sources[srcId]?.has_audio) throw new Error(`source "${srcId}" has no audio: a talking head is its speech (transcribe and the cuts are measured from it)`);
  const from = timelineSeconds(loadEdit(filmKey).edit);
  ensureOnTimeline(ctx, srcId);

  const doc = await transcribe(filmKey, srcId, { log: say });
  ctx.step(`transcribe ${srcId}: ${doc.words.length} words, lang ${doc.language} (${doc.language_probability})${doc.cached ? ', cached' : ''}`);

  // measured cuts (D6): dead air, then the ums, then the retakes; tighten only when --target was given
  await cut(ctx, 'silence', () => cutSilence(filmKey, { src: srcId, maxGap: 0.5, keepBreath: 0.15, apply: true, log: say }));
  await cut(ctx, 'fillers', () => cutFillers(filmKey, { src: srcId, apply: true, log: say }));
  await cut(ctx, 'takes', () => cutTakes(filmKey, { src: srcId, apply: true, log: say }));
  if (ctx.target) await cut(ctx, 'tighten', () => tighten(filmKey, { target: ctx.target, apply: true, log: say }));
  syncFilm(filmKey);

  // the hook, deterministically: the first sentence of the CUT (≤6 words) — the agent swaps in the real one
  const edit2 = loadEdit(filmKey).edit, title = openingLine(edit2, srcId, doc, readFilm(filmKey).cfg.title);
  ensureTitle(ctx, title);
  ctx.step(`title @0.4s +2.4s: "${title}"`);

  setCaptions(ctx, 'pop', srcId);
  ctx.step('captions: pop (word-accurate, retimed onto the cut — never re-transcribed)');

  // reframe (D8): track the face, then the follow camera; no face → center, said out loud. Plus the craft
  // rule §8: alternate framing on every other cut (~1.1x punch-in) so jump cuts read as rhythm, not errors.
  ctx.step(`reframe: ${await reframeFollow(ctx, srcId)}`);
  punchIns(ctx);

  const edit3 = loadEdit(filmKey).edit;
  syncFilm(filmKey);
  ctx.step(`timeline: ${fmtS(from)} → ${fmtS(timelineSeconds(edit3))} (${timelineFrames(edit3)} frames @ ${edit3.fps} fps)`);
}

// the first sentence of the retimed transcript, capped at 6 words (empty → the film's title)
function openingLine(edit, srcId, doc, fallback) {
  const line = [];
  for (const w of retimeWords(edit, srcId, doc.words)) {
    line.push(w.text);
    if (SENT_END.test(w.text) || line.length >= 6) break;
  }
  return (line.join(' ') || String(fallback || '')).replace(/[\s,;:.!?،؛؟]+$/, '');
}

// YuNet faces (ADR-003) → track.json in the source's media folder → cam follow on every clip. A tracker
// that is not installed or finds no face is a documented center crop, not a failure.
async function reframeFollow(ctx, srcId) {
  const { film } = loadEdit(ctx.filmKey), dir = mediaDir(film, srcId), trackFile = join(dir, 'track.json');
  if (!existsSync(trackFile)) {
    try { await run(pythonFor('ml'), [join(ROOT, 'engine', 'track.mjs'), '--in', join(dir, 'conformed.mp4'), '--out', trackFile, '--faces']); }
    catch (e) { ctx.say(`  reframe: tracker unavailable (${String(e.message).split('\n')[0]})`); return 'center crop (no tracker)'; }
  }
  const trk = readJson(trackFile), faces = (trk?.boxes || []).filter((b) => b.x !== null && b.x !== undefined);
  if (!faces.length) return 'center crop (no face measured)';
  const { edit } = loadEdit(ctx.filmKey);
  const clips = edit.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips);
  applyOps(ctx.filmKey, clips.map((c) => ({ op: 'cam', id: c.id, mode: 'follow' })), { who: 'autoedit' });
  return `follow on ${clips.length} clip(s) (${faces.length} face samples)`;
}

// every other cut gets ~1.1x (craft rule §8); idempotent (one overlay id per clip)
function punchIns(ctx) {
  const { edit } = loadEdit(ctx.filmKey), G = grid(edit);
  const have = new Set(edit.overlays.map((o) => o.id));
  const clips = (edit.tracks.find((t) => t.kind === 'video')?.clips ?? []).slice().sort((a, b) => G.F(a.at) - G.F(b.at));
  const ops = [];
  clips.forEach((c, i) => {
    if (i % 2 !== 1) return; // clip 0 at 100%, clip 1 at ~110%, …
    const len = G.S(clipFrames(edit, c));
    if (len < 0.5) return;
    const oid = `punch-${c.id}`;
    if (have.has(oid)) return;
    ops.push({ op: 'overlay', type: 'punch-in', id: oid, at: c.at, dur: len, props: { zoom: 1.1, showDot: false } });
  });
  if (ops.length) applyOps(ctx.filmKey, ops, { who: 'autoedit' });
  ctx.step(`framing: ${ops.length} alternating punch-in(s) on every other cut`);
}

// ── screen ───────────────────────────────────────────────────────────────────────────────────────

async function screenPreset(ctx) {
  const { filmKey, say } = ctx;
  const bin = readBin(readFilm(filmKey)), { edit } = loadEdit(filmKey);
  const srcId = speechSource(edit, bin);
  if (!srcId) throw new Error(`no recording in the bin: studio autoedit ${filmKey} --preset screen --src <file>`);
  const from = timelineSeconds(loadEdit(filmKey).edit);
  ensureOnTimeline(ctx, srcId);

  // a screen recording may have no audio at all: that is measured, and transcription/captions are skipped
  // with a line, not guessed at (the silence map is absent too, so its cut pass goes with it)
  const hasAudio = !!bin.sources[srcId]?.has_audio;
  let doc = null;
  if (hasAudio) {
    doc = await transcribe(filmKey, srcId, { log: say });
    ctx.step(`transcribe ${srcId}: ${doc.words.length} words, lang ${doc.language} (${doc.language_probability})`);
  } else ctx.step(`${srcId}: no audio — transcription and captions skipped (measured, not guessed)`);

  await cut(ctx, 'idle', () => cutIdle(filmKey, { src: srcId, maxIdle: 1.0, apply: true, log: say }));
  if (hasAudio) await cut(ctx, 'silence', () => cutSilence(filmKey, { src: srcId, maxGap: 0.4, keepBreath: 0.15, apply: true, log: say }));
  if (ctx.target) await cut(ctx, 'tighten', () => tighten(filmKey, { target: ctx.target, apply: true, log: say }));

  if (doc && doc.words.length) { setCaptions(ctx, 'typewriter', srcId); ctx.step('captions: typewriter'); }
  const edit2 = loadEdit(filmKey).edit;
  syncFilm(filmKey);
  ctx.step(`timeline: ${fmtS(from)} → ${fmtS(timelineSeconds(edit2))} (${timelineFrames(edit2)} frames @ ${edit2.fps} fps)`);
}

// ── audiogram ────────────────────────────────────────────────────────────────────────────────────

async function audiogram(ctx) {
  const { filmKey, say } = ctx;
  const film = readFilm(filmKey), bin = readBin(film);
  const srcId = Object.keys(bin.sources).find((k) => bin.sources[k].kind === 'audio');
  if (!srcId) throw new Error('audiogram needs an audio-only source (a podcast): studio autoedit <film> --preset audiogram --src podcast.m4a — for filmed speech use talking-head');
  const dur = bin.sources[srcId].duration;
  const doc = await transcribe(filmKey, srcId, { log: say });
  ctx.step(`transcribe ${srcId}: ${doc.words.length} words, lang ${doc.language} (${doc.language_probability})`);

  // the best ~target s, measured: sentence spans from the transcript, the contiguous window with the most
  // words inside 1.05 × target wins (word density); sentences stay in spoken order, back to back on A1
  const spans = sentenceSpans(doc.words, dur);
  const chosen = densestWindow(spans, ctx.target ?? 60);
  if (!chosen.length) throw new Error(`no speech spans in "${srcId}": the transcript is empty`);
  clearClips(ctx);
  let at = 0;
  applyOps(filmKey, chosen.map((s) => {
    const op = { op: 'add', src: srcId, track: 'A1', in: s.from, out: s.to, at, note: `autoedit: ${s.words} words, ${fmtS(s.to - s.from)}` };
    at += s.to - s.from;
    return op;
  }), { who: 'autoedit' });
  ctx.step(`speech: ${chosen.length} sentence clip(s), ${fmtS(at)} of ${fmtS(dur)} (${chosen.reduce((a, s) => a + s.words, 0)} words) — the densest window`);

  // the picture (the honest minimal path, documented in brief.md): the engine retimes caption words through
  // VIDEO tracks only (engine/lib/retime.mjs) and an audiogram's speech lives on A1, so edit.json captions
  // cannot carry it. autoedit writes an over() hook into the film's own index.html instead: the measured
  // peaks as a waveform and the words as captions, both through the studio's own captions.js + design.json.
  writeFileSync(join(film.dir, 'index.html'), audiogramHtml(srcId));
  noteBrief(film, 'audiogram', `- **autoedit (audiogram):** the picture is generated, not footage — the speech's measured peaks as a\n  waveform plus captions on the design system, drawn by the over() hook this preset wrote into\n  index.html (the engine retimes caption words through video tracks only; an audiogram's speech is on\n  A1, so the hook maps the words itself). Replace the hook with your own visual any time — the edit\n  (A1 clips, the cut) does not change.`);
  ensureCaptionRung(film, say);
  syncFilm(filmKey);
  const edit2 = loadEdit(filmKey).edit;
  ctx.step(`timeline: ${fmtS(timelineSeconds(edit2))} (${timelineFrames(edit2)} frames @ ${edit2.fps} fps), picture: waveform + captions hook`);
}

// sentence spans: break at . ! ? ، ؛ ؟ or a > 0.8 s pause, ≥3 words, with a breath of lead/tail
function sentenceSpans(words, dur) {
  const runs = []; let cur = [];
  for (const w of words) {
    const prev = cur.at(-1);
    if (cur.length && (SENT_END.test(prev.text) || w.start - prev.end > 0.8)) { runs.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) runs.push(cur);
  return runs.filter((ws) => ws.length >= 3).map((ws) => ({
    from: Math.max(0, ws[0].start - 0.06), to: Math.min(dur, ws.at(-1).end + 0.12),
    words: ws.length, text: ws.map((w) => w.text).join(' '),
  })).filter((s) => s.to - s.from >= 0.6);
}

// the contiguous span run with the most words whose length stays within 1.05 × target
function densestWindow(spans, target) {
  let best = null;
  for (let i = 0; i < spans.length; i++) {
    let words = 0;
    for (let j = i; j < spans.length; j++) {
      const len = spans[j].to - spans[i].from;
      if (len > target * 1.05 + 0.001) break;
      words += spans[j].words;
      if (!best || words > best.words || (words === best.words && len < best.len)) best = { i, j, words, len };
    }
  }
  return best ? spans.slice(best.i, best.j + 1) : [];
}

function ensureCaptionRung(film, say) {
  const file = join(film.dir, 'design.json'), d = readJson(file);
  if (!d || (d.ladder || []).some((r) => r.role === 'caption')) return;
  writeJson(file, { ...d, ladder: [...(d.ladder || []), { role: 'caption', u: 4.6, weight: 600, trackingEm: 0 }] });
  say('  design.json: added the caption rung to the type ladder (u 4.6)');
}

// append a note to brief.md once (a re-run must not stack copies)
function noteBrief(film, marker, text) {
  const file = join(film.dir, 'brief.md'), cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (cur.includes(`autoedit (${marker})`)) return;
  writeFileSync(file, `${cur}${cur.endsWith('\n') ? '' : '\n'}\n${text}\n`);
}

// ── montage ──────────────────────────────────────────────────────────────────────────────────────

async function montagePreset(ctx) {
  const { filmKey, say } = ctx;
  const film = readFilm(filmKey), bin = readBin(film);

  // the song: an ingested audio source; else the film's own "track" (ingested so it can sit on A1)
  let songId = Object.keys(bin.sources).find((k) => bin.sources[k].kind === 'audio') ?? null;
  if (!songId && film.cfg.track) {
    const p = resolve(film.dir, film.cfg.track);
    if (existsSync(p)) { songId = (await ingestSource(filmKey, p, { id: 'song' })).id; say(`ingest ${songId}: the film's track`); }
  }
  if (!songId) throw new Error('montage needs a song: pass an audio-only file with --src (or set film.json "track")');
  // beats are measured from the song (audio.mjs measureBeats): film.json "track" points at the bin's wav
  // copy, so a moved original never breaks the grid (relink repairs the bin, beats re-measure from it)
  const track = join('assets', 'media', songId, 'audio.wav'), cfg = readJson(join(film.dir, 'film.json'));
  if (cfg.track !== track) { writeJson(join(film.dir, 'film.json'), { ...cfg, track }); say(`  film.json: track = ${track} (beats are measured from it)`); }
  if (!(readJson(join(film.dir, 'beats.json'))?.beats || []).length) {
    const r = await measureBeats(filmKey);
    say(`  beats: ${r.beats} measured at ${r.bpm.toFixed(1)} bpm`);
  }
  const beats = [...new Set(readJson(join(film.dir, 'beats.json')).beats)].sort((a, b) => a - b);
  if (beats.length < 3) throw new Error(`only ${beats.length} beat(s) measured in the song: montage cuts on beats`);

  // the clips: every non-audio source, in ingest order (deterministic; reorder with taste afterwards)
  const bin2 = readBin(readFilm(filmKey));
  const clipIds = Object.keys(bin2.sources).filter((k) => k !== songId && bin2.sources[k].kind !== 'audio');
  if (clipIds.length < 2) throw new Error(`montage needs the clips too: studio autoedit ${filmKey} --preset montage --src clip01.mp4 --src clip02.mp4 … --src song.wav`);

  // clip i starts on chosen beat i (every k-th beat, so the run lands on --target); each clip exactly
  // once, its length the gap to the next chosen beat; the last one rides to the target end. The song sits
  // on A1 from its first beat (in: start, at: 0), so a cut lands at its beat AS HEARD: ats[i] - start.
  const target = ctx.target ?? 30, beatLen = (beats.at(-1) - beats[0]) / (beats.length - 1);
  const k = Math.max(1, Math.round(target / (clipIds.length * beatLen)));
  const songDur = bin2.sources[songId].duration, start = beats[0], end = Math.min(start + target, songDur);
  const ats = [];
  for (let i = 0; i < clipIds.length; i++) { const b = beats[i * k]; if (b === undefined || b > end - 0.2) break; ats.push(b - start); }
  if (ats.length < 2) throw new Error(`the song covers only ${(end - start).toFixed(1)}s of beats for ${clipIds.length} clips: pass --target, or fewer clips`);

  const { edit } = loadEdit(filmKey);
  clearClips(ctx);
  const ops = [];
  clipIds.slice(0, ats.length).forEach((cid, i) => {
    const len = (i + 1 < ats.length ? ats[i + 1] : end - start) - ats[i];
    const srcDur = edit.sources[cid]?.duration ?? bin2.sources[cid].duration;
    const out = Math.min(len, srcDur);
    if (out < len - 1e-6) say(`  ${cid}: ${fmtS(len)} of beat gap but the clip is ${fmtS(srcDur)} — it runs short (the next cut still lands on its beat)`);
    ops.push({ op: 'add', src: cid, in: 0, out, at: ats[i], track: 'V1', note: `autoedit: beat ${i * k + 1}` });
  });
  ops.push({ op: 'add', src: songId, in: start, out: end, at: 0, track: 'A1', note: 'autoedit: the song' });
  applyOps(filmKey, ops, { who: 'autoedit' });
  ensureTitle(ctx, readFilm(filmKey).cfg.title);
  syncFilm(filmKey);
  const used = Math.min(ats.length, clipIds.length);
  ctx.step(`montage: ${used} clip(s) (of ${clipIds.length}), cut on every ${k}-th beat (${(60 / beatLen).toFixed(0)} bpm), ${fmtS(end - start)} long, song on A1`);
  if (used < clipIds.length) ctx.step(`  beats ran out before the clips: used ${used} of ${clipIds.length} (pass --target or fewer clips to use them all)`);
  ctx.step(`title @0.4s +2.4s: "${readFilm(filmKey).cfg.title}"`);
}

// ── the audiogram picture (written into the film's index.html) ────────────────────────────────────

// A pure function of (edit.json, peaks.json, transcript.json, t): the A1 clip playing at t becomes the
// waveform (bars light up behind the playhead), its words the captions — both on the design system.
function audiogramHtml(srcId) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>edit</title>
<link rel="stylesheet" href="/engine/lib/fonts.css">
</head>
<body>
<script type="module">
// autoedit (audiogram): the picture is the studio's own — the speech's measured peaks (peaks.json from
// ingest) as a waveform, its words as captions on the design system. The engine retimes caption words
// through VIDEO tracks only (engine/lib/retime.mjs), and an audiogram's speech lives on A1, so this hook
// does the same mapping over the audio track and draws with the studio's own captions.js. No timers, no
// randomness, no wall clock: a frame is a pure function of (edit.json, peaks, transcript, t).
import { editFilm } from '/engine/lib/edit.js';
import { captionChunks, captions } from '/engine/lib/captions.js';
import { loadDesign } from '/engine/lib/design.js';

const SRC = ${JSON.stringify(srcId)};

editFilm({
  async setup(L, cfg, S) {
    S.ag = { D: await loadDesign('./design.json').catch(() => null) };
    S.ag.peaks = await fetch('./assets/media/' + SRC + '/peaks.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const doc = await fetch('./assets/media/' + SRC + '/transcript.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!doc) return;
    const words = [];
    for (const t of S.edit.tracks) {
      if (t.kind !== 'audio') continue;
      for (const c of t.clips.slice().sort((a, b) => a.at - b.at)) {
        if (c.src !== SRC || c.freeze) continue;
        const len = c.dur !== undefined ? c.dur : c.out - c.in, rate = (c.out - c.in) / (len || 1);
        for (const w of doc.words) if (w.start >= c.in - 1e-6 && w.end <= c.out + 1e-6) words.push({ ...w, start: c.at + (w.start - c.in) / rate, end: c.at + (w.end - c.in) / rate });
      }
    }
    S.ag.cues = captionChunks(words.sort((a, b) => a.start - b.start));
    S.ag.lang = doc.language;
  },
  over(ctx, t, L, S) {
    const ag = S.ag || {}, c = (ag.D && ag.D.c) || { bg: '#0e0e10', ink: '#f2efe9', muted: '#7d7a74', accent: '#ff5b2e' };
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, L.W, L.H);
    const A1 = (S.edit.tracks.find((x) => x.kind === 'audio') || { clips: [] }).clips.slice().sort((a, b) => a.at - b.at);
    const clip = A1.find((k) => t >= k.at && t < k.at + (k.dur !== undefined ? k.dur : k.out - k.in));
    if (!clip || !ag.peaks) return;
    const len = clip.dur !== undefined ? clip.dur : clip.out - clip.in, local = Math.min(len, Math.max(0, t - clip.at));
    const bars = 96, band = L.H * 0.34, cy = L.H * 0.42, bw = L.W / bars, per = 1 / (ag.peaks.rate || 100);
    for (let i = 0; i < bars; i++) {
      const s = clip.in + (i / bars) * len, b = Math.max(0, Math.min(ag.peaks.buckets - 1, Math.floor(s / per)));
      const hi = ag.peaks.data[b * 2 + 1] / ag.peaks.scale, lo = ag.peaks.data[b * 2] / ag.peaks.scale;
      const h = Math.max(L.u * 0.5, (hi - lo) * band * 0.5);
      ctx.fillStyle = (i / bars) * len <= local ? c.accent : c.muted; // the played bars light up: motion every frame
      ctx.fillRect(i * bw + bw * 0.18, cy - h / 2, bw * 0.64, h);
    }
    ctx.fillStyle = c.ink; ctx.fillRect(L.W * (local / len) - L.u * 0.12, cy - band * 0.62, L.u * 0.24, band * 1.24);
    if (ag.cues && ag.D) captions(ctx, t, { cues: ag.cues, style: 'pop', lang: ag.lang, D: ag.D }, L);
  },
});
</script>
</body>
</html>
`;
}
