// Budget + providers (K7): the spend is zero unless the human allowed otherwise. A cloud provider
// is opt-in: a key in .env BY NAME plus STUDIO_BUDGET_USD > 0; with either missing the provider
// reports disabled and NOTHING is called. Every call is logged to budget.json; the budget is a
// hard stop. The one provider here is FAKE (tests exercise the guard; nothing real is ever called —
// wiring a real one means: implement call() against the service, add the key name to KEYS, done).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILMS, readJson, writeJson } from '../lib/film.mjs';

export const budgetPath = (key) => join(FILMS, key, 'budget.json');
const ENV_FILE = join(FILMS, '..', '.env');   // the repo's .env

const readEnv = () => {
  const out = {};
  try { for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) { const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim()); if (m && !m[1].startsWith('#')) out[m[1]] = m[2]; } }
  catch { /* no .env: everything disabled */ }
  return out;
};

/** The known opt-in providers: key NAME (never the value), their budget field. */
export const PROVIDERS = {
  fake: { keyName: 'STUDIO_FAKE_CLOUD_KEY', label: 'the fake cloud provider (tests only)' },
  // a real provider joins here: { keyName: 'GEMINI_API_KEY', label: 'Gemini vision' }
};

/** Is a provider enabled? Requires BOTH its key (by name, in .env) AND STUDIO_BUDGET_USD > 0.
 *  Returns { enabled, why } — the why is the fix when disabled. Never throws, never calls out. */
export function providerStatus(name, { env = readEnv() } = {}) {
  const p = PROVIDERS[name];
  if (!p) return { enabled: false, why: `unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})` };
  const hasKey = !!env[p.keyName] && !env[p.keyName].startsWith('#');
  const budget = Number(env.STUDIO_BUDGET_USD || 0);
  if (!hasKey && !(budget > 0)) return { enabled: false, why: `disabled: no ${p.keyName} in .env and STUDIO_BUDGET_USD is not > 0 (spend nothing without permission — this is the default)` };
  if (!hasKey) return { enabled: false, why: `disabled: ${p.keyName} is not in .env (add it by name, never paste the value anywhere)` };
  if (!(budget > 0)) return { enabled: false, why: `disabled: STUDIO_BUDGET_USD is not > 0 (a budget must be allowed before any call)` };
  return { enabled: true, why: `enabled: ${p.keyName} present and STUDIO_BUDGET_USD=${budget}` };
}

/** Call a provider (the one place anything billable can happen). Checks status first, logs every
 *  call to budget.json, enforces the usd hard stop and the minutes soft/hard stops. */
export async function call(key, name, { costUsd = 0, minutes = 0, label = '' } = {}) {
  const bud = readJson(budgetPath(key), { minutes: 180, usd: 0, spent_usd: 0, calls: [] });
  // minutes: soft stop at 80% (wrap up with what exists), hard stop at 100%
  const minsSoft = bud.minutes * 0.8, minsHard = bud.minutes;
  const spentMin = (bud.calls || []).reduce((n, c) => n + (c.minutes || 0), 0);
  if (spentMin + minutes > minsHard) throw new Error(`budget (minutes) hard stop: ${spentMin.toFixed(0)}/${minsHard.toFixed(0)} min used — finish with what exists and report honestly`);
  if (spentMin + minutes > minsSoft) return { ok: false, softStop: true, why: `budget (minutes) soft stop at 80%: wrap up with what exists (${(minsHard - spentMin).toFixed(0)} min left)` };
  const st = providerStatus(name);
  if (!st.enabled) return { ok: false, disabled: true, why: st.why };
  // the usd hard stop: no call may push the spend past the allowed budget
  if (bud.spent_usd + costUsd > bud.usd) throw new Error(`budget (usd) hard stop: $${bud.spent_usd.toFixed(3)} + $${costUsd.toFixed(3)} > the allowed $${bud.usd} — stop and report`);
  const call = { at: new Date().toISOString(), provider: name, costUsd, minutes, label };
  writeJson(budgetPath(key), { ...bud, spent_usd: +(bud.spent_usd + costUsd).toFixed(4), calls: [...(bud.calls || []), call] });
  return { ok: true, call };
}

/** The budget's state for a status report: { minutes, usd, spentUsd, spentMinutes, phase } (never a secret). */
export function budgetOf(key) {
  const bud = readJson(budgetPath(key), { minutes: 180, usd: 0, spent_usd: 0, calls: [] });
  const spentMinutes = (bud.calls || []).reduce((n, c) => n + (c.minutes || 0), 0);
  return { minutes: bud.minutes, usd: bud.usd, spentUsd: bud.spent_usd ?? 0, spentMinutes,
    phase: spentMinutes >= bud.minutes ? 'hard-stop' : spentMinutes >= bud.minutes * 0.8 ? 'soft-stop' : 'ok' };
}

/** Whether the budget held at ship time (hard stops throw before this can be reached). */
export function verifyBudget(key) {
  const b = budgetOf(key);
  return { ok: b.phase !== 'hard-stop' && b.spentUsd <= b.usd + 1e-9, ...b, calls: (readJson(budgetPath(key), {}).calls || []).length };
}
void existsSync;
