'use strict';
/**
 * refresh-preflight.js - the QUARTERLY TRIGGER. Deterministic, no AI, no publishing.
 *
 * WHAT PROBLEM THIS SOLVES
 * ----------------------------------------------------------------------------
 * The page promises a 90-day refresh and renders its own staleness banner to readers. A promise
 * with no trigger behind it is how a document quietly becomes a liability: the banner starts
 * telling readers it is stale while nothing anywhere tells the editor. So this runs DAILY, decides
 * cheaply whether a refresh is due, and when it is, does all the deterministic groundwork and
 * hands Raj a brief.
 *
 * WHY IT DOES NOT DO THE REFRESH ITSELF - THREE SEPARATE REASONS, ALL BINDING
 * ----------------------------------------------------------------------------
 *  1. Design rule 1 of this repo: the AI never publishes. publish.js is the sole publisher and the
 *     review model is only meaningful because of that boundary.
 *  2. Updating prose around a changed number is judgement. A figure can move because an indicator
 *     was redefined, not because the country changed; pull-data.js reports drift and stops.
 *  3. Raj's standing rule, 2026-08-25: when the refresh hits an anti-bot block or a login wall -
 *     the MoH Facebook page above all - STOP and ask for an attended session. Never skip the
 *     freshest source and publish a complete-looking page. check-links.js now has a `blocked`
 *     class specifically so that condition arrives as a fact in this brief.
 *
 * So the split is: EVERYTHING DETERMINISTIC RUNS UNATTENDED, and the judgement half is escalated
 * to Raj with the groundwork already paid for.
 *
 * THE CHEAP GATE RUNS FIRST. A day on which no refresh is due costs one JSON read and exits 0.
 * There is no model call anywhere in this script.
 *
 * IT EMAILS AT MOST ONCE PER REFRESH CYCLE. The stamp in state/refresh-preflight.json is written
 * on the SUCCESS path only, so a failed run re-fires tomorrow rather than consuming the cycle.
 *
 * Usage:
 *   node scripts/refresh-preflight.js              daily entry point (cheap unless due)
 *   node scripts/refresh-preflight.js --force      run the groundwork regardless of the date
 *   node scripts/refresh-preflight.js --dry-run    say what it would do; sends nothing, stamps nothing
 *   node scripts/refresh-preflight.js --status     print the cadence maths and exit
 *   node scripts/refresh-preflight.js --self-test  offline; asserts the FAILURE count
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'content', '_meta.json');
const STATE = path.join(ROOT, 'state', 'refresh-preflight.json');
const BRIEF_DIR = path.join(ROOT, 'state');

/**
 * How many days BEFORE the refresh falls due to raise it. 14 days, because the judgement half
 * needs an attended session and Raj's calendar does not clear on demand - a notice that arrives
 * on the due date has already made the document late.
 */
const LEAD_DAYS = 14;

/** Emails go through the fleet's single choke point, never a raw gog call. */
const SEND_EMAIL = path.resolve(ROOT, '..', '..', 'workspace', 'scripts', 'email', 'send-email.js');

function today() { return new Date(); }
function ymd(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }

function readMeta() {
  let m;
  try { m = JSON.parse(fs.readFileSync(META, 'utf8')); }
  catch (e) { throw new Error(`_meta.json unreadable (${e.message}) - refusing to guess a cadence`); }
  const r = m.refresh || {};
  if (!Number.isFinite(r.cadenceDays)) throw new Error('_meta.json refresh.cadenceDays missing - refusing to invent one');
  if (!m.lastUpdatedByAI) throw new Error('_meta.json lastUpdatedByAI missing - cannot compute staleness');
  return m;
}

function readState() {
  if (!fs.existsSync(STATE)) return { lastBriefFor: null, lastBriefOn: null, runs: [] };
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch (e) { throw new Error(`refresh-preflight.json unreadable (${e.message})`); }
}

/**
 * The cadence decision, kept pure so the self-test can drive it without touching disk or clock.
 * Returns { due, dueOn, ageDays, daysUntilDue, reason }.
 */
