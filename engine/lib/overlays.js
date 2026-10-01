// On-footage graphics (mission D6/P6): title, lower third, callout, progress. Design comes from design.json;
// restraint from AGENTS.md (titles only when they carry information, nothing under 3.2u, one accent).
// Each overlay changes pixels ONLY inside its own time window — the `overlays` check proves it by diffing
// against a no-overlay render of the same frames.
import { spring } from './motion.js';

// draw the overlays active at t; returns the list drawn with their boxes (for the check)
export function drawOverlays(ctx, t, L, D, overlays, cfg) {
  const out = [];
  for (const o of overlays ?? []) {
    if (t < o.at || t > o.at + o.dur) continue;
    const lt = t - o.at, life = Math.min(1, lt / 0.35), outLife = Math.min(1, Math.max(0, (o.at + o.dur - t) / 0.3));
    const a = Math.min(life, outLife);
    const u = L.u, c = D?.c || { ink: '#fff', muted: '#9aa', accent: '#ff5a1f', plate: 'rgba(10,10,12,0.82)' };
    const font = (px, w = 600) => { ctx.font = `${w} ${px}px ${D?.fonts?.display || 'Inter'}`; };
    ctx.save();
    if (o.type === 'title') { // a title card: big centred display type, entering on a spring
      const k = spring(lt, 220, 26) , px = u * 11, text = String(o.props.text ?? '');
      font(px, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = a;
      ctx.fillStyle = c.ink; ctx.fillText(text, L.cx, L.cy + (1 - k) * u * 4);
      ctx.fillStyle = c.accent; ctx.fillRect(L.cx - u * 8 * k, L.cy + px * 0.72, u * 16 * k, Math.max(u * 0.5, 2));
      out.push({ o, box: { x: L.cx - u * 40, y: L.cy - px, w: u * 80, h: px * 2 } });
    } else if (o.type === 'lower-third') { // name + role, bottom left, a bar in the accent
      const px = u * 4.6, x = L.safe.x, y = L.safe.y + L.safe.h - u * 16;
      ctx.globalAlpha = a; font(px * 0.42, 500); ctx.fillStyle = c.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(o.props.role ?? '').toUpperCase(), x + px * 0.9, y + px * 0.4);
      font(px * 0.62, 700); ctx.fillStyle = c.ink; ctx.fillText(String(o.props.name ?? ''), x + px * 0.9, y);
      ctx.fillStyle = c.accent; ctx.fillRect(x, y - px * 0.55, Math.max(u * 0.6, 2) * 8 * Math.min(1, lt / 0.2), px * 1.15);
      out.push({ o, box: { x, y: y - px * 0.6, w: px * 14, h: px * 1.6 } });
    } else if (o.type === 'callout') { // a pointer label for a detail: dot + line + label at props.x/y (fractions)
      const px = u * 3.4, fx = L.W * (o.props.x ?? 0.72), fy = L.H * (o.props.y ?? 0.4), lx = fx + u * 6, ly = fy - u * 6;
      ctx.globalAlpha = a; ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(fx, fy, u * 0.9, 0, 7); ctx.fill();
      ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(u * 0.25, 1.5);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(lx - u * 1.5, ly + u * 1.5); ctx.stroke();
      font(px, 600); ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const text = String(o.props.text ?? ''); const w = ctx.measureText(text).width;
      ctx.fillStyle = c.plate; ctx.beginPath(); ctx.roundRect(lx - u, ly - px * 0.8, w + u * 2, px * 1.6, u); ctx.fill();
      ctx.fillStyle = c.ink; ctx.fillText(text, lx, ly);
      out.push({ o, box: { x: fx - u, y: ly - px, w: lx + w + u - fx + u, h: fy - ly + px * 2 } });
    } else if (o.type === 'punch-in') { // handled by the camera (edit.js): only the cue dot is drawn here
      if (o.props.showDot !== false) { ctx.globalAlpha = a * 0.9; ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(L.W * (o.props.x ?? 0.5), L.H * (o.props.y ?? 0.5), u * 1.1, 0, 7); ctx.fill(); }
      out.push({ o, box: null, camera: true });
    }
    ctx.restore();
  }
  return out;
}

// the extra camera zoom a punch-in applies at clip-local time lt (a critically damped spring: fast in, no bounce)
export function punchInZoom(lt, { dur = 0.4, zoom = 1.18 } = {}) {
  if (lt < 0 || lt > dur + 0.6) return 1;
  return 1 + (zoom - 1) * Math.min(1, spring(Math.min(lt, dur + 0.6), 170, 22) * Math.min(1, Math.max(0, (dur + 0.45 - Math.min(lt, dur + 0.6)) / 0.45)));
}
