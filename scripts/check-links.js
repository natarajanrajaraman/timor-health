'use strict';
/**
 * check-links.js - FETCH AND FINGERPRINT every cited URL. Never a status ping.
 *
 * WHY A STATUS CODE IS NOT EVIDENCE (design rule 4 in the README)
 * ----------------------------------------------------------------------------
 * A former USAID project domain cited by this document (healthpolicyplus.com) now serves a
 * Bitcoin-casino affiliate site and returns HTTP 200. A link checker that trusts status codes
 * reports that citation healthy forever. So this script FETCHES the body, fingerprints it, and
 * compares the fingerprint against the one recorded when the citation was last verified. A page
 * whose content has CHANGED is reported even when it answers 200.
 *
 * WHAT IT REPORTS, AND WHY EACH CLASS IS SEPARATE
 * ----------------------------------------------------------------------------
 *   ok       - reachable AND the fingerprint matches the baseline.
 *   changed  - reachable, 2xx, but the content moved. NOT automatically bad (a ministry page that
 *              adds a document is fine); it means a HUMAN must look before the next publish.
 *   dead     - non-2xx, DNS failure, timeout, or a body too short to be a real page.
 *   blocked  - the SERVER refused an automated client (401/403/405/406/429, or a challenge page).
 *              This is NOT a dead citation and must never be reported as one: ReliefWeb answers
 *              406 and UNICEF 403 to any non-browser agent while both pages are perfectly alive.
 *              Conflating the two sends a human chasing healthy links and, worse, invites a future
 *              refresh to quietly drop them. It is also Raj's standing rule of 2026-08-25 in code:
 *              an anti-bot block STOPS the run for an attended check, it is not skipped.
 *   suspect  - 2xx but the body trips a parked/for-sale/casino heuristic. Reported LOUDLY and
 *              separately from `changed`, because it is the known failure mode by name.
 *   new      - cited but not in the baseline yet: nothing to compare, so nothing is claimed.
 *
 * THE SCRIPT NEVER EDITS content/*.md AND NEVER PUBLISHES. It writes a report and exits.
 * Judgement about a `changed` or `suspect` citation is a human's, and publish.js remains the sole
 * publisher (design rule 1).
 *
 * A COLLECTOR FAILURE IS NOT A CLEAN RESULT. If link extraction finds zero URLs, or the baseline
 * file is unreadable, this EXITS NON-ZERO rather than reporting "0 problems" - the same "returned
 * nothing vs found nothing" distinction that the stuck-funding audit confused.
 *
 * Usage:
 *   node scripts/check-links.js                 check all cited links against the baseline
 *   node scripts/check-links.js --baseline      record/refresh the baseline for healthy links
 *   node scripts/check-links.js --json          machine-readable report to stdout
 *   node scripts/check-links.js --only <substr> check just the links matching a substring
 *   node scripts/check-links.js --self-test     offline; asserts the FAILURE count
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const DATA = path.join(ROOT, 'data');
const BASELINE = path.join(DATA, 'link-baseline.json');
const REPORT = path.join(ROOT, 'state', 'link-check-latest.json');

const TIMEOUT_MS = 20000;
const MIN_BODY_BYTES = 200;   // shorter than this is a stub/error page, not a citation
/**
 * Two separate tests for "the server answered, but not with the citation". Both were TUNED
 * against the real 61 links on 2026-09-02 rather than guessed:
 *   MIN_TEXT_CHARS 120  - an absolute floor. Catches mof.gov.tl (66 chars, a JS redirect stub).
 *                         A first attempt at 400 also swallowed apps.ms.gov.tl directory indexes
 *                         (265 and 348 chars), which are real, reachable, citable pages - a false
 *                         block is as bad as a false dead, so the floor came down.
 *   SHELL_*             - a large payload wrapped around almost no text. Catches the five
 *                         Facebook pages (~435,000 bytes each, 325 characters of text), including
 *                         the Ministry of Health page Raj names as the source that must be read
 *                         by hand. Byte length alone cannot distinguish these from a rich page,
 *                         and text length alone would have to be set so high it ate the indexes.
 */
const MIN_TEXT_CHARS = 120;
const SHELL_BYTES = 50000;
const SHELL_TEXT_CHARS = 1000;
const CONCURRENCY = 4;

