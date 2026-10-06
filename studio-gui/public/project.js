// project.js: the project view — the producer's surface (K10's GUI half). Mounted like edit.js
// and math.js: PROJECT.init(ctx) once (from app.js, beside EDIT.init/MATH.init) and
// PROJECT.setFilm(S, d) per film (beside the other two). A film whose summary carries project:
// true (the project kind's own flag, set through hooksFor) gets this surface INSTEAD of the
// motion one:
//   · the stage: the piece at a glance — the phase chip, the goal, the segment strip (status
//     chips), the budget line and the request verbatim (brief.md). A project has no seek(t) live
//     page, so the live iframe is detached exactly the way the math view does it (nothing 404s).
//   · tabs Plan (goal, decision + why + alternatives, segments with status chips + capability),
//     Requirements (the ledger: the ask, its type, the verifier, the status chip, the evidence),
//     Assets (licensed or made here), Facts (sourced or hedged), Log (the tail of log.md, live).
//   · Notes + Run keep app.js's tabs (the existing flows): the Run row swaps to the project verbs
//     (rebuild / verify / ship / stop) through POST /api/project/:key/job and POST /api/make/stop,
//     and every note resolves through GET /api/project/:key/where (the segment, then the child's
//     own where) the same way math.js resolves notes through /api/film/:key/where.
// Same vanilla-module style as app.js/edit.js/math.js: no build, no framework, no deps. Data
// comes from GET /api/project/:key (the machine files, ADR-002; the server validates ids — the
// browser never names a path). Refresh rides app.js's SSE: any machine-file write fires the film
// event, selectFilm re-runs and PROJECT.setFilm re-adopts (a cheap fetch, adopt-only-on-change
// like math.js).
let ctx = null;                 // { S, esc, post, api, seek, pause, selectFilm, job, renderTab }
const el = (s) => document.querySelector(s);
const P_TABS = ['plan', 'requirements', 'assets', 'facts', 'log'];
const RUN = [   // the Run row's verbs: kind = the server's project job kinds (+ the make stop)
  ['rebuild', 'Rebuild', 'build every not-done segment (resume-safe)'],
  ['verify', 'Verify', 'ledger + facts + assets + budget + gates'],
  ['ship', 'Ship', 'verify green → assemble + publish'],
  ['stop', 'Stop', 'stop the running make (the runner unwinds)'],
];
const CHIP = { green: 'on', done: 'on', shipped: 'on', assembled: 'on', red: 'off', building: 'warn', reviewing: 'warn', waived: 'warn' };
const chip = (s) => `<span class="chip ${CHIP[s] ?? ''}">${ctx.esc(s ?? '—')}</span>`;

const P = { key: null, data: null, in: null, stageSaved: null, whereCache: null };

export const handles = (S) => !!(S && S.d && S.d.project);

// ── mount / refresh ─────────────────────────────────────────────────────────────────────────
export function setFilm(S, d) {
  if (!d || !d.project) return unmount(S);
  if (P.key !== d.key) mount(S, d);
  if (P_TABS.includes(S.tab)) renderTab(S);   // the placeholder first (math.js's pattern), then:
  loadProject(S, d);                          // the data lands and re-renders
}

