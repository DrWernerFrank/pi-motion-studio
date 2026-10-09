// The math kind: narrated math films (Manim scenes, sympy-verified claims, the narration clock).
// The hooks are byte-exact moves of the CLI's former math paths (ADR-001); the pipeline modules
// (math.mjs, narration.mjs, math-gates.mjs, math-cli.mjs, where.mjs) stay where they are.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFilm, readJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { createMathFilm, lookMath } from '../../math-cli.mjs';
import { checkMathFilm, renderMathFilm } from '../../math.mjs';
import { runMathGates } from '../../math-gates.mjs';
import { buildMix, buildVoice } from '../../narration.mjs';
import { resolveWhere } from '../../where.mjs';

const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

export function create(key, { title, formats, lang, voice } = {}) {
  const dir = createMathFilm(key, { title: title ?? key, formats, lang: lang ?? 'en', voice });
  return { dir, message: `created ${rel(dir)} (math film)\n  next: studio render ${key} --draft   then   studio look ${key}\n  scenes live in films/${key}/scenes/ — from studio_manim import *; craft: docs/math + the skill` };
}

export async function look(key, opts = {}) { return lookMath(key, opts); }
export async function render(key, { quality = 'final', fmt, from, to } = {}) {
  void from; void to;   // math films render whole films (scene slices go through scene())
  return renderMathFilm(key, { quality, fmt: fmt === true ? undefined : fmt });
}
export async function scene(key, id, { quality = 'draft', fmt } = {}) {
  return renderMathFilm(key, { quality, fmt: fmt === true ? undefined : fmt, scene: id });
}
export async function gate(key) { return runMathGates(key); }

export async function check(key, { scene } = {}) {
  const rows = await checkMathFilm(key, { scene: scene === true ? undefined : scene });
  let bad = 0;
  for (const r of rows) { if (r.ok) console.log(`ok    ${r.scene}: typeset + ${r.claims} claim(s)`); else { bad++; console.log(`FAIL  ${r.scene}:\n${r.error}`); } }
  console.log(`check: ${rows.length - bad}/${rows.length} scenes clean`);
  return { pass: bad === 0, rows };
}

export function where(key, t, fmt) {
  const r = resolveWhere(key, t, fmt === true ? undefined : fmt);
  console.log(`${r.t}s → scene ${r.scene} (scene_t ${r.scene_t}s) · ${r.sentence ? `${r.sentence.id} “${r.sentence.text.slice(0, 48)}”` : 'no sentence'}${r.bookmark ? ` · near {${r.bookmark.id}}@${r.bookmark.t}s` : ''}${r.overrun ? ' · OVERRUN nearby' : ''}\n  animation: ${r.animation ? `#${r.animation.i} ${r.animation.name} @${r.animation.t}s` : 'none'}\n  code: ${r.file}${r.line ? ':' + r.line : ''}`);
  return r;
}

export async function sound(key) {
  // the math narration bus: voice → timing → mix at mix.lufs
  const v = await buildVoice(key); console.log(`voice: ${v.sentences.length} sentences, ${v.duration.toFixed(2)}s, timing ${v.timing}`);
  const m = await buildMix(key); console.log(`${rel(m.file)}  ${m.lufs} LUFS, true peak ${m.truePeak} dBTP${m.warning ? '  (warning: ' + m.warning + ')' : ''}`);
  // captions ride the narration: the SRT/VTT are written with the mix (the critic found
  // the config said ON while no artifact existed — the gate now checks the files)
  const caps = readFilm(key).cfg.captions ?? 'auto';
  if (caps !== 'off') {
    const { exportCaptions } = await import('../../math-captions.mjs');
    const c = exportCaptions(key); console.log(`${c.cues} cues → ${rel(c.srt)}, ${rel(c.vtt)}`);
  }
  return { mix: m.file };
}

export async function ship(key) {
  // gates first (FAIL blocks), then finals in every format, then claims.md (every verified claim)
  console.log('── gates');
  const g = await runMathGates(key);
  if (!g.pass) throw new Error('math gates failed: fix the FAIL lines above before shipping');
  console.log('── render');
  const r = await renderMathFilm(key, { quality: 'final' });
  console.log('── claims');
  // the film-level ledger: every records/<fmt>/*-claims.json, deduped by (expr, says) — D-011
  const recDir = join(readFilm(key).dir, 'records');
  const led = [];
  if (existsSync(recDir)) for (const fmtDir of readdirSync(recDir).filter((f) => existsSync(join(recDir, f)))) {
    for (const x of readdirSync(join(recDir, fmtDir))) {
      if (!x.endsWith('-claims.json')) continue;
      for (const c of (JSON.parse(readFileSync(join(recDir, fmtDir, x), 'utf8')) || []))
        if (!led.some((y) => y.expr === c.expr && y.says === c.says)) led.push(c);
    }
  }
  writeFileSync(join(readFilm(key).dir, 'out', 'claims.md'),
    `# Verified claims — ${key}\n\nEvery mathematical statement in this film, evaluated exactly (sympy) at render time.\n\n${led.map((c) => `- ${c.ok ? '✓' : '✗'} \`${c.expr}\`${c.about ? ` — ${c.about}` : ''}${c.says ? ` (${c.says})` : ''}`).join('\n')}\n`);
  console.log(`${led.length} claims → ${rel(join(readFilm(key).dir, 'out', 'claims.md'))}`);
  console.log('── shipped'); for (const x of r) console.log(`${rel(x.file)}  (${x.seconds}s)`);
  return { pass: true, files: r };
}

// ── the capability catalog entry (K2) ────────────────────────────────────────────────────────
export const capability = {
  makes: ['narrated math/physics/CS explainers, visual proofs, worked examples, derivations'],
  strengths: ['every on-screen number sympy-verified (claims ledger)', 'narration is the timing source', 'format-aware layout (re-compositions)'],
  weak: ['no real footage', 'slow pace by design', 'typesetting needs the venv (first-time install)'],
  typical: { duration: [30, 180], formats: ['16:9', '9:16', '1:1', '4:5'] },
  needs: ['manim-venv', 'voice'], ready: 'doctor:manim',
  invoke: { create: 'studio new <key> --math', look: 'studio look <key>', check: 'studio check <key>',
             render: 'studio render <key> --draft', gate: 'studio gate <key>', ship: 'studio ship <key>' },
  gates: ['layout', 'claims', 'typeset', 'narration', 'sync', 'pace', 'captions', 'loudness', 'deliverable', 'deterministic'],
  tools: ['math_status', 'math_script', 'math_voice', 'math_scene', 'math_look', 'math_check', 'math_render', 'math_gate', 'math_where'],
  skill: 'math-video', critic: 'math-critic',
};

// ── the math extras: GUI flags, the two extra review keys
export function summary(cfg, dir) { void cfg; void dir; return { math: true }; }
export const view = 'math';
export const rubric = ['correctness', 'clarity'];
