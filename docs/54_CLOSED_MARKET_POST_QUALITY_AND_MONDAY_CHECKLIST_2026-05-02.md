# Closed-Market Post Quality And Monday Checklist

This file is for Codex to use when the market is closed and the app cannot be tested with fresh live prints. The goal is to keep improving trader-facing Discord output with saved data, replay simulation, and static wording checks, then give Monday's live run a tighter checklist.

## What Was Added

- Trader post quality grader:
  - `src/lib/review/trader-post-quality-grader.ts`
  - `src/scripts/run-trader-post-quality-grader.ts`
  - npm script: `npm run quality:posts`
- The normal Discord audit report generator now writes:
  - `trader-post-quality-report.json`
  - `trader-post-quality-report.md`
- Trader usefulness replay scoring now writes:
  - `trader-usefulness-replay-score.json`
  - `trader-usefulness-replay-score.md`
  - this report labels saved posts as useful change, early context, repeat noise, late, or missing context, and adds ticker personality plus ladder-confidence evidence
- Daily trader review now writes:
  - `daily-trader-review.json`
  - `daily-trader-review.md`
  - `daily-trader-review.html`
  - this report gives an operator-only recap, expected post budget, no-post evidence coverage, best/worst examples, and post timing flags
- The all-symbol stress report now includes quiet-profile evidence:
  - total quiet-mode simulated rows
  - per-symbol quiet totals
  - max quiet posts per session
  - a `Quiet-Mode Replay Attention` section for symbols still above budget under quiet mode
- The all-symbol stress report now assigns a symbol-style budget:
  - `low_priced_chop`
  - `range_bound_small_cap`
  - `active_runner`
  - `extreme_runner`
  - `mixed_or_unknown`
  - each style gets its own expected max-post budget so a real runner is not judged the same way as a tight low-priced chop ticker
- Discord audit rows now carry operator-only proof fields:
  - `whyPosted`
  - `postBudgetSymbolType`
  - `noLevelReason`
  - these fields are for audits and the runtime UI, not trader-facing Discord text
- Fast support/resistance crossed posts now avoid dramatic tiny-move language:
  - old style: `risk stays open toward 1.00`
  - preferred style: `this is still a tight support area; the cleaner story changes on a broader failure or a reclaim`
- Missing-level wording no longer uses `surfaced ladder` in trader-facing posts.
- First snapshot posts now use `Cleaner above` instead of `Room above` so the upside level is framed as a condition/context area, not a prediction.
- The manual UI now includes a `Monday Live Review` panel with:
  - post-budget status
  - critical/optional post counts for the latest 15-minute window
  - the last operator-only `whyPosted` reason
  - per-symbol post-budget rows for the latest 15-minute window
  - a checklist for what to inspect after the next live run
- Closed-market replay can now be run from one command:
  - `npm run replay:monday`
  - use `-- --skip-slow` when you want the core checklist without the slower structure replay passes
- New standalone audit reports:
  - `npm run audit:post-reasons -- <session-folder>`
  - `npm run audit:known-bad-posts -- <session-folder>`
- Discord testing-thread cleanup can now be filtered with `--older-than-days <days>` so archiving/deleting can avoid fresh trade threads.
- Validation candle cache now exposes runtime counters for exact hits, reusable hits, misses, and writes, which makes cache behavior easier to verify in tests and scripts.

## Closed-Market Audit Commands

Use these after code changes or whenever a saved session looks strange:

```powershell
npm run stress:all-symbols
npm run scenario:smallcap
npm run saved-data:test -- --limit 8
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:usefulness -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:daily-review -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:post-reasons -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:known-bad-posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run replay:monday -- --skip-slow
```

For a specific live session:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Review these outputs:

- `artifacts\all-symbol-stress\all-symbol-stress-report.md`
- `artifacts\offline-scenarios\small-cap-scenario-simulation.md`
- `artifacts\long-run\...\trader-post-quality-report.md`
- `artifacts\long-run\...\trader-usefulness-replay-score.md`
- `artifacts\long-run\...\daily-trader-review.md`
- `artifacts\long-run\...\daily-trader-review.html`
- `artifacts\long-run\...\post-reason-audit.md`
- `artifacts\long-run\...\known-bad-post-patterns.md`
- `artifacts\long-run\...\live-post-profile-comparison.md`
- `artifacts\long-run\...\live-post-replay-simulation.md`

## What The Quality Grader Catches

- System-shaped Discord language:
  - `Status:`
  - `Signal:`
  - `Decision area`
  - `setup update`
  - `state recap`
  - `setup move`
  - `alert direction`
  - `surfaced ladder`
- Direct or borderline advice:
  - `Longs should...`
  - `Traders should...`
  - `best entry`
  - `can buy`
  - `should trim`
  - `should exit`
- Over-certain wording:
  - `will go to`
  - `is going to`
  - `confirmed breakout`
  - `no longer immediate resistance`
- Small-cap-naive tiny-risk language:
  - one-cent or tiny-percentage downside framed as a meaningful risk opening
- Missing-level claims:
  - `no higher resistance`
  - `no lower support`
  - `Resistance above: none`
  - operator-only `noLevelReason` metadata, when present
- Repeated story overlap:
  - the same normalized post story appearing several times in one thread

## Monday Live Checklist

1. Start the app and confirm the UI shows fresh `last price` updates.
2. Add only a manageable first batch of symbols.
3. Watch for symbols with repeated touch/cross/reclaim messages inside the same tight range.
4. If a thread crosses above resistance and says higher resistance was not available from the snapshot, check `noLevelReason`, the snapshot audit, and extension-cache evidence before calling it a bug.
5. If a low-priced ticker posts more than its style budget without a meaningful range expansion, mark it for post-policy review.
6. Check the `Monday Live Review` panel for optional-heavy or busy status during the live run.
7. Check the latest `trader-post-quality-report.md` for blocker or major wording findings.
8. Check `thread-story suppressions`, quiet-mode replay counts, and symbol-style post budgets in the all-symbol stress report.
9. Treat old saved-data misses carefully: older audit rows may not contain the newer practical/stable structure metadata or operator-only no-level metadata.

## Acceptance Standard

A post-quality change is not complete unless:

- focused tests pass
- `npm run build` passes
- the quality grader can produce JSON and Markdown
- the all-symbol stress report still runs
- docs explain what changed and how to audit it
