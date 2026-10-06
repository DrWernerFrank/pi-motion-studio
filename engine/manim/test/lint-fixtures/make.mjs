// make.mjs — generates the layout-lint fixtures (synthetic records, deterministic, committed as plain JSON).
//   node engine/manim/test/lint-fixtures/make.mjs
// Each case is a folder: case.json (what the lint must report, per format variant) + records/<fmt>/
// s01-layout.json + s01-trace.json in the recorder's frozen schema. Geometry is Manim frame units,
// CENTERED at (0,0). The SAFE boxes below are the numbers layout.py's layout_for(fmt).safe yields
// (frozen here as data; the lint itself imports layout_for, never these constants).
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAME = { '16:9': [14.222, 8.0], '9:16': [8.0, 14.222] };
const SAFE = {}; // [left, bottom, right, top]
for (const [f, [W, H]] of Object.entries(FRAME)) {
  const [sx, sy, sw, sh] = H > W ? [0.07, 0.10, 0.86, 0.72] : [0.06, 0.08, 0.88, 0.84];
  SAFE[f] = [-W / 2 + sx * W, -H / 2 + sy * H, -W / 2 + sx * W + sw * W, -H / 2 + sy * H + sh * H];
}
const r3 = (n) => Math.round(n * 1000) / 1000;
const INK = '#17150F', BG = '#F2EEE4';

// WCAG luminance, to pick the 3:1 gray for the low-contrast case
const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let GRAY3 = null, best = 9;
for (let g = 0; g < 256; g++) { const h = '#' + g.toString(16).padStart(2, '0').repeat(3); const d = Math.abs(ratio(h, BG) - 3); if (d < best) { best = d; GRAY3 = h; } }

let fid = 0; // frame index -> ids "<anim>:<i>" like the recorder
function frame(t, objs) {
  fid++;
  return { t: r3(t), objects: objs.map((o, i) => ({
    kind: o.kind, id: `${fid}:${i}`, bbox: o.bbox.map(r3), height_u: r3(o.bbox[3] / 0.08),
    nominal_u: o.nominal_u ?? null, role: o.role ?? null, color: o.color ?? null, z: i, alive: true,
    text: !!o.text,
  })) };
}
const txt = (bbox, extra = {}) => ({ kind: 'Txt', bbox, text: true, role: 'body', nominal_u: 3.6, color: INK, ...extra });
const eq = (bbox, extra = {}) => ({ kind: 'Eq', bbox, text: true, role: 'math', nominal_u: 9, color: INK, ...extra });
const fig = (kind, bbox) => ({ kind, bbox, text: false, color: '#A86400' });
const title = () => txt([-3, 2.0, 6, 0.6], { role: 'title', nominal_u: 9 });

const cases = [];
// variant: { fmt, fps, frames: [[t, objs]], expect: [{ rule, level, at: [frameIndex, [objIndex...]], aspect? }] }
function add(name, kind, variants, extra = {}) { cases.push({ name, kind, variants, ...extra }); }

// ---- 12 seeded violations ---------------------------------------------------------------------
for (const side of ['left', 'right', 'top', 'bottom']) {
  add(`offscreen-${side}`, 'seeded', ['16:9', '9:16'].map((fmt) => {
    const [l, b, r, t] = SAFE[fmt];
    const w = 1.6, h = 0.4;
    const box = { left: [l - 0.3, -0.2, w, h], right: [r - w + 0.3, -0.2, w, h],
      top: [-w / 2, t - h + 0.3, w, h], bottom: [-w / 2, b - 0.3, w, h] }[side];
    return { fmt, fps: 30, frames: [[0.5, [title()]], [1.5, [title(), txt(box)]]],
      expect: [{ rule: 'offscreen', level: 'fail', at: [1, [1]], aspect: 'SAFE' }] };
  }));
}
add('outside-frame', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [title()]], [2.0, [title(), txt([-7.111 - 0.5, 0, 2.0, 0.4])]]],
  expect: [{ rule: 'offscreen', level: 'fail', at: [1, [1]], aspect: 'FRAME' }] }]);
add('text-over-text', 'seeded', ['16:9', '9:16'].map((fmt) => ({ fmt, fps: 30,
  frames: [[0.5, [title(), txt([-1.5, 0, 3, 0.4])]], [1.25, [title(), txt([-1.5, 0, 3, 0.4]), eq([-1, 0.2, 2, 0.6])]]],
  expect: [{ rule: 'overlap', level: 'fail', at: [1, [1, 2]] }] })));
