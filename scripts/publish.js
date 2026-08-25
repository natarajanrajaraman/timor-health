'use strict';
/**
 * publish.js - the SOLE publisher for this document.
 *
 * WHY THIS EXISTS AS A SEPARATE SCRIPT
 * ----------------------------------------------------------------------------
 * The AI agent that writes the content is not allowed to publish it. That boundary is the whole
 * basis of the review model: an agent can propose text, a deterministic script commits it, and a
 * named human reviews. If the agent could push, the disclosure on the page would be decorative.
 *
 * So this script does no judgement. It verifies, commits, pushes, and stamps liveness. Every
 * decision it makes is a refusal, never an interpretation.
 *
 * DRY RUN IS THE DEFAULT. Pass --apply to actually write.
 *
 * Usage:
 *   node scripts/publish.js                  show what would happen, change nothing
 *   node scripts/publish.js --apply          commit and push
 *   node scripts/publish.js --apply --no-push  commit locally only
 *   node scripts/publish.js --self-test
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'state');
const LIVENESS = path.join(STATE, 'last-publish.json');

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {})).trim();
}

function tryGit(args) {
  try { return { ok: true, out: git(args) }; }
  catch (e) { return { ok: false, out: String((e.stderr || e.stdout || e.message) || '').trim() }; }
}

/**
 * Refusals. Each returns a string reason, or null if the check passes.
 * Deliberately a list rather than inline ifs, so a new refusal is one entry and cannot be
 * accidentally short-circuited by an early return above it.
 */
function preflight(opts) {
  const o = opts || {};
  const reasons = [];

  // 1. The rendered page must match the content. Otherwise we publish a page whose text does not
  //    match the sources it claims, which is the exact failure this whole design is built to avoid.
  const chk = tryGit(['--version']); // cheap probe that git exists at all
  if (!chk.ok) reasons.push('git is not available: ' + chk.out);

  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--check'],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    reasons.push('docs/index.html is out of date relative to content/ - run: node scripts/build.js');
  }

  // 2. Never publish an edition claiming a human review that has not happened. meta.js already
  //    refuses a future review date; this catches the subtler case of a reviewed claim with no date.
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', '_meta.json'), 'utf8'));
  if (meta.reviewer && meta.reviewer.named === true && meta.status === 'published' && !meta.lastReviewedByHuman) {
    reasons.push('meta.status is "published" and a reviewer is named, but lastReviewedByHuman is null - either review it or set reviewer.named to false');
  }

  // 3. A prototype must not be published to a public URL by accident.
  if (meta.status === 'prototype' && !o.allowPrototype) {
    reasons.push('meta.status is "prototype" - pass --allow-prototype to publish it anyway');
  }

  return { reasons, meta };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const noPush = args.includes('--no-push');
  const allowPrototype = args.includes('--allow-prototype');

  const { reasons, meta } = preflight({ allowPrototype });
  if (reasons.length) {
    console.error('PUBLISH REFUSED:');
    for (const r of reasons) console.error('  - ' + r);
    process.exit(2);
  }

  const status = tryGit(['status', '--porcelain']);
  if (!status.ok) { console.error('git status failed: ' + status.out); process.exit(1); }
  const changed = status.out.split('\n').filter(Boolean);

  if (!changed.length) { console.log('nothing to publish - working tree is clean'); return; }

  console.log(`edition ${meta.edition} - ${changed.length} changed path(s):`);
  for (const c of changed.slice(0, 40)) console.log('  ' + c);
  if (changed.length > 40) console.log(`  ... and ${changed.length - 40} more`);

  const msg = `Publish edition ${meta.edition} (text updated ${meta.lastUpdatedByAI})`;

  if (!apply) {
    console.log('\nDRY RUN - nothing written. Would commit with message:');
    console.log('  ' + msg);
    console.log(noPush ? '  (and not push)' : '  (and push to origin)');
    console.log('\nRe-run with --apply to publish.');
    return;
  }

  // Stage deliberately: content, docs, data, scripts, and the repo files. Never `git add -A`.
  for (const p of ['content', 'docs', 'data', 'scripts', 'state', 'README.md', '.gitignore']) {
    if (fs.existsSync(path.join(ROOT, p))) tryGit(['add', '--', p]);
  }

  const commit = tryGit(['commit', '-m', msg]);
  if (!commit.ok && !/nothing to commit/i.test(commit.out)) {
    console.error('commit failed: ' + commit.out); process.exit(1);
  }
  console.log('committed.');

  if (!noPush) {
    const push = tryGit(['push']);
    if (!push.ok) {
      console.error('PUSH FAILED (the commit is safe locally): ' + push.out);
      console.error('If no remote is configured yet, add one and re-run, or use --no-push.');
      process.exit(1);
    }
    console.log('pushed.');
  }

  // Liveness stamp. A quarterly job is invisible for 89 days at a time; something has to be able to
  // notice that it stopped. Written on the SUCCESS path only, so a failed publish does not look live.
  fs.mkdirSync(STATE, { recursive: true });
  const prev = fs.existsSync(LIVENESS) ? JSON.parse(fs.readFileSync(LIVENESS, 'utf8')) : {};
  fs.writeFileSync(LIVENESS, JSON.stringify({
    lastPublish: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), // SGT-pinned
    edition: meta.edition,
    lastUpdatedByAI: meta.lastUpdatedByAI,
    lastReviewedByHuman: meta.lastReviewedByHuman,
    previousPublish: prev.lastPublish || null,
  }, null, 2));
  console.log('liveness stamped: state/last-publish.json');
}

