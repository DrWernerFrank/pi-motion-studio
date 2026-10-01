// Frame-index barcode: a strip of BITS cells (LSB left) in the top-left corner. Fixtures carry it so any
// decoded picture frame names its own source frame number: the basis of the frame-exact checks.
import { spawn } from 'node:child_process';

export const BARCODE = { bits: 16, cell: 40 };

// lavfi source producing the strip for frames 0..dur*fps (frame N shows N)
export const barcodeSource = (fps, dur, { bits, cell } = BARCODE) =>
  `color=c=black:s=${bits * cell}x${cell}:r=${fps}:d=${dur},format=yuv420p,geq=lum='255*mod(floor(N/pow(2,floor(X/${cell}))),2)':cb=128:cr=128`;

// Decode 16 bytes (one averaged gray pixel per cell) into the frame number.
export const bitsToIndex = (px, off = 0, bits = BARCODE.bits) => { let n = 0; for (let i = 0; i < bits; i++) if (px[off + i] > 127) n |= 1 << i; return n; };

// Barcode of every decoded frame of `file` (ffmpeg decode, autorotate on, no frame duplication).
// Returns [{ i: decodedIndex, n: barcodeNumber }] in decode order; pass `x`,`y` if the strip is not at 0,0.
export function readBarcodes(file, { x = 0, y = 0, bits = BARCODE.bits, cell = BARCODE.cell, from, to, lowres = false } = {}) {
  const args = ['-v', 'error'];
  if (from !== undefined) args.push('-ss', String(from));
  args.push('-i', file);
  if (to !== undefined) args.push('-t', String(to - (from || 0)));
  args.push('-fps_mode', 'passthrough', '-vf', `crop=${bits * cell}:${cell}:${x}:${y},scale=${bits}:1:flags=area,format=gray`, '-f', 'rawvideo', '-');
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', args), chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', bad);
    p.on('close', (code) => {
      if (code !== 0) return bad(new Error(`ffmpeg barcode read failed on ${file}: ${err.slice(-300)}`));
      const buf = Buffer.concat(chunks), out = [];
      for (let i = 0; i + bits <= buf.length; i += bits) out.push({ i: i / bits, n: bitsToIndex(buf, i, bits) });
      ok(out);
    });
  });
}