/**
 * Parked-domain / affiliate-spam markers. Deliberately NARROW and phrase-based: a broad word list
 * would false-positive on legitimate health pages (a gambling-harm policy paper mentions "casino").
 * Over-matching here is expensive - it trains the reader to ignore the loudest class - so this is
 * biased to UNDER-match, and `changed` catches whatever it misses.
 */
const SUSPECT_PATTERNS = [
  /\bthis domain (?:is|may be) for sale\b/i,
  /\bbuy this domain\b/i,
  /\bdomain (?:parking|parked)\b/i,
  /\bbest online casino/i,
  /\bcasino bonus\b/i,
  /\bcrypto casino/i,
  /\bsports ?book bonus\b/i,
];

/**
 * Trim the prose that a naive URL regex swallows, WITHOUT truncating the URL itself.
 *
 * ⚠️ THE PARENTHESIS CASE IS NOT COSMETIC - it manufactures false dead links, which is the exact
 * failure this whole script exists to avoid. A real citation here is
 *   ...Country%20Programme%20Evaluation%20(2021-2025).pdf
 * cited inside a markdown link, so the raw text reads `...(2021-2025).pdf)`. Stopping the match at
 * the first `)` yields `...(2021-2025` , which 404s - and the checker then reports a perfectly
 * live UNFPA document as DEAD. Measured on the first live run, 2026-09-02.
 *
 * So: allow parentheses inside the URL, then peel trailing characters one at a time - ordinary
 * prose punctuation, markdown emphasis, and only those `)` that have no matching `(` inside the
 * URL. A balanced pair is part of the address; an unbalanced closer is the markdown link ending.
 */
function trimUrl(raw) {
  let url = raw;
  for (;;) {
    const last = url.slice(-1);
    if ('.,;:!'.includes(last)) { url = url.slice(0, -1); continue; }
    if (url.endsWith('**')) { url = url.slice(0, -2); continue; }
    if (last === '*' || last === '_' || last === '"' || last === "'") { url = url.slice(0, -1); continue; }
    if (last === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) { url = url.slice(0, -1); continue; }
    }
    if (last === ']' || last === '>') { url = url.slice(0, -1); continue; }
    return url;
  }
}

