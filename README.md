# Timor-Leste Health Landscape Scan

Source for a public, quarterly-refreshed orientation document on health and the health system of
Timor-Leste. Built to a single self-contained HTML page and served from GitHub Pages.

**Status: prototype. Not yet reviewed, not yet published.**

## Quick start

```bash
node scripts/build.js            # content/*.md -> docs/index.html
node scripts/build.js --check    # fail if docs/index.html is stale
node scripts/publish.js          # dry run: show what would be committed
node scripts/publish.js --apply  # commit and push (the ONLY publisher)
```

Run all self-tests — each must print `0 failed`:

```bash
node scripts/lib/meta.js --self-test
node scripts/lib/md.js   --self-test
node scripts/build.js    --self-test
node scripts/publish.js  --self-test
```

⚠️ **Assert the failure count, never the pass count.** Pass counts drift upward as checks are added,
and a stale expected number makes a healthy suite read as a regression.

## Layout

```
content/          the document. _meta.json holds the edition metadata and the two honesty dates
docs/             build output. GitHub Pages serves this directory
scripts/          build, publish, and the two libraries
scripts/lib/      meta.js (dates, disclosure, validation) and md.js (markdown subset renderer)
state/            liveness stamp written by publish.js on success only
```

## The two dates — the thing most likely to be broken by a well-meaning edit

Every edition carries **two** dates, and they are not interchangeable:

- **`lastReviewedByHuman`** — when the named editor last signed off.
- **`lastUpdatedByAI`** — when the text last changed, reviewed or not.

The named editor has explicitly allowed AI updates to land **after** a review, so **these diverging is
the normal state, not an error.** When they diverge, the page says so **in words, above the fold**.

⚠️ **That banner is generated from `_meta.json`, never written by hand.** A sentence a human has to
remember to update is a sentence that will eventually be false, and on this document a false
disclosure discredits everything else. Do not replace it with two dates in a footer for the reader to
subtract.

⚠️ **If `reviewer.named` is false, or no review has happened, the document stops calling itself a
"landscape scan"** and describes itself as an "automated compilation of cited sources". That switch is
enforced in `meta.js`, not remembered. The paragraph has to be true.

## Design rules that are load-bearing

1. **The AI never publishes.** It proposes text; `publish.js` commits. That boundary is what makes
   the review model meaningful rather than decorative.
2. **No dependencies.** Not asceticism — this document should still build in 2031 on a machine nobody
   has configured. `md.js` is a ~200-line markdown subset; extend it rather than adding a package.
3. **Numbers are re-pulled from APIs, never recalled.** Two documented cases where a recalled or
   copied figure was wrong are in the document's own §10.
4. **Cited pages are fetched and fingerprinted, not pinged.** A former USAID project domain now serves
   a Bitcoin-casino affiliate site and still returns 200. Status codes are not evidence.
5. **Guards live where the harm occurs.** An unapproved third-party link is refused by the *renderer*,
   not by validation — so the document can still be built while waiting on someone's permission.
6. **Structural tests match code, not comments.** `publish.js` strips comments before searching its
   own source; without that, its assertions found themselves and passed for the wrong reason.
7. **No GitHub Actions cron.** GitHub disables a `schedule:` workflow after 60 days of repository
   inactivity, against a 90-day refresh cadence — it would switch itself off before its second run.

## Refresh pipeline

```
quarterly trigger (scheduled script, no AI)
  1. AI agent session  -> updates content/*.md         (judgement)
  2. node build.js     -> docs/index.html              (deterministic)
  3. node publish.js   -> git commit + push            (sole publisher)
  4. node archive.js   -> Zenodo version + web archive (not yet written)
  5. liveness stamp    -> state/last-publish.json
```

A quarterly job is invisible for 89 days at a time, so `publish.js` writes a liveness stamp and the
page renders **its own staleness banner client-side** — it keeps telling the reader how old it is even
after every piece of automation has died.

## ⚠️ Escalation: bot blocks and login walls stop the run, they do not get skipped

Standing instruction (Raj, 2026-08-25): **if the periodic update hits an anti-bot block or a login
wall, email him and ask for an attended session** for that part of the refresh.

This applies first and foremost to the **Ministry of Health Facebook page**, which is the most current
health-policy source in Timor-Leste and is unreachable to an unattended agent: Facebook refuses plain
HTTP, requires a login in a browser, virtualises its feed so only a few posts exist in the DOM at
once, and interleaves decoy characters into post text specifically to defeat scraping.

**The failure mode being designed against:** a refresh that quietly skips the freshest source while
succeeding everywhere else publishes a page that looks complete and is out of date. So the rule is
**stop and escalate, never skip and continue** — the same principle as the rest of this repo, where a
guard sits at the point the harm would occur and fails closed.

Escalate by **email to the editor**, not by filing into a task queue: `NAs (Attended CC)` is Raj's own
capture list and agents may not create items there.

## Not yet done

- `archive.js` — Zenodo concept DOI and web-archive snapshot
- `pull-data.js` — deterministic indicator re-pull
- `check-links.js` — fetch-and-fingerprint citation checking
- The corrections form, and wiring its URL into `_meta.json`
- Confirming permission to link the shared document library
- A Tetun speaker's check of the machine-translated summary
