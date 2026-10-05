// cut-idle: on `screen`, after `cut idle` no frozen stretch longer than the configured max remains
// (freezedetect on the output at the same -75 dB floor the proposal used) and every active stretch is
// untouched; the speed-up variant keeps the audio locked (beeps stay with their frames).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource, mediaDir } from '../ingest.mjs';
import { cutIdle } from '../cut.mjs';
import { buildDialog, mixEdit } from '../edit-audio.mjs';
import { renderFilm } from '../render.mjs';
import { run } from '../lib/proc.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-cidle', ID = 'screen', MAX_IDLE = 1.0;

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('screen'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 0, out: 30 });
  const truth = JSON.parse((await import('node:fs')).readFileSync(fixturePath('screen').replace(/screen\.mp4$/, 'screen.truth.json'), 'utf8'));

  const r = await cutIdle(KEY, { maxIdle: MAX_IDLE, apply: true, log: () => {} });
  syncFilm(KEY);
  await buildDialog(KEY, { log: () => {} }); await mixEdit(KEY);
  const [out] = await renderFilm(KEY, { quality: 'draft', fmt: '16:9', workers: 2, log: () => {} });

  // no frozen stretch >= max remains (freezedetect at the proposal's own floor)
  const { err } = await run('ffmpeg', ['-nostdin', '-v', 'info', '-i', out.file, '-vf', `freezedetect=n=-75dB:d=${MAX_IDLE}s`, '-an', '-f', 'null', '-'], { allowFail: true });
  const frozen = [...err.matchAll(/freeze_start:([\d.]+)/g)].map((m) => +m[1]);
  need(frozen.length === 0, `frozen stretches remain at: ${frozen.join(', ')}s`);
  facts.push(`no frozen stretch >= ${MAX_IDLE}s in the output`);

  // every active stretch is untouched: the remaining timeline length is the sum of the active stretches (+- 2 frames)
  const active = truth.active.reduce((a, [x, y]) => a + (y - x), 0);
  const D = readFilm(KEY).cfg.duration;
  need(Math.abs(D - active) <= 2 / 30, `timeline ${D.toFixed(2)}s != sum of active stretches ${active.toFixed(2)}s`);
  facts.push(`${truth.active.length} active stretches kept whole (${active.toFixed(1)}s), idles gone (30 -> ${D.toFixed(1)}s)`);
  facts.push(`${r.proposals.length} idle proposals (removed text: "${r.proposals[0]?.removedText}")`);

  // audio locked: the dialog bus is exactly the timeline (the beeps ride their clips)
  const w = join(readFilm(KEY).out, 'dialog.wav');
  const info = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', w])).out);
  need(Math.abs(info.format.duration - D) < 0.05, `dialog ${info.format.duration}s vs timeline ${D}s`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
