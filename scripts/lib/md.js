'use strict';
/**
 * md.js - a small, dependency-free Markdown subset renderer.
 *
 * WHY NOT A LIBRARY
 * ----------------------------------------------------------------------------
 * This document is meant to still build and still be citable years from now, maintained by whoever
 * inherits it, on a machine nobody has configured. Every npm dependency is a thing that can rot,
 * change its API, or pull a supply chain behind it. The subset below is all this document uses, and
 * it is ~200 lines that anyone can read.
 *
 * SUPPORTED: headings, paragraphs, bold/italic/code, links, images, unordered + ordered lists,
 * tables, blockquotes, horizontal rules, fenced code.
 * NOT SUPPORTED (deliberately): raw HTML passthrough, nested lists beyond one level, footnotes,
 * reference links. If a content file needs one of these, extend this file rather than reaching for
 * a dependency - and add a case to the self-test.
 *
 * SECURITY: all text is HTML-escaped before any inline formatting is applied, and link hrefs are
 * scheme-checked. Content is authored by an AI agent from scraped sources, so treating it as
 * untrusted is not paranoia - a javascript: URL landing in a citation would be a real defect.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http, https and mailto may appear in a rendered href. Everything else becomes inert text. */
function safeHref(url) {
  const u = String(url).trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^#/.test(u)) return u;
  if (/^\//.test(u)) return u;
  return null;
}

function inline(src) {
  let s = escapeHtml(src);

  // code spans first - their content must not be further formatted
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000CODE' + (codes.length - 1) + '\u0000';
  });

  // images before links (same bracket shape)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, url, title) => {
    const h = safeHref(url);
    if (!h) return alt;
    return `<img src="${h}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`;
  });

  // links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const h = safeHref(url);
    if (!h) return text;
    const ext = /^https?:/i.test(h);
    return `<a href="${h}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
  });

  // Bold, then italic - bold first so ** is not eaten by *.
  //
  // The content class deliberately allows nested single asterisks, so **A - *B*** works. An earlier
  // [^*]+ version silently failed on every bold span containing an italic, leaving raw ** in the
  // rendered page (8 of them, including in the actor map). The closing (?!\*) is what makes the
  // trailing *** of "**A - *B***" bind as italic-close + bold-close rather than the reverse.
  s = s.replace(/\*\*(.+?)\*\*(?!\*)/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // restore code spans
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => `<code>${escapeHtml(codes[+i])}</code>`);

  return s;
}

function slug(text) {
  return String(text).toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim().replace(/\s+/g, '-').slice(0, 80);
}

function splitRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

function render(md, opts) {
  const o = opts || {};
  const headingOffset = o.headingOffset || 0;
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  const flushPara = (buf) => {
    if (!buf.length) return;
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
    buf.length = 0;
  };

  let para = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      flushPara(para);
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(para); out.push('<hr>'); i++; continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(para);
      const level = Math.min(6, h[1].length + headingOffset);
      const text = h[2].trim();
      const id = o.slugPrefix ? `${o.slugPrefix}-${slug(text)}` : slug(text);
      headings.push({ level, text: text.replace(/\*\*/g, ''), id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara(para);
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, '')); i++; }
      const innerHtml = render(body.join('\n'), Object.assign({}, o, { _noToc: true })).html;
      out.push(`<blockquote>${innerHtml}</blockquote>`);
      continue;
    }

    // table - a header row followed by a separator row
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      flushPara(para);
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') { rows.push(splitRow(lines[i])); i++; }
      const th = header.map((c, n) => `<th${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${inline(c)}</th>`).join('');
      const tb = rows.map(r => '<tr>' + header.map((_, n) =>
        `<td${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${inline(r[n] === undefined ? '' : r[n])}</td>`).join('') + '</tr>').join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    // lists
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara(para);
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const m2 = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!m2) {
          // continuation line, indented
          if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        items.push(m2[1]);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && ol[1] !== '1' ? ` start="${parseInt(ol[1], 10)}"` : '';
      out.push(`<${tag}${start}>` + items.map(it => `<li>${inline(it)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // blank
    if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }

    para.push(line.trim());
    i++;
  }
  flushPara(para);

  return { html: out.join('\n'), headings };
}

