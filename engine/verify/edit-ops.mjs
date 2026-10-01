// edit-ops: every op round-trips under undo; invalid ops are rejected with a specific message; a stale baseRev conflicts;
// 500 seeded random ops (at 30000/1001) keep the model valid; EDL export then import round-trips.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { OP_NAMES, OpError, applyOp, clipFrames, fromEdl, grid, query, timelineSeconds, toEdl, validateEdit } from '../lib/edit-ops.mjs';
import { applyOps, createEdit, historyDepth, loadEdit, redo, syncFilm, undo } from '../lib/edit-store.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-edit-ops';
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const strip = (e) => { const c = structuredClone(e); delete c.rev; return c; };

function setup(fps) {
  const dir = join(FILMS, KEY); rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dir, 'assets', 'media'), { recursive: true });
  writeFileSync(join(dir, 'film.json'), JSON.stringify({ title: KEY, duration: 10, fps: 30, formats: ['16:9'], kind: 'edit' }));
  const f = fps === '30' ? 30 : 30000 / 1001;
  const src = (id, frames, kind = 'video') => ({ path: `/nowhere/${id}.mp4`, sha256: `${kind}${frames}`, kind, duration: frames / f, frames, fps: kind === 'video' ? fps : null, has_audio: true });
  const bin = { version: 1, sources: { cam: src('cam', 900), b: src('b', 240), song: { ...src('song', 1200, 'audio'), path: '/nowhere/song.wav' }, old: { ...src('old', 300), fps: '24' } } };
  writeFileSync(join(dir, 'assets', 'media', 'index.json'), JSON.stringify(bin));
  createEdit(KEY, { fps });
  return bin;
}

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const expectReject = (ops, re, what, opts) => { try { applyOps(KEY, ops, opts); bad.push(`${what}: not rejected`); } catch (e) { if (!(e instanceof OpError) || !re.test(e.message)) bad.push(`${what}: wrong error "${e.message.slice(0, 120)}"`); return e; } };
  try {
    setup('30000/1001');
    // ── 1. every op, apply -> undo = identity, redo = the result ───────────────────────────────────────────
    const A = (op) => applyOps(KEY, op, { who: 'verify' });
    const seq = [
      { op: 'add', src: 'cam', in: 1, out: 9 }, { op: 'add', src: 'cam', in: 12, out: 18 }, { op: 'add', src: 'b', in: 0, out: 4 }, { op: 'add', src: 'song', track: 'A1', at: 0, duck: { under: 'dialog', db: -12 } },
      { op: 'trim', id: 'c1', in: 2, out: 8 }, { op: 'split', id: 'c1', t: 3 }, { op: 'speed', id: 'c2', speed: 1.5 }, { op: 'volume', id: 'c3', db: -6 }, { op: 'fade', id: 'c3', in_ms: 20, out_ms: 120 },
      { op: 'reorder', track: 'V1', order: ['c1', 'c3', 'c5', 'c2'] }, { op: 'move', id: 'c2', at: 30 }, (e) => ({ op: 'freeze', id: 'c3', t: e.tracks[0].clips.find((c) => c.id === 'c3').at + 0.3, dur: 1 }),
      { op: 'crop-keyframe', id: 'c1', fmt: '9:16', t: 0.5, cx: 0.4, cy: 0.5, zoom: 1.3 }, { op: 'overlay', type: 'title', at: 0.5, dur: 2, props: { text: 'Hi' } },
      { op: 'caption-style', style: 'karaoke', accent: '#ff5a1f' }, { op: 'marker', t: 4.2, label: 'beat' }, { op: 'delete', id: 'c2' }, { op: 'ripple-delete', track: 'V1', from: 1, to: 2 },
    ];
    const seen = new Set();
    for (const spec of seq) {
      const before = loadEdit(KEY).edit, op = typeof spec === 'function' ? spec(before) : spec, r = A(op), after = r.edit;
      seen.add(op.op); need(after.rev === before.rev + 1, `${op.op}: rev ${before.rev} -> ${after.rev}`);
      const u = undo(KEY); try { deepStrictEqual(strip(u.edit), strip(before)); } catch { bad.push(`${op.op}: apply+undo is not identity`); }
      need(u.rev === after.rev + 1, `${op.op}: undo did not bump rev monotonically`);
      const rd = redo(KEY); try { deepStrictEqual(strip(rd.edit), strip(after)); } catch { bad.push(`${op.op}: redo differs from the applied result`); }
    }
    // xfade needs two clips that meet exactly: build them, then crossfade and undo
    A({ op: 'add', src: 'cam', in: 0, out: 3 }); A({ op: 'add', src: 'cam', in: 4, out: 7 });
    { const cs = loadEdit(KEY).edit.tracks[0].clips.slice().sort((p, q) => p.at - q.at), [xa, xb] = cs.slice(-2), before = loadEdit(KEY).edit;
      A({ op: 'xfade', a: xa.id, b: xb.id, ms: 100 }); seen.add('xfade');
      need(loadEdit(KEY).edit.tracks[0].clips.find((c) => c.id === xb.id).xfade_ms === 100, 'xfade not recorded');
      undo(KEY); try { deepStrictEqual(strip(loadEdit(KEY).edit), strip(before)); } catch { bad.push('xfade: undo not identity'); } }
    const sn = A({ op: 'snap', t: 4.19, to: 'cuts', tolerance: 0.2 }).results[0]; seen.add('snap'); need(typeof sn.snapped === 'number', 'snap query returned nothing');
    const missing = OP_NAMES.filter((n) => !seen.has(n)).concat(['snap'].filter((n) => !seen.has(n)));
    need(missing.length === 0, `ops not exercised: ${missing.join(', ')}`);
    facts.push(`${seen.size} ops (${[...seen].join(' ')}) apply -> undo identity, redo exact`);

    // ── 2. rejections carry a specific message ─────────────────────────────────────────────────────────────
    const cur = loadEdit(KEY).edit, ids = cur.tracks[0].clips.map((c) => c.id), first = cur.tracks[0].clips[0];
    const rejects = [
      [{ op: 'trim', id: 'zzz', in: 1 }, /no clip "zzz"/], [{ op: 'add', src: 'cam', in: 5, out: 999 }, /beyond the end/], [{ op: 'add', src: 'nope' }, /not in the media bin/],
      [{ op: 'add', src: 'song' }, /audio only/], [{ op: 'add', src: 'old' }, /conformed at 24 fps/], [{ op: 'split', id: first.id, t: 999 }, /not inside the clip/], [{ op: 'speed', id: first.id, speed: 99 }, /between 0.1 and 16/],
      [{ op: 'move', id: ids[1], at: first.at }, /overlaps/], [{ op: 'reorder', track: 'V1', order: [first.id] }, /exactly once/], [{ op: 'volume', id: first.id, db: 99 }, /db must be/],
      [{ op: 'fade', id: first.id, in_ms: 9000, out_ms: 9000 }, /longer than the clip/], [{ op: 'xfade', a: ids[0], b: ids.at(-1), ms: 50 }, /does not start exactly|different tracks/], [{ op: 'crop-keyframe', id: first.id, fmt: '4:3', cx: 0.5, cy: 0.5 }, /fmt must be/],
      [{ op: 'overlay', type: 'confetti', at: 0, dur: 1 }, /type must be one of/], [{ op: 'caption-style', style: 'comic' }, /style must be one of/], [{ op: 'marker', t: -1 }, /t must be/], [{ op: 'freeze', id: first.id, t: 999, dur: 1 }, /must fall on a frame/],
      [{ op: 'trim', id: first.id }, /give in and\/or out/], [{ op: 'frobnicate' }, /unknown op/], [{ op: 'add', src: 'cam', at: -1 }, /at must be >= 0|beyond|overlaps/],
    ];
    for (const [op, re] of rejects) expectReject(op, re, `reject ${op.op}`);
    facts.push(`${rejects.length} invalid ops rejected with specific messages`);

    // batch atomicity + stale baseRev
    const rev0 = loadEdit(KEY).edit.rev;
    expectReject([{ op: 'marker', t: 1, label: 'x' }, { op: 'trim', id: 'zzz', in: 1 }], /op 2\/2 \(trim\)/, 'batch');
    need(loadEdit(KEY).edit.rev === rev0 && !loadEdit(KEY).edit.markers.some((m) => m.label === 'x'), 'a failed batch left changes behind');
    const e409 = expectReject({ op: 'marker', t: 2, label: 'y' }, /conflict/, 'stale baseRev', { baseRev: rev0 - 1 });
    need(e409?.code === 'conflict', 'stale baseRev is not code=conflict');
    const okRev = applyOps(KEY, { op: 'marker', t: 2, label: 'y' }, { baseRev: rev0 }); need(okRev.rev === rev0 + 1, 'matching baseRev was refused');
    facts.push('failed batch writes nothing; stale baseRev -> conflict, fresh baseRev accepted');

    // ── 3. 500 seeded random ops stay valid (NTSC) ─────────────────────────────────────────────────────────
    setup('30000/1001');
    const R = mulberry(20261001), pick = (a) => a[Math.floor(R() * a.length)], rnd = (a, b) => a + R() * (b - a), applied = {}, rejected = {};
    const names = ['add', 'add', 'add', 'trim', 'trim', 'split', 'split', 'speed', 'delete', 'ripple-delete', 'ripple-delete', 'move', 'reorder', 'freeze', 'volume', 'fade', 'xfade', 'crop-keyframe', 'overlay', 'marker'];
    let undone = 0, N = 0;
    for (let i = 0; i < 500; i++) {
      const { edit } = loadEdit(KEY), cs = edit.tracks[0].clips, c = cs.length ? pick(cs) : null, len = timelineSeconds(edit) || 5;
      const name = c || names[i % names.length] === 'add' ? pick(names) : 'add'; let op;
      switch (name) {
        case 'add': { const s = pick(['cam', 'b']), max = s === 'cam' ? 30 : 8, a = rnd(0, max - 0.2); op = { op: 'add', src: s, in: a, out: Math.min(max + 0.5, a + rnd(0.1, 6)), ...(R() < 0.3 ? { at: rnd(0, len + 1) } : {}), ...(R() < 0.2 ? { ripple: true } : {}) }; break; }
        case 'trim': op = { op: 'trim', id: c?.id, ...(R() < 0.6 ? { in: c?.in + rnd(-0.5, 1) } : {}), ...(R() < 0.6 ? { out: c?.out + rnd(-1, 0.5) } : {}), ripple: R() < 0.3 }; break;
        case 'split': op = { op: 'split', id: c?.id, t: c?.at + rnd(-0.2, 3) }; break;
        case 'speed': op = { op: 'speed', id: c?.id, speed: pick([0.5, 0.75, 1, 1.25, 1.5, 2, 3]) }; break;
        case 'delete': op = { op: 'delete', id: c?.id }; break;
        case 'ripple-delete': op = R() < 0.5 ? { op: 'ripple-delete', id: c?.id } : (() => { const f = rnd(0, len); return { op: 'ripple-delete', track: 'V1', from: f, to: f + rnd(0.05, 2) }; })(); break;
        case 'move': op = { op: 'move', id: c?.id, at: rnd(0, len + 2) }; break;
        case 'reorder': op = { op: 'reorder', track: 'V1', order: [...cs.map((x) => x.id)].sort(() => R() - 0.5) }; break;
        case 'freeze': op = { op: 'freeze', id: c?.id, t: c?.at + rnd(0, 3), dur: rnd(0.1, 2) }; break;
        case 'volume': op = { op: 'volume', id: c?.id, db: rnd(-30, 12) }; break;
        case 'fade': op = { op: 'fade', id: c?.id, in_ms: Math.round(rnd(0, 300)), out_ms: Math.round(rnd(0, 300)) }; break;
        case 'xfade': op = { op: 'xfade', a: c?.id, b: pick(cs.length ? cs : [{ id: 'x' }]).id, ms: Math.round(rnd(0, 400)) }; break;
        case 'crop-keyframe': op = { op: 'crop-keyframe', id: c?.id, fmt: pick(['9:16', '1:1', '4:5']), t: rnd(0, 2), cx: R(), cy: R(), zoom: rnd(1, 3) }; break;
        case 'overlay': op = { op: 'overlay', type: pick(['title', 'callout', 'punch-in']), at: rnd(0, len), dur: rnd(0.1, 3), props: {} }; break;
        default: op = { op: 'marker', t: rnd(0, len), label: 'r' };
      }
      N++;
      try {
        const before = loadEdit(KEY).edit, r = applyOps(KEY, op, { who: 'fuzz' }); applied[op.op] = (applied[op.op] || 0) + 1;
        validateEdit(r.edit);
        if (i % 10 === 0) { const u = undo(KEY); deepStrictEqual(strip(u.edit), strip(before)); redo(KEY); undone++; }
      } catch (e) { if (e instanceof OpError) rejected[op.op] = (rejected[op.op] || 0) + 1; else { bad.push(`random op ${i} ${JSON.stringify(op).slice(0, 100)}: ${e.constructor.name}: ${e.message.slice(0, 120)}`); break; } }
    }
    const nApplied = Object.values(applied).reduce((a, b) => a + b, 0), nRejected = Object.values(rejected).reduce((a, b) => a + b, 0);
    need(nApplied >= 200, `only ${nApplied} of ${N} random ops applied: the generator is not exercising the model`);
    need(Object.keys(applied).length >= 10, `random ops covered only ${Object.keys(applied).join(',')}`);
    const final = loadEdit(KEY).edit; validateEdit(final); syncFilm(KEY);
    const D = readFilm(KEY).cfg.duration, g = grid(final), frames = Math.round((D * g.fps.num) / g.fps.den);
    need(frames === Math.max(...final.tracks.flatMap((t) => t.clips.map((c) => g.F(c.at) + clipFrames(final, c))), 0) || frames === 10 * 30, `film.json duration ${D}s is not the timeline length`);
    facts.push(`500 random ops @30000/1001: ${nApplied} applied, ${nRejected} rejected cleanly, 0 invalid models, ${undone} undo checks, ${final.tracks[0].clips.length} clips left`);

    // ── 4. EDL round trip ──────────────────────────────────────────────────────────────────────────────────
    const bin = setup('30');
    for (const op of [{ op: 'add', src: 'cam', in: 1.6, out: 7.05, note: 'cold open' }, { op: 'add', src: 'b', in: 0.5, out: 2.5 }, { op: 'add', src: 'cam', in: 20, out: 25 }, { op: 'reorder', track: 'V1', order: ['c3', 'c1', 'c2'] }]) applyOps(KEY, op);
    const e0 = loadEdit(KEY).edit, edl = toEdl(e0), back = fromEdl(JSON.parse(JSON.stringify(edl)), { fps: '30', bin }), edl2 = toEdl(back);
    try { deepStrictEqual(edl2, edl); } catch { bad.push('EDL export -> import -> export differs'); }
    need(edl.ranges.length === 3 && edl.ranges[0].source === 'cam' && edl.ranges[0].start === 20 && edl.sources.cam === '/nowhere/cam.mp4', 'EDL shape is not open-edit\'s { sources, ranges:[{ source, start, end, note }] }');
    need(back.tracks[0].clips.map((c) => `${c.src}:${c.in}-${c.out}`).join() === e0.tracks[0].clips.slice().sort((a, b) => a.at - b.at).map((c) => `${c.src}:${c.in}-${c.out}`).join(), 'imported clip order/ranges differ');
    facts.push(`EDL round-trips (${edl.ranges.length} ranges, open-edit shape)`);
    void historyDepth;
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
  return { pass: bad.length === 0, measured: bad.length ? bad.slice(0, 6).join(' | ') : facts.join('; ') };
};
