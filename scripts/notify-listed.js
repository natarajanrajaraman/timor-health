'use strict';
/**
 * notify-listed.js - tell each listed organisation what this document publishes about them, and how
 * to be removed.
 *
 * WHY
 * ----------------------------------------------------------------------------
 * Section 8 publishes contact details for organisations that never asked to be listed. The details
 * are public and organisational, so this is not a data-protection emergency - but "we found it on
 * your website" is a weak answer to "why am I in your directory?", and the person best placed to
 * correct an entry is the organisation itself. Telling them turns a scraped directory into a
 * maintained one, and gives them a real way out.
 *
 * ⚠️ THIS SENDS EMAIL TO THIRD PARTIES. It is DRY RUN by default and requires TWO flags to send:
 * --apply and --approved. That is deliberate friction: an unsolicited mailout to named organisations
 * is not something an automated pipeline should ever be one typo away from doing.
 *
 * THE FIVE RULES, all of which fail closed:
 *  1. Never write to anyone in data/suppression.json. Checked first, before anything else.
 *  2. Never write more often than MIN_DAYS_BETWEEN, whatever the ledger says changed.
 *  3. Only write when there is a REASON: their entry changed, or the annual re-notice is due.
 *  4. Organisational addresses only - enforced by actors.json, never by this script guessing.
 *  5. The ledger is written on the SUCCESS path only, so a failed send is retried rather than
 *     recorded as delivered.
 *
 * Usage:
 *   node scripts/notify-listed.js                  who WOULD be written to, and why
 *   node scripts/notify-listed.js --preview <id>   print the exact email for one organisation
 *   node scripts/notify-listed.js --apply --approved   actually send
 *   node scripts/notify-listed.js --self-test
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const STATE = path.join(ROOT, 'state');
const LEDGER = path.join(STATE, 'notify-ledger.json');

const MIN_DAYS_BETWEEN = 90;    // never more than once a quarter, whatever changed
const ANNUAL_RENOTICE_DAYS = 365;

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const todaySGT = (nowMs) => new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + SGT_OFFSET_MS)
  .toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const readJson = (p, fallback) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;

/** What we publish about them, hashed. The notice is re-sent when this changes - not when any part
 *  of the wider document changes, which would be noise they never asked for. */
