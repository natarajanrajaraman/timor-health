'use strict';
/**
 * meta.js - edition metadata, the two honesty dates, and the invariants that protect them.
 *
 * WHY THIS FILE IS STRICT
 * ----------------------------------------------------------------------------
 * The whole credibility of this document rests on it telling the reader how much to trust it.
 * Raj is the named reviewer AND he allowed AI updates to land after his review (2026-08-25), so
 * "text is newer than the last human review" is the NORMAL state here, not an exception. A design
 * that renders two dates in a footer and lets the reader subtract them will, in practice, mislead.
 *
 * So the divergence is computed here, once, and the banner is generated from it - never written by
 * hand into a content file where it can go stale or be deleted.
 *
 * Errors THROW rather than degrade. A landscape scan that builds with a broken disclosure is worse
 * than one that does not build: the failure is invisible in the output.
 */

const fs = require('fs');
const path = require('path');

/** Timor-Leste and Singapore are both UTC+9 / UTC+8 respectively; we pin to SGT (+08:00) because
 *  the machine that builds this travels (~40% of the time) and machine-local is therefore unstable.
 *  Deliberately NOT toLocaleDateString and deliberately NOT the TZ env var - Node on Windows
 *  largely ignores TZ, so a test using it passes while proving nothing. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function todaySGT(nowMs) {
  const ms = (typeof nowMs === 'number') ? nowMs : Date.now();
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(v) {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * The single definition of review state. Everything downstream (banner text, CSS class, the
 * machine-readable annex) derives from this - so there is exactly one place to get it wrong.
 */
function reviewState(meta, todayIso) {
  const today = todayIso || todaySGT();
  const reviewed = meta.lastReviewedByHuman;
  const updated = meta.lastUpdatedByAI;

  if (!meta.reviewer || meta.reviewer.named !== true) return 'no-named-reviewer';
  if (!reviewed) return 'never-reviewed';
  if (!updated) return 'reviewed';
  if (daysBetween(reviewed, updated) > 0) return 'changed-since-review';
  return 'reviewed';
}

/**
 * Human-facing disclosure. Returned as structured parts so the renderer cannot accidentally
 * drop the load-bearing sentence while keeping the decorative one.
 *
 * NOTE the deliberate asymmetry: when there is no named reviewer the document is NOT allowed to
 * call itself a landscape scan. That was the plan's condition and it is enforced, not remembered.
 */
function disclosure(meta, todayIso) {
  const state = reviewState(meta, todayIso);
  const name = meta.reviewer && meta.reviewer.name;

  switch (state) {
    case 'no-named-reviewer':
      return {
        state,
        severity: 'high',
        selfDescription: 'automated compilation of cited sources',
        headline: 'No human reviews each edition of this document.',
        detail: 'The text is generated and updated by an AI agent from the cited sources. No named person checks it before publication. Treat every statement as unverified and follow the citation.',
      };
    case 'never-reviewed':
      return {
        state,
        severity: 'high',
        selfDescription: 'automated compilation of cited sources',
        headline: 'This edition has not yet been reviewed by a human.',
        detail: `It was compiled by an AI agent from the cited sources and is awaiting review by ${name}. Treat every statement as unverified and follow the citation.`,
      };
    case 'changed-since-review':
      return {
        state,
        severity: 'medium',
        selfDescription: 'landscape scan',
        headline: 'This page contains changes that have NOT been reviewed by the named editor.',
        detail: `${name} last reviewed this document on ${meta.lastReviewedByHuman}. An AI agent has updated the text since, on ${meta.lastUpdatedByAI}. Sections changed after the review date are marked individually below.`,
      };
    case 'reviewed':
    default:
      return {
        state,
        severity: 'none',
        selfDescription: 'landscape scan',
        headline: `Reviewed by ${name} on ${meta.lastReviewedByHuman}.`,
        detail: 'The text is drafted and updated by an AI agent from the cited sources, and reviewed by the named editor, who takes editorial responsibility for this edition.',
      };
  }
}

