// ledger (P2): the requirements ledger's own contract, measured. Each of the 10 verifiers passes
// seeded good media (the measured number in the evidence) and fails seeded bad media (a message
// naming the measured value); a measurable requirement without a known verifier fails readLedger
// loudly; a subjective one without critic evidence cannot pass (with a full round it can); a
// waiver by anyone but the human is refused; brief-lint flags every number/format/language/named
// asset of 10 seeded requests that is not mapped — and nothing once they are.
//
// Seed media is built with ffmpeg into ~/.cache/pi-motion-studio/scratch/w1-ledger (deterministic,
// stamped by the fixture hashes, rebuilt only when stale) and the seeded project film
// films/verify-p-ledger (+ its child) is created here and removed in the finally — on failure too.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, writeJson } from '../../lib/film.mjs';
import { VERIFIERS, readLedger, runLedger, verifySubjective, waive } from '../../produce/ledger.mjs';
import { verifyRequirement, VERIFIER_NAMES } from '../../produce/verify-lib.mjs';
import { extract, lint } from '../../produce/brief-lint.mjs';
import { RUBRIC } from '../../review.mjs';

const KEY = 'verify-p-ledger', CHILD = 'verify-p-ledger-s01';
const DIR = join(FILMS, KEY), OUT = join(DIR, 'out');
const CACHE = join(homedir(), '.cache', 'pi-motion-studio');
const MEDIA = join(CACHE, 'scratch', 'w1-ledger', 'media');
const FIX = join(CACHE, 'fixtures');
const EN = join(FIX, 'speech.wav'), FA = join(FIX, 'speech-fa.wav');

