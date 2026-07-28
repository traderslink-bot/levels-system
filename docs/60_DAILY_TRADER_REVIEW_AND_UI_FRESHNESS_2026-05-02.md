# Daily Trader Review And UI Freshness

This file records the eight-part improvement package added after the trader-usefulness replay work. The goal is to make the app easier to review when the market is closed and easier to trust while it is running, without adding unproven Discord noise.

## What Was Added

1. Operator-only daily/deactivation-style recap:
   - `npm run audit:daily-review -- <session-folder-or-discord-delivery-audit.jsonl>`
   - writes `daily-trader-review.json`, `.md`, and `.html`
   - summarizes each symbol's day-level story, main reviewed support/resistance area, final visible story, and review issues
2. Expected post budget by ticker behavior:
   - styles: `low_volume_chop`, `range_bound_small_cap`, `active_runner`, `extreme_runner`, `mixed_or_unknown`
   - budgets are stricter for chop and wider for true runners
3. No-post evidence coverage:
   - reports whether posted rows have enough `whyPosted` evidence to explain why posts reached Discord
   - missing coverage is an audit finding, not Discord text
4. Best/worst replay gallery:
   - `daily-trader-review.html` gives a fast browser skim of best and worst examples per symbol
5. Level-confidence language in first snapshot:
   - snapshots now include a trader-safe `Level context` line
   - examples: nearby levels are well defined, usable, thin, or limited
   - this does not invent levels or expose internal scoring
6. UI-only trade-story visibility:
   - active ticker rows can show the latest known trade-story state and trigger price when available
   - this remains operator UI context, not Discord wording
7. Per-symbol freshness visibility:
   - active ticker rows now show last price, price age, and level age
   - the provider-health panel remains the global feed/seeding view
8. Post timing audit:
   - daily review flags late delivery evidence when `deliveryLagMs` is present
   - it also flags same-minute burst buckets as a practical timing/noise proxy

## Product Boundaries

- The daily recap is operator-only first.
- No automatic end-user Discord recap is posted yet.
- The level-confidence line is trader-facing but intentionally observational.
- The UI can show operator terms such as story state and freshness; Discord should not.
- No support/resistance level is forced or invented to make a report look cleaner.

## Commands

```powershell
npm run audit:daily-review -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run replay:monday -- --skip-slow
```

The Monday checklist now runs the daily trader review automatically for the latest session.

It also now runs `npm run audit:missed-moves -- <latest-session>` so the daily review's quieter-posting recommendations are checked against cached 5-minute candle evidence before live post policy is tightened again.

The checklist also runs `npm run audit:session-behavior -- <latest-session>` so candle freshness, first-post score, thread balance, session behavior profile, candle/post timeline samples, and runtime marker coverage are reviewed together.

## What To Look For

- `over_budget` symbols where style is `low_volume_chop`
- symbols with high same-minute burst counts
- symbols with `missing` no-post evidence coverage
- posts with missing next-level context
- best examples that would be worth preserving as format references
- worst examples that point to the next language or post-policy fix
