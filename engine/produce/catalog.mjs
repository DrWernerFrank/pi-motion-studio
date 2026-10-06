// The capability catalog (K2): every *technique* (something that makes a piece: motion, edit, math,
// project, and whatever K12 grows) and every *service* (a reusable capability any technique calls:
// voice, asr, captions, mix, capture, ingest, assemble, stock, data). `studio capabilities` prints
// it with readiness from REAL probes (a missing dependency reports not-ready and the fix); the
// plan validator only offers capabilities that exist and are ready (or flags them, never hides).
//
// A catalog entry is plain JSON (schema below) so it can be served to the GUI, embedded in a
// plan's decision, and validated. The K2 sketch is the contract:
//   { id, type: 'technique'|'service', makes, strengths, weak, typical: { duration, formats },
//     needs, ready (a doctor probe id or 'yes'), invoke: { create, look, render, gate, ship, ... },
//     gates, tools, skill, critic }
import { join } from 'node:path';
import { ROOT } from '../lib/serve.mjs';

// what a valid entry looks like — validated on load; a malformed entry is rejected WITH ITS PATH
export const SCHEMA = {
  type: 'object',
  required: ['id', 'type', 'makes', 'invoke', 'gates'],
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    type: { enum: ['technique', 'service'] },
    makes: { type: 'array', items: { type: 'string' }, minItems: 1 },
    strengths: { type: 'array', items: { type: 'string' } },
    weak: { type: 'array', items: { type: 'string' } },
    typical: {
      type: 'object', properties: {
        duration: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        formats: { type: 'array', items: { type: 'string' } },
      },
    },
    needs: { type: 'array', items: { type: 'string' } },
    ready: { type: 'string' },                 // a doctor probe id, or 'yes' for always-ready
    invoke: { type: 'object', additionalProperties: { type: 'string' } },
    gates: { type: 'array', items: { type: 'string' } },
    tools: { type: 'array', items: { type: 'string' } },
    skill: { type: 'string' },
    critic: { type: 'string' },
  },
};

// The built-in catalog. Entries live with their kind where one exists (engine/kinds/<kind>/index.mjs
// exports `capability`); services live here. This is the ONE merge point: a grown capability (K12)
// adds its module and its entry joins automatically via the kind registry's scan.
export const SERVICES = [
  {
    id: 'voice', type: 'service', makes: ['narration from a script (deterministic local TTS, native word timings)'],
    strengths: ['sample-exact word timings', 'deterministic', 'en/en_GB/fa voices', 'bring-your-own narration.wav (ADR-003)'],
    weak: ['synthetic voice', 'no singing or emotion direction'],
    needs: ['piper voices'], ready: 'voice',
    invoke: { use: 'film.json voice + script.md (any kind) — studio sound <key>' },
    gates: ['timing.json start/end/words per sentence', 'narration bus at mix.lufs'],
  },
  {
    id: 'asr', type: 'service', makes: ['word-level transcripts of ingested audio/video (local ASR)'],
    strengths: ['local (never uploaded)', 'word boundaries refined against audio', 'cached by content hash'],
    weak: ['accuracy drops on heavy accents/noise', 'no speaker diarization'],
    needs: ['ml-venv + whisper small'], ready: 'asr',
    invoke: { use: 'studio transcribe <key> <src-id>; studio transcript <key> <src-id> --grep …' },
    gates: ['WER <= 15% on speech fixtures', 'monotonic words'],
  },
  {
    id: 'captions', type: 'service', makes: ['on-screen captions (en/RTL) + SRT/VTT from the same chunks'],
    strengths: ['design-aware (3 styles from design.json)', 'safe-area + phone test', 'fa/ar RTL shaping'],
    weak: ['burned-in by design (not toggleable post-render)'],
    needs: ['Vazirmatn (fa)'], ready: 'yes',
    invoke: { use: 'edit films: edit caption-style op; math: studio sound writes SRT/VTT; studio captions <key>' },
    gates: ['<= 2 lines, >= 3.2u, no tofu, monotonic SRT/VTT'],
  },
  {
    id: 'mix', type: 'service', makes: ['one audio mix at a target loudness (music bed + SFX + narration/dialog)'],
    strengths: ['loudnorm to -14/-16 LUFS, -1 dBTP', 'bed ducked 10-14 dB under speech', 'measured, not guessed'],
    weak: ['no multichannel delivery'],
    needs: ['ffmpeg'], ready: 'yes',
    invoke: { use: 'studio sound <key> (any kind)' },
    gates: ['loudness gate (LUFS ±1, <= -1 dBTP)'],
  },
  {
    id: 'capture', type: 'service', makes: ['real screenshots, logos, colors and fonts of a site (the brand truth)'],
    strengths: ['real pixels, never redrawn from imagination', 'site.json carries palette+fonts'],
    weak: ['needs a reachable URL', 'some sites block headless browsers'],
    needs: ['chromium'], ready: 'yes',
    invoke: { use: 'studio capture <key> <https://url>' },
    gates: ['assets/ contains the captures; site.json parses'],
  },
  {
    id: 'ingest', type: 'service', makes: ['conformed, probe-true media from any real file (CFR, upright, SDR bt709)'],
    strengths: ['NTSC rationals exact', 'HLG tonemapped', 'relink by hash', 'silence map + filmstrip'],
    weak: ['conform costs one pass per source'],
    needs: ['ffmpeg + ffprobe'], ready: 'yes',
    invoke: { use: 'studio ingest <key> <file> --id <src-id>' },
    gates: ['media.json == ffprobe', 'ingest-conform (CFR/bt709/yuv420p)'],
  },
  {
    id: 'assemble', type: 'service', makes: ['one piece from segments rendered by any technique'],
    strengths: ['edit-film assembly: captions/reframe/sound/ship already exist', 'designed joins (no black frames)', 'one loudness pass'],
    weak: ['each segment encoded at most once more (K8)'],
    needs: ['ingest'], ready: 'yes',
    invoke: { use: 'studio ingest <key> <segment-final.mp4> --id s01 (an edit film assembles); studio project assemble <key> lands with P3' },
    gates: ['assemble check: geometry, bt709, A/V within 1 frame, PSNR per segment'],
  },
];

