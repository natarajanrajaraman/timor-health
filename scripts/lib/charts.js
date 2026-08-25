'use strict';
/**
 * charts.js - inline SVG figures, generated at build time.
 *
 * WHY SVG GENERATED AT BUILD TIME
 * ----------------------------------------------------------------------------
 * Same reason the rest of this repo has no dependencies: a chart library is a thing that rots. These
 * are plain SVG strings baked into the page, so every figure still renders in 2031 with no runtime,
 * no CDN and no build toolchain. The optional hover layer is ~20 lines of vanilla JS; with JS off,
 * every figure is still fully readable because every series is DIRECTLY LABELLED.
 *
 * COLOR
 * ----------------------------------------------------------------------------
 * Slots come from the validated reference palette and were checked with the validator against THIS
 * page's actual surfaces (#ffffff light, #14161a dark), not eyeballed:
 *   light  #2a78d6 #eb6834 #1baf7a   dark  #3987e5 #d95926 #199e70
 * All hard gates pass in both modes. The one WARN - aqua at 2.82:1 on white - is covered by the
 * relief rule: every series carries a visible direct label, and every figure is paired with its
 * source table in the surrounding text.
 *
 * RULES OBEYED (see anti-patterns.md)
 * ----------------------------------------------------------------------------
 * - Never a dual y-axis. Where two measures of different scale must be compared, they become SMALL
 *   MULTIPLES sharing an x-axis - which is exactly the financing figure, whose whole point is that
 *   the ratio and the dollars move in opposite directions.
 * - Categorical hues in fixed order, never cycled.
 * - Colour follows the entity, not its rank.
 * - Recessive grid and axes; thin marks; text in ink tokens, never the series colour.
 * - Every figure carries its source. Raj's instruction, 2026-08-25: cited and sourced if external.
 */

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const N = n => (Math.round(n * 100) / 100);

/** figure wrapper: title, the svg, an optional note, and a mandatory source line */
function figure(opts) {
  const { id, title, desc, svg, source, note } = opts;
  // Charts scroll sideways on narrow screens rather than shrinking: a 720-unit viewBox scaled
  // into a 360px phone renders its 11px tick labels at ~5.5px, which is not smaller text, it is
  // no text. min-width on the svg + overflow-x on the wrapper follows the same rule as tables -
  // wide content scrolls in its own container, the page body never scrolls sideways.
  const body = svg.includes('<svg') ? `<div class="fig-scroll">${svg}</div>` : svg;
  return `<figure class="fig" id="fig-${esc(id)}">
  <figcaption class="fig-title">${esc(title)}</figcaption>
  ${body}
  ${note ? `<p class="fig-note">${note}</p>` : ''}
  <p class="fig-src">Source: ${source}</p>
</figure>`;
}

function legend(items) {
  return `<div class="fig-legend">` + items.map(it =>
    `<span class="lg"><span class="sw" style="background:var(--series-${it.slot})"></span>${esc(it.label)}</span>`
  ).join('') + `</div>`;
}

/* ------------------------------------------------------------------ line / slope */

/**
 * Multi-series line chart on a numeric x axis. Points are direct-labelled at the ends, which is what
 * makes the figure readable with JS off and satisfies the relief rule for the low-contrast slot.
 */
function lineChart(o) {
  const W = 720, H = o.height || 300;
  const M = { t: 18, r: 116, b: 40, l: 48 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const [x0, x1] = o.xDomain, [y0, y1] = o.yDomain;
  const sx = v => M.l + ((v - x0) / (x1 - x0)) * iw;
  const sy = v => M.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const yTicks = o.yTicks || 5;
  let grid = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = y0 + (i / yTicks) * (y1 - y0), y = sy(v);
    grid += `<line class="grid" x1="${M.l}" y1="${N(y)}" x2="${M.l + iw}" y2="${N(y)}"/>`;
    grid += `<text class="tick" x="${M.l - 8}" y="${N(y + 4)}" text-anchor="end">${esc(o.yFmt ? o.yFmt(v) : N(v))}</text>`;
  }
  let xg = '';
  for (const t of (o.xTicks || [])) {
    xg += `<text class="tick" x="${N(sx(t))}" y="${M.t + ih + 22}" text-anchor="middle">${esc(String(t))}</text>`;
  }

  let marks = '';
  o.series.forEach(s => {
    const pts = s.points.map(p => `${N(sx(p[0]))},${N(sy(p[1]))}`).join(' ');
    marks += `<polyline class="ln" points="${pts}" style="stroke:var(--series-${s.slot})"/>`;
    s.points.forEach(p => {
      marks += `<circle class="pt" cx="${N(sx(p[0]))}" cy="${N(sy(p[1]))}" r="5" style="fill:var(--series-${s.slot})"` +
        ` data-tip="${esc(s.label + ' - ' + (o.tipFmt ? o.tipFmt(p) : p[0] + ': ' + p[1]))}"><title>${esc(s.label + ', ' + p[0] + ': ' + p[1])}</title></circle>`;
      if (o.labelPoints !== false) {
        marks += `<text class="ptlab" x="${N(sx(p[0]))}" y="${N(sy(p[1]) - 12)}" text-anchor="middle">${esc(o.ptFmt ? o.ptFmt(p[1]) : String(p[1]))}</text>`;
      }
    });
    // direct label at the series end - identity is never colour-alone
    const last = s.points[s.points.length - 1];
    marks += `<text class="slab" x="${N(sx(last[0]) + 12)}" y="${N(sy(last[1]) + 4)}">${esc(s.label)}</text>`;
  });

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || o.title || '')}</title>
  ${grid}${xg}
  <line class="axis" x1="${M.l}" y1="${M.t + ih}" x2="${M.l + iw}" y2="${M.t + ih}"/>
  ${marks}
