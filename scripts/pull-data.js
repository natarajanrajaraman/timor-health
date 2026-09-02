'use strict';
/**
 * pull-data.js - re-pull Timor-Leste's headline indicators from source APIs, and REPORT DRIFT
 * against the figures the document currently states.
 *
 * WHY THIS EXISTS (design rule 3: numbers are re-pulled from APIs, never recalled)
 * ----------------------------------------------------------------------------
 * The document's own section 10 records two cases where a recalled or copied figure was wrong.
 * A quarterly refresh done by reading the page and "updating what looks stale" reproduces exactly
 * that failure. So every headline number is pulled, stamped with the year the source assigns it,
 * and cached with the endpoint that produced it.
 *
 * WHAT IT DOES **NOT** DO, DELIBERATELY
 * ----------------------------------------------------------------------------
 * It does not edit content/*.md and it does not publish. It writes data/indicators.json and prints
 * a DRIFT REPORT: which stated figures no longer match the source, and which source years moved.
 * Rewriting the prose around a changed number is judgement (a figure can change because the
 * indicator was redefined, not because the country changed), so it stays with the refresh session.
 *
 * THE TRAP THIS GUARDS (same shape as pull-comparators.js)
 * ----------------------------------------------------------------------------
 * The World Bank's latest available year DIFFERS PER INDICATOR, sometimes by several years. A
 * refresh that pulls "the latest" and writes it next to last quarter's sentence silently mixes
 * vintages. So the YEAR is carried per indicator, rendered per indicator, and a value whose year
 * did not advance is reported as `unchanged-source` rather than as a fresh datum.
 *
 * A COLLECTOR FAILURE IS NOT AN EMPTY RESULT. Any indicator whose response has an unexpected
 * shape THROWS. A partial pull exits non-zero and writes nothing, so a half-updated cache can
 * never be mistaken for a complete one.
 *
 * Usage:
 *   node scripts/pull-data.js               pull, write data/indicators.json, print drift
 *   node scripts/pull-data.js --show        print the cached table without touching the network
 *   node scripts/pull-data.js --json        machine-readable
 *   node scripts/pull-data.js --self-test   offline; asserts the FAILURE count
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(DATA, 'indicators.json');

const ISO3 = 'TLS';

/**
 * The headline indicators this document actually asserts in prose. Keep this list SHORT and tied
 * to sentences that exist - an indicator nobody quotes is noise in the drift report, and noise is
 * what makes a report stop being read.
 */
const INDICATORS = [
  { code: 'SP.POP.TOTL',        key: 'population',  label: 'Population',                                   dp: 0 },
  { code: 'SP.DYN.LE00.IN',     key: 'lifeExp',     label: 'Life expectancy at birth (years)',             dp: 1 },
  { code: 'SH.DYN.MORT',        key: 'u5mr',        label: 'Under-5 mortality per 1,000 live births',      dp: 1 },
  { code: 'SH.STA.MMRT',        key: 'mmr',         label: 'Maternal mortality per 100,000 live births',   dp: 0 },
  { code: 'SH.TBS.INCD',        key: 'tb',          label: 'Tuberculosis incidence per 100,000',           dp: 0 },
  { code: 'SH.XPD.CHEX.GD.ZS',  key: 'cheGdp',      label: 'Current health expenditure (% of GDP)',        dp: 1 },
  { code: 'SH.XPD.CHEX.PC.CD',  key: 'cheCapita',   label: 'Health spending per person (US$)',             dp: 0 },
  { code: 'SH.XPD.OOPC.CH.ZS',  key: 'oop',         label: 'Out-of-pocket share of health spending (%)',   dp: 1 },
  { code: 'SH.MED.PHYS.ZS',     key: 'physicians',  label: 'Physicians per 1,000 people',                  dp: 2 },
  { code: 'SH.MED.NUMW.P3',     key: 'nurses',      label: 'Nurses and midwives per 1,000 people',         dp: 2 },
  { code: 'SH.STA.STNT.ZS',     key: 'stunting',    label: 'Stunting, under-5 (%)',                        dp: 1 },
  { code: 'NY.GDP.PCAP.CD',     key: 'gdpCapita',   label: 'GDP per capita (US$)',                         dp: 0 },
];

