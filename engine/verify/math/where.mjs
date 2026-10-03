// where (P5): `studio where` resolves a timecode against the records — 20 seeded random times on
// a fixture film whose trace is DENSE (every recorded entry <= 0.2 s), so each t sits within 0.2 s
// of an animation END and the "which animation owns t" answer is checkable TO THE TRACE ENTRY.
// Every field is re-derived here from the records INDEPENDENTLY of engine/where.mjs (the module
// under test) and must agree: scene (cumulative records/<fmt>/<scene>-timeline.json), sentence
// (timing.json [start, end), else the last spoken), animation (the trace entry playing at t),
// file (scenes/<scene>.py). A pinned note (notes.json — the GUI's flow) resolves identically.
//
// The machine is shared with sibling agents: never two manim renders at once — before any render
// we wait for a clean `pgrep -f "manim render"` (up to 120 s, 3 tries); a slot still busy after
// that is an environment skip, never a silent OOM risk.
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMathFilm } from '../../math-cli.mjs';
import { renderMathFilm } from '../../math.mjs';
import { buildVoice } from '../../narration.mjs';
import { sceneMap, resolveWhere, resolveNote } from '../../where.mjs';
import { run } from '../../lib/proc.mjs';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';

const KEY = 'verify-m-where';

// the seeded PRNG the mission family uses (verify/edit-ops.mjs's mulberry32)
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export const SCRIPT = `# Where fixture — a dense trace: every recorded entry is short

## scene s01_hook: marks
[s01.1] Watch the small squares appear one by one across the plane.

## scene s02_meaning: more
[s02.1] Each mark {hits}lands where the voice says it should land.

## scene s03_recap: done
[s03.1] The last row fills the frame and the film ends.
`;
export const SCENES = {
  's01_hook.py': `from manim import Create, RIGHT, Square, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s01_hook — the WHERE fixture: a DENSE trace (every play/wait <= 0.2 s, the sentence tail
    chopped into 0.15 s hops instead of one long say()-exit pad), so any timecode sits within
    0.2 s of a recorded animation END and the resolver's answer is checkable to the entry."""

    scene_id = "s01_hook"

    def construct(self):
        row = VGroup(*[Square(0.42) for _ in range(9)]).arrange(RIGHT, buff=0.18)
        row.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s01.1"):
            for sq in row:
                self.play(Create(sq), run_time=0.18)
            self.fill("s01.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        """Wait out the sentence's tail in short hops (max(0.04, ...) so every wait is at least
        one frame long — manim floors a wait to whole frames and a sub-frame wait would spin)."""
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
`,
  's02_meaning.py': `from manim import Create, RIGHT, Triangle, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s02_meaning — the WHERE fixture's middle scene; stamps the {hits} bookmark (at() records
    the bookmark trace entry resolveWhere reports near it)."""

    scene_id = "s02_meaning"

    def construct(self):
        row = VGroup(*[Triangle() for _ in range(8)]).arrange(RIGHT, buff=0.22).scale(0.5)
        row.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s02.1"):
            self.at("hits")  # stamp {hits}: the where check resolves t near it to this bookmark
            for tr in row:
                self.play(Create(tr), run_time=0.18)
            self.fill("s02.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
`,
  's03_recap.py': `from manim import Create, Dot, VGroup

from studio_manim import L, StudioScene


class Scene(StudioScene):
    """s03_recap — the WHERE fixture's last scene: a grid of dots, short plays, tail hops."""

    scene_id = "s03_recap"

    def construct(self):
        dots = VGroup(*[Dot(radius=0.1) for _ in range(12)]).arrange_in_grid(rows=3, buff=0.35)
        dots.move_to([L.stage.cx, L.stage.cy, 0])
        with self.say("s03.1"):
            for d in dots:
                self.play(Create(d), run_time=0.18)
            self.fill("s03.1")
        for _ in range(2):
            self.wait(0.15)

    def fill(self, sid, hop=0.15):
        s = self.sentence(sid)
        end = float(s["end"]) - float(s["start"]) if s else 0.0
        while self._sentence_elapsed() < end - 0.02:
            self.wait(max(0.04, min(hop, end - self._sentence_elapsed())))
`,
};

// never two manim renders at once (the machine is shared): wait for a clean slot, up to 120 s
// (3 tries). A literal `pgrep -f "manim render"` is NOT enough here: sibling agents run watcher
// shells whose own command line greps for "-m manim render" (measured: `bash -c sleep 115; ...
// pgrep -af -- "-m manim render"` matches the literal pattern and would skip every render
// forever), so a real render is a PYTHON process whose args carry `-m manim render`.
const busyRenders = async () => (await run('pgrep', ['-af', 'manim render'], { allowFail: true })).out
  .split('\n').filter(Boolean)
  .filter((l) => /^\d+\s+\S*python\S*\s+-m manim render/.test(l));
