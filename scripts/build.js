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
const charts = require('./lib/charts');

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

/* ---- figures ----
   Palette slots come from the validated reference palette, checked with the validator against THIS
   page's real surfaces (#ffffff / #14161a) in both modes. Do not substitute a hex here without
   re-running scripts/validate_palette.js - "it looks fine" is not the test. */
:root{ --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a;
       --grid:#e6e9ed; --axis:#c2c8d0; --tier:#eef1f5; }
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){ --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70;
       --grid:#262b33; --axis:#39404a; --tier:#1e232b; }
}
:root[data-theme="dark"]{ --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70;
       --grid:#262b33; --axis:#39404a; --tier:#1e232b; }

figure.fig{margin:1.8rem 0; padding:0}
figure.fig img{width:100%; height:auto; display:block; border:1px solid var(--rule); border-radius:6px;
  background:#fff}
.fig-title{font-weight:650; font-size:.98rem; margin:0 0 .5rem; line-height:1.4}
.fig-note{font-size:.86rem; color:var(--muted); margin:.5rem 0 .2rem}
.fig-src{font-size:.78rem; color:var(--muted); margin:.25rem 0 0}
.fig-legend{display:flex; flex-wrap:wrap; gap:.3rem 1rem; font-size:.82rem; color:var(--muted); margin:0 0 .3rem}
.fig-legend .lg{display:inline-flex; align-items:center; gap:.35rem}
.fig-legend .sw{width:11px; height:11px; border-radius:3px; display:inline-block}
svg.chart{width:100%; height:auto; overflow:visible; display:block}
svg.chart .grid{stroke:var(--grid); stroke-width:1}
svg.chart .axis{stroke:var(--axis); stroke-width:1}
svg.chart .ln{fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
svg.chart .pt{stroke:var(--bg); stroke-width:2}
svg.chart .bar,svg.chart .tlbar{stroke:var(--bg); stroke-width:2}
svg.chart .tier{fill:var(--tier); stroke:var(--axis); stroke-width:1}
svg.chart text{fill:var(--fg); font-family:inherit}
svg.chart .tick{font-size:11px; fill:var(--muted)}
svg.chart .pnl{font-size:12px; font-weight:650; fill:var(--fg)}
svg.chart .ptlab,svg.chart .bval,svg.chart .tiercount{font-size:11.5px; font-weight:600; fill:var(--fg)}
svg.chart .slab,svg.chart .blab,svg.chart .tierlab{font-size:12px; fill:var(--fg)}
svg.chart .tiernote,svg.chart .tlafter{font-size:11px; fill:var(--muted)}
svg.chart .nowline{stroke:var(--muted); stroke-width:1; stroke-dasharray:3 3}
svg.chart .nowlab{font-size:10px; fill:var(--muted)}
#tip{position:fixed; z-index:9; pointer-events:none; background:var(--fg); color:var(--bg);
  padding:.3rem .5rem; border-radius:4px; font-size:.78rem; max-width:20rem; display:none}

/* ---- reader suggestions ---- */
.cta{margin:1.4rem 0 .2rem}
.btn{display:inline-block; background:var(--accent); color:var(--bg); text-decoration:none;
  padding:.6rem 1.1rem; border-radius:6px; font-weight:650; font-size:.95rem}
.btn:hover{filter:brightness(1.1)}
.cta-sub{font-size:.82rem; color:var(--muted); margin:.35rem 0 0}
ul.sugg{list-style:none; padding:0; margin:1rem 0}
.sg{border:1px solid var(--rule); border-radius:6px; padding:.8rem 1rem; margin:.7rem 0; background:var(--card)}
.sg-meta{display:flex; flex-wrap:wrap; gap:.4rem .8rem; align-items:center; font-size:.8rem;
  color:var(--muted); margin:0 0 .4rem}
.sg-status{padding:.1rem .45rem; border-radius:3px; font-weight:650; border:1px solid var(--rule)}
.st-new{background:var(--warn-bg); color:var(--warn-fg); border-color:var(--warn-rule)}
.st-verified,.st-incorporated{background:var(--ok-bg); color:var(--ok-fg); border-color:var(--ok-rule)}
.st-disputed{background:var(--alarm-bg); color:var(--alarm-fg); border-color:var(--alarm-rule)}
.sg-who{font-weight:600; color:var(--fg)}
.sg-text{margin:.2rem 0}
.sg-resp{margin:.5rem 0 0; padding-left:.8rem; border-left:3px solid var(--rule); font-size:.9rem; color:var(--muted)}
.sg-empty{color:var(--muted); font-style:italic}

@media print{
  .notice{border-left-width:2px}
  nav.toc{break-inside:avoid}
  figure.fig{break-inside:avoid}
  h2{break-after:avoid}
  a[href^="http"]::after{content:" (" attr(href) ")"; font-size:.75em; color:#555; word-break:break-all}
  body{font-size:11pt}
}
/* ---- navigation (2026-08-25 usability audit) ----
   The page is ~19,000 words. Before this, the only navigation was a TOC at the very top, and the
   TOC's auto-numbering (1-15) contradicted the section numbers every cross-reference uses (0-13). */
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
section[id],div[id],figure[id]{scroll-margin-top:3.6rem}
/* the ONE element that made the page body scroll sideways on a phone was an unbreakable inline URL */
code{overflow-wrap:anywhere}
.wrap a{overflow-wrap:anywhere}

.topbar{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--rule)}
.tb-in{max-width:var(--maxw);margin:0 auto;padding:.5rem 1.25rem;display:flex;align-items:center;
  justify-content:space-between;gap:1rem}
.tb-title{font-weight:650;font-size:.92rem;color:var(--fg);text-decoration:none;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;min-width:0}
.tb-menu{position:relative;flex:none}
.tb-menu>summary{list-style:none;cursor:pointer;font-size:.88rem;font-weight:650;color:var(--accent);
  padding:.3rem .75rem;border:1px solid var(--rule);border-radius:6px;background:var(--card);user-select:none}
.tb-menu>summary::-webkit-details-marker{display:none}
.tb-list{position:absolute;right:0;top:calc(100% + 8px);z-index:21;background:var(--bg);
  border:1px solid var(--rule);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);
  padding:.55rem .4rem;margin:0;list-style:none;min-width:290px;max-width:min(92vw,24rem);
  max-height:min(70vh,30rem);overflow:auto;font-size:.9rem}
.tb-list li{margin:0}
.tb-list a{display:block;padding:.28rem .6rem;border-radius:5px;text-decoration:none;color:var(--fg)}
.tb-list a:hover{background:var(--card)}
.tnum{display:inline-block;min-width:2.6em;color:var(--muted);font-weight:600}
.toc-omitted{color:var(--muted);padding:.28rem .6rem}
nav.toc ol{list-style:none;padding-left:.2rem}
.secnum{color:var(--muted);font-weight:600;margin-right:.55rem;font-size:.92em}
a.xref{text-decoration:none;border-bottom:1px dotted var(--accent)}

.fig-scroll{overflow-x:auto}
.fig-scroll svg.chart{min-width:560px}
.fig-panel{font-size:.85rem;font-weight:650;color:var(--muted);margin:.9rem 0 .2rem}

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

/**
 * SEO head block.
 *
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO
 * ----------------------------------------------------------------------------
 * It supplies a specific title, an honest description, social-card tags, a canonical URL and
 * schema.org structured data. It does NOT stuff keywords into the visible prose. Search engines have
 * penalised that for a decade, and on a document whose entire value is credibility, prose bent around
 * search terms would cost more than it earned. The keyword list lives in structured data and in the
 * <meta name="keywords"> tag, where it is machine-facing and harmless.
 *
 * The strongest SEO signal this page has is that it genuinely answers questions nobody else answers
 * about Timorese health - which is a content property, not a markup one.
 *
 * ROBOTS: index,follow is set explicitly. That single line is the reason a Claude Artifact was
 * disqualified for this document - artifacts serve X-Robots-Tag: none, so the page would be invisible
 * to exactly the people it is written for.
 */
function seoHead(m, disc) {
  const seo = m.seo || {};
  const url = m.canonicalUrl || null;
  const title = seo.titleFull || m.title;
  const desc = seo.description || `An independent, sourced ${disc.selfDescription} of health and the health system of Timor-Leste.`;
  const kw = (seo.keywords || []).join(', ');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Report',
    name: m.title,
    alternateName: ['East Timor Health Landscape Scan', 'Timor-Leste health system guide'],
    headline: title,
    description: desc,
    inLanguage: ['en', 'tet'],
    datePublished: m.lastUpdatedByAI,
    dateModified: m.lastUpdatedByAI,
    version: m.edition,
    isAccessibleForFree: true,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    keywords: seo.keywords || [],
    spatialCoverage: { '@type': 'Country', name: 'Timor-Leste', alternateName: 'East Timor' },
    about: [
      { '@type': 'Thing', name: 'Health system' },
      { '@type': 'Thing', name: 'Primary health care' },
      { '@type': 'Thing', name: 'Global health' },
      { '@type': 'Thing', name: 'International development' },
      { '@type': 'Thing', name: 'Non-governmental organizations' },
    ],
    audience: (seo.audience || []).map(a => ({ '@type': 'Audience', audienceType: a })),
    creator: { '@type': 'Organization', name: 'TL Health Landscape Scan' },
  };
  if (m.reviewer && m.reviewer.named) {
    ld.editor = { '@type': 'Person', name: m.reviewer.name };
  }
  if (url) { ld.url = url; ld.mainEntityOfPage = url; }
  if (m.conceptDoi) ld.identifier = 'https://doi.org/' + m.conceptDoi;

  return `
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(kw)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
${url ? `<link rel="canonical" href="${esc(url)}">` : '<!-- canonical URL not set: publish location unknown -->'}
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:locale" content="en">
<meta property="og:locale:alternate" content="tet">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<link rel="alternate" type="text/markdown" href="llms-full.txt" title="Full text as markdown">
<link rel="alternate" type="application/json" href="data.json" title="Structured data">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`.trim();
}