function mount(S, d) {
  Object.assign(P, { key: d.key, data: null, in: null, whereCache: null });
  // the stage: a project owns it (phase + goal + the segment strip + the request). The motion
  // nodes (#liveWrap with its iframe, #renderWrap) are stashed, not destroyed — unmount()
  // re-attaches the very same nodes, so app.js's `iframe`/`video` consts stay live (math.js's
  // pattern; a detached iframe loads nothing, so nothing 404s).
  const stage = el('#stage');
  P.stageSaved = [...stage.childNodes];
  stage.innerHTML = `
    <div id="pView">
      <div id="pHead">
        <span id="pPhase" class="chip">planning</span>
        <span class="dim" id="pParts"></span>
        <span class="dim" id="pBud"></span>
        <span class="grow"></span>
        <span class="dim" id="pMsg"></span>
      </div>
      <div id="pBody">
        <h3>Goal</h3><p id="pGoal" class="dim">reading the plan…</p>
        <div id="pSegs" class="dim">…</div>
        <details id="pReq"><summary class="dim">the request (brief.md, verbatim)</summary><pre id="pBrief"></pre></details>
      </div>
    </div>`;
  const rw = P.stageSaved.find((n) => n?.id === 'renderWrap');
  if (rw) { rw.style.display = 'none'; stage.appendChild(rw); }
  // the motion chrome that does not apply: the live view (no seek(t) page), the transport (no
  // timeline — the piece is its parts), app's format seg
  el('#transport').style.display = 'none';
  el('#fmtSeg').style.display = 'none';
  el('#viewSeg [data-v="live"]').style.display = 'none';
  S.view = 'render';
  el('#viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'render'));
  // the tab bar: the project tabs first; Overview + Gates fold away (Plan carries the piece,
  // Requirements the verdict) — Reviews/Sheets/Notes/Run stay app.js's
  const tabs = el('#tabs');
  tabs.querySelector('[data-tab="overview"]').insertAdjacentHTML('beforebegin',
    '<button data-tab="plan">Plan</button><button data-tab="requirements">Requirements</button><button data-tab="assets">Assets</button><button data-tab="facts">Facts</button><button data-tab="log">Log</button>');
  tabs.querySelectorAll('button[data-tab="plan"], button[data-tab="requirements"], button[data-tab="assets"], button[data-tab="facts"], button[data-tab="log"]')
    .forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; ctx.renderTab(); renderTab(S); }));
  for (const t of ['overview', 'gates']) tabs.querySelector(`[data-tab="${t}"]`).style.display = 'none';
  if (![...P_TABS, 'reviews', 'sheets', 'notes', 'jobs'].includes(S.tab)) S.tab = 'plan';
}

