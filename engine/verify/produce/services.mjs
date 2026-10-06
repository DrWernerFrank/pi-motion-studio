// services (P2): narration as a service — the S3 row. A MOTION film handed a script.md gets the
// full narration pipeline through its OWN sound hook (voice → timing.json → the narration bus +
// ducked synth bed + SFX, mixed at the film's mix.lufs — the -14 studio default for every
// non-math kind); the MATH path is byte-identical to before S3 (mathdemo's out/mix.wav md5 is
// unchanged by a re-run: the deterministic voice cache + the kept -16 math default); and the
// services are callable from any kind — the three kind modules' sound hooks all route through a
// shared audio engine (or their own dialog bus), the catalog's captions/mix/capture rows name
// real CLI commands, and the captions service exports monotonic SRT/VTT from both a math film
// and the motion film's timing. Films created here: verify-p-svc + verify-p-svc2 (this check owns
// both keys; removed in the finally, on failure too). mathdemo is only ever READ + re-sounded.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, kindOf, readJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-p-svc', KEY2 = 'verify-p-svc2';
const CLI = join(ROOT, 'engine', 'cli.mjs');
const MATHDEMO = join(FILMS, 'mathdemo', 'out', 'mix.wav');
const SCRATCH = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w1-svc');

// the seeded motion script: the MATH film grammar (engine/manim/studio_manim/script.py) — scene
// headers, `[sNN.M] prose`, 4 short sentences (a motion film has no scenes/*.py, so the parser
// only warns — the narration pipeline does not need the math scenes)
const SCRIPT = `# Services check — narration on a motion film

## scene s01_hook: the promise
[s01.1] Drawn by code, now it speaks.

## scene s02_service: the narration service
[s02.1] A script becomes a voice.
[s02.2] Every word lands on time.

## scene s03_recap: the takeaway
[s03.1] One mix carries the narration.
`;

const sh = (cmd, args, { timeout = 180000 } = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', error: r.error };
};
const studio = (args, { timeout = 600000 } = {}) => sh(process.execPath, [CLI, ...args], { timeout });
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
const tail = (s, n = 3) => String(s).split('\n').filter(Boolean).slice(-n).join(' | ');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ONE heavy process at a time on this box: before sounding a film, wait for an in-flight manim
// render or piper/voice run to finish (the pattern is bracketed so pgrep never matches itself).
const busy = () => {
  const r = sh('pgrep', ['-f', 'manim rend[e]r|voice[.]py']);
  return r.error ? [] : r.out.split('\n').filter(Boolean);
};

/** ffmpeg loudnorm print_format=json: the studio's own measurement pass (input_i = integrated
 *  LUFS, input_tp = true peak — the same numbers engine/audio.mjs's normalize() feeds back). */