/**
 * Files for AI assistants and AI search engines.
 *
 * WHY THIS AND NOT AN MCP SERVER
 * ----------------------------------------------------------------------------
 * The people this document is for increasingly research through an AI assistant rather than a search
 * box. But AI search - ChatGPT Search, Perplexity, Claude with web search, Google's AI overviews -
 * works by FETCHING URLS. It does not connect to MCP servers. MCP is for a tool a user has
 * deliberately installed, which is a far smaller audience than "anyone who asks an assistant about
 * Timorese health". So the leverage is in making the SITE legible to a fetcher, which costs a few
 * static files and no hosting, rather than in running a server.
 *
 * Three things are emitted:
 *   llms.txt       the /llms.txt convention - a short, structured map an assistant can read cheaply
 *   llms-full.txt  the entire document as clean markdown, so an assistant that wants the whole thing
 *                  gets prose rather than HTML soup, with no scraping and no parse errors
 *   data.json      the structured facts, so a figure can be quoted exactly rather than approximated
 *
 * The point of all three is the same: make it EASIER to quote this document correctly than to
 * paraphrase it wrongly. An assistant that can read a clean number with its source attached is far
 * likelier to reproduce the source than one guessing from rendered HTML.
 */
function writeAiFiles(m, sections) {
  const url = m.canonicalUrl;
  const base = url ? url.replace(/\/[^/]*$/, '/') : '';
  const disc = meta.disclosure(m);

  // --- llms.txt : the map
  const lines = [];
  lines.push(`# ${m.title}`, '');
  lines.push(`> ${m.seo && m.seo.description ? m.seo.description : ''}`, '');
  lines.push(`Edition ${m.edition}. Text last updated by AI: ${m.lastUpdatedByAI}. ` +
             `Last reviewed by a human: ${m.lastReviewedByHuman || 'never'}. ` +
             `Review state: ${disc.state}.`, '');
  lines.push('IMPORTANT FOR ASSISTANTS QUOTING THIS DOCUMENT:', '');
  lines.push('- This is an UNOFFICIAL compilation. It is not endorsed by the Ministry of Health of');
  lines.push('  Timor-Leste, by WHO, or by any government. Say so when you cite it.');
  lines.push('- It describes PUBLISHED POLICY, which often differs from actual practice in');
  lines.push('  Timor-Leste. Advise the reader to check locally which requirements are really enforced.');
  lines.push('- Where two sources disagree, this document reports BOTH and does not pick. Do not');
  lines.push('  resolve the disagreement on its behalf - the disagreement is usually the finding.');
  lines.push('  The clearest case: skilled birth attendance, where the routine system and the');
  lines.push('  household survey move in OPPOSITE directions. Never quote a single figure for it.');
  lines.push('- Claims marked UNVERIFIED are exactly that. Carry the marker through.');
  lines.push('- Contact details and organisational status age fastest. Check before relying on them.');
  lines.push('');
  lines.push('## Sections', '');
  for (const s of sections) {
    lines.push(`- [${s.title}](${base}${base ? 'index.html' : ''}#sec-${s.id}): section ${s.id}`);
  }
  lines.push('');
  lines.push('## Full text', '');
  lines.push(`- [Complete document as markdown](${base}llms-full.txt): the entire text, clean, no HTML`);
  lines.push(`- [Structured data](${base}data.json): edition metadata, section freshness, key figures`);
  lines.push('');
  fs.writeFileSync(path.join(DOCS, 'llms.txt'), lines.join('\n'));

  // --- llms-full.txt : the whole document as markdown, straight from source
  const full = [];
  full.push(`# ${m.title}`, '');
  full.push(`Edition ${m.edition} | text updated by AI ${m.lastUpdatedByAI} | ` +
            `human review ${m.lastReviewedByHuman || 'none'} | ${disc.state}`, '');
  full.push(`${disc.headline} ${disc.detail}`, '');
  full.push('UNOFFICIAL. Not endorsed by the Ministry of Health of Timor-Leste, WHO, or any government.', '');
  full.push('---', '');
  for (const s of m.sections) {
    const p = path.join(CONTENT, s.file);
    if (!fs.existsSync(p)) continue;
    full.push(`## Section ${s.id} — ${s.title}`, '');
    full.push(`(text updated ${s.lastUpdatedByAI || 'unknown'}; ` +
              `${s.lastReviewedByHuman ? 'reviewed ' + s.lastReviewedByHuman : 'NOT yet reviewed by a human'})`, '');
    full.push(fs.readFileSync(p, 'utf8').replace(/\{\{[a-z-]+(?::[a-z0-9-]+)?\}\}/g, '').trim(), '');
    full.push('---', '');
  }
  fs.writeFileSync(path.join(DOCS, 'llms-full.txt'), full.join('\n'));

  // --- data.json : the figures, each with its source, so they can be quoted exactly
  const data = {
    document: {
      title: m.title, edition: m.edition, status: m.status,
      official: false,
      lastUpdatedByAI: m.lastUpdatedByAI, lastReviewedByHuman: m.lastReviewedByHuman,
      reviewState: disc.state, selfDescription: disc.selfDescription,
      url: url, conceptDoi: m.conceptDoi,
      caveat: 'Describes published policy, which can differ substantially from practice. Check locally.',
    },
    sections: m.sections.map(s => ({ id: s.id, title: s.title,
      lastUpdatedByAI: s.lastUpdatedByAI, lastReviewedByHuman: s.lastReviewedByHuman })),
    contestedFigures: [
      {
        indicator: 'Skilled birth attendance',
        status: 'CONTESTED - sources move in opposite directions. Do not quote a single figure.',
        values: [
          { source: 'HMIS (routine reporting)', figures: '92% (2020) falling to 56.7% (2024)' },
          { source: 'DHS (household survey)', figures: '60% (2016) rising to 78% (2025-26)' },
        ],
      },
      {
        indicator: 'Current health expenditure as % of GDP',
        status: 'CONTESTED, and the indicator itself is misleading for Timor-Leste.',
        values: [
          { source: 'WHO GHED/GHO API', figures: '9.60% (2023); 4.92% (2021)' },
          { source: 'WHO Country Cooperation Strategy 2026-2030', figures: '6% by 2023' },
          { source: 'WHO country profile / SEARO SDG profile', figures: '11.4% (2021) - not reproducible from primitives; implies a non-oil GDP denominator' },
        ],
        guidance: 'Use US$ per capita (144.21 in 2023) and health as a share of government expenditure (9.16% in 2023). The GDP ratio moved because petroleum GDP fell 43%, not because spending changed.',
      },
      {
        indicator: 'UHC service coverage index',
        status: 'CONTESTED between two WHO products.',
        values: [
          { source: 'WHO GHO', figures: '48 (2023)' },
          { source: 'WHO CCS 2026-2030', figures: '52' },
        ],
      },
    ],
    keyFacts: [
      { fact: 'Municipality-level units', value: 14, note: '13 municipalities plus RAEOA. Atauro separated from Dili on 1 January 2022. Documents saying 12 or 13 predate that.' },
      { fact: 'Out-of-pocket share of current health expenditure', value: '6.99% (2023)', note: 'Among the lowest in the world. No social health insurance; public care free at point of use.' },
      { fact: 'Health budget 2026', value: 'US$138.3 million, 6.04% of the state budget' },
      { fact: 'Overseas medical treatment line, 2026 budget', value: 'US$19.3 million', note: '14% of the health budget, spent treating Timorese patients abroad.' },
      { fact: 'Facilities', value: '6 hospitals, about 71 community health centres, 344 health posts' },
      { fact: 'Tuberculosis incidence', value: '496 per 100,000 (2024)', note: 'Among the highest in the world.' },
      { fact: 'Malaria status', value: 'Certified malaria-free by WHO, 24 July 2025' },
      { fact: 'ASEAN membership', value: 'Eleventh member, 26 October 2025' },
      { fact: 'WHO region', value: 'South-East Asia Region (SEARO), NOT Western Pacific' },
      { fact: 'Operative national health plan', value: 'NHSSP II 2020-2030', note: "WHO's own planning database still lists the superseded 2011-2030 plan." },
      { fact: 'Flagship primary care programme', value: 'PIS - Programa Integradu Saude', note: 'What WHO and others call the "integrated health services programme".' },
      { fact: 'Medicines agency', value: 'INFPM', note: 'Formerly SAMES. Documents saying SAMES are out of date.' },
      { fact: 'Ministry of Health website', value: 'None functioning', note: 'ms.gov.tl returns 502; moh.gov.tl dead since 2020. The live channel is Facebook (139,000 followers) and a document portal at apps.ms.gov.tl.' },
      { fact: 'Training and research approval', value: 'INSP-TL approval required for all clinical research and any training longer than 3 days' },
    ],
    aseanPosition: (function () {
      // Computed from data/comparators.json at build time, never typed in - a recalled comparator
      // is this project's documented failure mode. Absent cache -> absent block, not stale numbers.
      try {
        const c = JSON.parse(fs.readFileSync(path.join(DATA, 'comparators.json'), 'utf8'));
        const rank = (key) => {
          const ind = c.indicators.find(i => i.key === key);
          if (!ind || !ind.values.TLS) return null;
          const rows = Object.entries(ind.values).sort((a, b) => b[1].value - a[1].value);
          const pos = rows.findIndex(([iso]) => iso === 'TLS') + 1;
          const t = ind.values.TLS;
          return { indicator: ind.label, timorLeste: t.value, year: t.year,
                   rankHighToLow: pos + ' of ' + rows.length };
        };
        return {
          note: 'Rank 1 = highest value among the 11 ASEAN members. Each value is that country\u2019s ' +
                'latest available year (the World Bank does not align them). Pulled ' + c.pulled + '.',
          indicators: ['physicians', 'nurses', 'cheCapita', 'oop', 'lifeExp', 'u5mr', 'mmr', 'tb']
            .map(rank).filter(Boolean),
        };
      } catch (e) { return null; }
    })(),
    knownGaps: [
      'No 3W (who does what where) dataset and no health-cluster partner list for Timor-Leste.',
      'No national master facility list.',
      'No published hospital bed counts.',
      'No current national HRH plan (2020-2024 expired, no successor published).',
      'National clinical guidelines largely date from 2004-2010.',
      'Whether the December 2023 national TB prevalence survey results were published is unverified.',
    ],
    generated: meta.todaySGT(),
  };
  fs.writeFileSync(path.join(DOCS, 'data.json'), JSON.stringify(data, null, 2));
}