function unmount(S) {
  if (!P.key && !P.stageSaved) return;
  const stage = el('#stage');
  P.stageSaved.find((n) => n?.id === 'renderWrap')?.style.removeProperty('display');
  if (P.stageSaved) { stage.replaceChildren(...P.stageSaved); P.stageSaved = null; }
  for (const id of ['#transport', '#fmtSeg']) el(id).style.display = '';
  el('#viewSeg [data-v="live"]').style.display = '';
  const tabs = el('#tabs');
  for (const t of P_TABS) tabs.querySelector(`[data-tab="${t}"]`)?.remove();
  for (const t of ['overview', 'gates']) tabs.querySelector(`[data-tab="${t}"]`)?.style.removeProperty('display');
  const tb = el('#tabBody'); if (tb) { tb.__pRoot = null; tb.__pNotes = null; }
  if (S) {
    if (P_TABS.includes(S.tab)) S.tab = 'overview';
    S.view = 'live';
    el('#viewSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'live'));
  }
  Object.assign(P, { key: null, data: null, in: null, whereCache: null });
}

// ── data ────────────────────────────────────────────────────────────────────────────────────
async function loadProject(S, d) {
  if (P.in) return;
  P.in = (async () => {
    try {
      const r = await ctx.api(`/api/project/${d.key}`);
      if (P.key !== d.key || !r || r.error) return;
      P.data = r;
      P.whereCache?.clear();   // new plan/state: every /where answer changes
      syncStage(S, d);
      if (P_TABS.includes(S.tab)) renderTab(S);
    } catch { /* the next SSE film event retries */ }
    finally { P.in = null; }
  })();
}

function syncStage(S, d) {
  const r = P.data; if (!r) return;
  const plan = r.plan, st = r.state ?? {};
  const phase = el('#pPhase');
  if (phase) { phase.textContent = st.phase ?? 'planning'; phase.className = `chip ${CHIP[st.phase] ?? ''}`; }
  const parts = el('#pParts');
  if (parts) parts.textContent = `${(plan?.segments || []).length} segment(s) · ${(r.cfg?.parts || []).length} part film(s) · ${r.requirements.length} requirement(s)`;
  const bud = el('#pBud');
  if (bud) { const b = r.budget ?? {}; bud.textContent = `${(+b.spentMinutes || 0).toFixed(1)}/${b.minutes ?? '?'} min · $${(+b.spentUsd || 0).toFixed(2)} of $${b.usd ?? 0}`; }
  const goal = el('#pGoal');
  if (goal) {
    goal.classList.toggle('dim', !plan);
    goal.textContent = plan?.goal ?? 'no plan yet — the producer writes plan.json (studio project plan <key> --check)';
  }
  const segs = el('#pSegs');
  if (segs) {
    segs.classList.toggle('dim', !plan);
    segs.innerHTML = (plan?.segments || []).map((s) => {
      const status = st.segments?.[s.id]?.status ?? 'planned';
      return `<span class="pSegChip ${CHIP[status] ?? ''}" title="${ctx.esc(s.role ?? '')} — ${ctx.esc(s.brief ?? '')}">${s.id} ${ctx.esc(s.capability)} <b>${ctx.esc(status)}</b> ${s.duration ?? '?'}s</span>`;
    }).join('') || 'no segments yet';
  }
  const brief = el('#pBrief'); if (brief) brief.textContent = r.brief ?? '(no brief.md)';
  const meta = el('#fMeta'); if (meta) meta.textContent = metaOf(S, d);
}

const metaOf = (S, d) => {
  const r = P.data, b = r?.budget ?? {};
  return [`films/${d.key}`, `phase ${r?.state?.phase ?? 'planning'}`, `${(d.children || d.cfg?.parts || []).length} part(s)`,
    `${(+b.spentMinutes || 0).toFixed(0)}/${b.minutes ?? '?'} min`, d.formats.join(' ')].join(' · ');
};
export const meta = (S, d) => metaOf(S, d);

// ── the tabs (Plan · Requirements · Assets · Facts · Log) ───────────────────────────────────
export function renderTab(S, root) {
  root ||= el('#tabBody');
  if (!P.key || !S?.d?.project || P.key !== S.key) { root.innerHTML = `<p class="dim">loading films/${S?.key}'s plan…</p>`; return; }
  const r = P.data;
  if (S.tab === 'plan') return renderPlan(root, r);
  if (S.tab === 'requirements') return renderReqs(root, r);
  if (S.tab === 'assets') return renderAssets(root, r);
  if (S.tab === 'facts') return renderFacts(root, r);
  if (S.tab === 'log') return renderLog(root, r);
}

function renderPlan(root, r) {
  root.__pRoot = P.key;
  if (!r) { root.innerHTML = '<p class="dim">reading the plan…</p>'; return; }
  const plan = r.plan;
  if (!plan) {
    root.innerHTML = `<div id="pTab"><h3>Planning</h3>
      <p class="dim">No plan yet. The runner (or pi with the produce skill) writes plan.json — the decision, the segments, the budget — then <code>studio project plan ${P.key} --check</code> validates it.</p>
      <h3>The request (brief.md)</h3><pre class="pPre">${ctx.esc(r.brief ?? '')}</pre></div>`;
    return;
  }
  const st = r.state?.segments ?? {};
  const alt = plan.decision?.alternatives || [];
  const del = (plan.deliverables || []).map((dv) => `${dv.type}${dv.formats?.length ? ` ${dv.formats.join('+')}` : ''}${dv.duration ? ` ${dv.duration}s` : ''}`).join(' · ');
  root.innerHTML = `<div id="pTab">
    <h3>Goal</h3><p>${ctx.esc(plan.goal ?? '—')}</p>
    <div class="kv">
      <span>audience</span><span>${ctx.esc(plan.audience ?? '—')}</span>
      <span>decision</span><span><b>${ctx.esc(plan.decision?.chosen ?? '—')}</b>${plan.decision?.risky ? ' <span class="chip warn">risky</span>' : ''}</span>
      <span>assembly</span><span>${ctx.esc(plan.assembly?.mode ?? '—')} · ${ctx.esc(plan.assembly?.audio ?? '')}</span>
      <span>deliverables</span><span>${del || '—'}</span>
      <span>budget</span><span>${r.budget?.minutes ?? '?'} min · $${r.budget?.usd ?? 0} (planned ${plan.budget?.minutes ?? '?'} min)</span>
      <span>phase</span><span>${chip(r.state?.phase ?? 'planning')}</span>
    </div>
    <h3>Why ${ctx.esc(plan.decision?.chosen ?? '')}</h3><p>${ctx.esc(plan.decision?.why ?? '—')}</p>
    ${alt.length ? `<h3>Alternatives (the simplest thing that could work, considered)</h3><ul>${alt.map((a) => `<li><code>${ctx.esc(a.id)}</code> — ${ctx.esc(a.rejected_because ?? '')}</li>`).join('')}</ul>` : ''}
    ${(plan.decision?.probes || []).length ? `<h3>Probes</h3><p class="dim">${plan.decision.probes.map((x) => `<code>${ctx.esc(x)}</code>`).join(' ')}</p>` : ''}
    <h3>Segments (${(plan.segments || []).length})</h3>
    ${(plan.segments || []).map((s) => `<div class="pSegRow">
      <b>${s.id}</b>${chip(st[s.id]?.status ?? 'planned')}<code>${ctx.esc(s.capability)}</code><span class="pRole">${ctx.esc(s.role ?? '')}</span>
      <span class="dim">→ films/${ctx.esc(s.film ?? `${P.key}-${s.id}`)} · ${s.duration ?? '?'}s</span>
      <div class="pBrief dim">${ctx.esc(s.brief ?? '')}</div>
      ${(s.acceptance || []).length ? `<div class="pAcc dim">accept: ${(s.acceptance || []).map((a) => ctx.esc(a)).join(' · ')}</div>` : ''}
    </div>`).join('') || '<p class="dim">none</p>'}
    ${(plan.assumptions || []).length ? `<h3>Assumptions</h3><ul>${plan.assumptions.map((a) => `<li>${ctx.esc(a)}</li>`).join('')}</ul>` : ''}
    ${(plan.risks || []).length ? `<h3>Risks</h3><ul>${plan.risks.map((a) => `<li>${ctx.esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderReqs(root, r) {
  root.__pRoot = P.key;
  if (!r) { root.innerHTML = '<p class="dim">reading the ledger…</p>'; return; }
  const rows = r.requirements || [];
  root.innerHTML = `<div id="pTab">
    <h3>Requirements — the ledger (${rows.length})</h3>
    <p class="dim">Every explicit ask, measured. <b>green</b> = the verifier ran and holds; <b>red</b> = measured and failed; <b>pending</b> = not measured yet; a waiver is a human's call, never the machine's.</p>
    ${rows.length ? `<table><thead><tr><th>id</th><th>the ask</th><th>type</th><th>verifier</th><th>status</th><th>evidence (measured)</th></tr></thead><tbody>
      ${rows.map((q) => `<tr class="${q.status === 'red' ? 'bad' : ''}"><td><b>${q.id}</b></td>
        <td>${ctx.esc(q.text ?? '')}${q.source ? ` <span class="dim">(${ctx.esc(q.source)})</span>` : ''}</td>
        <td>${ctx.esc(q.type ?? '')}</td>
        <td>${q.verifier ? `<code>${ctx.esc(q.verifier)}</code>${q.arg !== undefined && q.arg !== null ? ` ${ctx.esc(JSON.stringify(q.arg))}` : ''}${q.tolerance != null ? ` ±${ctx.esc(q.tolerance)}` : ''}` : '—'}</td>
        <td>${chip(q.status)}${q.waived_by ? ` <span class="dim">by ${ctx.esc(q.waived_by)}</span>` : ''}</td>
        <td class="pEv">${ctx.esc(q.evidence ?? '') || '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">none yet — the producer maps the request (studio project requirement, or the produce skill).</p>'}
  </div>`;
}

function renderAssets(root, r) {
  root.__pRoot = P.key;
  if (!r) { root.innerHTML = '<p class="dim">reading assets.json…</p>'; return; }
  const rows = r.assets || [];
  root.innerHTML = `<div id="pTab">
    <h3>Assets — licensed or made here (${rows.length})</h3>
    <p class="dim">Every asset carries its license and, when the license asks, its attribution; a pinned sha256 that no longer holds blocks ship.</p>
    ${rows.length ? `<table><thead><tr><th>id</th><th>file</th><th>license</th><th>origin</th><th>role</th><th>sha256</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td><b>${ctx.esc(a.id)}</b></td><td><code>${ctx.esc(String(a.path ?? '').split('/').slice(-2).join('/'))}</code></td>
        <td>${chip(a.license)}</td><td class="pEv">${ctx.esc(a.origin ?? '—')}</td><td>${ctx.esc(a.role ?? '—')}</td>
        <td class="pEv">${a.sha256 ? ctx.esc(a.sha256.slice(0, 12)) + '…' : '—'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="dim">none yet — a project may start with zero assets (everything drawn here).</p>'}
    ${(rows.filter((a) => a.attribution) || []).length ? `<h3>Attribution</h3><ul>${rows.filter((a) => a.attribution).map((a) => `<li><b>${ctx.esc(a.id)}</b> — ${ctx.esc(a.attribution)} (${ctx.esc(a.license)})</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderFacts(root, r) {
  root.__pRoot = P.key;
  if (!r) { root.innerHTML = '<p class="dim">reading facts.json…</p>'; return; }
  const rows = r.facts || [];
  root.innerHTML = `<div id="pTab">
    <h3>Facts — every claim sourced or hedged (${rows.length})</h3>
    <p class="dim">Verified offline: the quote must occur in the stored snapshot; a hedged claim passes honestly without a source; an unsourced un-hedged claim is refused at the door.</p>
    ${rows.length ? rows.map((f) => `<div class="pFact">
      <div><b>${ctx.esc(f.id)}</b> ${f.hedged ? '<span class="chip warn">hedged</span>' : '<span class="chip on">sourced</span>'} ${ctx.esc(f.claim)}</div>
      <div class="dim">${f.source_url ? `<a href="${ctx.esc(f.source_url)}" target="_blank" rel="noopener">${ctx.esc(f.source_url)}</a>` : 'no source (hedged)'}${f.quote ? ` — “${ctx.esc(f.quote)}”` : ''}${f.snapshot ? ` · <code>${ctx.esc(f.snapshot)}</code>` : ''}${f.retrieved_at ? ` · ${ctx.esc(String(f.retrieved_at).slice(0, 10))}` : ''}</div>
    </div>`).join('') : '<p class="dim">none yet — a piece with no claims needs no facts.</p>'}
  </div>`;
}

function renderLog(root, r) {
  root.__pRoot = P.key;
  const lines = r?.logTail || [];
  root.innerHTML = `<div id="pTab"><h3>Production log — films/${P.key}/log.md (the tail, live)</h3>
    <div class="log" id="pLog">${ctx.esc(lines.join('\n')) || '(empty)'}</div></div>`;
  const log = el('#pLog'); if (log) log.scrollTop = log.scrollHeight;
}

// ── the shared tabs, adapted: Notes resolved through /where · Run's project verbs ───────────
// app.js renders those two tabs (the existing flow); this observer adapts them for a project
// film right after each render — the same trick math.js plays. Idempotent via markers.
function onTabBody() {
  const S = ctx?.S;
  if (!S || !handles(S)) return;
  if (S.tab === 'jobs') projectRun(S);
  if (S.tab === 'notes') enrichNotes(S);
}

function projectRun(S) {
  const row = el('#tabBody .jobs');
  if (!row) return;
  const running = S.running.has(S.key);
  const sig = `${P.key}|${running}`;
  if (row.__proj === sig) return;
  row.__proj = sig;
  row.innerHTML = RUN.map(([k, l, s]) => `<button data-k="${k}" ${running ? 'disabled' : ''}>${l}<small>${s}</small></button>`).join('');
  row.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    if (b.dataset.k === 'stop') {
      try { await ctx.post('/api/make/stop'); }
      catch (e) { alert(String(e.message).split('\n')[0]); }
      return;
    }
    try { await ctx.post(`/api/project/${S.key}/job`, { kind: b.dataset.k }); S.tab = 'jobs'; ctx.renderTab(); }
    catch (e) { alert(String(e.message).split('\n')[0]); }
  }));
}

async function enrichNotes(S) {
  const root = el('#tabBody'), d = S.d;
  if (!root || !d?.notes) return;
  // the pin form's own timecode, resolved (so the author knows what they are pointing at)
  const pinAt = el('#noteAt');
  if (pinAt && !root.querySelector('#pPinWhere')) {
    pinAt.insertAdjacentHTML('afterend', `<div id="pPinWhere" class="dim pWhereLine">resolving…</div>`);
    resolve(S.t).then((r) => { const n = el('#pPinWhere'); if (n) n.innerHTML = whereLine(r); }).catch(() => {});
  }
  const open = d.notes.filter((n) => !n.done);
  const sig = JSON.stringify(open.map((n) => [n.id, n.t]));
  if (root.__pNotes === sig) return;
  root.__pNotes = sig;
  for (const n of open) {
    const div = root.querySelector(`.note [data-id="${n.id}"]`)?.closest('.note');
    if (!div || div.querySelector('.pWhereLine')) continue;
    div.insertAdjacentHTML('beforeend', `<div class="pWhereLine dim" data-note="${n.id}">resolving…</div>`);
    resolve(n.t).then((r) => {
      const line = root.querySelector(`[data-note="${n.id}"]`);
      if (line) line.innerHTML = whereLine(r);
    }).catch(() => {});
  }
}

async function resolve(t) {
  const k = String(t);
  if (P.whereCache?.has(k)) return P.whereCache.get(k);
  const r = await ctx.api(`/api/project/${P.key}/where?t=${(+t || 0).toFixed(3)}`);
  if (r?.error) return r;
  (P.whereCache ||= new Map()).set(k, r);
  return r;
}

function whereLine(r) {
  if (!r || r.error) return `<span style="color:var(--warn)">${ctx.esc(r?.error || 'unresolved')}</span>`;
  const seg = r.segment ? `segment <b>${r.segment.id}</b> (${ctx.esc(r.segment.capability)}${r.segment.role ? `, ${ctx.esc(r.segment.role)}` : ''}) @ +${(+r.segment.local || 0).toFixed(2)}s` : 'no segment';
  const child = r.child
    ? ` · part <b>films/${ctx.esc(r.child.key)}</b>: ${r.child.where?.error ? `<span style="color:var(--warn)">${ctx.esc(r.child.where.error)}</span>` : whereBit(r.child.where)}`
    : '';
  return `→ ${seg}${child}`;
}
const whereBit = (w) => (w && (w.scene || w.file))
  ? `${w.scene ? `scene <b>${ctx.esc(w.scene)}</b> · ` : ''}${w.sentence ? `sentence ${ctx.esc(w.sentence.id ?? w.sentence)} · ` : ''}<code>${ctx.esc(w.file ?? '')}${w.line ? ':' + w.line : ''}</code>`
  : '—';

// ── transport keys: a project has none (the stage is the piece, not a timeline) ─────────────
// This capture-phase listener runs BEFORE app.js's bubble one, so Space/arrows do nothing on a
// project film (nothing to play — no unhandled video.play() rejection), while 'n' (notes) lives.
function keys(e) {
  if (!handles(ctx?.S) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (['Space', 'ArrowRight', 'ArrowLeft'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); }
}

// ── mount ───────────────────────────────────────────────────────────────────────────────────
export function init(c) {
  ctx = c;
  if (!el('#projectViewStyle')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="projectViewStyle">
      #pView { display: flex; flex-direction: column; width: 100%; height: 100%; gap: 8px; min-height: 0; }
      #pHead { display: flex; align-items: center; gap: 10px; font-size: 12px; flex: none; }
      #pBody { flex: 1; min-height: 0; overflow: auto; padding: 2px 6px 10px 0; }
      #pBody h3 { margin: 16px 0 4px; }
      #pBody h3:first-child { margin-top: 2px; }
      #pGoal { margin: 0; }
      #pSegs { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; font: 11px var(--mono); }
      .pSegChip { font: 11px var(--mono); padding: 3px 8px; border-radius: 6px; background: var(--bg3); border: 1px solid var(--line); }
      .pSegChip.on { border-color: var(--ok); color: var(--ok); }
      .pSegChip.warn { border-color: var(--warn); color: var(--warn); }
      #pReq { margin-top: 12px; }
      #pBrief, .pPre { font: 11.5px/1.5 var(--mono); white-space: pre-wrap; background: #08080a; border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin: 6px 0; }
      #pTab table { border-collapse: collapse; width: 100%; font-size: 11.5px; margin: 4px 0 10px; }
      #pTab td, #pTab th { border: 1px solid var(--line); padding: 3px 5px; vertical-align: top; text-align: left; }
      #pTab tr.bad td { color: var(--bad); }
      .pEv { font-family: var(--mono); font-size: 11px; color: var(--dim); }
      .pSegRow { padding: 6px 4px; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 40px auto auto 1fr; gap: 4px 8px; align-items: baseline; font-size: 12.5px; }
      .pSegRow .pBrief, .pSegRow .pAcc { grid-column: 1 / -1; font-size: 11.5px; }
      .pFact { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
      .pFact .dim { font-size: 11.5px; margin-top: 2px; }
      .pFact a { color: var(--accent); }
      .pWhereLine { grid-column: 1 / -1; font-size: 11.5px; padding: 2px 0 4px; }
      .pWhereLine code { color: var(--accent); }
      /* the films list: children nest under their project (app.js groups on cfg.parent) */
      .hBtns { display: inline-flex; gap: 6px; }
      #films ul.kids { list-style: none; margin: 4px 0 0 12px; padding: 0; border-left: 1px solid var(--line); }
      #films ul.kids li { opacity: .85; padding: 5px 8px; }
      #films ul.kids li .k { font-weight: 500; font-size: 12px; }
      .grow { flex: 1; }
    </style>`);
  }
  new MutationObserver(onTabBody).observe(el('#tabBody'), { childList: true });
  addEventListener('keydown', keys, true);
}
