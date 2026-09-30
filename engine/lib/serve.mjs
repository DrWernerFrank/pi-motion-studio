// Static file server over the studio root, so films can use ES module imports
// (Chrome refuses module imports over file://). Loopback only. Supports Range for media.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8',
};

// Resolve a URL path inside ROOT, refusing traversal and dotfiles (.env, .venv, .pi).
export function safePath(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (rel.split(/[/\\]/).some((seg) => seg.startsWith('.') || seg === 'node_modules')) return null;
  const full = join(ROOT, rel);
  return full.startsWith(ROOT) ? full : null;
}

export function sendFile(req, res, full) {
  let st;
  try { st = statSync(full); } catch { res.writeHead(404); return res.end('not found'); }
  if (st.isDirectory()) return sendFile(req, res, join(full, 'index.html'));
  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  createReadStream(full).on('error', () => res.destroy()).pipe(res);
}

// Ephemeral static server for the renderer / gates. Returns { url, close }.
export function serveStatic(port = 0) {
  const server = createServer((req, res) => {
    const full = safePath(new URL(req.url, 'http://x').pathname);
    if (!full) { res.writeHead(403); return res.end(); }
    sendFile(req, res, full);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}
