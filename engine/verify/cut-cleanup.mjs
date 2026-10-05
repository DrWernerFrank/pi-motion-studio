// cut-cleanup: on `speech`, ums/uhs removed, the flubbed sentence removed with the last take kept, every
// other word kept, and the proposal list shows the removed text so a human can veto it.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixturePath } from '../fixtures.mjs';
import { applyOps, loadEdit, syncFilm } from '../lib/edit-store.mjs';
import { ingestSource } from '../ingest.mjs';
import { cutFillers, cutSilence, cutTakes } from '../cut.mjs';
import { retimeWords } from '../lib/retime.mjs';
import { transcribe } from '../transcribe.mjs';
import { FILMS, readFilm } from '../lib/film.mjs';

const KEY = 'verify-cclean', ID = 'speech';

export default async () => {
  const bad = [], facts = [], need = (ok, what) => { if (!ok) bad.push(what); };
  const { createEditFilm } = await import('../edit-cli.mjs');
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  await createEditFilm(KEY, { fps: 30, title: KEY });
  await ingestSource(KEY, fixturePath('speech'), { id: ID, log: () => {} });
  await applyOps(KEY, { op: 'add', src: ID, in: 0, out: 29.9 });
  const tr = await transcribe(KEY, ID, { log: () => {} });
  const truth = JSON.parse(readFileSync(fixturePath('speech').replace(/speech\.mp4$/, 'speech.truth.json'), 'utf8'));

  // the full cleanup pass, exactly as the skill runs it: silence first (audio first), then fillers, then takes
  const s = await cutSilence(KEY, { maxGap: 0.5, keepBreath: 0.15, apply: true, log: () => {} });
  const f = await cutFillers(KEY, { apply: true, log: () => {} });
  const t = await cutTakes(KEY, { apply: true, log: () => {} });
  syncFilm(KEY);

  const edit = loadEdit(KEY).edit, tl = retimeWords(edit, ID, tr.words);
  const txt = tl.map((w) => w.text).join(' ');
  const norm = (s) => (s.toLowerCase().match(/[a-z']+/g) || []);

  // fillers gone (all three), and only fillers gone from the filler family
  const fillersLeft = tl.filter((w) => /^(um+|uh+|hmm)[,.]?$/i.test(w.text));
  need(fillersLeft.length === 0, `fillers still on the timeline: ${fillersLeft.map((w) => w.text).join(', ')}`);
  const fillerProposals = [...f.proposals, ...t.proposals].filter((p) => /^(um+|uh+)[,.]?$/i.test(p.removedText || ''));
  need(fillerProposals.length >= 2, `only ${fillerProposals.length} filler proposals carried their removed text`);

  // the flub is gone and its retake is kept: the retake's exact wording present, the abandoned wording absent
  const flubWords = norm('The second rule is cut on the breath, not in the');
  const retakeWords = norm('The second rule is to cut on the breath, never in the middle of a word');
  const tlWords = norm(txt);
  const retakeIdx = tlWords.findIndex((w, i) => tlWords.slice(i, i + retakeWords.length).join(' ') === retakeWords.join(' '));
  need(retakeIdx >= 0, 'the complete retake is not on the timeline');
  const flubIdx = tlWords.findIndex((w, i) => tlWords.slice(i, i + flubWords.length).join(' ') === flubWords.join(' ') && (i < retakeIdx));
  need(flubIdx < 0 || flubIdx >= retakeIdx, 'the abandoned take still plays before the retake');
  // "the last take kept": the retake is the ONLY version after the cut
  const dupes = tlWords.map((w, i) => tlWords.slice(i, i + flubWords.length).join(' ') === flubWords.join(' ')).filter(Boolean).length;
  need(dupes === 0, 'the abandoned wording still exists on the timeline');

  // every other word kept: sentence words minus the flub's words, all present
  const want = norm(truth.items.filter((i) => i.kind === 'sentence').map((i) => i.text).join(' '));
  const missing = want.filter((w) => !tlWords.includes(w));
  need(missing.length === 0, `lost words: ${[...new Set(missing)].slice(0, 8).join(' ')}`);

  // the proposal lists ship the removed text (human veto)
  const all = [...s.proposals, ...f.proposals, ...t.proposals].filter((p) => !p.skipped);
  need(all.every((p) => p.removedText !== undefined), 'a proposal without removed text');
  need(all.some((p) => /^The second rule is cut on/.test(p.removedText)), 'the flub removal was not in the proposal list');
  facts.push(`fillers gone (${fillerProposals.length} proposals), abandoned take gone + retake kept, ${missing.length} words lost of ${want.length}`);
  facts.push(`${all.length} proposals, all with removed text (flub included)`);
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
