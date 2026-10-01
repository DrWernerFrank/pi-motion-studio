// studio doctor: what the editing pipeline needs, probed for real. `--fix` repairs what is safe to repair
// in user space (directories now; ML venv, models and fonts arrive with the phases that need them).
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
export const DATA = join(homedir(), '.local', 'share', 'pi-motion-studio');

// Python resolution, in one place: STUDIO_PYTHON (audio analysis), STUDIO_ML_PYTHON (ASR, tracking), then the venvs.
export const pythonFor = (kind = 'audio') => {
  const env = process.env[kind === 'ml' ? 'STUDIO_ML_PYTHON' : 'STUDIO_PYTHON'];
  const ml = join(DATA, 'ml-venv', 'bin', 'python'), repo = join(ROOT, '.venv', 'bin', 'python');
  if (env && existsSync(env)) return env;
  if (kind === 'ml' && existsSync(ml)) return ml;
  return existsSync(repo) ? repo : 'python3';
};

const first = (s) => s.split('\n')[0].trim();
const probe = async (cmd, args) => { try { const r = await run(cmd, args, { allowFail: true }); return r.code === 0 ? (r.out || r.err) : null; } catch { return null; } };

// Filters the editing pipeline leans on (mission section 3).
const FILTERS = ['silencedetect', 'loudnorm', 'ebur128', 'xfade', 'acrossfade', 'sidechaincompress', 'afftdn', 'arnndn', 'atempo',
  'scdet', 'blackdetect', 'freezedetect', 'signalstats', 'psnr', 'ssim', 'zscale', 'tonemap', 'lut3d', 'overlay', 'subtitles', 'vidstabdetect'];

export async function doctor({ fix = false } = {}) {
  const items = [], add = (id, label, ok, detail, extra = {}) => items.push({ id, label, ok, detail, required: true, ...extra });
  const fixed = [];

  if (fix) for (const d of [CACHE, join(CACHE, 'logs'), DATA]) if (!existsSync(d)) { mkdirSync(d, { recursive: true }); fixed.push(`created ${d}`); }

  const major = Number(process.versions.node.split('.')[0]);
  add('node', 'node >= 20', major >= 20, process.version);

  const ff = await probe('ffmpeg', ['-hide_banner', '-version']), fp = await probe('ffprobe', ['-hide_banner', '-version']);
  add('ffmpeg', 'ffmpeg', !!ff, ff ? first(ff).replace(/ Copyright.*/, '') : 'not on PATH');
  add('ffprobe', 'ffprobe', !!fp, fp ? first(fp).replace(/ Copyright.*/, '') : 'not on PATH');
  if (ff) {
    const enc = (await probe('ffmpeg', ['-hide_banner', '-encoders'])) || '', fil = (await probe('ffmpeg', ['-hide_banner', '-filters'])) || '';
    const missingEnc = ['libx264', 'aac'].filter((e) => !new RegExp(`\\b${e}\\b`).test(enc));
    add('ffmpeg-encoders', 'libx264 + aac', missingEnc.length === 0, missingEnc.length ? `missing ${missingEnc.join(', ')}` : 'libx264, aac');
    const missingFil = FILTERS.filter((f) => !new RegExp(`\\s${f}\\s`).test(fil));
    add('ffmpeg-filters', `${FILTERS.length} editing filters`, missingFil.length === 0, missingFil.length ? `missing ${missingFil.join(', ')}` : 'all present', { required: missingFil.every((f) => f === 'arnndn' || f === 'vidstabdetect') ? false : true });
  }

  const py = pythonFor('audio'), pv = await probe(py, ['--version']);
  add('python', 'python (audio analysis)', !!pv, pv ? `${first(pv)}  ${py}` : `no interpreter (${py})`);
  const librosa = pv && await probe(py, ['-c', 'import librosa,numpy,scipy,soundfile;print("librosa",librosa.__version__)']);
  add('python-audio', 'librosa/numpy/scipy/soundfile', !!librosa, librosa ? first(librosa) : 'missing: run ./setup.sh');

  // ASR and tracker live in the ML venv (Python 3.12 via uv). Red until spike S2/S3 install them.
  const mlPy = pythonFor('ml'), mlv = await probe(mlPy, ['--version']);
  const asr = mlv && await probe(mlPy, ['-c', 'import faster_whisper;print("faster-whisper",faster_whisper.__version__)']);
  add('asr', 'ASR (faster-whisper)', !!asr, asr ? first(asr) : `not installed (ML python: ${mlPy}); spike S2 sets this up`);
  const tracker = mlv && await probe(mlPy, ['-c', 'import cv2;print("opencv",cv2.__version__)']);
  add('tracker', 'subject tracker (OpenCV)', !!tracker, tracker ? first(tracker) : 'not installed; spike S3 sets this up');

  // Chromium decode: canPlayType is a hint, not proof. The measured decode + seek test is spike S1.
  let hint = null;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch(), p = await b.newPage();
    hint = await p.evaluate(() => { const v = document.createElement('video'); return { h264: v.canPlayType('video/mp4; codecs="avc1.640028"'), aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"') }; });
    add('chromium', 'Chromium H.264/AAC (hint)', hint.h264 !== '' && hint.aac !== '', `${await b.version()}  canPlayType h264="${hint.h264}" aac="${hint.aac}"  (decode + seek accuracy proven by S1)`);
    await b.close();
  } catch (e) { add('chromium', 'Chromium H.264/AAC (hint)', false, `playwright chromium failed: ${String(e.message).split('\n')[0]}`); }

  const gpu = await probe('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  add('gpu', 'GPU (optional)', true, gpu ? first(gpu) : 'none (CPU int8 path)', { required: false });
  const dirs = [CACHE, DATA].map((d) => `${d.replace(homedir(), '~')} ${existsSync(d) ? 'ok' : 'missing'}`);
  add('dirs', 'cache + data dirs', existsSync(CACHE) && existsSync(DATA), dirs.join(', '), { fixable: true });

  return { ok: items.filter((i) => i.required).every((i) => i.ok), items, fixed };
}

export function printDoctor(r) {
  for (const i of r.items) console.log(`${i.ok ? 'ok  ' : i.required ? 'FAIL' : 'warn'}  ${i.label.padEnd(34)} ${i.detail}`);
  for (const f of r.fixed) console.log(`fixed ${f}`);
  console.log(r.ok ? '\ndoctor: ready' : '\ndoctor: not ready (red items above; `studio doctor --fix` repairs what it can in user space)');
}
