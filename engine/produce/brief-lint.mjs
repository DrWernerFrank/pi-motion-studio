// brief-lint (K5): extract the explicit asks of a request DETERMINISTICALLY — every number (a
// duration, a size, a count), every format, every language, every named asset/file — and flag any
// that is not mapped to a requirement. The producer uses it as the seed of the ledger; the check
// runs it on 10 seeded requests and asserts nothing slips through.
import { readFileSync } from 'node:fs';

// formats: 16:9, 9:16, 1:1, 4:5, "vertical", "widescreen", "square", "portrait"
const FMT_WORDS = {
  '16:9': '16:9', widescreen: '16:9', landscape: '16:9', horizontal: '16:9',
  '9:16': '9:16', vertical: '9:16', portrait: '9:16',
  '1:1': '1:1', square: '1:1', '4:5': '4:5', '4x5': '4:5', feed: '4:5',
};

// languages ASR knows and the studio has voices/fonts for (fa = Persian)
const LANG_WORDS = {
  persian: 'fa', farsi: 'fa', fa: 'fa', arabic: 'ar', hebrew: 'he', english: 'en', spanish: 'es',
  french: 'fr', german: 'de', chinese: 'zh', japanese: 'ja', korean: 'ko', russian: 'ru',
  turkish: 'tr', hindi: 'hi', portuguese: 'pt', italian: 'it', dutch: 'nl',
};

// counts: "ten biggest", "top 10 cities", "three 45-second highlights", "12 phone clips" — a
// number (digit or word) with at most two plain modifiers, then the counted noun. Stop words
// break the chain, so "one of the biggest cities" is not a count of one and "60 seconds,
// narrated" is a duration, not a count of 60.
const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const COUNT_NOUNS = 'biggest|largest|top|clips|highlights|cities|economies';
const COUNT_STOP = 'of|the|and|a|an|in|for|from|with|over|by|at|on|to|into|per|minute|minutes|second|seconds';
const COUNT_RE = new RegExp(
  `\\b(\\d{1,3}|${Object.keys(COUNT_WORDS).join('|')})\\s+(?:(?!\\b(?:${COUNT_STOP})\\b)[a-z0-9][a-z0-9-]*\\s+){0,2}(?:${COUNT_NOUNS})\\b`,
  'gi',
);

