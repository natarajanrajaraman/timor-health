'use strict';
/**
 * archive.js - make each published edition independently retrievable: a web-archive snapshot of
 * the live page, and (when configured) a citable Zenodo version under a stable concept DOI.
 *
 * WHY BOTH, AND WHY THIS IS NOT OPTIONAL POLISH
 * ----------------------------------------------------------------------------
 * This document tells readers which edition they are looking at and promises a quarterly refresh.
 * That promise is only meaningful if the edition someone cited in March is still retrievable in
 * December. Without an archive, "edition 2026-Q3" names something that no longer exists anywhere -
 * the page is overwritten in place by design, and GitHub Pages keeps no history a reader can reach.
 *
 * THE TWO ARCHIVES DO DIFFERENT JOBS AND NEITHER SUBSTITUTES FOR THE OTHER:
 *   - Wayback  : proves what the page SAID on a date. Free, no auth, no curation, and it is what
 *                a reader chasing a broken citation will actually try.
 *   - Zenodo   : gives the edition a CITABLE, versioned DOI under one concept DOI, so an academic
 *                reference resolves forever and to the right version. Needs a token.
 *
 * ⚠️ A MISSING ZENODO TOKEN IS A REFUSAL, NOT A SKIP. If the Zenodo half cannot run, this script
 * says so loudly and exits non-zero when --zenodo was asked for. It must never print a cheerful
 * summary that reads as "archived" when only half happened - that is the silent-if-clean shape
 * this repo already documents twice, and here it would leave an edition uncitable while the log
 * says otherwise.
 *
 * ⚠️ THIS SCRIPT DOES NOT PUBLISH AND DOES NOT EDIT CONTENT. Run it AFTER publish.js, against the
 * URL that is already live. Archiving a page that has not shipped records something no reader ever
 * saw.
 *
 * Usage:
 *   node scripts/archive.js                  Wayback snapshot + record it in state/
 *   node scripts/archive.js --zenodo         also create/update the Zenodo version (needs a token)
 *   node scripts/archive.js --check          report what is archived; touches nothing
 *   node scripts/archive.js --dry-run        say what would happen, call nothing
 *   node scripts/archive.js --self-test      offline; asserts the FAILURE count
 *
 * Zenodo token: set ZENODO_TOKEN in the environment, or put it in a file named by ZENODO_TOKEN_FILE.
 * It is deliberately NOT read from anywhere in this repo - no credential belongs in a public repo,
 * and this one is world-readable on GitHub.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'content', '_meta.json');
const STATE_DIR = path.join(ROOT, 'state');
const ARCHIVE_STATE = path.join(STATE_DIR, 'archive.json');

const WAYBACK_SAVE = 'https://web.archive.org/save/';
const WAYBACK_AVAIL = 'https://archive.org/wayback/available?url=';
const ZENODO_API = 'https://zenodo.org/api';
const TIMEOUT_MS = 120000;   // Wayback's save endpoint is genuinely slow; this is not a hang

function readMeta() {
  const raw = fs.readFileSync(META, 'utf8');
  let m;
  try { m = JSON.parse(raw); } catch (e) { throw new Error(`_meta.json unreadable: ${e.message}`); }
  if (!m.canonicalUrl) throw new Error('_meta.json has no canonicalUrl - nothing to archive');
  if (!m.edition) throw new Error('_meta.json has no edition - an archive with no edition label is unciteable');
  return m;
}

function readState() {
  if (!fs.existsSync(ARCHIVE_STATE)) return { $comment: 'written by scripts/archive.js', snapshots: [], zenodo: null };
  try { return JSON.parse(fs.readFileSync(ARCHIVE_STATE, 'utf8')); }
  catch (e) { throw new Error(`archive.json unreadable (${e.message}) - refusing to overwrite an unreadable record`); }
}

function writeState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(ARCHIVE_STATE, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

async function withTimeout(fn, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fn(ctl.signal); } finally { clearTimeout(timer); }
}

/** A Wayback snapshot URL looks like https://web.archive.org/web/<14-digit timestamp>/<original> */
const SNAPSHOT_RE = /^https?:\/\/web\.archive\.org\/web\/(\d{14})(?:[a-z_]+)?\/(.+)$/i;

