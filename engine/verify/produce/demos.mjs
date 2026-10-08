// demos (P9): the four demo projects exist with finals in the formats asked, ledgers green,
// gates PASS on the children, credits and report present, every fact sourced, every asset
// licensed, spend zero — measured from the films' own files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';
import { readLedger } from '../../produce/ledger.mjs';
import { verifyFacts } from '../../produce/facts.mjs';
import { verifyAssets, creditsMd } from '../../produce/assets.mjs';
import { verifyBudget } from '../../produce/budget.mjs';
import { validatePlanFile } from '../../produce/plan.mjs';

const DEMOS = [
  { key: 'composite', fmts: ['16x9', '9x16'], dur: [50, 70], child: 'composite-s02' },
  { key: 'launch-teaser', fmts: ['9x16'], dur: [23, 27], child: 'launch-teaser-s01' },
  { key: 'gps', fmts: ['16x9'], dur: [57, 63], child: 'gps-s01' },
  { key: 'cities', fmts: ['16x9'], dur: [28, 32], child: 'cities-s01' },
];

const probe = (file, args) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8' }));

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  for (const d of DEMOS) {
    const dir = join(ROOT, 'films', d.key), out = join(dir, 'out');
    need(existsSync(join(dir, 'brief.md')), `${d.key}: no brief.md (the request verbatim)`);
    // the plan validates
    const plan = await validatePlanFile(join(dir, 'plan.json'));
    need(plan.ok, `${d.key}: the plan does not validate (${(plan.errors || []).slice(0, 1).join('')})`);
    // the finals in every asked format, in duration
    for (const f of d.fmts) {
      const file = join(out, `final-${f}.mp4`);
      need(existsSync(file), `${d.key}: no out/final-${f}.mp4`);
      if (!existsSync(file)) continue;
      const j = probe(file, ['-show_entries', 'stream=width,height:format=duration', '-select_streams', 'v']);
      const v = (j.streams || [])[0];
      const geo = { '16x9': [1920, 1080], '9x16': [1080, 1920] }[f];
      need(v?.width === geo[0] && v?.height === geo[1], `${d.key} ${f}: ${v?.width}x${v?.height} (want ${geo.join('x')})`);
      const dur = +j.format.duration;
      need(dur >= d.dur[0] && dur <= d.dur[1], `${d.key} ${f}: ${dur.toFixed(1)}s (want ${d.dur.join('-')})`);
    }
    // the ledger green (every row)
    const ledger = readLedger(d.key);
    const reds = ledger.filter((r) => r.status === 'red');
    need(!reds.length, `${d.key}: ledger red rows: ${reds.map((r) => r.id).join(', ')}`);
    // the child's gates PASS
    const gates = JSON.parse(readFileSync(join(ROOT, 'films', d.child, 'gates.json'), 'utf8'));
    need(gates.pass === true, `${d.key}: the child ${d.child}'s gates are ${gates.pass}`);
    // facts sourced (or hedged), assets licensed, budget held
    const f = verifyFacts(d.key);
    need(f.ok, `${d.key}: facts red: ${f.rows.filter((r) => r.status === 'red').map((r) => r.id).join(', ')}`);
    const a = verifyAssets(d.key);
    need(a.ok, `${d.key}: assets red: ${a.rows.filter((r) => r.status === 'red').map((r) => r.id).join(', ')}`);
    const b = verifyBudget(d.key);
    need(b.ok, `${d.key}: budget ${b.phase} ($${b.spentUsd} of $${b.usd})`);
    // credits + report exist
    need(existsSync(join(out, 'credits.md')), `${d.key}: no out/credits.md`);
    need(existsSync(join(out, 'report.md')), `${d.key}: no out/report.md`);
    // spend zero
    need(b.spentUsd === 0, `${d.key}: spent $${b.spentUsd} (the demos cost nothing)`);
    facts.push(`${d.key}: ${d.fmts.map((x) => { const j = probe(join(out, `final-${x}.mp4`), ['-show_entries', 'format=duration']); return `${x} ${(+j.format.duration).toFixed(1)}s`; }).join(' + ')} · ledger ${ledger.length} rows green · gates PASS · facts ${f.rows.length} green · assets ${a.rows.length} licensed · $${b.spentUsd}`);
  }

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join(' · ') };
};
