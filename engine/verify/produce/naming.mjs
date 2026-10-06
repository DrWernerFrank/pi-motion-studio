// naming (P1): no tracked path and no path under films/ contains a Windows-reserved character;
// math outputs are the slugged `final-16x9.mp4` form; the three math demos were migrated and
// re-render to the identical md5; media/ + x-*.json are untracked and ignored.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../lib/serve.mjs';

// reserved in a Windows path segment: : * ? " < > | (also control chars and trailing dots/spaces)
const RESERVED = /[:*?"<>|]/;

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };

  // 1. no tracked path carries a reserved character
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const badTracked = tracked.filter((f) => RESERVED.test(f));
  need(!badTracked.length, `tracked paths with Windows-reserved characters: ${badTracked.slice(0, 5).join(', ')}${badTracked.length > 5 ? ` (+${badTracked.length - 5})` : ''}`);

  // 2. no path under films/ carries one (tracked or not — the film dirs are the deliverable surface)
  const reservedUnder = [];
  let transient = 0;
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (RESERVED.test(f)) reservedUnder.push(`${rel}${f}`);
      const p = join(dir, f);
      let st = null;
      try { st = statSync(p); } catch (e) { if (e.code === 'ENOENT') { transient++; continue; } throw e; }
      if (st.isDirectory()) walk(p, `${rel}${f}/`);
    }
  };
  walk(join(ROOT, 'films'), 'films/');
  need(!reservedUnder.length, `paths under films/ with reserved characters: ${reservedUnder.slice(0, 5).join(', ')}`);
  facts.push(`0 Windows-reserved characters in ${tracked.length} tracked paths and under films/${transient ? ` (${transient} transient file(s) churned mid-walk — a render was in flight, not a violation)` : ''}`);

  // 3. math outputs are the slugged form: every draft/final under a math film's out/ uses NxM
  for (const k of ['determinant', 'tangent', 'odd-squares']) {
    const out = join(ROOT, 'films', k, 'out');
    need(existsSync(out), `films/${k} has no out/ (the math demos)`);
    for (const f of readdirSync(out)) {
      if (/^(draft|final)-.+\.mp4$/.test(f)) need(!RESERVED.test(f), `films/${k}/out/${f} still uses a raw format name`);
    }
    need(existsSync(join(out, 'final-16x9.mp4')), `films/${k}/out/final-16x9.mp4 missing (migrated name)`);
  }
  facts.push('math outputs are final-16x9.mp4-style across the three demos');

  // 4. media/ and x-*.json are untracked and ignored (the first missions' tracked leftovers)
  const gitIgnored = (rel) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: ROOT }).status === 0;   // 0 = ignored (execFileSync returns stdout, not status)
  for (const rel of ['media', 'x-layout.json', 'x-timeline.json', 'x-trace.json']) {
    need(!tracked.includes(rel) && !tracked.some((t) => t.startsWith(rel + '/')), `${rel} is still tracked`);
    need(existsSync(join(ROOT, rel)) ? gitIgnored(rel) : true, `${rel} exists but is not gitignored`);
  }
  facts.push('media/ + x-*.json untracked and ignored (present on disk, invisible to git)');

  // 5. the migration is render-stable: the demos' finals re-render byte-identical to the frozen
  //    post-migration ledger (docs/produce/baseline/math-names.md5). The pre-migration story —
  //    5/6 files byte-identical, odd-squares 9:16 stale on disk (muxed before its 16:14 mix rebuild,
  //    last review 13:40) — is DECISIONS D-003; this check holds the CURRENT contract forever.
  const ledger = readFileSync(join(ROOT, 'docs', 'produce', 'baseline', 'math-names.md5'), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.trim().split(/\s+/)).filter(([h, f]) => h && f);
  need(ledger.length === 6, `the frozen ledger holds ${ledger.length} rows (want 6: three demos x two formats)`);
  // a re-render (mux-cache warm after the first: seconds) must reproduce the ledger exactly
  for (const k of ['determinant', 'tangent', 'odd-squares']) {
    const r = spawnSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'render', k], { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    need(r.status === 0, `studio render ${k} (final) failed: ${(r.stderr || r.stdout || '').split('\n').slice(-3).join(' | ')}`);
  }
  let checked = 0;
  for (const [md5, rel] of ledger) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) { bad.push(`the migrated ${rel} is missing`); continue; }
    const got = createHash('md5').update(readFileSync(p)).digest('hex');
    need(got === md5, `${rel} re-rendered to ${got.slice(0, 8)} != ledger ${md5.slice(0, 8)}`);
    checked++;
  }
  need(checked === 6, `only ${checked} finals compared (want 6)`);
  facts.push(`6/6 demo finals re-render byte-identical to the frozen ledger`);

  // 6. each demo's two formats carry the SAME audio (one mix for the whole piece — the pair is
  //    internally consistent; the stale pre-migration 9:16 was not, which is how it was caught)
  for (const k of ['determinant', 'tangent', 'odd-squares']) {
    const md5s = [];
    for (const f of ['16x9', '9x16']) {
      const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(ROOT, 'films', k, 'out', `final-${f}.mp4`), '-map', '0:a', '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' });
      md5s.push((r.stdout || '').trim().replace(/^MD5=/, ''));
    }
    need(md5s[0] && md5s[0] === md5s[1], `films/${k}: the two formats' audio streams differ (${md5s[0]} vs ${md5s[1]}) — one mix per piece`);
  }
  facts.push('audio-pair consistency: both formats of each demo mux the same mix');

  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
