#!/usr/bin/env node
// studio: the command surface of the motion studio. `studio help` lists everything.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMusic, buildSfx, gridBeats, measureBeats, mix } from './audio.mjs';
import { gates } from './gates.mjs';
import { FILMS, readFilm, readJson, writeJson } from './lib/film.mjs';
import { run } from './lib/proc.mjs';
import { ROOT } from './lib/serve.mjs';
import { renderFilm } from './render.mjs';
import { addReview } from './review.mjs';
import { contactSheet, poster } from './stills.mjs';

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
  help                   this text`;

const argv = process.argv.slice(2);
const cmd = argv[0], key = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]; };
const num = (k, d) => (opt(k) === undefined ? d : Number(opt(k)));
const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

async function main() {
  switch (cmd) {
    case 'new': {
      if (argv.includes('--math')) {
        const M = await import('./math-cli.mjs');
        const dir = M.createMathFilm(key, { title: opt('title', key),
          formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : undefined,
          lang: opt('lang') === true ? 'en' : String(opt('lang') ?? 'en'),
          voice: opt('voice') === true ? undefined : opt('voice') });
        console.log(`created ${rel(dir)} (math film)\n  next: studio render ${key} --draft   then   studio look ${key}\n  scenes live in films/${key}/scenes/ — from studio_manim import *; craft: docs/math + the skill`);
        break;
      }
      if (argv.includes('--edit')) {
        const E = await import('./edit-cli.mjs');
        const dir = E.createEditFilm(key, { title: opt('title', key), fps: opt('fps') && opt('fps') !== true ? String(opt('fps')) : 30, formats: opt('formats') && opt('formats') !== true ? String(opt('formats')).split(',') : ['16:9'] });
        console.log(`created ${rel(dir)} (edit film)\n  next: studio ingest ${key} <your footage> --id cam   then   studio edit ${key} add --src cam --in 0 --out 10   then   studio look ${key}\n  preview: studio gui`);
        break;
      }
      if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('studio new <key>: lowercase letters, digits, dashes');
      const dir = join(FILMS, key);
      if (existsSync(dir)) throw new Error(`films/${key} already exists`);
      cpSync(join(ROOT, 'templates', 'film'), dir, { recursive: true });
      const cfg = readJson(join(dir, 'film.json'));
      Object.assign(cfg, {
        title: opt('title', key), duration: num('duration', cfg.duration),
        formats: opt('formats') ? String(opt('formats')).split(',') : cfg.formats, loop: !!opt('loop', cfg.loop),
      });
      cfg.music.bpm = num('bpm', cfg.music.bpm);
      writeJson(join(dir, 'film.json'), cfg);
      gridBeats(key);
      console.log(`created films/${key}\n  next: write brief.md, design.json, shotlist.md, then index.html\n  preview: studio gui  (or open http://localhost:3142/films/${key}/)`);
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
      if (readFilm(key).cfg.kind === 'math') { // math films: frames from the draft (no seek(t) page)
        const M = await import('./math-cli.mjs');
        const r = await M.lookMath(key, o);
        console.log(`${rel(r.file)}  (${r.count} frames: ${r.times.join(', ')})`);
        break;
      }
      const r = await contactSheet(key, o);
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
      if (readFilm(key).cfg.kind === 'math') {
        const M = await import('./math.mjs');
        const r = await renderMathSlice(M, key, opt, num, argv);
        for (const x of r) console.log(rel(x.file));
        break;
      }
      const r = await renderFilm(key, { quality: opt('draft') ? 'draft' : 'final', fmt: opt('fmt'), from: opt('from') !== undefined ? num('from') : undefined,
        to: opt('to') !== undefined ? num('to') : undefined, sub: opt('sub') !== undefined ? num('sub') : undefined, workers: opt('workers') ? num('workers') : undefined,
        bypassCache: argv.includes('--no-cache') });
      for (const x of r) console.log(rel(x.file));
      break;
    }
    case 'scene': {
      if (!argv[2] || argv[2].startsWith('--')) throw new Error('studio scene <film> <scene-id> [--draft|--final] [--fmt 9:16]');
      const M = await import('./math.mjs');
      const r = await renderMathSlice(M, key, opt, num, argv, argv[2]);
      for (const x of r) console.log(`${rel(x.file)}  (${x.scenes} scene, ${x.seconds}s)`);
      break;
    }
    case 'check': {
      if (readFilm(key).cfg.kind !== 'math') throw new Error('studio check is for math films (kind: math)');
      const M = await import('./math.mjs');
      const rows = await M.checkMathFilm(key, { scene: opt('scene') === true ? undefined : opt('scene') });
      let bad = 0;
      for (const r of rows) { if (r.ok) console.log(`ok    ${r.scene}: typeset + ${r.claims} claim(s)`); else { bad++; console.log(`FAIL  ${r.scene}:\n${r.error}`); } }
      console.log(`check: ${rows.length - bad}/${rows.length} scenes clean`);
      process.exitCode = bad ? 1 : 0;
      break;
    }
    case 'grid': { const r = gridBeats(key); console.log(`${rel(r.file)}: ${r.beats} beats at ${r.bpm} bpm`); break; }
    case 'beats': { const r = await measureBeats(key); console.log(`${rel(r.file)}: ${r.beats} beats, ${r.hits} hits, ${r.bpm.toFixed(1)} bpm`); break; }
    case 'where': {
      if (readFilm(key).cfg.kind !== 'math') throw new Error('studio where is for math films (kind: math) — edit films have edit_status');
      const W = await import('./where.mjs');
      const t = num('t', 0);
      const r = W.resolveWhere(key, t, opt('fmt') === true ? undefined : opt('fmt'));
      console.log(`${r.t}s → scene ${r.scene} (scene_t ${r.scene_t}s) · ${r.sentence ? `${r.sentence.id} “${r.sentence.text.slice(0, 48)}”` : 'no sentence'}${r.bookmark ? ` · near {${r.bookmark.id}}@${r.bookmark.t}s` : ''}${r.overrun ? ' · OVERRUN nearby' : ''}\n  animation: ${r.animation ? `#${r.animation.i} ${r.animation.name} @${r.animation.t}s` : 'none'}\n  code: ${r.file}${r.line ? ':' + r.line : ''}`);
      break;
    }
    case 'sound': {
      if (readFilm(key).cfg.kind === 'math') { // the math narration bus: voice → timing → mix at mix.lufs
        const N = await import('./narration.mjs');
        const v = await N.buildVoice(key); console.log(`voice: ${v.sentences.length} sentences, ${v.duration.toFixed(2)}s, timing ${v.timing}`);
        const m = await N.buildMix(key); console.log(`${rel(m.file)}  ${m.lufs} LUFS, true peak ${m.truePeak} dBTP${m.warning ? '  (warning: ' + m.warning + ')' : ''}`);
        // captions ride the narration: the SRT/VTT are written with the mix (the critic found
        // the config said ON while no artifact existed — the gate now checks the files)
        const caps = readFilm(key).cfg.captions ?? "auto";
        if (caps !== 'off') { const { exportCaptions } = await import('./math-captions.mjs');
          const c = exportCaptions(key); console.log(`${c.cues} cues → ${rel(c.srt)}, ${rel(c.vtt)}`); }
        break;
      }
      await sound(key); break;
    }
    case 'gate': {
      if (readFilm(key).cfg.kind === 'math') {
        const { runMathGates } = await import('./math-gates.mjs');
        const g = await runMathGates(key); console.log(g.pass ? '\ngates: PASS' : '\ngates: FAIL'); process.exitCode = g.pass ? 0 : 1; break;
      }
      const r = await gates(key); console.log(r.pass ? '\ngates: PASS' : '\ngates: FAIL'); process.exitCode = r.pass ? 0 : 1; break;
    }
    case 'review': {
      const e = addReview(key, JSON.parse(opt('json', '{}')));
      console.log(`round ${e.round}: min ${e.min} → ${e.pass ? 'PASS' : 'fix the worst 3 and look again'}`);
      break;
    }
    case 'ship': {
      if (readFilm(key).cfg.kind === 'math') {
        // gates first (FAIL blocks), then finals in every format, then claims.md (every verified claim)
        console.log('── gates'); const { runMathGates } = await import('./math-gates.mjs');
        const g = await runMathGates(key);
        if (!g.pass) throw new Error('math gates failed: fix the FAIL lines above before shipping');
        console.log('── render'); const M = await import('./math.mjs');
        const r = await M.renderMathFilm(key, { quality: 'final' });
        console.log('── claims');
        // the film-level ledger: every records/<fmt>/*-claims.json, deduped by (expr, says) — D-011
        const { writeFileSync, readdirSync: rd, existsSync: ex, readFileSync: rf } = await import('node:fs');
        const recDir = join(readFilm(key).dir, 'records');
        const led = [];
        if (ex(recDir)) for (const fmtDir of rd(recDir).filter((f) => ex(join(recDir, f)))) {
          for (const x of rd(join(recDir, fmtDir))) {
            if (!x.endsWith('-claims.json')) continue;
            for (const c of (JSON.parse(rf(join(recDir, fmtDir, x), 'utf8')) || []))
              if (!led.some((y) => y.expr === c.expr && y.says === c.says)) led.push(c);
          }
        }
        writeFileSync(join(readFilm(key).dir, 'out', 'claims.md'),
          `# Verified claims — ${key}\n\nEvery mathematical statement in this film, evaluated exactly (sympy) at render time.\n\n${led.map((c) => `- ${c.ok ? '✓' : '✗'} \`${c.expr}\`${c.about ? ` — ${c.about}` : ''}${c.says ? ` (${c.says})` : ''}`).join('\n')}\n`);
        console.log(`${led.length} claims → ${rel(join(readFilm(key).dir, 'out', 'claims.md'))}`);
        console.log('── shipped'); for (const x of r) console.log(`${rel(x.file)}  (${x.seconds}s)`);
        break;
      }
      const film = readFilm(key);
      console.log('── sound'); await sound(key);
      console.log('── gates'); const g = await gates(key);
      if (!g.pass) throw new Error('gates failed: fix the FAIL lines above before shipping');
      const reviews = readJson(join(film.dir, 'reviews.json'), []);
      if (!reviews.length || !reviews.at(-1).pass) console.log(`!! last review ${reviews.length ? `min ${reviews.at(-1).min}` : 'missing'}: shipping anyway, but the loop says 8+ first`);
      console.log('── render'); const r = await renderFilm(key, { quality: 'final', fmt: 'all' });
      const at = film.cfg.poster ?? Math.min(film.cfg.duration * 0.35, 3);
      for (const f of film.cfg.formats) console.log(rel((await poster(key, { at, fmt: f })).file));
      console.log(rel((await contactSheet(key, { mode: 'every', every: 0.5, name: 'contact' })).file));
      if (film.cfg.loop) {
        const src = r[0].file, dst = join(film.out, 'loop_check.mp4');
        await run('ffmpeg', ['-y', '-v', 'error', '-stream_loop', '1', '-i', src, '-c', 'copy', dst]);
        console.log(rel(dst));
      }
      await gates(key, { log: () => {} });
      console.log('── shipped'); for (const x of r) console.log(`${rel(x.file)}  (${x.seconds}s to render)`);
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

async function sound(key) {
  const film = readFilm(key);
  if (film.cfg.kind === 'edit') { // an edit film's sound is its dialog bus over the ducked music bed
    const A = await import('./edit-audio.mjs');
    if (film.cfg.music && !film.cfg.track) { const m = buildMusic(key); if (m.file) console.log(rel(m.file)); }
    const d = await A.buildDialog(key, { log: (m) => console.log(m) }), x = await A.mixEdit(key);
    console.log(`${rel(x.file)}  ${x.lufs} LUFS, true peak ${x.truePeak} dBFS`); void d; return;
  }
  if (!existsSync(join(film.dir, 'beats.json'))) film.cfg.track ? await measureBeats(key) : gridBeats(key);
  const m = buildMusic(key); if (m.file) console.log(rel(m.file));
  const s = buildSfx(key); console.log(`${rel(s.file)} (${s.cues} cues)`);
  const x = await mix(key); console.log(`${rel(x.file)}  ${x.lufs} LUFS, true peak ${x.truePeak} dBFS`);
}

main().catch((e) => { console.error('studio: ' + (e.message || e)); process.exit(1); });

// Math render from the CLI: `render` defaults to final (like the Canvas films), `--draft` halves
// it; `scene <id>` defaults to DRAFT (fast iteration on one scene) unless `--final`.
async function renderMathSlice(M, key, opt, _num, argv, sceneId) {
  const quality = argv.includes('--draft') ? 'draft' : argv.includes('--final') ? 'final' : sceneId ? 'draft' : 'final';
  return M.renderMathFilm(key, { quality, fmt: opt('fmt') === true ? undefined : opt('fmt'), scene: sceneId });
}
