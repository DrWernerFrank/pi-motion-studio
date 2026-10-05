// tools (P9): the math_* pi surface. Mirrors engine/verify/tools.mjs (the edit check) and goes one
// further: math-tools.ts is loaded for REAL — a byte-identical copy in a scratch "farm" whose
// engine/ and films/ are symlinks to this repo and whose node_modules resolves @earendil-works
// from pi's install (pi's own loader resolves it inside its bundle; node cannot, from the repo) —
// the tools register against a stub ExtensionAPI and the cheap tool paths RUN against
// films/mathdemo. This box runs ONE manim render at a time (6.8 GB shared with sibling agents):
//  - legs that spawn no manim render run live unconditionally (math_status, math_script's parser,
//    math_where, math_voice's piper, math_gate's lint/claims drivers + ffmpeg — verified render-free);
//  - math_look runs live only when mathdemo's draft is FRESH (lookMath re-renders when stale — a
//    render); a stale draft (a sibling edited studio_manim since the last render) makes the leg
//    structural and asserts the pre-existing sheet instead;
//  - math_check + math_scene (check) are manim `--dry_run` renders: they go through the tools' own
//    render-window guard; a busy window (sibling holds the ONE render slot) skips them honestly;
//  - math_render NEVER renders in this check: renderMathFilm runs an internal per-scene pool (up
//    to 4 parallel drafts, ADR-004) — starting that on a box 5 siblings share would be a hard-rule
//    violation. The check verifies the import + the unknown-format rejection (the dry path, which
//    throws before any render) and leaves live render coverage to the perf/scene-cache checks.
import { existsSync, readFileSync, rmSync, mkdirSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../lib/serve.mjs';

const TOOL_NAMES = ['math_status', 'math_script', 'math_voice', 'math_scene', 'math_look', 'math_check', 'math_render', 'math_gate', 'math_where'];
const KEY = 'mathdemo'; // the real, working, voiced math film (20.8 s, both formats)

// flat frontmatter (the format every existing skill/agent uses — same parser as the edit docs check)
function loadFm(p) {
  try {
    const raw = readFileSync(p, 'utf8');
    const fm = {};
    for (const line of raw.split('---\n')[1].split('\n')) {
      const m = /^([a-z_-]+):\s*(.*)$/.exec(line);
      if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return { ok: true, fm, body: raw.split('---\n').slice(2).join('---\n') };
  } catch { return { ok: false }; }
}

// the render window, shared with the tools' own guard: only real python processes hold it
// (wrapper shells that merely EMBED the pgrep pattern are filtered by /proc/<pid>/comm)
const manims = () => {
  try {
    const r = spawnSync('pgrep', ['-f', '--', '-m manim render'], { encoding: 'utf8' });
    return (r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).filter((pid) => {
      try { return /^python/.test(readFileSync(`/proc/${pid}/comm`, 'utf8').trim()); } catch { return false; }
    });
  } catch { return []; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// sustained quiet (3 samples): a sibling check mid-run has 1-3 s gaps between its scene renders
async function tryWindow(budgetMs = 90_000) {
  const end = Date.now() + budgetMs;
  let quiet = 0;
  while (Date.now() < end) {
    const busy = manims();
    quiet = busy.length ? 0 : quiet + 1;
    if (quiet >= 3) return true;
    await sleep(busy.length ? 3000 : 2000);
  }
  return false;
}
const isBusy = (e) => /another Manim render is running/.test(String(e?.message || e));

export default async (ctx = {}) => {
  const bad = [], facts = [], live = [], skipped = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const root = ctx.root || ROOT;
  const t0 = Date.now();

  // -- 1. structural: math-tools.ts registers every tool by name with a Type.Object schema ------
  const src = readFileSync(join(root, '.pi', 'extensions', 'motion-tools', 'math-tools.ts'), 'utf8');
  const registerCount = [...src.matchAll(/registerTool\(/g)].length;
  need(registerCount >= TOOL_NAMES.length, `math-tools.ts registers ${registerCount} tools, wanted ${TOOL_NAMES.length}`);
  for (const n of TOOL_NAMES) {
    need(new RegExp(`name:[ ]*["']${n}["']`).test(src), `math-tools.ts does not register "${n}"`);
    const at = src.indexOf(`"${n}"`);
    const block = src.slice(at, src.indexOf('registerTool', at + 20) > 0 ? src.indexOf('registerTool', at + 20) : src.length);
    need(/parameters:\s*Type\.Object/.test(block), `tool "${n}" has no Type.Object schema in its block`);
  }
  const idx = readFileSync(join(root, '.pi', 'extensions', 'motion-tools', 'index.ts'), 'utf8');
  for (const n of TOOL_NAMES) need(new RegExp(`["']${n}["']`).test(idx), `"${n}" missing from index.ts BY_FILE`);
  need(/import mathTools from ["']\.\/math-tools\.ts["']/.test(idx), 'index.ts does not import math-tools.ts');
  need(/\bmathTools\(pi\)/.test(idx), 'index.ts does not call mathTools(pi): the tools would never register');
  need(/MATH_TOOLS, \[["']math_status["']/.test(idx), 'index.ts has no BY_FILE entry for math-tools.ts');
  // the render-bearing tools guard the ONE-render rule inside themselves
  need(/renderWindow/.test(src), 'math-tools.ts has no render-window guard (this box: ONE manim render at a time)');
  facts.push(`${TOOL_NAMES.length} tools registered (named, Type.Object schemas), BY_FILE lists them, index.ts wires them in, the render window is guarded`);

  // -- 2. the skill + both agents exist and their frontmatter parse (docs does the deep parse) --
  const skill = loadFm(join(root, '.pi', 'skills', 'math-video', 'SKILL.md'));
  const critic = loadFm(join(root, '.pi', 'agents', 'math-critic.md'));
  const animator = loadFm(join(root, '.pi', 'agents', 'math-animator.md'));
  need(skill.ok && critic.ok && animator.ok, 'a math skill/agent frontmatter does not parse');
  need(skill.ok && skill.fm.name === 'math-video' && (skill.fm.description || '').length > 80, 'math-video skill frontmatter incomplete');
  need(critic.ok && /math_look|math_status/.test(critic.body) && (critic.fm.tools || '').includes('film_review'), 'math-critic does not name its tools / cannot record reviews');
  need(critic.ok && critic.fm.model === 'moreweb/glm-5.3-max', `math-critic model is ${critic.fm.model}, wanted moreweb/glm-5.3-max`);
  need(animator.ok && animator.fm.model === 'moreweb/glm-5.3-max' && /ONE scene|one scene/i.test(animator.body), 'math-animator frontmatter/one-scene discipline incomplete');
  facts.push('skill math-video + agents math-critic/math-animator parse (models moreweb/glm-5.3-max)');

  // -- 3. load math-tools.ts for real and run the no-render paths against films/mathdemo ---------
  const farm = join(ctx.cache || join(tmpdir(), 'verify-math-tools'), 'farm');
  const scope = [join(homedir(), '.pi', 'agent', 'npm', 'node_modules', '@earendil-works')].find((p) => existsSync(p));
  if (!scope) bad.push('@earendil-works (pi-ai) not found on this machine: the live-registration farm cannot run');
  else {
    rmSync(farm, { recursive: true, force: true });
    for (const d of [join(farm, 'node_modules'), join(farm, '.pi', 'extensions', 'motion-tools')]) mkdirSync(d, { recursive: true });
    symlinkSync(scope, join(farm, 'node_modules', '@earendil-works'), 'dir');
    symlinkSync(join(root, 'engine'), join(farm, 'engine'), 'dir');
    symlinkSync(join(root, 'films'), join(farm, 'films'), 'dir');
    const file = join(farm, '.pi', 'extensions', 'motion-tools', 'math-tools.ts');
    writeFileSync(file, src); // byte-identical copy: ROOT inside it resolves to the farm, whose engine/films point here
    const tools = [];
    try {
      (await import(pathToFileURL(file).href)).default({ registerTool: (t) => tools.push(t) });
    } catch (e) { bad.push(`math-tools.ts does not load: ${String(e.message || e).split('\n')[0]}`); }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of TOOL_NAMES) need(!!byName[n], `live registration: "${n}" did not register (got ${tools.map((t) => t.name).join(',') || 'none'})`);
    const run = async (name, params) => {
      const r = await byName[name].execute('tools-check', params);
      return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), img: r.content.find((c) => c.type === 'image') || null, details: r.details };
    };
    if (byName.math_status) {

      // -- math_status: the real state, read straight from the film (node only) ------------------
      try {
        const s = await run('math_status', { film: KEY });
        need(/kind math/.test(s.text) && /s01_hook/.test(s.text) && /s02_meaning/.test(s.text) && /s03_recap/.test(s.text), `math_status scenes: ${s.text.split('\n').slice(0, 6).join(' | ')}`);
        need(/16:9/.test(s.text) && /9:16/.test(s.text) && /timing native/.test(s.text), `math_status timing: ${s.text.split('\n').slice(5, 8).join(' | ')}`);
        need(/claims: \d+ merged \(\d+ verified/.test(s.text), `math_status claims: ${s.text.split('\n').find((l) => l.startsWith('claims'))}`);
        need(s.details?.claimsOk === s.details?.claims, `math_status has unverified claims: ${JSON.stringify(s.details)}`);
        need(s.details?.voiced === s.details?.sentences, `math_status voiced ${s.details?.voiced}/${s.details?.sentences}`);
        live.push(`math_status (${s.details.scenes} scenes, ${s.details.sentences} sentences voiced, ${s.details.claimsOk}/${s.details.claims} claims verified)`);
      } catch (e) { bad.push(`math_status: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }

      // -- math_script: parse + lint (stable ids, bookmarks, the raw-symbol flags) --------------
      for (const action of ['parse', 'lint']) {
        try {
          const r = await run('math_script', { film: KEY, action });
          need(/sentences in \d+ scenes/.test(r.text) && (action === 'parse' ? /\[s01\.1\]/.test(r.text) : /lint/.test(r.text)), `math_script ${action}: ${r.text.slice(0, 100)}`);
          live.push(`math_script ${action}`);
        } catch (e) { bad.push(`math_script ${action}: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }
      }

      // -- math_where: 3 seeded timecodes resolve to scene/sentence/animation/code (node only) --
      for (const t of [0.5, 12.0, 19.5]) {
        try {
          const r = await run('math_where', { film: KEY, t });
          need(/→ scene s0\d_\w+/.test(r.text) && /code: scenes\/s0\d_\w+\.py/.test(r.text), `math_where @${t}s: ${r.text.split('\n')[0]}`);
          const W = await import(pathToFileURL(join(root, 'engine', 'where.mjs')).href);
          const w = W.resolveWhere(KEY, t);
          need(w.scene === r.details.scene && (w.sentence?.id ?? null) === r.details.sentence, `math_where @${t}s disagrees with resolveWhere (${w.scene}/${w.sentence?.id} vs ${r.details.scene}/${r.details.sentence})`);
          live.push(`math_where @${t}s → ${r.details.scene}${r.details.sentence ? `/${r.details.sentence}` : ''} (${r.details.file}${r.details.line ? ':' + r.details.line : ''})`);
        } catch (e) { bad.push(`math_where @${t}s: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }
      }

      // -- math_look: live only when the draft is FRESH (a stale draft = a re-render = the window)
      //    otherwise structural: assert the pre-existing sheet the earlier look produced.
      try {
        const M = await import(pathToFileURL(join(root, 'engine', 'math.mjs')).href);
        const MC = await import(pathToFileURL(join(root, 'engine', 'math-cli.mjs')).href);
        const film = M.readMathFilm(KEY);
        const fmt = film.cfg.formats?.[0] || '16:9';
        const draft = join(film.out, `draft-${fmt}.mp4`);
        const sheet = join(film.out, 'sheets', `phone-${fmt.replace(':', 'x')}.png`);
        if (existsSync(draft) && !MC.draftStale(film, draft)) {
          const r = await run('math_look', { film: KEY, mode: 'phone', fmt });
          need(r.img && r.img.data.length > 4000 && r.img.mimeType === 'image/png', 'math_look phone returned no PNG image');
          need(existsSync(join(root, String(r.details?.file ?? ''))), `math_look sheet missing: ${r.details?.file}`);
          live.push(`math_look phone ${fmt} (sheet ${r.details.file}, ${/(\d+) frames/.exec(r.text)?.[1] ?? '?'} frames — fresh draft, no render)`);
        } else {
          need(existsSync(sheet), `math_look structural: the draft is stale (a sibling edited engine/manim since the last render) AND the pre-existing sheet ${sheet.replace(root + '/', '')} is gone`);
          skipped.push(`math_look (live) — the draft is stale: re-rendering takes the ONE-render window siblings are using; the pre-existing sheet is asserted instead`);
        }
      } catch (e) {
        if (isBusy(e)) skipped.push('math_look (live) — the render window was taken mid-leg');
        else bad.push(`math_look: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`);
      }

      // -- math_voice: one-sentence re-voice (piper, no manim) + the D-014 mtime rule ------------
      const timingJson = join(root, 'films', KEY, 'timing.json');
      const before = existsSync(timingJson) ? { content: readFileSync(timingJson, 'utf8'), mtime: statSync(timingJson).mtimeMs } : null;
      try {
        const v = await run('math_voice', { film: KEY, sentence: 's01.1' });
        need(/voice piper:/.test(v.text) && /s01\.1/.test(v.text), `math_voice: ${v.text.slice(0, 120)}`);
        need(v.details?.voiced >= 1 && v.details?.sentences >= 4, `math_voice details: ${JSON.stringify(v.details)}`);
        // deterministic piper re-voices to identical timing; the tool must keep the draft fresh (D-014)
        if (before && readFileSync(timingJson, 'utf8') === before.content)
          need(Math.abs(statSync(timingJson).mtimeMs - before.mtime) < 5, 'math_voice staled the draft: identical timing.json content must keep its mtime (D-014)');
        live.push('math_voice (re-voiced s01.1; timing mtime preserved)');
      } catch (e) { bad.push(`math_voice: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }

      // -- math_gate: the gates read records + run the lint/claims drivers — no render -----------
      if (existsSync(join(root, 'engine', 'math-gates.mjs'))) {
        try {
          const r = await run('math_gate', { film: KEY });
          need(/gates (PASS|FAIL)/.test(r.text), `math_gate: ${r.text.slice(0, 120)}`);
          live.push(`math_gate (${r.details.pass ? 'PASS' : 'FAIL'}, ${((r.text.match(/WARN/g) || []).length)} warn)`);
        } catch (e) { bad.push(`math_gate: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }
      } else {
        need(/math-gates\.mjs/.test(src) && /runMathGates/.test(src), 'math_gate does not code against the runMathGates contract');
        let rejects = null;
        try { await byName.math_gate.execute('tools-check', { film: KEY }); } catch (e) { rejects = String(e.message || e); }
        need(/not wired yet|math-gates\.mjs/.test(rejects || ''), `math_gate with no gates module must say so loudly, got: ${rejects}`);
        skipped.push('math_gate (live) — engine/math-gates.mjs not wired yet; the import contract + the loud not-wired error asserted');
      }

      // -- math_render: STRUCTURAL by design — renderMathFilm's internal pool renders in parallel
      //    (ADR-004); this check must never start that on a box 5 siblings share. The dry path
      //    (unknown format) throws BEFORE any render; the perf/scene-cache checks own live renders.
      try {
        const M = await import(pathToFileURL(join(root, 'engine', 'math.mjs')).href);
        need(typeof M.renderMathFilm === 'function', 'renderMathFilm is not importable (math_render would have nothing to call)');
        let rejected = null;
        try { await M.renderMathFilm(KEY, { quality: 'draft', fmt: 'bogus' }); } catch (e) { rejected = String(e.message || e); }
        need(/unknown format bogus/.test(rejected || ''), `the dry render path did not reject cleanly: ${rejected}`);
        skipped.push("math_render (live) — by design: a live render runs renderMathFilm's internal per-scene pool (up to 4 parallel drafts, ADR-004), not something this check starts while siblings share the box; import + the pre-render unknown-format rejection asserted (live render coverage: perf-budget/scene-cache checks)");
      } catch (e) { bad.push(`math_render structural: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`); }

      // -- math_check + math_scene (check): manim --dry_run renders — through the tools' own
      //    window guard. One probe bounds the wait; busy => both structural, honestly.
      let window = false;
      try { window = await tryWindow(90_000) || await tryWindow(90_000); } catch { window = false; }
      if (window) {
        try {
          const r = await run('math_check', { film: KEY, independent: true });
          need(r.details?.scenes > 0, `math_check returned no scene rows: ${r.text.slice(0, 140)}`);
          const clean = r.details?.ok ?? 0, total = r.details?.scenes ?? 0;
          const lines = r.text.split('\n');
          const fails = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('FAIL  ')) {
              const block = [lines[i]];
              for (let j = i + 1; j < lines.length && !/^(ok    |FAIL  |check:)/.test(lines[j]); j++) block.push(lines[j]);
              fails.push(block.join('\n'));
            }
          }
          need(!fails.length, `math_check: ${fails.length}/${lines.filter((l) => l.startsWith('ok    ')).length + fails.length} scenes failed — ${fails.map((b) => b.split('\n').slice(0, 2).join(' | ')).join(' || ')}`);
          need(r.details?.independent?.agree === r.details?.independent?.total, `math_check independent: ${JSON.stringify(r.details?.independent)}`);
          live.push(`math_check (${clean}/${total} scenes clean; independent ${r.details.independent.agree}/${r.details.independent.total} claims re-derived in fresh sympy processes)`);
        } catch (e) {
          if (isBusy(e)) skipped.push('math_check (live) — the render window was taken by a sibling mid-leg');
          else bad.push(`math_check: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`);
        }
        try {
          const r = await run('math_scene', { film: KEY, scene: 's02_meaning', quality: 'check' });
          need(/s02_meaning/.test(r.text) && r.details?.pass === true, `math_scene check: ${r.text.slice(0, 160)}`);
          live.push('math_scene check s02_meaning (clean, dry)');
        } catch (e) {
          if (isBusy(e)) skipped.push('math_scene (live) — the render window was taken by a sibling mid-leg');
          else bad.push(`math_scene check: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`);
        }
      } else {
        skipped.push("math_check + math_scene (live) — the ONE-render window stayed busy (siblings render; the tools' own guard would wait minutes): structural here — the same checkMathFilm/CLI check call the quiet-box full run exercises");
        need(/checkMathFilm/.test(src), 'math_check/math_scene do not call checkMathFilm (the structural contract)');
      }
    }
    rmSync(farm, { recursive: true, force: true });
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const ran = live.length ? `live: ${live.join(' · ')}` : 'live: none';
  const skip = skipped.length ? ` · structural (honest): ${skipped.join(' · ')}` : '';
  return { pass: bad.length === 0, measured: `${bad.length ? 'FAIL: ' + bad.join('; ') + ' || ' : ''}${facts.join('; ')} · ${ran}${skip} [${secs}s]` };
};
