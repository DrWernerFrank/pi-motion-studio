// render-determinism (P2): the same scene rendered TWICE from a cold cache in two formats gives
// identical decoded frames (framemd5). The render path is the real one (renderMathFilm with the
// guard); between runs the scene cache dir is wiped so both are cold. slow=true by design (renders).
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderMathFilm } from '../../math.mjs';
import { run } from '../../lib/proc.mjs';
import { readFilm } from '../../lib/film.mjs';
import { FILMS, writeJson } from '../../lib/film.mjs';

const KEY = 'verify-m-rd';

async function framesMd5(file) {
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-'], { input: '' });
  // framemd5 writes the table on stdout; hash the data rows (skip header + summary)
  const rows = out.split('\n').filter((l) => /^0,/i.test(l));
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

export default async () => {
  const { createMathFilm } = await import('../../math-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  const dir = createMathFilm(KEY, { title: 'rd fixture' });
  const scratchScene = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'math'); // wiped below anyway by render

  const facts = [], bad = [];
  try {
    for (const fmt of ['16:9', '9:16']) {
      const h = [];
      for (let i = 0; i < 2; i++) {
        rmSync(join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'math'), { recursive: true, force: true }); // cold
        const r = await renderMathFilm(KEY, { quality: 'draft', fmt });
        h.push(await framesMd5(r[0].file));
      }
      if (h[0] === h[1]) facts.push(`${fmt}: two cold drafts identical (${h[0]})`);
      else bad.push(`${fmt}: cold drafts DIFFER (${h[0]} vs ${h[1]})`);
    }
    // deterministic env is inside renderMathFilm (detEnv); the render also honors fixed fps 30 draft
    const film = readFilm(KEY);
    const fps = film.cfg.fps;
    facts.push(`fps ${fps}, film ${dir ? 'scaffolded' : '?'}`);
    return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
  } finally {
    rmSync(join(FILMS, KEY), { recursive: true, force: true });
  }
};
void writeJson;