</svg>`;
  return svg;
}

/* ------------------------------------------------------------------ horizontal bars */

function barChartH(o) {
  const rows = o.rows;
  const rowH = o.rowH || 34, padT = 8, padB = 26;
  const W = 720, labelW = o.labelW || 210, valW = 74;
  const H = padT + rows.length * rowH + padB;
  const iw = W - labelW - valW - 16;
  const max = o.max || Math.max(...rows.map(r => r.value));

  let bars = '';
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    const w = Math.max(2, (r.value / max) * iw);
    const slot = r.slot || 1;
    bars += `<text class="blab" x="${labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>`;
    // 4px rounded data-end, anchored to the baseline at x=labelW
    const vtext = r.valueText || (o.fmt ? o.fmt(r.value) : String(r.value));
    bars += `<rect class="bar" x="${labelW}" y="${y + 6}" width="${N(w)}" height="${rowH - 14}" rx="4"` +
      ` style="fill:var(--series-${slot})" data-tip="${esc(r.label + ': ' + vtext)}">` +
      `<title>${esc(r.label + ': ' + vtext)}</title></rect>`;
    bars += `<text class="bval" x="${N(labelW + w + 8)}" y="${y + rowH / 2 + 4}">${esc(vtext)}</text>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || o.title || '')}</title>
  <line class="axis" x1="${labelW}" y1="${padT}" x2="${labelW}" y2="${padT + rows.length * rowH}"/>
  ${bars}
</svg>`;
}

/* ------------------------------------------------------------------ small multiples */

/**
 * Small multiples sharing an x axis. This is the correct answer to "two measures of different
 * scale", and NEVER a second y-axis. Each panel keeps its own y scale, which is legitimate precisely
 * because they are separate panels rather than overlaid lines.
 */
