// facts (P2): every K6 rule bites, OFFLINE. A fact whose quote occurs in its stored snapshot is
// green; a quote missing from the snapshot, a deleted snapshot file, a hedged claim and an
// unsourced claim each land by rule (red naming the fact, red naming the file, green with the
// hedge noted, refused by addFact + malformed to readFacts). Verification is pure fs — the check
// disables the network for its whole run, so any fetch would fail it loudly; snapshots are passed
// as strings, never fetched. fetch.mjs's htmlToText is proven a pure string transform on seeded HTML.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, writeJson } from '../../lib/film.mjs';
import { addFact, readFacts, verifyFacts } from '../../produce/facts.mjs';

const KEY = 'verify-p-facts';
const SNAP = 'The satellite orbits at approximately 20,200 km altitude.';
const QUOTE = 'approximately 20,200 km altitude';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'film.json'), { kind: 'project', title: 'the facts check fixture', formats: [], request: 'prove the facts rules offline', parts: [] });

  // offline: the whole check runs with fetch disabled — a snapshot passed as a string must never
  // reach the network (addFact only fetches when NO snapshot/snapshotFile is given)
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network disabled: the facts check runs offline'); };
  try {
    // 1. quote-in-snapshot -> green (the snapshot is a recorded string, not a fetch)
    const f01 = await addFact(KEY, { id: 'f01', claim: 'GPS satellites orbit at about 20,200 km',
      source_url: 'https://www.gps.gov/applications/multimedia/images/', quote: QUOTE, snapshot: SNAP });
    need(f01.snapshot === 'sources/f01.snapshot.txt', 'addFact did not store the snapshot under sources/<id>.snapshot.txt');
    need(existsSync(join(dir, f01.snapshot)) && readFileSync(join(dir, f01.snapshot), 'utf8') === SNAP,
      'the stored snapshot is not the string that was passed (the offline contract is broken)');
    let v = verifyFacts(KEY);
    const r01 = v.rows.find((r) => r.id === 'f01');
    need(v.ok && r01?.status === 'green' && /quote found in the snapshot/.test(r01.why ?? ''),
      `a quote found in its snapshot is not green: ${JSON.stringify(r01)}`);

    // 2. quote NOT in the snapshot -> red, naming the fact
    await addFact(KEY, { id: 'f02', claim: 'the moon is made of cheese', source_url: 'https://example.com/moon',
      quote: 'the moon is made of cheese', snapshot: SNAP });
    v = verifyFacts(KEY);
    const r02 = v.rows.find((r) => r.id === 'f02');
    need(!v.ok && r02?.status === 'red', 'a quote missing from its snapshot is not red');
    need(/NOT in the snapshot/.test(r02?.why ?? ''), `the red row does not say the quote is not in the snapshot: ${r02?.why}`);

    // 3. snapshot file deleted after add -> red, naming the missing file
    await addFact(KEY, { id: 'f03', claim: 'the orbit is semi-synchronous', source_url: 'https://www.gps.gov/applications/multimedia/images/',
      quote: QUOTE, snapshot: SNAP });
    rmSync(join(dir, 'sources', 'f03.snapshot.txt'));
    v = verifyFacts(KEY);
    const r03 = v.rows.find((r) => r.id === 'f03');
    need(r03?.status === 'red' && /snapshot file missing/.test(r03?.why ?? '') && /f03/.test(r03?.why ?? ''),
      'a deleted snapshot file is not red naming it');

    // 4. hedged -> green with the hedge noted (honest without a source)
    const f04 = await addFact(KEY, { id: 'f04', claim: 'roughly two dozen GPS satellites are visible at once', hedged: true, hedge: 'stated as approximate' });
    need(f04.hedged === true && f04.hedge === 'stated as approximate', 'addFact did not record the hedge');
    v = verifyFacts(KEY);
    const r04 = v.rows.find((r) => r.id === 'f04');
    need(r04?.status === 'green' && /hedged: stated as approximate/.test(r04?.why ?? ''),
      'a hedged fact is not green with the hedge noted');

    // 5. unsourced + not hedged -> addFact REFUSES (fail-unless-hedged), naming the fact and the fix
    let refused = null;
    try { await addFact(KEY, { id: 'f05', claim: 'the moon is made of cheese' }); }
    catch (e) { refused = String(e.message || e); }
    need(!!refused, 'addFact accepted an unsourced, unhedged fact — it must refuse');
    need(/f05/.test(refused ?? '') && /unsourced|hedge/.test(refused ?? ''),
      `the refusal does not name the fact and the fix: ${refused}`);
    // ...and a raw such row, written directly, is malformed to readFacts (loud, never silently green)
    const rows = readFacts(KEY);
    writeJson(join(dir, 'facts.json'), [...rows,
      { id: 'f06', claim: 'an unsourced raw row', quote: 'x', snapshot: 'sources/f06.snapshot.txt', hedged: false }]);
    let malformed = null;
    try { readFacts(KEY); } catch (e) { malformed = String(e.message || e); }
    need(!!malformed && /malformed/.test(malformed) && /f06/.test(malformed),
      'a raw unsourced row does not make readFacts throw as malformed naming it');
    writeJson(join(dir, 'facts.json'), rows);   // the seeded fault is restored — never left behind

    // 6. htmlToText (the offline snapshot pipeline) is a pure string transform: quote kept,
    //    script dropped (the body is DATA, never code), the license link's text + href kept
    const { htmlToText } = await import('../../produce/fetch.mjs');
    const txt = htmlToText(`<p>The satellite orbits at <b>${QUOTE}</b>.</p><script>document.cookie='steal'</script><a href="/license">CC BY-SA 4.0</a>`);
    need(txt.includes(QUOTE), 'htmlToText lost the quote from the seeded HTML');
    need(!txt.includes('steal'), 'htmlToText kept script content — it must drop it (data, never instructions)');
    need(txt.includes('CC BY-SA 4.0 [/license]'), 'htmlToText did not keep the license link text + href');

    facts.push('offline rules: quote-in-snapshot green (f01), missing quote red (f02), missing snapshot red (f03), hedged green (f04), unsourced refused by addFact + malformed to readFacts (f05/f06); htmlToText pure (script dropped, link kept)');
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });   // the fixture film never outlives the check
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