add('text-over-figure', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [fig('Polygon', [-2, -1.5, 4, 2.5])]], [2.5, [fig('Polygon', [-2, -1.5, 4, 2.5]), txt([-0.8, -0.2, 1.6, 0.4], { role: 'label', nominal_u: 3.2 })]]],
  expect: [{ rule: 'overlap', level: 'fail', at: [1, [0, 1]] }] }]);
add('tiny-text', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [title()]], [1.0, [title(), txt([-1, -1, 2, 0.2], { nominal_u: 2.5 })]]],
  expect: [{ rule: 'size', level: 'fail', at: [1, [1]] }] }]);
add('low-contrast', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [title()]], [1.75, [title(), txt([-1.5, -1, 3, 0.4], { color: GRAY3 })]]],
  expect: [{ rule: 'contrast', level: 'fail', at: [1, [1]] }] }], { note: `gray ${GRAY3} on ${BG} = ${ratio(GRAY3, BG).toFixed(2)}:1` });
add('density-6', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [txt([-1, 2, 2, 0.3])]], [3.0, [0, 1, 2, 3, 4, 5].map((i) => txt([-1, 2 - i * 0.7, 2, 0.3]))]],
  expect: [{ rule: 'density', level: 'warn', at: [1, [0, 1, 2, 3, 4, 5]] }] }]);
add('frame-boundary-3.20', 'seeded', [{ fmt: '16:9', fps: 30,
  frames: [[3.2 - 1 / 30, [title(), txt([-1.5, 0, 3, 0.4])]],
    [3.2, [title(), txt([-1.5, 0, 3, 0.4]), txt([1.2, 0.1, 2, 0.4])]],
    [3.2 + 1 / 30, [title(), txt([-1.5, 0, 3, 0.4]), txt([1.6, 0.1, 2, 0.4])]]],
  expect: [{ rule: 'overlap', level: 'fail', at: [1, [1, 2]] }] }]);
const oneBox = [2.0, 0, 1.6, 0.4]; // right edge 3.6: inside 16:9 safe (6.258), outside 9:16 safe (3.44), inside 9:16 frame (4.0)
add('overflow-one-format', 'seeded', [
  { fmt: '16:9', fps: 30, frames: [[0.5, [title()]], [1.5, [title(), txt(oneBox)]]], expect: [] },
  { fmt: '9:16', fps: 30, frames: [[0.5, [title()]], [1.5, [title(), txt(oneBox)]]],
    expect: [{ rule: 'offscreen', level: 'fail', at: [1, [1]], aspect: 'SAFE' }] }]);

// ---- 6 clean scenes ---------------------------------------------------------------------------
add('clean-centered-stack', 'clean', ['16:9', '9:16'].map((fmt) => ({ fmt, fps: 30,
  frames: [[0.5, [title()]], [1.5, [title(), eq([-2, 0.2, 4, 0.8])]], [2.5, [title(), eq([-2, 0.2, 4, 0.8]), txt([-2.5, -1.2, 5, 0.35])]]],
  expect: [] })));
const plane = fig('NumberPlane', [-5, -3, 10, 6]);
const ticks = [-3, -2, -1, 1, 2, 3, 4].map((x) => txt([x - 0.1, -0.35, 0.2, 0.25], { role: 'tick', nominal_u: 2.8 }));
add('clean-axis-ticks', 'clean', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [plane]], [1.5, [plane, ...ticks]]], expect: [] }],
{ allow_pairs: [['NumberPlane', 'tick']], control: 'overlap' });
add('clean-brace-label', 'clean', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [eq([-1.5, 0.5, 3, 0.8])]],
    [1.5, [eq([-1.5, 0.5, 3, 0.8]), fig('Brace', [-1.5, 0.1, 3, 0.35]), txt([-0.6, -0.4, 1.2, 0.6], { role: 'label', nominal_u: 3.2 })]]],
  expect: [] }], { allow_pairs: [['Brace', 'label']], control: 'overlap' });
add('clean-figure-only', 'clean', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [plane]], [1.5, [plane, fig('Polygon', [-1, -1, 3, 2]), fig('Square', [0, 0, 1, 1]), fig('Arrow', [-0.5, -0.5, 2.5, 1.2])]]],
  expect: [] }]);