export function extract(request) {
  const text = String(request || '');
  const low = text.toLowerCase();
  const out = { durations: [], formats: [], languages: [], assets: [], counts: [] };

  // durations: "60 seconds", "90-second", "half a minute", "20s", "2 minutes" (simple + measured)
  const secs = [...text.matchAll(/\b(\d+(?:\.\d+)?)(?:-|\s)?(?:second|seconds|sec|secs|s)\b/gi)].map((m) => +m[1]);
  const mins = [...text.matchAll(/\b(\d+(?:\.\d+)?)(?:-|\s)?(?:minute|minutes|min)\b/gi)].map((m) => +m[1] * 60);
  const hours = [...text.matchAll(/\b(\d+(?:\.\d+)?)(?:-|\s)?(?:hour|hours)\b/gi)].map((m) => +m[1] * 3600);
  const halfMin = /half a minute/i.test(text) ? [30] : [];
  out.durations = [...new Set([...secs, ...mins, ...hours, ...halfMin])];

  // formats: the ratio tokens + the plain words
  for (const [word, fmt] of Object.entries(FMT_WORDS)) if (new RegExp(`\\b${word.replace(':', '\\:')}\\b`, 'i').test(low)) out.formats.push(fmt);
  out.formats = [...new Set(out.formats)];

  // languages: the language word appears in the request ("in Persian", "Persian promo").
  // Short codes (fa) only count when said as "in fa" — a bare 'fa' would match 'factor'.
  for (const [word, lang] of Object.entries(LANG_WORDS)) {
    const hit = word.length <= 2
      ? new RegExp(`\\b(?:in|language)\\s+${word}\\b`, 'i').test(low)
      : new RegExp(`\\b${word}\\b`, 'i').test(low);
    if (hit) out.languages.push(lang);
  }
  out.languages = [...new Set(out.languages)];

  // named assets: explicit file mentions (~/…, …/…, C:\…, *.png|jpg|mp4|mov|webm|mp3|wav|m4a|logo…)
  out.assets = [...new Set([...text.matchAll(/(?:~\/[^\s,;"']*)|(?:[A-Za-z]:\\[^\s,;"']*)|(?:\b[\w.-]+\.(?:png|jpe?g|webp|gif|svg|mp4|mov|webm|mkv|mts|mp3|wav|m4a|aac|psd|pdf|ttf|otf))\b/g)]
    .map((m) => m[0].replace(/[,.;:!?)\]]+$/, '')))];   // strip trailing sentence punctuation
  // counts (see COUNT_RE above)
  out.counts = [...new Set([...text.matchAll(COUNT_RE)].map((m) => COUNT_WORDS[m[1].toLowerCase()] ?? +m[1]))];
  return out;
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// every way the ask could be phrased in a requirement's text: the value itself plus the words
// that extract maps onto it (16:9 ~ widescreen, fa ~ Persian, 3 ~ three …)
const forms = (map, value) => [...new Set([value, ...Object.entries(map).filter(([, v]) => v === value).map(([w]) => w)])];

/** Compare an extraction against a ledger: every extracted ask must be mapped by some requirement. */
export function lint(request, ledger) {
  const ex = extract(request);
  const texts = (ledger || []).map((r) => r.text.toLowerCase()).join(' \n ');
  const unmapped = [];
  // word boundaries matter: "190 seconds" in the ledger must not map a 90-second ask
  const says = (...alts) => alts.some((a) => new RegExp(`(^|[^\\w:])${esc(a)}(?=$|[^\\w:])`).test(texts));
  for (const d of ex.durations) {
    // a second-count maps as the bare number ("60", "60 s", "60s") but NOT when a bigger unit
    // follows ("45 min" is 2700s, not 45s); whole minutes also map as "2 min"
    const sec = new RegExp(`(^|[^\\w:])${d}(?!\\s?(?:min(?:ute)?s?|hours?|h))(?=$|[^\\w:]|[sm])`).test(texts);
    const mins = d % 60 === 0 && d >= 60 ? d / 60 : null;
    const minWord = mins !== null ? Object.keys(COUNT_WORDS).find((w) => COUNT_WORDS[w] === mins) : null;
    const asMin = mins !== null && (new RegExp(`(^|[^\\w:])${mins}\\s*min`).test(texts)
      || (minWord ? new RegExp(`\\b${minWord}\\s+min`).test(texts) : false));
    if (!sec && !asMin) unmapped.push({ kind: 'duration', value: d, fix: `a requirement that pins the ${d}s duration (verifier: duration)` });
  }
  for (const f of ex.formats) {
    const fs = forms(FMT_WORDS, f);   // the ratio, its slug (16x9) and the words (widescreen…)
    if (!says(...fs, f.replace(':', 'x'))) unmapped.push({ kind: 'format', value: f, fix: `a requirement for the ${f} format (verifier: formats)` });
  }
  for (const l of ex.languages) if (!says(...forms(LANG_WORDS, l))) unmapped.push({ kind: 'language', value: l, fix: `a requirement that the piece is in language "${l}" (verifier: language)` });
  for (const a of ex.assets) if (!texts.includes(a.toLowerCase())) unmapped.push({ kind: 'asset', value: a, fix: `a requirement that uses the named file ${a} (verifier: asset-used)` });
  for (const c of ex.counts) if (!says(...forms(COUNT_WORDS, c))) unmapped.push({ kind: 'count', value: c, fix: `a requirement that names the count ${c}` });
  return { extracted: ex, unmapped };
}

/** Read the request from a file (the CLI's --file path) or take it as a string. */
export const requestOf = (reqOrFile) => {
  try { return readFileSync(reqOrFile, 'utf8'); } catch { return String(reqOrFile); }
};
