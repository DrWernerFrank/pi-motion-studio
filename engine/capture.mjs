// Gather real brand assets from a URL into films/<key>/assets/: screenshots (desktop + phone,
// viewport + full page), logo candidates, the site's actual colors and fonts → assets/site.json.
// "Never redraw the product UI from imagination. Crop and animate the real thing."
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFilm } from './lib/film.mjs';

export async function capture(key, url, { log = console.log } = {}) {
  const film = readFilm(key);
  const dir = join(film.dir, 'assets'); mkdirSync(dir, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const found = { url, at: new Date().toISOString(), screenshots: [], logos: [], colors: [], fonts: [], title: '', description: '' };
  try {
    for (const [name, vp, dpr] of [['desktop', { width: 1440, height: 900 }, 2], ['phone', { width: 390, height: 844 }, 3]]) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: dpr });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.waitForTimeout(3000));
      await page.waitForTimeout(1200);
      for (const f of [`${name}.png`, `${name}-full.png`]) {
        await page.screenshot({ path: join(dir, f), fullPage: f.includes('full') });
        found.screenshots.push(`assets/${f}`);
      }
      if (name === 'desktop') {
        Object.assign(found, await page.evaluate(() => {
          const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
          const logos = new Set();
          document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]').forEach((l) => logos.add(abs(l.href)));
          const og = document.querySelector('meta[property="og:image"]'); if (og) logos.add(abs(og.content));
          document.querySelectorAll('header img, nav img, a[href="/"] img, [class*="logo" i] img, img[alt*="logo" i]').forEach((i) => logos.add(abs(i.currentSrc || i.src)));
          const svgs = [...document.querySelectorAll('header svg, nav svg, a[href="/"] svg, [class*="logo" i] svg')].slice(0, 4).map((s) => s.outerHTML).filter((s) => s.length < 60000);
          // Colors weighted by painted area; fonts by text length.
          const area = new Map(), fonts = new Map();
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 3) continue;
            const cs = getComputedStyle(el);
            const bg = cs.backgroundColor; if (bg && !/rgba\(.*, 0\)|transparent/.test(bg)) area.set(bg, (area.get(bg) || 0) + r.width * r.height);
            const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
            if (direct) { area.set(cs.color, (area.get(cs.color) || 0) + direct.length * 200); const f = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); fonts.set(f, (fonts.get(f) || 0) + direct.length); }
          }
          const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
          return {
            title: document.title, description: document.querySelector('meta[name="description"]')?.content || '',
            logos: [...logos].filter(Boolean), svgs, colors: top(area, 10), fonts: top(fonts, 5),
            headings: [...document.querySelectorAll('h1, h2')].slice(0, 8).map((h) => h.innerText.trim()).filter(Boolean),
          };
        }));
        found.svgs.forEach((s, i) => { writeFileSync(join(dir, `logo-inline-${i}.svg`), s); });
        found.svgs = found.svgs.map((_, i) => `assets/logo-inline-${i}.svg`);
        let i = 0;
        for (const u of found.logos.slice(0, 6)) {
          const r = await page.request.get(u).catch(() => null);
          if (!r || !r.ok()) continue;
          const ext = (r.headers()['content-type'] || '').includes('svg') ? 'svg' : (r.headers()['content-type'] || '').split('/')[1]?.split(';')[0] || 'png';
          const f = `logo-${i++}.${ext.replace('x-icon', 'ico').replace('jpeg', 'jpg')}`;
          writeFileSync(join(dir, f), await r.body());
          found.logos[found.logos.indexOf(u)] = `assets/${f}  (${u})`;
        }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  writeFileSync(join(dir, 'site.json'), JSON.stringify(found, null, 2));
  log(`assets/site.json: "${found.title}"\n  colors: ${found.colors.join('  ')}\n  fonts: ${found.fonts.join(', ')}\n  logos: ${found.logos.length} + ${found.svgs.length} inline svg\n  screenshots: ${found.screenshots.join(', ')}`);
  return found;
}
