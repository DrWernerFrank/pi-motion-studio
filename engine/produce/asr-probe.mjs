// The language verifier's ASR leg: transcribe a final mix's first 30 s locally (faster-whisper,
// the same model the edit pipeline uses — cached by content hash). Never a hosted service.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pythonFor } from '../doctor.mjs';

const CACHE = join(homedir(), '.cache', 'pi-motion-studio', 'produce-asr');

const PY = `
import json, sys, warnings
warnings.filterwarnings("ignore")
from faster_whisper import WhisperModel
model = WhisperModel(sys.argv[2], device="cpu", compute_type="int8")
segs, info = model.transcribe(sys.argv[1], beam_size=5)
words = sum(len(s.words or []) for s in segs)
print("RESULT " + json.dumps({"language": info.language, "probability": round(float(info.language_probability), 2), "words": words}))
`;

/** ASR on the mix (the first 30 s): { language, probability, words }. Cached by (file sha, model). */
export async function transcribeMix(file, { model = 'small', seconds = 30 } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const { tmpFile } = await slice(file, seconds);
  const key = createHash('sha256').update(readFileSync(tmpFile)).digest('hex').slice(0, 16);
  const cacheFile = join(CACHE, `${key}-${model}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  const r = execFileSync(pythonFor('ml'), ['-c', PY, tmpFile, model], { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 32 << 20 });
  const out = JSON.parse((r || '').replace(/^.*RESULT /s, ''));
  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

async function slice(file, seconds) {   // -> { tmpFile } (a wav slice; content-hashable)
  const tmpFile = join(CACHE, `slice-${createHash('sha256').update(file + seconds).digest('hex').slice(0, 12)}.wav`);
  if (!existsSync(tmpFile)) execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', String(seconds), '-vn', '-ar', '16000', '-ac', '1', tmpFile], { timeout: 120000 });
  return { tmpFile };
}
