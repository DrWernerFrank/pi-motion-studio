// studio verify-edit: the contract for editing real footage (templates/prompts/real-video-editing.md §8).
// One row per check with its measured numbers; docs/editing/verify-last.json; exit 0 only if every
// required check passed. A check lives in engine/verify/<id>.mjs (default export: async (ctx) => { pass,
// measured, skip? }); a check without a file is "pending" and counts as red.
//   studio verify-edit [--quick] [--list] [--only a,b] [--clean]
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FILMS, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';

const OUT = join(ROOT, 'docs', 'editing');
export const VERIFY_CACHE = join(homedir(), '.cache', 'pi-motion-studio', 'verify');

// id, phase that delivers it, what must hold (short), slow = skipped by --quick (20-minute fixture, finals).
export const CHECKS = [
  ['env', 'P2', 'doctor resolves ffmpeg, ffprobe, node, ML python, ASR model, tracker model, Chromium H.264 decode'],
  ['regress-films', 'P0', 'the four motion films: gate verdicts and baseline frame hashes unchanged'],
  ['fixtures', 'P1', 'all fixtures generated + checksummed, plus a real open-licensed talking-head clip with its license'],
  ['ingest-probe', 'P2', 'media.json equals ffprobe truth; Windows/space/unicode paths; truncated file fails clearly'],
  ['ingest-conform', 'P2', 'CFR, upright, SDR bt709 tags, yuv420p; HLG luma within 6; cache hit < 2 s; relink by hash'],
  ['frame-exact', 'P3', '12 cuts on sync + vfr-rotated: 0 frames of error in preview and final'],
  ['av-sync', 'P3', 'beep vs flash <= 20 ms at start/middle/end, across 1.5x, and in the last 30 s of a 20-min timeline', true],
  ['rational-fps', 'P3', '30000/1001 and 24000/1001: exact frame count, A/V durations within 2 ms'],
  ['fidelity', 'P3', 'passthrough edit vs ffmpeg decode: PSNR >= 40 dB, SSIM >= 0.98'],
  ['parity', 'P3', 'live seek, draft and final agree on 10 frames per fixture (SSIM >= 0.95)'],
  ['determinism', 'P3', 'identical per-frame md5 across runs; 4 workers equal 1 worker; determinism gate passes'],
  ['edit-ops', 'P3', 'every op round-trips under undo; invalid ops rejected; stale baseRev conflicts; 500 random ops; EDL round-trip'],
  ['transcribe', 'P4', 'WER <= 15% on speech; monotonic words; >= 90% in speech; cache hit; offline'],
  ['transcript-edit', 'P4', 'word-range delete cuts within 30 ms; retimed transcript >= 90% within 150 ms'],
  ['cut-silence', 'P5', 'no pause beyond max + pad, no clipped word start, no word lost'],
  ['cut-cleanup', 'P5', 'ums removed, flub removed with last take kept, everything else kept, removed text listed'],
  ['cut-idle', 'P5', 'no frozen stretch beyond max; active stretches untouched; speed-up keeps audio locked'],
  ['seams', 'P5', 'no clicks at 20 cuts, micro-fade >= 5 ms, no black/frozen at seams, J/L offsets honored'],
  ['captions', 'P6', 'layout in en/fa/ar+en/long word at 4 formats; safe area, <= 2 lines, >= 3.2u, no tofu, SRT/VTT valid'],
  ['overlays', 'P6', 'title, lower third, callout, punch-in change pixels only in their region and window'],
  ['reframe', 'P7', 'subject inside crop >= 95% of frames; speed/jerk caps; resets on cuts'],
  ['formats', 'P7', '9:16, 1:1, 16:9, 4:5 from one edit: WxH, yuv420p, bt709, SAR 1:1, AAC 48k, faststart, duration', true],
  ['audio-chain', 'P8', '-14 +/- 1 LUFS, <= -1 dBTP, music >= 8 dB under speech, noise floor -6 dB on noisy'],
  ['color', 'P8', 'exposure/contrast/saturation/temperature move as expected; identity LUT PSNR >= 60'],
  ['segment-cache', 'P9', 'unchanged re-render < 10% of cold; one-clip change re-encodes only its segments', true],
  ['perf-budget', 'P9', 'ingest <= 0.5x, draft <= 1x, final <= 3x realtime; peak RSS <= 2.5 GB; temp dirs gone', true],
  ['gui-smoke', 'P10', 'Playwright on a spare port: editor flows, zero console errors, zero failed requests'],
  ['gui-security', 'P10', 'no token gives 403; traversal/absolute/dotfile/unknown id rejected on every new endpoint'],
  ['tools', 'P11', 'every edit_* tool registers with a valid schema and runs on a fixture; skill + agent front matter parse'],
  ['docs', 'P11', 'studio help lists every command; README, AGENTS.md, skill, critic agent exist; THIRD_PARTY.md complete'],
  ['golden-path', 'P11', 'studio autoedit on every preset, unattended; talking-head exports 4 formats; gate PASS', true],
  ['montage', 'P11', 'every cut within 1 frame of a beat; no clip twice; duration = target +/- 1 beat'],
  ['review', 'P13', 'demo reviews.json: >= 3 rounds, last by edit-critic, every score >= 8, sheets exist'],
].map(([id, phase, title, slow = false]) => ({ id, phase, title, slow }));

