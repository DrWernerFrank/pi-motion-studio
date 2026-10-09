// The language verifier's ASR leg: transcribe a final mix's first 30 s locally (faster-whisper,
// the same model the edit pipeline uses — cached by content hash). Never a hosted service.
//
// Two environment facts this mirrors (both measured, both already worked around in engine/asr.py):
//  - the model lives in ~/.local/share/pi-motion-studio/models/whisper, NOT the default HF cache,
//    so download_root pins it there and HF_HUB_OFFLINE refuses any download attempt (zero network);
//  - the ml venv's PyAV is incompatible with faster-whisper's decode_audio (TypeError on
//    metadata_errors), so the slice is decoded with ffmpeg to 16 kHz mono f32 — as asr.py does.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pythonFor, whisperDir } from '../doctor.mjs';

const CACHE = join(homedir(), '.cache', 'pi-motion-studio', 'produce-asr');

const PY = `
import json, os, subprocess, sys, warnings
warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_OFFLINE", "1")   # the model is local; a download is never okay
import numpy as np
from faster_whisper import WhisperModel

def load_audio(path):   # ffmpeg, not PyAV (the venv's PyAV breaks faster-whisper's decode_audio)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

model = WhisperModel(sys.argv[2], device="cpu", compute_type="int8", download_root=sys.argv[3])
segs, info = model.transcribe(load_audio(sys.argv[1]), beam_size=5, word_timestamps=True)
segs = list(segs)
words = sum(len(s.words or []) for s in segs)
print("RESULT " + json.dumps({"language": info.language, "probability": round(float(info.language_probability), 2), "words": words}))
`;

/** ASR on the mix (the first 30 s): { language, probability, words }. Cached by (content, model). */
export async function transcribeMix(file, { model = 'small', seconds = 30 } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const { tmpFile } = await slice(file, seconds);
  const key = createHash('sha256').update(readFileSync(tmpFile)).digest('hex').slice(0, 16);
  const cacheFile = join(CACHE, `${key}-${model}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  const r = execFileSync(pythonFor('ml'), ['-c', PY, tmpFile, model, whisperDir()], { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 32 << 20 });
  const out = JSON.parse((r || '').replace(/^.*RESULT /s, ''));
  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

async function slice(file, seconds) {   // -> { tmpFile } (a wav slice; content-hashable)
  const tmpFile = join(CACHE, `slice-${createHash('sha256').update(file + seconds).digest('hex').slice(0, 12)}.wav`);
  if (!existsSync(tmpFile)) execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', String(seconds), '-vn', '-ar', '16000', '-ac', '1', tmpFile], { timeout: 120000 });
  return { tmpFile };
}