function entryFingerprint(actor) {
  const material = JSON.stringify([actor.name, actor.email, actor.phone, actor.address, actor.web, actor.section]);
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function suppressionIndex(supp) {
  const byId = new Map(), byEmail = new Map();
  for (const s of (supp.suppressed || [])) {
    if (String(s.scope) === 'none') continue;   // withdrawn - history kept, no longer active
    if (s.id) byId.set(s.id, s);
    for (const e of (s.emails || [])) byEmail.set(String(e).toLowerCase(), s);
  }
  return { byId, byEmail };
}

/** Decide, per actor, whether to write and why. Returns a plan; sends nothing. */
function plan(opts) {
  const o = opts || {};
  const today = o.today || todaySGT();
  const actors = (o.actors || readJson(path.join(DATA, 'actors.json'), { actors: [] })).actors || [];
  const supp = o.suppression || readJson(path.join(DATA, 'suppression.json'), { suppressed: [] });
  const ledger = o.ledger || readJson(LEDGER, { entries: {} });
  const idx = suppressionIndex(supp);

  const send = [], skip = [];

  for (const a of actors) {
    const fp = entryFingerprint(a);
    const prev = ledger.entries[a.id] || null;

    // 1. suppression first, always
    const sup = idx.byId.get(a.id) || (a.email && idx.byEmail.get(String(a.email).toLowerCase()));
    if (sup) { skip.push({ id: a.id, reason: 'suppressed', detail: sup.scope }); continue; }

    if (!a.notifiable) { skip.push({ id: a.id, reason: 'not-notifiable', detail: 'no organisational address on record' }); continue; }
    if (!a.email) { skip.push({ id: a.id, reason: 'no-email', detail: 'phone or web only' }); continue; }

    // 2. rate limit, whatever else is true
    if (prev && prev.lastSent && daysBetween(prev.lastSent, today) < MIN_DAYS_BETWEEN) {
      skip.push({ id: a.id, reason: 'rate-limited', detail: `last written to ${prev.lastSent}` });
      continue;
    }

    // 3. is there a reason to write at all?
    let reason = null;
    if (!prev) reason = 'first-notice';
    else if (prev.fingerprint !== fp) reason = 'entry-changed';
    else if (daysBetween(prev.lastSent, today) >= ANNUAL_RENOTICE_DAYS) reason = 'annual-renotice';

    if (!reason) { skip.push({ id: a.id, reason: 'nothing-changed', detail: `last written to ${prev.lastSent}` }); continue; }
    send.push({ id: a.id, actor: a, reason, fingerprint: fp });
  }
  return { today, send, skip };
}

/** The email. Short, specific, and it leads with the two things they might want to do. */
function compose(actor, meta, reason) {
  const url = (meta && meta.canonicalUrl) || '[URL once published]';
  const listed = [
    actor.name ? `  Name:    ${actor.name}` : null,
    actor.email ? `  Email:   ${actor.email}` : null,
    actor.phone ? `  Phone:   ${actor.phone}` : null,
    actor.address ? `  Address: ${actor.address}` : null,
    actor.web ? `  Web:     ${actor.web}` : null,
  ].filter(Boolean).join('\n');

  const opener = reason === 'first-notice'
    ? 'Your organisation is listed in a free, independent guide to health and the health system of Timor-Leste.'
    : reason === 'entry-changed'
      ? 'We have changed what we publish about your organisation in a free, independent guide to health in Timor-Leste.'
      : 'A yearly note: your organisation is still listed in a free, independent guide to health in Timor-Leste.';

  const subject = reason === 'entry-changed'
    ? `Updated entry for ${actor.name} - Timor-Leste health directory`
    : `${actor.name} is listed in the Timor-Leste health landscape scan`;

  const body = `${opener}

WHAT WE PUBLISH ABOUT YOU
${listed}

We took these details from your own published pages (${actor.sourceUrl || 'your website'}), and we
publish organisational contacts only - never an individual's personal mobile or private email.

Read the entry: ${url}

TO CHANGE OR REMOVE IT - reply to this email with one word:

  REMOVE    we take your entry down and never list you again
  CORRECT   tell us what is wrong and we will fix it

REMOVE is honoured in full and permanently. We keep a record of the request so that a later
refresh cannot put you back by mistake.

WHAT THIS IS
An independent, sourced orientation document for people deciding whether and how to act in
Timorese health - so they can work with national priorities and avoid duplicating what is
already being done. It is not official, and carries no government, WHO or institutional
sanction. The text is compiled by an AI agent from public sources and reviewed by a named
editor; the page says which of those applies to the edition you read.

We are not asking you for anything and there is nothing to sign up to.`;

  return { subject, body, to: actor.email };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const approved = args.includes('--approved');
  const previewIdx = args.indexOf('--preview');
  const metaPath = path.join(ROOT, 'content', '_meta.json');
  const meta = readJson(metaPath, {});

  if (previewIdx >= 0) {
    const id = args[previewIdx + 1];
    const actors = readJson(path.join(DATA, 'actors.json'), { actors: [] }).actors;
    const a = actors.find(x => x.id === id);
    if (!a) { console.error('no such actor id: ' + id); process.exit(1); }
    const m = compose(a, meta, 'first-notice');
    console.log('To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.body);
    return;
  }

  const p = plan({});
  console.log(`notify-listed - ${p.today}\n`);
  console.log(`WOULD WRITE TO ${p.send.length}:`);
  for (const s of p.send) console.log(`  ${s.actor.email.padEnd(34)} ${s.actor.name}  [${s.reason}]`);
  console.log(`\nSKIPPING ${p.skip.length}:`);
  for (const s of p.skip) console.log(`  ${s.id.padEnd(20)} ${s.reason} - ${s.detail}`);

  if (!apply) {
    console.log('\nDRY RUN. Nothing sent.');
    console.log('This writes to third parties: sending needs BOTH --apply and --approved.');
    return;
  }
  if (!approved) {
    console.error('\nREFUSED: --apply given without --approved.');
    console.error('This sends unsolicited email to named organisations. Confirm deliberately.');
    process.exit(2);
  }

  console.error('\nREFUSED: no send transport is wired up yet, deliberately.');
  console.error('Wire the send step to the agent mailbox, and only after the first batch has been');
  console.error('read by a human. The plan above is what it would send; --preview <id> shows the text.');
  process.exit(3);
}

module.exports = { plan, compose, entryFingerprint, suppressionIndex, todaySGT, daysBetween, MIN_DAYS_BETWEEN, ANNUAL_RENOTICE_DAYS };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.error('FAIL: ' + n + '\n      ' + e.message); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const has = (h, n, m) => { if (!h.includes(n)) throw new Error((m || '') + ' expected to contain ' + JSON.stringify(n)); };
  const hasnt = (h, n, m) => { if (h.includes(n)) throw new Error((m || '') + ' expected NOT to contain ' + JSON.stringify(n)); };

  const A = (over) => Object.assign({ id: 'x', name: 'X Org', email: 'info@x.org', phone: null,
    address: null, web: 'https://x.org', sourceUrl: 'https://x.org', section: '08', notifiable: true }, over || {});
  const P = (actors, supp, ledger, today) => plan({
    actors: { actors }, suppression: { suppressed: supp || [] },
    ledger: { entries: ledger || {} }, today: today || '2026-08-25' });

  t('a never-contacted organisation gets a first notice', () => {
    const r = P([A()]);
    eq(r.send.length, 1); eq(r.send[0].reason, 'first-notice');
  });
  t('SUPPRESSION BY ID wins over everything else', () => {
    const r = P([A()], [{ id: 'x', scope: 'listing-and-contact' }]);
    eq(r.send.length, 0);
    eq(r.skip[0].reason, 'suppressed');
  });
  t('SUPPRESSION BY EMAIL works even when the id changed', () => {
    const r = P([A({ id: 'renamed' })], [{ id: 'old-id', emails: ['INFO@X.ORG'], scope: 'contact-only' }]);
    eq(r.send.length, 0, 'email match must be case-insensitive');
  });
  t('a WITHDRAWN suppression (scope none) no longer blocks', () => {
    const r = P([A()], [{ id: 'x', scope: 'none' }]);
    eq(r.send.length, 1);
  });
  t('rate limit blocks a re-send inside the window even when the entry changed', () => {
    const r = P([A({ phone: '+670 1' })], [], { x: { lastSent: '2026-08-01', fingerprint: 'stale' } });
    eq(r.send.length, 0);
    eq(r.skip[0].reason, 'rate-limited');
  });
  t('a changed entry outside the window IS re-notified', () => {
    const r = P([A({ phone: '+670 1' })], [], { x: { lastSent: '2026-01-01', fingerprint: 'stale' } });
    eq(r.send.length, 1); eq(r.send[0].reason, 'entry-changed');
  });
  t('an UNCHANGED entry is not re-notified just because time passed - until the annual notice', () => {
    const fp = entryFingerprint(A());
    const r1 = P([A()], [], { x: { lastSent: '2026-01-01', fingerprint: fp } });
    eq(r1.send.length, 0, 'seven months, unchanged: stay quiet');
    eq(r1.skip[0].reason, 'nothing-changed');
    const r2 = P([A()], [], { x: { lastSent: '2025-01-01', fingerprint: fp } });
    eq(r2.send.length, 1); eq(r2.send[0].reason, 'annual-renotice');
  });
  t('an actor with no email is skipped cleanly, never guessed at', () => {
    const r = P([A({ email: null })]);
    eq(r.send.length, 0); eq(r.skip[0].reason, 'no-email');
  });
  t('notifiable:false is honoured even when an email exists', () => {
    const r = P([A({ notifiable: false })]);
    eq(r.send.length, 0); eq(r.skip[0].reason, 'not-notifiable');
  });
  t('the fingerprint tracks what we PUBLISH, not unrelated fields', () => {
    const a1 = A(), a2 = A({ note: 'an internal note nobody sees' });
    eq(entryFingerprint(a1), entryFingerprint(a2), 'an internal note must not trigger an email');
    eq(entryFingerprint(a1) === entryFingerprint(A({ phone: '+670 9' })), false, 'a published phone must');
  });
  t('the email offers ONE-WORD replies and says REMOVE is permanent', () => {
    const m = compose(A(), {}, 'first-notice');
    has(m.body, 'REMOVE'); has(m.body, 'CORRECT');
    has(m.body, 'permanently');
    has(m.body, 'a later');
  });
  t('the email states WHERE the contact came from', () => {
    has(compose(A(), {}, 'first-notice').body, 'https://x.org');
  });
  t('the email never claims official status', () => {
    const b = compose(A(), {}, 'first-notice').body;
    has(b, 'not official');
    hasnt(b, 'endorsed by');
  });
  t('a changed-entry notice reads differently from a first notice', () => {
    const a = compose(A(), {}, 'first-notice'), b = compose(A(), {}, 'entry-changed');
    eq(a.subject === b.subject, false);
    has(b.body, 'have changed');
  });
  t('SENDING REQUIRES TWO FLAGS - dry run is the default', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const code = src.slice(0, src.indexOf('/* ---'));
    eq(/if \(!apply\)/.test(code), true, 'must branch to dry run');
    eq(/apply && !approved|!approved/.test(code), true, 'must require a second confirmation');
  });

  console.log(`notify-listed: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && !process.argv.includes('--self-test')) main();
