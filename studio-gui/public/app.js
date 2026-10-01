// Motion Studio GUI. Watches films/ over SSE; the live view calls the film's own window.seek(t).
// The Edit tab (films with an edit.json) lives in edit.js and is mounted from here.
import * as EDIT from './edit.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (u) => fetch(u, { cache: 'no-store' }).then((r) => r.json());
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-token': window.STUDIO_TOKEN }, body: JSON.stringify(b) }).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.status); e.code = j.code; e.body = j; throw e; }  // edit.js reads .code (the 409 story)
  return j;
});
const slug = (f) => f.replace(':', 'x');
const RUBRIC = ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound'];
const COLORS = { hook: '#ff6a3d', readability: '#5ab0ff', motion: '#3ecf8e', variety: '#c77dff', composition: '#f5b841', brand: '#ff7eb6', sound: '#7ee0d0' };
const CUE_COLORS = { impact: '#ff4d5e', thump: '#ff4d5e', drop: '#ff4d5e', whoosh: '#5ab0ff', swipe: '#5ab0ff', riser: '#c77dff', click: '#ececef', tick: '#ececef', pop: '#f5b841', type: '#8b8b94', chime: '#3ecf8e', glitch: '#ff7eb6', shutter: '#ececef' };

const S = { films: [], key: null, d: null, fmt: null, view: 'live', tab: 'overview', t: 0, playing: false, jobs: {}, running: new Set(), frameReady: false };
const audio = new Audio();
const iframe = $('#live'), video = $('#video'), tl = $('#timeline');

// ── films ────────────────────────────────────────────────────────────────────
async function loadFilms() {
  S.films = await api('/api/films');
  const ul = $('#films');
  ul.innerHTML = S.films.map((f) => {
    const g = f.gates ? (f.gates.pass ? (f.gates.warns ? 'warn' : 'ok') : 'bad') : '';
    const r = f.review ? (f.review.pass ? 'ok' : 'warn') : '';
    return `<li data-k="${f.key}" class="${f.key === S.key ? 'on' : ''}">
      <div class="k"><span class="dot ${S.running.has(f.key) ? 'run' : r}"></span>${esc(f.title)}</div>
      <div class="s"><span>${f.duration}s · ${f.formats.join(' ')}</span>
      <span>${f.review ? `r${f.review.round} min ${f.review.min}` : 'no review'}</span>
      <span><span class="dot ${g}"></span> gates</span>${f.finals.length ? '<span>● rendered</span>' : ''}</div></li>`;
  }).join('') || '<li class="dim">no films yet</li>';
  ul.querySelectorAll('li[data-k]').forEach((li) => (li.onclick = () => selectFilm(li.dataset.k)));
  if (!S.key && S.films.length) selectFilm(new URLSearchParams(location.hash.slice(1)).get('film') || S.films[0].key);
}

