'use strict';
/**
 * build.js - content/*.md  ->  docs/index.html (one self-contained file)
 *
 * Deterministic. No network, no LLM, no dependencies. Safe to run at any time; running it twice
 * with the same inputs produces byte-identical output except for the build stamp, which is why
 * --check can diff it in CI or in a pre-publish gate.
 *
 * The disclosure banner and every freshness stamp are GENERATED from content/_meta.json. They are
 * never authored in a content file, because a sentence a human has to remember to update is a
 * sentence that will eventually be false - and on this document the disclosure being false is the
 * one failure that discredits everything else.
 *
 * Usage:
 *   node scripts/build.js              build to docs/index.html
 *   node scripts/build.js --check      build to memory and fail if docs/index.html differs
 *   node scripts/build.js --self-test  run assertions
 */

const fs = require('fs');
const path = require('path');
const meta = require('./lib/meta');
const md = require('./lib/md');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const DOCS = path.join(ROOT, 'docs');
const DATA = path.join(ROOT, 'data');

const esc = md.escapeHtml;

/* ---------------------------------------------------------------- page chrome */

function css() {
  return `
:root{
  --bg:#ffffff; --fg:#1a1c1e; --muted:#5a6169; --rule:#e3e6ea; --accent:#0b5c8a;
  --card:#f6f8fa; --code-bg:#f2f4f7;
  --warn-bg:#fff6e5; --warn-fg:#6b4700; --warn-rule:#e0a83a;
  --alarm-bg:#fdecec; --alarm-fg:#7a1f1f; --alarm-rule:#d05a5a;
  --ok-bg:#eef7f0; --ok-fg:#1f5130; --ok-rule:#69a97f;
  --maxw:52rem;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#14161a; --fg:#e6e8ea; --muted:#9aa3ad; --rule:#2b3038; --accent:#7fc2e8;
    --card:#1b1f25; --code-bg:#1e232a;
    --warn-bg:#2e2411; --warn-fg:#f0cf8a; --warn-rule:#8a6a1f;
    --alarm-bg:#331a1a; --alarm-fg:#f2b0b0; --alarm-rule:#8c3a3a;
    --ok-bg:#16261c; --ok-fg:#a9d9bb; --ok-rule:#3f7553;
  }
}
:root[data-theme="dark"]{
  --bg:#14161a; --fg:#e6e8ea; --muted:#9aa3ad; --rule:#2b3038; --accent:#7fc2e8;
  --card:#1b1f25; --code-bg:#1e232a;
  --warn-bg:#2e2411; --warn-fg:#f0cf8a; --warn-rule:#8a6a1f;
  --alarm-bg:#331a1a; --alarm-fg:#f2b0b0; --alarm-rule:#8c3a3a;
  --ok-bg:#16261c; --ok-fg:#a9d9bb; --ok-rule:#3f7553;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
.wrap{max-width:var(--maxw); margin:0 auto; padding:1.5rem 1.25rem 5rem}
h1,h2,h3,h4{line-height:1.25; font-weight:650}
h1{font-size:1.9rem; margin:0 0 .4rem}
h2{font-size:1.35rem; margin:2.6rem 0 .2rem; padding-top:1.2rem; border-top:1px solid var(--rule)}
h3{font-size:1.08rem; margin:1.6rem 0 .3rem}
h4{font-size:1rem; margin:1.2rem 0 .3rem; color:var(--muted)}
p{margin:.7rem 0}
a{color:var(--accent)}
code{background:var(--code-bg); padding:.1em .35em; border-radius:3px; font-size:.88em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre.code{background:var(--code-bg); padding:.85rem 1rem; border-radius:6px; overflow-x:auto; font-size:.85rem}
pre.code code{background:none; padding:0}
hr{border:0; border-top:1px solid var(--rule); margin:2rem 0}
blockquote{margin:1rem 0; padding:.1rem 1rem; border-left:3px solid var(--rule); color:var(--muted)}
ul,ol{padding-left:1.4rem} li{margin:.3rem 0}
img{max-width:100%; height:auto}

.table-wrap{overflow-x:auto; margin:1rem 0; border:1px solid var(--rule); border-radius:6px}
table{border-collapse:collapse; width:100%; font-size:.92rem}
th,td{padding:.5rem .7rem; border-bottom:1px solid var(--rule); text-align:left; vertical-align:top}
th{background:var(--card); font-weight:650; white-space:nowrap}
tbody tr:last-child td{border-bottom:0}

.eyebrow{font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 .5rem}
.sub{color:var(--muted); margin:.2rem 0 0}

.notice{border:1px solid var(--rule); border-left-width:4px; background:var(--card);
  padding:.85rem 1rem; border-radius:6px; margin:1.2rem 0}
.notice p{margin:.35rem 0}
.notice .n-head{font-weight:650}
.notice.sev-none{background:var(--ok-bg); color:var(--ok-fg); border-color:var(--ok-rule)}
.notice.sev-medium{background:var(--warn-bg); color:var(--warn-fg); border-color:var(--warn-rule)}
.notice.sev-high{background:var(--alarm-bg); color:var(--alarm-fg); border-color:var(--alarm-rule)}
.notice.sev-none a,.notice.sev-medium a,.notice.sev-high a{color:inherit}

.stamps{display:flex; flex-wrap:wrap; gap:.4rem .9rem; font-size:.82rem; color:var(--muted); margin:.5rem 0 0}
.stamp b{font-weight:600; color:var(--fg)}
.sec-stamp{font-size:.78rem; color:var(--muted); margin:.15rem 0 1rem}
.sec-stamp .flag{color:var(--warn-fg); background:var(--warn-bg); border:1px solid var(--warn-rule);
  padding:.05rem .4rem; border-radius:3px; margin-left:.3rem}

nav.toc{background:var(--card); border:1px solid var(--rule); border-radius:6px; padding:.9rem 1.1rem; margin:1.6rem 0}
nav.toc p{margin:0 0 .4rem; font-weight:650; font-size:.9rem}
nav.toc ol{margin:0; padding-left:1.3rem; font-size:.94rem}
nav.toc li{margin:.22rem 0}

footer{margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--rule); font-size:.88rem; color:var(--muted)}
.tetun{background:var(--card); border:1px solid var(--rule); border-radius:6px; padding:.2rem 1rem 1rem; margin:1.4rem 0}

@media print{
  .notice{border-left-width:2px}
  nav.toc{break-inside:avoid}
  h2{break-after:avoid}
  a[href^="http"]::after{content:" (" attr(href) ")"; font-size:.75em; color:#555; word-break:break-all}
  body{font-size:11pt}
}
@media (max-width:34rem){ h1{font-size:1.55rem} .wrap{padding:1rem .9rem 3rem} }
`.trim();
}