const sh = (cmd, args, { timeout = 300000 } = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}: ${(r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' | ')}`);
  return r;
};
const ffmpeg = (args, opts) => sh('ffmpeg', ['-y', '-v', 'error', ...args], opts);
const shaFile = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const src2 = (size, dur) => `testsrc2=size=${size}:rate=25:duration=${dur}`;
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];

/** Two-pass loudnorm to the target (measure, then apply + limiter) — the studio's own mix recipe
 *  (engine/audio.mjs): a single dynamic pass lands ~1 LUFS low when the true-peak binds. */
const loudnormTo = (src, seconds, I, TP) => {
  const r = sh('ffmpeg', ['-hide_banner', '-nostats', '-t', String(seconds), '-i', src, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-'], { timeout: 180000 });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr || '');
  if (!m) throw new Error(`loudnorm reported nothing while measuring ${src}`);
  const j = JSON.parse(m[0]);
  return `loudnorm=I=${I}:TP=${TP}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000,alimiter=limit=0.79:level=false:attack=1:release=40`;
};

export default async () => {
  const bad = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  if (!existsSync(EN)) return { pass: false, measured: `the speech fixture is missing (${EN}) — the language/loudness seeds need it` };
  const hasFa = existsSync(FA);

  // ── 1. seed media (deterministic, in scratch; rebuilt only when the fixtures change) ────────
  mkdirSync(MEDIA, { recursive: true });
  const stamp = join(MEDIA, 'stamp.json');
  const wantStamp = JSON.stringify({ v: 1, en: shaFile(EN), fa: hasFa ? shaFile(FA) : null });
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8').trim() !== wantStamp) {
    for (const f of readdirSync(MEDIA)) rmSync(join(MEDIA, f), { recursive: true, force: true });
    writeFileSync(stamp, wantStamp);
  }
  const mk = (name, args) => { const p = join(MEDIA, name); if (!existsSync(p)) ffmpeg([...args, p]); return p; };
  const GOOD = mk('good-16x9.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-i', EN, '-map', '0:v', '-map', '1:a', '-af', loudnormTo(EN, 10, -14, -2), '-t', '10', ...ENC]);
  mk('bad-duration.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 15), '-i', EN, '-map', '0:v', '-map', '1:a', '-t', '15', ...ENC]);
  mk('bad-res-640.mp4', ['-f', 'lavfi', '-i', src2('640x360', 10), '-i', EN, '-map', '0:v', '-map', '1:a', '-t', '10', ...ENC]);
  mk('bad-noaudio.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-map', '0:v', '-an', '-t', '10', ...ENC]);
  mk('bad-silent.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-map', '0:v', '-map', '1:a', '-t', '10', ...ENC]);
  mk('bad-loud.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*440*t):s=48000:d=10', '-map', '0:v', '-map', '1:a', '-t', '10', ...ENC]);
  mk('bad-safe.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-i', EN, '-map', '0:v', '-map', '1:a', '-vf', 'drawbox=x=77:y=58:w=1126:h=604:color=black:t=fill', '-t', '10', ...ENC]);
  mk('bad-format-9x16.mp4', ['-f', 'lavfi', '-i', src2('720x1280', 10), '-i', EN, '-map', '0:v', '-map', '1:a', '-t', '10', ...ENC]);
  mk('bad-size.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-i', EN, '-map', '0:v', '-map', '1:a', '-t', '10', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']);
  mk('seed.png', ['-f', 'lavfi', '-i', 'color=c=0x3f7f1f:s=64x64', '-frames:v', '1']);
  mk('seed2.png', ['-f', 'lavfi', '-i', 'color=c=0x1f3f7f:s=64x64', '-frames:v', '1']);
  if (hasFa) mk('good-fa.mp4', ['-f', 'lavfi', '-i', src2('1280x720', 10), '-i', FA, '-map', '0:v', '-map', '1:a', '-af', loudnormTo(FA, 10, -14, -2), '-t', '10', ...ENC]);

  // ── 2. the seeded project film + child (removed in the finally, on failure too) ─────────────
  try {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(join(DIR, 'assets'), { recursive: true });
    mkdirSync(join(FILMS, CHILD, 'assets'), { recursive: true });
    writeJson(join(DIR, 'film.json'), { kind: 'project', title: 'Ledger check film', formats: ['16:9'] });
    writeJson(join(FILMS, CHILD, 'film.json'), { kind: 'motion', parent: KEY, title: 'Ledger check child' });
    copyFileSync(join(MEDIA, 'seed.png'), join(DIR, 'assets', 'seed.png'));
    copyFileSync(join(MEDIA, 'seed2.png'), join(DIR, 'assets', 'seed2.png'));
    copyFileSync(join(MEDIA, 'seed.png'), join(FILMS, CHILD, 'assets', 'seed.png'));   // the child USES a1
    writeJson(join(DIR, 'assets.json'), [
      { id: 'a1', path: `films/${KEY}/assets/seed.png`, sha256: shaFile(join(DIR, 'assets', 'seed.png')), origin: 'made here', license: 'studio', role: 'seed plate', added: '2026-10-06' },
      { id: 'a2', path: `films/${KEY}/assets/seed2.png`, sha256: shaFile(join(DIR, 'assets', 'seed2.png')), origin: 'made here', license: 'studio', role: 'unused plate', added: '2026-10-06' },
    ]);
    copyFileSync(GOOD, join(OUT, 'final-16x9.mp4'));
    const seedLedger = (rows) => writeJson(join(DIR, 'requirements.json'), rows);
    const row = (over = {}) => ({ id: 'r01', text: '10 seconds', type: 'measurable', verifier: 'duration', arg: 10, source: 'request', status: 'pending', evidence: null, waived_by: null, ...over });

    // ── 3. the 10 verifiers: good green with the measured number, bad red naming it ───────────
    const V = (verifier, arg, file, over = {}) => verifyRequirement(
      { id: 'r01', text: `the seeded ${verifier} ask`, type: 'measurable', verifier, arg, ...over },
      { key: KEY, finals: file ? [join(MEDIA, file)] : [] });
    const g = (name, r, re) => { need(r.row.status === 'green' && re.test(r.row.evidence), `${name}: expected green with /${re}/ in the evidence, got ${r.row.status} "${r.row.evidence}"`); return r.row.evidence; };
    const x = (name, r, re) => { need(r.row.status === 'red' && re.test(r.row.evidence), `${name}: expected red with /${re}/ in the evidence, got ${r.row.status} "${r.row.evidence}"`); return r.row.evidence; };

    const evDuration = g('duration good 10s', await V('duration', 10, 'good-16x9.mp4'), /10\.00s/);
    const evDurBad = x('duration bad 15s vs 10±2', await V('duration', 10, 'bad-duration.mp4'), /15\.00s vs 10s/);
    x('duration with no finals', await V('duration', 10, null), /no finals under films\/verify-p-ledger\/out\//);

    const evFormats = g('formats good 16:9', await V('formats', ['16:9'], null), /16:9 1280x720/);
    copyFileSync(join(MEDIA, 'bad-format-9x16.mp4'), join(OUT, 'final-16x9.mp4'));   // a portrait file posing as 16:9
    x('formats bad: portrait geometry in final-16x9', await V('formats', ['16:9'], null), /720x1280 \(0\.56\d:1\), not 16:9/);
    copyFileSync(GOOD, join(OUT, 'final-16x9.mp4'));                                 // restore the good final
    x('formats bad: asked 9:16, none rendered', await V('formats', ['9:16'], null), /9:16: no out\/final-9x16\.mp4/);

    g('resolution good 720p', await V('resolution', 720, 'good-16x9.mp4'), /1280x720/);
    const evResBad = x('resolution bad 640x360', await V('resolution', 720, 'bad-res-640.mp4'), /640x360 \(long side 640px\) < 720px/);

    const evLoud = g('loudness good', await V('loudness', -14, 'good-16x9.mp4'), /LUFS.*dBTP/);
    const loud = /(-?\d+\.\d) LUFS, (-?\d+\.\d) dBTP/.exec(evLoud);
    need(loud && Math.abs(+loud[1] + 14) <= 1 && +loud[2] <= -1, `the good seed must itself hold the -14 LUFS ±1 / <= -1 dBTP ask (${evLoud})`);
    const evLoudBad = x('loudness bad +1.7 dBTP', await V('loudness', -14, 'bad-loud.mp4'), /1\.7 dBTP \(want -14 ±1 \/ <= -1 dBTP\)/);

    g('has-audio good', await V('has-audio', null, 'good-16x9.mp4'), /mean -16\.\d dB/);
    x('has-audio bad: no stream', await V('has-audio', null, 'bad-noaudio.mp4'), /no audio stream/);
    x('has-audio bad: digital silence', await V('has-audio', null, 'bad-silent.mp4'), /silent \(mean -91\.0 dB\)/);

    const SRT = join(OUT, 'captions.srt');
    writeFileSync(SRT, '1\n00:00:00,000 --> 00:00:01,000\nSeed one.\n\n2\n00:00:01,000 --> 00:00:02,000\nSeed two.\n\n3\n00:00:02,500 --> 00:00:04,000\nSeed three.\n');
    g('captions good', await V('captions', null, null), /3 cues, monotonic/);
    writeFileSync(SRT, '1\n00:00:03,000 --> 00:00:04,000\nOut of order.\n\n2\n00:00:01,000 --> 00:00:02,000\nEarlier.\n');
    x('captions bad: non-monotonic', await V('captions', null, null), /2 cues but cue 2 breaks the order \(starts 0:01, previous starts 0:03/);
    rmSync(SRT, { force: true });
    x('captions bad: no sidecar', await V('captions', null, null), /no out\/captions\.srt/);

    const evEn = g('language good en', await V('language', 'en', 'good-16x9.mp4'), /ASR heard en \(p 0\.\d+, \d+ words\)/);
    x('language bad: fa wanted, en heard', await V('language', 'fa', 'good-16x9.mp4'), /ASR heard en .* want "fa"/);
    const evFa = hasFa
      ? g('language good fa', await V('language', 'fa', 'good-fa.mp4'), /ASR heard fa \(p 0\.\d+, \d+ words\)/)
      : null;

    const evSafe = g('safe-area good', await V('safe-area', null, 'good-16x9.mp4'), /safe YAVG 1\d\d\.\d/);
    const evSafeBad = x('safe-area bad: black band', await V('safe-area', null, 'bad-safe.mp4'), /near-black \(YAVG 16\.\d/);

    const evAsset = g('asset-used good: a1 in the child', await V('asset-used', 'a1', null), /a1 used by verify-p-ledger-s01 \(films\/verify-p-ledger-s01\/assets\/seed\.png\)/);
    x('asset-used bad: a2 nowhere', await V('asset-used', 'a2', null), /a2 \(sha \w{8}…\) is not in any child film folder/);
    x('asset-used bad: unknown id', await V('asset-used', 'a9', null), /no asset "a9" in films\/verify-p-ledger\/assets\.json/);

    g('max-size good', await V('max-size', 5, 'good-16x9.mp4'), /3\.\d MiB/);
    const evSizeBad = x('max-size bad: the too-big final', await V('max-size', 5, 'bad-size.mp4'), /\d+\.\d MiB > 5 MiB/);
    need(+(evSizeBad.match(/(\d+\.\d) MiB/)?.[1] ?? 0) > 5, `the too-big seed must itself exceed the 5 MiB ask (${evSizeBad})`);

    // the read side and the dispatch agree on what a verifier is
    need(JSON.stringify(VERIFIERS) === JSON.stringify(VERIFIER_NAMES), `ledger.VERIFIERS and the library's names drifted: [${VERIFIERS.join(',')}] vs [${VERIFIER_NAMES.join(',')}]`);

    // ── 4. a measurable requirement without a known verifier fails LOUDLY at read time ────────
    for (const [name, over] of [['unknown verifier', { verifier: 'vibes', arg: 1 }], ['no verifier', { verifier: undefined, arg: 10 }]]) {
      seedLedger([row({ text: 'it should feel urgent and correct', ...over })]);
      let threw = null;
      try { readLedger(KEY); } catch (e) { threw = String(e.message || e); }
      need(!!threw, `a measurable requirement with ${name} did not fail readLedger loudly`);
      need(threw?.includes('duration') && threw?.includes('max-size'), `the ${name} error must list the known verifiers: ${threw?.slice(0, 140)}`);
    }

    // ── 5. a subjective requirement passes ONLY with critic evidence ──────────────────────────
    const KEYS = [...Object.keys(RUBRIC), 'fidelity', 'coherence'];   // the project rubric: the 7 + its own 2
    const NINE = Object.fromEntries(KEYS.map((k) => [k, 9]));
    const round = (scores, sheets = ['sheets/every-16x9.png']) => ({ round: 1, at: '2026-10-06T00:00:00.000Z', reviewer: 'producer-critic', scores, min: Math.min(...Object.values(scores)), pass: Math.min(...Object.values(scores)) >= 8, problems: [], notes: 'seeded for the ledger check', sheets });
    const REV = join(DIR, 'reviews.json');
    const SUBJ = { id: 'r01', text: 'it should feel alive', type: 'subjective', source: 'request', status: 'pending', evidence: null, waived_by: null };

    rmSync(REV, { force: true });
    const none = await verifySubjective(KEY, SUBJ);
    need(!none.pass && none.status === 'red' && /cannot pass/.test(none.evidence), `a subjective ask with no reviews.json must be unable to pass (${none.evidence})`);

    writeJson(REV, [round(NINE)]);
    const good = await verifySubjective(KEY, SUBJ);
    need(good.pass && good.status === 'green', `a full critic round (every rubric key 9, sheets) must pass the subjective ask (${good.evidence})`);

    writeJson(REV, [round({ ...NINE, sound: 6 })]);
    const low = await verifySubjective(KEY, SUBJ);
    need(!low.pass && /sound 6/.test(low.evidence), `a round scoring sound 6 must not pass, naming the key and score (${low.evidence})`);

    writeJson(REV, [round(NINE, [])]);
    const bare = await verifySubjective(KEY, SUBJ);
    need(!bare.pass && /sheets/.test(bare.evidence), `a round with no sheets must not pass — the critic must have looked (${bare.evidence})`);

    writeJson(REV, [round(Object.fromEntries(Object.keys(RUBRIC).map((k) => [k, 9])))]);   // the 7 base keys only
    const skip = await verifySubjective(KEY, SUBJ);
    need(!skip.pass && /fidelity/.test(skip.evidence), `a round that skips the project's own rubric keys (fidelity, coherence) must not pass (${skip.evidence})`);

    // and the dispatch resolves subjective rows, not just the direct call
    seedLedger([SUBJ]);
    writeJson(REV, [round(NINE)]);
    const runGood = await runLedger(KEY, {});
    need(runGood.rows.find((r) => r.id === 'r01')?.status === 'green', 'runLedger must resolve a subjective row green when the critic round holds');
    writeJson(REV, [round({ ...NINE, sound: 6 })]);
    const runLow = await runLedger(KEY, {});
    need(runLow.red.some((r) => r.id === 'r01') && /sound 6/.test(runLow.red[0]?.evidence ?? ''), 'runLedger must count an unproven subjective row as red');

    // ── 6. only the human waives ─────────────────────────────────────────────────────────────
    seedLedger([row({ status: 'waived', waived_by: 'agent' })]);
    let refused = '';
    try { readLedger(KEY); } catch (e) { refused = String(e.message || e); }
    need(refused.includes('human') && refused.includes('agent'), `a waiver by "agent" must be refused loudly (${refused.slice(0, 140)})`);

    seedLedger([row()]);
    const waived = waive(KEY, 'r01');
    need(waived.waived_by === 'human' && waived.status === 'waived', `waive() must record the human's waiver (got ${waived.waived_by}/${waived.status})`);
    const after = readLedger(KEY);
    need(after[0].status === 'waived' && after[0].waived_by === 'human', 'readLedger accepts a row waived by the human');
    let noId = false;
    try { waive(KEY, 'r99'); } catch { noId = true; }
    need(noId, 'waive() must refuse an unknown requirement id loudly');

    // ── 7. brief-lint: every ask of 10 seeded requests, flagged unmapped, silent when mapped ──
    const REQUESTS = [
      ['A 60-second explainer about the water cycle in 16:9.', 'the film runs 60 seconds in the 16:9 format'],
      ['A 90-second vertical promo for the studio, punchy.', '90 seconds, vertical 9:16'],
      ['20s widescreen teaser for the product launch.', 'a 20 seconds widescreen (16:9) teaser'],
      ['Make it 30 seconds, 9:16, in Persian, about the seasons.', '30 seconds in 9:16, narrated in Persian (fa)'],
      ['A 45-second recap using ~/Videos/i.mp4 and ~/logo.png.', '45 seconds that opens with ~/Videos/i.mp4 and closes on ~/logo.png'],
      ['a 10s title card from C:\\Users\\Hp\\logo.png', 'a 10 seconds title card built from C:\\Users\\Hp\\logo.png'],
      ['the ten biggest cities, widescreen, calm narration', 'the ten biggest cities (10 of them), widescreen 16:9'],
      ['top 10 highlights from talk.mp4, vertical', 'top 10 highlights cut from talk.mp4, vertical 9:16'],
      ['a podcast cut of podcast.mp3, square, 90 seconds', '90 seconds from podcast.mp3 in square (1:1)'],
      ['half a minute on photosynthesis in Persian, 16:9', 'half a minute (30 seconds) on photosynthesis, in Persian (fa), 16:9'],
    ];
    let asks = 0, flagged = 0;
    for (const [request, text] of REQUESTS) {
      const ex = extract(request);
      asks += ex.durations.length + ex.formats.length + ex.languages.length + ex.assets.length + ex.counts.length;
      const empty = lint(request, []);
      flagged += empty.unmapped.length;
      for (const u of empty.unmapped) need([...ex.durations, ...ex.formats, ...ex.languages, ...ex.assets, ...ex.counts].includes(u.value), `brief-lint flagged something the request never asked (${u.kind}=${u.value})`);
      const mapped = lint(request, [{ text }]);
      need(mapped.unmapped.length === 0, `brief-lint still flags a mapped ask — "${request}" → ${mapped.unmapped.map((u) => `${u.kind}=${u.value}`).join(', ')}`);
    }
    need(flagged === asks, `an empty ledger must flag every extracted ask (flagged ${flagged} of ${asks})`);

    const m = (s, re) => re.exec(s)?.[0] ?? s;   // the compact numbers for the report
    return {
      pass: bad.length === 0,
      measured: bad.length ? bad.join('; ') : [
        '10/10 verifiers good+bad with the measured value in every message',
        `good final: ${evDuration.match(/[\d.]+s$/)?.[0]} 1280x720 ${m(evLoud, /-[\d.]+ LUFS, -[\d.]+ dBTP/)}, ${m(evSafe, /YAVG [\d.]+/)}`,
        `bad seeds: ${evDurBad.match(/[\d.]+s vs/)?.[0]}, ${m(evResBad, /\d+x\d+/)}, no-audio + ${m(evSafeBad, /YAVG [\d.]+/)} black band, ${m(evLoudBad, /-?[\d.]+ dBTP/)}, ${m(evSizeBad, /[\d.]+ MiB/)}`,
        `language: ${m(evEn, /ASR heard \w+ \(p [\d.]+, \d+ words\)/)}${evFa ? ` + ${m(evFa, /ASR heard \w+ \(p [\d.]+, \d+ words\)/)}` : ' (fa fixture missing — en only)'}`,
        `formats: ${m(evFormats, /16:9 \d+x\d+/)} good vs portrait + missing-9x16 red`,
        `asset-used: ${m(evAsset, /used by \S+/)}; unknown-verifier read refuses; subjective 5 cases (4 cannot-pass, full round min 9 passes; runLedger carries it); agent waiver refused, human accepted; brief-lint ${asks} asks / 10 requests — ${flagged} flagged on an empty ledger, 0 when mapped`,
      ].join(' · '),
    };
  } finally {
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
    rmSync(join(FILMS, CHILD), { recursive: true, force: true });
  }
};
