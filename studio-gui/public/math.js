// math.js: the math-film view — M7's list, verbatim. Mounted like edit.js: MATH.init(ctx) once
// (from app.js, beside EDIT.init) and MATH.setFilm(S, d) per film (beside EDIT.setFilm). A film
// with cfg.kind === "math" gets this surface INSTEAD of the motion/edit one:
//   · the header: the rendered video (draft-<fmt>.mp4, final when it exists) with a FORMAT TOGGLE
//     and a timeline strip — scenes as segments, sentence ticks, bookmarks, and markers for lint
//     issues, failed claims and open notes; click seeks.
//   · tabs Script (the sentence list: click to seek, ✎ edits the line and re-voices it through
//     POST /api/film/:key/sentence), Scenes (timeline seconds per format, last render, errors with
//     file:line from records + a syntax probe), Checks (layout lint, the claims ledger, gates).
//   · the Live view is hidden — math films have no seek(t) page; the draft IS the preview (the
//     live iframe is detached, so nothing 404s).
//   · Notes + Run keep app.js's tabs (the existing flow): every note is resolved through
//     GET /api/film/:key/where (scene · sentence · file:line), and the Run row swaps to the math
//     verbs (voice→sound, check, draft, render, gate, ship) — the same JOBS/shell mechanism.
//   · the review chart stays app.js's; math films add the correctness + clarity keys (rubric(d)).
//
// Same vanilla-module style as app.js/edit.js: no build, no framework, no deps. Data comes from
// the server's math endpoints (ids only — the server validates; the browser never names a path).
// Refresh rides app.js's SSE: a timing.json/script.md write fires the film event, selectFilm
// re-runs and MATH.setFilm re-adopts (cheap fetches, adopt-only-on-change like edit.js).

let ctx = null;                 // { S, esc, post, api, seek, pause, selectFilm, job, renderTab }
const el = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MATH_TABS = ['script', 'scenes', 'checks'];
const RUN = [   // M7's Run list; kind = the server's JOBS key (voice → the sound job)
  ['sound', 'Voice', 'voice → timing → mix at mix.lufs'],
  ['check', 'Check', 'dry-run: typeset + claims, per scene'],
  ['draft', 'Draft render', 'half-res 30fps draft, every format'],
  ['render', 'Final render', 'finals in every format'],
  ['gate', 'Gates', 'layout, claims, typeset, narration, sync, pace…'],
  ['ship', 'Ship', 'gates → finals → the claims.md ledger'],
];

// ── state ─────────────────────────────────────────────────────────────────────────────────────
const M = {
  key: null, fmt: null, stageSaved: null,
  script: null, scriptSig: '', scriptIn: null,       // /script (cheap: no python)
  records: null, recIn: null, recAt: 0,               // /records (lint + syntax: ~2s, tab-driven)
  revoice: null,                                      // { id, msg } — the last re-voice status
  editId: null,                                       // the sentence editor that is open
  videoSig: '', keepT: null,                          // the video's current src signature
  stripIn: null,
};

export const handles = (S) => !!(S && S.d && S.d.math);

// ── mount / refresh ─────────────────────────────────────────────────────────────────────────
export function setFilm(S, d) {
  if (!d || !d.math) return unmount(S);
  if (M.key !== d.key) mount(S, d);
  syncStage(S, d);
  loadScript(S, d);
  if (MATH_TABS.includes(S.tab)) renderTab(S);
}

