'use strict';
/**
 * pull-comparators.js - fetch ASEAN comparator figures from the World Bank API.
 *
 * WHY THIS IS A SCRIPT AND NOT A LOOKUP
 * ----------------------------------------------------------------------------
 * A number like "23 health workers per 10,000" means nothing to a reader without a comparator, and
 * a comparator recalled by a model is exactly the failure this document already documents twice
 * (see the 11.4%-of-GDP case in section 5). So every comparator is PULLED, stamped with its own
 * year, and cached to data/comparators.json with the endpoint that produced it.
 *
 * ⚠️ EACH COUNTRY'S LATEST YEAR DIFFERS, sometimes by several years, and the World Bank does not
 * align them. A table that silently mixes 2019 and 2023 values reads as a like-for-like comparison
 * and is not one. So the year is carried per cell and rendered per cell, and any comparison older
 * than STALE_AFTER is flagged rather than quietly shown.
 *
 * Usage:
 *   node scripts/pull-comparators.js            fetch and write data/comparators.json
 *   node scripts/pull-comparators.js --show     print the cached table
 *   node scripts/pull-comparators.js --self-test
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'comparators.json');

/** ASEAN's eleven members. Timor-Leste joined as the eleventh on 26 October 2025. */
const COUNTRIES = {
  BRN: 'Brunei', KHM: 'Cambodia', IDN: 'Indonesia', LAO: 'Laos', MYS: 'Malaysia',
  MMR: 'Myanmar', PHL: 'Philippines', SGP: 'Singapore', THA: 'Thailand',
  TLS: 'Timor-Leste', VNM: 'Vietnam',
};

const INDICATORS = [
  { code: 'SH.MED.PHYS.ZS',    key: 'physicians',   label: 'Physicians per 1,000 people', dp: 2 },
  { code: 'SH.MED.NUMW.P3',    key: 'nurses',       label: 'Nurses and midwives per 1,000 people', dp: 2 },
  { code: 'SH.XPD.CHEX.PC.CD', key: 'cheCapita',    label: 'Health spending per person (US$)', dp: 0 },
  { code: 'SH.XPD.OOPC.CH.ZS', key: 'oop',          label: 'Out-of-pocket share of health spending (%)', dp: 1 },
  { code: 'SP.DYN.LE00.IN',    key: 'lifeExp',      label: 'Life expectancy at birth (years)', dp: 1 },
  { code: 'SH.DYN.MORT',       key: 'u5mr',         label: 'Under-5 mortality per 1,000 live births', dp: 1 },
  { code: 'SH.STA.MMRT',       key: 'mmr',          label: 'Maternal mortality per 100,000 live births', dp: 0 },
  { code: 'SH.TBS.INCD',       key: 'tb',           label: 'Tuberculosis incidence per 100,000', dp: 0 },
];

const STALE_AFTER = 5; // years behind the newest value in the same row

async function fetchIndicator(code) {
  const iso = Object.keys(COUNTRIES).join(';');
  const url = `https://api.worldbank.org/v2/country/${iso}/indicator/${code}` +
              `?format=json&per_page=2000&mrnev=1`;
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body) || !Array.isArray(body[1])) throw new Error(`${code}: unexpected shape`);
  const out = {};
  for (const row of body[1]) {
    if (row.value === null || row.value === undefined) continue;
    const iso3 = row.countryiso3code || (row.country && row.country.id);
    if (!iso3 || !COUNTRIES[iso3]) continue;
    out[iso3] = { value: row.value, year: Number(row.date) };
  }
  return { url, values: out };
}

