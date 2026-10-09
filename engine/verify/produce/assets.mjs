// assets (P2): the license gate bites end to end. Licenses parse from RECORDED API fixtures
// (Wikimedia extmetadata, NASA images-api, Internet Archive licenseurl/rights — committed under
// engine/produce/fixtures/licenses/, never a live call); addAsset refuses unknown licenses and
// attribution licenses without the attribution (captured from the same blobs); a row with no
// license is red and BLOCKS ship (verifyProject fails on it, with nothing else wrong); sha256
// pins hold (a tampered and a deleted pinned file both go red naming it); out/credits.md lists
// every attributed asset + the human's inputs. The whole check runs with fetch disabled.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { LICENSES, addAsset, attributionOf, creditsMd, parseLicense, verifyAssets } from '../../produce/assets.mjs';

const KEY = 'verify-p-assets';
const FIXTURES = join(ROOT, 'engine', 'produce', 'fixtures', 'licenses');
const SCRATCH = join(homedir(), '.cache', 'pi-motion-studio', 'scratch', 'w1-fab', 'assets');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  rmSync(SCRATCH, { recursive: true, force: true }); mkdirSync(SCRATCH, { recursive: true });

  // a minimal but VALID project: plan + requirements green, so the only thing that can block
  // ship below is the asset gate under test
  writeJson(join(dir, 'film.json'), { kind: 'project', title: 'the assets check fixture', formats: [], request: 'prove the license gate', parts: [] });
  writeJson(join(dir, 'plan.json'), {
    version: 1, goal: 'show one sourced number about satellite orbits on screen',
    audience: 'the assets check fixture (a minimal valid plan)',
    assumptions: ['the seeded fixture film stands in for a real production'],
    deliverables: [{ type: 'still', name: 'poster' }],
    decision: { chosen: 'math', why: 'a single technique keeps the fixture minimal while exercising the full plan shape',
      risky: false,
      alternatives: [{ id: 'motion', rejected_because: 'heavier than a fixture needs' },
        { id: 'simplest: static slideshow', rejected_because: 'no catalog technique would validate the segment capability' }] },
    segments: [{ id: 's01', capability: 'math', role: 'the one part', brief: 'render the sourced number as a static frame',
      duration: 40, inputs: [], acceptance: ['the number renders'] }],
    assembly: { mode: 'single', transitions: 'none', audio: 'none' },
    feasibility: { blocked_inputs: [], needs_capability: [] },
    budget: { minutes: 60, usd: 0 }, risks: ['a fixture film, not a real production'] });
  writeJson(join(dir, 'requirements.json'), [
    { id: 'r01', text: 'one fixture ask, waived by the human for the ship-block leg', type: 'measurable',
      verifier: 'duration', arg: 1, tolerance: 1, source: 'request', status: 'waived',
      evidence: 'waived by the human', waived_by: 'human' }]);
  writeJson(join(dir, 'facts.json'), []);
  writeJson(join(dir, 'budget.json'), { minutes: 60, usd: 0, spent_usd: 0, calls: [] });

  // two deterministic plates (ffmpeg testsrc, frame 1) + the human's recorded input
  const mk = (file) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-frames:v', '1', file]);
    if (r.error || r.status !== 0) throw new Error(`ffmpeg could not seed ${file}: ${r.error ?? r.stderr}`); };
  const plate = join(SCRATCH, 'plate.png'), pin = join(SCRATCH, 'pin.png');
  mk(plate); mk(pin);
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const pinBytes = readFileSync(pin);   // byte-exact restore after the tamper/delete legs
  writeJson(join(dir, 'inputs.json'), [{ id: 'i1', path: plate, sha256: sha(plate) }]);

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network disabled: the assets check runs on recorded fixtures'); };
  try {
    // 1. license parsing from the RECORDED fixtures — the API metadata shapes fetch.mjs reads
    const fx = (n) => JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), 'utf8'));
    const wikimedia = fx('wikimedia-commons'), pd = fx('wikimedia-pd'), cc0 = fx('wikimedia-cc0'),
      nasa = fx('nasa'), archive = fx('archive');
    for (const [blob, id, name] of [[wikimedia, 'cc-by-sa-4.0', 'wikimedia CC BY-SA'], [pd, 'public domain', 'wikimedia PD'],
      [cc0, 'cc0', 'wikimedia CC0'], [nasa, 'nasa', 'NASA images-api'], [archive, 'cc-by-4.0', 'Internet Archive']]) {
      need(parseLicense(blob) === id, `${name} fixture parsed to "${parseLicense(blob)}" (want ${id})`);
      need(!!LICENSES[id], `"${id}" is not a known license`);
    }
    // attribution captured from the same blobs (HTML stripped; NASA's center+title line; IA creator)
    const wAtt = attributionOf(wikimedia);
    need(!!wAtt && wAtt.includes('OrbitRender') && !wAtt.includes('<a'), 'the wikimedia fixture attribution lost the artist or kept raw HTML');
    const nAtt = attributionOf(nasa);
    need(nAtt === `NASA ${nasa.center} — ${nasa.title}`, `the nasa fixture attribution is not the maker line: ${nAtt}`);
    const aAtt = attributionOf(archive);
    need(aAtt === archive.creator, `the archive fixture attribution is not the creator: ${aAtt}`);
    facts.push('parsed from recorded fixtures: cc-by-sa-4.0 (wikimedia), public domain (wikimedia), cc0 (wikimedia), nasa (images-api), cc-by-4.0 (IA licenseurl)');

    // 2. addAsset refuses: an unknown license, and an attribution license without the attribution
    let refused = null;
    try { addAsset(KEY, { id: 'x1', path: plate, license: 'all-rights-reserved' }); } catch (e) { refused = String(e.message || e); }
    need(/unknown license/.test(refused ?? '') && /all-rights-reserved/.test(refused ?? ''), 'an unknown license is not refused');
    refused = null;
    try { addAsset(KEY, { id: 'x2', path: plate, license: 'cc-by-4.0' }); } catch (e) { refused = String(e.message || e); }
    need(/REQUIRES attribution/.test(refused ?? ''), 'CC BY 4.0 without attribution is not refused');
    need(!readJson(join(dir, 'assets.json'), []).some((a) => ['x1', 'x2'].includes(a.id)), 'a refused asset still landed in assets.json');
    facts.push('addAsset refused: unknown license, cc-by-4.0 without attribution (0 rows landed)');

    // 3. accepted, with the attribution captured from the fixtures (every parsed shape pins a real file)
    const a1 = addAsset(KEY, { id: 'a1', path: plate, origin: nasa.preview, license: parseLicense(nasa), attribution: nAtt, role: 'earth plate' });
    const a2 = addAsset(KEY, { id: 'a2', path: plate, origin: wikimedia.descriptionurl, license: parseLicense(wikimedia), attribution: wAtt, role: 'satellite plate' });
    const a3 = addAsset(KEY, { id: 'a3', path: plate, origin: `https://archive.org/details/${archive.identifier}`, license: parseLicense(archive), attribution: aAtt, role: 'stock footage' });
    const a4 = addAsset(KEY, { id: 'a4', path: plate, origin: cc0.descriptionurl, license: parseLicense(cc0), role: 'orbit diagram' });
    const a5 = addAsset(KEY, { id: 'a5', path: plate, origin: pd.descriptionurl, license: parseLicense(pd), role: 'earth disc' });
    const a6 = addAsset(KEY, { id: 'a6', path: pin, license: 'studio', role: 'the pinned plate' });
    need(a6.sha256 === sha(pin), 'addAsset did not pin the real file\'s sha256');
    let v = verifyAssets(KEY);
    need(v.ok && v.rows.length === 6 && v.rows.every((r) => r.status === 'green'),
      `the licensed board is not green: ${JSON.stringify(v.rows.filter((r) => r.status !== 'green'))}`);

    // 4. credits.md lists EVERY attributed asset + the human's inputs
    const md = creditsMd(KEY);
    mkdirSync(join(dir, 'out'), { recursive: true });
    writeFileSync(join(dir, 'out', 'credits.md'), md);
    for (const a of [a1, a2, a3]) need(md.includes(a.attribution), `out/credits.md misses the attribution of ${a.id}`);
    need(md.includes(LICENSES['cc-by-sa-4.0'].name), 'out/credits.md does not name the license');
    need(md.includes('plate.png') && md.includes(sha(plate).slice(0, 12)), 'out/credits.md misses the human input (name + sha)');
    facts.push('out/credits.md: 3 attributed assets (nasa, cc-by-sa-4.0, cc-by-4.0) + the 1 human input');

    // 5. sha256 pins hold: tamper -> red naming the drift; delete -> red naming the file
    appendFileSync(pin, Buffer.from([0x00]));
    v = verifyAssets(KEY);
    const r6 = v.rows.find((r) => r.id === 'a6');
    need(!v.ok && r6?.status === 'red' && /sha256 drift/.test(r6?.why ?? '') && (r6?.why ?? '').includes('pin.png'),
      `a tampered pinned file is not red naming the drift: ${r6?.why}`);
    writeFileSync(pin, pinBytes);   // byte-exact restore (deterministic — no re-encode needed)
    need(verifyAssets(KEY).ok, 'the pin did not verify green again after the restore');
    rmSync(pin);
    v = verifyAssets(KEY);
    const r6b = v.rows.find((r) => r.id === 'a6');
    need(r6b?.status === 'red' && /pinned file missing/.test(r6b?.why ?? '') && (r6b?.why ?? '').includes('pin.png'),
      `a deleted pinned file is not red naming it: ${r6b?.why}`);
    writeFileSync(pin, pinBytes);   // restore: the ship-block leg below isolates the license problem
    facts.push('sha256 pins: real file pinned; tamper -> red (drift named), delete -> red (file named), restore -> green');

    // 6. no license -> red ("" and null alike) — and it BLOCKS ship
    writeJson(join(dir, 'assets.json'), [...readJson(join(dir, 'assets.json'), []),
      { id: 'a8', path: plate, sha256: sha(plate), origin: 'https://example.com/unlicensed', license: '', attribution: null, role: 'background plate', added: '2026-10-06T00:00:00.000Z' },
      { id: 'a9', path: plate, sha256: null, origin: 'https://example.com/unlicensed2', license: null, attribution: null, role: 'logo', added: '2026-10-06T00:00:00.000Z' }]);
    v = verifyAssets(KEY);
    for (const id of ['a8', 'a9']) { const r = v.rows.find((x) => x.id === id);
      need(r?.status === 'red' && /no license recorded/.test(r?.why ?? ''), `${id} (license ${id === 'a8' ? '""' : 'null'}) is not red`); }
    need(!v.ok, 'verifyAssets stayed ok with unlicensed rows');
    const { verifyProject } = await import('../../produce/ship.mjs');   // read-only: seed + call
    const vp = await verifyProject(KEY);
    need(vp.pass === false, 'verifyProject PASSED with an unlicensed asset — it must block ship');
    const assetWhy = (vp.why ?? []).filter((w) => /assets red/.test(w));
    need(assetWhy.length === 1 && /a8/.test(assetWhy[0]) && /a9/.test(assetWhy[0]),
      `the ship-block why does not name both unlicensed assets: ${JSON.stringify(vp.why)}`);
    const other = (vp.why ?? []).filter((w) => !/assets red/.test(w));
    need(!other.length, `problems beyond the unlicensed asset (plan/requirements/budget were seeded valid): ${other.join(' | ')}`);
    facts.push('unlicensed rows (a8 license "", a9 null) red; verifyProject pass=false on exactly the asset problem — ship blocked');
  } finally {
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });     // the fixture film never outlives the check
    rmSync(SCRATCH, { recursive: true, force: true });  // nor the seeded plates
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