function mount(S, d) {
  Object.assign(M, { key: d.key, fmt: d.formats[0], script: null, scriptSig: '', records: null, recAt: 0,
    revoice: null, editId: null, videoSig: '', keepT: null });
  // the stage: math films own it (video + format toggle + strip). The motion nodes (#liveWrap with
  // its iframe, #renderWrap) are stashed, not destroyed — unmount() re-attaches the very same
  // nodes, so app.js's `iframe`/`video` consts stay live for the next motion film.
  const stage = el('#stage');
  M.stageSaved = [...stage.childNodes];
  stage.innerHTML = `
    <div id="mView">
      <div id="mHead">
        <div class="seg" id="mFmt"></div>
        <span id="mTc">0.00s</span>
        <span class="dim" id="mInfo"></span>
        <span class="grow"></span>
        <span class="dim" id="mMsg"></span>
      </div>
      <div id="mVideoWrap"><video id="mVideo" controls playsinline preload="metadata"></video>
        <div id="mNoRender" class="empty small" hidden>Not rendered in this format yet — run a draft (Run tab).</div></div>
      <canvas id="mStrip" height="86"></canvas>
    </div>`;
  // app.js's reloadMedia keeps writing to #video/#noRender (its own motion-film path — that code
  // is untouched, so its element lookups must keep working): the renderWrap node stays in the DOM,
  // merely hidden. Only the live iframe (#liveWrap) is detached — math films have no seek(t) page
  // and a detached iframe loads nothing (measured: zero requests), so nothing 404s.
  const rw = M.stageSaved.find((n) => n?.id === 'renderWrap');
  if (rw) { rw.style.display = 'none'; stage.appendChild(rw); }
  el('#mStrip').addEventListener('pointerdown', stripDown);
  const v = el('#mVideo');
  v.addEventListener('loadedmetadata', () => { if (M.keepT != null) { try { v.currentTime = M.keepT; } catch {} M.keepT = null; } });
  v.addEventListener('timeupdate', () => { if (M.key && !v.seeking) { ctx.S.t = v.currentTime; tick(); } });
  // the motion chrome that does not apply: the live view (no seek(t) page), the transport (the
  // video carries its own controls), app's format seg (the toggle above is this film's)
  el('#transport').style.display = 'none';
  el('#fmtSeg').style.display = 'none';
  const liveBtn = el('#viewSeg [data-v="live"]');
  liveBtn.style.display = 'none';
  S.view = 'render';
  el('#viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'render'));
  // the tab bar: Script/Scenes/Checks first; Overview + Gates fold away (Checks carries gates;
  // the header carries the film basics) — Reviews/Sheets/Notes/Run stay app.js's
  const tabs = el('#tabs');
  tabs.querySelector('[data-tab="overview"]').insertAdjacentHTML('beforebegin',
    '<button data-tab="script">Script</button><button data-tab="scenes">Scenes</button><button data-tab="checks">Checks</button>');
  tabs.querySelectorAll('button[data-tab="script"], button[data-tab="scenes"], button[data-tab="checks"]')
    .forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; ctx.renderTab(); renderTab(S); }));
  for (const t of ['overview', 'gates']) tabs.querySelector(`[data-tab="${t}"]`).style.display = 'none';
  if (![...MATH_TABS, 'reviews', 'sheets', 'notes', 'jobs'].includes(S.tab)) S.tab = 'script';
}

function unmount(S) {
  if (!M.key && !M.stageSaved) return;
  const stage = el('#stage');
  M.stageSaved.find((n) => n?.id === 'renderWrap')?.style.removeProperty('display');
  if (M.stageSaved) { stage.replaceChildren(...M.stageSaved); M.stageSaved = null; }
  for (const id of ['#transport', '#fmtSeg']) el(id).style.display = '';
  el('#viewSeg [data-v="live"]').style.display = '';
  const tabs = el('#tabs');
  tabs.querySelectorAll('[data-tab="script"], [data-tab="scenes"], [data-tab="checks"]').forEach((b) => b.remove());
  for (const t of ['overview', 'gates']) tabs.querySelector(`[data-tab="${t}"]`)?.style.removeProperty('display');
  const tb = el('#tabBody'); if (tb) { tb.__mRoot = null; }
  if (S) {
    if (MATH_TABS.includes(S.tab)) S.tab = 'overview';
    S.view = 'live';
    el('#viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'live'));
  }
  Object.assign(M, { key: null, fmt: null, script: null, scriptSig: '', records: null, recAt: 0,
    revoice: null, editId: null, videoSig: '', keepT: null, stripIn: null });
}

// ── the stage: format toggle, video, timeline strip ───────────────────────────────────────────
function syncStage(S, d) {
  const seg = el('#mFmt');
  if (seg) {
    seg.innerHTML = d.formats.map((f) => `<button data-f="${f}" class="${f === M.fmt ? 'on' : ''}">${f}</button>`).join('');
    seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      if (M.fmt === b.dataset.f) return;
      M.fmt = b.dataset.f; S.fmt = M.fmt;                    // S.fmt is what the notes pin records
      M.keepT = el('#mVideo')?.currentTime ?? 0;
      syncStage(S, d);
      if (MATH_TABS.includes(S.tab)) renderTab(S);
    }));
  }
  // the newest file for this format: final-<fmt>.mp4 when shipped, else the draft
  const want = ['final', 'draft'].map((k) => d.files.find((f) => f.name === `${k}-${M.fmt}.mp4`)).find(Boolean);
  const src = want ? `/films/${d.key}/out/${want.name}?v=${want.mtime}` : '';
  const v = el('#mVideo'), nr = el('#mNoRender');
  if (v) {
    if (src !== M.videoSig) {
      const was = v.currentTime || 0;
      M.videoSig = src;
      if (src) { v.src = src; if (was > 0.05 && M.keepT == null) M.keepT = was; v.hidden = false; }
      else { v.pause(); v.removeAttribute('src'); v.hidden = true; }
    }
    if (nr) nr.hidden = !!src;
  }
  const info = el('#mInfo');
  if (info) info.textContent = `${d.cfg.duration}s · ${d.cfg.fps}fps · ${d.cfg.voice || ''}${want ? ` · ${want.name}` : ''}`;
  tick();
}