function assess(meta, state, now) {
  const cadence = meta.refresh.cadenceDays;
  const base = new Date(meta.lastUpdatedByAI + 'T00:00:00Z');
  const ageDays = daysBetween(base, now);
  const dueOn = new Date(base.getTime() + cadence * 86400000);
  const daysUntilDue = daysBetween(now, dueOn);
  const cycleKey = `${meta.edition}@${meta.lastUpdatedByAI}`;

  if (state.lastBriefFor === cycleKey) {
    return { due: false, dueOn: ymd(dueOn), ageDays, daysUntilDue, cycleKey,
      reason: `already briefed for this cycle on ${state.lastBriefOn} - one notice per cycle, not one per day` };
  }
  if (daysUntilDue > LEAD_DAYS) {
    return { due: false, dueOn: ymd(dueOn), ageDays, daysUntilDue, cycleKey,
      reason: `not due for ${daysUntilDue} days (lead time is ${LEAD_DAYS})` };
  }
  return { due: true, dueOn: ymd(dueOn), ageDays, daysUntilDue, cycleKey,
    reason: daysUntilDue >= 0 ? `due in ${daysUntilDue} days` : `OVERDUE by ${-daysUntilDue} days` };
}

function runCollector(script, args) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, script), ...(args || [])],
      { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message) };
  }
}

function buildBrief(meta, verdict, results) {
  const L = [];
  L.push(`# TL Health Scan — quarterly refresh ${verdict.daysUntilDue >= 0 ? 'due soon' : 'OVERDUE'}`);
  L.push('');
  L.push(`Edition **${meta.edition}** · text last changed **${meta.lastUpdatedByAI}** · last human review **${meta.lastReviewedByHuman}**`);
  L.push(`Refresh due **${verdict.dueOn}** (${verdict.reason}). Page: ${meta.canonicalUrl}`);
  L.push('');
  L.push('The deterministic groundwork below has already been done. What is left is judgement:');
  L.push('updating prose around any changed figure, and checking the sources an automated client');
  L.push('cannot reach. **The AI does not publish — `publish.js` is the sole publisher.**');
  L.push('');

  const links = results.links;
  if (links && links.report) {
    const c = links.report.counts;
    L.push('## Citations');
    L.push(`ok ${c.ok} · changed ${c.changed} · dead ${c.dead} · blocked ${c.blocked} · unreachable ${c.unreachable} · suspect ${c.suspect} · new ${c.new}`);
    const flag = (state, title) => {
      const rows = links.report.results.filter((r) => r.state === state);
      if (!rows.length) return;
      L.push('');
      L.push(`**${title}**`);
      for (const r of rows) L.push(`- ${r.url}\n  ${r.detail}`);
    };
    flag('suspect', 'SUSPECT — a live domain now serving something else (the healthpolicyplus.com case)');
    flag('dead', 'DEAD — genuinely gone');
    flag('blocked', 'BLOCKED — needs a human in a browser. Per your 2026-08-25 rule this STOPS the refresh; it is not a skip');
    flag('changed', 'CHANGED — the cited page moved; check it still supports the sentence');
  } else {
    L.push('## Citations');
    L.push('⚠️ The link check FAILED to run. That is not a clean result — treat every citation as unchecked.');
  }
  L.push('');

  L.push('## Indicators');
  L.push('```');
  L.push((results.data && results.data.out ? results.data.out : 'pull-data FAILED — figures are unchecked').trim());
  L.push('```');
  L.push('');
  L.push('## Archive');
  L.push('```');
  L.push((results.archive && results.archive.out ? results.archive.out : 'archive step not run').trim());
  L.push('```');
  L.push('');
  L.push('## The one source no automation can reach');
  L.push('The **Ministry of Health Facebook page** is the most current health-policy source in');
  L.push('Timor-Leste and is unreachable to an unattended agent (login wall, virtualised feed,');
  L.push('decoy characters in post text). It has to be read by hand in this refresh.');
  L.push('');
  L.push('## To run the refresh');
  L.push('```');
  L.push('cd C:\\Users\\natar\\.openclaw\\projects\\tl-health-scan');
  L.push('node scripts/pull-data.js          # figures (already run for this brief)');
  L.push('node scripts/check-links.js        # citations (already run for this brief)');
  L.push('#   ... edit content/*.md, bump lastUpdatedByAI in content/_meta.json ...');
  L.push('node scripts/build.js              # content -> docs/index.html');
  L.push('node scripts/publish.js --apply    # the ONLY publisher');
  L.push('node scripts/archive.js            # snapshot the edition you just shipped');
  L.push('```');
  return L.join('\n');
}

