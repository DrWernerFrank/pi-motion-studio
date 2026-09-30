// design.js: author every value out of design.json.
//   const D = await loadDesign();          // in setup()
//   D.type(ctx, 'hero', L)                 // sets font + tracking from the ladder, returns px
//   D.c.accent, D.feel('ui')               // palette + spring feel
import * as M from './motion.js';

export async function loadDesign(url = './design.json') {
  const d = await fetch(url, { cache: 'no-store' }).then((r) => r.json());
  const rungs = Object.fromEntries((d.ladder || []).map((r) => [r.role, r]));
  const familyFor = (role) => (role === 'label' || role === 'body' ? d.fonts.ui : d.fonts.display);
  return {
    raw: d,
    c: d.palette,
    fonts: d.fonts,
    // Ladder sizes are in u (1u = 1% of the short side), so every format scales consistently.
    px(role, L) { const r = rungs[role]; if (!r) throw new Error(`design.json ladder has no role "${role}"`); return r.u * L.u; },
    type(ctx, role, L, { family, scale = 1, style = '' } = {}) {
      const r = rungs[role]; if (!r) throw new Error(`design.json ladder has no role "${role}"`);
      const px = r.u * L.u * scale;
      M.font(ctx, px, `"${family || r.family || familyFor(role)}"`, r.weight, r.trackingEm || 0, style);
      return px;
    },
    upper: (role, s) => (rungs[role]?.case === 'upper' ? s.toUpperCase() : s),
    feel(name) { const f = d.motion?.[name] || name; return M[f] || M.DEFAULT; },
    stagger: d.motion?.stagger ?? 0.05,
  };
}
