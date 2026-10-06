// The edit kind: real footage cut in the same studio (ingest, ops, measured cuts, captions,
// reframe, dialog bus). The hooks are byte-exact moves of the CLI's former edit paths; the edit
// pipeline modules (edit-cli, edit-ops, cut, edit-audio, autoedit, ingest) stay where they are —
// this module is the registry-facing surface (ADR-001).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildMusic } from '../../audio.mjs';
// the edit kind renders, looks, gates and ships exactly like motion (renderFilm walks edit.json
// through the film page; the ship path composes this kind's own sound via the registry). Required
// hooks are own exports (ADR-001) — the re-export IS the inheritance declaration.
export { gate, look, render, ship } from '../motion/index.mjs';
import { createEditFilm } from '../../edit-cli.mjs';
import { buildDialog, mixEdit } from '../../edit-audio.mjs';
import { readFilm, readJson } from '../../lib/film.mjs';
import { parseFps } from '../../lib/frames.mjs';
import { ROOT, safePath } from '../../lib/serve.mjs';

const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

export function create(key, { title, fps, formats } = {}) {
  const dir = createEditFilm(key, { title, fps, formats });
  return { dir, message: `created ${rel(dir)} (edit film)\n  next: studio ingest ${key} <your footage> --id cam   then   studio edit ${key} add --src cam --in 0 --out 10   then   studio look ${key}\n  preview: studio gui` };
}

export async function sound(key) {
  const film = readFilm(key);
  // an edit film's sound is its dialog bus over the ducked music bed
  if (film.cfg.music && !film.cfg.track) { const m = buildMusic(key); if (m.file) console.log(rel(m.file)); }
  const d = await buildDialog(key, { log: (m) => console.log(m) }), x = await mixEdit(key);
  console.log(`${rel(x.file)}  ${x.lufs} LUFS, true peak ${x.truePeak} dBFS`); void d;
}

// ── feature hooks the shared engines call (motion's defaults: timeline null, lut '', no own fps)
export function timeline(film) { return readJson(join(film.dir, 'edit.json')); }
export function lutFor(film) {
  const edit = readJson(join(film.dir, 'edit.json'));
  if (!edit?.color?.lut) return '';
  const full = safePath(edit.color.lut.replace(/^\//, ''));
  if (!full || !existsSync(full)) throw new Error(`edit.color.lut "${edit.color.lut}" does not resolve inside the repo`);
  return `,lut3d=file='${full}'`;   // default trilinear: exact for identity cubes (nearest quantizes to lattice nodes, ~36 dB loss)
}
export function ownFps(cfg) { return cfg.fps ? parseFps(cfg.fps) : undefined; }

// ── the capability catalog entry (K2) ────────────────────────────────────────────────────────
export const capability = {
  makes: ['real-footage edits: interviews, talking heads, podcasts, screen recordings, highlight reels'],
  strengths: ['measured cuts (silence/ums/retakes from the audio)', 'word-accurate captions', 'reframe to vertical', 'dialog bus + ducked bed'],
  weak: ['cannot invent footage', 'long films need patience (one pass per source)'],
  typical: { duration: [5, 90], formats: ['16:9', '9:16', '1:1', '4:5'] },
  needs: ['real footage (the human\'s files)'], ready: 'yes',
  invoke: { create: 'studio new <key> --edit', ingest: 'studio ingest <key> <file> --id cam',
             transcribe: 'studio transcribe <key> cam', cut: 'studio cut <key> silence --apply',
             look: 'studio look <key>', render: 'studio render <key> --draft', sound: 'studio sound <key>',
             gate: 'studio gate <key>', ship: 'studio ship <key>' },
  gates: ['edit gates (the verify-edit contract)', 'frame-exact', 'av-sync', 'captions'],
  tools: ['edit_status', 'edit_ingest', 'edit_transcribe', 'edit_ops', 'edit_cut', 'edit_look', 'edit_audio', 'edit_render'],
  skill: 'video-edit', critic: 'edit-critic',
};

// ── GUI flags: the edit view mounts on edit.json (the marker file), exactly as the server did
export function summary(cfg, dir) { return { edit: existsSync(join(dir, 'edit.json')) }; }
export const view = 'edit';
