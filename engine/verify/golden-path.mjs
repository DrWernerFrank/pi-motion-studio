// golden-path: `studio autoedit` runs every preset on its fixture unattended - talking-head on `speech`,
// screen on `screen`, audiogram on `podcast.m4a`, montage on `clips12` + `song`; talking-head exports all
// four formats; `gate` PASS; the deliverables probe clean. This is the one-command proof of the whole chain.
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { autoedit } from '../autoedit.mjs';
import { loadEdit } from '../lib/edit-store.mjs';
import { readFilm } from '../lib/film.mjs';
import { run } from '../lib/proc.mjs';
import { timelineFrames, timelineSeconds } from '../lib/edit-ops.mjs';
import { gates } from '../gates.mjs';
import { FILMS } from '../lib/film.mjs';

const probe = async (f) => JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f])).out);

export default async ({ quick } = {}) => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const cases = [
    { preset: 'talking-head', key: 'gp-talk', src: fixturePath('speech'), id: 'speech', formats: ['16:9', '9:16', '1:1', '4:5'] },
    { preset: 'screen', key: 'gp-screen', src: fixturePath('screen'), id: 'screen' },
    ...(quick ? [] : [
      { preset: 'audiogram', key: 'gp-audio', src: fixturePath('podcast.m4a'), id: 'podcast' },
      { preset: 'montage', key: 'gp-montage', srcs: [...((await import('node:fs')).readdirSync(join(fixturePath('clips12'), '..')).filter((f) => f.endsWith('.mp4')).sort().map((f) => join(fixturePath('clips12'), '..', f))), fixturePath('song')] },
    ]),
  ];
  for (const c of cases) {
    rmSync(join(FILMS, c.key), { recursive: true, force: true });
    try {
      const t0 = Date.now();
      const r = await autoedit(c.key, { preset: c.preset, srcs: c.srcs ?? (c.src ? [c.src] : []), id: c.id, target: c.preset === 'montage' ? 20 : undefined, log: () => {} });
      void r;
      const film = readFilm(c.key), edit = loadEdit(c.key).edit;
      need(edit.tracks.some((x) => x.clips.length > 0), `${c.preset}: the timeline is empty`);
      const g = await gates(c.key, { log: () => {}, write: false });
      const fails = g.checks.filter((x) => x.level === 'fail');
      need(fails.length === 0, `${c.preset}: gates FAIL: ${fails.map((x) => `${x.name}: ${x.detail.slice(0, 80)}`).join('; ')}`);
      facts.push(`${c.preset}: ${timelineFrames(edit)} frames (${timelineSeconds(edit).toFixed(1)}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s, gates pass (${g.checks.filter((x) => x.level === 'pass').length}/${g.checks.length})`);
      // the drafts exist and probe clean
      const drafts = (readFileSync ? [] : []).length ? [] : (await import('node:fs')).readdirSync(film.out).filter((f) => /^draft-.*\.mp4$/.test(f) && !f.includes('.silent'));
      need(drafts.length >= 1, `${c.preset}: no draft renders landed`);
      for (const d of drafts) {
        const p = await probe(join(film.out, d)), v = p.streams.find((x) => x.codec_type === 'video'), a = p.streams.find((x) => x.codec_type === 'audio');
        need(v.pix_fmt === 'yuv420p' && v.color_space === 'bt709', `${c.preset}/${d}: ${v.pix_fmt} ${v.color_space}`);
        need(a && a.sample_rate === '48000', `${c.preset}/${d}: audio ${a?.sample_rate}`);
      }
      if (c.preset === 'talking-head') {
        need(['draft-16x9.mp4', 'draft-9x16.mp4', 'draft-1x1.mp4', 'draft-4x5.mp4'].every((f) => drafts.includes(f)), `talking-head exported ${drafts.join(', ')}, wanted all four formats`);
        // captions are on: the edit has captions config pointing at the source
        need(edit.captions?.from, 'talking-head: no captions configured');
      }
    } catch (e) {
      bad.push(`${c.preset}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
    } finally { rmSync(join(FILMS, c.key), { recursive: true, force: true }); }
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
