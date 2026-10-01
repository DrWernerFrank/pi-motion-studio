// Media truth: what ffprobe says about a file, normalized into media.json (mission D1). Nothing here decodes pixels.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { parseFps } from './frames.mjs';
import { run } from './proc.mjs';

// "C:\Users\me\clip.mp4" / "\\wsl$\..." -> a WSL path; "~/x" -> $HOME/x; relative -> absolute. Never touches the file.
export async function resolveSourcePath(p) {
  let s = String(p).trim().replace(/^["']|["']$/g, '');
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    const r = await run('wslpath', ['-u', s], { allowFail: true });
    if (r.code !== 0 || !r.out.trim()) throw new Error(`cannot convert the Windows path "${s}" (wslpath failed: ${r.err.trim() || 'no output'})`);
    s = r.out.trim();
  } else if (s === '~' || s.startsWith('~/')) s = homedir() + s.slice(1);
  s = resolve(s);
  if (!existsSync(s)) throw new Error(`source not found: ${s}`);
  if (!statSync(s).isFile()) throw new Error(`source is not a file: ${s}`);
  return s;
}

// sha256 of the whole file up to 2 GB; beyond that head + middle + tail 64 MB and the size (flagged as sampled).
const SAMPLE = 64 * 1024 * 1024, FULL_MAX = 2 * 1024 ** 3;
export async function hashFile(file, prev) {
  const st = statSync(file);
  if (prev && prev.sha256 && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return { ...prev, cached: true };
  const h = createHash('sha256');
  let hash_kind = 'full';
  if (st.size <= FULL_MAX) await new Promise((ok, bad) => createReadStream(file).on('data', (d) => h.update(d)).on('end', ok).on('error', bad));
  else {
    hash_kind = 'sampled'; const fd = openSync(file, 'r'), buf = Buffer.alloc(SAMPLE);
    try { for (const at of [0, Math.floor(st.size / 2) - SAMPLE / 2, st.size - SAMPLE]) { const n = readSync(fd, buf, 0, SAMPLE, at); h.update(buf.subarray(0, n)); } } finally { closeSync(fd); }
    h.update(String(st.size));
  }
  return { sha256: h.digest('hex'), hash_kind, size: st.size, mtimeMs: st.mtimeMs };
}

const num = (v) => (v === undefined || v === null || v === 'N/A' || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const rat = (s) => { if (!s || s === '0/0' || s === 'N/A') return null; const [a, b] = String(s).split('/').map(Number); return b ? a / b : a; };
const bitDepth = (s) => num(s.bits_per_raw_sample) || (/p(9|10|12|14|16)(le|be)/.exec(s.pix_fmt || '') || [])[1] * 1 || 8;

async function ffprobeJson(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { allowFail: true });
  if (r.code !== 0) {
    const why = r.err.trim().split('\n').filter(Boolean).slice(-2).join(' | ') || 'unknown error';
    const trunc = /moov atom not found|Invalid data found|end of file|Truncated|corrupt|could not find codec parameters/i.test(r.err);
    throw new Error(`${basename(file)} cannot be read as media${trunc ? ': the file looks truncated or corrupt (incomplete download or copy?)' : ''}. ffprobe: ${why}. Nothing was ingested.`);
  }
  return JSON.parse(r.out);
}

// Presentation timestamps of the video stream, sorted (B-frame order removed).
async function videoPts(file, idx) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', String(idx), '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { allowFail: true });
  return r.out.split('\n').map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

// Variable frame rate: more than a handful of frame gaps deviate > 25% from the median gap.
export function vfrStats(pts) {
  if (pts.length < 3) return { vfr: false, frames: pts.length };
  const d = []; for (let i = 1; i < pts.length; i++) d.push(pts[i] - pts[i - 1]);
  const sorted = [...d].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const odd = d.filter((x) => Math.abs(x - med) > 0.25 * med).length;
  return { vfr: odd >= Math.max(3, d.length * 0.002), medianGap: med, oddGaps: odd, frames: pts.length, mean_fps: (pts.length - 1) / (pts.at(-1) - pts[0]) };
}

// The normalized truth of one source. `hashInfo` comes from hashFile.
export async function probeMedia(file, hashInfo) {
  const p = await ffprobeJson(file), f = p.format;
  const v = p.streams.find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic)), pic = p.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic);
  const audio = p.streams.filter((s) => s.codec_type === 'audio').map((s) => ({
    index: s.index, codec: s.codec_name, sample_rate: num(s.sample_rate), channels: s.channels, layout: s.channel_layout || null,
    start_time: num(s.start_time) ?? num(f.start_time) ?? 0, duration: num(s.duration) ?? num(f.duration), bit_rate: num(s.bit_rate) }));
  const out = {
    version: 1,
    source: { path: file, name: basename(file), ext: extname(file).toLowerCase(), ...hashInfo, format: f.format_name, container_duration: num(f.duration), start_time: num(f.start_time) ?? 0, bit_rate: num(f.bit_rate) },
    kind: v && !(v.nb_frames === '1' || (num(v.duration) === null && /image2|png_pipe|jpeg_pipe|webp_pipe/.test(f.format_name))) ? 'video' : v ? 'image' : audio.length ? 'audio' : 'none',
    video: null, audio, audio_used: audio.length ? audio[0].index : null,
  };
  if (v) {
    const rotation_raw = v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? num(v.tags?.rotate) ?? 0; // ffprobe's own value (e.g. -90)
    const rotation = ((Math.round(-rotation_raw) % 360) + 360) % 360; // clockwise degrees to apply: 0 | 90 | 180 | 270
    const [sn, sd] = (v.sample_aspect_ratio && v.sample_aspect_ratio !== 'N/A' ? v.sample_aspect_ratio : '1:1').split(':').map(Number);
    const sar = sd ? sn / sd : 1, swap = rotation === 90 || rotation === 270;
    const w = v.width, h = v.height, dw0 = Math.round(w * (sar || 1)), dispW = swap ? h : dw0, dispH = swap ? dw0 : h;
    const transfer = v.color_transfer || null, hdr = transfer === 'smpte2084' ? 'pq' : transfer === 'arib-std-b67' ? 'hlg' : null;
    const rfps = rat(v.r_frame_rate), afps = rat(v.avg_frame_rate);
    const stats = out.kind === 'video' ? vfrStats(await videoPts(file, v.index)) : { vfr: false };
    out.video = {
      index: v.index, codec: v.codec_name, profile: v.profile || null, width: w, height: h, sar: sar || 1, rotation, rotation_raw,
      display_width: dispW, display_height: dispH, pix_fmt: v.pix_fmt, bit_depth: bitDepth(v),
      r_frame_rate: v.r_frame_rate, avg_frame_rate: v.avg_frame_rate, fps: parseFps(rfps && rfps < 1000 ? v.r_frame_rate : v.avg_frame_rate).str,
      fps_value: stats.mean_fps && stats.vfr ? stats.mean_fps : afps || rfps, vfr: stats.vfr, vfr_stats: stats.vfr ? { median_gap: stats.medianGap, odd_gaps: stats.oddGaps } : undefined,
      nb_frames: num(v.nb_frames) ?? stats.frames ?? null, duration: num(v.duration) ?? num(f.duration), start_time: num(v.start_time) ?? num(f.start_time) ?? 0,
      field_order: v.field_order || 'progressive', interlaced: !!v.field_order && !['progressive', 'unknown'].includes(v.field_order),
      color: { primaries: v.color_primaries || null, transfer, matrix: v.color_space || null, range: v.color_range || null, hdr },
    };
  }
  if (pic) out.cover_art = true;
  return out;
}