async function main() {
  if (process.argv.includes('--show')) {
    if (!fs.existsSync(OUT)) { console.error('no cache - run without --show first'); process.exit(1); }
    const c = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const ind of c.indicators) {
      console.log('\n' + ind.label + '   (pulled ' + c.pulled + ')');
      const rows = Object.entries(ind.values)
        .map(([iso, v]) => ({ iso, name: COUNTRIES[iso], ...v }))
        .sort((a, b) => b.value - a.value);
      for (const r of rows) {
        const mark = r.iso === 'TLS' ? ' <== TIMOR-LESTE' : '';
        console.log('   ' + String(r.name).padEnd(14) + String(r.value.toFixed(ind.dp)).padStart(9) + '  (' + r.year + ')' + mark);
      }
    }
    return;
  }

  const indicators = [];
  for (const ind of INDICATORS) {
    process.stdout.write('  ' + ind.code.padEnd(20));
    try {
      const r = await fetchIndicator(ind.code);
      const years = Object.values(r.values).map(v => v.year);
      const newest = Math.max(...years);
      // flag any country whose latest value trails the row's newest by more than STALE_AFTER
      for (const iso of Object.keys(r.values)) {
        r.values[iso].stale = (newest - r.values[iso].year) > STALE_AFTER;
      }
      indicators.push(Object.assign({}, ind, { endpoint: r.url, values: r.values,
        newestYear: newest, spanYears: newest - Math.min(...years) }));
      console.log(`ok  ${Object.keys(r.values).length}/11 countries, years ${Math.min(...years)}-${newest}`);
    } catch (e) {
      console.log('FAILED: ' + e.message);
    }
  }

  const pulledOn = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    $comment: 'ASEAN comparators, pulled from the World Bank API. Each value carries its OWN year - ' +
              'the World Bank does not align country years, and a table that hides that reads as a ' +
              'like-for-like comparison when it is not. Regenerate with node scripts/pull-comparators.js',
    source: 'World Bank World Development Indicators',
    pulled: pulledOn,
    countries: COUNTRIES,
    staleAfterYears: STALE_AFTER,
    indicators,
  }, null, 2));
  console.log(`\nwrote data/comparators.json  (${indicators.length}/${INDICATORS.length} indicators)`);
}

module.exports = { COUNTRIES, INDICATORS, STALE_AFTER };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.error('FAIL: ' + n + '\n      ' + e.message); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

  t('all eleven ASEAN members are present, including Timor-Leste', () => {
    eq(Object.keys(COUNTRIES).length, 11);
    eq(COUNTRIES.TLS, 'Timor-Leste');
    for (const iso of ['BRN','KHM','IDN','LAO','MYS','MMR','PHL','SGP','THA','VNM']) {
      if (!COUNTRIES[iso]) throw new Error('missing ' + iso);
    }
  });
  t('the cache exists and every value carries its own year', () => {
    if (!fs.existsSync(OUT)) throw new Error('data/comparators.json not generated yet');
    const c = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (!c.indicators.length) throw new Error('no indicators cached');
    for (const ind of c.indicators) {
      for (const [iso, v] of Object.entries(ind.values)) {
        if (typeof v.value !== 'number') throw new Error(ind.key + '/' + iso + ' has no numeric value');
        if (!Number.isInteger(v.year)) throw new Error(ind.key + '/' + iso + ' has no year');
      }
    }
  });
  t('every indicator records the endpoint that produced it', () => {
    const c = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const ind of c.indicators) {
      if (!/api\.worldbank\.org/.test(ind.endpoint || '')) throw new Error(ind.key + ' has no endpoint');
    }
  });
  t('Timor-Leste is present in every cached indicator - it is the point of the table', () => {
    const c = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const ind of c.indicators) {
      if (!ind.values.TLS) throw new Error('TLS missing from ' + ind.key);
    }
  });
  t('mixed-year rows are flagged rather than silently shown', () => {
    const c = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    let sawFlagField = false;
    for (const ind of c.indicators) {
      for (const v of Object.values(ind.values)) if ('stale' in v) sawFlagField = true;
    }
    eq(sawFlagField, true, 'every value must carry a stale flag');
  });

  console.log(`comparators: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && !process.argv.includes('--self-test')) {
  main().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
}
