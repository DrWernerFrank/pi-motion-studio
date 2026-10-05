// hardening (P12): the edge matrix. Every odd input a real editing engine meets must ingest, conform and cut
// without silent damage — and the ones that cannot must fail loudly, naming the file and the reason.
//   VFR portrait phone · rotate 180 · odd sizes (854x480, 123x77) · anamorphic SAR 2:1 · 120 fps · 4K over the
//   1920 cap · 10-bit SDR 4:4:4 · interlaced 480i · mono · 5.1 · two audio streams · non-zero start_time ·
//   sub-second clips · a still image · .mov/.mkv/.webm/.mts · 25 minutes (stands in for >2 h) · non-English
//   audio-only speech · and files that probe fine but decode into zeros midway.
// The baseline cases live in ingest-probe (truncated/corrupt basics, unicode/space/Windows paths, the
// audio-only podcast) and ingest-conform (HLG 10-bit HDR, rotation 90, VFR->CFR); this check takes the matrix
// to the corners. Fixtures: engine/edge-fixtures.mjs (~/.cache/pi-motion-studio/fixtures/edge).
import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { EDGE_DIR, edgeFixturePath, ensureEdgeFixtures } from '../edge-fixtures.mjs';
import { ensureFixtures, fixturePath } from '../fixtures.mjs';
import { ingestSource, mediaDir, readBin } from '../ingest.mjs';
import { bitsToIndex, readBarcodes } from '../lib/barcode.mjs';
import { applyOps, loadEdit } from '../lib/edit-store.mjs';
import { clipFrames, grid } from '../lib/edit-ops.mjs';
import { FILMS } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { ffprobeJson, tempFilm } from './_ingest.mjs';
import { buildDialog } from '../edit-audio.mjs';

const KEY = 'verify-harden', AKEY = 'verify-harden-audio', TMP = '/tmp/studio-hardening';

