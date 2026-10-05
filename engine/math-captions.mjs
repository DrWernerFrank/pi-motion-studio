// math-captions.mjs — narration captions for math films (mission §7 `captions` row).
// Cues reuse the editing mission's chunker (engine/lib/captions.js captionChunks — ≤2 lines,
// reading-speed aware, non-overlapping by construction); SRT/VTT reuse captions-export's writers;
// the LAYOUT VALIDATION is math-native: a capped python probe constructs the caption with the
// studio's real Txt (Pango, the actual renderer) and measures it against L.caption per format.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captionChunks } from './lib/captions.js';
import { toSrt, toVtt } from './captions-export.mjs';
import { readJson } from './lib/film.mjs';
import { ROOT } from './lib/serve.mjs';

export function captionCues(key, { maxChars = 42 } = {}) {
  const film = readJson(join(ROOT, 'films', key, 'film.json'));
  const timing = readJson(join(ROOT, 'films', key, 'timing.json'), {});
  const lang = film.lang || 'en';
  // words: timing.json's word times are ALREADY FILM-relative (a sentence's first word starts
  // just after the sentence's start — verified on capdbg: s2's first word at 8.46 inside a sentence
  // starting 8.44; the first draft added s.start AGAIN and cues landed 8 s late)
  const words = [];
  for (const s of timing.sentences ?? [])
    for (const w of s.words ?? []) words.push({ text: w.w, start: +w.start.toFixed(5), end: +w.end.toFixed(5) });
  const cues = captionChunks(words, { maxChars });
  return cues.map((c, i) => ({ ...c, i, lang }));
}

export function exportCaptions(key) {
  const cues = captionCues(key);
  const outDir = join(ROOT, 'films', key, 'out');
  mkdirSync(outDir, { recursive: true });
  const srt = join(outDir, 'captions.srt');
  const vtt = join(outDir, 'captions.vtt');
  writeFileSync(srt, toSrt(cues));
  writeFileSync(vtt, toVtt(cues));
  return { srt, vtt, cues: cues.length };
}

// The no-tofu clause: every codepoint of the fa caption text is in the bundled Vazirmatn's cmap.
export function vazirCovers(text) {
  const out = execFileSync('fc-query', ['--format', '%{charset}\n', join(ROOT, 'engine', 'fonts', 'Vazirmatn-Regular.woff2')], { encoding: 'utf8' });
  const ranges = out.trim().split(/\s+/).map((r) => r.split('-').map((x) => parseInt(x, 16)))
    .map(([a, b = a]) => [a, b]);
  const missing = [];
  for (const ch of new Set(text.replace(/\s+/g, ''))) {
    const cp = ch.codePointAt(0);
    if (!ranges.some(([a, b]) => cp >= a && cp <= b)) missing.push(`${ch} U+${cp.toString(16)}`);
  }
  return { ok: missing.length === 0, missing };
}

// The layout probe: the longest cue, at caption size, wraps to <= 2 lines that fit L.caption's band
// in EVERY format, and the nominal size is >= 3.2u (role=caption stamps it; we assert the ladder).
// One capped python process for all formats (the probe is cheap: it constructs Txt, no render).
export const PROBE_PY = `import json, os, sys, tempfile, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'engine', 'manim'))})
# Manim's Typst/Text cache writes media/ under the cwd even for a measurement-only probe —
# point it at a temp dir or every run leaks engine/manim/test/media (the hygiene check)
os.environ.setdefault("STUDIO_RECORDS_DIR", tempfile.mkdtemp(prefix="cap-probe-"))
from manim import config
config.media_dir = tempfile.mkdtemp(prefix="cap-media-")
from studio_manim import Txt
from studio_manim.layout import layout_for
from studio_manim.theme import size_u

cues = json.load(sys.stdin)          # [{ text, lang }, ...] the LONGEST cue per film
out = []
for fmt in ("16:9", "9:16", "1:1", "4:5"):
    L = layout_for(fmt)
    band_w, band_h = L.caption.w * 0.96, L.caption.h
    for cue in cues:
        # greedy wrap at the caption size: measure each candidate line's real Pango width
        words, lines, cur = cue["text"].split(), [], []
        for w in words:
            cand = " ".join(cur + [w])
            t = Txt(cand, role="caption")
            if t.width > band_w and cur:
                lines.append(" ".join(cur)); cur = [w]
            else:
                cur.append(w)
        if cur: lines.append(" ".join(cur))
        # each line must fit the band's width; the stack's height must fit the band
        heights, widths = [], []
        for ln in lines:
            t = Txt(ln, role="caption")
            heights.append(float(t.height)); widths.append(float(t.width))
        out.append({"fmt": fmt, "lang": cue["lang"], "lines": len(lines), "widths_ok": all(w <= band_w for w in widths),
                    "heights_ok": sum(heights) <= band_h, "nominal_u": size_u("caption")})
print(json.dumps(out))
`;
