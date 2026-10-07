// chart (K12, the grown technique demo D builds on): the growth contract's own check — the
// technique is REAL (create/gates/motion re-exports), its two gates run good/bad on seeded films,
// and it appears in the catalog + the plan menu. Kept cheap: no renders.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';

const KEY = 'verify-p-chart';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  rmSync(join(FILMS, KEY), { recursive: true, force: true });
  try {
    const chart = await import('../../kinds/chart/index.mjs');
    // 1. create scaffolds a chart film + the data file
    const r = chart.create(KEY, { title: KEY, duration: 10, formats: ['16:9'] });
    need(r.dir && r.dir.endsWith(KEY), 'create did not scaffold films/verify-p-chart');
    const data = readJson(join(FILMS, KEY, 'chart.json'), null);
    need(!!data, 'create wrote no chart.json');
    // 2. the gates: GOOD data (rows + source + numeric pairs) -> both pass
    writeJson(join(FILMS, KEY, 'chart.json'), { data: [[1900, 1.5], [1910, 2.2], [1920, 3.1]], source: 'https://example.org/data (open, CC-BY)' });
    const good = await chart.gate(KEY, { write: false, log: () => {} });
    need(good.pass === true, `the good data did not pass both gates: ${JSON.stringify(good.checks?.map((c) => [c.name, c.pass, c.detail]))}`);
    // 3. BAD data: a non-numeric row -> the axis gate FAILs naming data[i]; no source -> the data gate FAILs
    writeJson(join(FILMS, KEY, 'chart.json'), { data: [[1900, 1.5], ['oops', 2]] , source: '' });
    const bad1 = await chart.gate(KEY, { write: false, log: () => {} });
    need(bad1.pass === false, 'the malformed row did not fail the gates');
    const axis = bad1.checks.find((c) => c.name === 'chart-axis');
    need(axis && !axis.pass && /data\[1\]/.test(axis.detail), `the axis gate did not name data[1]: ${axis?.detail}`);
    const dataRow = bad1.checks.find((c) => c.name === 'chart-data');
    need(dataRow && !dataRow.pass && /source/.test(dataRow.detail), `the data gate did not name the missing source: ${dataRow?.detail}`);
    // 4. motion re-exports: render/look/sound/ship exist as functions
    for (const h of ['render', 'look', 'sound', 'ship']) need(typeof chart[h] === 'function', `hook ${h} missing (the motion re-export)`);
    // 5. in the catalog + the plan menu
    const { validatedCatalog } = await import('../../produce/catalog.mjs');
    const cat = await validatedCatalog();
    need(cat.some((e) => e.id === 'chart' && e.ready === 'yes'), 'the catalog does not list chart (ready)');
    facts.push('create scaffolds chart.json; gates good: 3 rows + source -> both green; bad: data[1] non-numeric + no source -> chart-axis names data[1], chart-data names the source; render/look/sound/ship re-export motion; catalog + plan menu carry chart');
  } finally { rmSync(join(FILMS, KEY), { recursive: true, force: true }); }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