async function selectFilm(key, { keepTime = false } = {}) {
  const changed = key !== S.key;
  S.key = key;
  history.replaceState(null, '', `#film=${key}`);
  const d = await api(`/api/films/${key}`);
  if (d.error || key !== S.key) return;   // a newer selection (or film churn) superseded this response
  const codeChanged = !S.d || S.d.code !== d.code || changed;
  S.d = d;
  if (changed) { S.fmt = d.formats[0]; if (!keepTime) S.t = 0; pause(); }
  if (changed && d.edit) S.tab = 'edit';              // an edit film opens on its editor
  EDIT.setFilm(S, d);                                 // mounts the editor dock + Edit tab (no-op for motion films)
  if (!d.formats.includes(S.fmt)) S.fmt = d.formats[0];
  $('#empty').hidden = true; $('#film').hidden = false; $('#panel').hidden = false;
  $('#fTitle').textContent = d.title;
  const bpm = d.beats?.bpm ? `${Math.round(d.beats.bpm)} bpm` : '';
  $('#fMeta').textContent = [`films/${key}`, `${d.cfg.duration}s @ ${d.cfg.fps}fps`, bpm, d.cfg.loop ? 'loop' : ''].filter(Boolean).join(' · ');
  $('#fmtSeg').innerHTML = d.formats.map((f) => `<button data-f="${f}" class="${f === S.fmt ? 'on' : ''}">${f}</button>`).join('');
  $('#fmtSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.fmt = b.dataset.f; selectFilm(S.key, { keepTime: true }); reloadMedia(true); }));
  document.querySelectorAll('#films li').forEach((li) => li.classList.toggle('on', li.dataset.k === key));
  reloadMedia(codeChanged);
  if (!(S.tab === 'notes' && document.activeElement?.id === 'noteText') && !(S.tab === 'edit' && EDIT.handles(S) && !changed)) renderTab();
  drawTimeline();
}

function reloadMedia(reloadFrame) {
  const d = S.d, v = Date.now();
  if (reloadFrame) {
    S.frameReady = false;
    iframe.src = `/films/${d.key}/index.html?embed=1&fmt=${slug(S.fmt)}&t=${S.t}&v=${v}`;
  }
  const mix = d.files.find((f) => f.name === 'mix.wav');
  const want = mix ? `/films/${d.key}/out/mix.wav?v=${mix.mtime}` : '';
  if (audio.dataset.src !== want) { audio.dataset.src = want; audio.src = want; }
  const mp4 = ['final', 'draft'].map((k) => d.files.find((f) => f.name === `${k}-${slug(S.fmt)}.mp4`)).find(Boolean);
  $('#noRender').hidden = !!mp4; video.hidden = !mp4;
  const vsrc = mp4 ? `/films/${d.key}/out/${mp4.name}?v=${mp4.mtime}` : '';
  if (video.dataset.src !== vsrc) { video.dataset.src = vsrc; if (vsrc) video.src = vsrc; else video.removeAttribute('src'); }
}

addEventListener('message', (e) => { if (e.data?.filmReady) { S.frameReady = true; seek(S.t); } });

// ── transport ───────────────────────────────────────────────────────────────
function seek(t) {
  const D = S.d?.cfg.duration || 0;
  S.t = Math.max(0, Math.min(D, t));
  $('#tc').textContent = S.t.toFixed(2) + 's';
  if (S.view === 'live' && S.frameReady) {
    try {
      // edit films must go through postMessage: the film page awaits its footage prepare() before painting
      if (EDIT.handles(S)) iframe.contentWindow.postMessage({ seek: S.t }, '*');
      else iframe.contentWindow.seek(S.t);
    } catch {}
  }
  if (S.view === 'render' && !S.playing && Math.abs(video.currentTime - S.t) > 0.03) video.currentTime = S.t;
  drawTimeline();
}
let clock0 = 0, t0 = 0;
function play() {
  if (!S.d) return;
  if (S.view === 'live' && EDIT.handles(S)) return EDIT.play();  // the editor's transport (J/K/L shuttle)
  S.playing = true; $('#play').textContent = '❚❚';
  if (S.t >= S.d.cfg.duration - 0.01) S.t = 0;
  if (S.view === 'render') { video.currentTime = S.t; video.play(); return; }
  t0 = S.t; clock0 = performance.now();
  if (audio.src) { audio.currentTime = S.t; audio.play().catch(() => {}); }
  requestAnimationFrame(tick);
}
function pause() { if (EDIT.handles(S)) EDIT.pause(); S.playing = false; $('#play').textContent = '▶'; audio.pause(); video.pause(); }
function tick(now) {
  if (!S.playing || S.view !== 'live') return;
  const D = S.d.cfg.duration;
  let t = audio.src && !audio.paused ? audio.currentTime : t0 + (now - clock0) / 1000;
  if (t >= D) {
    if (!$('#loopChk').checked) { seek(D); return pause(); }
    t = 0; t0 = 0; clock0 = now; if (audio.src) { audio.currentTime = 0; audio.play().catch(() => {}); }
  }
  seek(t); requestAnimationFrame(tick);
}
video.ontimeupdate = () => { if (S.view === 'render') { S.t = video.currentTime; $('#tc').textContent = S.t.toFixed(2) + 's'; drawTimeline(); } };
video.onended = () => { if ($('#loopChk').checked) { video.currentTime = 0; video.play(); } else pause(); };
$('#play').onclick = () => (S.playing ? pause() : play());
$('#viewSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  pause(); S.view = b.dataset.v;
  $('#viewSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  $('#liveWrap').hidden = S.view !== 'live'; $('#renderWrap').hidden = S.view !== 'render';
  seek(S.t);
}));
addEventListener('keydown', (e) => {
  if (!S.d || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (EDIT.handles(S) && EDIT.keys(e)) return;   // J/K/L · I/O · S · Del · Ctrl+Z/Y · frame step
  const fps = Number(S.d.cfg.fps);   // edit films carry a rational rate ("30000/1001"): never let step go NaN
  const step = e.shiftKey ? 1 : 1 / (Number.isFinite(fps) && fps > 0 ? fps : 60);
  if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
  if (e.code === 'ArrowRight') { pause(); seek(S.t + step); }
  if (e.code === 'ArrowLeft') { pause(); seek(S.t - step); }
  if (e.key === 'n') { e.preventDefault(); S.tab = 'notes'; renderTab(); setTimeout(() => $('#noteText')?.focus(), 0); }
});

// ── timeline ────────────────────────────────────────────────────────────────
function drawTimeline() {
  const d = S.d; if (!d) return;
  if (EDIT.handles(S)) return EDIT.drawTimeline(S);   // the edit minimap: clips, playhead, viewport
  const dpr = devicePixelRatio || 1, W = tl.clientWidth, H = 64;
  if (tl.width !== W * dpr) { tl.width = W * dpr; tl.height = H * dpr; }
  const c = tl.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const D = d.cfg.duration, x = (t) => (t / D) * W;
  // shots
  const shots = d.cfg.shots || [];
  shots.forEach((s, i) => {
    const a = x(s.t), b = x(shots[i + 1]?.t ?? D);
    c.fillStyle = i % 2 ? '#1d1d22' : '#232329'; c.fillRect(a, 0, b - a, 22);
    c.fillStyle = '#b4b4bd'; c.font = '11px Inter, sans-serif';
    c.save(); c.beginPath(); c.rect(a, 0, b - a - 2, 22); c.clip(); c.fillText(s.name, a + 5, 15); c.restore();
  });
  // beats
  if (d.beats) {
    const down = new Set(d.beats.downbeats);
    for (const b of d.beats.beats) { if (b > D) break; c.fillStyle = down.has(b) ? '#55555f' : '#303036'; c.fillRect(x(b), 24, 1, down.has(b) ? 14 : 8); }
  }
  // cues
  for (const q of d.cues) { c.fillStyle = CUE_COLORS[q.type] || '#aaa'; c.beginPath(); c.arc(x(q.t), 44, 2.6, 0, 7); c.fill(); }
  // notes + latest review problems
  for (const n of d.notes.filter((n) => !n.done)) { c.fillStyle = '#ff6a3d'; c.fillRect(x(n.t) - 1, 50, 3, 12); }
  const last = d.reviews.at(-1);
  if (last) for (const p of last.problems || []) { const t = parseFloat(p.t); if (isNaN(t)) continue; c.fillStyle = '#ff4d5e'; c.beginPath(); c.moveTo(x(t), 52); c.lineTo(x(t) - 5, 62); c.lineTo(x(t) + 5, 62); c.fill(); }
  // playhead
  c.fillStyle = '#fff'; c.fillRect(x(S.t) - 1, 0, 2, H);
}
let dragging = false;
const scrubTo = (e) => { const r = tl.getBoundingClientRect(); pause(); seek(((e.clientX - r.left) / r.width) * S.d.cfg.duration); };
tl.onpointerdown = (e) => {
  if (EDIT.handles(S)) return EDIT.miniDown(e);   // the edit minimap: click = seek, drag inside the viewport = pan
  dragging = true; tl.setPointerCapture(e.pointerId); scrubTo(e);
};
tl.onpointermove = (e) => dragging && scrubTo(e);
tl.onpointerup = () => (dragging = false);
addEventListener('resize', drawTimeline);

// ── panel ───────────────────────────────────────────────────────────────────
$('#tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderTab(); }));
function renderTab() {
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const d = S.d, el = $('#tabBody');
  if (!d) return;
  if (S.tab === 'edit') return EDIT.renderTab(S, el);   // media bin · inspector · cut proposals · transcript
  if (S.tab === 'overview') {
    const des = d.design || {};
    el.innerHTML = `
      <h3>Direction</h3><p>${esc(des.direction || '—')}</p>
      ${des.palette ? `<h3>Palette</h3><div class="swatches">${Object.entries(des.palette).map(([k, v]) => `<div class="sw"><i style="background:${esc(v)}"></i>${esc(k)}</div>`).join('')}</div>` : ''}
      ${des.fonts ? `<h3>Type</h3><div class="kv">${Object.entries(des.fonts).map(([k, v]) => `<span>${esc(k)}</span><span style="font-family:'${esc(v)}'">${esc(v)}</span>`).join('')}</div>` : ''}
      <h3>Film</h3><div class="kv"><span>duration</span><span>${d.cfg.duration}s @ ${d.cfg.fps}fps, blur x${d.cfg.motionBlur ?? 4}</span>
        <span>formats</span><span>${d.formats.join(', ')}</span>
        <span>sound</span><span>${d.cfg.track ? 'track: ' + esc(d.cfg.track) : `synth ${esc(d.cfg.music?.style || 'drive')} · ${d.cfg.music?.bpm || 120} bpm · ${esc(d.cfg.music?.key || '')}`}</span>
        <span>cues</span><span>${d.cues.length}</span></div>
      <h3>Brief</h3><div class="md">${md(d.brief || '')}</div>
      <h3>Shot list</h3><div class="md">${md(d.shotlist || '')}</div>`;
  }
  if (S.tab === 'reviews') {
    const rs = d.reviews, last = rs.at(-1);
    el.innerHTML = !last ? '<p class="dim">No critique rounds yet. pi records them with the <code>film_review</code> tool (or <code>studio review</code>).</p>' : `
      <h3>Round ${last.round} · ${last.pass ? '<span style="color:var(--ok)">pass</span>' : 'not yet'} · ${esc(last.reviewer)}</h3>
      <div class="scores">${RUBRIC.map((k) => `<div>${k}<div class="bar"><i style="width:${last.scores[k] * 10}%;background:${last.scores[k] >= 8 ? 'var(--ok)' : last.scores[k] >= 6 ? 'var(--warn)' : 'var(--bad)'}"></i></div></div><b>${last.scores[k]}</b>`).join('')}</div>
      <h3>Problems (click to jump)</h3>
      ${(last.problems || []).map((p) => `<div class="problem" data-t="${esc(p.t)}"><b>${esc(p.t)}s</b>${esc(p.issue)}${p.fix ? `<div class="fix">fix: ${esc(p.fix)}</div>` : ''}</div>`).join('') || '<p class="dim">none listed</p>'}
      ${last.notes ? `<p class="dim">${esc(last.notes)}</p>` : ''}
      <h3>Scores by round</h3>${chart(rs)}
      <h3>Log</h3><div class="md">${md(d.reviewLog || '')}</div>`;
    el.querySelectorAll('.problem').forEach((p) => (p.onclick = () => { pause(); seek(parseFloat(p.dataset.t)); }));
  }
  if (S.tab === 'gates') {
    const g = d.gatesFull;
    el.innerHTML = !g ? '<p class="dim">Gates not run yet.</p><button id="runGate">Run gates</button>' :
      `<h3>${g.pass ? 'Pass' : 'Fail'} · ${new Date(g.at).toLocaleString()}</h3>` +
      g.checks.map((c) => `<div class="check"><span class="badge ${c.level}">${c.level}</span><div><b>${esc(c.name)}</b><pre>${esc(c.detail)}</pre></div></div>`).join('') +
      '<p><button id="runGate">Run again</button></p>';
    $('#runGate').onclick = () => job('gate');
  }
  if (S.tab === 'sheets') {
    const imgs = d.files.filter((f) => /\.png$/.test(f.name));
    el.innerHTML = imgs.length ? `<div class="thumbs">${imgs.map((f) => `<figure data-src="/films/${d.key}/out/${f.name}?v=${f.mtime}" data-file="${esc(f.name)}"><img loading="lazy" src="/films/${d.key}/out/${f.name}?v=${f.mtime}"><figcaption>${esc(f.name)} · ${ago(f.mtime)} · <span class="glink">✨ ask Gemini</span></figcaption></figure>`).join('')}</div>`
      : '<p class="dim">No contact sheets yet. Run <b>Look</b>, or ask pi to look at its frames.</p>';
    el.querySelectorAll('figure').forEach((f) => (f.onclick = () => { $('#lbImg').src = f.dataset.src; openReader(f.dataset.file); $('#lightbox').showModal(); }));
  }
  if (S.tab === 'notes') {
    el.innerHTML = `<h3>Note at <span id="noteAt">${S.t.toFixed(2)}s</span> (${esc(S.fmt)})</h3>
      <textarea id="noteText" placeholder="What should change here? pi reads open notes at the start of every round."></textarea>
      <p><button class="primary" id="addNote">Pin note</button> <span class="dim">shortcut: n</span></p>
      <h3>Notes</h3>${d.notes.slice().reverse().map((n) => `<div class="note ${n.done ? 'done' : ''}"><b data-t="${n.t}">${n.t.toFixed(2)}s</b><span>${esc(n.text)}</span>${n.done ? '<span class="dim">done</span>' : `<button data-id="${n.id}">done</button>`}</div>`).join('') || '<p class="dim">none</p>'}`;
    $('#addNote').onclick = async () => { const text = $('#noteText').value.trim(); if (!text) return; await post(`/api/films/${d.key}/notes`, { t: S.t, fmt: S.fmt, text }); selectFilm(d.key, { keepTime: true }); };
    el.querySelectorAll('.note b').forEach((b) => (b.onclick = () => { pause(); seek(+b.dataset.t); }));
    el.querySelectorAll('.note button').forEach((b) => (b.onclick = async () => { await post(`/api/films/${d.key}/notes`, { resolve: +b.dataset.id }); selectFilm(d.key, { keepTime: true }); }));
  }
  if (S.tab === 'jobs') {
    const J = [['look', 'Look', 'contact sheet, every 0.5s'], ['beats', 'Look at beats', 'one frame per beat'], ['phone', 'Phone test', '360px wide, every 1s'],
      ['draft', 'Draft render', 'half-res 30fps mp4'], ['sound', 'Sound', 'music + sfx → mix -14 LUFS'], ['gate', 'Gates', 'lint, determinism, dead time…'],
      ['render', 'Final render', 'all formats, motion blur'], ['ship', 'Ship', 'sound → gates → render → posters']];
    const j = S.jobs[d.key];
    el.innerHTML = `<div class="jobs">${J.map(([k, l, s]) => `<button data-k="${k}" ${S.running.has(d.key) ? 'disabled' : ''}>${l}<small>${s}</small></button>`).join('')}</div>
      <h3>${j ? `${esc(j.kind)} ${j.code === undefined ? 'running…' : j.code === 0 ? 'done' : 'failed'}` : 'Output'}</h3>
      <div class="log" id="log">${esc((j?.log || []).join('\n')) || '<span class="dim">Buttons run the same studio CLI pi uses.</span>'}</div>`;
    el.querySelectorAll('.jobs button').forEach((b) => (b.onclick = () => job(b.dataset.k)));
    const log = $('#log'); log.scrollTop = log.scrollHeight;
  }
}

async function job(kind) {
  try { await post(`/api/films/${S.key}/job`, { kind }); S.tab = 'jobs'; renderTab(); }
  catch (e) { alert(e.message); }
}

function chart(rs) {
  if (rs.length < 1) return '';
  const W = 340, H = 150, P = 18, n = Math.max(2, rs.length);
  const X = (i) => P + (i / (n - 1)) * (W - 2 * P), Y = (v) => H - P - ((v - 1) / 9) * (H - 2 * P);
  const lines = RUBRIC.map((k) => `<polyline fill="none" stroke="${COLORS[k]}" stroke-width="1.6" opacity=".85" points="${rs.map((r, i) => `${X(i)},${Y(r.scores[k])}`).join(' ')}"><title>${k}</title></polyline>`).join('');
  const pass = `<line x1="${P}" x2="${W - P}" y1="${Y(8)}" y2="${Y(8)}" stroke="#3ecf8e" stroke-dasharray="3 3" opacity=".6"/>`;
  const labels = rs.map((r, i) => `<text x="${X(i)}" y="${H - 3}" fill="#8b8b94" font-size="9" text-anchor="middle">r${r.round}</text>`).join('');
  const legend = RUBRIC.map((k, i) => `<text x="${P + (i % 4) * 82}" y="${10 + Math.floor(i / 4) * 11}" fill="${COLORS[k]}" font-size="9">${k}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${pass}${lines}${labels}${legend}</svg>`;
}

const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString(); };

// Small markdown: headings, lists, tables, quotes, bold/italic/code, paragraphs.
function md(src) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<i>$2</i>');
  const out = [], lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]); i--;
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<table>${body.map((r, k) => `<tr>${cells(r).map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`);
    } else if (/^#{1,6} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${Math.min(3, n)}>${inline(l.slice(n + 1))}</h${Math.min(3, n)}>`); }
    else if (/^\s*([-*]|\d+\.) /.test(l)) { const items = []; while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, '')); i--; out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); }
    else if (/^> /.test(l)) out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('');
}