function sendBrief(subject, body, dryRun) {
  if (dryRun) return { ok: true, dryRun: true };
  if (!fs.existsSync(SEND_EMAIL)) return { ok: false, error: `send-email.js not found at ${SEND_EMAIL}` };
  const tmp = path.join(BRIEF_DIR, `refresh-brief-${ymd(today())}.md`);
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    execFileSync(process.execPath, [
      SEND_EMAIL, '--routing', 'personal', '--artifact', 'tl-scan-refresh-due',
      '--subject', subject, '--body-file', tmp,
    ], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, briefPath: tmp };
  } catch (e) {
    return { ok: false, error: String((e.stderr || e.stdout || e.message)).slice(0, 500), briefPath: tmp };
  }
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const meta = readMeta();
  const state = readState();
  const verdict = assess(meta, state, today());

  if (argv.includes('--status')) {
    console.log(`edition           ${meta.edition}`);
    console.log(`lastUpdatedByAI   ${meta.lastUpdatedByAI}  (age ${verdict.ageDays} days)`);
    console.log(`cadenceDays       ${meta.refresh.cadenceDays}   leadDays ${LEAD_DAYS}`);
    console.log(`refresh due on    ${verdict.dueOn}  (${verdict.daysUntilDue} days away)`);
    console.log(`briefed already   ${state.lastBriefFor === verdict.cycleKey ? 'yes, on ' + state.lastBriefOn : 'no'}`);
    console.log(`verdict           ${verdict.due ? 'DUE' : 'not due'} - ${verdict.reason}`);
    return 0;
  }

  if (!verdict.due && !force) {
    console.log(`refresh-preflight: not due - ${verdict.reason} (due ${verdict.dueOn})`);
    return 0;   // the cheap path: one JSON read, no network, no model, no mail
  }

  console.log(`refresh-preflight: ${verdict.reason}. Running the deterministic groundwork ...`);
  const results = {};
  results.data = runCollector('pull-data.js', []);
  console.log(`  pull-data:        ${results.data.ok ? 'ok' : 'FAILED'}`);
  results.comparators = runCollector('pull-comparators.js', []);
  console.log(`  pull-comparators: ${results.comparators.ok ? 'ok' : 'FAILED'}`);
  const linkRun = runCollector('check-links.js', []);
  console.log(`  check-links:      ${linkRun.ok ? 'ok' : 'FAILED'}`);
  results.links = { ok: linkRun.ok, out: linkRun.out };
  try {
    results.links.report = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'link-check-latest.json'), 'utf8'));
  } catch (_) { results.links.report = null; }
  results.archive = runCollector('archive.js', ['--check']);
  console.log(`  archive --check:  ${results.archive.ok ? 'ok' : 'reported a gap'}`);

  const body = buildBrief(meta, verdict, results);
  const subject = verdict.daysUntilDue >= 0
    ? `DECIDE: TL Health Scan refresh due ${verdict.dueOn} (in ${verdict.daysUntilDue} days)`
    : `DECIDE: TL Health Scan refresh OVERDUE by ${-verdict.daysUntilDue} days`;

  const sent = sendBrief(subject, body, dryRun);
  if (dryRun) {
    console.log('\n--- DRY RUN, brief not sent, nothing stamped ---\n');
    console.log(body);
    return 0;
  }
  if (!sent.ok) {
    console.error(`refresh-preflight: FAILED to send the brief - ${sent.error}`);
    console.error(`  brief written to ${sent.briefPath} - NOT stamping, so tomorrow's run retries.`);
    return 1;   // no stamp on the failure path: a lost notice must not consume the cycle
  }

  // Stamp on the SUCCESS path only.
  state.lastBriefFor = verdict.cycleKey;
  state.lastBriefOn = ymd(today());
  state.runs = (state.runs || []).slice(-11);
  state.runs.push({ on: state.lastBriefOn, cycleKey: verdict.cycleKey, dueOn: verdict.dueOn });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log(`refresh-preflight: brief sent and stamped for cycle ${verdict.cycleKey}`);
  return 0;
}

