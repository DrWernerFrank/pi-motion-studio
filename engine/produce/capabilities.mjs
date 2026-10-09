// The capabilities surface: `studio capabilities [<id>] [--json]` — the catalog with readiness
// from REAL probes (K2). Readiness resolves doctor probe ids against a probe map; a not-ready
// capability carries its fix. The doc page docs/produce/CAPABILITIES.md is generated from the
// same source (never hand-written — one truth).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { validatedCatalog } from './catalog.mjs';
import { ROOT } from '../lib/serve.mjs';

/** Which doctor probe ids the catalog may reference, and the cheap probe behind each.
 *  A capability whose `ready` is not 'yes' must name one of these; unknown probe = not-ready
 *  with the fix "add the probe to doctor.mjs's PROBES". */
export const PROBES = {
  voice: { run: 'studio doctor --math', check: (r) => r.find((i) => i.id === 'voice' && i.ok), fix: 'install a piper voice (docs/math/ADR-003-voice.md)' },
  asr: { run: 'studio doctor', check: (r) => r.find((i) => i.id === 'asr' && i.ok), fix: 'install the ML venv + whisper small (docs/editing/ADR-002-asr.md)' },
  'doctor:manim': { run: 'studio doctor --math', check: (r) => r.find((i) => i.id === 'manim' && i.ok), fix: 'build the manim venv (docs/math/ADR-001-toolchain.md)' },
};

/** Resolve one entry's readiness: { ready: bool, detail, fix? }. Probes run at most once. */
async function resolve(entry, doctorItems) {
  if (!entry.ready || entry.ready === 'yes') return { ready: true, detail: 'always ready' };
  const probe = PROBES[entry.ready];
  if (!probe) return { ready: false, detail: `unknown probe "${entry.ready}"`, fix: `add a doctor probe "${entry.ready}" (engine/doctor.mjs) or set ready: "yes"` };
  const hit = probe.check(doctorItems);
  return hit ? { ready: true, detail: hit.detail } : { ready: false, detail: `${entry.ready} probe red`, fix: probe.fix };
}

/** The catalog with readiness: [{ ...entry, readiness }]. */
export async function capabilitiesWithReadiness() {
  const { doctor } = await import('../doctor.mjs');
  // the probe surface the catalog references: run doctor once with --math's probes included
  const items = (await doctor({ math: true })).items;
  const entries = await validatedCatalog();
  const out = [];
  for (const e of entries) out.push({ ...e, readiness: await resolve(e, items) });
  return out;
}

/** Every invoke command exists in `studio help`? Returns the list of missing ones. */
export async function invokeCoverage() {
  const help = execFileSync(process.execPath, [join(ROOT, 'engine', 'cli.mjs'), 'help'], { encoding: 'utf8' });
  const entries = await validatedCatalog();
  const missing = [];
  for (const e of entries) for (const [k, cmd] of Object.entries(e.invoke || {})) {
    // invoke values are commands with <placeholders>: the first word (studio|node) + the subcommand
    // must appear in help. `studio` itself is the wrapper the user runs.
    const words = String(cmd).split(/\s+/).filter(Boolean);
    if (words[0] === 'studio' && words[1] && !/^<|^help$/.test(words[1])) {
      const re = new RegExp(`(^|\\s)${words[1]}(\\s|<|$)`);
      if (!re.test(help)) missing.push(`${e.id}.invoke.${k}: "${words[1]}" not in studio help`);
    }
  }
  return missing;
}

/** Render the catalog as the human table (and the generated doc page). */
export function table(rows) {
  const lines = [];
  for (const r of rows) {
    const tag = r.type === 'technique' ? 'technique' : 'service  ';
    const ready = r.readiness.ready ? 'ready    ' : 'NOT-READY';
    lines.push(`${ready} ${tag}  ${r.id.padEnd(10)} ${r.makes[0].slice(0, 58)}`);
    if (!r.readiness.ready) lines.push(`           fix: ${r.readiness.fix || r.readiness.detail}`);
  }
  return lines.join('\n');
}

/** docs/produce/CAPABILITIES.md, generated (the docs check asserts it exists and is not stale). */
export function markdownDoc(rows) {
  const at = new Date().toISOString().slice(0, 10);
  const md = [`# The capability catalog (generated ${at} by \`studio capabilities --doc\`)`, '',
    'A *technique* makes a piece; a *service* is a reusable capability any technique calls. This',
    'page is generated from the same source as `studio capabilities` — edit the catalog, not this file.', ''];
  for (const r of rows) {
    md.push(`## ${r.id} — ${r.type}${r.readiness.ready ? '' : ' (NOT READY: ' + (r.readiness.fix || r.readiness.detail) + ')'}`, '');
    md.push(`**Makes:** ${r.makes.join('; ')}.`);
    if (r.strengths?.length) md.push(`**Strengths:** ${r.strengths.join('; ')}.`);
    if (r.weak?.length) md.push(`**Weak:** ${r.weak.join('; ')}.`);
    if (r.typical) md.push(`**Typical:** ${r.typical.duration ? `${r.typical.duration[0]}-${r.typical.duration[1]} s` : ''}${r.typical.formats ? `, ${r.typical.formats.join(' + ')}` : ''}`);
    if (r.needs?.length) md.push(`**Needs:** ${r.needs.join(', ')}.`);
    if (r.invoke && Object.keys(r.invoke).length) md.push(`**Invoke:** ${Object.entries(r.invoke).map(([k, v]) => `\`${v}\``).join(' · ')}`);
    if (r.gates?.length) md.push(`**Gates:** ${r.gates.join(', ')}.`);
    if (r.skill) md.push(`**Skill:** \`.pi/skills/${r.skill}/SKILL.md\`${r.critic ? ` · **Critic:** \`.pi/agents/${r.critic}.md\`` : ''}`);
    md.push('');
  }
  return md.join('\n');
}
void homedir;
