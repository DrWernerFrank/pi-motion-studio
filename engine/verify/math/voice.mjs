// voice (P5): the narration pipeline end to end on a fixture film with a real 8-sentence script (~128
// words of math narration, bookmarks, the starter's lexicon). Every clause of the mission row, measured:
//  1 byte-identical audio for the same text (one sentence force-voiced twice, md5 of the wavs)
//  2 timing.json offsets == the concatenated sample offsets (+/- 1 sample, integer sample math)
//  3 lexicon + normalizer apply (voice.py --dry: x^2, λ, ≤, π, det(A), ∫, a fraction; Euler/Cauchy/eigenvector)
//  4 ASR round trip WER <= 10% (digits <-> number words normalized on BOTH sides, ADR-003)
//  5 sentence loudness within 1.5 LU, sample peak <= -1 dBFS, 4 ms fades at every edge (no clicks at joins)
//  6 an unchanged script re-voices nothing; one edited sentence re-voices exactly one (cache entries counted)
//  7 offline: no network call exists in the code path (static scan) and the ASR runs with the hub offline
//  8 the Persian voice (lang fa, no explicit voice) speaks a Persian sentence
//  9 a human narration.wav (the sentences concatenated: ground truth known) aligns: every sentence start
//    within 150 ms of the truth
// plus the mix bus: buildMix lands on mix.lufs (+/- 1) with true peak <= -1 dBTP.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMathFilm } from '../../math-cli.mjs';
import * as N from '../../narration.mjs';
import { loudness } from '../../audio.mjs';
import { runCapped } from '../../lib/capped.mjs';
import { pythonFor } from '../../doctor.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';

const KEY = 'verify-m-voice', FA = 'verify-m-voice-fa';
const VOICE_PY = join(ROOT, 'engine', 'manim', 'voice.py');

export const SCRIPT = `# Voice fixture

# scene s01_hook: the question
[s01.1] What does a determinant actually do? {shows}Watch the unit square{applies} as a matrix acts on the plane.

# scene s02_meaning: the formula
[s02.1] For a two by two matrix, the determinant is ad minus bc.
[s02.2] Here: three times two, minus one times one. {lands}Five.
[s02.3] If we swap the two columns, the determinant becomes one minus six, which is minus five, so the plane {flips}flips its orientation.
[s02.4] The eigenvalues satisfy lambda squared minus five lambda plus six equals zero, so lambda is two or three.

# scene s03_recap: the takeaway
[s03.1] A determinant is the area scale factor. Five means five times the area.
[s03.2] Each eigenvector keeps its direction and is only stretched by its eigenvalue.
[s03.3] The sum of the first n odd numbers is exactly n squared, and you can see it by wrapping L shapes around a growing square.
`;
const FA_SCRIPT = `# scene s01_hook: پرسش
[s01.1] دترمینان نشان می‌دهد که مساحت یک مربع چند برابر می‌شود.
`;

const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const dry = async (text, lexicon) => {
  const r = await runCapped(pythonFor('ml'), [VOICE_PY, '--dry', '--text', text, ...(lexicon ? ['--lexicon', lexicon] : [])],
    { memoryMb: 1024, timeoutS: 120, label: 'voice --dry' });
  return JSON.parse(r.out.trim());
};