/** Per-section state, same rules, so a reviewed document with one unreviewed section says so. */
function sectionState(section, meta, todayIso) {
  const reviewed = section.lastReviewedByHuman || null;
  const updated = section.lastUpdatedByAI || null;
  if (!meta.reviewer || meta.reviewer.named !== true) return 'no-named-reviewer';
  if (!reviewed) return 'never-reviewed';
  if (updated && daysBetween(reviewed, updated) > 0) return 'changed-since-review';
  return 'reviewed';
}

function staleness(meta, todayIso) {
  const today = todayIso || todaySGT();
  const base = meta.lastUpdatedByAI;
  if (!base) return { level: 'unknown', ageDays: null };
  const age = daysBetween(base, today);
  const r = meta.refresh || {};
  const warn = r.stalenessWarnDays || 120;
  const alarm = r.stalenessAlarmDays || 180;
  if (age >= alarm) return { level: 'alarm', ageDays: age };
  if (age >= warn) return { level: 'warn', ageDays: age };
  return { level: 'fresh', ageDays: age };
}

/** Throws on anything that would produce a dishonest or broken page. */
function validate(meta, opts) {
  const o = opts || {};
  const errs = [];
  const push = (m) => errs.push(m);

  if (!meta || typeof meta !== 'object') throw new Error('meta: not an object');
  if (!meta.title) push('meta.title is required');
  if (!meta.edition) push('meta.edition is required');

  if (!meta.reviewer || typeof meta.reviewer !== 'object') push('meta.reviewer is required');
  else if (meta.reviewer.named === true && !String(meta.reviewer.name || '').trim()) {
    push('meta.reviewer.named is true but meta.reviewer.name is empty - the disclosure would name nobody');
  }

  for (const f of ['lastReviewedByHuman', 'lastUpdatedByAI']) {
    const v = meta[f];
    if (v !== null && v !== undefined && !isIsoDate(v)) push(`meta.${f} must be YYYY-MM-DD or null, got ${JSON.stringify(v)}`);
  }
  if (!meta.lastUpdatedByAI) push('meta.lastUpdatedByAI is required - without it the staleness banner cannot render');

  const today = o.today || todaySGT();
  if (meta.lastReviewedByHuman && isIsoDate(meta.lastReviewedByHuman) && daysBetween(today, meta.lastReviewedByHuman) > 0) {
    push(`meta.lastReviewedByHuman (${meta.lastReviewedByHuman}) is in the future relative to ${today} - a review that has not happened cannot be claimed`);
  }

  if (!Array.isArray(meta.sections) || meta.sections.length === 0) push('meta.sections must be a non-empty array');
  else {
    const seen = new Set();
    for (const s of meta.sections) {
      if (!s.id) push('a section is missing id');
      if (seen.has(s.id)) push(`duplicate section id ${s.id}`);
      seen.add(s.id);
      if (!s.file) push(`section ${s.id} is missing file`);
      if (!s.title) push(`section ${s.id} is missing title`);
      for (const f of ['lastReviewedByHuman', 'lastUpdatedByAI']) {
        const v = s[f];
        if (v !== null && v !== undefined && !isIsoDate(v)) push(`section ${s.id}.${f} must be YYYY-MM-DD or null`);
      }
      if (s.lastReviewedByHuman && daysBetween(today, s.lastReviewedByHuman) > 0) {
        push(`section ${s.id}.lastReviewedByHuman is in the future`);
      }
    }
  }

  // The reference library belongs to someone else.
  //
  // This is a WARNING, not an error, and the distinction is deliberate. buildHtml() already omits
  // the link entirely unless linkApproved is true, so an unapproved link cannot reach the page - the
  // safety property is enforced by the renderer, where it belongs. Making it a build-breaking error
  // as well would mean the document cannot be built AT ALL while waiting on someone else's reply,
  // which is a worse failure than shipping without one optional footer link.
  //
  // The general rule: a guard belongs at the point where the harm would occur. Here that is
  // rendering, not validation.
  const warns = [];
  const rl = meta.referenceLibrary;
  if (rl && rl.url && rl.ownedByUs === false && rl.linkApproved !== true) {
    warns.push('referenceLibrary.linkApproved is not true - the document library link will NOT be rendered. Set linkApproved once the owner confirms permission to link.');
  }

  if (errs.length) {
    const e = new Error('meta validation failed:\n  - ' + errs.join('\n  - '));
    e.errors = errs;
    throw e;
  }
  return { ok: true, warnings: warns };
}

