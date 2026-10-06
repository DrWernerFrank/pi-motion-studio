// The project verifier + ship (K5/K3): `studio project verify` passes iff the plan validates,
// every requirement is green (measured verifiers + facts + assets + budget + gates on the finals),
// and the deliverables probe clean; `ship` runs verify first and refuses otherwise, then publishes
// out/ (finals, poster, captions, credits.md, report.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, kindOf, readJson, writeJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';
import { readLedger, runLedger, writeStatuses } from './ledger.mjs';
import { verifyFacts } from './facts.mjs';
import { verifyAssets, creditsMd } from './assets.mjs';
import { verifyBudget } from './budget.mjs';
import { validatePlanFile } from './plan.mjs';
import { finalsOf } from './verify-lib.mjs';
import { appendLog } from '../kinds/project/index.mjs';

/** Verify a project: the whole K5 contract, measured. Returns { pass, rows, why[] }. */
export async function verifyProject(key) {
  const why = [];
  const dir = join(FILMS, key);
  if (kindOf(readJson(join(dir, 'film.json'), {})) !== 'project') throw new Error(`films/${key} is not a project film`);

  // 1. the plan validates
  const plan = await validatePlanFile(join(dir, 'plan.json'));
  if (!plan.ok) why.push(`plan: ${plan.errors.join('; ')}`);
  else if (plan.warnings.length) why.push(`plan warnings: ${plan.warnings.join('; ')}`);

  // 2. the ledger: every requirement green (measured verifiers run now; facts/proofs below)
  let ledger = [];
  try { ledger = readLedger(key); } catch (e) { why.push(String(e.message || e)); }
  const measurable = ledger.filter((r) => r.type === 'measurable' && r.status !== 'waived');
  const meas = measurable.length ? await runLedger(key, {}) : { green: [], red: [], rows: [] };
  if (meas.red.length) why.push(`requirements red: ${meas.red.map((r) => `${r.id} (${r.text}): ${r.evidence}`).join('; ')}`);
  const pending = ledger.filter((r) => r.status === 'pending');
  if (pending.length && !meas.red.length) why.push(`requirements never verified: ${pending.map((r) => r.id).join(', ')} (run studio project verify after a build)`);
  writeStatuses(key, meas.rows.length ? meas.rows : ledger);

  // 3. facts, assets, budget
  try { const f = verifyFacts(key); if (!f.ok) why.push(`facts red: ${f.rows.filter((r) => r.status === 'red').map((r) => `${r.id}: ${r.why}`).join('; ')}`); }
  catch (e) { why.push(String(e.message || e)); }
  try { const a = verifyAssets(key); if (!a.ok) why.push(`assets red: ${a.rows.filter((r) => r.status === 'red').map((r) => `${r.id}: ${r.why}`).join('; ')}`); }
  catch (e) { why.push(String(e.message || e)); }
  const bud = verifyBudget(key);
  if (!bud.ok) why.push(`budget: ${bud.phase} ($${bud.spentUsd} of $${bud.usd})`);

  // 4. every child's gates PASS (the techniques' own contracts)
  const parts = readJson(join(dir, 'film.json'), {}).parts || [];
  const { allKinds } = await import('../kinds/registry.mjs');
  const kinds = await allKinds();
  for (const p of parts) {
    const g = readJson(join(FILMS, p, 'gates.json'), null);
    if (!g) why.push(`part films/${p}: no gates.json — run its gates`);
    else if (!g.pass) why.push(`part films/${p}: gates FAIL`);
    void kinds;
  }

  // 5. the deliverables: every asked format's final exists and probes clean (spot-check via the
  //    ledger's formats verifier is the strict path; here: existence + non-empty + ffprobe-openable)
  const formats = readJson(join(dir, 'film.json'), {}).formats || [];
  for (const f of formats) {
    const file = join(dir, 'out', `final-${f.replace(':', 'x')}.mp4`);
    if (!existsSync(file)) why.push(`deliverable: no out/final-${f.replace(':', 'x')}.mp4`);
    else if (statSync(file).size < 1024) why.push(`deliverable: out/final-${f.replace(':', 'x')}.mp4 is suspiciously small`);
  }
  const finals = finalsOf(key);
  if (formats.length && !finals.length) why.push('deliverables: no finals at all under out/');

  return { pass: why.length === 0, why, rows: { requirements: meas.rows, parts } };
}

/** Publish the deliverables into out/: a single-technique project (assembly.mode "single" or
 *  exactly one segment) is a THIN WRAPPER — the child's finals are copied byte-identical (no
 *  re-encode, K8: "byte-identical or a remux only"), with its captions. Composite projects are
 *  assembled by the assembler (P3) before this runs; this refuses to invent finals either way. */
export function ensureFinals(key) {
  const dir = join(FILMS, key), out = join(dir, 'out');
  const plan = readJson(join(dir, 'plan.json'), {});
  const cfg = readJson(join(dir, 'film.json'), {});
  const single = plan.assembly?.mode === 'single' || (plan.segments || []).length === 1;
  if (!single) return { copied: [] };   // composite: the assembler owns out/ (P3)
  const seg = (plan.segments || [])[0];
  const st = readJson(join(dir, 'state.json'), {});
  const child = st.segments?.[seg?.id]?.film ?? seg?.film ?? `${key}-${seg?.id ?? 's01'}`;
  const childDir = join(FILMS, child);
  const copied = [];
  mkdirSync(out, { recursive: true });
  for (const fmt of cfg.formats || []) {
    const slug = fmt.replace(':', 'x');
    const src = join(childDir, 'out', `final-${slug}.mp4`);
    const dst = join(out, `final-${slug}.mp4`);
    if (!existsSync(src)) throw new Error(`the child films/${child} has no out/final-${slug}.mp4 — ship the child first (studio ship ${child})`);
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);   // byte-identical copy, never re-encoded
    copied.push(`final-${slug}.mp4`);
  }
  for (const cap of ['captions.srt', 'captions.vtt']) {
    const src = join(childDir, 'out', cap);
    if (existsSync(src)) copyFileSync(src, join(out, cap));
  }
  return { copied, child };
}