const nl = fig('NumberLine', [-5, -0.2, 10, 0.4]);
add('clean-small-legal-ticks', 'clean', [{ fmt: '16:9', fps: 30,
  frames: [[0.5, [nl]], [1.5, [nl, ...[-4, -2, 0, 2, 4].map((x) => txt([x - 0.1, -0.5, 0.2, 0.22], { role: 'tick', nominal_u: 2.7 })),
    txt([3, 1.5, 2, 0.25], { role: 'legend', nominal_u: 2.6 })]]],
  expect: [] }]);
add('clean-four-texts', 'clean', ['16:9', '9:16'].map((fmt) => ({ fmt, fps: 30,
  frames: [[0.5, [title()]], [2.0, [title(), eq([-2, 0.6, 4, 0.8]), txt([-2, -0.6, 4, 0.35]), txt([-2, -1.4, 4, 0.35])]]],
  expect: [] })));

// ---- write ------------------------------------------------------------------------------------
for (const e of readdirSync(HERE)) if (statSync(join(HERE, e)).isDirectory()) rmSync(join(HERE, e), { recursive: true });
const index = [];
for (const c of cases) {
  const variants = c.variants.map((v) => {
    fid = 0;
    const frames = v.frames.map(([t, objs]) => frame(t, objs));
    const dir = join(HERE, c.name, 'records', v.fmt.replace(':', 'x'));   // Windows-safe dir names (16x9)
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 's01-layout.json'), JSON.stringify(frames, null, 1) + '\n');
    const trace = frames.map((f, i) => ({ kind: 'animation', t: f.t, i: i + 1, scene: 's01', sentence: null,
      animation: 'Write', file: 'scenes/s01.py', line: 10 + i * 3 }));
    writeFileSync(join(dir, 's01-trace.json'), JSON.stringify(trace, null, 1) + '\n');
    return { fmt: v.fmt, fps: v.fps, expect: v.expect.map((x) => ({
      rule: x.rule, level: x.level, t: frames[x.at[0]].t,
      ids: x.at[1].map((j) => frames[x.at[0]].objects[j].id).sort(),
      source_line: `scenes/s01.py:${10 + x.at[0] * 3}`, ...(x.aspect ? { aspect: x.aspect } : {}),
    })) };
  });
  const cj = { name: c.name, kind: c.kind, allow_pairs: c.allow_pairs ?? null, control: c.control ?? null,
    ...(c.note ? { note: c.note } : {}), variants };
  writeFileSync(join(HERE, c.name, 'case.json'), JSON.stringify(cj, null, 1) + '\n');
  index.push(c.name);
}
writeFileSync(join(HERE, 'design.json'), readFileSync(join(HERE, '..', '..', '..', '..', 'templates', 'math', 'design.json')));

// the solver case: 8 labels around an octagon's vertices, crowded by the polygon box and a plane box
const anchors = [], R = 1.5, C = [-2, 0];
for (let k = 0; k < 8; k++) anchors.push([r3(C[0] + R * Math.cos(k * Math.PI / 4)), r3(C[1] + R * Math.sin(k * Math.PI / 4))]);
const sizes = [[1.2, 0.4], [1.1, 0.4], [1.3, 0.4], [1.2, 0.45], [1.2, 0.4], [1.0, 0.4], [1.4, 0.4], [1.2, 0.35]];
writeFileSync(join(HERE, 'solver-octagon.json'), JSON.stringify({
  anchors, sizes, obstacles: [[C[0] - R, C[1] - R, 2 * R, 2 * R], [0.5, -3, 5.5, 6]], max_distance: 2.0, step: 0.25,
}, null, 1) + '\n');
writeFileSync(join(HERE, 'solver-infeasible.json'), JSON.stringify({
  anchors: [[0, 0]], sizes: [[1.2, 0.4]], obstacles: [[-3, -3, 6, 6]], max_distance: 2.0, step: 0.25,
}, null, 1) + '\n');
console.log(`${index.length} cases (${cases.filter((c) => c.kind === 'seeded').length} seeded, ${cases.filter((c) => c.kind === 'clean').length} clean); low-contrast gray ${GRAY3} = ${ratio(GRAY3, BG).toFixed(2)}:1`);