function tick() {   // the playhead: S.t → the timecode + the strip
  const S = ctx?.S, v = el('#mVideo');
  if (!S || !M.key) return;
  if (v && !v.paused && !v.seeking) S.t = v.currentTime;
  const tc = el('#mTc'); if (tc) tc.textContent = `${(+S.t || 0).toFixed(2)}s`;
  drawStrip();
}

function drawStrip() {
  const S = ctx?.S, c = el('#mStrip');
  if (!S || !c || !M.key) return;
  const d = S.d, D = Math.max(0.001, d?.cfg?.duration || 0);
  const dpr = devicePixelRatio || 1, W = c.clientWidth;
  if (!W) return;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(86 * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, 86);
  const x = (t) => clamp(t / D, 0, 1) * W;

  // scene segments: records' timeline seconds for THIS format (fallback: the timing sentences)
  const sents = M.script?.timing?.sentences?.length ? M.script.timing.sentences : (M.script?.doc || []);
  const rec = M.records?.scenes || [];
  let segs = [];
  if (rec.length && rec.some((r) => r.seconds?.[M.fmt] != null)) {
    let t = 0;
    for (const r of rec) { const s = r.seconds?.[M.fmt] ?? 0; segs.push({ id: r.id, start: t, end: t + s, seconds: s, error: r.error }); t += s; }
  } else {
    for (const sc of M.script?.scenes || []) {
      const own = sents.filter((s) => s.scene === sc.id);
      if (own.length) segs.push({ id: sc.id, start: own[0].start ?? 0, end: own.at(-1).end ?? 0, seconds: (own.at(-1).end ?? 0) - (own[0].start ?? 0) });
    }
  }
  segs.forEach((s, i) => {
    const a = x(s.start), b = Math.max(x(s.end), a + 2);
    g.fillStyle = s.error ? '#3a1d22' : i % 2 ? '#1d1d22' : '#232329';
    g.fillRect(a, 0, b - a, 24);
    g.strokeStyle = '#3a3a42'; g.strokeRect(a + .5, .5, b - a - 1, 23);
    g.fillStyle = s.error ? '#ff7d8a' : '#b4b4bd'; g.font = '11px Inter, sans-serif';
    g.save(); g.beginPath(); g.rect(a, 0, b - a - 2, 24); g.clip(); g.fillText(`${s.id} ${s.seconds.toFixed(1)}s`, a + 5, 16); g.restore();
  });

  // sentence ticks (+ their bookmarks as dots)
  for (const s of sents) {
    if (s.start == null) continue;
    g.fillStyle = '#7ee0d0'; g.fillRect(x(s.start), 26, 1.5, 12);
    for (const b of s.bookmarks || []) { g.fillStyle = '#c77dff'; g.beginPath(); g.arc(x((s.start ?? 0) + (b.t ?? 0)), 32, 2.4, 0, 7); g.fill(); }
  }
  // markers: lint violations (scene t → film t), failed claims (their scene's middle), open notes
  const sceneStart = (id) => segs.find((s) => s.id === id)?.start ?? null;
  const lint = M.records?.lint?.[M.fmt]?.violations || [];
  for (const v of lint) { const st = sceneStart(v.scene); if (st == null) continue;
    g.fillStyle = v.level === 'fail' ? '#ff4d5e' : '#f5b841'; g.beginPath(); g.moveTo(x(st + v.t), 40); g.lineTo(x(st + v.t) - 5, 52); g.lineTo(x(st + v.t) + 5, 52); g.fill(); }
  for (const c of (M.records?.claims || []).filter((c) => !c.ok)) {
    const st = sceneStart(c.scene); if (st == null) continue;
    g.fillStyle = '#ff4d5e'; g.font = 'bold 12px Inter, sans-serif'; g.fillText('✗', x(st + 1.2), 63);
  }
  for (const n of (d?.notes || []).filter((n) => !n.done)) { g.fillStyle = '#ff6a3d'; g.fillRect(x(n.t) - 1, 64, 3, 16); }

  // playhead
  g.fillStyle = '#fff'; g.fillRect(x(S.t) - 1, 0, 2, 86);
}