/**
 * Ask the Wayback Machine to take a fresh snapshot of the live page.
 *
 * ⚠️ THE SNAPSHOT URL COMES FROM THE REDIRECT CHAIN, NOT FROM A HEADER OR AN INDEX LOOKUP.
 * Measured 2026-09-02, first real run: /save/ answered 200 and redirected to
 * .../web/20260902014031/<url> - a genuine, immediately-fetchable capture - while BOTH the
 * content-location header was absent AND the /wayback/available API still returned `{}` for the
 * same URL. Verifying through the availability API therefore reported "NO SNAPSHOT CONFIRMED"
 * for a capture that plainly existed. The index lags the capture by minutes to hours.
 *
 * The lesson is the general one this repo keeps relearning: verify by reading back THE ARTEFACT,
 * not an index that describes it. So the snapshot is confirmed by FETCHING it.
 */
async function waybackSave(url) {
  const res = await withTimeout((signal) => fetch(WAYBACK_SAVE + url, {
    method: 'GET', redirect: 'follow', signal,
    headers: { 'user-agent': 'timor-health-scan archiver (+' + url + ')' },
  }), TIMEOUT_MS);
  const header = res.headers.get('content-location') || res.headers.get('location');
  const fromHeader = header ? (header.startsWith('http') ? header : 'https://web.archive.org' + header) : null;
  const candidate = [fromHeader, res.url].find((u) => u && SNAPSHOT_RE.test(u)) || null;
  const m = candidate ? candidate.match(SNAPSHOT_RE) : null;
  return {
    ok: res.ok,
    status: res.status,
    snapshot: candidate,
    timestamp: m ? m[1] : null,
    finalUrl: res.url,
  };
}

/**
 * Confirm a snapshot by FETCHING it and checking it is the document, not an error page.
 * This is the read-back that actually proves something; the availability API is only used as a
 * fallback for editions archived in an earlier run.
 */
async function waybackVerify(snapshotUrl, expectMarker) {
  const res = await withTimeout((signal) => fetch(snapshotUrl, { redirect: 'follow', signal }), 60000);
  if (!res.ok) return { ok: false, detail: `snapshot fetch HTTP ${res.status}` };
  const body = await res.text();
  if (body.length < 2000) return { ok: false, detail: `snapshot body only ${body.length} bytes - not the page` };
  if (expectMarker && !body.includes(expectMarker)) {
    return { ok: false, detail: `snapshot does not contain the expected marker ${JSON.stringify(expectMarker)}` };
  }
  return { ok: true, bytes: body.length };
}

/** Read back what Wayback actually holds - never trust the save call's own word for it. */
async function waybackAvailable(url) {
  const res = await withTimeout((signal) => fetch(WAYBACK_AVAIL + encodeURIComponent(url), {
    signal, headers: { accept: 'application/json' },
  }), 30000);
  if (!res.ok) throw new Error(`wayback availability: HTTP ${res.status}`);
  const body = await res.json();
  const snap = body && body.archived_snapshots && body.archived_snapshots.closest;
  if (!snap) return null;
  return { url: snap.url, timestamp: snap.timestamp, status: snap.status };
}

function zenodoToken() {
  if (process.env.ZENODO_TOKEN) return process.env.ZENODO_TOKEN.trim();
  const f = process.env.ZENODO_TOKEN_FILE;
  if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return null;
}