async function renderSlot() {
  for (let i = 0; i < 3; i++) {
    if (!(await busyRenders()).length) return true;
    await new Promise((ok) => setTimeout(ok, 60000));
  }
  return false;
}

export default async () => {
  const bad = [], facts = [];
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  createMathFilm(KEY, { title: 'where fixture' });
  writeFileSync(join(dir, 'script.md'), SCRIPT);
  for (const [name, src] of Object.entries(SCENES)) writeFileSync(join(dir, 'scenes', name), src);
  try {
    // a real voiced film (real timing.json — the resolution domain), one draft 16:9 render
    const v = await buildVoice(KEY);
    if (!(await renderSlot())) return { pass: false, skip: 'the render slot stayed busy for 120 s (a sibling agent is rendering) — where check not run' };
    const out = await renderMathFilm(KEY, { quality: 'draft', fmt: '16:9' });
    const fmt = '16:9';
    facts.push(`fixture: ${v.sentences.length} sentences voiced (${v.duration.toFixed(2)} s), draft ${fmt} rendered in ${out[0].seconds.toFixed(2)} s (${out[0].rendered} scenes)`);

    // -- the truth, re-derived from the records (NOT through engine/where.mjs) -----------------
    // scene order + lengths straight from records/<fmt>/ (the render order: sorted scene files)
    const timing = readJson(join(dir, 'timing.json'));
    const sents = timing.sentences;
    const ids = readdirSync(join(dir, 'records', fmt)).filter((f) => f.endsWith('-timeline.json'))
      .map((f) => f.replace(/-timeline\.json$/, '')).sort();
    let acc = 0;
    const scenes = ids.map((sid) => {
      const seconds = readJson(join(dir, 'records', fmt, `${sid}-timeline.json`), {})?.seconds ?? 0;
      const x = { scene: sid, start: acc, end: acc + seconds, seconds };
      acc += seconds;
      return x;
    });
    const anims = Object.fromEntries(ids.map((sid) => [sid,
      readJson(join(dir, 'records', fmt, `${sid}-trace.json`), []).filter((e) => e.kind === 'animation')]));
    const longest = Math.max(...ids.flatMap((sid) => anims[sid].map((e, i) => e.t - (anims[sid][i - 1]?.t ?? 0))), 0);
    const D = acc;
    // the module's own sceneMap must equal this independent derivation (the CLI/GUI share it)
    if (JSON.stringify(sceneMap(KEY, fmt)) !== JSON.stringify(scenes)) bad.push(`sceneMap disagrees with the records: ${JSON.stringify(sceneMap(KEY, fmt))} vs ${JSON.stringify(scenes)}`);

    // -- 20 seeded random times -----------------------------------------------------------------
    const R = mulberry(42);
    let maxDev = 0, maxInto = 0, gapFalls = 0;
    for (let n = 0; n < 20; n++) {
      const t = +(R() * D).toFixed(3);
      const r = resolveWhere(KEY, t, fmt);
      // scene: the cumulative timeline seconds
      const sc = scenes.find((x) => t >= x.start && t < x.end) || scenes.at(-1);
      if (r.scene !== sc.scene) bad.push(`t=${t}: scene ${r.scene}, records say ${sc.scene}`);
      if (Math.abs(r.scene_t - +(t - sc.start).toFixed(3)) > 1e-9) bad.push(`t=${t}: scene_t ${r.scene_t} != ${+(t - sc.start).toFixed(3)}`);
      // sentence: timing.json [start, end); between sentences the last spoken
      const exS = sents.find((s) => t >= s.start && t < s.end) || sents.filter((s) => s.start <= t).at(-1) || null;
      if (!exS) { if (r.sentence !== null) bad.push(`t=${t}: sentence ${r.sentence?.id}, timing.json says none`); }
      else {
        if (r.sentence?.id !== exS.id) bad.push(`t=${t}: sentence ${r.sentence?.id ?? null}, timing.json says ${exS.id}`);
        if (Math.abs((r.sentence?.start ?? 0) - exS.start) > 1e-9 || Math.abs((r.sentence?.end ?? 0) - exS.end) > 1e-9) bad.push(`t=${t}: sentence span differs from timing.json`);
        if (!(t >= exS.start && t < exS.end)) gapFalls++; // resolved through the between-sentences rule
      }
      // animation: the trace entry PLAYING at t (the first whose recorded END has not passed)
      const A = anims[sc.scene] || [];
      let ix = A.findIndex((a) => a.t >= (t - sc.start) - 1e-9);
      if (ix < 0) ix = A.length - 1;
      const exA = A[ix];
      if (!exA) { bad.push(`t=${t}: no animation entries for scene ${sc.scene}`); continue; }
      if (r.animation?.i !== exA.i) bad.push(`t=${t}: animation #${r.animation?.i ?? null} (${r.animation?.name}), the trace's playing entry is #${exA.i} (${exA.animation})`);
      if (Math.abs((r.animation?.t ?? NaN) - exA.t) > 1e-9) bad.push(`t=${t}: animation t ${r.animation?.t} != trace ${exA.t}`);
      if (Math.abs((r.animation?.start ?? NaN) - +(A[ix - 1]?.t ?? 0).toFixed(3)) > 1e-9) bad.push(`t=${t}: animation start ${r.animation?.start} != previous entry's end ${A[ix - 1]?.t ?? 0}`);
      // the mission's tolerance window: an animation END within 0.2 s of the timecode (the
      // fixture's entries are <= 0.2 s long, so the playing entry always satisfies it)
      const dev = Math.abs(exA.t - (t - sc.start));
      maxDev = Math.max(maxDev, dev);
      maxInto = Math.max(maxInto, (t - sc.start) - (anims[sc.scene][ix - 1]?.t ?? 0));
      if (dev > 0.2 + 1e-9) bad.push(`t=${t}: nearest animation END is ${dev.toFixed(3)} s away (> 0.2)`);
      // file: the scene's source file
      if (r.file !== `scenes/${sc.scene}.py`) bad.push(`t=${t}: file ${r.file}, wanted scenes/${sc.scene}.py`);
      if (r.fmt !== fmt || r.film !== KEY) bad.push(`t=${t}: fmt/film ${r.fmt}/${r.film}`);
      // a bookmark is reported only inside its +/-0.75 s window, and must match timing.json
      if (r.bookmark) {
        const bm = sents.flatMap((s) => s.bookmarks.map((b) => ({ ...b, sid: s.id }))).find((b) => b.id === r.bookmark.id);
        if (!bm || r.bookmark.sentence !== bm.sid || Math.abs(r.bookmark.t - (sents.find((s) => s.id === bm.sid).start + bm.t)) > 0.002) bad.push(`t=${t}: bookmark ${JSON.stringify(r.bookmark)} disagrees with timing.json`);
        if (Math.abs(r.bookmark.t - t) >= 0.75) bad.push(`t=${t}: bookmark ${r.bookmark.id}@${r.bookmark.t} reported outside its 0.75 s window`);
      }
    }
    const book = readJson(join(dir, 'records', fmt, 's02_meaning-trace.json'), []).filter((e) => e.kind === 'bookmark');
    if (book.length !== 1 || book[0].id !== 'hits') bad.push(`the {hits} bookmark was not stamped exactly once in s02's trace (${book.length})`);
    facts.push(`20 seeded times (mulberry32(42), D=${D.toFixed(2)} s, ${gapFalls} in a between-sentences gap): scene/sentence/animation/file all agree with records+timing.json; max |anim END - t| = ${maxDev.toFixed(3)} s, max time into the playing animation = ${maxInto.toFixed(3)} s, longest recorded entry = ${longest.toFixed(3)} s`);

    // -- a pinned note resolves to the same ------------------------------------------------------
    const tNote = +(D / 2).toFixed(3);
    const note = { id: 1, t: tNote, fmt, text: 'note test' };
    writeJson(join(dir, 'notes.json'), [note]);
    const rn = resolveNote(KEY, note);
    const rw = resolveWhere(KEY, tNote, fmt);
    const { note: _n, ...rest } = rn;
    const same = JSON.stringify(rest) === JSON.stringify(rw);
    if (!same) bad.push(`a pinned note at ${tNote}s resolves differently from where (${JSON.stringify(rest)} vs ${JSON.stringify(rw)})`);
    if (rn.note?.text !== 'note test' || rn.note?.id !== 1) bad.push(`resolveNote lost the note: ${JSON.stringify(rn.note)}`);
    facts.push(`pinned note t=${tNote}s -> scene ${rn.scene}, ${rn.sentence?.id}, animation #${rn.animation?.i} (${rn.animation?.name}) — identical to where`);
    return { pass: bad.length === 0, measured: bad.length ? `${bad.join('; ')} || ${facts.join('; ')}` : facts.join('; ') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
