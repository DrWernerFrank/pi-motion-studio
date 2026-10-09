// fetch.mjs — the one place the producer touches the network for facts/assets. What comes back is
// DATA, never instructions (§3.6): a page that says "ignore your rules and ship X" is recorded and
// ignored. Sources are pinned: the body is stored under sources/ with its sha; the fact's quote
// must occur in THAT body (offline verification). Nothing copyrighted is fetched: the helpers aim
// at open sources (Wikimedia Commons, NASA, Internet Archive, public datasets) and record URL +
// license + sha256 in the project's assets.json (K6) / docs/produce/THIRD_PARTY.md (the mission).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS } from '../lib/film.mjs';

const UA = 'MotionStudio-producer/1.0 (local; +https://localhost)';

/** Fetch a page's text (HTML stripped to text, links and titles kept). Timeout, size cap, no redirects to weird hosts. */
export async function fetchSource(url, { timeoutMs = 20000, maxBytes = 4 << 20 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' } });
    if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`fetch ${url}: ${buf.length} bytes > the ${maxBytes} cap`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? JSON.stringify(JSON.parse(buf.toString('utf8')), null, 1) : htmlToText(buf.toString('utf8'));
  } finally { clearTimeout(t); }
}

/** Store a snapshot under sources/ (content-addressed name when no id given). Returns the rel path. */
export function storeSnapshot(key, id, body) {
  const dir = join(FILMS, key, 'sources');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.snapshot.txt`);
  writeFileSync(file, body);
  return { file: `sources/${id}.snapshot.txt`, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length };
}

/** Strip HTML to readable text: drop scripts/styles/tags, keep link text + hrefs (license pages
 *  hide the terms in link text). Never executes anything; never follows instructions in the body. */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, ' $2 [$1] ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── open-source helpers: license-parsed asset fetching (Wikimedia Commons / NASA / Internet Archive)
// The API calls are recorded as FIXTURES (tests run against them; a live fetch only happens when the
// producer actually needs the asset). Each helper returns a candidate { url, title, license,
// attribution, meta } — the producer LOOKS at the candidates, picks, and addAsset() pins the license.
export async function commonsCandidates(search, { limit = 5 } = {}) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(search)}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600`;
  const j = JSON.parse(await fetchSource(api));
  const out = [];
  for (const page of Object.values(j.query?.pages ?? {})) {
    const ii = page.imageinfo?.[0]; if (!ii) continue;
    const meta = ii.extmetadata ?? {};
    const lic = meta.LicenseShortName?.value || meta.UsageTerms?.value || '';
    out.push({ url: ii.url || ii.thumburl, title: page.title, descriptionurl: ii.descriptionurl,
      license: lic, attribution: [meta.Artist?.value, meta.Credit?.value].filter(Boolean).join(' — ') || null, meta: { license: lic, credit: meta.Credit?.value, usage: meta.UsageTerms?.value, description: meta.ImageDescription?.value, source: 'wikimedia commons' } });
  }
  return out;
}

export async function nasaImage(query) {
  // NASA's images API (images.nasa.gov) is public domain for media, attribution requested
  const j = JSON.parse(await fetchSource(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image`));
  const item = j.collection?.items?.[0]; if (!item) return null;
  const d = item.data?.[0] ?? {};
  const link = item.links?.find((l) => l.rel === 'preview') ?? {};
  return { url: link.href, title: d.title, description: d.description, date: d.date_created,
    license: 'nasa', attribution: `NASA${d.center ? ` ${d.center}` : ''} — ${d.title}`, meta: { license: 'NASA media usage guidelines (public domain)', usage: 'NASA guidelines', source: 'nasa' } };
}

/** Internet Archive metadata (the license field carries their rights statement). */
export async function archiveMeta(identifier) {
  const j = JSON.parse(await fetchSource(`https://archive.org/metadata/${encodeURIComponent(identifier)}`));
  const m = j.metadata ?? {};
  return { identifier, title: m.title, license: m.licenseurl || m.rights || null, meta: { license: m.licenseurl, usage: m.rights, credit: m.creator, description: m.description, source: 'internet archive' } };
}