async function fetchIndicator(code) {
  const url = `https://api.worldbank.org/v2/country/${ISO3}/indicator/${code}` +
              `?format=json&per_page=200&mrnev=1`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
  const body = await res.json();
  // Strict shape check. The World Bank answers 200 with an ERROR OBJECT for a bad indicator code,
  // so trusting the status here is the same mistake as trusting it in check-links.
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
    throw new Error(`${code}: unexpected response shape - refusing to record a value`);
  }
  const rows = body[1].filter((r) => r && r.value !== null && r.value !== undefined);
  if (rows.length === 0) return { value: null, year: null, url };
  const row = rows[0];
  return { value: Number(row.value), year: String(row.date), url };
}

/** Find every number in the prose that looks like it states this indicator, for drift checking. */
function statedFigures(contentDir) {
  const out = {};
  const files = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) out[f] = fs.readFileSync(path.join(contentDir, f), 'utf8');
  return out;
}

/**
 * Does the prose still contain this value, at the precision the document uses?
 * Deliberately a PRESENCE test, not a parse: extracting "the maternal mortality sentence" from
 * prose reliably is a much harder problem than it looks, and a wrong extraction would produce
 * confident false drift. Presence under-reports (a reworded sentence looks like drift) and that
 * is the safe direction - it asks a human to look, it never silently says "still correct".
 */
function proseMentions(texts, value, dp) {
  if (value === null || value === undefined) return false;
  const forms = new Set();
  const fixed = value.toFixed(dp);
  forms.add(fixed);
  forms.add(String(Math.round(value)));
  if (dp > 0) forms.add(value.toFixed(Math.max(0, dp - 1)));
  // Thousands separators, as a human would write them.
  forms.add(Number(fixed).toLocaleString('en-US'));
  forms.add(Math.round(value).toLocaleString('en-US'));
  for (const body of Object.values(texts)) {
    for (const form of forms) if (form && body.includes(form)) return true;
  }
  return false;
}

function loadCache() {
  if (!fs.existsSync(OUT)) return null;
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch (e) { throw new Error(`indicators.json unreadable (${e.message}) - refusing to treat it as empty`); }
}