module.exports = { preflight };

/* ------------------------------------------------------------------ self-test */
if (require.main === module && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (n, f) => { try { f(); pass++; } catch (e) { fail++; console.error('FAIL: ' + n + '\n      ' + e.message); } };
  const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  const raw = fs.readFileSync(__filename, 'utf8');

  // Strip the self-test block and ALL comments before searching.
  //
  // Without this, every structural assertion below is self-referential: the string it greps for
  // appears in its own assertion, so the test passes by finding ITSELF. That is not a hypothetical
  // - the first version of this suite reported "never uses git add -A" as FAILING because the
  // phrase appears in this file's own comments, and a guard that matches comments would equally
  // pass a mutation that deleted the real code while leaving the comment behind.
  //
  // Match code, never prose.
  const CODE = (function () {
    let c = raw.slice(0, raw.indexOf('/* ---') > 0 ? raw.indexOf('/* ---') : raw.length);
    c = c.replace(/\/\*[\s\S]*?\*\//g, '');       // block comments
    const NL = String.fromCharCode(10);
    const SLASHES = '/' + '/';
    c = c.split(NL).map(function (l) {
      const k = l.indexOf(SLASHES);
      return k >= 0 ? l.slice(0, k) : l;
    }).join(NL);
    return c;
  })();
  const src = CODE;

  t('dry run is the DEFAULT - --apply is required to write', () => {
    eq(/const apply = args.includes\('--apply'\)/.test(src), true);
    eq(/if \(!apply\)/.test(src), true, 'must branch to dry-run when --apply is absent');
  });
  t('a prototype is refused unless explicitly allowed', () => {
    const r = preflight({ allowPrototype: false });
    const hit = r.reasons.some(x => /prototype/.test(x));
    eq(hit || r.meta.status !== 'prototype', true, 'prototype must be refused while status is prototype');
  });
  t('refuses when the rendered page is stale relative to content', () => {
    eq(/build.js'\), '--check'/.test(src) || /--check/.test(src), true, 'must run build --check');
    eq(/out of date relative to content/.test(src), true);
  });
  t('never uses git add -A', () => {
    eq(/['"]-A['"]/.test(src), false, 'must stage explicit paths only, never -A');
    eq(/\['add', '--', p\]/.test(src), true, 'must stage with an explicit path list');
  });
  t('liveness is stamped on the SUCCESS path only', () => {
    const i = src.indexOf('pushed.');
    const j = src.indexOf('liveness stamped');
    eq(i > 0 && j > i, true, 'the stamp must come after the push succeeds');
  });
  t('liveness date is SGT-pinned, not machine-local', () => {
    eq(/8 \* 3600 \* 1000/.test(src), true, 'must offset to SGT');
    eq(/toLocaleDateString/.test(src), false, 'must not use machine-local formatting');
    eq(/toISOString\(\)\.slice\(0, 10\)/.test(src), true, 'must format via ISO after the offset');
  });
  t('a failed push exits non-zero and says the commit is safe', () => {
    eq(/PUSH FAILED \(the commit is safe locally\)/.test(src), true);
  });
  t('refusals are collected, not short-circuited by an early return', () => {
    const fn = src.slice(src.indexOf('function preflight'), src.indexOf('function main'));
    eq(/return \{ reasons, meta \}/.test(fn), true);
    eq((fn.match(/reasons.push/g) || []).length >= 3, true, 'expected at least three independent refusals');
  });

  t('MUTATION GUARD: the comment stripper actually removes prose', () => {
    eq(/Never .git add -A./.test(raw), true, 'the phrase must exist in this file as prose');
    eq(/Never .git add -A./.test(CODE), false, 'and must NOT survive into the searched code');
  });

  console.log(`publish: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module && !process.argv.includes('--self-test')) main();
