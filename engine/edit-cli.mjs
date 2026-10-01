// `studio edit <film> <show|ops|undo|redo|sync|export-edl|import-edl|<op> --k v …>` and `studio new <key> --edit`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OP_NAMES, OpError, clipFrames, grid, timelineFrames, timelineSeconds, toEdl, fromEdl } from './lib/edit-ops.mjs';
import { applyOps, createEdit, historyDepth, loadEdit, redo, syncFilm, undo } from './lib/edit-store.mjs';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { parseFps } from './lib/frames.mjs';
import { readBin } from './ingest.mjs';
import { ROOT } from './lib/serve.mjs';

// flags -> op args: numbers and JSON where they parse, kebab-case keys become snake_case for ms fields (--in-ms is not used: use --in_ms)
const val = (s) => { if (s === undefined || s.startsWith('--')) return true; if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); if (/^[[{]/.test(s)) { try { return JSON.parse(s); } catch { /* plain text */ } } return s; };
export function flagsToArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = val(argv[i + 1]); a[k] = v; if (v !== true) i++; }
  return a;
}

export function createEditFilm(key, { title, fps = 30, formats = ['16:9'] } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key> --edit: lowercase letters, digits, dashes');
  const dir = join(FILMS, key);
  if (existsSync(dir)) throw new Error(`films/${key} already exists`);
  mkdirSync(dir, { recursive: true });
  const f = parseFps(fps);
  writeJson(join(dir, 'film.json'), { kind: 'edit', title: title || key, duration: 1, fps: f.den === 1 ? f.num : f.str, formats, loop: false, background: '#000000', motionBlur: 1, gates: { maxStill: 4, maxNoNovelty: 8 } });
  for (const x of ['index.html', 'design.json', 'brief.md']) copyFileSync(join(ROOT, 'templates', 'edit', x), join(dir, x));
  writeJson(join(dir, 'beats.json'), { bpm: 0, source: 'none', beats: [], downbeats: [], hits: [] }); // no score yet: music/montage edits replace it
  createEdit(key, { fps: f.str });
  return dir;
}