/**
 * The staleness banner is rendered CLIENT-SIDE from a build-stamped date, deliberately.
 * Every other freshness signal on this page depends on some automation still being alive. This one
 * does not: once published, the page keeps telling the reader how old it is even if the refresh
 * pipeline, the repo, and the author have all gone quiet. It is the last honest thing standing.
 */
function stalenessScript(m) {
  const r = m.refresh || {};
  return `
(function(){
  var updated=${JSON.stringify(m.lastUpdatedByAI)};
  var warn=${JSON.stringify(r.stalenessWarnDays || 120)}, alarm=${JSON.stringify(r.stalenessAlarmDays || 180)};
  var cadence=${JSON.stringify(r.cadenceDays || 90)};
  var el=document.getElementById('staleness');
  if(!el||!updated) return;
  var days=Math.floor((Date.now()-Date.parse(updated+'T00:00:00Z'))/86400000);
  if(days<warn){ el.style.display='none'; return; }
  var sev=days>=alarm?'sev-high':'sev-medium';
  el.className='notice '+sev;
  el.innerHTML='<p class="n-head">This page is '+days+' days old.</p>'+
    '<p>It is meant to be refreshed about every '+cadence+' days. It has not been, so treat the '+
    'figures and especially the contact details as out of date, and follow the citation to the '+
    'source before relying on anything here.</p>';
})();`.trim();
}

/* ---------------------------------------------------------------- assembly */