// -- self-test (offline; assert the FAILURE count) ---------------------------
function selfTest() {
  let failed = 0, passed = 0;
  const t = (name, cond, detail) => {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); }
  };
  const meta = (lastUpdated, cadence = 90) => ({
    edition: 'E1', lastUpdatedByAI: lastUpdated, lastReviewedByHuman: lastUpdated,
    canonicalUrl: 'https://x.test/', refresh: { cadenceDays: cadence },
  });
  const at = (s) => new Date(s + 'T00:00:00Z');

  t('not due long before the cadence elapses',
    assess(meta('2026-08-25'), {}, at('2026-09-02')).due === false);
  t('DUE once inside the 14-day lead window',
    assess(meta('2026-08-25'), {}, at('2026-11-12')).due === true);
  t('still not due one day outside the lead window',
    assess(meta('2026-08-25'), {}, at('2026-11-08')).due === false);
  t('DUE and reported OVERDUE past the due date', (() => {
    const v = assess(meta('2026-08-25'), {}, at('2026-12-01'));
    return v.due === true && /OVERDUE/.test(v.reason);
  })());

  // One notice per cycle, not one per day - the property that keeps a daily trigger quiet.
  t('already briefed for this cycle -> not due again', (() => {
    const m = meta('2026-08-25');
    const v1 = assess(m, {}, at('2026-11-12'));
    const v2 = assess(m, { lastBriefFor: v1.cycleKey, lastBriefOn: '2026-11-12' }, at('2026-11-13'));
    return v1.due === true && v2.due === false;
  })());

  // ...but a NEW edition must re-arm, or a refreshed page never gets its next notice.
  t('a new edition re-arms the notice', (() => {
    const v1 = assess(meta('2026-08-25'), {}, at('2026-11-12'));
    const v2 = assess(meta('2026-11-12'), { lastBriefFor: v1.cycleKey }, at('2027-02-01'));
    return v2.due === true;
  })());

  t('the cycle key changes when the text changes',
    assess(meta('2026-08-25'), {}, at('2026-11-12')).cycleKey
      !== assess(meta('2026-08-26'), {}, at('2026-11-12')).cycleKey);

  t('a missing cadenceDays THROWS rather than defaulting', (() => {
    try { readMetaLike({ lastUpdatedByAI: '2026-08-25', refresh: {} }); return false; }
    catch (_) { return true; }
  })());
  function readMetaLike(m) {
    const r = m.refresh || {};
    if (!Number.isFinite(r.cadenceDays)) throw new Error('missing');
    if (!m.lastUpdatedByAI) throw new Error('missing');
    return m;
  }
  t('a missing lastUpdatedByAI THROWS rather than defaulting', (() => {
    try { readMetaLike({ refresh: { cadenceDays: 90 } }); return false; } catch (_) { return true; }
  })());

  t('the live _meta.json is readable and drives a real verdict', (() => {
    const v = assess(readMeta(), readState(), today());
    return typeof v.due === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(v.dueOn);
  })());

  t('LEAD_DAYS gives an attended session real notice', LEAD_DAYS >= 7);

  console.log(`\nrefresh-preflight: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    try { process.exit(main(process.argv.slice(2))); }
    catch (e) { console.error('refresh-preflight FAILED:', e.message); process.exit(2); }
  }
}

module.exports = { assess, LEAD_DAYS, readMeta, readState };
