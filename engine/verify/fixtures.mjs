// fixtures: every fixture exists, matches its checksum, and has the properties the later checks rely on.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR, FIXTURES, ensureFixtures, fixturePath, readManifest } from '../fixtures.mjs';
import { readBarcodes } from '../lib/barcode.mjs';
import { run } from '../lib/proc.mjs';
import { ROOT } from '../lib/serve.mjs';

const probe = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f])).out);
const vs = (p) => p.streams.find((s) => s.codec_type === 'video'), as = (p) => p.streams.find((s) => s.codec_type === 'audio');

export default async ({ quick }) => {
  try { await ensureFixtures({ includeSlow: !quick, verify: true, log: () => {} }); }
  catch (e) { if (/download failed|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(String(e.message))) return { skip: `no network for the first fetch of the real clip: ${e.message.split('\n')[0]}` }; throw e; }
  const m = readManifest().fixtures, bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  const sync = await probe(fixturePath('sync')), sb = await readBarcodes(fixturePath('sync'));
  need(sb.length === 900 && sb.every((x, k) => x.n === k), 'sync: barcode not 0..899 in order');
  need(!!as(sync) && sync.format.duration > 29.9, 'sync: needs 30 s with audio'); facts.push(`sync ${sb.length}f`);

  const vr = await probe(fixturePath('vfr-rotated')), rot = vs(vr).side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
  need(Math.abs(rot) === 90, `vfr-rotated: rotation ${rot}`); need(vs(vr).r_frame_rate !== vs(vr).avg_frame_rate, 'vfr-rotated: not variable frame rate');
  need(as(vr)?.sample_rate === '44100', 'vfr-rotated: not 44.1 kHz'); facts.push(`vfr rot ${rot} avg ${vs(vr).avg_frame_rate}`);

  const hl = vs(await probe(fixturePath('hlg')));
  need(hl.color_transfer === 'arib-std-b67' && hl.pix_fmt === 'yuv420p10le' && hl.color_primaries === 'bt2020', `hlg: ${hl.pix_fmt} ${hl.color_transfer} ${hl.color_primaries}`); facts.push('hlg 10-bit');

  need(!as(await probe(fixturePath('noaudio'))), 'noaudio: has an audio stream');
  if (!quick) { const l = await probe(fixturePath('long')); need(Math.abs(l.format.duration - 1200) < 1 && vs(l).width === 1920, 'long: not 20 min 1080p'); facts.push(`long ${Math.round(l.format.duration)}s`); }

  const sp = await probe(fixturePath('speech')), truth = JSON.parse(readFileSync(join(FIXTURE_DIR, 'speech.truth.json'), 'utf8'));
  const kinds = (k) => truth.items.filter((i) => i.kind === k).length;
  need(kinds('filler') === 3 && kinds('flub') === 1 && !!as(sp) && !!vs(sp), `speech: ${kinds('filler')} fillers, ${kinds('flub')} flubs`); facts.push(`speech ${truth.duration}s, 3 ums + 1 flub`);
  need(existsSync(join(FIXTURE_DIR, 'speech-fa.wav')) && existsSync(join(FIXTURE_DIR, 'noisy.wav')) && existsSync(join(FIXTURE_DIR, 'podcast.m4a')), 'speech-fa/noisy/podcast missing');
  need(vs(await probe(fixturePath('subject'))).nb_frames === '600', 'subject: not 600 frames');
  const sc = await probe(fixturePath('screen')); need(vs(sc).nb_frames === '900', 'screen: not 900 frames');
  const clips = JSON.parse(readFileSync(join(FIXTURE_DIR, 'clips12', 'clips.json'), 'utf8')); need(clips.length === 12, 'clips12: not 12 clips');
  const song = JSON.parse(readFileSync(join(FIXTURE_DIR, 'song.truth.json'), 'utf8')); need(song.beats.length === 80 && song.bpm === 120, 'song: beat grid');

  // the real, open-licensed clip: pinned hash + its license recorded in THIRD_PARTY.md
  const real = m['real-talking-head'], tp = readFileSync(join(ROOT, 'docs', 'editing', 'THIRD_PARTY.md'), 'utf8');
  need(!!real && real.sha256 === FIXTURES['real-talking-head'].sha256, 'real clip: sha256 not pinned');
  need(tp.includes(real?.sha256 ?? 'x') && /Public domain/.test(tp), 'real clip: license/sha not recorded in THIRD_PARTY.md');
  const rp = vs(await probe(fixturePath('real-talking-head'))); need(rp.r_frame_rate === '30000/1001', `real clip fps ${rp.r_frame_rate}`); facts.push(`real clip ${rp.width}x${rp.height} ${rp.r_frame_rate}`);

  const n = Object.keys(m).length;
  need(Object.values(m).every((f) => f.sha256 && f.bytes > 0), 'manifest: missing checksum');
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : `${n} fixtures, sha256 verified; ${facts.join(', ')}` };
};
