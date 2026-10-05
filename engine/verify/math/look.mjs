// look (P2): every look mode (every, sentences, bookmarks, sections, phone, strip, times) works in every
// format the fixture renders; frames are labelled with time, scene, sentence id and narration text; a
// stale draft is re-rendered FIRST (and a fresh one is not).
//
// The fixture is the starter (createMathFilm) plus a MINIMAL timing.json written here. It follows the
// frozen timing contract (mission M3: per sentence id/scene/text/spoken/start/end/words/bookmarks;
// start/end in FILM seconds, a bookmark's t in seconds from its sentence's start — StudioScene.at()
// reads it that way). The real generator (`studio voice`) lands in P5; this check only needs the shape.
import { existsSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { createMathFilm, lookMath, draftStale } from '../../math-cli.mjs';
import { readMathFilm } from '../../math.mjs';
import { FILMS, writeJson } from '../../lib/film.mjs';
import { run } from '../../lib/proc.mjs';

const KEY = 'verify-m-look';
const FMTS = ['16:9', '9:16', '1:1', '4:5'];

// the starter's script.md, one entry per [sNN.n] sentence, timed inside the starter's scene windows
// (s01_hook 0-4.7 s, s02_meaning 4.7-9.9 s, s03_recap 9.9-14.2 s at the starter's animation lengths)
const w = (w, start, end) => ({ w, start, end });
const TIMING = {
  voice: 'piper:en_US-ljspeech-medium', sample_rate: 22050,
  sentences: [
    { id: 's01.1', scene: 's01_hook', text: 'What does a determinant actually do? Watch the unit square as a matrix acts on the plane.',
      spoken: 'What does a determinant actually do? Watch the unit square as a matrix acts on the plane.',
      start: 0.2, end: 4.3, words: [w('What', 0.27, 0.41), w('does', 0.41, 0.58)],
      bookmarks: [{ id: 'shows', t: 1.35 }, { id: 'applies', t: 2.4 }] },
    { id: 's02.1', scene: 's02_meaning', text: 'For a two by two matrix, the determinant is ad minus bc.',
      spoken: 'For a two by two matrix, the determinant is a d minus b c.',
      start: 4.9, end: 7.1, words: [w('For', 4.95, 5.08)], bookmarks: [] },
    { id: 's02.2', scene: 's02_meaning', text: 'Here: three times two, minus one times one. Five.',
      spoken: 'Here: three times two, minus one times one. Five.',
      start: 7.3, end: 9.6, words: [w('Here', 7.36, 7.6)], bookmarks: [{ id: 'lands', t: 1.9 }] },
    { id: 's03.1', scene: 's03_recap', text: 'A determinant is the area scale factor. Five means five times the area.',
      spoken: 'A determinant is the area scale factor. Five means five times the area.',
      start: 10.0, end: 13.9, words: [w('A', 10.05, 10.1)], bookmarks: [] },
  ],
};

const isPng = (f) => existsSync(f) && readFileSync(f).subarray(1, 4).toString() === 'PNG';
const near = (a, b) => Math.abs(a - b) < 0.011;

export default async () => {
  const bad = [], facts = [];
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  const dir = createMathFilm(KEY, { title: 'look fixture', formats: FMTS });
  writeJson(join(dir, 'timing.json'), TIMING);
  const S = TIMING.sentences, nBm = S.reduce((n, s) => n + s.bookmarks.length, 0);
  const t0 = Date.now();
  try {
    for (const fmt of FMTS) {
      const tag = (m) => `${fmt} ${m}`;
      const sheet = (r, m) => { if (!isPng(r.file)) bad.push(`${tag(m)}: no sheet PNG at ${r.file}`); };

      // every (also the first look: the draft does not exist yet -> rendered first)
      const ev = await lookMath(KEY, { fmt, mode: 'every', every: 0.5 });
      sheet(ev, 'every');
      if (!ev.rendered) bad.push(`${tag('every')}: no draft existed but the look did not render one`);
      const D = +(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
        join(dir, 'out', `draft-${fmt}.mp4`)])).out.trim();
      if (ev.count !== Math.min(36, Math.floor(D / 0.5))) bad.push(`${tag('every')}: ${ev.count} frames for ~${D.toFixed(2)} s at 0.5 s`);
      for (const f of ev.frames) {
        if (!f.scene || !f.label.includes(`${f.t.toFixed(2)}s`) || !f.label.includes(f.scene)) { bad.push(`${tag('every')}: frame ${f.t} label "${f.label}" lacks time/scene`); break; }
        const s = S.find((x) => f.t >= x.start && f.t < x.end);
        if (s && !(f.label.includes(s.id) && f.label.includes(s.text.slice(0, 24)))) { bad.push(`${tag('every')}: ${f.t}s inside ${s.id} but label "${f.label}"`); break; }
      }

      // sentences: one frame per sentence at its middle, labelled id + text, in its own scene
      const se = await lookMath(KEY, { fmt, mode: 'sentences' });
      sheet(se, 'sentences');
      if (se.rendered) bad.push(`${tag('sentences')}: re-rendered a FRESH draft`);
      if (se.count !== S.length) bad.push(`${tag('sentences')}: ${se.count} frames for ${S.length} sentences`);
      se.frames.forEach((f, i) => { const s = S[i]; if (!s) return;
        if (!near(f.t, (s.start + s.end) / 2) || f.sentence !== s.id || f.scene !== s.scene
          || !f.label.includes(s.id) || !f.label.includes(s.text.slice(0, 24))) bad.push(`${tag('sentences')}: frame ${i} "${f.label}" (${f.scene} @${f.t})`); });

      // bookmarks: one frame per bookmark at sentence start + t, labelled id{bookmark}
      const bm = await lookMath(KEY, { fmt, mode: 'bookmarks' });
      sheet(bm, 'bookmarks');
      if (bm.count !== nBm) bad.push(`${tag('bookmarks')}: ${bm.count} frames for ${nBm} bookmarks`);
      const wantBm = S.flatMap((s) => s.bookmarks.map((b) => ({ s, b })));
      bm.frames.forEach((f, i) => { const { s, b } = wantBm[i] || {}; if (!s) return;
        if (!near(f.t, s.start + b.t) || !f.label.includes(`${s.id}{${b.id}}`) || !f.label.includes(s.text.slice(0, 24))) bad.push(`${tag('bookmarks')}: frame ${i} "${f.label}" @${f.t}`); });

      // sections: one frame per scene at its midpoint
      const film = readMathFilm(KEY);
      const sc = await lookMath(KEY, { fmt, mode: 'sections' });
      sheet(sc, 'sections');
      if (sc.count !== film.scenes.length || sc.frames.some((f, i) => f.scene !== film.scenes[i].id || !f.label.includes(f.scene)))
        bad.push(`${tag('sections')}: ${sc.frames.map((f) => f.scene).join(',')} vs ${film.scenes.map((s) => s.id).join(',')}`);

      // phone: frames 360 px wide (the phone test), one per second
      const ph = await lookMath(KEY, { fmt, mode: 'phone' });
      sheet(ph, 'phone');
      if (ph.frameSize?.[0] !== 360) bad.push(`${tag('phone')}: frames ${ph.frameSize?.join('x')}, wanted 360 wide`);
      if (ph.count !== Math.floor(D)) bad.push(`${tag('phone')}: ${ph.count} frames for ~${D.toFixed(2)} s at 1 s`);

      // strip at a given time: 12 consecutive frames from `at`
      const at = 5.0;
      const st = await lookMath(KEY, { fmt, mode: 'strip', at, n: 12 });
      sheet(st, 'strip');
      if (st.count !== 12 || st.times.some((t, i) => !near(t, at + i / 30))) bad.push(`${tag('strip')}: times ${st.times.join(',')}`);
      if (!st.file.endsWith(`strip-5.00-${fmt.replace(':', 'x')}.png`)) bad.push(`${tag('strip')}: sheet name ${st.file}`);
      if (!st.frames.every((f) => f.scene === 's02_meaning' && f.label.includes('s02.1'))) bad.push(`${tag('strip')}: label ${st.frames[0]?.label}`);

      // times: exactly the asked moments
      const times = [1, 6, 12];
      const tm = await lookMath(KEY, { fmt, mode: 'times', times });
      sheet(tm, 'times');
      if (tm.count !== 3 || tm.times.some((t, i) => !near(t, times[i]))) bad.push(`${tag('times')}: ${tm.times.join(',')}`);
      if (!bad.length) facts.push(`${fmt}: 7 modes (every ${ev.count}, sentences ${se.count}, bookmarks ${bm.count}, sections ${sc.count}, phone ${ph.count}@${ph.frameSize?.[0]}px, strip ${st.count}, times ${tm.count})`);
    }

    // a stale draft is re-rendered first: touch one scene source, look again
    const fmt = FMTS[0];
    const film = readMathFilm(KEY), draft = join(film.out, `draft-${fmt}.mp4`);
    const before = statSync(draft).mtimeMs;
    const future = new Date(Date.now() + 2000);
    utimesSync(film.scenes[1].file, future, future);
    if (!draftStale(film, draft)) bad.push('stale: touching a scene did not make the draft stale');
    const re = await lookMath(KEY, { fmt, mode: 'sections' });
    const after = statSync(draft).mtimeMs;
    if (!re.rendered || !(after > before)) bad.push(`stale: draft not re-rendered (rendered=${re.rendered}, mtime ${before} -> ${after})`);
    else facts.push(`stale draft re-rendered first (mtime +${((after - before) / 1000).toFixed(1)} s)`);
    // the future-dated touch outlives any re-render (the render does not reset source mtimes) —
    // restore the scene's mtime to NOW so the fresh draft is genuinely fresh
    const now = new Date();
    utimesSync(film.scenes[1].file, now, now);
    if (draftStale(readMathFilm(KEY), draft)) bad.push('stale: draft still stale after the re-render');
    facts.push(`${((Date.now() - t0) / 1000).toFixed(0)} s total`);
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ').slice(0, 900) : facts.join('; ') };
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
};
