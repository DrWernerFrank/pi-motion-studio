// Node-side helpers: locate a film, read its config, open it in headless Chromium.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseFps } from './frames.mjs';
import { ROOT, serveStatic } from './serve.mjs';

export const FILMS = join(ROOT, 'films');
export const fmtSlug = (f) => f.replace(':', 'x');

export function filmDir(key) {
  if (!key) throw new Error('name a film: studio <command> <film-key>');
  const dir = existsSync(join(FILMS, key)) ? join(FILMS, key) : resolve(key);
  if (!existsSync(join(dir, 'film.json'))) throw new Error(`no film.json in ${dir}`);
  return dir;
}

export function readFilm(key) {
  const dir = filmDir(key);
  const cfg = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8'));
  cfg.fps ??= 60; cfg.formats ??= ['9:16']; cfg.motionBlur ??= 4;
  const rel = dir.slice(ROOT.length).replace(/\\/g, '/');
  const out = join(dir, 'out'); mkdirSync(out, { recursive: true });
  return { dir, rel, out, cfg, fps: parseFps(cfg.fps), key: dir.split(/[/\\]/).pop() };
}

export const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

// Flags chosen for pixel-identical output run to run.
const CHROME_ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-gpu', '--hide-scrollbars'];

// Opens one headless browser + static server. pages(n, fmt, scale) gives ready film pages.
export async function openStudio() {
  const { chromium } = await import('playwright');
  const srv = await serveStatic();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const errors = [];
  async function page(film, fmt, scale = 1) {
    const [w, h] = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350] }[fmt];
    const p = await browser.newPage({ viewport: { width: Math.round(w * scale), height: Math.round(h * scale) }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(String(e)));
    // optional files (beats.json for edit films, track.json / transcript.json when not yet made): their 404s
    // are not errors — a missing optional input is a first-class state, not a broken render
    const OPTIONAL = /\/(beats|track|transcript)\.json$/;
    p.on('console', (m) => { if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && OPTIONAL.test(m.location()?.url || ''))) errors.push(m.text()); });
    await p.goto(`${srv.url}${film.rel}/index.html?render=1&fmt=${fmtSlug(fmt)}&scale=${scale}`);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => {
      throw new Error(`film page never became ready (${film.key} ${fmt}).\n${errors.join('\n') || 'no console errors: does index.html call film({...}) from /engine/lib/runtime.js?'}`);
    });
    return p;
  }
  return { page, errors, close: async () => { await browser.close(); await srv.close(); } };
}

export async function stillPng(page, t) {
  const url = await page.evaluate((t) => window.__frame(t, 'image/png'), t);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
