#!/usr/bin/env node
// studio: the command surface of the motion studio. `studio help` lists everything.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gridBeats, measureBeats } from './audio.mjs';
import { FILMS, readFilm, readJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';
import { addReview } from './review.mjs';
import { poster } from './stills.mjs';

const HELP = `studio <command> <film> [options]

  new <key> [--title T] [--duration 15] [--formats 9:16,1:1,16:9] [--bpm 120] [--loop]
                         scaffold films/<key> from templates/film
  new <key> --edit [--fps 30000/1001] [--formats 16:9,9:16]
                         scaffold an edit film (real footage): film.json kind=edit, edit.json, index.html
  new <key> --math [--formats 16:9,9:16] [--lang en] [--voice piper:en_US-ljspeech-medium]
                         scaffold a math film (Manim): script.md, design.json, lexicon.json, scenes/*.py
  scene <film> <scene-id> [--draft|--final] [--fmt 9:16]
                         render ONE scene of a math film (default draft) through the memory guard
  check <film> [--scene <id>]
                         math films: run scenes with --dry_run (typesetting + claims, no video)
  where <film> --t <seconds> [--fmt 9:16]
                         math films: which scene, sentence, animation and file owns a timecode
  sound <film>           math films: voice → timing → the narration mix at mix.lufs (a quiet bed if
                         music is set); edit films: the dialog bus + ducked bed at -14 LUFS
  gate <film>            math films: the math gates (layout, claims, typeset, narration, sync, pace,
                         captions, loudness, deliverable, deterministic) → gates.json
  where <film> <t>       math films: which scene, sentence and file owns a timecode
  list                   films with their status
  look <film> [--mode every|beats|shots|strip|times|phone] [--every 0.5] [--at 4.2] [--times 1,2.5]
               [--fmt 9:16] [--width 270]
                         contact sheet straight from seek(t) → out/sheets/*.png (seconds, no encode)
  capture <film> <url>   real screenshots, logos, colors, fonts → films/<film>/assets/ (+ site.json)
  refs <film> <video>    extract reference frames every 0.5s → films/<film>/refs/frames/ + a contact sheet
  poster <film> --at 3.2 full-res still → out/poster-<fmt>.png
  render <film> [--draft] [--fmt 9:16|all] [--from 2 --to 5] [--sub 4] [--workers 4]
                         frames → H.264 (draft: half-res 30fps; final: film fps + motion blur)
  grid <film>            beats.json from film.json music.bpm (synthesized score)
  beats <film>           beats.json measured from film.json "track" (librosa)
  sound <film>           beats (if missing) → music → sfx → mix at -14 LUFS → out/mix.wav
  gate <film>            mechanical gates → gates.json (lint, determinism, dead time, loop, loudness …)
  review <film> --json '{"scores":{…},"problems":[…]}'   record a critique round
  read <film> [--sheet sheets/times-9x16.png] [--prompt "…"] [--model flash|pro|flash_lite|gemini-2.5-pro] [--engine agy|api|gemini]
                         An AI reads a sheet/poster (default: newest). Engine agy = Antigravity agents
                         on your Google AI Pro subscription (no key — default when installed).
                         api = GEMINI_API_KEY vision. gemini = the Gemini CLI agent.
  login-gemini          browser login with your Google account (Pro/Code Assist quota, no API key)
  ship <film>            sound → gate → final render (all formats) → poster → sheets → loop check
  gui                    start the Studio GUI (http://localhost:3142)
  regress [--write]      the four motion films still render identically (frame hashes + gate verdicts
                         vs docs/editing/baseline.json); --write records the baseline
  fixtures [--list] [--only a,b] [--force] [--verify]
                         deterministic test media (barcode clips, VFR/rotated, HLG, long, subject …) → ~/.cache/pi-motion-studio/fixtures
  ingest <film> <file...> [--id cam] [--fps 30000/1001] [--max 1920] [--audio-stream N] [--no-proxy] [--force]
                         conform footage (CFR, upright, SDR bt709, short GOP) + proxy, audio, peaks, filmstrip, scenes, silence map
  transcribe <film> <src-id> [--model small] [--language auto] [--force]
                         word-level transcript of an ingested source (local faster-whisper, cached, refined)
  transcript <film> <src-id> [--from 10 --to 40] [--grep um] [--format compact|words|srt]
                         read the transcript back in ranges/greps an agent can use
  cut <film> <silence|fillers|takes|idle|tighten> [--src cam] [--max-gap 0.5] [--apply] [--target 45]
                         measured cut proposals with the removed text (dry run; --apply goes through edit-ops)
  captions <film> [--format srt|vtt]
                         caption export (.srt/.vtt) from the same chunks the screen shows
  edit <film> [show | ops '<json array>' | undo | redo | sync | export-edl [f] | import-edl <f> | <op> --k v …] [--base-rev N]
                         the timeline as data: add trim split delete ripple-delete move reorder speed freeze volume fade xfade crop-keyframe overlay caption-style marker snap
  autoedit <film> --preset talking-head|screen|audiogram|montage [--src <file>…] [--id cam] [--target 60] [--final]
                         the deterministic pipeline, no LLM: ingest → transcribe → measured cuts → captions →
                         reframe → sound → gates → draft renders of every format (--final ships finals)
  media <film>           the media bin: sources, kinds, durations, whether the originals are still where they were
  relink <film> [--search dir ...]   find moved originals by size + sha256 and repair the bin (and edit.json)
  cache [gc [--dry] [--fixtures]]   disk use of media/outputs/caches; gc removes temp films, orphan media, interrupted-ingest leftovers
  doctor [--fix] [--math]  probe the toolchain: editing by default; --math adds Manim, typesetting,
                         voice, sympy and font probes (docs/math/ADR-001..004)
  verify-edit [--quick] [--list] [--only <id>] [--clean]
                         the real-video-editing contract: every check of the mission, measured → docs/editing/verify-last.json
  verify-math [--quick] [--list] [--only <id>,…] [--clean]
                         the math-video contract: every check of the mission (env, typeset, claims, gates,
                         demos …) → docs/math/verify-last.json
  verify-produce [--quick] [--list] [--only <id>,…] [--clean]
                         the producer contract: every check of the mission (registry, capabilities,
                         plan, ledger, project, assemble, make, demos …) → docs/produce/verify-last.json
  migrate-names [<film>|--all]
                         math films: derived paths to the Windows-safe form (draft-16x9.mp4,
                         records/16x9/), the tracked ones via git mv; idempotent
  capabilities [<id>] [--json] [--doc]
                         the technique/service catalog with readiness from real probes (a missing
                         dependency reports not-ready and the fix); --doc writes the generated
                         docs/produce/CAPABILITIES.md
  project new <key> "<request>" [--formats 16:9,9:16] [--file <input>…]
                         create a project film: the request verbatim in brief.md + the ledgers
  project list           every project: phase, parts, finals
  project status <key>  the project's state: segments, budget, parts
  project plan <key> --check
                         validate plan.json (goal, >= 2 alternatives, capabilities, budget…)
  project requirement <key> add --text "…" --type measurable --verifier duration --arg 60
                         [--waive r02]   the ledger: append an ask, or waive one (the human only)
  project verify <key>   the whole contract: plan validates, requirements green, gates, facts, assets, budget
  project rebuild <key> [--only s01]
                         build the parts that are not done (resume), or exactly the named one
  project ship <key>     verify -> refuse if red -> credits.md + report.md + out/ finals
  project where <key> --t 12.3
                         a timecode -> the segment -> the child's own where (scene, sentence, file:line)
  help                   this text`;

const argv = process.argv.slice(2);
const cmd = argv[0], key = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]; };
const num = (k, d) => (opt(k) === undefined ? d : Number(opt(k)));
const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

