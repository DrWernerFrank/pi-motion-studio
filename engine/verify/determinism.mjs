// determinism: an edit renders identically twice (per-frame md5), 4 workers equal 1 worker, and the determinism
// gate passes on an edit film (footage seeks cannot leak state between frames).
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { run } from '../lib/proc.mjs';
import { cutEdit } from './_editslice.mjs';
import { renderFilm } from '../render.mjs';
import { gates } from '../gates.mjs';

const framemd5 = async (mp4, out) => { await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-map', '0:v', '-f', 'framemd5', out]); return readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('0,')).map((l) => l.split(',').at(-1)); };

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { film } = await cutEdit('verify-det', 'real-talking-head', { fps: 30, cuts: 8, cutLen: 60, gap: 40 });
  const [a] = await renderFilm(film.key, { quality: 'final', fmt: '16:9', workers: 1, log: () => {} });
  const [b] = await renderFilm(film.key, { quality: 'final', fmt: '16:9', workers: 4, log: () => {} });
  const ma = await framemd5(a.file, join(film.out, '.md5a')), mb = await framemd5(b.file, join(film.out, '.md5b'));
  const diff = ma.map((h, i) => (h === mb[i] ? null : i)).filter((x) => x !== null);
  need(ma.length === mb.length && diff.length === 0, `1 worker vs 4 workers: ${diff.length}/${ma.length} frames differ${diff.length ? ` (first ${diff[0]})` : ''}`);
  facts.push(`1 vs 4 workers: ${ma.length} frames identical`);
  const [c] = await renderFilm(film.key, { quality: 'final', fmt: '16:9', workers: 4, log: () => {} });
  const mc = await framemd5(c.file, join(film.out, '.md5c'));
  need(mc.join() === ma.join(), 'two runs of the same render differ');
  facts.push('repeat render: identical md5s');
  // the determinism gate (same pixels regardless of seek order) on an edit film with footage
  const g = await gates(film.key, { log: () => {}, write: false });
  const det = g.checks.find((x) => x.name === 'determinism');
  need(det?.pass, `determinism gate on an edit film: ${det?.detail}`);
  facts.push('determinism gate passes');
  writeFileSync('/dev/null', ''); // (keep imports honest)
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