function stripDown(e) {
  const S = ctx?.S; if (!S || !M.key) return;
  const c = el('#mStrip'), r = c.getBoundingClientRect();
  const D = Math.max(0.001, S.d?.cfg?.duration || 1);
  seekTo(((e.clientX - r.left) / r.width) * D);
}
function seekTo(t) {
  const S = ctx?.S, v = el('#mVideo');
  ctx.seek(t);                                  // S.t, the shared timecode, the app timeline
  if (v) { try { v.currentTime = S.t; } catch { M.keepT = S.t; } }
  tick();
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────
async function loadScript(S, d) {
  if (M.scriptIn) return;
  M.scriptIn = (async () => {
    try {
      const r = await ctx.api(`/api/film/${d.key}/script`);
      if (M.key !== d.key || !r || r.error) return;
      const sig = JSON.stringify([r.script, r.timing?.duration, (r.timing?.sentences || []).map((s) => [s.id, s.start, s.end, s.text, s.bookmarks])]);
      if (sig !== M.scriptSig) {
        M.script = r; M.scriptSig = sig;
        M.whereCache?.clear();   // new timing: every /where answer changes
        if (MATH_TABS.includes(S.tab) && !M.editId) renderTab(S);
      }
    } catch { /* the next SSE film event retries */ }
    finally { M.scriptIn = null; }
  })();
}

async function loadRecords(S, d, why) {
  if (M.recIn) return;
  if (Date.now() - M.recAt < 3000 && why !== 'force') { if (MATH_TABS.includes(S.tab) && !M.editId) renderTab(S); return; }
  M.recAt = Date.now();
  M.recIn = (async () => {
    try {
      const r = await ctx.api(`/api/film/${d.key}/records`);
      if (M.key !== d.key || !r || r.error) { if (r?.error) msg(r.error); return; }
      M.records = r;
      if (MATH_TABS.includes(S.tab) && !M.editId) renderTab(S);
      drawStrip();
    } catch { /* the tab shows the stale data + the next open retries */ }
    finally { M.recIn = null; }
  })();
}

function msg(m, ok = false) {
  const n = el('#mMsg'); if (!n) return;
  n.textContent = m || ''; n.style.color = ok ? 'var(--ok)' : m ? 'var(--bad)' : '';
  clearTimeout(M._mt); if (m) M._mt = setTimeout(() => { n.textContent = ''; n.style.color = ''; }, 8000);
}

// ── the tabs (Script · Scenes · Checks) ──────────────────────────────────────────────────────
export function renderTab(S, root) {
  root ||= el('#tabBody');
  if (!M.key || !S?.d?.math || M.key !== S.key) { root.innerHTML = `<p class="dim">loading films/${S?.key}'s script…</p>`; return; }
  if (S.tab === 'script') return renderScript(S, root);
  if (S.tab === 'scenes') { loadRecords(S, S.d); return renderScenes(S, root); }
  if (S.tab === 'checks') { loadRecords(S, S.d); return renderChecks(S, root); }
}

function renderScript(S, root) {
  root.__mRoot = M.key;
  const t = M.script, sents = t?.timing?.sentences?.length ? t.timing.sentences : (t?.doc || []);
  const marks = (txt) => ctx.esc(txt).replace(/\{([^}]+)\}/g, '<code class="mBm">{$1}</code>');
  root.innerHTML = `<div id="mTab">
    <h3>Sentences · click to seek · ✎ edits the line and re-voices it</h3>
    <div id="mRevoice" class="dim" ${M.revoice ? '' : 'hidden'}>${M.revoice ? ctx.esc(M.revoice.msg) : ''}</div>
    <div id="mSents">${sents.length ? sents.map((s) => `
      <div class="mSent ${M.editId === s.id ? 'edit' : ''}" data-id="${s.id}" data-start="${s.start ?? ''}" data-end="${s.end ?? ''}">
        <span class="mTime">${s.start != null ? `${s.start.toFixed(2)}–${s.end.toFixed(2)}s` : 'not voiced'}</span>
        <b>${s.id}</b>
        <span class="mScene dim">${s.scene ?? ''}</span>
        <span class="mText">${marks(s.text)}</span>
        <span class="mChips dim">${(s.bookmarks || []).map((b) => `{${b.id}}${b.t != null ? ` @+${b.t.toFixed(2)}s` : ''}`).join(' ') || ''}</span>
        <button class="mEdit" data-id="${s.id}" title="edit this sentence + re-voice">✎</button>
      </div>`).join('') : '<p class="dim">no sentences — films/' + M.key + '/script.md</p>'}</div>
    <h3>script.md</h3>
    <details><summary class="dim">raw</summary><pre class="mRaw">${ctx.esc(t?.script || '')}</pre></details>
  </div>`;
  root.querySelectorAll('.mSent').forEach((row) => {
    const s = sents.find((x) => x.id === row.dataset.id);
    row.onclick = (e) => { if (e.target.closest('button, textarea, .mEditRow')) return; if (s?.start != null) seekTo(s.start); };
    if (M.editId === s?.id) openEditor(row, s);
  });
  root.querySelectorAll('.mEdit').forEach((b) => (b.onclick = () => {
    const s = sents.find((x) => x.id === b.dataset.id);
    const row = root.querySelector(`.mSent[data-id="${b.dataset.id}"]`);
    if (M.editId && M.editId !== b.dataset.id) { M.editId = null; renderTab(S); }
    M.editId = b.dataset.id; openEditor(row, s);
  }));
}