/** robots.txt + sitemap.xml, so the page is actually crawlable rather than merely indexable. */
function writeCrawlFiles(m) {
  const url = m.canonicalUrl;
  // Named explicitly rather than relying on the wildcard. "Allow: *" already permits these, but an
  // explicit block is a clear statement of intent - several of these crawlers are governed by
  // opt-out conventions, and silence is ambiguous where a named Allow is not.
  const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User',
                     'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended',
                     'Applebot-Extended', 'CCBot', 'Bytespider', 'meta-externalagent'];
  const lines = ['# This document is meant to be read, quoted and cited - by people and by machines.',
                 '# Clean machine-readable copies: /llms.txt  /llms-full.txt  /data.json', '',
                 'User-agent: *', 'Allow: /', ''];
  for (const a of AI_AGENTS) lines.push(`User-agent: ${a}`, 'Allow: /', '');
  if (url) {
    const base = url.replace(/\/[^/]*$/, '/');
    lines.push('Sitemap: ' + base + 'sitemap.xml', '');
    fs.writeFileSync(path.join(DOCS, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${esc(url)}</loc>
    <lastmod>${esc(m.lastUpdatedByAI)}</lastmod>
    <changefreq>quarterly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
  } else {
    lines.push('# Sitemap omitted: canonicalUrl is not set in content/_meta.json yet.', '');
  }
  fs.writeFileSync(path.join(DOCS, 'robots.txt'), lines.join('\n'));
}

/**
 * The reader-suggestions block: the call-to-action, and the published suggestions themselves.
 *
 * Publishing reader submissions on a page that names real organisations is the reason there is a
 * moderation step at all - see content/13-suggestions.md. Note every field below is escaped: this is
 * the ONLY place on the page where text written by a stranger is rendered, so it is the one place an
 * injection could land.
 */
function suggestionsBlock(m) {
  let list = { suggestions: [] };
  const p = path.join(DATA, 'suggestions.json');
  if (fs.existsSync(p)) list = JSON.parse(fs.readFileSync(p, 'utf8'));
  const items = (list.suggestions || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const formUrl = m.corrections && m.corrections.formUrl;
  const cta = formUrl
    ? `<p class="cta"><a class="btn" href="${esc(formUrl)}">Suggest an addition or correction</a></p>
       <p class="cta-sub">No account needed. Takes a minute.</p>`
    : `<div class="notice sev-medium"><p class="n-head">The suggestions form is not yet live.</p>
       <p>This is a prototype edition. The form will be linked here before publication.</p></div>`;

  const LABEL = { new: 'New - not yet checked', verified: 'Verified', incorporated: 'Incorporated into the text', disputed: 'Disputed' };

  const body = items.length
    ? `<ul class="sugg">` + items.map(s => {
        const who = s.from ? esc(s.from) + (s.org ? ', ' + esc(s.org) : '') : 'Anonymous';
        const st = String(s.status || 'new').toLowerCase();
        return `<li class="sg">
        <p class="sg-meta"><span class="sg-status st-${esc(st)}">${esc(LABEL[st] || st)}</span>
          <span class="sg-who">${who}</span>
          <span class="sg-date">${esc(s.date || '')}</span>
          ${s.section ? `<span class="sg-sec">on &sect;${esc(s.section)}</span>` : ''}</p>
        <p class="sg-text">${esc(s.text || '')}</p>
        ${s.response ? `<p class="sg-resp"><b>Editor:</b> ${esc(s.response)}</p>` : ''}
      </li>`;
      }).join('') + `</ul>`
    : `<p class="sg-empty">No suggestions have been published yet. Yours would be the first.</p>`;

  return { cta, body, count: items.length };
}

/**
 * The figure hover layer. Deliberately tiny and deliberately OPTIONAL: every series in every figure
 * is direct-labelled, and every figure sits beside its source table in the text, so with JavaScript
 * off nothing is lost except convenience. Each mark also carries an SVG <title>, which gives native
 * tooltips and an accessible name even without this script.
 */
function tooltipScript() {
  return `
(function(){
  var tip=document.getElementById('tip'); if(!tip) return;
  function show(e,t){ tip.textContent=t; tip.style.display='block';
    var x=e.clientX+14, y=e.clientY+14;
    var r=tip.getBoundingClientRect();
    if(x+r.width>window.innerWidth-8) x=e.clientX-r.width-14;
    if(y+r.height>window.innerHeight-8) y=e.clientY-r.height-14;
    tip.style.left=x+'px'; tip.style.top=y+'px'; }
  function hide(){ tip.style.display='none'; }
  document.addEventListener('mouseover',function(e){
    var el=e.target.closest&&e.target.closest('[data-tip]');
    if(el) show(e,el.getAttribute('data-tip'));
  });
  document.addEventListener('mousemove',function(e){
    var el=e.target.closest&&e.target.closest('[data-tip]');
    if(el) show(e,el.getAttribute('data-tip')); else hide();
  });
  document.addEventListener('mouseout',hide);
  window.addEventListener('scroll',hide,{passive:true});
})();`.trim();
}

/* -------------------------------------------------------- section numbering & navigation */

/** '§3' from id '03', '§8b' from '08b', '§10' from '10'. The display number every cross-reference
 *  in the prose already uses - the TOC used to auto-number 1..15 against it, which made "Health
 *  status" section 3 in the text and item 5 in the contents. */
function secNum(id) { return '\u00a7' + String(id).replace(/^0/, ''); }

/** ordering key so omitted-section notices can be interleaved at their true position:
 *  '08b' -> 8.5 sits between '08' -> 8 and '10' -> 10, with the omitted '09' -> 9 between them. */
function ordKey(id) {
  const mch = /^(\d+)([a-z])?$/.exec(String(id));
  if (!mch) return 999;
  return parseInt(mch[1], 10) + (mch[2] ? 0.5 : 0);
}

/** One list of navigation entries - sections plus omitted placeholders - used by BOTH the sticky
 *  topbar menu and the in-page Contents box, so the two can never disagree. */
function navEntries(m, sections) {
  const items = sections.map(sec => ({
    key: ordKey(sec.id),
    html: `<li><a href="#sec-${esc(sec.id)}"><span class="tnum">${secNum(sec.id)}</span>${esc(sec.title)}</a></li>`,
  }));
  for (const om of (m.omittedSections || []).filter(x => x.renderNotice)) {
    items.push({
      key: ordKey(om.id),
      html: `<li class="toc-omitted"><span class="tnum">${secNum(om.id)}</span>${esc(om.title)} &mdash; <a href="#omitted-${esc(om.id)}">deliberately omitted</a></li>`,
    });
  }
  return items.sort((a, b) => a.key - b.key).map(i => i.html).join('\n      ');
}

/** Closes the Contents dropdown when a destination is picked, and on any click outside it.
 *  Pure enhancement: with JS off the details element still opens and every link still works. */
function menuScript() {
  return `
(function(){
  var m=document.getElementById('tbmenu'); if(!m) return;
  m.addEventListener('click',function(e){ var a=e.target.closest&&e.target.closest('a'); if(a) m.removeAttribute('open'); });
  document.addEventListener('click',function(e){ if(m.hasAttribute('open')&&!m.contains(e.target)) m.removeAttribute('open'); });
})();`.trim();
}

/* ---------------------------------------------------------------- assembly */

function buildHtml(m, sections, opts) {
  const o = opts || {};
  const today = o.today || meta.todaySGT();
  const disc = meta.disclosure(m, today);
  const stale = meta.staleness(m, today);

  const toc = navEntries(m, sections);

  // Section bodies and omitted-section notices are INTERLEAVED at their true ordinal position -
  // the missing-section-9 notice sits between 8b and 10 where a reader looks for it, not stacked
  // among the banners at the top of the page (a 2026-08-25 usability-audit fix; the top of the page
  // had three notices before any content).
  const flow = sections.map(s => {
    const st = meta.sectionState(s, m, today);
    const flag = (st === 'changed-since-review' || st === 'never-reviewed')
      ? `<span class="flag">${st === 'never-reviewed' ? 'not yet reviewed' : 'changed since review'}</span>` : '';
    const revTxt = s.lastReviewedByHuman ? `reviewed ${esc(s.lastReviewedByHuman)}` : 'not yet reviewed';
    return { key: ordKey(s.id), html: `
    <section id="sec-${esc(s.id)}">
      <h2><span class="secnum">${secNum(s.id)}</span>${esc(s.title)}</h2>
      <p class="sec-stamp">Text updated ${esc(s.lastUpdatedByAI || 'unknown')} &middot; ${revTxt}${flag}</p>
      ${s.html}
    </section>` };
  });
  for (const om of (m.omittedSections || []).filter(x => x.renderNotice)) {
    flow.push({ key: ordKey(om.id), html: `
    <div class="notice" id="omitted-${esc(om.id)}">
      <p class="n-head">${secNum(om.id)} &mdash; ${esc(om.title)} &mdash; is deliberately not included.</p>
      <p>${esc(om.reason)}</p>
    </div>` });
  }
  const body = flow.sort((a, b) => a.key - b.key).map(i => i.html).join('\n');

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
<title>${esc((m.seo && m.seo.titleFull) || m.title)}</title>
${seoHead(m, disc)}
<style>${css()}</style>
</head>
<body>
<nav class="topbar" aria-label="Page navigation">
  <div class="tb-in">
    <a class="tb-title" href="#top">${esc(m.title)}</a>
    <details class="tb-menu" id="tbmenu">
      <summary>Contents</summary>
      <ol class="tb-list">
      ${toc}
      </ol>
    </details>
  </div>
</nav>
<div class="wrap">

<header id="top">
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
<div id="tip" role="status" aria-live="polite"></div>

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
<script>${tooltipScript()}</script>
<script>${menuScript()}</script>
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

    // {{chart:id}} -> the rendered figure. Substituted AFTER markdown so the SVG is never mangled
    // by the inline formatter, and an unknown id THROWS rather than leaving a placeholder visible
    // on the published page.
    // The placeholder sits alone in its own paragraph, so markdown wraps it as <p>{{chart:x}}</p>.
    // Absorb that wrapper: a <figure> inside a <p> is invalid HTML and browsers silently close the
    // paragraph early, which breaks the surrounding layout in ways that are tedious to trace back.
    // Make the ~96 cross-references (\u00a78, \u00a75...) actual links. External document references are
    // never linkified: they are always decimal-suffixed ("CCS \u00a72.3.1", "NHSSP II \u00a75.1"), which the
    // negative lookahead excludes - verified against every \u00a7-pattern in the content before this was
    // enabled. \u00a79 links to the omitted-section notice; a number with no matching section is left as
    // plain text rather than becoming a broken link.
    const secIds = new Set(m.sections.map(x => x.id));
    const omIds = new Set((m.omittedSections || []).map(x => x.id));
    const pad = n => { const mm = /^(\d+)([a-z])?$/.exec(n); return (mm[1].length < 2 ? '0' + mm[1] : mm[1]) + (mm[2] || ''); };
    const linkify = h => h.replace(/(?:\u00a7|&sect;)(\d{1,2}[ab]?)(?!\.?\d)/g, (m0, num) => {
      const id = pad(num);
      if (secIds.has(id)) return `<a class="xref" href="#sec-${id}">\u00a7${num}</a>`;
      if (omIds.has(id)) return `<a class="xref" href="#omitted-${id}">\u00a7${num}</a>`;
      return m0;
    });

    const sg = suggestionsBlock(m);
    const html = r.html
      .replace(/<p>\s*\{\{chart:([a-z0-9-]+)\}\}\s*<\/p>/g, (m0, id) => charts.render(id))
      .replace(/\{\{chart:([a-z0-9-]+)\}\}/g, (m0, id) => charts.render(id))
      .replace(/<p>\s*\{\{suggestions-form\}\}\s*<\/p>/g, () => sg.cta)
      .replace(/<p>\s*\{\{suggestions-list\}\}\s*<\/p>/g, () => sg.body);
    const linked = linkify(html);
    if (/\{\{chart:/.test(linked)) throw new Error(`${s.file}: a malformed chart placeholder survived rendering`);

    return Object.assign({}, s, { html: linked, headings: r.headings });
  }).filter(Boolean);
}

/**
 * The suppression guard. THIS IS WHY A REMOVAL REQUEST ACTUALLY STICKS.
 *
 * The obvious failure mode, if this did not exist: an organisation asks to be removed, someone
 * deletes the paragraph, and three months later a refresh re-scrapes the same public web page and
 * puts them straight back. That would be worse than never offering removal, because it turns a
 * promise into a broken one - and nobody would notice, since the page would look correct.
 *
 * So the check sits at the point where the harm occurs: RENDERING. It THROWS. A build that would
 * publish a suppressed organisation does not produce a page at all.
 *
 * Deliberately matched against the FINAL rendered HTML rather than the source markdown, because that
 * is what a reader actually receives - a name reintroduced by a chart label, a data file or a
 * generated block is caught just the same as one typed into the prose.
 */
function assertSuppressionHonoured(html) {
  const p = path.join(DATA, 'suppression.json');
  if (!fs.existsSync(p)) return [];
  const supp = JSON.parse(fs.readFileSync(p, 'utf8')).suppressed || [];
  const hay = html.toLowerCase();
  const violations = [];

  for (const s of supp) {
    const scope = String(s.scope || '');
    if (scope === 'none' || scope === 'contact-only') continue;  // may still be listed

    if (scope === 'listing-and-contact' && s.name) {
      if (hay.includes(String(s.name).toLowerCase())) {
        violations.push(`"${s.name}" asked to be removed entirely (${s.requestedOn || 'date unrecorded'}) but still appears in the rendered page`);
      }
    }
    // any scope that is not 'none'/'contact-only' bars the addresses themselves
    for (const e of (s.emails || [])) {
      if (hay.includes(String(e).toLowerCase())) {
        violations.push(`the address ${e} is suppressed but still appears in the rendered page`);
      }
    }
  }
  return violations;
}

function build(opts) {
  const o = opts || {};
  const m = meta.load(path.join(CONTENT, '_meta.json'), { today: o.today });
  const sections = loadSections(m);
  const html = buildHtml(m, sections, o);

  const violations = assertSuppressionHonoured(html);
  if (violations.length) {
    throw new Error('SUPPRESSION VIOLATED - refusing to build:\n  - ' + violations.join('\n  - ') +
      '\nRemove them from the content and from data/actors.json. Do NOT edit data/suppression.json to silence this.');
  }

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
  writeCrawlFiles(r.meta);
  writeAiFiles(r.meta, r.sections);

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

module.exports = { build, buildHtml, loadSections, assertSuppressionHonoured };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL: ' + name + '\n      ' + e.message); } };
  const has = (h, n, m) => { if (!h.includes(n)) throw new Error((m || '') + ' expected to contain ' + JSON.stringify(n)); };
  const hasnt = (h, n, m) => { if (h.includes(n)) throw new Error((m || '') + ' expected NOT to contain ' + JSON.stringify(n)); };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

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
    // Substring, not equality: the directive legitimately carries extra hints
    // (max-image-preview, max-snippet). What must never change is that it starts with index, follow.
    has(buildHtml(M(), S(), { today: '2026-08-25' }), 'name="robots" content="index, follow');
    hasnt(buildHtml(M(), S(), { today: '2026-08-25' }), 'noindex');
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
  t('SEO: emits structured data, social cards and an explicit index directive', () => {
    const m = M(); m.seo = { titleFull: 'T Full', description: 'D', keywords: ['a','b'], audience: ['x'] };
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    has(h, 'application/ld+json');
    has(h, '"@type":"Report"');
    has(h, 'og:title');
    has(h, 'twitter:card');
    has(h, 'content="index, follow');
    has(h, '<title>T Full</title>');
  });
  t('SEO: structured data cannot break out of its script tag', () => {
    const m = M(); m.seo = { titleFull: '</script><script>alert(1)</script>', description: 'D', keywords: [] };
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    const i2 = h.indexOf('application/ld+json');
    hasnt(h.slice(i2, i2 + 600), '</script><script>alert(1)', 'ld+json must escape a closing script tag');
  });
  t('SEO: a missing canonical URL degrades to a comment, never a broken link tag', () => {
    const m = M(); m.canonicalUrl = null;
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    hasnt(h, '<link rel="canonical" href="null"');
    hasnt(h, '<link rel="canonical" href=""');
  });
  t('SEO: keywords live in metadata, NOT stuffed into visible prose', () => {
    const m = M(); m.seo = { titleFull: 'T', description: 'D', keywords: ['medical mission Timor'] };
    const h = buildHtml(m, S(), { today: '2026-08-25' });
    const bodyOnly = h.slice(h.indexOf('<body>'));
    const inMeta = h.slice(0, h.indexOf('<body>'));
    has(inMeta, 'medical mission Timor');
    hasnt(bodyOnly.replace(/<script[\s\S]*?<\/script>/g, ''), 'medical mission Timor');
  });
  t('suggestions: renders the empty state rather than an empty list', () => {
    const sg = suggestionsBlock(M());
    has(sg.body, 'No suggestions have been published yet');
  });
  t('suggestions: a submitter name is escaped - it is stranger-written text', () => {
    const orig = fs.readFileSync(path.join(DATA, 'suggestions.json'), 'utf8');
    try {
      fs.writeFileSync(path.join(DATA, 'suggestions.json'), JSON.stringify({ suggestions: [
        { date: '2026-08-25', from: '<img src=x onerror=alert(1)>', text: 'hi', status: 'new' } ] }));
      const sg = suggestionsBlock(M());
      hasnt(sg.body, '<img src=x');
      has(sg.body, '&lt;img');
    } finally { fs.writeFileSync(path.join(DATA, 'suggestions.json'), orig); }
  });
  t('suggestions: an unknown status still renders a readable label', () => {
    const orig = fs.readFileSync(path.join(DATA, 'suggestions.json'), 'utf8');
    try {
      fs.writeFileSync(path.join(DATA, 'suggestions.json'), JSON.stringify({ suggestions: [
        { date: '2026-08-25', text: 'hi', status: 'weird-new-status' } ] }));
      has(suggestionsBlock(M()).body, 'weird-new-status');
    } finally { fs.writeFileSync(path.join(DATA, 'suggestions.json'), orig); }
  });
  t('tables scroll inside their own container, so the body never scrolls sideways', () => {
    has(css(), '.table-wrap{overflow-x:auto');
  });

  t('SUPPRESSION: a removed organisation cannot be published - the build THROWS', () => {
    const sp = path.join(DATA, 'suppression.json');
    const orig = fs.existsSync(sp) ? fs.readFileSync(sp, 'utf8') : null;
    try {
      fs.writeFileSync(sp, JSON.stringify({ suppressed: [
        { id: 'pradet', name: 'PRADET', scope: 'listing-and-contact', requestedOn: '2026-08-25' } ] }));
      let threw = false, msg = '';
      try { build({}); } catch (e) { threw = true; msg = e.message; }
      eq(threw, true, 'build must refuse');
      has(msg, 'SUPPRESSION VIOLATED');
      has(msg, 'PRADET');
    } finally { if (orig !== null) fs.writeFileSync(sp, orig); }
  });
  t('SUPPRESSION: a suppressed ADDRESS is caught even if the name is absent', () => {
    const sp = path.join(DATA, 'suppression.json');
    const orig = fs.existsSync(sp) ? fs.readFileSync(sp, 'utf8') : null;
    try {
      fs.writeFileSync(sp, JSON.stringify({ suppressed: [
        { id: 'z', name: 'Nothing With This Name', emails: ['info@pradet.org'], scope: 'contact-details' } ] }));
      let threw = false, msg = '';
      try { build({}); } catch (e) { threw = true; msg = e.message; }
      eq(threw, true);
      has(msg, 'info@pradet.org');
    } finally { if (orig !== null) fs.writeFileSync(sp, orig); }
  });
  t('SUPPRESSION: scope "none" (withdrawn) and "contact-only" do NOT block listing', () => {
    const sp = path.join(DATA, 'suppression.json');
    const orig = fs.existsSync(sp) ? fs.readFileSync(sp, 'utf8') : null;
    try {
      fs.writeFileSync(sp, JSON.stringify({ suppressed: [
        { id: 'pradet', name: 'PRADET', scope: 'none' },
        { id: 'alola', name: 'Fundasaun Alola', scope: 'contact-only' } ] }));
      build({});   // must not throw
    } finally { if (orig !== null) fs.writeFileSync(sp, orig); }
  });
  t('SUPPRESSION: the real suppression file leaves the real build clean', () => {
    eq(assertSuppressionHonoured(build({}).html).length, 0);
  });

  t('NAV: sticky topbar exists, with a Contents menu that reaches every section', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    has(h, 'class="topbar"');
    has(h, 'id="tbmenu"');
    has(h, '<summary>Contents</summary>');
    has(h, 'href="#sec-08b"');
  });
  t('NAV: TOC and headings carry the REAL section numbers, not auto-numbering', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    has(h, 'class="secnum">\u00a73<');
    has(h, 'class="tnum">\u00a78b<');
    has(h, 'list-style:none', 'the TOC ol must not double-number');
  });
  t('NAV: cross-references are links, and external document refs are NOT', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    has(h, 'class="xref" href="#sec-08"');
    has(h, 'CCS \u00a72.3.1', 'a decimal-suffixed external ref must stay plain text');
    has(h, 'NHSSP II \u00a75.1', 'a decimal-suffixed external ref must stay plain text');
  });
  t('NAV: the omitted section 9 notice sits in flow between 8b and 10, and the TOC lists it', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    const a = h.indexOf('id="sec-08b"'), b = h.indexOf('id="omitted-09"'), c = h.indexOf('id="sec-10"');
    eq(a > 0 && a < b && b < c, true, 'ordinal placement broken');
    has(h, 'href="#omitted-09"');
  });
  t('MOBILE: the one overflow class is fixed and anchors clear the sticky bar', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    has(h, 'overflow-wrap:anywhere');
    has(h, 'scroll-margin-top');
    has(h, '.fig-scroll{overflow-x:auto}');
  });
  t('ASEAN: data.json carries a computed regional position with per-value years', () => {
    const j = JSON.parse(fs.readFileSync(path.join(DOCS, 'data.json'), 'utf8'));
    if (!j.aseanPosition) throw new Error('aseanPosition missing - is data/comparators.json present?');
    eq(j.aseanPosition.indicators.length >= 8, true, 'expected 8 ranked indicators');
    for (const r of j.aseanPosition.indicators) {
      if (!r.year || !r.rankHighToLow) throw new Error(r.indicator + ' missing year or rank');
    }
  });
  t('AI: llms.txt tells an assistant the document is UNOFFICIAL and policy-not-practice', () => {
    const f = path.join(DOCS, 'llms.txt');
    if (!fs.existsSync(f)) throw new Error('llms.txt not emitted - run a build first');
    const x = fs.readFileSync(f, 'utf8');
    has(x, 'UNOFFICIAL');
    has(x, 'PUBLISHED POLICY');
    has(x, 'check locally');
  });
  t('AI: llms.txt warns against resolving the contested figures', () => {
    const x = fs.readFileSync(path.join(DOCS, 'llms.txt'), 'utf8');
    has(x, 'OPPOSITE directions');
    has(x, 'Never quote a single figure');
    has(x, 'UNVERIFIED');
  });
  t('AI: llms-full.txt is clean markdown with no unrendered placeholders', () => {
    const x = fs.readFileSync(path.join(DOCS, 'llms-full.txt'), 'utf8');
    hasnt(x, '{{chart:', 'placeholders must be stripped');
    hasnt(x, '{{suggestions', 'placeholders must be stripped');
    if (x.length < 20000) throw new Error('llms-full.txt looks truncated: ' + x.length);
  });
  t('AI: llms-full.txt carries the per-section review state, not just the text', () => {
    const x = fs.readFileSync(path.join(DOCS, 'llms-full.txt'), 'utf8');
    has(x, 'NOT yet reviewed by a human');
  });
  t('AI: data.json parses and marks the contested figures as CONTESTED', () => {
    const j = JSON.parse(fs.readFileSync(path.join(DOCS, 'data.json'), 'utf8'));
    eq(j.document.official, false, 'must state it is not official');
    if (!Array.isArray(j.contestedFigures) || j.contestedFigures.length < 3) throw new Error('expected contested figures');
    for (const c of j.contestedFigures) has(c.status, 'CONTESTED', c.indicator);
    if (!j.keyFacts.length || !j.knownGaps.length) throw new Error('expected keyFacts and knownGaps');
  });
  t('AI: robots.txt names the AI crawlers explicitly and points at the clean copies', () => {
    const x = fs.readFileSync(path.join(DOCS, 'robots.txt'), 'utf8');
    for (const a of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) has(x, a);
    has(x, '/llms.txt');
    hasnt(x, 'Disallow: /', 'must not block anything');
  });
  t('AI: the page links its machine-readable alternates so a fetcher finds them', () => {
    const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
    has(h, 'rel="alternate" type="text/markdown"');
    has(h, 'rel="alternate" type="application/json"');
  });

  console.log(`build: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && !process.argv.includes('--self-test')) main();