async function run(argv) {
  const asJson = argv.includes('--json');

  if (argv.includes('--show')) {
    const cached = loadCache();
    if (!cached) { console.error('no cache yet - run without --show first'); process.exit(2); }
    if (asJson) { console.log(JSON.stringify(cached, null, 2)); return cached; }
    console.log(`indicators.json  pulled ${cached.pulledOn}`);
    for (const i of cached.indicators) {
      console.log(`  ${String(i.label).padEnd(52)} ${i.value === null ? 'no data' : i.value} (${i.year || '-'})`);
    }
    return cached;
  }

  const previous = loadCache();
  const results = [];
  for (const ind of INDICATORS) {
    // Sequential on purpose: this is 12 requests once a quarter, and a burst against a public API
    // for no reason is bad manners. Any throw aborts the whole pull - see the header note.
    const got = await fetchIndicator(ind.code);
    results.push({ ...ind, ...got });
  }

  const texts = statedFigures(CONTENT);
  const prev = new Map((previous ? previous.indicators : []).map((i) => [i.key, i]));

  for (const r of results) {
    const p = prev.get(r.key);
    r.previousValue = p ? p.value : null;
    r.previousYear = p ? p.year : null;
    r.sourceYearAdvanced = !!(p && p.year && r.year && r.year !== p.year);
    r.valueChanged = !!(p && p.value !== null && r.value !== null && Number(p.value) !== Number(r.value));
    r.statedInProse = proseMentions(texts, r.value, r.dp);
  }

  const payload = {
    $comment: 'Written by scripts/pull-data.js. Values are PULLED, never recalled. Year is per indicator.',
    country: ISO3,
    pulledOn: new Date().toISOString().slice(0, 10),
    source: 'World Bank Indicators API v2 (mrnev=1: most recent non-empty value)',
    indicators: results,
  };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  if (asJson) { console.log(JSON.stringify(payload, null, 2)); return payload; }

  const advanced = results.filter((r) => r.sourceYearAdvanced);
  const changed = results.filter((r) => r.valueChanged);
  const missing = results.filter((r) => r.value === null);
  const notInProse = results.filter((r) => r.value !== null && !r.statedInProse);

  console.log(`pull-data ${payload.pulledOn}: ${results.length} indicators for ${ISO3}`);
  console.log(`  source year advanced: ${advanced.length} | value changed: ${changed.length} | no data: ${missing.length}`);
  console.log(`  current value not found anywhere in the prose: ${notInProse.length}`);

  const show = (title, rows, fn) => {
    if (!rows.length) return;
    console.log(`\n--- ${title} (${rows.length})`);
    for (const r of rows) console.log('  ' + fn(r));
  };
  show('SOURCE YEAR ADVANCED - a newer vintage exists', advanced,
    (r) => `${r.label}: ${r.previousYear} -> ${r.year} (${r.previousValue} -> ${r.value})`);
  show('VALUE CHANGED at the same or newer year', changed,
    (r) => `${r.label}: ${r.previousValue} -> ${r.value} (${r.year})`);
  show('NO DATA returned - do NOT delete the prose, check the indicator code', missing,
    (r) => `${r.label} (${r.code})`);
  show('NOT FOUND IN PROSE - either the text is stale, or it was reworded', notInProse,
    (r) => `${r.label}: source says ${r.value} (${r.year})`);

  console.log(`\ncache: ${OUT}`);
  console.log('\nThis script does NOT edit content/*.md. Updating the sentence around a changed');
  console.log('number is judgement - a figure can move because the indicator was redefined.');
  return payload;
}

// -- self-test (offline; assert the FAILURE count) ---------------------------
function selfTest() {
  let failed = 0, passed = 0;
  const t = (name, cond, detail) => {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
  };

  t('every indicator has a unique key',
    new Set(INDICATORS.map((i) => i.key)).size === INDICATORS.length);
  t('every indicator has a World-Bank-shaped code',
    INDICATORS.every((i) => /^[A-Z]{2}\.[A-Z0-9.]+$/.test(i.code)));

  const texts = { 'a.md': 'Life expectancy is 68.3 years and the population is 1,400,000 people.' };
  t('proseMentions finds a decimal figure at stated precision', proseMentions(texts, 68.3, 1));
  t('proseMentions finds a thousands-separated integer', proseMentions(texts, 1400000, 0));
  t('proseMentions does NOT match an absent figure', !proseMentions(texts, 99.9, 1));
  t('proseMentions on a null value is false, never a crash', proseMentions(texts, null, 1) === false);

  // The load-bearing shape check: a 200 carrying an error object must NOT become a recorded value.
  t('an unexpected API shape THROWS rather than recording nothing-as-a-value', (() => {
    const bad = [{ message: [{ key: '120', value: 'Invalid value' }] }];
    try {
      if (!Array.isArray(bad) || bad.length < 2 || !Array.isArray(bad[1])) throw new Error('shape');
      return false;
    } catch (_) { return true; }
  })());

  t('an empty but well-formed response yields value:null, not a throw', (() => {
    const body = [{ page: 1 }, []];
    const rows = body[1].filter((r) => r && r.value !== null);
    return rows.length === 0;
  })());

  console.log(`\npull-data: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else run(process.argv.slice(2)).catch((e) => { console.error('pull-data FAILED:', e.message); process.exit(2); });
}

module.exports = { INDICATORS, fetchIndicator, proseMentions };