// ── live updates ────────────────────────────────────────────────────────────
// ── Gemini sheet reader ─────────────────────────────────────────────────────
const GPRESETS = {
  critique: () => `You are a harsh motion-design director. This is a contact sheet of frames from "${S.d.title}" — a ${S.d.cfg.duration}s ${S.d.formats.join(' + ')} film (${S.fmt} format; frames carry their own time labels). Judge what you SEE, still by still: hook (first frames), readability (is every text/math readable at phone size?), motion (staging, overlaps, mid-animation states), variety, composition (balance, dead space), brand consistency of the design system. Give a 1-10 score for each, then the 3 worst problems with their frame timestamps, each with a concrete fix. Name what is broken specifically — no generalities, no politeness.`,
  ocr: () => `Transcribe ALL text visible in this contact sheet, frame by frame, grouped under each frame's time label. Keep the exact wording, including math. After the transcription, list separately: (1) any text clipped or cut off at a frame edge, (2) any two elements printed on top of each other, (3) any text too small or low-contrast to read confidently at this size.`,
  free: () => '',
};
function openReader(file) {
  S.lbFile = file;
  const out = $('#gOut');
  out.className = 'gOut dim'; out.style.color = ''; out.textContent = 'Pick a preset or write your own question, then Ask.';
  $('#gMeta').textContent = '';
  $('#gPrompt').value = GPRESETS[S.gpreset || 'critique']();
}
$('#gPresets').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  S.gpreset = b.dataset.p;
  $('#gPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  $('#gPrompt').value = GPRESETS[b.dataset.p]();
  if (b.dataset.p === 'free') $('#gPrompt').focus();
}));
$('#gAsk').onclick = async () => {
  if (!S.lbFile) return;
  const prompt = $('#gPrompt').value.trim(), out = $('#gOut');
  if (!prompt) { out.className = 'gOut'; out.style.color = 'var(--warn)'; out.textContent = 'Write a question first (or pick a preset).'; return; }
  $('#gAsk').disabled = true; $('#gMeta').textContent = 'reading… (agent, up to ~30s)';
  out.className = 'gOut dim'; out.style.color = ''; out.textContent = 'The agent is reading the sheet… (first run starts it, ~5-30s)';
  try {
    const r = await post('/api/gemini/read', { key: S.key, file: S.lbFile, prompt });
    out.className = 'gOut'; out.style.color = ''; out.textContent = r.text;
    $('#gMeta').textContent = `${r.model}${r.usage ? ` · ${r.usage.totalTokenCount} tokens` : ''}`;
  } catch (e) {
    out.className = 'gOut'; out.style.color = 'var(--bad)'; out.textContent = e.message;
    $('#gMeta').textContent = '';
  } finally { $('#gAsk').disabled = false; }
};

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'films') loadFilms();
    if (ev.type === 'film') { loadFilms(); if (ev.key === S.key) selectFilm(S.key, { keepTime: true }); }
    if (ev.type === 'job-start') { S.running.add(ev.key); S.jobs[ev.key] = { kind: ev.kind, log: [] }; loadFilms(); if (ev.key === S.key) renderTab(); }
    if (ev.type === 'job') { const j = S.jobs[ev.key] ||= { log: [] }; j.log.push(ev.line); if (ev.key === S.key && S.tab === 'jobs') { const log = $('#log'); if (log) { log.textContent = j.log.join('\n'); log.scrollTop = log.scrollHeight; } } }
    if (ev.type === 'job-end') { S.running.delete(ev.key); if (S.jobs[ev.key]) S.jobs[ev.key].code = ev.code; loadFilms(); if (ev.key === S.key) selectFilm(S.key, { keepTime: true }); }
  };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

// ── new film ────────────────────────────────────────────────────────────────
$('#newFilm').onclick = () => $('#newDlg').showModal();
$('#newForm').onsubmit = async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await post('/api/films', { key: f.get('key'), title: f.get('title'), duration: +f.get('duration'), formats: f.getAll('fmt') });
    $('#newDlg').close(); S.key = null; history.replaceState(null, '', `#film=${f.get('key')}`); await loadFilms(); selectFilm(f.get('key'));
  } catch (err) { alert(err.message); }
};

// ── the edit tab (films with an edit.json) gets the same helpers the motion tabs use ────
EDIT.init({ S, esc, post, api, seek, pause, selectFilm, job, reloadPreview: () => reloadMedia(true), audio, iframe });

loadFilms(); connect();
