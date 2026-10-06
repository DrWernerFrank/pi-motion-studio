// budget (P2): zero spend unless the human allowed it. With no key or no STUDIO_BUDGET_USD the
// fake cloud provider reports disabled (the why names the fix) and is never called — a disabled
// call is refused and logged nowhere; with both it is called and every call is logged to
// budget.json; the usd hard stop throws with the spend never passing the cap; the minutes soft
// stop (80%, wrap up) and hard stop (100%) fire. Nothing real is ever called: PROVIDERS holds
// only 'fake', no entry carries a URL/host, and budget.mjs's source has no fetch and no http.
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../../lib/film.mjs';
import { ROOT } from '../../lib/serve.mjs';
import { PROVIDERS, budgetPath, call, providerStatus } from '../../produce/budget.mjs';

const KEY = 'verify-p-budget';
const SRC = join(ROOT, 'engine', 'produce', 'budget.mjs');

export default async () => {
  const bad = [], facts = [];
  const need = (ok, what) => { if (!ok) bad.push(what); };
  const dir = join(FILMS, KEY);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'film.json'), { kind: 'project', title: 'the budget check fixture', formats: [], request: 'prove the spend gate', parts: [] });
  const seed = (bud) => writeJson(budgetPath(KEY), bud);          // the check owns budget.json
  const read = () => readJson(budgetPath(KEY), {});
  const ENV = { STUDIO_FAKE_CLOUD_KEY: 'present', STUDIO_BUDGET_USD: '0.50' };

  try {
    // 1. disabled unless BOTH the key and a budget > 0 are present (the why names the fix)
    const off = providerStatus('fake', { env: {} });
    need(off.enabled === false, 'with no key and no budget the fake provider is not disabled');
    need(/STUDIO_FAKE_CLOUD_KEY/.test(off.why) && /STUDIO_BUDGET_USD/.test(off.why),
      `the disabled why does not name the fix (key + budget): ${off.why}`);
    const keyOnly = providerStatus('fake', { env: { STUDIO_FAKE_CLOUD_KEY: 'present', STUDIO_BUDGET_USD: '0' } });
    need(keyOnly.enabled === false && /STUDIO_BUDGET_USD/.test(keyOnly.why),
      'a key with STUDIO_BUDGET_USD=0 is not disabled');
    const on = providerStatus('fake', { env: ENV });
    need(on.enabled === true, 'key + STUDIO_BUDGET_USD>0 does not enable the provider');
    facts.push('disabled by default (no key / no budget>0, either alone): enabled only with both');

    // 2. disabled -> the call is refused and NOTHING is logged (never called)
    seed({ minutes: 180, usd: 0.5, spent_usd: 0, calls: [] });
    const r0 = await call(KEY, 'fake', { costUsd: 0.1, minutes: 1, label: 'disabled leg', env: {} });
    need(r0.ok === false && r0.disabled === true, `a disabled call did not return {ok:false, disabled:true}: ${JSON.stringify(r0)}`);
    need((read().calls || []).length === 0 && read().spent_usd === 0, 'a disabled call was still logged to budget.json');

    // 3. enabled -> logged; the usd hard stop throws and the spend never passes the cap
    seed({ minutes: 180, usd: 0.5, spent_usd: 0, calls: [] });
    const c1 = await call(KEY, 'fake', { costUsd: 0.1, minutes: 0, label: 'one', env: ENV });
    const c2 = await call(KEY, 'fake', { costUsd: 0.1, minutes: 0, label: 'two', env: ENV });
    need(c1.ok === true && c2.ok === true, 'enabled calls did not succeed');
    let bud = read();
    need(bud.calls.length === 2 && Math.abs(bud.spent_usd - 0.2) < 1e-9,
      `two $0.10 calls did not log to $0.20 (got ${bud.calls.length} call(s), $${bud.spent_usd})`);
    let hard = null;
    try { await call(KEY, 'fake', { costUsd: 0.4, minutes: 0, label: 'three', env: ENV }); }
    catch (e) { hard = String(e.message || e); }
    need(!!hard && /usd.*hard stop/.test(hard), `a $0.40 call at $0.20 of a $0.50 budget did not throw the usd hard stop: ${hard}`);
    bud = read();
    need(bud.calls.length === 2 && Math.abs(bud.spent_usd - 0.2) < 1e-9,
      'the refused call moved the spend past the cap (the hard stop must leave budget.json untouched)');
    facts.push('usd: 2 calls logged $0.20/$0.50; a $0.40 third threw the hard stop, spend held at $0.20');

    // 4. minutes: soft stop at 80% (wrap up), hard stop at 100% (seeded by writing budget.json)
    seed({ minutes: 100, usd: 1, spent_usd: 0,
      calls: [{ at: '2026-10-06T00:00:00.000Z', provider: 'fake', costUsd: 0, minutes: 79, label: 'seeded spend (written directly)' }] });
    const soft = await call(KEY, 'fake', { costUsd: 0.01, minutes: 2, label: 'soft leg', env: ENV });
    need(soft.ok === false && soft.softStop === true && /soft stop/.test(soft.why ?? ''),
      `79+2 of 100 minutes did not return softStop: ${JSON.stringify(soft)}`);
    need(read().calls.length === 1, 'a soft-stopped call was logged (only successful calls are)');
    seed({ minutes: 100, usd: 1, spent_usd: 0,
      calls: [{ at: '2026-10-06T00:00:00.000Z', provider: 'fake', costUsd: 0, minutes: 99, label: 'seeded spend (written directly)' }] });
    let minHard = null;
    try { await call(KEY, 'fake', { costUsd: 0.01, minutes: 2, label: 'hard leg', env: ENV }); }
    catch (e) { minHard = String(e.message || e); }
    need(!!minHard && /minutes.*hard stop/.test(minHard), `99+2 of 100 minutes did not throw the minutes hard stop: ${minHard}`);
    facts.push('minutes: 79+2 of 100 -> softStop (wrap up); 99+2 -> hard stop (throws)');

    // 5. nothing real is ever called — the guard is structural
    need(Object.keys(PROVIDERS).length === 1 && 'fake' in PROVIDERS,
      `PROVIDERS is not only the fake provider: ${Object.keys(PROVIDERS).join(', ')}`);
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const flat = JSON.stringify(p).toLowerCase();
      need(!/url|host|http/.test(flat), `provider "${id}" carries a network address (${flat}) — a provider is a key NAME, never an endpoint`);
    }
    const src = readFileSync(SRC, 'utf8');
    need(!src.includes('fetch('), 'budget.mjs contains a fetch( call — the one billable place must stay offline-guarded');
    need(!src.includes('http'), 'budget.mjs mentions http anywhere in its source (a wired endpoint would be a real spend)');
    facts.push('PROVIDERS=[fake] with 0 urls/hosts; budget.mjs source: no fetch(, no http');
  } finally {
    rmSync(dir, { recursive: true, force: true });   // the fixture film never outlives the check
  }
  return { pass: bad.length === 0, measured: bad.length ? bad.join('; ') : facts.join('; ') };
};
