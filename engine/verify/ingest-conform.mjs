// ingest-conform: conformed media is CFR at the project rate, upright, SDR with explicit bt709 tags, yuv420p, short GOP, no B-frames;
// HLG lands where the original SDR pattern was; a second ingest is a cache hit; relink repairs a moved original by hash.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixturePath } from '../fixtures.mjs';
import { ingestSource, readBin, relink } from '../ingest.mjs';
import { readBarcodes } from '../lib/barcode.mjs';
import { run } from '../lib/proc.mjs';
import { parseFps } from '../lib/frames.mjs';
import { ffprobeJson, ingestedSet, tempFilm } from './_ingest.mjs';

const yavg = async (args, vf) => (await run('ffmpeg', ['-v', 'error', ...args, '-vf', `${vf},crop=1280:680:0:40,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-f', 'null', '-'])).out.match(/YAVG=([\d.]+)/g).map((x) => +x.slice(5));
const rate = (s) => parseFps(s).value;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { out } = await ingestedSet();

  for (const id of ['sync', 'vfr', 'hlg', 'noaudio', 'real']) {
    const m = out[id], c = m.ingest.conform, file = join(m.dir, 'conformed.mp4');
    const p = await ffprobeJson(file), s = p.streams.find((x) => x.codec_type === 'video');
    need(s.r_frame_rate === c.fps.replace(/^(\d+)$/, '$1/1') && s.avg_frame_rate === s.r_frame_rate, `${id}: not CFR at ${c.fps} (r ${s.r_frame_rate} avg ${s.avg_frame_rate})`);
    const pk = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file])).out.trim().split('\n').map((l) => l.split(','));
    const pts = pk.map((x) => +x[0]).sort((a, b) => a - b), gaps = new Set(); for (let i = 1; i < pts.length; i++) gaps.add((pts[i] - pts[i - 1]).toFixed(3));
    const keys = pk.map((x, i) => (x[1].includes('K') ? i : -1)).filter((i) => i >= 0), maxGop = Math.max(...keys.map((k, i) => (keys[i + 1] ?? pk.length) - k));
    need(gaps.size <= 2 && [...gaps].every((g) => Math.abs(g - 1 / rate(c.fps)) < 0.002), `${id}: frame gaps ${[...gaps]}`);       // NTSC rounds to ms: at most two neighbouring values
    need(maxGop <= Math.ceil(rate(c.fps)) && s.has_b_frames === 0, `${id}: GOP ${maxGop} / b-frames ${s.has_b_frames}`);
    need(!s.side_data_list?.some((d) => d.rotation) && s.width === c.width && s.height === c.height && c.width === Math.min(m.video.display_width, c.width) , `${id}: size ${s.width}x${s.height} vs media.json ${c.width}x${c.height}`);
    need(Math.abs(c.width / c.height - m.video.display_width / m.video.display_height) < 0.01, `${id}: aspect changed ${c.width}x${c.height} vs display ${m.video.display_width}x${m.video.display_height}`);
    need(m.video.rotation === 0 || s.height > s.width === m.video.display_height > m.video.display_width, `${id}: not upright`);
    need(s.pix_fmt === 'yuv420p' && s.color_space === 'bt709' && s.color_primaries === 'bt709' && s.color_transfer === 'bt709' && s.color_range === 'tv', `${id}: tags ${s.pix_fmt} ${s.color_space}/${s.color_primaries}/${s.color_transfer}/${s.color_range}`);
    need(s.sample_aspect_ratio === '1:1' || s.sample_aspect_ratio === undefined, `${id}: SAR ${s.sample_aspect_ratio}`);
    if (m.audio_used !== null) { const a = (await ffprobeJson(join(m.dir, 'audio.wav'))).streams[0]; need(a.codec_name === 'pcm_s16le' && a.sample_rate === '48000', `${id}: audio.wav ${a.codec_name} ${a.sample_rate}`); }
    for (const f of ['proxy.mp4', 'filmstrip.jpg', 'scenes.json']) need(existsSync(join(m.dir, f)), `${id}: ${f} missing`);
    if (m.audio_used !== null) for (const f of ['peaks.json', 'silence.json']) need(existsSync(join(m.dir, f)), `${id}: ${f} missing`);
    facts.push(`${id} ${c.width}x${c.height}@${c.fps} ${c.frames}f GOP<=${maxGop}`);
  }

  // frame exactness of the conform itself: CFR from VFR holds the previous frame in a dropped slot; nothing else moves
  const sb = await readBarcodes(join(out.sync.dir, 'conformed.mp4')), vb = await readBarcodes(join(out.vfr.dir, 'conformed.mp4'));
  need(sb.length === 900 && sb.every((x, k) => x.n === k), 'sync conform: barcode not exact');
  need(vb.length === 600 && vb.every((x, k) => x.n === (k % 5 === 3 ? k - 1 : k)), 'vfr conform: barcode mismatch (upright?)');
  facts.push('barcodes exact (900/900 CFR, 600/600 VFR->CFR, upright)');

  // HLG -> SDR: against the original SDR pattern the fixture was encoded from, and the standard hable reference
  const orig = mean(await yavg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=6'], "select='eq(n,10)+eq(n,60)+eq(n,110)',format=yuv420p,scale=out_range=tv"));
  const ours = mean(await yavg(['-i', join(out.hlg.dir, 'conformed.mp4')], "select='eq(n,10)+eq(n,60)+eq(n,110)'"));
  const hable = mean(await yavg(['-i', fixturePath('hlg')], "select='eq(n,10)+eq(n,60)+eq(n,110)',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"));
  need(Math.abs(ours - orig) <= 6, `hlg luma ${ours.toFixed(1)} vs original SDR ${orig.toFixed(1)}`);
  facts.push(`hlg mean luma ${ours.toFixed(1)} (original SDR ${orig.toFixed(1)}, hable ref ${hable.toFixed(1)})`);

  // cache hit
  const t0 = Date.now(), again = await ingestSource('verify-ingest', fixturePath('sync'), { id: 'sync', log: () => {} }), hit = Date.now() - t0;
  need(again.cached && hit < 2000, `second ingest not a cache hit (${hit} ms, cached=${again.cached})`);
  facts.push(`2nd ingest cache hit ${hit} ms`);

  // relink: move an original, repair by hash
  const tmp = '/tmp/studio-relink'; rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(tmp, 'a'), { recursive: true }); mkdirSync(join(tmp, 'elsewhere', 'deep'), { recursive: true });
  try {
    const orig1 = join(tmp, 'a', 'take1.mp4'), moved = join(tmp, 'elsewhere', 'deep', 'renamed take.mp4'), decoy = join(tmp, 'elsewhere', 'decoy.mp4');
    copyFileSync(fixturePath('noaudio'), orig1);
    const film = tempFilm('verify-relink'), shaOf = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
    await ingestSource('verify-relink', orig1, { id: 'take1', log: () => {} });
    const want = readBin(film).sources.take1.sha256;
    renameSync(orig1, moved);
    copyFileSync(fixturePath('sync'), decoy); // a different file in the search tree must not be picked
    const r = await relink('verify-relink', { search: [join(tmp, 'elsewhere')], log: () => {} });
    const bin = readBin(film).sources.take1;
    need(r.repaired.length === 1 && bin.path === moved && shaOf(moved) === want && readFileSync(join(film.dir, 'assets/media/take1/media.json'), 'utf8').includes('renamed take.mp4'), `relink: ${JSON.stringify(r)} path ${bin.path}`);
    const miss = await relink('verify-relink', { search: [], log: () => {} }); need(miss.ok.length === 1, 'relink: repaired path not recognised afterwards');
    facts.push('relink found the moved+renamed original by size+sha256 (decoy ignored)');
    rmSync(film.dir, { recursive: true, force: true });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  void statSync;
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
