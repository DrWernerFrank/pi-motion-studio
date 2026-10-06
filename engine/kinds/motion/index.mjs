// The motion kind: code-drawn films (Canvas seek(t), springs, synthesized sound). It is also the
// FALLBACK kind — every hook a kind does not define resolves to motion's (ADR-001), and a film.json
// without a "kind" field IS a motion film. The hooks here are byte-exact moves of the CLI's former
// motion paths (golden transcripts: docs/produce/baseline/).
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildMusic, buildSfx, gridBeats, measureBeats, mix } from '../../audio.mjs';
import { gates } from '../../gates.mjs';
import { FILMS, readFilm, readJson, writeJson } from '../../lib/film.mjs';
import { run } from '../../lib/proc.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { renderFilm } from '../../render.mjs';
import { contactSheet, poster } from '../../stills.mjs';
import { hooksFor } from '../registry.mjs';

const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

export function create(key, { title, duration, formats, loop, bpm } = {}) {
  if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key>: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error(`films/${key} already exists`);
  cpSync(join(ROOT, 'templates', 'film'), dir, { recursive: true });
  const cfg = readJson(join(dir, 'film.json'));
  Object.assign(cfg, {
    title: title ?? key, duration: duration ?? cfg.duration,
    formats: formats ?? cfg.formats, loop: loop === undefined ? !!cfg.loop : !!loop,
  });
  cfg.music.bpm = bpm ?? cfg.music.bpm;
  writeJson(join(dir, 'film.json'), cfg);
  gridBeats(key);
  return { dir, message: `created films/${key}\n  next: write brief.md, design.json, shotlist.md, then index.html\n  preview: studio gui  (or open http://localhost:3142/films/${key}/)` };
}

export async function render(key, opts = {}) { return renderFilm(key, opts); }
export async function look(key, opts = {}) { return contactSheet(key, opts); }
export async function gate(key, opts = {}) { return gates(key, opts); }

export async function sound(key) {
  const film = readFilm(key);
  // S3 — narration as a service: a film with a script.md gets the narration pipeline (voice ->
  // timing.json -> the narration bus + the synth bed ducked under it + SFX, at the film's mix.lufs;
  // default -14, the studio standard). A film without a script keeps the classic synth path.
  if (existsSync(join(film.dir, 'script.md'))) {
    const N = await import('../../narration.mjs');
    const v = await N.buildVoice(key); console.log(`voice: ${v.sentences.length} sentences, ${v.duration.toFixed(2)}s, timing ${v.timing}`);
    const s = buildSfx(key); console.log(`${rel(s.file)} (${s.cues} cues)`);
    const x = await N.buildMix(key, { sfx: s.file }); console.log(`${rel(x.file)}  ${x.lufs} LUFS, true peak ${x.truePeak} dBFS`);
    return x;
  }
  if (!existsSync(join(film.dir, 'beats.json'))) film.cfg.track ? await measureBeats(key) : gridBeats(key);
  const m = buildMusic(key); if (m.file) console.log(rel(m.file));
  const s = buildSfx(key); console.log(`${rel(s.file)} (${s.cues} cues)`);
  const x = await mix(key); console.log(`${rel(x.file)}  ${x.lufs} LUFS, true peak ${x.truePeak} dBFS`);
}

// the delivery path shared by motion and edit (the former `ship` else-branch); the sound step goes
// through the registry so an edit film gets its dialog bus (the fallback composes, it does not own)
export async function ship(key) {
  const film = readFilm(key);
  console.log('── sound'); await (await hooksFor(key)).sound(key);
  console.log('── gates'); const g = await (await hooksFor(key)).gate(key);
  if (!g.pass) throw new Error('gates failed: fix the FAIL lines above before shipping');
  const reviews = readJson(join(film.dir, 'reviews.json'), []);
  if (!reviews.length || !reviews.at(-1).pass) console.log(`!! last review ${reviews.length ? `min ${reviews.at(-1).min}` : 'missing'}: shipping anyway, but the loop says 8+ first`);
  console.log('── render'); const r = await renderFilm(key, { quality: 'final', fmt: 'all' });
  const at = film.cfg.poster ?? Math.min(film.cfg.duration * 0.35, 3);
  for (const f of film.cfg.formats) console.log(rel((await poster(key, { at, fmt: f })).file));
  console.log(rel((await contactSheet(key, { mode: 'every', every: 0.5, name: 'contact' })).file));
  if (film.cfg.loop) {
    const src = r[0].file, dst = join(film.out, 'loop_check.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-stream_loop', '1', '-i', src, '-c', 'copy', dst]);
    console.log(rel(dst));
  }
  await gates(key, { log: () => {} });
  console.log('── shipped'); for (const x of r) console.log(`${rel(x.file)}  (${x.seconds}s to render)`);
  return { pass: true };
}

// ── the capability catalog entry (K2): what this technique is for, honestly ────────────────────
export const capability = {
  makes: ['code-drawn motion graphics: reels, launch films, promos, ads, kinetic type, UI morphs'],
  strengths: ['one timeline reframes to every format (no crops)', 'springs + beat-locked sound', 'fast drafts (seconds)'],
  weak: ['no real footage', 'no narration voice of its own (the voice service adds one)'],
  typical: { duration: [5, 60], formats: ['9:16', '1:1', '16:9', '4:5'] },
  needs: [], ready: 'yes',
  invoke: { create: 'studio new <key> --duration 20 --formats 9:16,16:9', look: 'studio look <key>',
            render: 'studio render <key> --draft', sound: 'studio sound <key>', gate: 'studio gate <key>', ship: 'studio ship <key>' },
  gates: ['lint', 'determinism', 'dead-time', 'novelty', 'hook', 'blank-frames', 'loop-seam', 'loudness', 'cue-sync', 'deliverable'],
  tools: ['film_status', 'film_look', 'film_render', 'film_sound', 'film_gate', 'film_review'],
  skill: 'motion-reel', critic: 'motion-critic',
};

// ── the fallbacks: motion IS today's behavior for the kind-specific rows ──────────────────────
export function check(key) { throw new Error('studio check is for math films (kind: math)'); }
export function where(key) { throw new Error('studio where is for math films (kind: math) — edit films have edit_status'); }
export function scene(key) {
  // today `studio scene <non-math>` dies in readMathFilm with exactly this message (cfg.kind is
  // undefined for plain motion films, so the template renders "kind=undefined")
  throw new Error(`films/${key} is kind=${readFilm(key).cfg.kind}, not math`);
}