const gitHead = async () => {
  const h = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, allowFail: true });
  const d = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, allowFail: true });
  return `${h.out.trim() || 'none'}${d.out.trim() ? '+dirty' : ''}`;
};

// Temp films the checks create live under films/verify-*; they are always removed.
export function cleanTemp() {
  const gone = [];
  if (existsSync(FILMS)) for (const f of readdirSync(FILMS)) if (/^verify-[a-z0-9-]+$/.test(f)) { rmSync(join(FILMS, f), { recursive: true, force: true }); gone.push(`films/${f}`); }
  if (existsSync(VERIFY_CACHE)) { rmSync(VERIFY_CACHE, { recursive: true, force: true }); gone.push(VERIFY_CACHE.replace(homedir(), '~')); }
  return gone;
}

async function load(id) {
  const file = join(ROOT, 'engine', 'verify', `${id}.mjs`);
  return existsSync(file) ? (await import(pathToFileURL(file).href)).default : null;
}

const SYMBOL = { passed: 'PASS', failed: 'FAIL', pending: 'TODO', skipped: 'skip', error: 'ERR ' };

export async function verifyEdit({ quick = false, list = false, only, clean = false } = {}) {
  const last = readJson(join(OUT, 'verify-last.json'), { checks: {} });
  if (clean) { const gone = cleanTemp(); console.log(gone.length ? `removed ${gone.join(', ')}` : 'nothing to clean'); return { pass: true }; }
  if (list) {
    for (const c of CHECKS) console.log(`${c.id.padEnd(16)} ${c.phase.padEnd(4)} ${(last.checks?.[c.id]?.status || 'pending').padEnd(8)} ${c.slow ? '[slow] ' : ''}${c.title}`);
    return { pass: true };
  }
  const want = only ? String(only).split(',') : null;
  if (want) for (const w of want) if (!CHECKS.some((c) => c.id === w)) throw new Error(`unknown check "${w}": studio verify-edit --list`);
  const picked = CHECKS.filter((c) => !want || want.includes(c.id));
  const checks = {}, t0 = Date.now();
  try {
    for (const c of picked) {
      const t = Date.now(); let r;
      if (quick && c.slow) r = { status: 'skipped', reason: '--quick', measured: 'skipped by --quick' };
      else {
        try {
          const impl = await load(c.id);
          if (!impl) r = { status: 'pending', measured: `not implemented yet (due in ${c.phase})` };
          else {
            const x = await impl({ quick, root: ROOT, cache: VERIFY_CACHE });
            r = x.skip ? { status: 'skipped', reason: x.skip, measured: x.skip } : { status: x.pass ? 'passed' : 'failed', measured: x.measured ?? '' };
          }
        } catch (e) { r = { status: 'error', measured: String(e.message || e).split('\n').slice(0, 4).join(' | ') }; }
      }
      r.ms = Date.now() - t; checks[c.id] = r;
      console.log(`${SYMBOL[r.status]}  ${c.id.padEnd(16)} ${String(r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + 's' : r.ms + 'ms').padStart(7)}  ${r.measured}`);
    }
  } finally { cleanTemp(); }
  const ids = picked.map((c) => c.id);
  const of = (s) => ids.filter((id) => checks[id].status === s);
  // A skip is only honest for an environment cause; a --quick skip must never read as "done".
  const failed = [...of('failed'), ...of('error'), ...of('pending'), ...ids.filter((id) => checks[id].status === 'skipped' && checks[id].reason === '--quick')];
  const result = {
    at: new Date().toISOString(), gitHead: await gitHead(), quick, only: want, required: ids, passed: of('passed'), failed,
    skipped: of('skipped').map((id) => ({ id, reason: checks[id].reason })), pending: of('pending'),
    pass: failed.length === 0 && !want && !quick, checks,
  };
  // A partial run never overwrites the full verdict.
  writeJson(join(OUT, want ? 'verify-last-only.json' : 'verify-last.json'), result);
  console.log(`\n${result.passed.length}/${ids.length} passed, ${failed.length} not passing (${result.pending.length} pending), ${result.skipped.length} skipped  in ${((Date.now() - t0) / 1000).toFixed(0)}s  → docs/editing/${want ? 'verify-last-only' : 'verify-last'}.json`);
  console.log(result.pass ? 'verify-edit: PASS' : `verify-edit: ${want || quick ? 'partial run (cannot pass)' : 'FAIL'}`);
  return result;
}