export default async () => {
  const bad = [], facts = [];
  const dir = join(FILMS, KEY), fadir = join(FILMS, FA);
  for (const d of [dir, fadir]) rmSync(d, { recursive: true, force: true });
  createMathFilm(KEY, { title: 'voice fixture' });
  writeFileSync(join(dir, 'script.md'), SCRIPT);
  try {
    // -- 3. lexicon + normalizer (no synthesis) --------------------------------------------------
    const starterLex = join(dir, 'lexicon.json');
    const d1 = await dry('The determinant of x^2 is 5, and λ ≤ π', starterLex);
    for (const want of ['duh-TUR-muh-nuhnt', 'squared', ' lambda', ' at most', ' pi']) if (!d1.text_normalized.includes(want)) bad.push(`normalizer/lexicon: "${want}" missing from ${JSON.stringify(d1.text_normalized)}`);
    const fxLex = join(dir, 'lexicon-fixture.json');
    writeJson(fxLex, { ...readJson(starterLex), Euler: 'OY-ler', Cauchy: 'koh-SHEE' });
    const d2 = await dry('Euler and Cauchy knew each eigenvector; det(A) = ∫ x dx over 1/2 of a 2x2 grid', fxLex);
    for (const want of ['OY-ler', 'koh-SHEE', 'EYE-gen-veck-tor', 'the duh-TUR-muh-nuhnt of A', 'equals', 'the integral of', 'one half', 'two by two']) if (!d2.text_normalized.includes(want)) bad.push(`normalizer/lexicon: "${want}" missing from ${JSON.stringify(d2.text_normalized)}`);
    // the synthesizer gets the respellings lower-cased (espeak spells an upper-case syllable letter by letter)
    if (!d2.synth_text.includes('oy-ler') || d2.synth_text.includes('OY-ler')) bad.push(`espeak-safe respelling: ${d2.synth_text}`);
    facts.push(`3 lexicon+normalizer: "${d1.text_normalized}" | "${d2.text_normalized}"`);

    // -- full voice ------------------------------------------------------------------------------
    const t0 = Date.now();
    const timing = await N.buildVoice(KEY);
    const sr = timing.sample_rate, S = timing.sentences;
    facts.push(`voiced ${S.length} sentences (${timing.voiced.length} new) in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${timing.duration.toFixed(2)} s of narration, timing=${timing.timing}`);
    if (timing.timing !== 'native') bad.push(`word timings are ${timing.timing}, wanted native (ADR-003)`);

    // -- 1. determinism ----------------------------------------------------------------------------
    const pick = S.find((s) => s.id === 's02.2');
    await N.buildVoice(KEY, { only: 's02.2' });
    const a = md5(pick.audio), aw = md5(join(pick.audio, '..', 'words.json'));
    await N.buildVoice(KEY, { only: 's02.2' });
    const b = md5(pick.audio), bw = md5(join(pick.audio, '..', 'words.json'));
    if (a !== b || aw !== bw) bad.push(`determinism: two fresh syntheses of s02.2 differ (${a} vs ${b})`);
    else facts.push(`1 byte-identical: s02.2 voiced twice from scratch, wav md5 ${a.slice(0, 12)} both times`);

    // -- 2. offsets, sample-exact ------------------------------------------------------------------
    let cum = 0, worst = 0;
    for (const [i, s] of S.entries()) {
      const { sr: r, pcm } = N.readWav16(s.audio);
      if (r !== sr) bad.push(`${s.id}: wav at ${r} Hz, timing says ${sr}`);
      if (pcm.length !== s.samples) bad.push(`${s.id}: wav has ${pcm.length} samples, timing says ${s.samples}`);
      if (i > 0) cum += timing.gap_samples;
      if (s.start_sample !== cum) bad.push(`${s.id}: start_sample ${s.start_sample} != concatenated offset ${cum}`);
      worst = Math.max(worst, Math.abs(s.start * sr - cum), Math.abs(s.end * sr - (cum + pcm.length)));
      cum += pcm.length;
      for (const w of s.words) if (w.start < s.start - 1e-6 || w.end > s.end + 1e-4 || w.end < w.start) bad.push(`${s.id}: word ${w.w} [${w.start}, ${w.end}] outside the sentence`);
      for (const bm of s.bookmarks) if (!s.words.some((w) => w.start === bm.t) && bm.t !== s.end) bad.push(`${s.id}: bookmark ${bm.id} t=${bm.t} is not a word start`);
    }
    if (worst > 1) bad.push(`offsets: seconds vs samples differ by ${worst.toFixed(3)} samples (> 1)`);
    if (timing.gap_samples !== Math.round(N.GAP_S * sr)) bad.push(`gap ${timing.gap_samples} samples != round(${N.GAP_S} * ${sr})`);
    const shows = S[0].bookmarks.find((x) => x.id === 'shows'), applies = S[0].bookmarks.find((x) => x.id === 'applies');
    if (shows?.word !== 'Watch' || applies?.word !== 'as') bad.push(`bookmarks point at ${shows?.word}/${applies?.word}, wanted Watch/as`);
    facts.push(`2 offsets: ${S.length} starts == sum(samples + ${timing.gap_samples}-sample gaps) exactly, seconds within ${worst.toFixed(3)} samples; {applies} -> "as" at ${applies?.t}s`);

    // -- 5. level, peaks, fades ----------------------------------------------------------------------
    const louds = [];
    let pk = 0, fadeBad = [];
    const f = Math.round(0.004 * sr);
    for (const s of S) {
      louds.push((await loudness(s.audio)).lufs);
      const { pcm } = N.readWav16(s.audio);
      let m = 0; for (let i = 0; i < pcm.length; i++) m = Math.max(m, Math.abs(pcm[i]));
      pk = Math.max(pk, m);
      // a linear ramp: |x[i]| <= peak * i/(f-1) (+1 LSB) over the first and last f samples, and both ends at 0
      for (let i = 0; i < f; i++) {
        const lim = m * i / (f - 1) + 1;
        if (Math.abs(pcm[i]) > lim || Math.abs(pcm[pcm.length - 1 - i]) > lim) { fadeBad.push(s.id); break; }
      }
      if (pcm[0] !== 0 || pcm[pcm.length - 1] !== 0) fadeBad.push(`${s.id}(edge sample != 0)`);
    }
    const spread = Math.max(...louds) - Math.min(...louds), peakDb = 20 * Math.log10(pk / 32768);
    if (louds.some((x) => x === null)) bad.push(`loudness unmeasured: ${louds}`);
    if (spread > 1.5) bad.push(`sentence loudness spread ${spread.toFixed(2)} LU > 1.5 (${louds.join(', ')})`);
    if (peakDb > -1) bad.push(`sentence peak ${peakDb.toFixed(2)} dBFS > -1`);
    if (fadeBad.length) bad.push(`no 4 ms fade at an edge: ${fadeBad.join(', ')}`);
    facts.push(`5 loudness ${Math.min(...louds)}..${Math.max(...louds)} LUFS (spread ${spread.toFixed(2)} LU), peak ${peakDb.toFixed(2)} dBFS, ${f}-sample fades at all ${S.length * 2} edges`);

    // -- the mix bus ---------------------------------------------------------------------------------
    const mix = await N.buildMix(KEY);
    const target = readJson(join(dir, 'film.json')).mix?.lufs ?? -16;
    if (mix.lufs === null || Math.abs(mix.lufs - target) > 1 || mix.truePeak > -1) bad.push(`mix: ${mix.lufs} LUFS / ${mix.truePeak} dBTP (target ${target} +/- 1, TP <= -1)`);
    facts.push(`mix ${mix.lufs} LUFS (target ${target}), TP ${mix.truePeak} dBTP, ${mix.duration}s`);

    // -- 6. re-voice only what changed ----------------------------------------------------------------
    const before = new Set(N.voiceCacheEntries());
    const again = await N.buildVoice(KEY);
    const same = new Set(N.voiceCacheEntries());
    if (again.voiced.length || same.size !== before.size) bad.push(`unchanged script re-voiced ${again.voiced.join(',') || '0'} (cache ${before.size} -> ${same.size})`);
    const EDIT = 'For a two by two matrix, its determinant is ad minus bc.';
    // the edited sentence's entry may survive from an earlier run (the cache is content-addressed): drop it first
    const [ek] = await N.voiceKeys(KEY, [{ id: 's02.1', spoken: EDIT }]);
    rmSync(ek.dir, { recursive: true, force: true });
    const mid = new Set(N.voiceCacheEntries());
    writeFileSync(join(dir, 'script.md'), SCRIPT.replace('For a two by two matrix, the determinant is ad minus bc.', EDIT));
    const edited = await N.buildVoice(KEY);
    const after = N.voiceCacheEntries().filter((e) => !mid.has(e));
    if (edited.voiced.join(',') !== 's02.1' || after.length !== 1) bad.push(`one edited sentence re-voiced [${edited.voiced}] with ${after.length} new cache entries (wanted [s02.1], 1)`);
    else facts.push('6 unchanged: 0 re-voiced, 0 new cache entries; one sentence edited: exactly s02.1 re-voiced, 1 new entry');
    writeFileSync(join(dir, 'script.md'), SCRIPT);
    const truth = await N.buildVoice(KEY); // back to the fixture (all cached)

    // -- 9 + 4. a human narration.wav (concatenated sentences, truth known) + the WER round trip --------
    const bus = new Int16Array(Math.round(truth.duration * sr));
    for (const s of truth.sentences) bus.set(N.readWav16(s.audio).pcm, s.start_sample);
    const narr = join(dir, 'out', 'narration.wav');
    N.writeWav16(narr, bus, sr);
    const t1 = Date.now();
    const al = await N.alignNarration(KEY, narr);
    const errs = truth.sentences.map((s, i) => Math.abs(al.sentences[i].start - s.start));
    const worstAl = Math.max(...errs);
    if (worstAl > 0.15) bad.push(`narration align: a sentence start is ${(worstAl * 1000).toFixed(0)} ms off (> 150): ${errs.map((e) => (e * 1000).toFixed(0)).join(', ')} ms`);
    if (al.sentences.map((s) => s.id).join() !== truth.sentences.map((s) => s.id).join()) bad.push('narration align: sentence ids differ');
    const bmErr = truth.sentences.flatMap((s, i) => s.bookmarks.map((bm, k) => Math.abs(al.sentences[i].bookmarks[k].t - bm.t)));
    facts.push(`9 narration.wav aligned in ${((Date.now() - t1) / 1000).toFixed(1)} s: sentence starts within ${(worstAl * 1000).toFixed(0)} ms of truth (${(al.matched * 100).toFixed(1)}% words matched; bookmarks within ${(Math.max(...bmErr) * 1000).toFixed(0)} ms, informational)`);
    const tr = readJson(join(dir, 'out', 'narration.transcript.json'));
    const w = N.wer(truth.sentences.map((s) => s.spoken).join(' '), tr.words.map((x) => x.text).join(' '));
    if (w.wer > 0.10) bad.push(`WER ${(w.wer * 100).toFixed(1)}% > 10% (${w.errors}/${w.ref})`);
    facts.push(`4 WER ${(w.wer * 100).toFixed(1)}% (${w.errors} errors / ${w.ref} words, digits<->words normalized both sides; ASR lang ${tr.language})`);

    // -- 7. offline ---------------------------------------------------------------------------------
    const files = ['engine/narration.mjs', 'engine/manim/voice.py', 'engine/manim/studio_manim/script.py', 'engine/asr.py'];
    const net = /\bhttps?:\/\/|\bfetch\s*\(|\baxios\b|\burllib\b|\brequests\b|\bsocket\b|huggingface_hub\.(hf_hub_download|snapshot_download)/;
    const hits = files.flatMap((f) => readFileSync(join(ROOT, f), 'utf8').split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => net.test(l)));
    if (hits.length) bad.push(`network references: ${hits.map(([f, n]) => `${f}:${n}`).join(', ')}`);
    if (!/HF_HUB_OFFLINE: '1'/.test(readFileSync(join(ROOT, 'engine/narration.mjs'), 'utf8'))) bad.push('narration.mjs does not force HF_HUB_OFFLINE for its python calls');
    if (!hits.length) facts.push(`7 offline: no network reference in ${files.length} files of the path; python runs with HF_HUB_OFFLINE=1`);

    // -- 8. the Persian voice -------------------------------------------------------------------------
    createMathFilm(FA, { title: 'fa voice fixture', lang: 'fa' });
    const fcfg = readJson(join(fadir, 'film.json'));
    delete fcfg.voice; // lang fa without an explicit voice -> fa_IR-amir-medium
    writeJson(join(fadir, 'film.json'), fcfg);
    rmSync(join(fadir, 'scenes'), { recursive: true, force: true });
    writeFileSync(join(fadir, 'script.md'), FA_SCRIPT);
    const ft = await N.buildVoice(FA);
    const fs0 = ft.sentences[0], fdur = fs0.samples / ft.sample_rate;
    if (ft.voice !== 'piper:fa_IR-amir-medium') bad.push(`fa voice resolved to ${ft.voice}`);
    if (!(fdur >= 1 && fdur <= 15) || !fs0.words.length || !existsSync(fs0.audio)) bad.push(`fa: ${fdur.toFixed(2)} s, ${fs0.words.length} words`);
    let fpk = 0; for (const x of N.readWav16(fs0.audio).pcm) fpk = Math.max(fpk, Math.abs(x));
    if (fpk < 1000) bad.push(`fa audio is (near) silent: peak ${fpk}`);
    facts.push(`8 fa: ${ft.voice}, ${fdur.toFixed(2)} s, ${fs0.words.length} words (${fs0.timing}), "${fs0.words.map((x) => x.w).join(' ')}"`);
  } finally {
    for (const d of [dir, fadir]) rmSync(d, { recursive: true, force: true });
  }
  return { pass: bad.length === 0, measured: bad.length ? `${bad.join('; ')} || ${facts.join('; ')}` : facts.join('; ') };
};