/** The full catalog: kind techniques (via the registry scan) + the services. */
export async function catalog() {
  const { allKinds } = await import('../kinds/registry.mjs');
  const kinds = await allKinds();
  const out = [];
  for (const [name, mod] of Object.entries(kinds).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const cap = typeof mod.capability === 'function' ? await mod.capability() : mod.capability;
    if (!cap) continue;   // a kind that is not user-facing as a technique (project becomes one in P2)
    out.push({ id: name, type: 'technique', ...cap });   // kind entries are techniques by definition
  }
  for (const s of SERVICES) out.push(s);
  // determinism: a stable, sorted catalog (a plan references entries by id)
  out.sort((a, b) => a.id < b.id ? -1 : 1);
  return out;
}

/** Validate one entry against the schema (a home-grown check: no dependency — house style). */
export function validateEntry(entry, path) {
  const bad = [];
  const push = (w) => bad.push(`${path}: ${w}`);
  if (!entry || typeof entry !== 'object') return [`${path}: not an object`];
  for (const k of SCHEMA.required) if (entry[k] === undefined) push(`missing "${k}"`);
  if (!/^[a-z][a-z0-9-]*$/.test(entry.id ?? '')) push(`id "${entry.id}" must match ^[a-z][a-z0-9-]*$`);
  if (!['technique', 'service'].includes(entry.type)) push(`type must be technique|service (got ${entry.type})`);
  if (!Array.isArray(entry.makes) || !entry.makes.length) push('makes: a non-empty array of strings');
  if (entry.invoke && typeof entry.invoke !== 'object') push('invoke: an object of strings');
  if (entry.gates !== undefined && !Array.isArray(entry.gates)) push('gates: an array');
  if (entry.typical?.duration && (entry.typical.duration.length !== 2 || entry.typical.duration.some((n) => typeof n !== 'number')))
    push('typical.duration: [min, max] seconds');
  return bad;
}

/** The catalog, validated; any malformed entry throws WITH ITS PATH. */
export async function validatedCatalog() {
  const entries = await catalog();
  const bad = [];
  for (const e of entries) bad.push(...validateEntry(e, `catalog entry "${e.id}"`));
  for (const s of SERVICES) bad.push(...validateEntry(s, `engine/produce/catalog.mjs SERVICES/${s.id}`));
  if (bad.length) throw new Error(`malformed catalog entries:\n  ${bad.join('\n  ')}`);
  return entries;
}

void join; void ROOT;