function openEditor(row, s) {
  if (!row || row.querySelector('.mEditRow')) return;
  row.classList.add('edit');
  row.insertAdjacentHTML('beforeend', `<span class="mEditRow">
    <textarea spellcheck="false">${ctx.esc(s.text)}</textarea>
    <button class="mSave primary" title="rewrite the [${s.id}] line and re-voice it">re-voice</button>
    <button class="mCancel">cancel</button></span>`);
  const ta = row.querySelector('textarea'), save = row.querySelector('.mSave');
  ta.focus();
  row.querySelector('.mCancel').onclick = () => { M.editId = null; renderTab(ctx.S); };
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'voicing…';
    try {
      const r = await ctx.post(`/api/film/${M.key}/sentence`, { id: s.id, text: ta.value });
      M.editId = null;
      M.revoice = { id: s.id, msg: `re-voiced ${s.id} → ${r.sentence.start.toFixed(2)}–${r.sentence.end.toFixed(2)}s (${(r.sentence.end - r.sentence.start).toFixed(2)}s audio, ${r.sentence.words.length} words) · film ${r.duration.toFixed(2)}s` };
      renderTab(ctx.S);
    } catch (e) {
      save.disabled = false; save.textContent = 're-voice';
      msg(String(e.message || e).split('\n')[0]);
      const rv = el('#mRevoice');
      if (rv) { rv.hidden = false; rv.textContent = String(e.message || e).split('\n').slice(0, 3).join(' '); rv.style.color = 'var(--bad)'; }
    }
  };
}