function buildHtml(m, sections, opts) {
  const o = opts || {};
  const today = o.today || meta.todaySGT();
  const disc = meta.disclosure(m, today);
  const stale = meta.staleness(m, today);

  const toc = sections.map(s =>
    `<li><a href="#sec-${esc(s.id)}">${esc(s.title)}</a></li>`).join('\n      ');

  const omitted = (m.omittedSections || []).filter(s => s.renderNotice).map(s => `
    <div class="notice">
      <p class="n-head">Section ${esc(s.id)} &mdash; ${esc(s.title)} &mdash; is deliberately not included.</p>
      <p>${esc(s.reason)}</p>
    </div>`).join('');

  const body = sections.map(s => {
    const st = meta.sectionState(s, m, today);
    const flag = (st === 'changed-since-review' || st === 'never-reviewed')
      ? `<span class="flag">${st === 'never-reviewed' ? 'not yet reviewed' : 'changed since review'}</span>` : '';
    const revTxt = s.lastReviewedByHuman ? `reviewed ${esc(s.lastReviewedByHuman)}` : 'not yet reviewed';
    return `
    <section id="sec-${esc(s.id)}">
      <h2>${esc(s.title)}</h2>
      <p class="sec-stamp">Text updated ${esc(s.lastUpdatedByAI || 'unknown')} &middot; ${revTxt}${flag}</p>
      ${s.html}
    </section>`;
  }).join('\n');

  const annex = {
    title: m.title, edition: m.edition, status: m.status,
    documentLanguage: m.documentLanguage,
    lastUpdatedByAI: m.lastUpdatedByAI,
    lastReviewedByHuman: m.lastReviewedByHuman,
    reviewState: disc.state,
    selfDescription: disc.selfDescription,
    conceptDoi: m.conceptDoi, canonicalUrl: m.canonicalUrl,
    refresh: m.refresh,
    sections: sections.map(s => ({
      id: s.id, title: s.title,
      lastUpdatedByAI: s.lastUpdatedByAI, lastReviewedByHuman: s.lastReviewedByHuman,
      state: meta.sectionState(s, m, today),
    })),
    omittedSections: m.omittedSections || [],
    generator: 'tl-health-scan build.js',
    builtOn: today,
  };

  const libApproved = m.referenceLibrary && m.referenceLibrary.linkApproved === true;
  const libLine = libApproved
    ? `<p><b>Document library:</b> <a href="${esc(m.referenceLibrary.url)}">${esc(m.referenceLibrary.name)}</a> &mdash; source documents referenced here, where they may be redistributed.</p>`
    : '';

  const corrLine = (m.corrections && m.corrections.formUrl)
    ? `<p><b>Something wrong on this page?</b> <a href="${esc(m.corrections.formUrl)}">Tell us here</a>. Corrections about your own organisation&rsquo;s entry are especially welcome, including a request not to be listed.</p>`
    : `<p><b>Corrections:</b> the correction form is not yet published for this prototype edition.</p>`;

  const related = m.relatedSite
    ? `<p><b>Practical guidance for visiting teams</b> &mdash; planning a visit, delivering teaching, Tetun language help &mdash; is maintained separately at <a href="${esc(m.relatedSite.url)}">${esc(m.relatedSite.name)}</a>. This document does not duplicate it.</p>`
    : '';

  return `<!doctype html>
<html lang="${esc(m.documentLanguage || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<meta name="description" content="An unofficial, AI-compiled, source-cited ${esc(disc.selfDescription)} of health and the health system of Timor-Leste. Edition ${esc(m.edition)}.">
<meta name="robots" content="index, follow">
<style>${css()}</style>
</head>
<body>
<div class="wrap">

<header>
  <p class="eyebrow">Unofficial &middot; AI-compiled &middot; Edition ${esc(m.edition)}</p>
  <h1>${esc(m.title)}</h1>
  <p class="sub">An orientation document for anyone considering or delivering health work in
  Timor-Leste. It is <b>not</b> an official document and carries no government, WHO or institutional
  sanction. Its purpose is to help you act in line with national priorities and avoid duplicating
  work others are already doing.</p>
  <div class="stamps">
    <span class="stamp">Text last updated by AI: <b>${esc(m.lastUpdatedByAI || 'unknown')}</b></span>
    <span class="stamp">Last reviewed by a human: <b>${esc(m.lastReviewedByHuman || 'never')}</b></span>
    <span class="stamp">Document language: <b>English</b></span>
  </div>
</header>

<div class="notice sev-${esc(disc.severity)}">
  <p class="n-head">${esc(disc.headline)}</p>
  <p>${esc(disc.detail)}</p>
</div>

<div id="staleness" class="notice" style="display:none"></div>

${omitted}

<nav class="toc" aria-label="Contents">
  <p>Contents</p>
  <ol>
      ${toc}
  </ol>
</nav>

${body}

<footer>
  ${related}
  ${libLine}
  ${corrLine}
  <p><b>How this document is made.</b> The text is drafted and updated by an AI agent from the
  sources cited in each section, and published by a deterministic script. ${
    m.reviewer && m.reviewer.named
      ? esc(m.reviewer.name) + ' is the named editor and takes editorial responsibility for reviewed editions.'
      : 'No named person reviews it.'
  } See the sources and method section above for exactly what was pulled, from where, and when.</p>
  <p>Edition ${esc(m.edition)}${m.conceptDoi ? ' &middot; DOI <a href="https://doi.org/' + esc(m.conceptDoi) + '">' + esc(m.conceptDoi) + '</a>' : ''} &middot; built ${esc(today)}.</p>
</footer>

</div>
<script type="application/json" id="annex">${JSON.stringify(annex).replace(/</g, '\\u003c')}</script>
<script>${stalenessScript(m)}</script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- driver */

function loadSections(m) {
  return m.sections.map(s => {
    const p = path.join(CONTENT, s.file);
    if (!fs.existsSync(p)) {
      if (s.required) throw new Error(`missing required content file: ${s.file}`);
      return null;
    }
    const raw = fs.readFileSync(p, 'utf8');
    if (s.required && raw.trim().length < 40) {
      throw new Error(`content file ${s.file} is effectively empty (${raw.trim().length} chars) but is marked required`);
    }
    // section files start their own headings at h3 - the h2 is the section title we emit
    const r = md.render(raw, { headingOffset: 2, slugPrefix: 's' + s.id });
    return Object.assign({}, s, { html: r.html, headings: r.headings });
  }).filter(Boolean);
}

function build(opts) {
  const o = opts || {};
  const m = meta.load(path.join(CONTENT, '_meta.json'), { today: o.today });
  const sections = loadSections(m);
  const html = buildHtml(m, sections, o);
  return { html, meta: m, sections };
}

function main() {
  const args = process.argv.slice(2);
  const out = path.join(DOCS, 'index.html');
  let r;
  try {
    r = build({});
  } catch (e) {
    console.error('BUILD FAILED: ' + e.message);
    process.exit(1);
  }

  if (args.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    const strip = s => s.replace(/built \d{4}-\d{2}-\d{2}/g, 'built DATE').replace(/"builtOn":"[^"]*"/g, '"builtOn":"DATE"');
    if (strip(cur) !== strip(r.html)) { console.error('docs/index.html is out of date - run: node scripts/build.js'); process.exit(1); }
    console.log('build --check: docs/index.html is current');
    return;
  }

  for (const w of (r.meta.__warnings || [])) console.log('  WARNING: ' + w);

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(out, r.html);
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  const words = r.sections.reduce((n, s) =>
    n + s.html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, 0);
  const disc = meta.disclosure(r.meta);
  console.log(`built docs/index.html`);
  console.log(`  edition      : ${r.meta.edition}`);
  console.log(`  sections     : ${r.sections.length}`);
  console.log(`  words        : ~${words}`);
  console.log(`  review state : ${disc.state}  (document calls itself: "${disc.selfDescription}")`);
  if (words < 6000) console.log(`  NOTE: target length is 6,000-12,000 words; currently ~${words}`);
}

module.exports = { build, buildHtml, loadSections };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL: ' + name + '\n      ' + e.message); } };
  const has = (h, n, m) => { if (!h.includes(n)) throw new Error((m || '') + ' expected to contain ' + JSON.stringify(n)); };
  const hasnt = (h, n, m) => { if (h.includes(n)) throw new Error((m || '') + ' expected NOT to contain ' + JSON.stringify(n)); };

  const M = () => ({
    title: 'Timor-Leste Health Landscape Scan', edition: 'E1', status: 'prototype', documentLanguage: 'en',
    reviewer: { named: true, name: 'Dr Natarajan Rajaraman' },
    lastReviewedByHuman: '2026-08-01', lastUpdatedByAI: '2026-08-25',
    refresh: { cadenceDays: 90, stalenessWarnDays: 120, stalenessAlarmDays: 180 },
    corrections: { formUrl: null },
    referenceLibrary: { url: 'https://drive.google.com/x', name: 'Lib', ownedByUs: false, linkApproved: false },
    relatedSite: { url: 'https://sites.google.com/view/tlsghealth/', name: 'TL-SG Health Collective' },
    sections: [{ id: '01', file: 'a.md', title: 'Executive summary', lastUpdatedByAI: '2026-08-25', lastReviewedByHuman: '2026-08-01' }],
    omittedSections: [{ id: '09', title: 'Gaps and opportunities', reason: 'Would be unsourced analysis.', renderNotice: true }],
  });
  const S = () => [{ id: '01', title: 'Executive summary', lastUpdatedByAI: '2026-08-25', lastReviewedByHuman: '2026-08-01', html: '<p>x</p>' }];

  t('divergence banner appears in the page, in words', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    has(h, 'NOT been reviewed by the named editor');
    has(h, 'sev-medium');
  });
  t('a fully reviewed document shows the reviewed banner instead', () => {
    const m = M(); m.lastReviewedByHuman = '2026-08-25';
    const s = S(); s[0].lastReviewedByHuman = '2026-08-25';
    const h = buildHtml(m, s, { today: '2026-08-25' });
    has(h, 'Reviewed by Dr Natarajan Rajaraman');
    has(h, 'sev-none');
    hasnt(h, 'NOT been reviewed by the named editor');
  });
  t('an unreviewed document does NOT describe itself as a landscape scan in the meta description', () => {
    const m = M(); m.lastReviewedByHuman = null;
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    has(h, 'automated compilation of cited sources');
  });
  t('per-section flag renders when the section changed since its review', () => {
    has(buildHtml(M(), S(), { today: '2026-08-25' }), 'changed since review');
  });
  t('per-section flag renders for a never-reviewed section', () => {
    const s = S(); s[0].lastReviewedByHuman = null;
    has(buildHtml(M(), s, { today: '2026-08-25' }), 'not yet reviewed');
  });
  t('the omitted section 9 is disclosed on the page, not silently absent', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    has(h, 'Gaps and opportunities');
    has(h, 'deliberately not included');
  });
  t('the unapproved third-party library link is NOT rendered', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    hasnt(h, 'https://drive.google.com/x', 'must not publish an unapproved link');
  });
  t('the library link IS rendered once approved', () => {
    const m = M(); m.referenceLibrary.linkApproved = true;
    has(buildHtml(m, S(), { today: '2026-08-25' }), 'https://drive.google.com/x');
  });
  t('page is indexable - the whole point of not using an Artifact', () => {
    has(buildHtml(M(), S(), { today: '2026-08-25' }), 'content="index, follow"');
  });
  t('cross-references the related site rather than restating it', () => {
    has(buildHtml(M(), S(), { today: '2026-08-25' }), 'does not duplicate it');
  });
  t('says plainly it is not official, in the header', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    has(h, 'not</b> an official document');
  });
  t('client-side staleness script is embedded and carries the update date', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    has(h, 'id="staleness"');
    has(h, '"2026-08-25"');
  });
  t('machine-readable annex is embedded and parses', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    const m2 = /<script type="application\/json" id="annex">([\s\S]*?)<\/script>/.exec(h);
    if (!m2) throw new Error('no annex');
    const j = JSON.parse(m2[1].replace(/\\u003c/g, '<'));
    if (j.reviewState !== 'changed-since-review') throw new Error('annex reviewState wrong: ' + j.reviewState);
    if (j.omittedSections.length !== 1) throw new Error('annex omittedSections missing');
  });
  t('annex cannot break out of the script tag', () => {
    const m = M(); m.title = '</script><script>alert(1)</script>';
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    const after = h.slice(h.indexOf('id="annex"'));
    hasnt(after.slice(0, 400), '</script><script>alert(1)', 'annex must escape a closing script tag');
  });
  t('theme-aware: defines light tokens on bare :root and dark under both selectors', () => {
    const h = buildHtml(M(), S(), { today: '2026-08-25' });
    has(h, '@media (prefers-color-scheme: dark)');
    has(h, ':root[data-theme="dark"]');
    has(h, 'background:var(--bg)');
  });
  t('tables scroll inside their own container, so the body never scrolls sideways', () => {
    has(css(), '.table-wrap{overflow-x:auto');
  });

  console.log(`build: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && !process.argv.includes('--self-test')) main();