const fmtT = (s) => `${s.toFixed(3)}s`;
export function describe(film, edit) {
  const { F, S } = grid(edit), out = [];
  out.push(`${film.key} · rev ${edit.rev} · ${edit.fps} fps · ${fmtT(timelineSeconds(edit))} (${timelineFrames(edit)} frames) · history ${JSON.stringify(historyDepth(film.key))}`);
  const src = Object.entries(edit.sources).map(([id, s]) => `${id}(${s.kind} ${s.duration.toFixed(1)}s)`);
  out.push(`sources: ${src.join(', ') || 'none'}`);
  for (const t of edit.tracks) {
    out.push(`${t.id} [${t.kind}] ${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}`);
    let prevEnd = 0;
    for (const c of t.clips) {
      const atF = F(c.at), gap = atF - prevEnd, len = clipFrames(edit, c); prevEnd = atF + len;
      out.push(`  ${c.id.padEnd(5)} ${c.freeze ? 'FREEZE' : c.src.padEnd(6)} ${fmtT(c.in)}→${fmtT(c.out)} @${fmtT(c.at)}-${fmtT(S(atF + len))} (${len}f)${c.speed ? ` x${c.speed}` : ''}${c.audio?.gain_db ? ` ${c.audio.gain_db}dB` : ''}${c.xfade_ms ? ` xfade ${c.xfade_ms}ms` : ''}${gap > 0 ? `  [gap ${gap}f before]` : ''}${c.note ? `  # ${c.note}` : ''}`);
    }
  }
  for (const o of edit.overlays) out.push(`overlay ${o.id} ${o.type} @${fmtT(o.at)} +${fmtT(o.dur)} ${JSON.stringify(o.props)}`);
  for (const m of edit.markers) out.push(`marker ${m.id} @${fmtT(m.t)} ${m.label}`);
  if (edit.captions) out.push(`captions ${JSON.stringify(edit.captions)}`);
  return out.join('\n');
}

export async function editCommand(filmKey, argv, log = console.log) {
  const sub = argv[0] ?? 'show', rest = argv.slice(1);
  if (!filmKey) throw new Error(`studio edit <film> <${['show', 'ops', 'undo', 'redo', 'sync', 'export-edl', 'import-edl', ...OP_NAMES, 'snap'].join('|')}> [--k v …] [--base-rev N]`);
  const flags = flagsToArgs(rest), baseRev = flags['base-rev'] !== undefined ? Number(flags['base-rev']) : undefined; delete flags['base-rev'];
  const show = () => { const { film, edit } = loadEdit(filmKey); log(describe(film, edit)); };
  try {
    switch (sub) {
      case 'show': {
        // --json: the edit state as data (edit_status reads this). One line, machine-shaped.
        if (flags.json) { const { film, edit } = loadEdit(filmKey); log(JSON.stringify({ key: film.key, rev: edit.rev, fps: edit.fps, sources: edit.sources,
          tracks: edit.tracks.map((t) => ({ id: t.id, kind: t.kind, clips: t.clips.length })), frames: timelineFrames(edit), seconds: timelineSeconds(edit),
          overlays: edit.overlays, captions: edit.captions, markers: edit.markers, history: historyDepth(film.key) })); return; }
        show(); return;
      }
      case 'undo': { const r = undo(filmKey, { baseRev }); syncFilm(filmKey); log(`undone → rev ${r.rev}`); show(); return; }
      case 'redo': { const r = redo(filmKey, { baseRev }); syncFilm(filmKey); log(`redone → rev ${r.rev}`); show(); return; }
      case 'sync': { const r = syncFilm(filmKey); log(`film.json: ${r.frames} frames = ${r.duration}s @ ${r.fps}`); return; }
      case 'export-edl': { const { edit } = loadEdit(filmKey), edl = toEdl(edit); const out = rest[0] && !rest[0].startsWith('--') ? rest[0] : null; if (out) { writeFileSync(out, JSON.stringify(edl, null, 2) + '\n'); log(`EDL (${edl.ranges.length} ranges) → ${out}`); } else log(JSON.stringify(edl, null, 2)); return; }
      case 'import-edl': {
        const file = rest[0]; if (!file) throw new Error('studio edit <film> import-edl <edl.json>');
        const { film, edit } = loadEdit(filmKey); if (edit.tracks.some((t) => t.clips.length)) throw new Error('import-edl needs an empty timeline: the film already has clips (use a new film or delete them)');
        const next = fromEdl(JSON.parse(readFileSync(file, 'utf8')), { fps: edit.fps, bin: readBin(film) });
        applyOps(filmKey, next.tracks[0].clips.map((c) => ({ op: 'add', src: c.src, in: c.in, out: c.out, ...(c.note ? { note: c.note } : {}) })), { who: 'import-edl' }); syncFilm(filmKey); show(); return;
      }
      case 'ops': { const ops = JSON.parse(rest[0] ?? '[]'); const r = applyOps(filmKey, ops, { baseRev, who: 'cli' }); syncFilm(filmKey); for (const x of r.results) if (x.snapped !== undefined) log(JSON.stringify(x)); log(`applied ${ops.length} op(s) → rev ${r.rev}`); show(); return; }
      default: {
        if (flags.json) Object.assign(flags, JSON.parse(flags.json)), delete flags.json;
        const op = { op: sub, ...flags };
        const r = applyOps(filmKey, op, { baseRev, who: 'cli' });
        if (r.results[0]?.snapped !== undefined) { log(JSON.stringify(r.results[0])); return; }
        syncFilm(filmKey); log(`${sub} → rev ${r.rev}`); show();
      }
    }
  } catch (e) { if (e instanceof OpError) { process.exitCode = e.code === 'conflict' ? 3 : 1; throw new Error(e.message); } throw e; }
}
void readJson;
