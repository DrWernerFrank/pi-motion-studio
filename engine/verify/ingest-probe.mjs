// ingest-probe: media.json equals ffprobe truth on every fixture; odd paths ingest; a truncated file fails clearly and leaves nothing.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { ingestSource, mediaDir, readBin } from '../ingest.mjs';
import { run } from '../lib/proc.mjs';
import { SET, ffprobeJson, ingestedSet, tempFilm } from './_ingest.mjs';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const before = Object.fromEntries(Object.values(SET).map((fx) => [fx, { sha: sha(fixturePath(fx)), mtime: statSync(fixturePath(fx)).mtimeMs }]));
  const { out } = await ingestedSet();

  // 1. media.json against an independent ffprobe of the same file
  for (const [id, fx] of Object.entries(SET)) {
    const m = out[id], p = await ffprobeJson(fixturePath(fx)), v = p.streams.find((s) => s.codec_type === 'video'), au = p.streams.filter((s) => s.codec_type === 'audio');
    const eq = (a, b, what) => need(String(a) === String(b), `${id}.${what}: media.json ${a} vs ffprobe ${b}`);
    if (v && m.kind === 'video') {
      const mv = m.video;
      eq(mv.width, v.width, 'width'); eq(mv.height, v.height, 'height'); eq(mv.r_frame_rate, v.r_frame_rate, 'r_frame_rate'); eq(mv.avg_frame_rate, v.avg_frame_rate, 'avg_frame_rate');
      eq(mv.pix_fmt, v.pix_fmt, 'pix_fmt'); eq(mv.codec, v.codec_name, 'codec'); eq(mv.color.transfer, v.color_transfer ?? null, 'color_transfer'); eq(mv.color.primaries, v.color_primaries ?? null, 'color_primaries');
      eq(mv.color.matrix, v.color_space ?? null, 'color_space'); eq(mv.rotation_raw, v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0, 'rotation');
      eq(mv.bit_depth, /10/.test(v.pix_fmt) ? 10 : 8, 'bit_depth'); eq(+mv.start_time.toFixed(3), +Number(v.start_time ?? 0).toFixed(3), 'video start_time');
    }
    eq(m.audio.length, au.length, 'audio stream count');
    au.forEach((a, i) => { eq(m.audio[i].sample_rate, a.sample_rate, `audio${i}.rate`); eq(m.audio[i].channels, a.channels, `audio${i}.channels`); eq(m.audio[i].layout, a.channel_layout ?? null, `audio${i}.layout`); });
    eq(+(m.source.container_duration).toFixed(3), +Number(p.format.duration).toFixed(3), 'duration');
  }
  // semantic truths the fixtures were built to have
  const V = (id) => out[id].video;
  need(V('vfr').vfr === true && V('sync').vfr === false && V('real').vfr === false && V('hlg').vfr === false, 'vfr flag wrong');
  need(V('vfr').rotation === 90 && V('vfr').display_width === 720 && V('vfr').display_height === 1280, `rotation/display dims: ${V('vfr').rotation} ${V('vfr').display_width}x${V('vfr').display_height}`);
  need(V('hlg').color.hdr === 'hlg' && V('hlg').bit_depth === 10 && V('sync').color.hdr === null, 'hdr flag wrong');
  need(out.noaudio.audio.length === 0 && out.noaudio.audio_used === null && out.podcast.kind === 'audio' && out.podcast.video === null, 'noaudio/audio-only kinds wrong');
  need(V('real').fps === '30000/1001' && out.real.ingest.conform.fps === '30000/1001', 'real clip rate is not 30000/1001');
  facts.push(`${Object.keys(SET).length} fixtures match ffprobe (rate, size, rotation, colour, bit depth, audio layout, start time)`);

  // 2. a Windows-style path, spaces and non-ASCII (also a name with no latin letters)
  const tmpRoot = '/mnt/c/Users/Hp/AppData/Local/Temp';
  if (!existsSync(tmpRoot)) return { skip: `no Windows temp dir at ${tmpRoot} to test a C:\\ path` };
  const odd = join(tmpRoot, 'studio verify ünï ✓'); rmSync(odd, { recursive: true, force: true }); mkdirSync(odd, { recursive: true });
  try {
    const f1 = join(odd, 'clip é (final).mp4'), f2 = join(odd, 'ویدیو.mp4');
    copyFileSync(fixturePath('noaudio'), f1); copyFileSync(fixturePath('noaudio'), f2);
    const win = (await run('wslpath', ['-w', f1])).out.trim();
    need(/^[A-Za-z]:\\/.test(win), `wslpath -w gave "${win}"`);
    const film = tempFilm('verify-paths');
    const a = await ingestSource('verify-paths', win, { log: () => {} }), b = await ingestSource('verify-paths', f2, { log: () => {} });
    need(a.source.path === f1 && a.ingest.conform.frames === 240, `windows path: stored ${a.source.path}, ${a.ingest.conform?.frames} frames`);
    need(/^src-[0-9a-f]{6}$/.test(b.id) || /^[a-z0-9-]+$/.test(b.id), `non-latin name id "${b.id}"`);
    need(existsSync(join(mediaDir(film, a.id), 'conformed.mp4')) && existsSync(join(mediaDir(film, b.id), 'conformed.mp4')), 'odd-path ingest products missing');
    facts.push(`C:\\ path + spaces + é/ü/✓ ingest ok (id "${a.id}"), Persian filename -> "${b.id}"`);

    // 3. truncated files fail with a specific message and leave no partial cache
    const raw = join(odd, 'cut-moov.mp4'), fast = join(odd, 'cut-mdat.mp4');
    copyFileSync(fixturePath('sync'), raw); truncateSync(raw, Math.floor(statSync(raw).size * 0.6));                      // moov (at the end) lost
    const conformed = join(mediaDir((await ingestedSet()).film, 'sync'), 'conformed.mp4');
    copyFileSync(conformed, fast); truncateSync(fast, Math.floor(statSync(fast).size * 0.5));                              // faststart: moov present, media cut
    for (const [label, file, id] of [['moov missing', raw, 'cut-a'], ['media cut', fast, 'cut-b']]) {
      let msg = ''; try { await ingestSource('verify-paths', file, { id, log: () => {} }); } catch (e) { msg = String(e.message); }
      need(/truncated or corrupt/.test(msg) && /Nothing was ingested/.test(msg), `${label}: message "${msg.slice(0, 160)}"`);
      need(!existsSync(mediaDir(film, id)) && !readBin(film).sources[id], `${label}: partial cache left behind`);
      facts.push(`${label}: "${msg.split('.')[0].slice(0, 70)}…"`);
    }
  } finally { rmSync(odd, { recursive: true, force: true }); rmSync(join(tempFilm('verify-paths').dir), { recursive: true, force: true }); }

  // 4. originals were only read
  for (const fx of Object.values(SET)) need(sha(fixturePath(fx)) === before[fx].sha && statSync(fixturePath(fx)).mtimeMs === before[fx].mtime, `${fx}: original modified`);
  void writeFileSync;
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
