// studio doctor: what the editing pipeline needs, probed for real. `--fix` repairs what is safe to repair
// in user space (directories now; ML venv, models and fonts arrive with the phases that need them).
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

export const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
export const DATA = join(homedir(), '.local', 'share', 'pi-motion-studio');
export const MODELS = join(DATA, 'models');
export const whisperDir = () => join(MODELS, 'whisper');
export const yunetModel = () => join(MODELS, 'opencv', 'yunet.onnx');

// Python resolution, in one place: STUDIO_PYTHON (audio analysis), STUDIO_ML_PYTHON (ASR, tracking),
// STUDIO_MANIM_PYTHON (math films), then the venvs.
export const pythonFor = (kind = 'audio') => {
  const env = process.env[kind === 'ml' ? 'STUDIO_ML_PYTHON' : kind === 'manim' ? 'STUDIO_MANIM_PYTHON' : 'STUDIO_PYTHON'];
  const ml = join(DATA, 'ml-venv', 'bin', 'python'), manim = join(DATA, 'manim-venv', 'bin', 'python'), repo = join(ROOT, '.venv', 'bin', 'python');
  if (env && existsSync(env)) return env;
  if (kind === 'ml' && existsSync(ml)) return ml;
  if (kind === 'manim' && existsSync(manim)) return manim;
  return existsSync(repo) ? repo : 'python3';
};

export const manimVenv = () => join(DATA, 'manim-venv');
export const piperVoices = () => join(MODELS, 'piper');

const first = (s) => s.split('\n')[0].trim();
const probe = async (cmd, args, opts = {}) => { try { const r = await run(cmd, args, { allowFail: true, ...opts }); return r.code === 0 ? (r.out || r.err) : null; } catch { return null; } };

// Filters the editing pipeline leans on (mission section 3).
const FILTERS = ['silencedetect', 'loudnorm', 'ebur128', 'xfade', 'acrossfade', 'sidechaincompress', 'afftdn', 'arnndn', 'atempo',
  'scdet', 'blackdetect', 'freezedetect', 'signalstats', 'psnr', 'ssim', 'zscale', 'tonemap', 'lut3d', 'overlay', 'subtitles', 'vidstabdetect'];