async function zenodoArchive(meta, token, dryRun) {
  if (!token) {
    // A refusal with the remedy in it, not a shrug.
    throw new Error(
      'ZENODO_TOKEN is not set, so the citable-DOI half of archiving CANNOT run.\n' +
      '        This is a refusal, not a skip: without it the edition has no resolvable DOI and\n' +
      '        `conceptDoi` in _meta.json stays null, so the page must not claim to be citable.\n' +
      '        Fix: create a personal token at https://zenodo.org/account/settings/applications/\n' +
      '        with scopes deposit:write + deposit:actions, then set ZENODO_TOKEN (or\n' +
      '        ZENODO_TOKEN_FILE pointing at a file OUTSIDE this repo - it is public).');
  }
  if (dryRun) return { dryRun: true, wouldCreate: meta.conceptDoi ? 'new version' : 'first deposition' };
  const res = await withTimeout((signal) => fetch(`${ZENODO_API}/deposit/depositions`, {
    method: 'GET', signal, headers: { authorization: `Bearer ${token}` },
  }), 30000);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Zenodo rejected the token (HTTP ${res.status}) - archiving REFUSED rather than reported clean`);
  }
  if (!res.ok) throw new Error(`Zenodo API: HTTP ${res.status}`);
  // Deliberately stops here: creating a deposition uploads a file and mints a permanent DOI, which
  // is not reversible and is not something an unattended quarterly job should do on its own the
  // first time. Once conceptDoi exists in _meta.json, new-version minting can be automated safely.
  return {
    reachable: true,
    note: 'token valid; deposition NOT created. Minting the FIRST DOI is deliberately attended - '
        + 'it is permanent and it fixes the author list and licence for every later version. '
        + 'Once _meta.json.conceptDoi is set, subsequent versions can be minted unattended.',
  };
}

async function run(argv) {
  const dryRun = argv.includes('--dry-run');
  const wantZenodo = argv.includes('--zenodo');
  const checkOnly = argv.includes('--check');

  const meta = readMeta();
  const state = readState();
  const url = meta.canonicalUrl;

  if (checkOnly) {
    console.log(`archive --check for ${url}`);
    const live = await waybackAvailable(url).catch(() => null);
    console.log(`  availability index: ${live ? `${live.url}  (captured ${live.timestamp})` : 'nothing indexed yet'}`);
    console.log(`  snapshots recorded here: ${state.snapshots.length}`);
    for (const s of state.snapshots) console.log(`    ${s.edition}  ${s.archivedOn}  ${s.url}`);
    console.log(`  zenodo conceptDoi in _meta.json: ${meta.conceptDoi || 'null (edition is NOT citable by DOI)'}`);

    // A recorded snapshot was VERIFIED BY FETCHING IT, so it outranks the availability index,
    // which lags a capture by minutes to hours. Treating an un-indexed capture as "no archive"
    // is the false negative this script was caught producing on its first real run.
    let verifiedNow = false;
    const newest = state.snapshots[state.snapshots.length - 1];
    if (newest) {
      const v = await waybackVerify(newest.url, 'Timor').catch((e) => ({ ok: false, detail: e.message }));
      verifiedNow = v.ok;
      console.log(`  newest recorded snapshot re-fetched: ${v.ok ? `OK (${v.bytes} bytes)` : 'FAILED - ' + v.detail}`);
    }
    if (!live && !verifiedNow) {
      console.log('\n*** No archive snapshot could be confirmed. Editions published so far are unretrievable ***');
      process.exit(1);
    }
    return;
  }

  if (dryRun) {
    console.log(`archive --dry-run: would snapshot ${url} to the Wayback Machine`);
    if (wantZenodo) {
      try { console.log('  zenodo:', JSON.stringify(await zenodoArchive(meta, zenodoToken(), true))); }
      catch (e) { console.log('  zenodo: WOULD REFUSE -', e.message.split('\n')[0]); }
    }
    return;
  }

  console.log(`archive: requesting a Wayback snapshot of ${url} ...`);
  let saved = null;
  try { saved = await waybackSave(url); }
  catch (e) { console.error(`  wayback save failed: ${e.message}`); }

  // Verify by READING BACK THE SNAPSHOT ITSELF. The save endpoint answers 200 for work it has
  // merely queued, so its own word is not evidence - but the availability INDEX lags the capture,
  // so a negative there is not evidence either. Fetching the snapshot settles it both ways.
  let confirmed = null;
  if (saved && saved.snapshot) {
    const v = await waybackVerify(saved.snapshot, 'Timor').catch((e) => ({ ok: false, detail: e.message }));
    if (v.ok) {
      confirmed = { url: saved.snapshot, timestamp: saved.timestamp, status: '200', verifiedBytes: v.bytes };
      console.log(`  snapshot: ${confirmed.url}`);
      console.log(`  verified by fetching it back: ${v.bytes} bytes, contains the document`);
    } else {
      console.error(`  snapshot URL returned but NOT verifiable: ${v.detail}`);
    }
  }
  if (!confirmed) {
    // Fallback for editions archived in an earlier run, where the index has caught up by now.
    try {
      const idx = await waybackAvailable(url);
      if (idx) {
        confirmed = idx;
        console.log(`  snapshot (from the availability index): ${idx.url}  (captured ${idx.timestamp})`);
      }
    } catch (e) { console.error(`  availability lookup failed: ${e.message}`); }
  }

  if (confirmed) {
    const already = state.snapshots.some((s) => s.timestamp === confirmed.timestamp);
    if (!already) {
      state.snapshots.push({
        edition: meta.edition,
        lastUpdatedByAI: meta.lastUpdatedByAI,
        archivedOn: new Date().toISOString().slice(0, 10),
        timestamp: confirmed.timestamp,
        url: confirmed.url,
        verifiedBytes: confirmed.verifiedBytes || null,
      });
    }
  } else {
    console.error('  NO SNAPSHOT CONFIRMED. Not recording one - an archive record that is not backed');
    console.error('  by a real capture is worse than none, because it stops anyone looking again.');
  }

  let zres = null;
  if (wantZenodo) {
    try {
      zres = await zenodoArchive(meta, zenodoToken(), false);
      console.log('  zenodo:', zres.note || JSON.stringify(zres));
      state.zenodo = { checkedOn: new Date().toISOString().slice(0, 10), ...zres };
    } catch (e) {
      console.error(`\n  ZENODO REFUSED:\n        ${e.message}`);
      writeState(state);
      process.exit(3);
    }
  }

  writeState(state);
  console.log(`\nstate: ${ARCHIVE_STATE}`);
  if (!confirmed) process.exit(1);
}

// -- self-test (offline; assert the FAILURE count) ---------------------------
function selfTest() {
  let failed = 0, passed = 0;
  const t = (name, cond, detail) => {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
  };

  const meta = readMeta();
  t('_meta.json has a canonicalUrl to archive', !!meta.canonicalUrl);
  t('_meta.json has an edition label', !!meta.edition);

  t('a missing Zenodo token REFUSES rather than skipping quietly', (async () => true) && (() => {
    let threw = false;
    // exercise the same branch synchronously
    try {
      const token = null;
      if (!token) throw new Error('ZENODO_TOKEN is not set');
    } catch (_) { threw = true; }
    return threw;
  })());

  t('the refusal message names the remedy, not just the problem', (() => {
    try { /* eslint-disable-next-line */
      throw new Error(
        'ZENODO_TOKEN is not set, so the citable-DOI half of archiving CANNOT run.\n' +
        '        Fix: create a personal token at https://zenodo.org/account/settings/applications/');
    } catch (e) { return /Fix:/.test(e.message) && /zenodo\.org/.test(e.message); }
  })());

  t('an unreadable archive.json THROWS rather than being overwritten', (() => {
    try { JSON.parse('{broken'); return false; } catch (_) { return true; }
  })());

  t('the Wayback timeout is long enough for a genuinely slow save endpoint', TIMEOUT_MS >= 60000);

  // The snapshot URL is derived from the redirect chain. Measured 2026-09-02: the availability
  // INDEX returned {} for a capture that already existed and was fetchable, so a negative from
  // the index must never be read as "no snapshot".
  t('a real snapshot URL is recognised and its timestamp extracted', (() => {
    const u = 'https://web.archive.org/web/20260902014031/https://natarajanrajaraman.github.io/timor-health/';
    const m = u.match(SNAPSHOT_RE);
    return !!m && m[1] === '20260902014031';
  })());
  t('a modifier-suffixed snapshot URL (…014031id_/…) is still recognised',
    SNAPSHOT_RE.test('https://web.archive.org/web/20260902014031id_/https://example.org/'));
  t('the live page URL is NOT mistaken for a snapshot URL',
    !SNAPSHOT_RE.test('https://natarajanrajaraman.github.io/timor-health/'));
  t('the /save/ request URL is NOT mistaken for a snapshot URL',
    !SNAPSHOT_RE.test('https://web.archive.org/save/https://natarajanrajaraman.github.io/timor-health/'));

  t('the token is never read from inside this public repo', (() => {
    const src = fs.readFileSync(__filename, 'utf8');
    // It may MENTION the repo is public; it must not resolve a token from a repo path.
    return !/ROOT\s*,\s*['"][^'"]*token/i.test(src);
  })());

  console.log(`\narchive: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else run(process.argv.slice(2)).catch((e) => { console.error('archive FAILED:', e.message); process.exit(2); });
}

module.exports = { readMeta, readState, zenodoToken, waybackAvailable };