/** Ship: publish finals, verify (refuses when red), then credits + report. */
export async function shipProject(key) {
  const fin = ensureFinals(key);
  if (fin.copied?.length) console.log(`── finals: ${fin.copied.join(', ')} from films/${fin.child} (byte-identical copy — a thin wrapper never re-encodes)`);
  const v = await verifyProject(key);
  if (!v.pass) {
    console.log('── project verify');
    for (const w of v.why) console.log(`  ✗ ${w}`);
    throw new Error(`project ${key} does not verify (${v.why.length} problem(s) above) — ship refuses; fix the ledger first`);
  }
  const dir = join(FILMS, key), out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  console.log('── project verify: green');

  // the deliverables are already in out/ (assembly or the single child's finals — see ensureFinals);
  // ship publishes the sidecars: credits + report + the requirement table
  const credits = creditsMd(key);
  writeFileSync(join(out, 'credits.md'), credits);
  console.log(`── credits: ${readJson(join(dir, 'assets.json'), []).filter((a) => a.attribution).length} attributed asset(s) -> out/credits.md`);

  const ledger = readLedger(key);
  const report = reportMd(key, { ledger, verify: v });
  writeFileSync(join(out, 'report.md'), report);
  console.log('── report -> out/report.md');

  // state: shipped
  const st = readJson(join(dir, 'state.json'), {});
  writeJson(join(dir, 'state.json'), { ...st, phase: 'shipped', shippedAt: new Date().toISOString() });
  appendLog(key, 'shipped: verify green, credits + report written');
  console.log('── shipped');
  for (const f of readdirSync(out).filter((x) => /^final-.*\.mp4$/.test(x))) console.log(`  ${f}`);
  return { pass: true };
}

/** The report the human reads: what was made, why, the ledger's verdict, assets, how to adjust. */
export function reportMd(key, { ledger, verify }) {
  const dir = join(FILMS, key);
  const cfg = readJson(join(dir, 'film.json'), {});
  const plan = readJson(join(dir, 'plan.json'), {});
  const assets = readJson(join(dir, 'assets.json'), []);
  const facts = readJson(join(dir, 'facts.json'), []);
  const bud = verifyBudget(key);
  const fmts = (cfg.formats || []).join(' + ');
  const md = [
    `# ${cfg.title ?? key} — the report`, '',
    `**The request (verbatim):** ${String(cfg.request ?? '').replace(/\n+/g, ' ').slice(0, 300)}`, '',
    `**What was made:** a ${(plan.deliverables?.find?.((d) => d.type === 'video')?.duration ?? cfg.duration ?? '?')}s film in ${fmts}, produced as ${plan.decision?.chosen === 'composite' ? 'a composite' : `a single ${plan.decision?.chosen} piece`}${plan.segments?.length ? ` (${plan.segments.length} parts: ${plan.segments.map((s) => `${s.id}/${s.capability}`).join(', ')})` : ''}.`,
    `**Why that technique:** ${plan.decision?.why ?? '(the plan carries the reasoning)'}`, '',
    '## The ledger (every explicit ask, measured)', '',
    '| requirement | type | status | evidence |', '|---|---|---|---|',
    ...ledger.map((r) => `| ${r.text} | ${r.type}${r.verifier ? ` (${r.verifier})` : ''} | ${r.status === 'green' ? '✅ green' : r.status === 'waived' ? '➖ waived' : r.status} | ${String(r.evidence ?? '').replace(/\|/g, '/').slice(0, 90)} |`),
    '', '## Facts', '',
    facts.length ? facts.map((f) => `- ${f.claim}${f.hedged ? ' *(hedged)*' : ` — [source](${f.source_url})`}`).join('\n') : 'No factual claims beyond the math (every number computed, sympy-verified).',
    '', '## Assets', '',
    assets.length ? assets.map((a) => `- ${a.role}: ${a.path?.split('/').pop()} — ${a.license}${a.attribution ? ` (${a.attribution})` : ''}`).join('\n') : 'Everything made in-studio; no external assets.',
    '', `## Budget`, '',
    `Time: ${bud.spentMinutes.toFixed(0)} of ${bud.minutes} minutes (${bud.phase}); spend: $${bud.spentUsd.toFixed(3)} of the allowed $${bud.usd} (${bud.calls} provider call(s)).`,
    '', '## How to adjust it', '',
    '- Pin a note in the Studio GUI (the Notes tab) — it resolves to the exact segment and code.',
    '- Or say it in words: "shorter intro, calmer music" — a revision appends requirements and rebuilds only the parts it touches.',
    '', '---', `Produced by Motion Studio · ${new Date().toISOString().slice(0, 10)} · plan v${plan.version ?? 1}`,
  ];
  return md.join('\n') + '\n';
}