module.exports = { render, inline, escapeHtml, safeHref, slug };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL: ' + name + '\n      ' + e.message); } };
  const has = (h, needle, m) => { if (!h.includes(needle)) throw new Error((m || '') + ' expected to contain ' + JSON.stringify(needle) + '\n      in: ' + h.slice(0, 400)); };
  const hasnt = (h, needle, m) => { if (h.includes(needle)) throw new Error((m || '') + ' expected NOT to contain ' + JSON.stringify(needle) + '\n      in: ' + h.slice(0, 400)); };
  const R = (s, o) => render(s, o).html;

  t('escapes HTML in ordinary text', () => {
    has(R('a <script>alert(1)</script> b'), '&lt;script&gt;');
    hasnt(R('a <script>alert(1)</script> b'), '<script>');
  });
  t('headings get ids and are collected', () => {
    const r = render('## Health status');
    has(r.html, '<h2 id="health-status">');
    if (r.headings.length !== 1) throw new Error('expected 1 heading');
  });
  t('headingOffset shifts levels', () => { has(R('# Top', { headingOffset: 1 }), '<h2 '); });
  t('bold and italic', () => {
    has(R('**b** and *i*'), '<strong>b</strong>');
    has(R('**b** and *i*'), '<em>i</em>');
  });
  t('code spans are not further formatted', () => {
    has(R('`**not bold**`'), '<code>**not bold**</code>');
  });
  t('links render with rel=noopener for external', () => {
    has(R('[WHO](https://who.int)'), 'rel="noopener noreferrer"');
    has(R('[WHO](https://who.int)'), 'href="https://who.int"');
  });
  t('SECURITY: javascript: hrefs are neutralised to plain text', () => {
    const h = R('[click](javascript:alert(1))');
    hasnt(h, 'javascript:', 'must not emit a javascript: href');
    hasnt(h, '<a ', 'must not emit a link at all');
    has(h, 'click');
  });
  t('SECURITY: data: hrefs are neutralised', () => {
    hasnt(R('[x](data:text/html,<script>1</script>)'), '<a ');
  });
  t('anchor and root-relative links are allowed', () => {
    has(R('[a](#sec)'), 'href="#sec"');
    has(R('[b](/docs/x)'), 'href="/docs/x"');
  });
  t('unordered list', () => { has(R('- one\n- two'), '<ul><li>one</li><li>two</li></ul>'); });
  t('ordered list', () => { has(R('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>'); });
  t('table with alignment and a wrapper for horizontal scroll', () => {
    const h = R('| A | B |\n|---|--:|\n| 1 | 2 |');
    has(h, '<div class="table-wrap">');
    has(h, '<th>A</th>');
    has(h, 'style="text-align:right"');
    has(h, '<td>1</td>');
  });
  t('table with a short row does not crash and pads cells', () => {
    const h = R('| A | B |\n|---|---|\n| 1 |');
    has(h, '<td></td>');
  });
  t('blockquote renders nested markdown', () => {
    has(R('> **bold** quote'), '<blockquote>');
    has(R('> **bold** quote'), '<strong>bold</strong>');
  });
  t('fenced code is escaped and not formatted', () => {
    const h = R('```\n<b>**x**</b>\n```');
    has(h, '&lt;b&gt;');
    hasnt(h, '<strong>');
  });
  t('horizontal rule', () => { has(R('---'), '<hr>'); });
  t('paragraphs join wrapped lines', () => {
    has(R('one\ntwo\n\nthree'), '<p>one two</p>');
    has(R('one\ntwo\n\nthree'), '<p>three</p>');
  });
  t('image renders with lazy loading', () => {
    has(R('![alt](https://x/y.png)'), '<img src="https://x/y.png" alt="alt"');
    has(R('![alt](https://x/y.png)'), 'loading="lazy"');
  });
  t('image with an unsafe src degrades to alt text', () => {
    hasnt(R('![alt](javascript:1)'), '<img');
  });
  t('quotes inside text are escaped so attributes cannot break out', () => {
    has(R('say "hi"'), '&quot;hi&quot;');
  });
  t('REGRESSION: bold containing italic renders both, leaving no raw asterisks', () => {
    const h = R("**RHTO - *Ra'es Hadomi Timor Oan*** - disability association.");
    hasnt(h, '*', 'no raw asterisk may survive');
    has(h, '<strong>');
    has(h, '<em>');
  });
  t('REGRESSION: bold with a parenthesised italic inside', () => {
    const h = R('a **textbook (*Matadalan*)**, a **trainer manual**');
    hasnt(h, '*');
    has(h, '<em>Matadalan</em>');
    has(h, '<strong>trainer manual</strong>');
  });
  t('REGRESSION: bold spanning an italic mid-sentence', () => {
    const h = R('**Community health centres (CHCs, *Sentru Sercen* - SSK)** operate at three levels');
    hasnt(h, '*');
    has(h, 'operate at three levels');
  });
  t('two separate bold spans do not merge into one', () => {
    const h = R('**a** and **b**');
    has(h, '<strong>a</strong> and <strong>b</strong>');
  });
  t('bold does not swallow across a paragraph boundary', () => {
    const h = R(['**a** one', '', 'two **b**'].join(String.fromCharCode(10)));
    has(h, '<strong>a</strong>');
    has(h, '<strong>b</strong>');
  });
  t('slugPrefix namespaces heading ids across sections', () => {
    has(R('## Overview', { slugPrefix: 's03' }), 'id="s03-overview"');
  });

  console.log(`md: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