function renderScenes(S, root) {
  root.__mRoot = M.key;
  const rec = M.records, scenes = M.script?.scenes || [];
  const rows = rec ? rec.scenes : [];
  root.innerHTML = `<div id="mTab">
    <h3>Scenes · status · seconds per format · last render</h3>
    ${rec ? '' : '<p class="dim">reading records (the layout lint runs, ~2s)…</p>'}
    ${rows.map((r) => {
      const sc = scenes.find((x) => x.id === r.id);
      return `<div class="mSceneCard ${r.error ? 'bad' : ''}" data-id="${r.id}">
        <div class="mSceneHead"><b>${r.id}</b> <span class="dim">${ctx.esc(sc?.title || '')}</span>
          <span class="badge ${r.error ? 'fail' : 'pass'}">${r.error ? 'error' : 'ok'}</span></div>
        ${r.error ? `<div class="mErr"><code>${ctx.esc(r.error.file)}:${r.error.line}</code> — ${ctx.esc(r.error.message)}</div>` : ''}
        <div class="mSceneMeta dim">${Object.entries(r.seconds).map(([f, s]) => `${f}: ${s != null ? `${(+s).toFixed(2)}s` : '—'}`).join(' · ')}
          · last render ${Object.entries(r.lastRender).length ? ago(Object.entries(r.lastRender)[0][1]) : 'never'}
          · ${r.claims} claim${r.claims === 1 ? '' : 's'}</div>
      </div>`;
    }).join('') || '<p class="dim">no scenes yet — films/' + M.key + '/scenes/ holds the .py files</p>'}
  </div>`;
  root.querySelectorAll('.mSceneCard').forEach((c) => (c.onclick = () => {
    // the records carry no absolute starts: derive them from the seconds, same math as drawStrip
    let t = 0; for (const x of M.records.scenes) { if (x.id === c.dataset.id) break; t += x.seconds?.[M.fmt] ?? 0; }
    seekTo(t + 0.01);
  }));
}

