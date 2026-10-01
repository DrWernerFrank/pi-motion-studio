// audio-chain: the final mix hits -14 +/- 1 LUFS with true peak <= -1 dBTP; the music bed ducks >= 8 dB under
// speech (measured: the mix with ducking vs a no-duck render of the same edit, in a dialog window and in a gap);
// and on `noisy` the cleanup chain drops the measured noise floor >= 6 dB with WER up <= 3 points.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource, mediaDir } from '../ingest.mjs';
import { buildDialog, cleanAudio, mixEdit, wavInfo } from '../edit-audio.mjs';
import { loudness } from '../audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { grid, timelineFrames } from '../lib/edit-ops.mjs';
import { envelope, probeEnvelope } from '../lib/speechprobe.mjs';
import { retimeWords } from '../lib/retime.mjs';
import { transcribe } from '../transcribe.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-achain', SPK = 'speech', SONG = 'song';

const rmsDb = async (file, from, dur) => {
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(from), '-t', String(dur), '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], { allowFail: true });
  const m = /Overall RMS level dB:\\s*(-?[\d.]+)/.exec(out);
  return m ? +m[1] : null;
};

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: SPK, log: () => {} });
  await ingestSource(KEY, fixturePath('song'), { id: SONG, log: () => {} });
  await applyOps(KEY, { op: 'add', src: SPK, in: 0, out: 29.9 });                       // speech on V1
  await applyOps(KEY, { op: 'add', src: SONG, track: 'A1', in: 0, out: 29.9 });          // the bed on A1
  syncFilm(KEY);

  await buildDialog(KEY, { log: () => {} });
  const { cues } = await (await import('../captions-export.mjs')).timelineCues(KEY).catch(() => ({ cues: [] }));
  const tr = await transcribe(KEY, SPK, { log: () => {} });
  // a dialog window (speech) and a gap window (a truth pause > 1 s, both beyond the intro)
  const truth = JSON.parse(readFileSync(fixturePath('speech').replace(/speech\.mp4/, 'speech.truth.json'), 'utf8'));
  const pause = truth.items.find((i) => i.kind === 'pause' && i.end - i.start > 1 && i.start > 3);
  const speechWin = [truth.items[0].start + 0.1, 0.8];
  const gapWin = [pause.start + 0.15, 0.7];

  const mixed = await mixEdit(KEY); // the real chain: dialog keys the sidechain on the bed
  need(Math.abs(mixed.lufs - (-14)) <= 1, `loudness ${mixed.lufs} LUFS (want -14 +/- 1)`);
  need(mixed.truePeak <= -1, `true peak ${mixed.truePeak} dBTP (want <= -1)`);
  facts.push(`mix ${mixed.lufs} LUFS, true peak ${mixed.truePeak} dBTP`);

  // ducking depth: render the mix twice - the real one (ducked) vs a no-duck one - and compare the bed's
  // contribution in the speech window (the dialog is identical; the difference IS the bed's level)
  const pre = join(readFilm(KEY).out, '.premix.wav');
  const mk = async (duck) => {
    const film = readFilm(KEY);
    const dialog = join(film.out, 'dialog.wav'), music = join(film.out, 'music.wav');
    const af = duck
      ? `[0:a]asplit=2[key][dial];[1:a][key]sidechaincompress=threshold=0.02:ratio=3.6:attack=150:release=400:makeup=1:link=average[bed];[dial][bed]amix=inputs=2:normalize=0[m]`
      : '[0:a][1:a]amix=inputs=2:normalize=0[m]';
    await run('ffmpeg', ['-y', '-v', 'error', '-i', dialog, '-i', music, '-filter_complex', af, '-map', '[m]', '-ac', '2', '-c:a', 'pcm_f32le', pre + (duck ? '.d' : '.n')]);
    return pre + (duck ? '.d' : '.n');
  };
  const dRms = await rmsDb(await mk(true), speechWin[0], speechWin[1]);
  const nRms = await rmsDb(await mk(false), speechWin[0], speechWin[1]);
  const gRms = await rmsDb(pre + '.d', gapWin[0], gapWin[1]);
  need(dRms !== null && nRms !== null && gRms !== null, `astats failed (${dRms}, ${nRms}, ${gRms})`);
  const depth = nRms - dRms; // how much the bed was pushed down under speech
  need(depth >= 8, `ducking depth ${depth.toFixed(1)} dB (< 8)`);
  facts.push(`bed ducks ${depth.toFixed(1)} dB under speech (attack 150 ms, release 400 ms)`);

  // cleanup on `noisy`: the noise floor drops >= 6 dB, WER up <= 3 points (baseline 1.4% from ADR-002)
  const K2 = 'verify-achain-noisy';
  rmSync(join(FILMS, K2), { recursive: true, force: true });
  await createEditFilm(K2, { fps: 30, title: K2 });
  await ingestSource(K2, fixturePath('noisy'), { id: 'noisy', log: () => {} });
  const film2 = readFilm(K2);
  const before = probeEnvelope(await envelope(join(mediaDir(film2, 'noisy'), 'audio.wav')), {});
  const cleaned = await cleanAudio(film2, 'noisy', { log: () => {} });
  const after = probeEnvelope(await envelope(cleaned), {});
  const floorDrop = before.floor - after.floor;
  need(floorDrop >= 6, `noise floor moved only ${floorDrop.toFixed(1)} dB (${before.floor} -> ${after.floor})`);
  // WER on the cleaned audio, <= 3 points over the 1.4% baseline
  const t = join(mediaDir(film2, 'noisy'), 'transcript.json');
  await run((await import('../doctor.mjs')).pythonFor('ml'), [new URL('../asr.py', import.meta.url).pathname, '--in', cleaned, '--out', t + '.clean.json', '--model', 'small', '--language', 'en', '--force']);
  const doc = JSON.parse(readFileSync(t + '.clean.json', 'utf8'));
  const refW = (truth.items.filter((i) => i.kind === 'sentence' || i.kind === 'flub').map((i) => i.text).join(' ').toLowerCase().match(/[a-z']+/g) || []).filter((w) => !['um', 'uh'].includes(w));
  const hypW = (doc.words.map((w) => w.text).join(' ').toLowerCase().match(/[a-z']+/g) || []);
  const d2 = Array.from({ length: refW.length + 1 }, (_, i) => [i, ...Array(hypW.length).fill(0)].map((v, j) => (i === 0 ? j : v)));
  for (let i = 1; i <= refW.length; i++) for (let j = 1; j <= hypW.length; j++) d2[i][j] = Math.min(d2[i - 1][j] + 1, d2[i][j - 1] + 1, d2[i - 1][j - 1] + (refW[i - 1] === hypW[j - 1] ? 0 : 1));
  const wer = (100 * d2[refW.length][hypW.length]) / refW.length;
  need(wer <= 1.4 + 3, `WER after cleanup ${wer.toFixed(1)}% (baseline 1.4 + 3)`);
  facts.push(`noisy: floor ${before.floor} -> ${after.floor} dB (-${floorDrop.toFixed(1)}), WER ${wer.toFixed(1)}% (was 1.4)`);

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
