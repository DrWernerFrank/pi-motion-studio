// env (P0/P1): the producer's own environment — pi on PATH with a version, the capability
// readiness table from REAL probes, the runner's prerequisites. Each missing item names its fix.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../../lib/serve.mjs';

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. doctor reports pi + the producer rows, and each missing item names a fix
  const out = execFileSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'doctor'], { encoding: 'utf8', timeout: 120000 });
  need(/pi on PATH/.test(out), 'doctor does not report the pi probe');
  const piRow = out.split('\n').find((l) => /pi on PATH/.test(l)) || '';
  need(/^(ok|FAIL)/.test(piRow.trim()), `the pi row is not a verdict: "${piRow.trim().slice(0, 60)}"`);
  if (/FAIL/.test(piRow)) { need(/STUDIO_PI_CMD|install/.test(piRow), 'a red pi probe does not name its fix'); facts.push('pi NOT on PATH (the row names the fix — STUDIO_PI_CMD or install)'); }
  else facts.push(`pi on PATH: ${piRow.trim().split(/\s+/).pop()}`);

  // 2. `studio doctor --math` resolves everything the catalog references (the readiness table)
  const outM = execFileSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'doctor', '--math'], { encoding: 'utf8', timeout: 300000 });
  for (const probe of ['voice', 'asr', 'manim']) need(new RegExp(`^ok\\s+.*${probe === 'manim' ? 'Manim' : probe}`, 'm').test(outM) || new RegExp(probe, 'i').test(outM),
    `doctor --math does not report the "${probe}" probe (the catalog references it)`);
  const red = outM.split('\n').filter((l) => /^FAIL/.test(l));
  need(!red.length, `doctor --math has red rows: ${red.map((l) => l.slice(0, 50)).join('; ')}`);
  facts.push(`doctor --math: 0 red rows (voice/asr/manim probes all resolve — the readiness table is real)`);

  // 3. the capability readiness table: every catalog entry resolves ready or not-ready-with-fix
  const { capabilitiesWithReadiness } = await import('../../produce/capabilities.mjs');
  const rows = await capabilitiesWithReadiness();
  for (const r of rows) {
    if (!r.readiness.ready) need(!!r.readiness.fix || !!r.readiness.detail, `capability "${r.id}" is not-ready without a fix`);
  }
  facts.push(`readiness table: ${rows.length} capabilities, ${rows.filter((r) => r.readiness.ready).length} ready, every not-ready one carries a fix`);

  // 4. the runner's prerequisites: node spawn + the produce cache dirs exist (or are creatable)
  const { mkdirSync, existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const logs = join(homedir(), '.cache', 'pi-motion-studio', 'logs');
  mkdirSync(logs, { recursive: true });
  need(existsSync(logs), 'the logs dir does not exist after mkdir (the runner writes its logs there)');
  const fake = spawnSync(process.execPath, ['-e', 'process.stdout.write("pong")'], { encoding: 'utf8' });
  need(fake.stdout === 'pong', 'node cannot spawn subprocesses (the runner is built on them)');
  facts.push('runner prerequisites: node spawn ok, logs dir present');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