/** Pull every http(s) URL out of the markdown sources, with the file(s) that cite it. */
function extractLinks(dir) {
  const found = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /https?:\/\/[^\s<>"]+/g;   // parens ALLOWED here; trimUrl decides where it ends
    let m;
    while ((m = re.exec(text)) !== null) {
      const url = trimUrl(m[0]);
      if (!url || url.length < 12) continue;
      if (!found.has(url)) found.set(url, new Set());
      found.get(url).add(f);
    }
  }
  return [...found.entries()]
    .map(([url, files]) => ({ url, citedIn: [...files].sort() }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Fingerprint the TEXT of a page, not its bytes. Raw-byte hashing makes every citation report
 * `changed` on the first run against any site that stamps a build id, a nonce or a date into its
 * HTML - which is most of them - and a checker that cries wolf on all 61 links is one nobody
 * reads. So: strip scripts/styles/tags, collapse whitespace, drop long hex ids, then hash.
 */
function fingerprint(body) {
  const text = String(body)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return {
    sha256: crypto.createHash('sha256').update(text).digest('hex').slice(0, 32),
    textLength: text.length,
    sample: text.slice(0, 300),
  };
}

/**
 * Statuses that mean "you are a robot", not "this page is gone". Kept as an explicit SET rather
 * than a range so adding one is a deliberate act with a reason attached.
 */
const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 429, 451]);

/** A 200 that is really a Cloudflare/Akamai interstitial. Narrow on purpose, same as SUSPECT. */
const CHALLENGE_PATTERNS = [
  /checking your browser before accessing/i,
  /enable javascript and cookies to continue/i,
  /cf-browser-verification/i,
  /please verify you are a human/i,
  /access denied[\s\S]{0,40}reference #/i,
];
function looksChallenge(body) { return CHALLENGE_PATTERNS.some((re) => re.test(String(body))); }

function looksSuspect(body) {
  const hits = SUSPECT_PATTERNS.filter((re) => re.test(body)).map((re) => String(re));
  return hits.length ? hits : null;
}

async function fetchOne(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        // Identify honestly. A checker that pretends to be a browser is the same class of
        // dishonesty this document exists to avoid.
        'user-agent': 'timor-health-scan link checker (+https://natarajanrajaraman.github.io/timor-health/)',
        'accept': 'text/html,application/pdf,*/*',
      },
    });
    const ctype = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const isBinary = /pdf|octet-stream|zip|image\//i.test(ctype);
    // A PDF's bytes are stable and large; fingerprint the first 256KB rather than the whole file.
    const body = isBinary ? buf.subarray(0, 262144).toString('base64') : buf.toString('utf8');
    return { status: res.status, finalUrl: res.url, contentType: ctype, body, bytes: buf.length, isBinary };
  } catch (err) {
    return { status: 0, error: err.name === 'AbortError' ? 'timeout' : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transport failures that mean "I could not reach it FROM HERE", not "it is gone".
 * Measured 2026-09-02 from Myanmar: iris.who.int connect-timed-out on every attempt while
 * who.int and api.worldbank.org both answered 200 from the same process - a host-specific
 * network path problem, not a dead citation. Reporting that as `dead` would send someone to
 * re-source six sections of a live WHO document. Same lesson as the fleet network guard:
 * a failed probe is evidence about the probe as much as about the target.
 */
const UNREACHABLE_MARKERS = [
  'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'EAI_AGAIN', 'ENOTFOUND', 'timeout', 'fetch failed',
];
function looksUnreachable(err) {
  const s = String(err || '');
  return UNREACHABLE_MARKERS.some((m) => s.includes(m));
}

function classify(url, res, baseEntry) {
  if (!res || res.status === 0) {
    const err = res && res.error ? res.error : 'no response';
    if (looksUnreachable(err)) {
      return { url, state: 'unreachable',
        detail: `${err} - could not be reached FROM THIS MACHINE/NETWORK; this is NOT evidence the page is gone. Re-run from another network before touching the citation.` };
    }
    return { url, state: 'dead', detail: err };
  }
  if (BLOCKED_STATUSES.has(res.status)) {
    return { url, state: 'blocked', status: res.status,
      detail: `HTTP ${res.status} - server refused an automated client; verify in a browser, do NOT treat as dead` };
  }
  if (res.status < 200 || res.status >= 300) {
    return { url, state: 'dead', detail: `HTTP ${res.status}`, status: res.status };
  }
  if (!res.isBinary && looksChallenge(res.body)) {
    return { url, state: 'blocked', status: res.status,
      detail: 'HTTP 200 but the body is an anti-bot challenge page, not the citation' };
  }
  if (res.bytes < MIN_BODY_BYTES) {
    return { url, state: 'dead', detail: `body only ${res.bytes} bytes - stub or error page`, status: res.status };
  }
  const suspect = res.isBinary ? null : looksSuspect(res.body);
  const fp = fingerprint(res.body);

  /**
   * A 2xx page whose READABLE TEXT is near-empty is a login wall or a JS-only shell, not a
   * citation we can verify. Measured 2026-09-02: facebook.com/PradetTimorLeste yielded 77
   * characters of text and RedeFetoTimorLeste 21 - and because those shells vary between fetches,
   * both landed in `changed` on consecutive runs. That is noise in the one class that is supposed
   * to mean "a human should look", and noise there trains the reader to skip all of it. They are
   * BLOCKED: the server served us something, but not the thing being cited.
   *
   * Byte length cannot catch this - the Facebook shell is ~500KB of script around 21 characters -
   * which is why the threshold is on stripped text, after fingerprint() has done the stripping.
   */
  if (!res.isBinary && !suspect) {
    const nearEmpty = fp.textLength < MIN_TEXT_CHARS;
    const shell = res.bytes > SHELL_BYTES && fp.textLength < SHELL_TEXT_CHARS;
    if (nearEmpty || shell) {
      return { url, state: 'blocked', status: res.status,
        detail: `2xx but only ${fp.textLength} characters of readable text (${res.bytes} bytes) - ` +
                `${shell ? 'a large script payload wrapped around almost nothing (JS-only shell / login wall)' : 'almost no readable text'}, not the cited content` };
    }
  }
  const base = { url, status: res.status, finalUrl: res.finalUrl, fingerprint: fp.sha256, textLength: fp.textLength };
  if (suspect) {
    return { ...base, state: 'suspect', detail: `parked/affiliate markers: ${suspect.join(', ')}`, sample: fp.sample };
  }
  if (!baseEntry) return { ...base, state: 'new', detail: 'no baseline - nothing claimed about this link yet' };
  if (baseEntry.fingerprint !== fp.sha256) {
    const delta = fp.textLength - (baseEntry.textLength || 0);
    return {
      ...base, state: 'changed',
      detail: `content changed since ${baseEntry.recordedOn} (text ${baseEntry.textLength} -> ${fp.textLength}, ${delta >= 0 ? '+' : ''}${delta})`,
      sample: fp.sample,
    };
  }
  return { ...base, state: 'ok', detail: `unchanged since ${baseEntry.recordedOn}` };
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

function parseBaseline(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    // Strict-parse: refuse rather than degrading to an empty baseline, which would silently
    // reclassify every link as `new` and report zero problems.
    throw new Error(`link-baseline.json unreadable (${e.message}) - refusing to treat every link as new`);
  }
  if (!parsed || typeof parsed.links !== 'object' || parsed.links === null) {
    throw new Error('link-baseline.json has no .links object - refusing to run');
  }
  return parsed;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return { $comment: 'seeded by check-links.js', links: {} };
  return parseBaseline(fs.readFileSync(BASELINE, 'utf8'));
}

async function run(argv) {
  const json = argv.includes('--json');
  const rebase = argv.includes('--baseline');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

  let links = extractLinks(CONTENT);
  if (links.length === 0) {
    console.error('check-links: extracted ZERO urls from content/*.md - a collector failure, not a clean result.');
    process.exit(2);
  }
  if (only) links = links.filter((l) => l.url.includes(only));

  const baseline = loadBaseline();
  const results = await mapLimited(links, CONCURRENCY, async (l) => {
    const r = classify(l.url, await fetchOne(l.url), baseline.links[l.url]);
    r.citedIn = l.citedIn;
    return r;
  });

  const by = (s) => results.filter((r) => r.state === s);
  const report = {
    checkedOn: new Date().toISOString().slice(0, 10),
    total: results.length,
    counts: {
      ok: by('ok').length, changed: by('changed').length, dead: by('dead').length,
      blocked: by('blocked').length, unreachable: by('unreachable').length,
      suspect: by('suspect').length, new: by('new').length,
    },
    results,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');

  if (rebase) {
    // Baseline ONLY links that are currently healthy. Baselining a `suspect` or `dead` link would
    // bake the casino page in as the expected content.
    let n = 0;
    for (const r of results) {
      if (r.state === 'ok' || r.state === 'changed' || r.state === 'new') {
        baseline.links[r.url] = {
          fingerprint: r.fingerprint, textLength: r.textLength,
          status: r.status, finalUrl: r.finalUrl, recordedOn: report.checkedOn,
        };
        n++;
      }
    }
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    console.log(`baseline: ${n} links recorded (suspect/dead deliberately NOT baselined); ${Object.keys(baseline.links).length} total`);
  }

  if (json) { console.log(JSON.stringify(report, null, 2)); return report; }

  console.log(`check-links ${report.checkedOn}: ${report.total} cited links`);
  console.log(`  ok ${report.counts.ok} | changed ${report.counts.changed} | dead ${report.counts.dead} | blocked ${report.counts.blocked} | unreachable ${report.counts.unreachable} | SUSPECT ${report.counts.suspect} | new ${report.counts.new}`);
  for (const s of ['suspect', 'dead', 'blocked', 'unreachable', 'changed', 'new']) {
    const rows = by(s);
    if (!rows.length) continue;
    console.log(`\n--- ${s.toUpperCase()} (${rows.length})`);
    for (const r of rows) console.log(`  ${r.url}\n      ${r.detail}   [cited in ${r.citedIn.join(', ')}]`);
  }
  console.log(`\nreport: ${REPORT}`);
  if (report.counts.suspect > 0) {
    console.log('\n*** A SUSPECT citation is the healthpolicyplus.com case by name. Do not publish over it. ***');
  }
  return report;
}

// -- self-test (offline; assert the FAILURE count) ---------------------------
function selfTest() {
  let failed = 0, passed = 0;
  const t = (name, cond, detail) => {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
  };

  t('extractLinks strips trailing prose punctuation', (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlchk-'));
    fs.writeFileSync(path.join(tmp, 'a.md'), 'see https://example.org/x. and https://example.org/y, ok');
    const got = extractLinks(tmp).map((l) => l.url);
    return got.includes('https://example.org/x') && got.includes('https://example.org/y');
  })());

  t('extractLinks records every citing file', (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlchk2-'));
    fs.writeFileSync(path.join(tmp, 'a.md'), 'https://example.org/z');
    fs.writeFileSync(path.join(tmp, 'b.md'), 'https://example.org/z');
    const row = extractLinks(tmp).find((l) => l.url === 'https://example.org/z');
    return row && row.citedIn.length === 2;
  })());

  const fpA = fingerprint('<html><body><p>Hello  World</p></body></html>');
  t('fingerprint ignores whitespace and tags',
    fpA.sha256 === fingerprint('<html><body>\n  <p>Hello World</p>\n</body></html>').sha256);
  t('fingerprint ignores <script> contents',
    fpA.sha256 === fingerprint('<html><body><p>Hello World</p><script>var t=1</script></body></html>').sha256);
  t('fingerprint ignores long hex build ids',
    fpA.sha256 === fingerprint('<html><body><p>Hello World</p><span>a1b2c3d4e5f60718</span></body></html>').sha256);
  t('fingerprint DOES change on real text change',
    fingerprint('<p>Hello World</p>').sha256 !== fingerprint('<p>Goodbye World</p>').sha256);

  // The load-bearing assertion: the documented failure case must be caught.
  t('a 200-OK casino page is SUSPECT, not ok', (() => {
    const body = '<html><body><h1>Best online casino bonus 2026</h1></body></html>';
    return classify('https://healthpolicyplus.com/x',
      { status: 200, bytes: 2000, body, isBinary: false, finalUrl: 'x' }, null).state === 'suspect';
  })());

  t('an ordinary page about gambling POLICY is NOT suspect (under-match, on purpose)', (() => {
    const body = '<html><body><p>Regulation of casino advertising and gambling harm in the Pacific.</p></body></html>';
    return classify('https://who.int/x',
      { status: 200, bytes: 2000, body, isBinary: false, finalUrl: 'x' }, null).state !== 'suspect';
  })(), 'gambling-policy prose must not trip the parked-domain heuristic');

  t('HTTP 200 + changed fingerprint reports CHANGED, not ok', (() => {
    const body = '<html><body><p>' + 'New text entirely. '.repeat(20) + '</p></body></html>';
    return classify('https://x.test/', { status: 200, bytes: 2000, body, isBinary: false, finalUrl: 'x' },
      { fingerprint: 'deadbeef', textLength: 10, recordedOn: '2026-01-01' }).state === 'changed';
  })());

  t('HTTP 200 + matching fingerprint reports ok', (() => {
    const body = '<html><body><p>' + 'Stable text. '.repeat(20) + '</p></body></html>';
    const fp = fingerprint(body);
    return classify('https://x.test/', { status: 200, bytes: 2000, body, isBinary: false, finalUrl: 'x' },
      { fingerprint: fp.sha256, textLength: fp.textLength, recordedOn: '2026-01-01' }).state === 'ok';
  })());

  t('HTTP 404 is dead', classify('u', { status: 404, bytes: 5000, body: 'x', isBinary: false }, null).state === 'dead');

  // Raj's standing rule in code: a bot block STOPS the run; it is not a dead citation and it is
  // not a skip. Conflating 403 with 404 sends a human chasing links that are perfectly alive.
  for (const code of [401, 403, 405, 406, 429, 451]) {
    t(`HTTP ${code} is BLOCKED, not dead`,
      classify('u', { status: code, bytes: 5000, body: 'x', isBinary: false }, null).state === 'blocked');
  }
  t('HTTP 200 that is really a Cloudflare challenge is BLOCKED, not ok', (() => {
    const body = '<html><body>Checking your browser before accessing example.org</body></html>';
    return classify('u', { status: 200, bytes: 3000, body, isBinary: false, finalUrl: 'x' }, null).state === 'blocked';
  })());
  t('a real page is NOT mistaken for a challenge', (() => {
    const body = '<html><body><p>' + 'National TB guidelines, fifth edition. '.repeat(20) + '</p></body></html>';
    return classify('u', { status: 200, bytes: 3000, body, isBinary: false, finalUrl: 'x' }, null).state !== 'blocked';
  })());

  // A login wall that answers 200 with a huge script payload and 21 characters of text.
  t('a 2xx login wall with near-empty TEXT is BLOCKED, not changed/ok', (() => {
    const body = '<html><head><script>' + 'x'.repeat(400000) + '</script></head><body>Log in to continue</body></html>';
    return classify('https://www.facebook.com/Example/',
      { status: 200, bytes: 500000, body, isBinary: false, finalUrl: 'x' },
      { fingerprint: 'old', textLength: 77, recordedOn: '2026-01-01' }).state === 'blocked';
  })(), 'a varying 21-char shell in `changed` is noise in the one class that means "look at this"');

  t('byte length alone would NOT catch that wall (so the threshold must be on TEXT)', (() => {
    const body = '<html><head><script>' + 'x'.repeat(400000) + '</script></head><body>Log in to continue</body></html>';
    return 500000 > MIN_BODY_BYTES && fingerprint(body).textLength < MIN_TEXT_CHARS;
  })());

  t('a short-but-real page above the text floor is still classified normally', (() => {
    const body = '<html><body><p>' + 'Ministry of Health guideline text. '.repeat(15) + '</p></body></html>';
    return classify('u', { status: 200, bytes: 3000, body, isBinary: false, finalUrl: 'x' }, null).state === 'new';
  })());
  t('HTTP 500 is still dead (blocked did not swallow real failures)',
    classify('u', { status: 500, bytes: 5000, body: 'x', isBinary: false }, null).state === 'dead');
  // A failed probe is evidence about the probe as much as about the target. Measured 2026-09-02:
  // iris.who.int connect-timed-out from Myanmar while who.int answered 200 in the same process.
  t('a connect timeout is UNREACHABLE, not dead',
    classify('u', { status: 0, error: 'fetch failed UND_ERR_CONNECT_TIMEOUT' }, null).state === 'unreachable');
  t('a DNS failure is UNREACHABLE, not dead',
    classify('u', { status: 0, error: 'getaddrinfo ENOTFOUND example.invalid' }, null).state === 'unreachable');
  t('an unrecognised transport error is still DEAD (unreachable did not swallow everything)',
    classify('u', { status: 0, error: 'certificate has expired' }, null).state === 'dead');

  // The parenthesis case: a real UNFPA citation that a naive extractor truncates into a 404.
  t('a URL containing balanced parens survives extraction', (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tlchk3-'));
    fs.writeFileSync(path.join(tmp, 'a.md'),
      '([Annexes](https://www.unfpa.org/files/Evaluation%20(2021-2025).pdf))');
    const got = extractLinks(tmp).map((l) => l.url);
    return got.includes('https://www.unfpa.org/files/Evaluation%20(2021-2025).pdf');
  })(), 'truncating at the first ) manufactures a false DEAD link');

  t('an unbalanced trailing ) from a markdown link IS stripped',
    trimUrl('https://example.org/x)') === 'https://example.org/x');
  t('trailing markdown bold is stripped',
    trimUrl('https://example.org/x)**,') === 'https://example.org/x');
  t('a balanced pair mid-URL is preserved',
    trimUrl('https://example.org/a(b)c') === 'https://example.org/a(b)c');
  t('a 200 with a 40-byte body is dead, not ok',
    classify('u', { status: 200, bytes: 40, body: 'tiny', isBinary: false }, null).state === 'dead');

  t('an unreadable baseline THROWS rather than treating every link as new', (() => {
    try { parseBaseline('{not json'); return false; } catch (_) { return true; }
  })());
  t('a baseline with no .links object THROWS', (() => {
    try { parseBaseline('{"other":1}'); return false; } catch (_) { return true; }
  })());

  console.log(`\ncheck-links: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else run(process.argv.slice(2)).catch((e) => { console.error('check-links FAILED:', e.message); process.exit(2); });
}

module.exports = {
  extractLinks, trimUrl, fingerprint, looksSuspect, looksChallenge, looksUnreachable,
  classify, parseBaseline, SUSPECT_PATTERNS, CHALLENGE_PATTERNS, BLOCKED_STATUSES,
};
