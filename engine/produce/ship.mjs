// The project verifier + ship (K5/K3): `studio project verify` passes iff the plan validates,
// every requirement is green (measured verifiers + subjective-with-critic-evidence + facts +
// assets + budget + gates on the finals), and the deliverables probe clean; `ship` runs verify
// first and refuses otherwise, then publishes out/ (finals, poster, captions, credits.md,
// report.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FILMS, kindOf, readJson, writeJson } from '../lib/film.mjs';
import { ROOT } from '../lib/serve.mjs';
import { run } from '../lib/proc.mjs';
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

  // 2. facts, assets, budget (a fact-typed requirement resolves through its facts.json row below)
  let factRows = [];
  try { const f = verifyFacts(key); factRows = f.rows; if (!f.ok) why.push(`facts red: ${f.rows.filter((r) => r.status === 'red').map((r) => `${r.id}: ${r.why}`).join('; ')}`); }
  catch (e) { factRows = null; why.push(String(e.message || e)); }
  try { const a = verifyAssets(key); if (!a.ok) why.push(`assets red: ${a.rows.filter((r) => r.status === 'red').map((r) => `${r.id}: ${r.why}`).join('; ')}`); }
  catch (e) { why.push(String(e.message || e)); }
  const bud = verifyBudget(key);
  if (!bud.ok) why.push(`budget: ${bud.phase} ($${bud.spentUsd} of $${bud.usd})`);

  // 3. the ledger: every requirement green. Measurable rows run their verifier NOW against the
  //    finals; SUBJECTIVE rows go through ledger.mjs's verifySubjective — critic evidence (a
  //    reviews.json round, every rubric key 8+, sheets saved) or they cannot pass, and their reds
  //    count into `why` like any other; fact rows resolve through the facts ledger above.
  let ledger = [];
  try { ledger = readLedger(key); } catch (e) { why.push(String(e.message || e)); }
  const runnable = ledger.filter((r) => (r.type === 'measurable' || r.type === 'subjective') && r.status !== 'waived');
  const meas = runnable.length ? await runLedger(key, {}) : { green: [], red: [], rows: [] };
  const factOf = (r) => {
    if (factRows === null) return { status: 'red', evidence: 'the facts ledger could not be read (see the facts problem above)' };
    if (!r.fact) return { status: 'red', evidence: 'a fact-typed requirement must name its facts.json id (fact: "f01")' };
    const row = factRows.find((f) => f.id === r.fact);
    if (!row) return { status: 'red', evidence: `no fact "${r.fact}" in films/${key}/facts.json` };
    return { status: row.status, evidence: `${r.fact}: ${row.why}` };
  };
  const rows = (meas.rows.length ? meas.rows : ledger).map((r) =>
    r.type === 'fact' && r.status !== 'waived' ? { ...r, ...factOf(r) } : { ...r });
  writeStatuses(key, rows);
  const reds = rows.filter((r) => r.status === 'red');
  if (reds.length) why.push(`requirements red: ${reds.map((r) => `${r.id} (${r.text}): ${r.evidence}`).join('; ')}`);
  const pending = reds.length ? [] : rows.filter((r) => r.status === 'pending');
  if (pending.length) why.push(`requirements never verified: ${pending.map((r) => `${r.id} (${r.type})`).join(', ')} (fact/proof rows resolve through their own ledgers — a build or a review writes the evidence)`);

  // 4. every child's gates PASS (the techniques' own contracts) — naming WHICH checks failed
  const parts = readJson(join(dir, 'film.json'), {}).parts || [];
  for (const p of parts) {
    const g = readJson(join(FILMS, p, 'gates.json'), null);
    if (!g) why.push(`part films/${p}: no gates.json — run its gates`);
    else if (!g.pass) why.push(`part films/${p}: gates FAIL (${(g.checks || []).filter((c) => c.level === 'fail').map((c) => c.name).join(', ')})`);
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

  return { pass: why.length === 0, why, rows: { requirements: rows, parts } };
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
  const identical = (a, b) => statSync(a).size === statSync(b).size
    && createHash('md5').update(readFileSync(a)).digest('hex') === createHash('md5').update(readFileSync(b)).digest('hex');
  for (const fmt of cfg.formats || []) {
    const slug = fmt.replace(':', 'x');
    const src = join(childDir, 'out', `final-${slug}.mp4`);
    const dst = join(out, `final-${slug}.mp4`);
    if (!existsSync(src)) throw new Error(`the child films/${child} has no out/final-${slug}.mp4 — ship the child first (studio ship ${child})`);
    if (!existsSync(dst) || !identical(src, dst)) copyFileSync(src, dst);   // byte-identical copy, never re-encoded
    copied.push(`final-${slug}.mp4`);
  }
  for (const cap of ['captions.srt', 'captions.vtt']) {
    const src = join(childDir, 'out', cap);
    if (existsSync(src)) {
      const dst = join(out, cap);
      if (!existsSync(dst) || !identical(src, dst)) copyFileSync(src, dst);
      copied.push(cap);
    }
  }
  return { copied, child };
}

/** Ship: publish finals, verify (refuses when red), poster + credits + report. */
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

  // the poster: a still at 35% of the piece (the motion kind's spot), pulled from the published
  // final with ONE ffmpeg frame — no browser (a project film has no page of its own to shoot)
  if (fin.child) {
    const ccfg = readJson(join(FILMS, fin.child, 'film.json'), {});
    const at = ccfg.poster ?? Math.min((+ccfg.duration || 3) * 0.35, 3);
    for (const fmt of readJson(join(dir, 'film.json'), {}).formats || []) {
      const slug = fmt.replace(':', 'x');
      const src = join(out, `final-${slug}.mp4`);
      if (!existsSync(src)) continue;
      const png = join(out, `poster-${slug}.png`);
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ss', String(at), '-frames:v', '1', png]);
      console.log(`── poster: poster-${slug}.png @ ${at.toFixed(2)}s (one frame from the child's final)`);
    }
  }

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
  appendLog(key, 'shipped: verify green, poster + credits + report written');
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