export async function doctor({ fix = false, math = false } = {}) {
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
  const hasWhisperModel = existsSync(whisperDir()) && readdirSync(whisperDir()).some((f) => /faster-whisper-small/.test(f));
  add('asr', 'ASR (faster-whisper + small model)', !!asr && hasWhisperModel, asr ? `${first(asr)}, model small ${hasWhisperModel ? 'cached' : 'MISSING (run the first transcription online once)'}` : `not installed (ML python: ${mlPy}); see docs/editing/ADR-002-asr.md`);
  const tracker = mlv && await probe(mlPy, ['-c', 'import cv2;print("opencv",cv2.__version__)']);
  add('tracker', 'subject tracker (OpenCV + YuNet)', !!tracker && existsSync(yunetModel()), tracker ? `${first(tracker)}, yunet.onnx ${existsSync(yunetModel()) ? 'present' : 'MISSING'}` : 'not installed; see docs/editing/ADR-003-tracking.md');

  // Chromium decode: canPlayType is only a hint, so also decode a tiny generated H.264 clip (data URL), seek it and read a pixel back.
  try {
    const clip = join(CACHE, 'doctor-probe.mp4');
    if (ff && !existsSync(clip)) { mkdirSync(CACHE, { recursive: true }); await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '5', '-bf', '0', '-an', clip]); }
    const { chromium } = await import('playwright');
    const b = await chromium.launch(), p = await b.newPage();
    const url = `data:video/mp4;base64,${readFileSync(clip).toString('base64')}`;
    const r = await p.evaluate(async (src) => {
      const v = document.createElement('video'); v.muted = true; v.src = src;
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('decode error')); setTimeout(() => bad(new Error('timeout')), 8000); });
      v.currentTime = 0.5; await new Promise((ok) => { v.onseeked = ok; });
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return { w: v.videoWidth, h: v.videoHeight, d: v.duration, mean: sum / (d.length / 4) / 3, h264: v.canPlayType('video/mp4; codecs="avc1.640028"'), aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"') };
    }, url);
    add('chromium', 'Chromium H.264 decode + seek', r.w === 128 && r.h === 72 && r.mean > 5, `${await b.version()}  decoded ${r.w}x${r.h} ${r.d.toFixed(1)}s, seek+draw mean luma ${r.mean.toFixed(0)}; canPlayType h264="${r.h264}" aac="${r.aac}"`);
    await b.close();
  } catch (e) { add('chromium', 'Chromium H.264 decode + seek', false, `failed: ${String(e.message).split('\n')[0]}`); }

  const gpu = await probe('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  add('gpu', 'GPU (optional)', true, gpu ? first(gpu) : 'none (CPU int8 path)', { required: false });
  const dirs = [CACHE, DATA].map((d) => `${d.replace(homedir(), '~')} ${existsSync(d) ? 'ok' : 'missing'}`);
  add('dirs', 'cache + data dirs', existsSync(CACHE) && existsSync(DATA), dirs.join(', '), { fixable: true });

  // Math-film probes (docs/math/ADR-001..004). Added ONLY when {math} is set, so the editing
  // pipeline's `studio doctor` (and verify-edit's env check) never pays for — or is gated by — them.
  // pythonFor('manim') is the exception: it resolves harmlessly for everyone.
  if (math) {
    let locked = null; try { locked = /^manim==([0-9.]+)$/m.exec(readFileSync(join(ROOT, 'engine', 'manim', 'requirements.lock'), 'utf8'))?.[1]; } catch { /* no lock file */ }
    const mp = pythonFor('manim'), mv = await probe(mp, ['--version']);
    const manim = mv && await probe(mp, ['-c', 'import manim; print("manim", manim.__version__)']);
    add('manim', `Manim ${locked ? '== ' + locked : '(no requirements.lock pin!)'}`, !!manim && (!locked || first(manim) === `manim ${locked}`), manim ? `${first(manim)}  ${mp}` : `not importable (${mp}); see docs/math/ADR-001-toolchain.md`);
    const cairo = mv && await probe(mp, ['-c', 'import cairo, manimpango; print("pycairo", cairo.version, "+ manimpango", manimpango.__version__)']);
    add('cairo-pango', 'pycairo + manimpango (built wheels)', !!cairo, cairo ? first(cairo) : 'not installed; rebuild via docs/math/ADR-001-toolchain.md');
    const sympy = mv && await probe(mp, ['-c', 'import sympy; print("sympy", sympy.__version__)']);
    add('sympy', 'sympy (claims)', !!sympy, sympy ? first(sympy) : `missing: install into ${manimVenv().replace(homedir(), '~')}`);
    // a probe formula through the default backend -> SVG (ADR-002). Manim logs to stderr: match the
    // probe's own marker line, not the first line of stdout.
    const typeset = mv && await probe(mp, ['-c', 'import warnings; warnings.filterwarnings("ignore")\nfrom manim import logger\nlogger.disabled = True\nfrom manim import MathTypst\nm = MathTypst("det mat(3, 1; 1, 2) = 5", font_size=48)\nprint("PROBE svg", len(m.submobjects) > 0 and m.width > 0, round(float(m.width), 2))'], { cwd: CACHE });
    add('typeset', 'typesetting backend (Typst)', !!typeset && /PROBE svg True/.test(typeset), (typeset ? [...typeset.matchAll(/PROBE svg.*/g)].map((m) => m[0])[0] : null) || 'MathTypst compile failed (ADR-002)');
    // the bundled studio fonts as Pango sees them (register_font works headless — measured in S1)
    const fonts = mv && await probe(mp, ['-c', 'import warnings; warnings.filterwarnings("ignore")\nimport os\nfrom manim import logger\nlogger.disabled = True\nfrom manim import Text, register_font\nwith register_font(os.path.abspath("engine/fonts/Inter.ttf")):\n    t = Text("Handgloves 0123", font="Inter", font_size=48)\n    print("PROBE pango", round(float(t.width), 2))'], { cwd: ROOT });
    add('fonts', 'bundled fonts via Pango', !!fonts && /PROBE pango [0-9]/.test(fonts), (fonts ? [...fonts.matchAll(/PROBE pango.*/g)].map((m) => m[0])[0] : null) || 'Pango cannot load engine/fonts (register_font)');
    // a TTS voice that actually speaks (ADR-003: piper in the ML venv) + the fa voice present
    const vp = pythonFor('ml'), vv = await probe(vp, ['--version']);
    const enVoice = join(piperVoices(), 'en_US-ljspeech-medium.onnx'), faVoice = join(piperVoices(), 'fa_IR-amir-medium.onnx');
    const PY = 'import warnings; warnings.filterwarnings("ignore")\nfrom piper import PiperVoice, SynthesisConfig\nv = PiperVoice.load(%j, include_alignments=True)\nch = [c for c in v.synthesize("five", syn_config=SynthesisConfig(noise_scale=0.0, noise_w_scale=0.0)) if len(c.audio_float_array) > 0]\nprint("PROBE speaks", len(ch[0].audio_float_array) if ch else 0)';
    const speaks = vv && await probe(vp, ['-c', PY.replace('%j', JSON.stringify(enVoice))]);
    add('voice', 'a TTS voice speaks (piper)', !!speaks && /PROBE speaks [1-9]/.test(speaks), (speaks ? [...speaks.matchAll(/PROBE speaks.*/g)].map((m) => m[0])[0] : null) || 'piper failed or missing voice model (ADR-003)');
    add('voice-fa', 'the Persian voice (piper)', existsSync(faVoice), faVoice ? faVoice.replace(homedir(), '~') : `missing: ${faVoice.replace(homedir(), '~')} (language fa films need it)`, { required: false });
    const kokoro = join(MODELS, 'kokoro', 'kokoro-v1.0.onnx');
    add('kokoro', 'kokoro (optional fallback voice)', existsSync(kokoro), kokoro ? kokoro.replace(homedir(), '~') : 'not installed (optional — ADR-003)', { required: false });
  }

  return { ok: items.filter((i) => i.required).every((i) => i.ok), items, fixed };
}

export function printDoctor(r) {
  for (const i of r.items) console.log(`${i.ok ? 'ok  ' : i.required ? 'FAIL' : 'warn'}  ${i.label.padEnd(34)} ${i.detail}`);
  for (const f of r.fixed) console.log(`fixed ${f}`);
  console.log(r.ok ? '\ndoctor: ready' : '\ndoctor: not ready (red items above; `studio doctor --fix` repairs what it can in user space)');
}