export default async ({ quick = false } = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const edgeFile = (name) => join(EDGE_DIR, name);
  const fileOf = (id, ext) => ext === 'mov' ? edgeFixturePath(id) : edgeFile(`${id}.${ext}`);

  // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
  const ing = async (key, id, file, opts = {}) => ingestSource(key, file, { id, log: () => {}, ...opts });
  // cells stretched only horizontally (anamorphic): a custom strip read — readBarcodes assumes uniform scaling
  const stripBarcodes = (file, w, h) => new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-vf', `crop=${w}:${h}:0:0,scale=16:1:flags=area,format=gray`, '-f', 'rawvideo', '-']);
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => { if (c) return no(new Error(`strip read failed: ${err.slice(-200)}`)); const buf = Buffer.concat(chunks), out = []; for (let i = 0; i + 16 <= buf.length; i += 16) out.push({ i: i / 16, n: bitsToIndex(buf, i) }); ok(out); });
    p.stdin.end();
  });
  const rmsDb = async (file) => {
    const r = await run('ffmpeg', ['-v', 'info', '-i', file, '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { allowFail: true });
    return +(/RMS level dB:\s*(-?[\d.]+)/.exec(r.err)?.[1] ?? NaN);
  };
  const f32Stereo = (file) => new Promise((ok, no) => { // f32le stereo samples of a wav (the dialog bus)
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-']);
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => { if (c) return no(new Error(`f32 decode failed: ${err.slice(-200)}`)); const b = Buffer.concat(chunks), n = Math.floor(b.length / 8), L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = b.readFloatLE(i * 8); R[i] = b.readFloatLE(i * 8 + 4); } ok({ L, R }); });
    p.stdin.end();
  });
  const zeroFrom = (file, from) => { const st = statSync(file), fd = openSync(file, 'r+'); writeSync(fd, Buffer.alloc(st.size - from, 0), 0, st.size - from, from); closeSync(fd); };
  const mdatStart = (file) => { // first byte of the mdat atom: everything after the header (ftyp+moov) lives before it
    let off = 0; const st = statSync(file), h = Buffer.alloc(8), fd = openSync(file, 'r');
    try { for (let i = 0; i < 12 && off < st.size - 8; i++) { readSync(fd, h, 0, 8, off); const size = h.readUInt32BE(0); if (h.toString('ascii', 4, 8) === 'mdat') return off; if (size <= 0 || off + size > st.size) break; off += size; } } finally { closeSync(fd); }
    return null;
  };
  const cases = [];                     // one case = one loud failure group; a crash names itself, never kills the check
  const case_ = (id, fn) => cases.push({ id, fn });
  const exact = (bars, id, what) => need(bars.length > 0 && bars.every((x, k) => x.n === k),
    `${id}: ${what}: ${bars.length} frames, ${bars.filter((x, k) => x.n !== k).length} wrong (first wrong ${JSON.stringify(bars.find((x, k) => x.n !== k))})`);
  const vstream = (p) => p.streams.find((s) => s.codec_type === 'video');

  // ── build the edge fixtures (quick skips the 4K and 25-minute builds) ───────────────────────────────
  await ensureEdgeFixtures({ includeSlow: !quick, log: () => {} });
  const film = tempFilm(KEY);
  const ingested = [];                  // { id, m } — every product the pipeline promises gets checked at the end
  let audioReady = false;

  // ── the matrix ───────────────────────────────────────────────────────────────────────────────────────
  case_('edge-vfr-phone', async () => {
    const m = await ing(KEY, 'edge-vfr-phone', edgeFixturePath('edge-vfr-phone'), { fps: '30' }); ingested.push({ id: 'edge-vfr-phone', m });
    need(m.video.rotation === 90 && m.video.display_width === 1080 && m.video.display_height === 1920,
      `edge-vfr-phone: media.json rotation/display is ${m.video.rotation} at ${m.video.display_width}x${m.video.display_height}, wanted 90 at 1080x1920`);
    need(m.video.vfr === true, 'edge-vfr-phone: media.json does not flag VFR');
    const src = await ffprobeJson(edgeFixturePath('edge-vfr-phone'));
    need(src.streams.filter((s) => s.codec_type === 'audio').every((a) => a.sample_rate === '48000' && a.channels === 2), 'edge-vfr-phone: not 48 kHz stereo');
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.width === 1080 && s.height === 1920 && s.height > s.width, `edge-vfr-phone: conformed is ${s.width}x${s.height}, wanted upright portrait 1080x1920`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
    // the encode dropped every 3rd source frame (n%3==2); CFR holds the previous frame in those slots. The final
    // source frame is one of them, so the conform lands on 299 slots (the fps filter does not pad the tail).
    const wrong = bars.filter((x, k) => x.n !== (k % 3 === 2 ? k - 1 : k));
    need(bars.length === 299 && wrong.length === 0, `edge-vfr-phone: the VFR->CFR hold pattern is wrong (${wrong.length}/${bars.length} frames, first wrong ${JSON.stringify(wrong[0])})`);
    facts.push('vfr-phone upright 1080x1920, 299 CFR slots, each drop held frame-exact');
  });

  case_('edge-rot-180', async () => {
    const m = await ing(KEY, 'edge-rot-180', edgeFixturePath('edge-rot-180'), { fps: '30' }); ingested.push({ id: 'edge-rot-180', m });
    need(m.video.rotation === 180 && m.video.display_width === 720 && m.video.display_height === 480,
      `edge-rot-180: media.json rotation/display is ${m.video.rotation} at ${m.video.display_width}x${m.video.display_height}, wanted 180 at 720x480`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(!s.side_data_list?.some((d) => d.rotation), 'edge-rot-180: the conformed still carries a rotation tag');
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
    need(bars.length === 180, `edge-rot-180: ${bars.length} frames, wanted 180`);
    exact(bars, 'edge-rot-180', 'barcode not upright (the 180 was not baked back)');
    facts.push('rot-180 baked upright, 180/180 barcodes exact');
  });

  case_('edge-odd-854', async () => {
    const m = await ing(KEY, 'edge-odd-854', edgeFixturePath('edge-odd-854'), { fps: '30' }); ingested.push({ id: 'edge-odd-854', m });
    need(m.video.width === 854 && m.video.height === 480, `edge-odd-854: media.json size ${m.video.width}x${m.video.height}, wanted 854x480`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.width === 854 && s.height === 480, `edge-odd-854: conformed ${s.width}x${s.height}, wanted 854x480`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { cell: 16 });
    need(bars.length === 180, `edge-odd-854: ${bars.length} frames, wanted 180`);
    exact(bars, 'edge-odd-854', 'cell-16 barcode');
    facts.push('odd-854 exact 854x480, 180/180');
  });

  case_('edge-odd-123', async () => {
    const m = await ing(KEY, 'edge-odd-123', edgeFile('edge-odd-123.mp4'), { fps: '12' }); ingested.push({ id: 'edge-odd-123', m });
    need(m.video.width === 123 && m.video.height === 77 && m.video.pix_fmt === 'yuv444p',
      `edge-odd-123: media.json ${m.video.width}x${m.video.height} ${m.video.pix_fmt}, wanted 123x77 yuv444p (odd dimensions must survive the probe)`);
    const c = m.ingest.conform, s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(c.width === 122 && c.height === 76 && s.width === 122 && s.height === 76,
      `edge-odd-123: conformed ${s.width}x${s.height} vs media.json ${c.width}x${c.height}, wanted 122x76 (the yuv420 pipeline evenizes 123x77)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { cell: 7, scale: 122 / 123 });
    need(bars.length === 72, `edge-odd-123: ${bars.length} frames at 12 fps, wanted 72`);
    exact(bars, 'edge-odd-123', 'cell-7 barcode');
    facts.push('odd-123 123x77 -> 122x76, 72/72 at 12 fps');
  });

  case_('edge-sar', async () => {
    const m = await ing(KEY, 'edge-sar', edgeFixturePath('edge-sar'), { fps: '30' }); ingested.push({ id: 'edge-sar', m });
    need(m.video.sar === 2 && m.video.display_width === 1920 && m.video.display_height === 540,
      `edge-sar: media.json sar ${m.video.sar} display ${m.video.display_width}x${m.video.display_height}, wanted 2:1 at 1920x540`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.width === 1920 && s.height === 540 && s.sample_aspect_ratio === '1:1',
      `edge-sar: conformed is ${s.width}x${s.height} SAR ${s.sample_aspect_ratio}, wanted 1920x540 SAR 1:1`);
    const bars = await stripBarcodes(join(m.dir, 'conformed.mp4'), 640, 20); // the strip is stretched 2x horizontally only
    need(bars.length === 180, `edge-sar: ${bars.length} frames, wanted 180`);
    exact(bars, 'edge-sar', 'anamorphic barcode (the stretch must end square)');
    facts.push('sar 2:1 -> 1920x540 SAR 1:1, 180/180');
  });

  case_('edge-120fps', async () => {
    const m = await ing(KEY, 'edge-120fps', edgeFixturePath('edge-120fps'), { fps: '30' }); ingested.push({ id: 'edge-120fps', m });
    need(m.video.fps === '120' && m.video.nb_frames === 600, `edge-120fps: media.json ${m.video.fps} fps / ${m.video.nb_frames} frames, wanted 120 fps / 600 frames`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.r_frame_rate === '30/1' && +s.nb_frames === 150, `edge-120fps: conformed ${s.r_frame_rate} with ${s.nb_frames} frames, wanted 30/1 with 150 (= duration x project fps)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { cell: 20 });
    const stride = bars.slice(1).every((x, i) => x.n - bars[i].n === 4);
    need(bars.length === 150 && stride && bars[0].n <= 4,
      `edge-120fps: the 120->30 mapping is not a clean 1-in-4 pick (${bars.length} frames, first ${bars[0]?.n}, stride-4 ${stride})`);
    facts.push(`120->30 fps: 150 frames, barcode stride 4 (phase ${bars[0]?.n}), 3 of 4 dropped frame-exactly`);
  });

  if (!quick) case_('edge-4k', async () => {
    const m = await ing(KEY, 'edge-4k', edgeFixturePath('edge-4k'), { fps: '25' }); ingested.push({ id: 'edge-4k', m });
    need(m.video.display_width === 3840 && m.video.display_height === 2160, `edge-4k: media.json ${m.video.display_width}x${m.video.display_height}, wanted 3840x2160`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(Math.max(s.width, s.height) <= 1920 && s.width === 1920 && s.height === 1080,
      `edge-4k: conformed ${s.width}x${s.height}, wanted the 1920 long-side cap -> 1920x1080`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { scale: 0.5 });
    need(bars.length === 100, `edge-4k: ${bars.length} frames, wanted 100`);
    exact(bars, 'edge-4k', 'downscaled barcode');
    facts.push('4k downscaled 3840x2160 -> 1920x1080, 100/100');
  });

  case_('edge-10bit-sdr', async () => {
    const m = await ing(KEY, 'edge-10bit-sdr', edgeFixturePath('edge-10bit-sdr'), { fps: '30' }); ingested.push({ id: 'edge-10bit-sdr', m });
    need(m.video.bit_depth === 10 && m.video.pix_fmt === 'yuv444p10le' && m.video.color.hdr === null,
      `edge-10bit-sdr: media.json ${m.video.pix_fmt} depth ${m.video.bit_depth} hdr ${m.video.color.hdr}, wanted 10-bit yuv444p10le SDR`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.pix_fmt === 'yuv420p' && s.color_space === 'bt709', `edge-10bit-sdr: conformed ${s.pix_fmt}/${s.color_space}, wanted 8-bit yuv420p bt709 (the render path)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
    need(bars.length === 180, `edge-10bit-sdr: ${bars.length} frames, wanted 180`);
    exact(bars, 'edge-10bit-sdr', 'barcode');
    facts.push('10-bit 4:4:4 stays 10-bit in media.json, conforms to 8-bit yuv420p, 180/180');
  });

  case_('edge-interlaced', async () => {
    const m = await ing(KEY, 'edge-interlaced', edgeFixturePath('edge-interlaced'), { fps: '30' }); ingested.push({ id: 'edge-interlaced', m });
    need(m.video.interlaced === true && m.video.field_order === 'tt',
      `edge-interlaced: media.json interlaced ${m.video.interlaced} field_order ${m.video.field_order}, wanted tt`);
    need(m.ingest.conform.deinterlaced === true, 'edge-interlaced: media.json does not record the deinterlace');
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(s.field_order === 'progressive', `edge-interlaced: conformed field_order ${s.field_order}, wanted progressive (yadif)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
    need(bars.length === 240, `edge-interlaced: ${bars.length} frames, wanted 240 (8 s at 30, one per woven field pair)`);
    exact(bars, 'edge-interlaced', 'barcode after yadif');
    facts.push('480i tt -> progressive, 240/240 frame-exact');
  });

  // ── audio cases run inside one EDIT film so the dialog bus can be built over them ────────────────────
  case_('audio-setup', async () => {
    rmSync(join(FILMS, AKEY), { recursive: true, force: true });
    const { createEditFilm } = await import('../edit-cli.mjs');
    await createEditFilm(AKEY, { fps: 30, title: AKEY });
    audioReady = true;
  });

  case_('edge-mono', async () => {
    const m = await ing(AKEY, 'edge-mono', edgeFixturePath('edge-mono'), { fps: '30' }); ingested.push({ id: 'edge-mono', m });
    need(m.audio[0].channels === 1 && m.audio[0].layout === 'mono', `edge-mono: media.json audio ${m.audio[0].channels}ch ${m.audio[0].layout}, wanted mono`);
    const a = (await ffprobeJson(join(m.dir, 'audio.wav'))).streams[0];
    need(a.codec_name === 'pcm_s16le' && a.sample_rate === '48000' && a.channels === 1,
      `edge-mono: audio.wav ${a.codec_name} ${a.sample_rate} ${a.channels}ch, wanted 48 kHz 16-bit MONO (ingest keeps <= 2 channels as-is)`);
    facts.push('mono stays 1ch in audio.wav');
  });

  case_('edge-51', async () => {
    const m = await ing(AKEY, 'edge-51', edgeFixturePath('edge-51'), { fps: '30' }); ingested.push({ id: 'edge-51', m });
    need(m.audio[0].channels === 6 && /5\.1/.test(m.audio[0].layout || ''), `edge-51: media.json audio ${m.audio[0].channels}ch layout ${m.audio[0].layout}, wanted 6ch 5.1 recorded`);
    const a = (await ffprobeJson(join(m.dir, 'audio.wav'))).streams[0];
    need(a.channels === 2 && a.sample_rate === '48000', `edge-51: audio.wav ${a.channels}ch at ${a.sample_rate}, wanted the 2ch downmix at 48 kHz`);
    facts.push('5.1 layout recorded in media.json, downmixed to stereo');
  });

  case_('edge-2audio', async () => {
    const fx = edgeFixturePath('edge-2audio');
    const m = await ing(AKEY, 'edge-2audio', fx); ingested.push({ id: 'edge-2audio', m });  // default: the first audio stream (quiet)
    need(m.audio.length === 2, `edge-2audio: media.json lists ${m.audio.length} audio streams, wanted 2`);
    need(m.audio_used === 1, `edge-2audio: default audio_used is ${m.audio_used}, wanted stream 1 (the first audio)`);
    const loud = await ing(AKEY, 'edge-2audio-loud', fx, { audioStream: 2 }); ingested.push({ id: 'edge-2audio-loud', m: loud });
    need(loud.audio_used === 2, `edge-2audio: --audio-stream 2 picked ${loud.audio_used}, wanted 2 (the second audio stream)`);
    const [r1, r2] = [await rmsDb(join(m.dir, 'audio.wav')), await rmsDb(join(loud.dir, 'audio.wav'))];
    need(Number.isFinite(r1) && Number.isFinite(r2) && r2 - r1 > 15,
      `edge-2audio: the stream pick is not measurable (stream 1 RMS ${r1} dB, stream 2 RMS ${r2} dB, wanted > 15 dB apart: the 900 Hz loud stream)`);
    need(r2 > -35, `edge-2audio: the picked stream RMS is ${r2} dB, wanted an audible loud stream (> -35 dB)`);
    let msg = ''; try { await ingestSource(AKEY, fx, { id: 'edge-2audio-bad', audioStream: 0, log: () => {} }); } catch (e) { msg = String(e.message); }
    need(/has no audio stream 0/.test(msg) && /streams: 1, 2/.test(msg),
      `edge-2audio: a bad --audio-stream must fail loudly naming the stream (message "${msg.slice(0, 120)}", wanted "has no audio stream 0 (streams: 1, 2)")`);
    need(!existsSync(join(FILMS, AKEY, 'assets', 'media', 'edge-2audio-bad')), 'edge-2audio: the rejected ingest left a media dir behind');
    facts.push(`2 audio streams: pick 2 = ${r2.toFixed(1)} dB vs pick 1 = ${r1.toFixed(1)} dB; a bad --audio-stream is rejected loudly`);
  });

  case_('edge-start-offset', async () => {
    const m = await ing(KEY, 'edge-start-offset', edgeFixturePath('edge-start-offset'), { fps: '30' }); ingested.push({ id: 'edge-start-offset', m });
    need(m.source.start_time > 0.5 && m.video.start_time > 0.5,
      `edge-start-offset: media.json start_time ${m.source.start_time}/${m.video.start_time}, wanted > 0.5 s (a genuinely non-zero start)`);
    const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(+s.start_time === 0 && +s.nb_frames === 240 && Math.abs(+s.duration - 8) < 1 / 30 + 0.01,
      `edge-start-offset: conformed starts at ${s.start_time} with ${s.nb_frames} frames / ${s.duration}s, wanted t=0 with all 240 frames of 8 s`);
    const a = (await ffprobeJson(join(m.dir, 'audio.wav'))).streams[0];
    need(Math.abs(+a.duration - 8) < 0.1, `edge-start-offset: audio.wav is ${a.duration}s, wanted the full 8 s within a frame (offset stripped, no lost audio)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
    exact(bars, 'edge-start-offset', 'barcode (the 1.5 s offset must not shift or drop content)');
    facts.push(`start_time ${m.source.start_time.toFixed(3)}s -> conformed t=0, 240/240 frames, audio ${(+a.duration).toFixed(3)}s`);
  });

  case_('edge-sub1s', async () => {
    const m = await ing(AKEY, 'edge-sub1s', edgeFixturePath('edge-sub1s'), { fps: '30' }); ingested.push({ id: 'edge-sub1s', m });
    const c = m.ingest.conform;
    need(c.frames === 18 && Math.abs(c.duration - 0.6) < 0.02, `edge-sub1s: conformed ${c.frames} frames / ${c.duration}s, wanted 18 frames of 0.6 s`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { cell: 20 });
    exact(bars, 'edge-sub1s', 'barcode');
    facts.push('sub-1s clip ingests and conforms: 18 frames exact');
  });

  case_('edge-still', async () => {
    const m = await ing(KEY, 'edge-still', edgeFixturePath('edge-still'), { fps: '30' }); ingested.push({ id: 'edge-still', m });
    need(m.kind === 'image', `edge-still: media.json kind "${m.kind}", wanted image`);
    const c = m.ingest.conform, s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
    need(c.frames === 150 && Math.abs(c.duration - 5) < 0.05 && +s.duration >= 4.98,
      `edge-still: conformed ${c.frames} frames / ${c.duration}s, wanted the default 5 still-seconds (150 frames at 30 fps)`);
    const bars = await readBarcodes(join(m.dir, 'conformed.mp4'), { to: 2 });
    need(bars.length === 60 && bars.every((x) => x.n === 0),
      `edge-still: the freeze does not hold frame 0 (${bars.length} frames read in 2 s, values ${[...new Set(bars.map((x) => x.n))].slice(0, 4)})`);
    facts.push('still PNG -> a 5 s freeze at the default still-seconds, 150 frames');
  });

  case_('edge-containers', async () => {
    const seqs = {};
    for (const ext of ['mov', 'mkv', 'webm', 'mts']) {
      const id = `edge-containers-${ext}`, m = await ing(KEY, id, fileOf('edge-containers', ext), { fps: '30' }); ingested.push({ id, m });
      need(m.kind === 'video' && m.source.ext === `.${ext}`, `edge-containers.${ext}: media.json kind ${m.kind} ext ${m.source.ext}, wanted a .${ext} video source`);
      need(m.audio.length === 1, `edge-containers.${ext}: ${m.audio.length} audio streams, wanted 1 (aac in mov/mts, opus in mkv/webm)`);
      const s = vstream(await ffprobeJson(join(m.dir, 'conformed.mp4')));
      need(+s.nb_frames === 180 && Math.abs(+s.duration - 6) < 1 / 30 + 0.01,
        `edge-containers.${ext}: conformed ${s.nb_frames} frames / ${s.duration}s, wanted 180 frames of 6 s`);
      const bars = await readBarcodes(join(m.dir, 'conformed.mp4'));
      exact(bars, `edge-containers.${ext}`, 'barcode');
      seqs[ext] = bars.map((x) => x.n).join(',');
    }
    const all = Object.values(seqs);
    need(all.every((x) => x === all[0]),
      `edge-containers: the four conformed barcode sequences differ (${Object.entries(seqs).filter(([, v]) => v !== all[0]).map(([k]) => k).join(', ')})`);
    facts.push('containers .mov/.mkv/.webm/.mts all ingest and conform identically (180/180 each)');
  });

  if (!quick) case_('edge-25min', async () => {
    const m = await ing(KEY, 'edge-25min', edgeFixturePath('edge-25min'), { fps: '30' }); ingested.push({ id: 'edge-25min', m });
    const c = m.ingest.conform;
    need(c.frames === 45000 && Math.abs(c.duration - 1500) < 0.1, `edge-25min: conformed ${c.frames} frames / ${c.duration}s, wanted 45000 frames of 1500 s`);
    const wavSamples = (statSync(join(m.dir, 'audio.wav')).size - 44) / 4; // 16-bit stereo
    const peaks = JSON.parse(readFileSync(join(m.dir, 'peaks.json'), 'utf8'));
    need(Math.abs(peaks.buckets - 150000) < 100, `edge-25min: peaks.buckets ${peaks.buckets}, wanted ~150000 (25 min at 100 buckets/s)`);
    need(peaks.data.length === peaks.buckets * 2, `edge-25min: peaks.data ${peaks.data.length} entries for ${peaks.buckets} buckets, wanted 2 per bucket`);
    need(wavSamples < 2 ** 31 && peaks.buckets * 2 < 2 ** 31 && Number.isInteger(peaks.buckets),
      `edge-25min: sample arithmetic not integer-safe (${wavSamples} wav samples, ${peaks.buckets * 2} peak entries vs 2^31 = ${2 ** 31})`);
    const f = join(m.dir, 'conformed.mp4');
    const at = async (from, to) => (await readBarcodes(f, { cell: 20, from, to })).map((x) => x.n);
    const [head, mid, tail] = [await at(0, 1), await at(750, 751), await at(1499, 1500)];
    need(head[0] === 0 && mid[0] === 22500 && tail.at(-1) === 44999,
      `edge-25min: barcode spot checks wrong (start ${head[0]}, 750 s ${mid[0]}, last ${tail.at(-1)}; wanted 0, 22500, 44999)`);
    facts.push(`25-min: 45000 frames, 1500.0s, ${Math.round(wavSamples).toLocaleString()} wav samples < 2^31, ${peaks.buckets} peak buckets`);
  });

  // files that PROBE fine but decode into zeros midway: ingest must fail loudly and leave nothing behind
  case_('corrupt-decode', async () => {
    const base = join(mediaDir(film, 'edge-rot-180'), 'conformed.mp4'); // faststart: the moov lives at the front
    if (!existsSync(base)) { bad.push('corrupt-decode: no conformed.mp4 to corrupt (the edge-rot-180 case failed earlier)'); return; }
    mkdirSync(TMP, { recursive: true });
    const size = statSync(base).size, tail = join(TMP, 'zeros-tail.mp4'), zeros = join(TMP, 'zeros-all.mp4');
    copyFileSync(base, tail); zeroFrom(tail, Math.floor(size * 0.55));                            // valid header, decode dies ~57% in
    copyFileSync(base, zeros); zeroFrom(zeros, mdatStart(zeros) ?? Math.floor(size * 0.02));      // valid header, then all media zeros
    for (const f of [tail, zeros]) need((await ffprobeJson(f)).streams.length > 0, 'corrupt-decode: the probe files must still read (ffprobe parses the intact moov)');
    for (const [label, file, id, want] of [
      ['decode dies midway', tail, 'corrupt-tail', /truncated or corrupt/],
      ['all media zeros', zeros, 'corrupt-zeros', /conform failed|truncated or corrupt/],
    ]) {
      let msg = '', threw = true;
      try { await ingestSource(KEY, file, { id, log: () => {} }); threw = false; } catch (e) { msg = String(e.message); }
      need(threw && want.test(msg), `${label}: ingest did not fail loudly (message "${msg.slice(0, 160)}", wanted /${want.source}/)`);
      need(!existsSync(mediaDir(film, id)) && !readBin(film).sources[id], `${label}: a partial media dir or bin entry was left behind`);
      facts.push(`${label}: "${msg.split('.')[0].slice(0, 80)}…"`);
    }
  });

  // the dialog bus over mono + 5.1 + the second audio stream + a split sub-1s clip (asserts what the engine does)
  case_('dialog-bus', async () => {
    if (!audioReady) throw new Error('the audio edit film was not created (audio-setup failed)');
    await applyOps(AKEY, [
      { op: 'add', src: 'edge-mono', in: 0, out: 6, at: 0 },
      { op: 'add', src: 'edge-51', in: 0, out: 6, at: 6 },
      { op: 'add', src: 'edge-2audio-loud', in: 0, out: 6, at: 12 },
      { op: 'add', src: 'edge-sub1s', in: 0, out: 0.6, at: 18 },
    ]);
    // the split the mission worries about: a VALID middle split of an 18-frame clip must not hit "too close to an edge"
    const before = loadEdit(AKEY).edit, G = grid(before), sub = before.tracks.find((t) => t.kind === 'video').clips.find((c) => c.src === 'edge-sub1s');
    let splitErr = '';
    try { await applyOps(AKEY, { op: 'split', id: sub.id, t: 18.3 }); } catch (e) { splitErr = String(e.message); }
    need(!splitErr, `edge-sub1s: splitting an 18-frame clip at its middle failed: ${splitErr}`);
    const edit = loadEdit(AKEY).edit, subs = edit.tracks.find((t) => t.kind === 'video').clips.filter((c) => c.src === 'edge-sub1s');
    need(subs.length === 2 && subs.every((c) => clipFrames(edit, c) === 9),
      `edge-sub1s: the split left ${subs.length} clips of ${subs.map((c) => clipFrames(edit, c)).join('/')} frames, wanted 2 x 9`);
    need(G.F(subs[0].out) - G.F(subs[0].in) === 9 && G.F(subs[1].out) - G.F(subs[1].in) === 9 && subs[1].in === subs[0].out,
      `edge-sub1s: split ranges ${subs[0].in}-${subs[0].out} / ${subs[1].in}-${subs[1].out}s, wanted 0-0.3 / 0.3-0.6`);
    const d = await buildDialog(AKEY, { log: () => {} });
    need(d.clips === 5, `dialog-bus: mixed ${d.clips} clips, wanted 5 (mono, 5.1, loud pick, sub1s-a, sub1s-b)`);
    need(Math.abs(d.samples - 18.6 * 48000) <= 2, `dialog-bus: ${d.samples} samples, wanted 18.6 s x 48 kHz (the split must not change the timeline length)`);
    const { L, R } = await f32Stereo(d.file);
    const win = (a, b) => { const s = Math.floor(a * 48000), e = Math.floor(b * 48000); let maxAbs = 0, sum = 0; for (let i = s; i < e; i++) { maxAbs = Math.max(maxAbs, Math.abs(L[i] - R[i])); sum += (L[i] * L[i] + R[i] * R[i]) / 2; } return { maxAbs, rms: 10 * Math.log10(Math.sqrt(sum / (e - s)) + 1e-12) }; };
    const mono = win(0, 6), sur = win(6, 12), loud = win(12, 18);
    need(mono.maxAbs === 0, `edge-mono: the dialog bus did not duplicate mono to L=R (max |L-R| ${mono.maxAbs.toExponential(2)} in [0,6) s)`);
    need(sur.maxAbs > 0 && sur.rms > -50, `edge-51: the 5.1 downmix is not a real stereo mix (max |L-R| ${sur.maxAbs.toExponential(2)}, rms ${sur.rms.toFixed(1)} dB)`);
    need(loud.rms > -45, `edge-2audio: the picked stream went silent in the bus (rms ${loud.rms.toFixed(1)} dB)`);
    facts.push(`dialog bus: mono duplicated L=R exactly, 5.1 downmix |L-R| ${sur.maxAbs.toFixed(3)}, sub-1s split 9+9 frames`);
  });

  // non-English speech, audio-only, from the main fixture registry (built by the fixtures check / ML env)
  let faSkip = null;
  case_('speech-fa', async () => {
    if (!existsSync(fixturePath('speech-fa'))) {
      try { await ensureFixtures({ only: ['speech-fa'], log: () => {} }); }
      catch (e) { faSkip = `no ML voice to build the fa speech fixture: ${String(e.message).split('\n')[0]}`; return; }
    }
    const m = await ing(KEY, 'speech-fa', fixturePath('speech-fa')); ingested.push({ id: 'speech-fa', m });
    need(m.kind === 'audio' && m.video === null, `speech-fa: media.json kind ${m.kind}, wanted audio-only`);
    need(!existsSync(join(m.dir, 'conformed.mp4')), 'speech-fa: an audio-only source produced a conformed.mp4');
    const a = (await ffprobeJson(join(m.dir, 'audio.wav'))).streams[0];
    need(a.sample_rate === '48000' && +a.duration > 1, `speech-fa: audio.wav ${a.sample_rate} Hz ${a.duration}s, wanted 48 kHz speech`);
    facts.push(`fa speech (Persian, RTL) ingests audio-only: ${(+a.duration).toFixed(1)}s`);
  });

  // ── run ─────────────────────────────────────────────────────────────────────────────────────────────
  for (const c of cases) {
    try { await c.fn(); } catch (e) { bad.push(`${c.id}: case crashed: ${String(e.message || e).split('\n')[0]}`); }
  }
  for (const { id, m } of ingested) {  // every product the pipeline promises, on every case
    if (m.ingest.conform) for (const f of ['conformed.mp4', 'proxy.mp4', 'filmstrip.jpg', 'scenes.json']) need(existsSync(join(m.dir, f)), `${id}: ${f} missing after ingest`);
    if (m.audio_used !== null) for (const f of ['audio.wav', 'peaks.json', 'silence.json']) need(existsSync(join(m.dir, f)), `${id}: ${f} missing after ingest`);
  }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }

  if (faSkip && bad.length === 0) return { skip: faSkip };
  if (faSkip) bad.push(faSkip);
  if (quick) facts.push('quick mode: edge-4k and edge-25min skipped (build cost) — a full run is required for them');
  facts.push('truncated-file basics + unicode/space/Windows paths: ingest-probe; HLG 10-bit + rotation 90 + VFR->CFR: ingest-conform');
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