function renderChecks(S, root) {
  root.__mRoot = M.key;
  const rec = M.records;
  const lintCount = rec ? Object.entries(rec.lint || {}).map(([f, l]) => `${f}: ${l ? (l.violations || []).length + (l.error ? ' (lint failed)' : '') : 'no records'}`).join(' · ') : '';
  const claims = rec?.claims || [];
  root.innerHTML = `<div id="mTab">
    <h3>Checks · layout lint · claims ledger · gates</h3>
    ${rec ? `<p class="dim" id="mCheckLine">lint ${lintCount} · claims ${claims.length} (${claims.filter((c) => c.ok).length} verified) · gates ${rec.gates ? (rec.gates.pass ? 'PASS' : 'FAIL') : 'not run'}</p>` : '<p class="dim">reading records (the layout lint runs, ~2s)…</p>'}
    <h3>Layout lint</h3>${rec ? Object.entries(rec.lint || {}).map(([f, l]) => l == null
      ? `<p class="dim">${f}: never rendered</p>`
      : l.error ? `<p class="dim" style="color:var(--bad)">${ctx.esc(l.error)}</p>`
      : (l.violations || []).length ? `<table><thead><tr><th>${f}</th><th>scene</th><th>rule</th><th>t</th><th>objects</th><th></th></tr></thead><tbody>
        ${(l.violations).map((v) => `<tr class="mLint" data-scene="${v.scene}" data-t="${v.t}"><td><span class="badge ${v.level}">${v.level}</span></td>
        <td>${v.scene}</td><td>${v.rule}</td><td>${v.t.toFixed(2)}s</td><td>${(v.ids || []).join(', ')}</td>
        <td>${ctx.esc(v.detail || '')}${v.source_line ? ` <code>${v.scene}.py:${v.source_line}</code>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<p class="dim">${f}: clean</p>`).join('') : ''}
    <h3>Claims ledger (expr · ok · says)</h3>${rec ? (claims.length ? `<table><thead><tr><th>ok</th><th>expr</th><th>says</th><th>value</th><th>scene</th><th>fmt</th></tr></thead><tbody>
      ${claims.map((c) => `<tr class="${c.ok ? '' : 'bad'}"><td><span class="badge ${c.ok ? 'pass' : 'fail'}">${c.ok ? '✓' : '✗'}</span></td>
      <td><code>${ctx.esc(c.expr)}</code>${c.about ? ` <span class="dim">(${ctx.esc(c.about)})</span>` : ''}</td>
      <td>${c.says || '—'}</td><td>${ctx.esc(c.value ?? '')}</td><td>${c.scene}</td><td>${c.fmt}</td></tr>`).join('')}</tbody></table>`
      : '<p class="dim">no claims recorded — render or check the film first</p>') : ''}
    <h3>Gates</h3>${rec ? (rec.gates ? `<h4>${rec.gates.pass ? 'Pass' : 'Fail'} · ${ctx.esc(new Date(rec.gates.at).toLocaleString())}</h4>` +
      (rec.gates.checks || []).map((c) => `<div class="check"><span class="badge ${c.level}">${c.level}</span><div><b>${ctx.esc(c.name)}</b><pre>${ctx.esc(c.detail)}</pre></div></div>`).join('')
      : '<p class="dim">Gates not run yet — Run tab → Gates.</p>') : ''}
  </div>`;
  root.querySelectorAll('.mLint').forEach((r) => (r.onclick = () => {
    let t = 0; for (const x of M.records.scenes) { if (x.id === r.dataset.scene) break; t += x.seconds?.[M.fmt] ?? 0; }
    seekTo(t + (+r.dataset.t || 0));
  }));
}

// ── the shared tabs, adapted: Notes resolved through /where · Run's math verbs ────────────────
// app.js renders those two tabs (the existing flow); this observer adapts them for a math film
// right after each render — the notes each get their /where resolution, the Run row swaps to the
// math verbs. It re-fires on every tab render (SSE churn included); markers keep it idempotent.
function onTabBody() {
  const S = ctx?.S;
  if (!S || !handles(S)) return;
  if (S.tab === 'notes') enrichNotes(S);
  if (S.tab === 'jobs') mathRun(S);
}

async function enrichNotes(S) {
  const root = el('#tabBody'), d = S.d;
  if (!root || !d.notes) return;
  // the pin form's own timecode, resolved (so the author knows what they are pointing at)
  const pinAt = el('#noteAt');
  if (pinAt && !root.querySelector('#mPinWhere')) {
    pinAt.insertAdjacentHTML('afterend', `<div id="mPinWhere" class="dim mWhereLine">resolving…</div>`);
    resolve(S.t).then((r) => { const n = el('#mPinWhere'); if (n) n.innerHTML = whereLine(r); }).catch(() => {});
  }
  const open = d.notes.filter((n) => !n.done);
  const sig = JSON.stringify(open.map((n) => [n.id, n.t, n.fmt]));
  if (root.__mNotes === sig) return;
  root.__mNotes = sig;
  for (const n of open) {
    const div = root.querySelector(`.note [data-id="${n.id}"]`)?.closest('.note');
    if (!div || div.querySelector('.mWhereLine')) continue;
    div.insertAdjacentHTML('beforeend', `<div class="mWhereLine dim" data-note="${n.id}">resolving…</div>`);
    resolve(n.t, n.fmt).then((r) => {
      const line = root.querySelector(`[data-note="${n.id}"]`);
      if (line) line.innerHTML = whereLine(r);
    }).catch(() => {});
  }
}

async function resolve(t, fmt) {
  const k = `${t}|${fmt || M.fmt}`;
  if (M.whereCache?.has(k)) return M.whereCache.get(k);
  const r = await ctx.api(`/api/film/${M.key}/where?t=${(+t || 0).toFixed(3)}&fmt=${encodeURIComponent(fmt || M.fmt)}`);
  if (r?.error) return r;
  (M.whereCache ||= new Map()).set(k, r);
  return r;
}

function whereLine(r) {
  if (!r || r.error) return `<span style="color:var(--warn)">${ctx.esc(r?.error || 'unresolved')}</span>`;
  return `→ scene <b>${r.scene}</b>${r.sentence ? ` · sentence ${r.sentence.id}` : ''}${r.animation ? ` · animation #${r.animation.i} ${ctx.esc(r.animation.name)}` : ''} · <code>${r.file}${r.line ? ':' + r.line : ''}</code>`;
}

function mathRun(S) {
  const row = el('#tabBody .jobs');
  if (!row) return;
  const running = S.running.has(S.key);
  const sig = `${M.key}|${running}`;
  if (row.__math === sig) return;
  row.__math = sig;
  row.innerHTML = RUN.map(([k, l, s]) => `<button data-k="${k}" ${running ? 'disabled' : ''}>${l}<small>${s}</small></button>`).join('');
  row.querySelectorAll('button').forEach((b) => (b.onclick = () => ctx.job(b.dataset.k)));
}

// ── transport keys (the video carries its own controls; these mirror the motion shortcuts) ──
function keys(e) {
  if (!M.key || !ctx?.S?.d?.math || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  const v = el('#mVideo'), S = ctx.S;
  if (e.code === 'Space') { e.preventDefault(); if (v) v.paused ? v.play() : v.pause(); }
  if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    const fps = Number(S.d.cfg.fps) || 60;
    const step = e.shiftKey ? 1 : 1 / (Number.isFinite(fps) && fps > 0 ? fps : 60);
    ctx.seek(S.t + (e.code === 'ArrowRight' ? step : -step));
    if (v) { try { v.currentTime = S.t; } catch {} }
    tick();
  }
}

// ── mount ────────────────────────────────────────────────────────────────────────────────────
export function init(c) {
  ctx = c;
  if (!el('#mathViewStyle')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="mathViewStyle">
      #mView { display: flex; flex-direction: column; width: 100%; height: 100%; gap: 8px; }
      #mHead { display: flex; align-items: center; gap: 10px; font-size: 12px; }
      #mTc { font-family: var(--mono); }
      #mVideoWrap { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: center; }
      #mVideo { max-width: 100%; max-height: 100%; background: #000; border-radius: 4px; }
      #mStrip { width: 100%; height: 86px; cursor: pointer; border-radius: 6px; background: var(--bg2); }
      .mSent { display: grid; grid-template-columns: 110px 46px 92px 1fr auto auto; gap: 4px 8px; align-items: start; padding: 6px 4px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 12.5px; }
      .mSent:hover { background: var(--bg3); }
      .mSent.edit { background: var(--bg3); }
      .mSent .mTime { font-family: var(--mono); color: var(--dim); font-size: 11px; padding-top: 2px; }
      .mSent b { font-family: var(--mono); }
      .mText .mBm { background: #c77dff22; color: #c77dff; border-radius: 3px; padding: 0 2px; }
      .mChips { font-family: var(--mono); font-size: 10.5px; }
      .mEdit { align-self: start; }
      .mEditRow { grid-column: 1 / -1; display: flex; gap: 6px; }
      .mEditRow textarea { flex: 1; min-height: 54px; font: 12.5px var(--mono); }
      .mSceneCard { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; cursor: pointer; }
      .mSceneCard.bad { border-color: #ff4d5e55; }
      .mSceneCard:hover { background: var(--bg3); }
      .mSceneHead { display: flex; gap: 8px; align-items: center; }
      .mErr { color: var(--bad); font-size: 12px; margin: 4px 0; }
      .mSceneMeta { font-size: 11.5px; }
      .mRaw { font: 11.5px/1.5 var(--mono); white-space: pre-wrap; background: #08080a; border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
      .mWhereLine { grid-column: 1 / -1; font-size: 11.5px; padding: 2px 0 4px; }
      .mWhereLine code { color: var(--accent); }
      #mTab table { border-collapse: collapse; width: 100%; font-size: 11.5px; margin: 4px 0 10px; }
      #mTab td, #mTab th { border: 1px solid var(--line); padding: 3px 5px; vertical-align: top; text-align: left; }
      #mTab tr.bad td { color: var(--bad); }
      #mCheckLine { margin: 0 0 6px; }
      #mRevoice { color: var(--ok); margin: 0 0 8px; }
      .grow { flex: 1; }
    </style>`);
  }
  new MutationObserver(onTabBody).observe(el('#tabBody'), { childList: true });
  addEventListener('keydown', keys);
  addEventListener('resize', () => drawStrip());
}

// a small 'x ago' (app.js keeps its own; this module is standalone on that one)
function ago(ms) { const s = (Date.now() - ms) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString(); }