async function main() {
  const { hooksFor, kindModule } = await import('./kinds/registry.mjs');
  switch (cmd) {
    case 'new': {
      if (argv.includes('--math')) {
        const dir = (await kindModule('math')).create(key, { title: opt('title', key),
          formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : undefined,
          lang: opt('lang') === true ? 'en' : String(opt('lang') ?? 'en'),
          voice: opt('voice') === true ? undefined : opt('voice') });
        console.log(dir.message);
        break;
      }
      if (argv.includes('--edit')) {
        const dir = (await kindModule('edit')).create(key, { title: opt('title', key),
          fps: opt('fps') && opt('fps') !== true ? String(opt('fps')) : 30,
          formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : ['16:9'] });
        console.log(dir.message);
        break;
      }
      const dir = (await kindModule('motion')).create(key, {
        title: opt('title', key), duration: num('duration'),
        formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : undefined,
        loop: opt('loop'), bpm: num('bpm') });
      console.log(dir.message);
      break;
    }
    case 'list': {
      const films = existsSync(FILMS) ? readdirSync(FILMS).filter((f) => existsSync(join(FILMS, f, 'film.json'))) : [];
      if (!films.length) console.log('no films yet: studio new <key>');
      for (const f of films) {
        const { cfg, out } = readFilm(f);
        const reviews = readJson(join(FILMS, f, 'reviews.json'), []), g = readJson(join(FILMS, f, 'gates.json'));
        const finals = readdirSync(out).filter((x) => /^final-[^.]*\.mp4$/.test(x));
        console.log(`${f.padEnd(24)} ${String(cfg.duration + 's').padEnd(5)} ${cfg.formats.join(',').padEnd(16)} ` +
          `review ${reviews.length ? `r${reviews.length} min ${reviews.at(-1).min}` : '-'}  gates ${g ? (g.pass ? 'pass' : 'FAIL') : '-'}  ${finals.join(' ') || 'not rendered'}`);
      }
      break;
    }
    case 'look': {
      const mode = opt('mode', 'every');
      const o = { mode, every: num('every', 0.5), at: num('at', 0), fmt: opt('fmt'), width: opt('width') ? num('width') : undefined,
        times: opt('times') ? String(opt('times')).split(',').map(Number) : undefined, n: num('n', 12) };
      if (mode === 'phone') Object.assign(o, { mode: 'every', every: 1, width: 360, name: `phone-${(o.fmt || readFilm(key).cfg.formats[0]).replace(':', 'x')}`, title: 'phone test 360px' });
      const r = await (await hooksFor(key)).look(key, o);
      console.log(`${rel(r.file)}  (${r.count} frames: ${r.times.join(', ')})`);
      break;
    }
    case 'capture': {
      const url = argv[2];
      if (!url || !/^https?:\/\//.test(url)) throw new Error('studio capture <film> <https://url>');
      await (await import('./capture.mjs')).capture(key, url);
      break;
    }
    case 'refs': {
      const src = argv[2];
      if (!src || !existsSync(src)) throw new Error('studio refs <film> <path/to/reference.mp4>');
      const film = readFilm(key), dir = join(film.dir, 'refs', 'frames');
      mkdirSync(dir, { recursive: true });
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'fps=2,scale=540:-2', join(dir, 'f%04d.png')]);
      const sheet = join(film.dir, 'refs', 'reference-sheet.png');
      await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'fps=2,scale=240:-2,tile=8x6', '-frames:v', '1', sheet]);
      console.log(`${rel(dir)} (${readdirSync(dir).length} frames, one per 0.5s)\n${rel(sheet)}`);
      break;
    }
    case 'poster': console.log(rel((await poster(key, { at: num('at', 0), fmt: opt('fmt') })).file)); break;
    case 'render': {
      const quality = argv.includes('--draft') ? 'draft' : argv.includes('--final') ? 'final' : 'final';
      const r = await (await hooksFor(key)).render(key, { quality, fmt: opt('fmt'),
        from: opt('from') !== undefined ? num('from') : undefined, to: opt('to') !== undefined ? num('to') : undefined,
        sub: opt('sub') !== undefined ? num('sub') : undefined, workers: opt('workers') ? num('workers') : undefined,
        bypassCache: argv.includes('--no-cache') });
      for (const x of r) console.log(rel(x.file));
      break;
    }
    case 'scene': {
      if (!argv[2] || argv[2].startsWith('--')) throw new Error('studio scene <film> <scene-id> [--draft|--final] [--fmt 9:16]');
      const quality = argv.includes('--draft') ? 'draft' : argv.includes('--final') ? 'final' : 'draft';   // one-scene default: draft (fast iteration)
      const r = await (await hooksFor(key)).scene(key, argv[2], { quality, fmt: opt('fmt') === true ? undefined : opt('fmt') });
      for (const x of r) console.log(`${rel(x.file)}  (${x.scenes} scene, ${x.seconds}s)`);
      break;
    }
    case 'check': {
      const r = await (await hooksFor(key)).check(key, { scene: opt('scene') === true ? undefined : opt('scene') });
      process.exitCode = r.pass ? 0 : 1;
      break;
    }
    case 'grid': { const r = gridBeats(key); console.log(`${rel(r.file)}: ${r.beats} beats at ${r.bpm} bpm`); break; }
    case 'beats': { const r = await measureBeats(key); console.log(`${rel(r.file)}: ${r.beats} beats, ${r.hits} hits, ${r.bpm.toFixed(1)} bpm`); break; }
    case 'where': {
      (await hooksFor(key)).where(key, num('t', 0), opt('fmt') === true ? undefined : opt('fmt'));
      break;
    }
    case 'sound': {
      await (await hooksFor(key)).sound(key);
      break;
    }
    case 'gate': {
      const r = await (await hooksFor(key)).gate(key);
      console.log(r.pass ? '\ngates: PASS' : '\ngates: FAIL'); process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'review': {
      const e = addReview(key, JSON.parse(opt('json', '{}')));
      console.log(`round ${e.round}: min ${e.min} → ${e.pass ? 'PASS' : 'fix the worst 3 and look again'}`);
      break;
    }
    case 'ship': {
      await (await hooksFor(key)).ship(key);
      break;
    }
    case 'read': {
      // An AI reads a contact sheet/poster and critiques it. Engines:
      //   agy    — Antigravity agents on the Google AI Pro subscription (default when installed)
      //   api    — bare Gemini API key vision
      //   gemini — the Gemini CLI agent
      const { geminiRead, agentRead } = await import('./lib/gemini.mjs');
      const out = join(FILMS, key, 'out');
      const newest = (dir, sub) => {
        if (!existsSync(dir)) return null;
        const n = readdirSync(dir).filter((f) => /\.png$/i.test(f))
          .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m).at(0);
        return n ? (sub ? `${sub}/${n.f}` : n.f) : null;
      };
      const sheet = String(opt('sheet', '') || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (/[.]{2}/.test(sheet)) throw new Error('sheet must live under films/<key>/out');
      const pick = sheet || newest(join(out, 'sheets'), 'sheets') || newest(out, '');
      if (!pick) throw new Error(`no sheets in films/${key}/out — run: studio look ${key}`);
      const { cfg } = readFilm(key);
      const prompt = opt('prompt') || `You are a harsh motion-design director. This is a contact sheet of frames from "${cfg.title}" — a ${cfg.duration}s ${cfg.formats.join(' + ')} film; frames carry their own time labels. Judge what you SEE: hook, readability (phone-size text?), motion, variety, composition, brand consistency. Score each 1-10, then the 3 worst problems with frame timestamps, each with a concrete fix. Be specific and harsh.`;
      const engineArg = String(opt('engine', '') || '').toLowerCase();
      const agy = await import('./lib/antigravity.mjs');
      const useAgy = engineArg === 'agy' || (engineArg !== 'api' && engineArg !== 'gemini' && agy.antigravityAvailable());
      const r = useAgy
        ? await agy.askAntigravity({ image: join(out, pick), prompt, model: opt('model'),
            onProgress: (m) => process.stderr.write(`  · ${m}\n`) })
        : engineArg === 'gemini'
          ? await agentRead({ cwd: ROOT, sheetPath: join(out, pick), filmKey: key, prompt })
          : await geminiRead({ image: join(out, pick), file: pick, prompt, model: opt('model') });
      console.log(`\n${r.engine || r.model} · films/${key}/out/${pick}\n\n${r.text}\n`);
      break;
    }
    case 'login-gemini': {
      const { loginGemini } = await import('./lib/gemini-auth.mjs');
      console.log('\nBrowser login for Gemini (Google account — uses your Google AI Pro / Code Assist quota, no API key):\n');
      let url = '';
      const r = await loginGemini({
        onProgress: (m) => {
          url = m;
          if (/accounts\.google/.test(m)) {
            console.log(`  opening your browser… (if nothing opens, visit:\n\n  ${m}\n)`);
            try { require('node:child_process').exec(`explorer.exe "${m}"`); } catch { /* WSL: explorer may be missing; URL is printed */ }
          } else console.log(`  ${m}`);
        },
      }).catch((e) => { console.error('  login failed:', e.message); return null; });
      if (r) {
        console.log(`\nlogged in ✓${r.projectId ? `  project: ${r.projectId}` : ''}  creds: ${r.file.replace(ROOT + '/', '')}`);
        try {
          const { subPing } = await import('./lib/gemini-auth.mjs');
          const pong = await subPing();
          console.log(`subscription check: ${pong.includes('OK') ? '✓ working on your Google AI quota' : pong}`);
        } catch (e) { console.log(`subscription check failed: ${e.message} (creds are saved; retry \`studio read\` — re-login if it persists)`); }
        console.log('  `studio read <film>` and the GUI reader now use your subscription quota.\n  (Login expired? Just run this command again.)');
      }
      break;
    }
    case 'gui': await import('../studio-gui/server.mjs'); return;
    case 'regress': {
      const R = await import('./regress.mjs');
      if (opt('write')) { const f = await R.writeBaseline(); console.log(`baseline written for ${Object.keys(f).join(', ')} → ${rel(R.BASELINE)}`); break; }
      const r = await R.compare();
      for (const [k, v] of Object.entries(r.measured)) console.log(`${k.padEnd(24)} ${v}`);
      for (const row of r.rows) console.log('DRIFT  ' + row);
      console.log(r.pass ? 'regress: PASS' : 'regress: FAIL'); process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'doctor': {
      const { doctor, printDoctor } = await import('./doctor.mjs');
      const r = await doctor({ fix: !!opt('fix'), math: !!opt('math') }); printDoctor(r); process.exitCode = r.ok ? 0 : 1; break;
    }
    case 'verify-edit': {
      const { verifyEdit } = await import('./verify-edit.mjs');
      const r = await verifyEdit({ quick: !!opt('quick'), list: !!opt('list'), only: opt('only') === true ? undefined : opt('only'), clean: !!opt('clean') });
      process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'verify-math': {
      const { verifyMath } = await import('./verify-math.mjs');
      const r = await verifyMath({ quick: !!opt('quick'), list: !!opt('list'), only: opt('only') === true ? undefined : opt('only'), clean: !!opt('clean') });
      process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'project': {
      const P = await import('./kinds/project/index.mjs');
      const sub = argv[1];
      const pkey = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
      if (sub === 'new') {
        if (!pkey || !/^[a-z0-9][a-z0-9-]*$/.test(pkey)) throw new Error('studio project new <key> "<request>" [--formats 16:9,9:16]');
        // the request = the positional words after the key, up to the first --flag (a quoted
        // request is one argv element; an unquoted multi-word one works the same way)
        const words = [];
        for (const a of argv.slice(3)) { if (a.startsWith('--')) break; words.push(a); }
        const request = words.join(' ');
        if (!request) throw new Error('studio project new <key> "<request>" — the request in plain words');
        const files = []; argv.forEach((a, i) => { if (a === '--file' && argv[i + 1]) files.push(argv[i + 1]); });
        const r = P.create(pkey, { title: opt('title', pkey) === true ? undefined : opt('title'), request,
          formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : ['16:9'], inputs: files });
        console.log(r.message);
        break;
      }
      if (sub === 'list') {
        const rows = existsSync(FILMS) ? readdirSync(FILMS).filter((k) => { const c = readJson(join(FILMS, k, 'film.json'), null); return c && c.kind === 'project'; }) : [];
        if (!rows.length) console.log('no projects yet: studio project new <key> "<request>"');
        for (const k of rows) {
          const c = readJson(join(FILMS, k, 'film.json'), {}), st = P.stateOf(k);
          const finals = existsSync(join(FILMS, k, 'out')) ? readdirSync(join(FILMS, k, 'out')).filter((f) => /^final-.*\.mp4$/.test(f)).length : 0;
          console.log(`${k.padEnd(20)} ${(st.phase ?? '?').padEnd(11)} parts ${(c.parts || []).length}  finals ${finals}  ${(c.formats || []).join(',')}`);
        }
        break;
      }
      if (!pkey) throw new Error('studio project <new|list|status|plan|requirement|verify|rebuild|ship|where> <key> …');
      if (sub === 'status') {
        const st = P.stateOf(pkey), c = readJson(join(FILMS, pkey, 'film.json'), {});
        console.log(`${pkey}: ${st.phase} · ${(c.parts || []).length} part(s) · formats ${(c.formats || []).join(', ')}`);
        for (const [id, sg] of Object.entries(st.segments ?? {})) console.log(`  ${id.padEnd(6)} ${(sg.status ?? '?').padEnd(10)} ${sg.film} (${sg.capability})`);
        const B = await import('./produce/budget.mjs');
        const b = B.budgetOf(pkey);
        console.log(`  budget: ${b.spentMinutes.toFixed(0)}/${b.minutes} min (${b.phase}), $${b.spentUsd.toFixed(3)}/${b.usd}`);
        break;
      }
      if (sub === 'plan') {
        if (opt('check') === undefined) throw new Error('studio project plan <key> --check (plan.json is written by the producer)');
        const r = await P.planCheck(pkey);
        for (const e of r.errors) console.log(`  ✗ ${e}`);
        for (const w of r.warnings) console.log(`  ⚠ ${w}`);
        console.log(r.ok ? `plan: VALID (${(r.plan?.segments || []).length} segments, chosen ${r.plan?.decision?.chosen}${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''})` : `plan: ${r.errors.length} error(s)`);
        process.exitCode = r.ok ? 0 : 1;
        break;
      }
      if (sub === 'requirement') {
        const L = await import('./produce/ledger.mjs');
        const wv = opt('waive');
        if (wv !== undefined && wv !== true) { const r = L.waive(pkey, String(wv)); console.log(`waived: ${r.id} by ${r.waived_by}`); break; }
        const text = opt('text');
        if (!text || text === true) throw new Error('studio project requirement <key> add --text "…" --type measurable --verifier duration --arg 60');
        const rows = [{ text: String(text), type: opt('type', 'measurable'), verifier: opt('verifier') === true ? undefined : opt('verifier'),
          arg: opt('arg') === true || opt('arg') === undefined ? undefined : Number(opt('arg')),
          tolerance: opt('tolerance') === true || opt('tolerance') === undefined ? undefined : Number(opt('tolerance')) }];
        const add = L.addRequirements(pkey, rows, { source: opt('source', 'request') });
        console.log(`added ${add.map((r) => r.id).join(', ')} -> films/${pkey}/requirements.json`);
        break;
      }
      if (sub === 'verify') {
        const { verifyProject } = await import('./produce/ship.mjs');
        const r = await verifyProject(pkey);
        for (const w of r.why) console.log(`  ✗ ${w}`);
        console.log(r.pass ? `project ${pkey}: VERIFY GREEN (requirements green, gates PASS, facts/assets/budget clean)` : `project ${pkey}: ${r.why.length} problem(s)`);
        process.exitCode = r.pass ? 0 : 1;
        break;
      }
      if (sub === 'rebuild') {
        const plan = readJson(join(FILMS, pkey, 'plan.json'), null);
        if (!plan) throw new Error(`films/${pkey}/plan.json is empty — write the plan first`);
        const only = opt('only') === true ? undefined : opt('only');
        const st = P.stateOf(pkey);
        let built = 0, skipped = 0;
        for (const seg of plan.segments || []) {
          if (only && seg.id !== only) continue;
          const cur = st.segments?.[seg.id];
          if (cur?.status === 'done' && !only) { skipped++; continue; }   // resume: finished parts stay
          const r = await P.segment(pkey, seg);
          console.log(`  ${seg.id} (${seg.capability}) -> films/${r.key}${r.existed ? ' (existing)' : ''}`);
          built++;
        }
        console.log(`rebuild: ${built} part(s) built, ${skipped} already done${only ? ` (only ${only})` : ''}`);
        break;
      }
      if (sub === 'ship') { await P.ship(pkey); break; }
      if (sub === 'where') {
        const t = num('t', 0);
        const plan = readJson(join(FILMS, pkey, 'plan.json'), {});
        const st = P.stateOf(pkey);
        let acc = 0, hit = null;
        for (const seg of plan.segments || []) { if (t < acc + (seg.duration ?? 0) + 0.25) { hit = { seg, local: t - acc }; break; } acc += seg.duration ?? 0; }
        if (!hit) hit = { seg: (plan.segments || []).at(-1), local: 0 };
        console.log(`${t}s -> segment ${hit.seg.id} (${hit.seg.capability}, ${hit.seg.role}) @ +${hit.local.toFixed(2)}s`);
        const child = st.segments?.[hit.seg.id]?.film;
        if (child) {
          console.log(`  child films/${child}:`);
          const K = await import('./kinds/registry.mjs');
          try { (await K.hooksFor(child)).where(child, hit.local, undefined); } catch (e) { console.log(`    (its own where: ${String(e.message || e).split('\n')[0]})`); }
        }
        break;
      }
      throw new Error(`studio project: unknown subcommand "${sub ?? ''}" (new|list|status|plan|requirement|verify|rebuild|ship|where)`);
    }
    case 'capabilities': {
      const C = await import('./produce/capabilities.mjs');
      const rows = await C.capabilitiesWithReadiness();
      if (opt('doc')) {
        const { writeFileSync } = await import('node:fs');
        const { join: j } = await import('node:path');
        const file = j(ROOT, 'docs', 'produce', 'CAPABILITIES.md');
        writeFileSync(file, C.markdownDoc(rows));
        console.log(`${rows.length} capabilities -> ${file.replace(ROOT + '/', '')}`);
        break;
      }
      if (opt('json')) { console.log(JSON.stringify(rows, null, 2)); break; }
      const id = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
      if (id) {
        const r = rows.find((x) => x.id === id);
        if (!r) throw new Error(`no capability "${id}": ${rows.map((x) => x.id).join(', ')}`);
        console.log(JSON.stringify(r, null, 2));
        break;
      }
      console.log(C.table(rows));
      const missing = await C.invokeCoverage();
      if (missing.length) { console.log(`
!! invoke commands missing from studio help:`); for (const m of missing) console.log(`   ${m}`); process.exitCode = 1; }
      break;
    }
    case 'migrate-names': {
      const N = await import('./produce/naming.mjs');
      const rows = argv.includes('--all') ? N.migrateAll()
        : key ? { [key]: N.migrateNames(key) } : (() => { throw new Error('studio migrate-names <film> | --all'); })();
      let n = 0;
      for (const [k, r] of Object.entries(rows)) {
        for (const m of r.moved) console.log(`  ${k}: ${m}`);
        for (const f of r.fixed) console.log(`  ${k}: ${f} paths fixed`);
        n += r.moved.length + r.fixed.length;
      }
      console.log(`migrate-names: ${n} change(s) across ${Object.keys(rows).length} math film(s)`);
      break;
    }
    case 'verify-produce': {
      const { verifyProduce } = await import('./verify-produce.mjs');
      const r = await verifyProduce({ quick: !!opt('quick'), list: !!opt('list'), only: opt('only') === true ? undefined : opt('only'), clean: !!opt('clean') });
      process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'fixtures': {
      const F = await import('./fixtures.mjs');
      if (opt('list')) { const m = F.readManifest().fixtures; for (const [id, f] of Object.entries(F.FIXTURES)) console.log(`${id.padEnd(14)} ${(m[id] ? (m[id].bytes / 1e6).toFixed(1) + ' MB' : 'not built').padEnd(10)} ${f.desc}`); break; }
      const r = await F.ensureFixtures({ only: opt('only') && opt('only') !== true ? String(opt('only')).split(',') : undefined, force: !!opt('force'), verify: !!opt('verify') });
      for (const [id, e] of Object.entries(r)) console.log(`${id.padEnd(14)} ${(e.bytes / 1e6).toFixed(1).padStart(7)} MB  ${e.sha256.slice(0, 12)}  ${e.cached ? 'cached' : e.seconds + 's'}`);
      break;
    }
    case 'ingest': {
      const I = await import('./ingest.mjs');
      const srcs = argv.slice(2).filter((x, i, a) => !x.startsWith('--') && !['--id', '--fps', '--max', '--audio-stream', '--still-seconds'].includes(a[i - 1]));
      if (!key || !srcs.length) throw new Error('studio ingest <film> <source file...> [--id cam] [--fps 30000/1001] [--max 1920] [--audio-stream N] [--no-proxy] [--force]');
      for (const src of srcs) {
        const r = await I.ingestSource(key, src, { id: srcs.length === 1 && opt('id') ? String(opt('id')) : undefined, fps: opt('fps') && opt('fps') !== true ? String(opt('fps')) : undefined, max: opt('max'), force: !!opt('force'),
          proxy: !argv.includes('--no-proxy'), audioStream: opt('audio-stream'), stillSeconds: opt('still-seconds') });
        console.log(`${r.id}: ${r.kind} ${r.ingest.conform ? `${r.ingest.conform.width}x${r.ingest.conform.height} @ ${r.ingest.conform.fps} (${r.ingest.conform.frames} frames, ${r.ingest.conform.duration.toFixed(2)}s)` : `${(r.ingest.audio_duration || 0).toFixed(2)}s audio`}  ${r.cached ? 'cached' : r.seconds + 's'}  → ${rel(r.dir)}`);
      }
      break;
    }
    case 'autoedit': {
      const A = await import('./autoedit.mjs');
      const srcs = []; argv.forEach((x, i) => { if (x === '--src' && argv[i + 1]) srcs.push(argv[i + 1]); });
      const r = await A.autoedit(key, { preset: opt('preset') === true ? undefined : String(opt('preset') ?? ''),
        target: opt('target') !== undefined && opt('target') !== true ? num('target') : undefined,
        srcs, id: opt('id') === true ? undefined : opt('id'), final: !!opt('final'), log: console.log });
      process.exitCode = r.pass ? 0 : 1;  // gates decide, like `studio gate`
      break;
    }
    case 'media': {
      const I = await import('./ingest.mjs'), film = readFilm(key), bin = I.readBin(film);
      const ids = Object.keys(bin.sources); if (!ids.length) console.log(`no media yet: studio ingest ${key} <file>`);
      for (const id of ids) { const s = bin.sources[id]; console.log(`${id.padEnd(18)} ${s.kind.padEnd(6)} ${String(s.duration?.toFixed?.(1) ?? '-').padStart(7)}s ${String(s.fps ?? '-').padEnd(11)} ${existsSync(s.path) ? 'ok     ' : 'MISSING'} ${s.path}`); }
      break;
    }
    case 'relink': {
      const I = await import('./ingest.mjs');
      const search = []; argv.forEach((x, i) => { if (x === '--search' && argv[i + 1]) search.push(argv[i + 1]); });
      const r = await I.relink(key, { search });
      console.log(`relink: ${r.ok.length} ok, ${r.repaired.length} repaired, ${r.missing.length} missing`); process.exitCode = r.missing.length ? 1 : 0; break;
    }
    case 'cache': {
      const C = await import('./cache.mjs');
      if (argv[1] === 'gc') C.gc({ dry: !!opt('dry'), fixtures: !!opt('fixtures') }); else C.printReport();
      break;
    }
    case 'edit': { const E = await import('./edit-cli.mjs'); await E.editCommand(key, argv.slice(2)); break; }
    case 'transcribe': {
      const T = await import('./transcribe.mjs');
      const r = await T.transcribe(key, argv[2], { model: opt('model') && opt('model') !== true ? String(opt('model')) : 'small', language: opt('language') && opt('language') !== true ? String(opt('language')) : 'auto', force: !!opt('force') });
      console.log(`${argv[2]}: ${r.cached ? 'cached' : 'fresh'} ${r.words.length} words, lang ${r.language} (${r.language_probability})  → ${rel(r.file)}`);
      break;
    }
    case 'transcript': {
      const T = await import('./transcribe.mjs');
      const o = { from: opt('from') !== undefined && opt('from') !== true ? +opt('from') : undefined, to: opt('to') !== undefined && opt('to') !== true ? +opt('to') : undefined,
        grep: opt('grep') !== undefined && opt('grep') !== true ? String(opt('grep')) : undefined, format: opt('format') && opt('format') !== true ? String(opt('format')) : 'compact' };
      console.log(T.readTranscript(key, argv[2], o));
      break;
    }
    case 'cut': {
      const C = await import('./cut.mjs');
      const kind = argv[2], opts = { src: opt('src') && opt('src') !== true ? String(opt('src')) : undefined, apply: !!opt('apply'), log: console.log };
      if (!['silence', 'fillers', 'takes', 'idle', 'tighten'].includes(kind)) throw new Error('studio cut <film> <silence|fillers|takes|idle|tighten> [--src cam] [--max-gap 0.5] [--apply] …');
      let r;
      if (kind === 'silence') r = await C.cutSilence(key, { ...opts, maxGap: num('max-gap', 0.5), keepBreath: num('keep-breath', 0.15) });
      else if (kind === 'fillers') r = await C.cutFillers(key, { ...opts, extra: opt('also') && opt('also') !== true ? String(opt('also')).split(',') : [] });
      else if (kind === 'takes') r = await C.cutTakes(key, { ...opts, window: num('window', 20) });
      else if (kind === 'idle') r = await C.cutIdle(key, { ...opts, maxIdle: num('max-idle', 1.0), speedUp: !!opt('speed-up'), speed: num('speed', 4) });
      else r = await C.tighten(key, { ...opts, target: opt('target') !== undefined && opt('target') !== true ? num('target') : undefined });
      for (const p of r.proposals) {
        if (p.skipped) console.log(`  SKIP  @${p.at.toFixed(2)}s  ${p.reason}`);
        else console.log(`  CUT   ${p.from}s-${p.to}s (${p.frames}f)  ${p.reason}  removed: "${p.removedText}"`);
      }
      console.log(`cut ${kind}: ${r.actionable} proposals, ${(r.framesRemoved / 30).toFixed(2)}s total${r.applied ? ' (applied)' : ' (dry run: --apply)'}`);
      if (r.removedText) console.log(`removed text: ${r.removedText}`);
      break;
    }
    case 'captions': {
      const C = await import('./captions-export.mjs');
      const fmt = opt('format') && opt('format') !== true ? String(opt('format')) : 'srt';
      if (!['srt', 'vtt'].includes(fmt)) throw new Error('studio captions <film> [--format srt|vtt]');
      const film = readFilm(key), { cues, lang, src } = C.timelineCues(key);
      const out = join(film.out, `captions.${fmt}`);
      writeFileSync(out, fmt === 'srt' ? C.toSrt(cues) : C.toVtt(cues));
      console.log(`${cues.length} cues (${lang}, from ${src}) -> ${rel(out)}`);
      break;
    }
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
    default: console.error(`studio: unknown command "${cmd}"\n`); console.error(HELP); process.exit(2);
  }
}

main().catch((e) => { console.error('studio: ' + (e.message || e)); process.exit(1); });