function measure(file) {
  const r = sh('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.err);
  if (!m) throw new Error(`loudnorm measured nothing on ${file}: ${tail(r.err || r.out)}`);
  const j = JSON.parse(m[0]);
  const tp = Number(j.input_tp);
  return { lufs: Number(j.input_i), tp: Number.isFinite(tp) ? tp : -Infinity };
}

/** 10 ms frame RMS (dBFS) of a mix decoded to mono 16 kHz — narration.mjs's envelope rule. */
function envelope(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
    { timeout: 180000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${tail((r.stderr || '').toString())}`);
  const b = r.stdout;
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3)));
  const w = 160, n = Math.floor(x.length / w), db = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * w; k < (i + 1) * w; k++) s += x[k] * x[k]; db[i] = 10 * Math.log10(s / w + 1e-12); }
  return { db, seconds: x.length / 16000 };
}
const winDb = (db, a, b, how) => {   // peak or median frame dB over [a, b) seconds (null: no frames)
  const lo = Math.max(0, Math.floor(a * 100)), hi = Math.min(db.length, Math.ceil(b * 100));
  if (hi <= lo) return null;
  const v = Array.from(db.slice(lo, hi)).sort((p, q) => p - q);
  return how === 'peak' ? v[v.length - 1] : v[Math.floor(v.length / 2)];
};

/** SRT/VTT cue times; monotonic = timestamps never decrease and every cue spans. */
function cuesOf(file) {
  const t = [], re = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g;
  const s = readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(s))) {
    const f = (h, mi, se, ms) => +h * 3600 + +mi * 60 + +se + +ms / 1000;
    t.push({ start: f(m[1], m[2], m[3], m[4]), end: f(m[5], m[6], m[7], m[8]) });
  }
  return t;
}
function monotonic(file) {
  const t = cuesOf(file), bad = [];
  t.forEach((c, i) => {
    if (!(c.end > c.start)) bad.push(`cue ${i + 1} spans ${c.start.toFixed(3)}→${c.end.toFixed(3)}s`);
    if (i && c.start < t[i - 1].start) bad.push(`cue ${i + 1} starts ${c.start.toFixed(3)}s < cue ${i} (${t[i - 1].start.toFixed(3)}s)`);
    if (i && c.end < t[i - 1].end) bad.push(`cue ${i + 1} ends ${c.end.toFixed(3)}s < cue ${i} (${t[i - 1].end.toFixed(3)}s)`);
  });
  return { cues: t.length, bad };
}

export default async () => {
  const bad = [], facts = [], record = { at: new Date().toISOString() };
  const need = (ok, what) => { if (!ok) bad.push(what); };
  for (const k of [KEY, KEY2]) rmSync(join(FILMS, k), { recursive: true, force: true });   // a killed run's leftovers
  try {
    // one heavy process at a time (cap 5 minutes, then proceed — the runner is serialized anyway)
    let waits = 0;
    while (busy().length && waits < 20) { await sleep(15000); waits++; }
    if (waits) facts.push(`waited ${waits * 15}s for an in-flight render/voice run`);

    // ── leg 1: the MATH path is byte-identical to before S3 (measured before anything else) ────
    need(existsSync(MATHDEMO), 'films/mathdemo/out/mix.wav is missing (the frozen math demo this check re-sounds)');
    const before = existsSync(MATHDEMO) ? md5(MATHDEMO) : null;
    const rMath = studio(['sound', 'mathdemo']);
    need(rMath.code === 0, `studio sound mathdemo failed (${rMath.code}): ${tail(rMath.err || rMath.out)}`);
    const after = existsSync(MATHDEMO) ? md5(MATHDEMO) : null;
    need(!!before && !!after && before === after,
      `MATH REGRESSION: films/mathdemo/out/mix.wav changed on a re-run (md5 ${before} → ${after}) — nothing was deleted; the deterministic voice cache + the kept -16 math default must keep this byte-identical`);
    if (before === after) facts.push(`mathdemo mix.wav md5 identical before/after a re-sound (${String(after).slice(0, 8)})`);
    record.mathdemo = { before, after };

    // ── leg 2: THE NARRATION SERVICE ON A MOTION FILM (S3's heart) ─────────────────────────────
    const rNew = studio(['new', KEY, '--duration', '10', '--formats', '9:16']);
    need(rNew.code === 0 && existsSync(join(FILMS, KEY, 'film.json')), `studio new ${KEY} failed: ${tail(rNew.err || rNew.out)}`);
    writeFileSync(join(FILMS, KEY, 'script.md'), SCRIPT);
    const rSnd = studio(['sound', KEY]);
    need(rSnd.code === 0, `studio sound ${KEY} (motion film + script.md) failed: ${tail(rSnd.err || rSnd.out)}`);

    const timing = readJson(join(FILMS, KEY, 'timing.json'));
    const S = Array.isArray(timing?.sentences) ? timing.sentences : [];
    need(S.length >= 3, `films/${KEY}/timing.json holds ${S.length} sentences after sound (want the script's >= 3, each with start/end/words)`);
    S.forEach((s, i) => {
      need(typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start, `sentence ${s.id}: bad start/end (${s.start}, ${s.end})`);
      need(Array.isArray(s.words) && s.words.length > 0 && s.words.every((w) => w.end >= w.start), `sentence ${s.id}: no words with times`);
      if (i) need(s.start >= S[i - 1].end, `sentence ${s.id} starts ${s.start}s before the previous sentence ends (${S[i - 1].end}s)`);
    });
    if (S.length) need(S[0].start <= 0.01, `the first sentence starts at ${S[0]?.start}s (the narration bus starts at 0)`);

    const cfg = JSON.parse(readFileSync(join(FILMS, KEY, 'film.json'), 'utf8'));
    const target = cfg.mix?.lufs ?? (kindOf(cfg) === 'math' ? -16 : -14);   // buildMix's own rule
    const mixFile = join(FILMS, KEY, 'out', 'mix.wav');
    need(existsSync(mixFile), `films/${KEY}/out/mix.wav missing after sound`);
    let lm = { lufs: NaN, tp: NaN };
    if (existsSync(mixFile)) {
      lm = measure(mixFile);
      need(Math.abs(lm.lufs - target) <= 1, `the motion narration mix measures ${lm.lufs} LUFS (want the film's mix.lufs ${target} ±1)`);
      need(lm.tp <= -1, `the motion narration mix true peak ${lm.tp} dBTP > -1`);
    }

    // the narration actually drives the mix: each sentence's speech is where timing.json says,
    // well above the (bed-only) gap that follows it — the last sentence's window stays inside the
    // duck hold, so every comparison is speech vs ducked bed
    const narrEnd = S.reduce((a, s) => Math.max(a, s.end || 0), 0);
    let minMargin = null;
    if (existsSync(mixFile) && S.length) {
      const { db, seconds } = envelope(mixFile);
      need(seconds >= narrEnd + 0.1, `the mix is ${seconds.toFixed(2)}s — shorter than the narration (${narrEnd.toFixed(2)}s)`);
      S.forEach((s, i) => {
        const speech = winDb(db, s.start + 0.02, s.end - 0.02, 'peak');
        const gapEnd = i + 1 < S.length ? S[i + 1].start - 0.02 : Math.min(s.end + 0.2, seconds - 0.02);
        const gap = winDb(db, s.end + 0.03, gapEnd, 'median');
        if (speech === null || gap === null) { bad.push(`sentence ${s.id}: no audio frames to compare speech vs gap`); return; }
        const margin = speech - gap;
        minMargin = minMargin === null ? margin : Math.min(minMargin, margin);
        need(margin >= 10, `sentence ${s.id}'s speech is only ${margin.toFixed(1)} dB over its following gap — the narration is not driving the mix where timing.json says`);
      });
    }
    facts.push(`motion+script: timing ${S.length} sentences (0.00-${narrEnd.toFixed(2)}s), mix ${lm.lufs} LUFS/${lm.tp} dBTP (${target} asked), speech >= gap +${minMargin === null ? 'n/a' : minMargin.toFixed(1)} dB`);
    record.motion = { sentences: S.length, lufs: lm.lufs, tp: lm.tp, target, minMargin };

    // ── leg 3a: every kind's sound hook uses a shared audio engine (or its own bus) ────────────
    const { allKinds } = await import('../../kinds/registry.mjs');
    const kinds = await allKinds();
    const src = {};
    for (const k of ['motion', 'edit', 'math']) {
      const f = join(ROOT, 'engine', 'kinds', k, 'index.mjs');
      need(typeof kinds[k]?.sound === 'function', `kind "${k}" has no sound hook (engine/kinds/${k}/index.mjs)`);
      src[k] = existsSync(f) ? readFileSync(f, 'utf8') : '';
    }
    need(/narration\.mjs/.test(src.motion) && src.motion.includes('script.md'),
      'the motion kind\'s sound hook does not hand a script.md film to the narration service (the S3 seam)');
    need(/narration\.mjs/.test(src.math), 'the math kind\'s sound hook does not use the shared narration service');
    need(/math-captions\.mjs/.test(src.math), 'the math kind\'s sound hook does not write SRT/VTT through the captions service');
    need(/edit-audio\.mjs/.test(src.edit), 'the edit kind\'s sound hook does not build its own dialog bus (edit-audio.mjs)');
    for (const k of ['motion', 'edit', 'math'])
      need(/narration\.mjs|audio\.mjs|edit-audio\.mjs/.test(src[k]), `kind "${k}"'s sound path uses neither the shared audio service nor its own bus`);

    // ── leg 3b: the catalog lists captions/mix/capture, their invoke lines name real commands ─
    const { SERVICES } = await import('../../produce/catalog.mjs');
    const byId = new Map(SERVICES.map((s) => [s.id, s]));
    const help = studio(['help'], { timeout: 60000 });
    need(help.code === 0, 'studio help failed');
    const named = {};
    for (const id of ['captions', 'mix', 'capture']) {
      const e = byId.get(id);
      need(e?.type === 'service', `engine/produce/catalog.mjs SERVICES lists no "${id}" service`);
      if (!e) continue;
      const subs = new Set();
      for (const cmd of Object.values(e.invoke || {})) for (const m of String(cmd).matchAll(/\bstudio\s+([a-z][a-z-]*)\b/g)) subs.add(m[1]);
      need(subs.size > 0, `service "${id}"'s invoke lines name no studio command`);
      for (const sub of subs) need(new RegExp(`(^|\\s)${sub}(\\s|<|$)`).test(help.out), `service "${id}" invoke names "studio ${sub}" but studio help has no such command`);
      if (subs.size) named[id] = [...subs].sort().join('/');
    }
    facts.push(`sound hooks: motion+math -> narration.mjs, edit -> edit-audio.mjs; services invoke -> ${Object.entries(named).map(([k, v]) => `${k}→${v}`).join(', ') || 'none'} (all in studio help)`);

    // ── leg 3c (functional): the captions service on a math film — and on the motion film ──────
    const rNew2 = studio(['new', KEY2, '--math', '--formats', '16:9']);
    need(rNew2.code === 0 && existsSync(join(FILMS, KEY2, 'film.json')), `studio new ${KEY2} --math failed: ${tail(rNew2.err || rNew2.out)}`);
    const rSnd2 = studio(['sound', KEY2]);
    need(rSnd2.code === 0, `studio sound ${KEY2} (math film) failed: ${tail(rSnd2.err || rSnd2.out)}`);
    let capCues = 0;
    for (const f of ['captions.srt', 'captions.vtt']) {
      const p = join(FILMS, KEY2, 'out', f);
      need(existsSync(p), `films/${KEY2}/out/${f} missing after sound`);
      if (!existsSync(p)) continue;
      const m = monotonic(p);
      capCues = m.cues;
      need(m.cues >= 1, `films/${KEY2}/out/${f} holds ${m.cues} cues`);
      for (const x of m.bad) bad.push(`films/${KEY2}/out/${f}: ${x}`);
    }
    // the mix service on the math starter: its CONFIGURED -16 (the default math kind keeps)
    const cfg2 = JSON.parse(readFileSync(join(FILMS, KEY2, 'film.json'), 'utf8'));
    const target2 = cfg2.mix?.lufs ?? (kindOf(cfg2) === 'math' ? -16 : -14);
    const mix2 = join(FILMS, KEY2, 'out', 'mix.wav');
    let lm2 = { lufs: NaN, tp: NaN };
    if (existsSync(mix2)) {
      lm2 = measure(mix2);
      need(Math.abs(lm2.lufs - target2) <= 1 && lm2.tp <= -1, `the math starter's mix measures ${lm2.lufs} LUFS/${lm2.tp} dBTP (want ${target2} ±1, <= -1 dBTP)`);
    } else bad.push(`films/${KEY2}/out/mix.wav missing after sound`);
    // kind-agnostic: the SAME captions export runs on the motion film's timing.json
    const { exportCaptions } = await import('../../math-captions.mjs');
    const xc = exportCaptions(KEY);
    const xm = monotonic(xc.srt);
    need(xc.cues >= 1 && !xm.bad.length, `the captions service on the motion film: ${xc.cues} cues, ${xm.bad.join('; ')}`);
    facts.push(`captions: math film ${capCues} cues srt+vtt monotonic, motion film ${xc.cues} cues through the same service; math mix ${lm2.lufs} LUFS (${target2} configured)`);
    record.svc2 = { cues: capCues, lufs: lm2.lufs, tp: lm2.tp, target: target2, motionCues: xc.cues };
  } catch (e) {
    bad.push(String(e.message || e));
  } finally {
    for (const k of [KEY, KEY2]) rmSync(join(FILMS, k), { recursive: true, force: true });
  }
  try { mkdirSync(SCRATCH, { recursive: true }); writeFileSync(join(SCRATCH, 'run.json'), JSON.stringify(record, null, 2) + '\n'); } catch { /* scratch only */ }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