function smallMultiples(o) {
  const panels = o.panels;
  const pw = 232, gap = 12, H = o.height || 190;
  const W = panels.length * pw + (panels.length - 1) * gap;
  const M = { t: 30, r: 10, b: 34, l: 44 };
  const iw = pw - M.l - M.r, ih = H - M.t - M.b;

  let out = '';
  panels.forEach((p, pi) => {
    const ox = pi * (pw + gap);
    const ys = p.values.map(v => v[1]);
    const y0 = p.yMin !== undefined ? p.yMin : 0;
    const y1 = p.yMax !== undefined ? p.yMax : Math.max(...ys) * 1.25;
    const xs = p.values.map(v => v[0]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const sx = v => ox + M.l + ((v - xmin) / (xmax - xmin || 1)) * iw;
    const sy = v => M.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

    out += `<text class="pnl" x="${ox + M.l}" y="16">${esc(p.title)}</text>`;
    for (let i = 0; i <= 2; i++) {
      const v = y0 + (i / 2) * (y1 - y0), y = sy(v);
      out += `<line class="grid" x1="${ox + M.l}" y1="${N(y)}" x2="${ox + M.l + iw}" y2="${N(y)}"/>`;
      out += `<text class="tick" x="${ox + M.l - 6}" y="${N(y + 4)}" text-anchor="end">${esc(p.fmt ? p.fmt(v) : N(v))}</text>`;
    }
    const pts = p.values.map(v => `${N(sx(v[0]))},${N(sy(v[1]))}`).join(' ');
    out += `<polyline class="ln" points="${pts}" style="stroke:var(--series-${o.slot || 1})"/>`;
    p.values.forEach(v => {
      out += `<circle class="pt" cx="${N(sx(v[0]))}" cy="${N(sy(v[1]))}" r="4.5" style="fill:var(--series-${o.slot || 1})"` +
        ` data-tip="${esc(p.title + ' ' + v[0] + ': ' + (p.fmt ? p.fmt(v[1]) : v[1]))}"><title>${esc(p.title + ' ' + v[0] + ': ' + v[1])}</title></circle>`;
      out += `<text class="ptlab" x="${N(sx(v[0]))}" y="${N(sy(v[1]) - 10)}" text-anchor="middle">${esc(p.fmt ? p.fmt(v[1]) : String(v[1]))}</text>`;
      out += `<text class="tick" x="${N(sx(v[0]))}" y="${M.t + ih + 20}" text-anchor="middle">${esc(String(v[0]))}</text>`;
    });
    out += `<line class="axis" x1="${ox + M.l}" y1="${M.t + ih}" x2="${ox + M.l + iw}" y2="${M.t + ih}"/>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || '')}</title>${out}</svg>`;
}

/* ------------------------------------------------------------------ slope */

function slopeChart(o) {
  const W = 720, H = o.height || 300;
  const M = { t: 34, r: 150, b: 30, l: 150 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const all = o.series.flatMap(s => [s.from, s.to]);
  const y0 = 0, y1 = Math.max(...all) * 1.15;
  const sy = v => M.t + ih - ((v - y0) / (y1 - y0)) * ih;

  let out = `<text class="pnl" x="${M.l}" y="18" text-anchor="middle">${esc(o.fromLabel)}</text>`;
  out += `<text class="pnl" x="${M.l + iw}" y="18" text-anchor="middle">${esc(o.toLabel)}</text>`;
  out += `<line class="axis" x1="${M.l}" y1="${M.t}" x2="${M.l}" y2="${M.t + ih}"/>`;
  out += `<line class="axis" x1="${M.l + iw}" y1="${M.t}" x2="${M.l + iw}" y2="${M.t + ih}"/>`;

  o.series.forEach(s => {
    const ya = sy(s.from), yb = sy(s.to);
    out += `<line class="ln" x1="${M.l}" y1="${N(ya)}" x2="${M.l + iw}" y2="${N(yb)}" style="stroke:var(--series-${s.slot})"/>`;
    out += `<circle class="pt" cx="${M.l}" cy="${N(ya)}" r="5" style="fill:var(--series-${s.slot})" data-tip="${esc(s.label + ' ' + o.fromLabel + ': ' + s.from + '%')}"><title>${esc(s.label + ' ' + o.fromLabel + ': ' + s.from)}</title></circle>`;
    out += `<circle class="pt" cx="${M.l + iw}" cy="${N(yb)}" r="5" style="fill:var(--series-${s.slot})" data-tip="${esc(s.label + ' ' + o.toLabel + ': ' + s.to + '%')}"><title>${esc(s.label + ' ' + o.toLabel + ': ' + s.to)}</title></circle>`;
    out += `<text class="slab" x="${M.l - 12}" y="${N(ya + 4)}" text-anchor="end">${esc(s.label)} ${esc(String(s.from))}%</text>`;
    out += `<text class="slab" x="${M.l + iw + 12}" y="${N(yb + 4)}">${esc(String(s.to))}%</text>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || '')}</title>${out}</svg>`;
}

/* ------------------------------------------------------------------ tier diagram */

/** Not a chart. The facility network's job here is STRUCTURE, not magnitude - 344 health posts
 *  against 1 national hospital on a linear bar would say nothing except "344 is bigger". */
function tierDiagram(o) {
  const W = 720, rowH = 46, padT = 6;
  const H = padT + o.tiers.length * rowH + 10;
  let out = '';
  o.tiers.forEach((t, i) => {
    const y = padT + i * rowH;
    const inset = i * 34;
    const w = W - 200 - inset * 2;
    out += `<rect class="tier" x="${inset}" y="${y + 4}" width="${w}" height="${rowH - 12}" rx="5"/>`;
    out += `<text class="tierlab" x="${inset + 14}" y="${y + rowH / 2 + 3}">${esc(t.label)}</text>`;
    out += `<text class="tiercount" x="${W - 186}" y="${y + rowH / 2 + 3}">${esc(t.count)}</text>`;
    if (t.note) out += `<text class="tiernote" x="${W - 120}" y="${y + rowH / 2 + 3}">${esc(t.note)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || '')}</title>${out}</svg>`;
}

/* ------------------------------------------------------------------ timeline */

function timeline(o) {
  const W = 720, H = 40 + o.items.length * 46 + 34;
  const x0 = 150, x1 = W - 150;
  const [a, b] = o.domain;
  const sx = v => x0 + ((v - a) / (b - a)) * (x1 - x0);
  let out = '';
  for (let yr = Math.ceil(a); yr <= b; yr++) {
    if ((yr - Math.ceil(a)) % o.tickEvery !== 0) continue;
    out += `<line class="grid" x1="${N(sx(yr))}" y1="26" x2="${N(sx(yr))}" y2="${H - 30}"/>`;
    out += `<text class="tick" x="${N(sx(yr))}" y="${H - 12}" text-anchor="middle">${yr}</text>`;
  }
  if (o.now !== undefined) {
    out += `<line class="nowline" x1="${N(sx(o.now))}" y1="20" x2="${N(sx(o.now))}" y2="${H - 30}"/>`;
    out += `<text class="nowlab" x="${N(sx(o.now))}" y="14" text-anchor="middle">today</text>`;
  }
  o.items.forEach((it, i) => {
    const y = 40 + i * 46;
    out += `<text class="blab" x="${x0 - 14}" y="${y + 4}" text-anchor="end">${esc(it.label)}</text>`;
    const xs = sx(it.start), xe = sx(it.end);
    out += `<rect class="tlbar" x="${N(xs)}" y="${y - 11}" width="${N(Math.max(3, xe - xs))}" height="16" rx="4"` +
      ` style="fill:var(--series-${it.slot || 1})" data-tip="${esc(it.tip || '')}"><title>${esc(it.tip || it.label)}</title></rect>`;
    if (it.after) out += `<text class="tlafter" x="${N(xe + 8)}" y="${y + 3}">${esc(it.after)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-${esc(o.id)}">
  <title id="t-${esc(o.id)}">${esc(o.aria || '')}</title>${out}</svg>`;
}



/* ------------------------------------------------------------------ ASEAN comparators */

/**
 * ASEAN comparison bars, fed from data/comparators.json (written by scripts/pull-comparators.js).
 *
 * WHY FED FROM A CACHE AND NOT TYPED IN: a comparator recalled by a model is the documented failure
 * mode of this project (the 11.4%-of-GDP case, section 5). Every figure here traces to a World Bank
 * API call whose endpoint and pull date are recorded in the cache and rendered in the source line.
 *
 * EACH COUNTRY'S LATEST YEAR DIFFERS - the World Bank does not align them. Hiding that would make
 * the chart read as a like-for-like comparison it is not, so every bar carries its own year, and a
 * value more than 5 years behind the newest in its row is marked with an asterisk that the source
 * line explains. Do not "clean up" the years off the bars.
 */
const fsC = require('fs');
const pathC = require('path');
let _comp = null;
function comparators() {
  if (_comp) return _comp;
  const p = pathC.join(__dirname, '..', '..', 'data', 'comparators.json');
  if (!fsC.existsSync(p)) {
    throw new Error('data/comparators.json is missing - run: node scripts/pull-comparators.js');
  }
  _comp = JSON.parse(fsC.readFileSync(p, 'utf8'));
  return _comp;
}

function comparatorBar(indKey, opts) {
  const o = opts || {};
  const c = comparators();
  const ind = c.indicators.find(i => i.key === indKey);
  if (!ind) throw new Error('comparator indicator not cached: ' + indKey);
  const rows = Object.entries(ind.values)
    .map(([iso, v]) => Object.assign({ iso, name: c.countries[iso] }, v))
    .sort((a, b) => b.value - a.value)
    .map(r => ({
      label: r.name,
      value: r.value,
      // Timor-Leste keeps one colour across every comparison - colour follows the entity
      slot: r.iso === 'TLS' ? 2 : 1,
      valueText: r.value.toFixed(o.dp !== undefined ? o.dp : 1) + '  (' + r.year + (r.stale ? '*' : '') + ')',
    }));
  const svg = (o.panelTitle ? '<p class="fig-panel">' + esc(o.panelTitle) + '</p>' : '') +
    barChartH({ id: o.id || ('cmp-' + indKey), rows, labelW: 150, rowH: 30,
      aria: o.aria || (ind.label + ' across the eleven ASEAN countries, Timor-Leste highlighted.') });
  return { svg, ind, pulled: c.pulled };
}

function comparatorSource(parts) {
  const c = comparators();
  return 'World Bank World Development Indicators, queried ' + esc(c.pulled) + ' (' + parts + '). ' +
    'Each bar carries the year of that country&rsquo;s latest available value - the World Bank does ' +
    'not align them. * = more than 5 years older than the newest value in the row.';
}

/* ------------------------------------------------------------------ images */

/**
 * Third-party images.
 *
 * COMMITTED TO THE REPO, NEVER HOTLINKED. Three reasons, in order of importance: hotlinking
 * Wikimedia at scale is against their guidance; an external image breaks the page's
 * self-contained property, which is what lets it still render years from now; and a remote
 * image can be changed or deleted underneath us without the caption ceasing to claim it.
 *
 * ⚠️ EVERY image here is under a share-alike licence, so the attribution block is not optional
 * decoration - it is the licence condition. Author, licence name and a link to the licence text
 * must all render. Do not "tidy" the credit line away.
 */
function imageFigure(o) {
  return figure({
    id: o.id,
    title: o.title,
    svg: `<img src="${esc(o.src)}" alt="${esc(o.alt)}" loading="lazy" decoding="async">`,
    note: o.note,
    source: `${esc(o.author)}, via <a href="${esc(o.pageUrl)}">Wikimedia Commons</a> &mdash; ` +
            `licensed <a href="${esc(o.licenceUrl)}">${esc(o.licence)}</a>. ` +
            `Retrieved ${esc(o.retrieved)}.${o.sourceExtra ? ' ' + o.sourceExtra : ''}`,
  });
}

/* ------------------------------------------------------------------ the registry */

const CHARTS = {

  'asean-workforce': () => {
    const phys = comparatorBar('physicians', { id: 'cmp-phys', dp: 2, panelTitle: 'Physicians per 1,000 people' });
    const nurs = comparatorBar('nurses', { id: 'cmp-nurs', dp: 2, panelTitle: 'Nurses and midwives per 1,000 people' });
    return figure({
      id: 'asean-workforce',
      title: 'Health workforce density: Timor-Leste against the other ten ASEAN members',
      svg: phys.svg + nurs.svg,
      note: '<b>Timor-Leste is mid-pack, not bottom.</b> On physicians per person it sits 7th of 11 - ' +
        '<b>ahead of Thailand and Indonesia</b> - and 7th on nurses and midwives. Read alongside the ' +
        'outcome comparison in &sect;3, this is why a proposal premised on "too few health workers ' +
        'in aggregate" is arguing with the data as well as with the national assessment: the stated ' +
        'problem is <em>distribution</em>, and the binding constraint is <em>postgraduate</em> training.',
      source: comparatorSource('indicators SH.MED.PHYS.ZS, SH.MED.NUMW.P3'),
    });
  },

  'asean-oop': () => {
    const oop = comparatorBar('oop', { id: 'cmp-oop', dp: 1, panelTitle: 'Out-of-pocket share of health spending (%)' });
    const che = comparatorBar('cheCapita', { id: 'cmp-che', dp: 0, panelTitle: 'Health spending per person (US$)' });
    return figure({
      id: 'asean-oop',
      title: 'Financial protection and spending: Timor-Leste against ASEAN',
      svg: oop.svg + che.svg,
      note: '<b>Timor-Leste has the LOWEST out-of-pocket share in ASEAN</b> - below Brunei, and under a ' +
        'tenth of Myanmar&rsquo;s - which is the free-at-point-of-care system showing up in the money. On ' +
        'spending per person it is 7th of 11, above Indonesia, Cambodia, Myanmar and Laos. Money is not ' +
        'where Timor-Leste is the regional outlier; &sect;3 shows where it is.',
      source: comparatorSource('indicators SH.XPD.OOPC.CH.ZS, SH.XPD.CHEX.PC.CD'),
    });
  },

  'asean-outcomes': () => {
    const u5 = comparatorBar('u5mr', { id: 'cmp-u5', dp: 1, panelTitle: 'Under-5 mortality per 1,000 live births' });
    const mmr = comparatorBar('mmr', { id: 'cmp-mmr', dp: 0, panelTitle: 'Maternal mortality per 100,000 live births' });
    return figure({
      id: 'asean-outcomes',
      title: 'Where Timor-Leste IS the regional outlier: child and maternal survival',
      svg: u5.svg + mmr.svg,
      note: '<b>Worst in ASEAN on both, and on under-5 mortality by a wide margin</b> - 47.6 against ' +
        'next-worst Myanmar&rsquo;s 36.9. Set against mid-pack workforce density (&sect;6), mid-pack ' +
        'spending and the region&rsquo;s best financial protection (&sect;5), the gap between ordinary ' +
        'inputs and worst-in-region outcomes is itself the finding. TB incidence (&sect;3) is second ' +
        'only to the Philippines.',
      source: comparatorSource('indicators SH.DYN.MORT, SH.STA.MMRT'),
    });
  },

  'map-municipalities': () => imageFigure({
    id: 'map-municipalities',
    title: 'The 14 municipality-level units of Timor-Leste',
    src: 'img/tl-municipalities.png',
    alt: 'Political map of Timor-Leste showing its fourteen municipality-level units, each in a different colour: Oecusse as a separate enclave to the west, Atauro as an island to the north, and Dili, Liquica, Ermera, Bobonaro, Cova Lima, Ainaro, Aileu, Manufahi, Manatuto, Baucau, Viqueque and Lautem on the main territory.',
    author: 'J. Patrick Fischer, adapted by Smjg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Municipalities_of_Timor-Leste.png',
    licence: 'CC BY-SA 3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    retrieved: '2026-08-25',
    note: 'Note <b>Atauro shown as a unit in its own right</b> - it separated from Dili on 1 January 2022, and many circulating maps still show it inside Dili and count 13 units. Note also that <b>Oecusse (RAEOA) is a physically separate enclave inside Indonesian West Timor</b>, which is why it is a separate negotiation as well as a separate administration (&sect;2).',
  }),

  /** THE headline finding: two authoritative sources moving in opposite directions. */
  'sba-contradiction': () => figure({
    id: 'sba-contradiction',
    title: 'Skilled birth attendance: the two national data systems disagree, and move in opposite directions',
    svg: legend([{ slot: 1, label: 'DHS (household survey)' }, { slot: 2, label: 'HMIS (routine reporting)' }]) +
      lineChart({
        id: 'sba', aria: 'Line chart. The household survey series rises from 60 percent in 2016 to 78 percent in 2025-26. The routine reporting series falls from 92 percent in 2020 to 56.7 percent in 2024.',
        xDomain: [2015.5, 2026.5], yDomain: [40, 100], yTicks: 3,
        xTicks: [2016, 2018, 2020, 2022, 2024, 2026],
        yFmt: v => N(v) + '%', ptFmt: v => v + '%',
        series: [
          { slot: 1, label: 'DHS', points: [[2016, 60], [2025.5, 78]] },
          { slot: 2, label: 'HMIS', points: [[2020, 92], [2024, 56.7]] },
        ],
      }),
    note: '<b>Do not pick a number.</b> These do not merely differ in level - they contradict each other in direction over an overlapping period. Both are cited by WHO. Presenting this as a data-quality finding is worth more to a partner than either figure.',
    source: 'WHO Country Cooperation Strategy 2026-2030 §2.4.1; TLDHS 2025-26 Key Indicators Report.',
  }),

  /** The denominator problem, as small multiples - never a dual axis. */
  'financing-denominator': () => figure({
    id: 'financing-denominator',
    title: 'Why "health spending as a share of GDP" misleads for Timor-Leste',
    svg: smallMultiples({
      id: 'fin', slot: 1,
      aria: 'Three panels sharing 2021 to 2023. Health spending as a share of GDP rises from 4.92 to 9.60 percent. Spending per capita rises then falls. Total health spending rises then falls. The ratio rises while the dollars fall.',
      panels: [
        { title: 'CHE as % of GDP', values: [[2021, 4.92], [2022, 7.46], [2023, 9.6]], yMin: 0, yMax: 12, fmt: v => N(v) + '%' },
        { title: 'CHE per capita (US$)', values: [[2021, 132], [2022, 175], [2023, 144]], yMin: 0, yMax: 220, fmt: v => '$' + Math.round(v) },
        { title: 'Total health spend (US$m)', values: [[2021, 178], [2022, 240], [2023, 200]], yMin: 0, yMax: 300, fmt: v => Math.round(v) },
      ],
    }),
    note: 'The ratio nearly doubled while total spending <em>fell</em>. It moved because <b>petroleum GDP fell 43% in two years</b> - the denominator moved, not the numerator. Benchmark on <b>US$ per capita</b> and on <b>health as a share of government expenditure</b> instead.',
    source: 'WHO Global Health Expenditure Database, queried 2026-08-24; corroborated by <a href="https://api.worldbank.org/v2/country/TLS/indicator/SH.XPD.CHEX.GD.ZS?format=json">World Bank WDI</a>.',
  }),

  'financing-shares': () => figure({
    id: 'financing-shares',
    title: 'Donor dependence is falling fast; out-of-pocket spending is among the lowest in the world',
    svg: legend([{ slot: 1, label: 'External (donor) share of health spending' }, { slot: 2, label: 'Out-of-pocket share' }]) +
      lineChart({
        id: 'shares', height: 260,
        aria: 'Donor share of health spending falls from 30.7 percent in 2021 to 15.3 percent in 2023, while out-of-pocket spending stays near 6 to 7 percent.',
        xDomain: [2020.8, 2023.2], yDomain: [0, 35], yTicks: 3, xTicks: [2021, 2022, 2023],
        yFmt: v => N(v) + '%', ptFmt: v => v + '%',
        series: [
          { slot: 1, label: 'Donor', points: [[2021, 30.67], [2022, 22.74], [2023, 15.3]] },
          { slot: 2, label: 'Out-of-pocket', points: [[2021, 5.89], [2022, 5.48], [2023, 6.99]] },
        ],
      }),
    note: 'Out-of-pocket spending near <b>7%</b> is the single most distinctive feature of this system, and follows directly from there being <b>no social health insurance</b> and public care being free at the point of use. <b>If your design assumes user fees, co-payments or reimbursement, it does not fit this country.</b>',
    source: 'WHO Global Health Expenditure Database, queried 2026-08-24.',
  }),

  'budget-2026': () => figure({
    id: 'budget-2026',
    title: 'The 2026 health budget: US$138.3 million, 6.04% of the state budget',
    svg: barChartH({
      id: 'budget', labelW: 260, fmt: v => 'US$' + N(v) + 'm',
      aria: 'Horizontal bars. Ministry of Health 76.8 million, national hospital 20.9, medicines agency 17.1, infrastructure fund 6.7, ambulance service 3.4 million.',
      rows: [
        { label: 'Ministry of Health', value: 76.8 },
        { label: 'HNGV (national hospital)', value: 20.9 },
        { label: 'INFPM (medicines)', value: 17.1 },
        { label: 'Infrastructure Fund', value: 6.7 },
        { label: 'SNAEM (ambulance)', value: 3.4 },
        { label: 'Overseas treatment (within the above)', value: 19.3, slot: 2 },
      ],
    }),
    note: 'The highlighted line is not an institution - it is <b>US$19.3m, 14% of the entire health budget, spent treating Timorese patients abroad</b>, and it is the second-largest single line in secondary and tertiary care. It is the financial expression of the workforce finding in §6: there is no domestic specialist pipeline of scale, so specialist care is bought overseas.',
    source: 'General State Budget 2026, Book 1, IX Constitutional Government (approved version), ¶2.35-2.37 - <a href="https://www.mof.gov.tl">Ministry of Finance</a>.',
  }),

  'facility-tiers': () => figure({
    id: 'facility-tiers',
    title: 'The service delivery network',
    svg: tierDiagram({
      id: 'tiers',
      aria: 'Five tiers: one national hospital, one regional hospital, four referral hospitals, about 71 community health centres, 344 health posts, plus community outreach.',
      tiers: [
        { label: 'National (tertiary) hospital - HNGV, Dili', count: '1' },
        { label: 'Regional hospital - Baucau', count: '1' },
        { label: 'Referral hospitals - Maliana, Maubisse, Suai, Oecusse', count: '4' },
        { label: 'Community health centres (SSK, levels I-III)', count: '~71', note: '9-10 are level III' },
        { label: 'Health posts (PS)', count: '344' },
        { label: 'SISCa community outreach', count: '~600', note: 'outposts' },
      ],
    }),
    note: '<b>Baucau is a <em>regional</em> hospital, not a referral hospital</b> - the flat five-item list most documents repeat flattens a real distinction in the referral chain. A further tier of <b>municipal hospitals is planned in NHSSP II but does not yet exist</b> (§4).',
    source: 'WHO Country Cooperation Strategy 2026-2030 §2.3, verbatim; facility totals corroborated by the <a href="https://iris.who.int/handle/10665/386866">WHO NCD and facility-readiness survey 2023</a>.',
  }),

  'nutrition-slope': () => figure({
    id: 'nutrition-slope',
    title: 'Child undernutrition: real improvement, but roughly half of children are still stunted',
    svg: slopeChart({
      id: 'nutr', fromLabel: '2013', toLabel: '2020', height: 280,
      aria: 'Slope chart. Stunting falls from 50.2 to 47.1 percent, underweight from 37.3 to 32.4, wasting from 11 to 8.6.',
      series: [
        { slot: 1, label: 'Stunting', from: 50.2, to: 47.1 },
        { slot: 2, label: 'Underweight', from: 37.3, to: 32.4 },
        { slot: 3, label: 'Wasting', from: 11, to: 8.6 },
      ],
    }),
    note: 'Seven years apart, and stunting moved 3.1 points. <b>Malnutrition, and stunting in particular, remains the stated national priority</b>, and TLDHS 2025-26 also flags persistent malnutrition and maternal anaemia.',
    source: 'Timor-Leste Food and Nutrition Survey 2020, via WHO Country Cooperation Strategy 2026-2030 §2.4.3.',
  }),

  'medical-schools': () => figure({
    id: 'medical-schools',
    title: 'All three medical schools, and when each can first produce a graduate',
    svg: timeline({
      id: 'medschools', domain: [2004, 2032], tickEvery: 4, now: 2026.65,
      items: [
        { slot: 1, label: "UNTL (public)", start: 2004, end: 2026.65, tip: 'Teaching since 2004. The only school with an established graduate output.', after: 'graduating since ~2010' },
        { slot: 2, label: 'Universidade Catolica Timorense', start: 2021, end: 2027.5, tip: 'Teaching since 2021. No graduates yet.', after: 'first graduates ~2027' },
        { slot: 3, label: 'Unpaz University', start: 2024, end: 2029.5, tip: 'Teaching since 2024. No graduates yet; first cohort no earlier than about 2029.', after: 'first graduates ~2029' },
      ],
    }),
    note: '<b>Two of the three began teaching in 2021 and 2024 and have graduated nobody.</b> Bars run from the year instruction began to the earliest plausible first graduation; the projections are arithmetic on a 4.5-to-6-year programme, not announcements. This matters because WHO\'s headline figure of <b>800+ new health professionals a year</b> is <em>gross output across all six training institutions and all professions</em> - it says nothing about how many enter, and stay in, the Timorese health workforce.',
    source: '<a href="https://search.wdoms.org/">World Directory of Medical Schools</a> (WFME/FAIMER), country code 771, queried 2026-08-25. Graduation years are this document\'s arithmetic and are <b>not</b> from the registry.',
  }),
};

function render(id) {
  const fn = CHARTS[id];
  if (!fn) throw new Error(`unknown chart id: ${id}`);
  return fn();
}

function ids() { return Object.keys(CHARTS); }

module.exports = { render, ids, figure, imageFigure, lineChart, barChartH, smallMultiples, slopeChart, tierDiagram, timeline, CHARTS };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.error('FAIL: ' + n + '\n      ' + e.message); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const has = (h, n, m) => { if (!h.includes(n)) throw new Error((m || '') + ' expected to contain ' + JSON.stringify(n)); };

  t('ASEAN: comparator charts render with Timor-Leste highlighted exactly once per panel', () => {
    for (const id of ['asean-workforce', 'asean-oop', 'asean-outcomes']) {
      const h = render(id);
      const highlights = (h.match(/--series-2/g) || []).length;
      eq(highlights, 2, id + ': expected exactly one highlighted bar in each of two panels');
      has(h, 'Timor-Leste');
    }
  });
  t('ASEAN: every bar carries its own year - the WB does not align country years', () => {
    const h = render('asean-workforce');
    const years = (h.match(/\(20[0-9][0-9]\*?\)/g) || []).length;
    if (years < 44) throw new Error('expected a year on all 22 bars (each appears in tip+label), saw ' + years);
  });
  t('ASEAN: a value more than 5y behind its row is starred, and the source explains the star', () => {
    const h = render('asean-workforce');   // Vietnam nurses 2016 vs newest 2023
    has(h, '(2016*)', 'the stale Vietnam nurses value must be starred');
    has(h, 'more than 5 years older', 'the source line must explain the star');
  });
  t('ASEAN: source line carries the pull date and the exact indicator codes', () => {
    const h = render('asean-oop');
    has(h, 'World Bank World Development Indicators, queried 20');
    has(h, 'SH.XPD.OOPC.CH.ZS');
  });
  t('every registered chart renders without throwing', () => {
    for (const id of ids()) { const s = render(id); if (!s || s.length < 200) throw new Error(id + ' produced nothing'); }
  });
  t('EVERY figure carries a source line - Raj 2026-08-25', () => {
    for (const id of ids()) has(render(id), '<p class="fig-src">Source:', id + ' is missing its source');
  });
  t('every figure has an accessible name - an SVG title, or img alt text', () => {
    for (const id of ids()) {
      const h = render(id);
      const ok = h.includes('role="img"') || /<img[^>]*\salt="[^"]+"/.test(h);
      if (!ok) throw new Error(id + ' has no accessible name');
    }
  });
  t('every svg scales via viewBox rather than a fixed width', () => {
    for (const id of ids()) {
      const h = render(id);
      if (!h.includes('<svg')) continue;          // image figures scale via CSS instead
      has(h, 'viewBox=', id);
      if (/<svg[^>]*\swidth="\d/.test(h)) throw new Error(id + ' has a hard-coded pixel width');
    }
  });
  t('NO dual y-axis anywhere - the financing comparison uses small multiples', () => {
    const s = render('financing-denominator');
    has(s, 'class="pnl"', 'expected small-multiple panel titles');
    eq((s.match(/CHE as % of GDP|CHE per capita|Total health spend/g) || []).length >= 3, true, 'expected three separate panels');
  });
  t('multi-series figures carry a legend AND direct labels - identity is never colour-alone', () => {
    for (const id of ['sba-contradiction', 'financing-shares']) {
      const s = render(id);
      has(s, 'fig-legend', id + ' needs a legend');
      has(s, 'class="slab"', id + ' needs direct series labels');
    }
  });
  t('series colours come from the fixed palette slots, never inline hex', () => {
    for (const id of ids()) {
      const s = render(id);
      const inline = s.match(/(?:fill|stroke):\s*#[0-9a-f]{3,6}/gi);
      if (inline) throw new Error(id + ' hard-codes a colour: ' + inline[0]);
    }
  });
  t('slots used stay within the three validated categorical slots', () => {
    for (const id of ids()) {
      const s = render(id);
      const used = [...s.matchAll(/--series-(\d+)/g)].map(m => +m[1]);
      for (const u of used) if (u > 3) throw new Error(id + ' uses slot ' + u + ', beyond the 3 validated for all-pairs');
    }
  });
  t('IMAGE LICENCE: every image figure renders author, licence name and a licence LINK', () => {
    const h = render('map-municipalities');
    has(h, 'J. Patrick Fischer', 'author is a licence condition');
    has(h, 'CC BY-SA 3.0', 'licence name is a licence condition');
    has(h, 'creativecommons.org/licenses/by-sa/3.0/', 'licence link is a licence condition');
    has(h, 'commons.wikimedia.org', 'source page must be linked');
  });
  t('IMAGES are local, never hotlinked to a third-party host', () => {
    for (const id of ids()) {
      const h = render(id);
      const imgs = [...h.matchAll(/<img[^>]*src="([^"]*)"/g)].map(m => m[1]);
      for (const src of imgs) {
        if (/^https?:/i.test(src)) throw new Error(id + ' hotlinks an external image: ' + src);
      }
    }
  });
  t('IMAGES carry substantive alt text, not a filename', () => {
    const h = render('map-municipalities');
    const alt = (/<img[^>]*alt="([^"]*)"/.exec(h) || [])[1] || '';
    if (alt.length < 80) throw new Error('alt text too thin to be useful: ' + alt);
  });
  t('projected dates are labelled as this document arithmetic, not as source data', () => {
    has(render('medical-schools'), 'not</b> from the registry');
  });
  t('text content is escaped so a label cannot inject markup', () => {
    const s = barChartH({ id: 'x', rows: [{ label: '<script>alert(1)</script>', value: 1 }] });
    if (s.includes('<script>')) throw new Error('label was not escaped');
    has(s, '&lt;script&gt;');
  });
  t('unknown chart id throws rather than rendering an empty figure', () => {
    let threw = false;
    try { render('nope'); } catch (e) { threw = true; }
    eq(threw, true);
  });

  console.log(`charts: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