function load(metaPath, opts) {
  const p = metaPath || path.join(__dirname, '..', '..', 'content', '_meta.json');
  const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
  const v = validate(meta, opts);
  Object.defineProperty(meta, '__warnings', { value: v.warnings || [], enumerable: false });
  return meta;
}

module.exports = { todaySGT, isIsoDate, daysBetween, reviewState, disclosure, sectionState, staleness, validate, load, SGT_OFFSET_MS };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (name, fn) => {
    try { fn(); pass++; }
    catch (e) { fail++; console.error('FAIL: ' + name + '\n      ' + e.message); }
  };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const throws = (fn, re, m) => {
    let threw = false, msg = '';
    try { fn(); } catch (e) { threw = true; msg = e.message; }
    if (!threw) throw new Error((m || '') + ' expected a throw, got none');
    if (re && !re.test(msg)) throw new Error((m || '') + ' throw message did not match ' + re + ': ' + msg);
  };

  const base = () => ({
    title: 'T', edition: 'E',
    reviewer: { named: true, name: 'Dr Natarajan Rajaraman' },
    lastReviewedByHuman: '2026-08-01',
    lastUpdatedByAI: '2026-08-25',
    refresh: { cadenceDays: 90, stalenessWarnDays: 120, stalenessAlarmDays: 180 },
    sections: [{ id: '00', file: 'a.md', title: 'A', lastReviewedByHuman: '2026-08-01', lastUpdatedByAI: '2026-08-01' }],
  });

  // --- date pinning
  t('todaySGT is pinned to +08:00, not machine local', () => {
    eq(todaySGT(Date.parse('2026-08-25T15:59:59Z')), '2026-08-25', 'just before SGT midnight');
    eq(todaySGT(Date.parse('2026-08-25T16:00:00Z')), '2026-08-26', 'at SGT midnight');
  });
  t('isIsoDate rejects malformed and impossible dates', () => {
    eq(isIsoDate('2026-08-25'), true);
    eq(isIsoDate('2026-8-25'), false);
    eq(isIsoDate('2026-02-30'), false, 'impossible date');
    eq(isIsoDate(''), false);
    eq(isIsoDate(null), false);
  });

  // --- the load-bearing behaviour: divergence is detected and named
  t('reviewState: AI update after review => changed-since-review', () => {
    eq(reviewState(base(), '2026-08-25'), 'changed-since-review');
  });
  t('reviewState: review on the same day as update counts as reviewed', () => {
    const m = base(); m.lastReviewedByHuman = '2026-08-25';
    eq(reviewState(m, '2026-08-25'), 'reviewed');
  });
  t('reviewState: review AFTER the update counts as reviewed', () => {
    const m = base(); m.lastReviewedByHuman = '2026-08-26';
    eq(reviewState(m, '2026-08-27'), 'reviewed');
  });
  t('reviewState: no review yet => never-reviewed', () => {
    const m = base(); m.lastReviewedByHuman = null;
    eq(reviewState(m, '2026-08-25'), 'never-reviewed');
  });
  t('reviewState: reviewer not named => no-named-reviewer, whatever the dates say', () => {
    const m = base(); m.reviewer = { named: false };
    eq(reviewState(m, '2026-08-25'), 'no-named-reviewer');
  });

  // --- the disclosure must change what the document CALLS ITSELF, not just its tone
  t('disclosure: unreviewed document may NOT call itself a landscape scan', () => {
    const m = base(); m.lastReviewedByHuman = null;
    eq(disclosure(m, '2026-08-25').selfDescription, 'automated compilation of cited sources');
  });
  t('disclosure: unnamed reviewer may NOT call itself a landscape scan', () => {
    const m = base(); m.reviewer = { named: false };
    eq(disclosure(m, '2026-08-25').selfDescription, 'automated compilation of cited sources');
  });
  t('disclosure: reviewed document may call itself a landscape scan', () => {
    const m = base(); m.lastReviewedByHuman = '2026-08-25';
    eq(disclosure(m, '2026-08-25').selfDescription, 'landscape scan');
  });
  t('disclosure: divergence headline states it in words, not as two dates', () => {
    const d = disclosure(base(), '2026-08-25');
    eq(/NOT been reviewed/.test(d.headline), true, 'headline must say it plainly');
    eq(d.severity, 'medium');
    eq(d.detail.includes('2026-08-01') && d.detail.includes('2026-08-25'), true, 'detail carries both dates');
  });
  t('disclosure: named reviewer appears in the reviewed headline', () => {
    const m = base(); m.lastReviewedByHuman = '2026-08-25';
    eq(disclosure(m, '2026-08-25').headline.includes('Dr Natarajan Rajaraman'), true);
  });

  // --- per-section
  t('sectionState mirrors document rules', () => {
    const m = base();
    eq(sectionState({ lastReviewedByHuman: '2026-08-01', lastUpdatedByAI: '2026-08-20' }, m), 'changed-since-review');
    eq(sectionState({ lastReviewedByHuman: '2026-08-20', lastUpdatedByAI: '2026-08-20' }, m), 'reviewed');
    eq(sectionState({ lastReviewedByHuman: null, lastUpdatedByAI: '2026-08-20' }, m), 'never-reviewed');
  });

  // --- staleness
  t('staleness crosses warn and alarm at the configured ages', () => {
    const m = base();
    eq(staleness(m, '2026-08-25').level, 'fresh');
    eq(staleness(m, '2026-12-23').level, 'warn', '120 days');
    eq(staleness(m, '2027-02-21').level, 'alarm', '180 days');
  });

  // --- validation refusals
  t('validate rejects a future review date', () => {
    const m = base(); m.lastReviewedByHuman = '2027-01-01';
    throws(() => validate(m, { today: '2026-08-25' }), /future/);
  });
  t('validate rejects named:true with an empty name', () => {
    const m = base(); m.reviewer = { named: true, name: '  ' };
    throws(() => validate(m, { today: '2026-08-25' }), /name is empty/);
  });
  t('validate rejects a missing lastUpdatedByAI', () => {
    const m = base(); m.lastUpdatedByAI = null;
    throws(() => validate(m, { today: '2026-08-25' }), /lastUpdatedByAI is required/);
  });
  t('validate rejects duplicate section ids', () => {
    const m = base(); m.sections.push({ id: '00', file: 'b.md', title: 'B' });
    throws(() => validate(m, { today: '2026-08-25' }), /duplicate section id/);
  });
  t('validate rejects a malformed section date', () => {
    const m = base(); m.sections[0].lastUpdatedByAI = '25-08-2026';
    throws(() => validate(m, { today: '2026-08-25' }), /must be YYYY-MM-DD/);
  });
  t('validate WARNS but does not throw on an unapproved third-party link', () => {
    const m = base();
    m.referenceLibrary = { url: 'https://drive.google.com/x', ownedByUs: false, linkApproved: false };
    const v = validate(m, { today: '2026-08-25' });
    eq(v.warnings.length, 1, 'expected exactly one warning');
    eq(/linkApproved is not true/.test(v.warnings[0]), true);
  });
  t('validate is silent once the third-party link is approved', () => {
    const m = base();
    m.referenceLibrary = { url: 'https://drive.google.com/x', ownedByUs: false, linkApproved: true };
    eq(validate(m, { today: '2026-08-25' }).warnings.length, 0);
  });
  t('an unapproved link must NOT block the build - the guard that matters is in the renderer', () => {
    const m = base();
    m.referenceLibrary = { url: 'https://drive.google.com/SECRET', ownedByUs: false, linkApproved: false };
    eq(validate(m, { today: '2026-08-25' }).ok, true, 'build must remain possible while awaiting permission');
  });
  t('validate passes a well-formed meta', () => { eq(validate(base(), { today: '2026-08-25' }).ok, true); });

  console.log(`meta: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
