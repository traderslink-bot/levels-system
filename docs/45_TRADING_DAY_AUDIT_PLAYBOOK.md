# Trading Day Audit Playbook

## Purpose

This is the operating checklist Codex should follow after a live trading-day run. The goal is to audit what traders actually saw in Discord, verify support/resistance levels against the fetched historical candles, find missing or misleading levels, identify noisy or repeated posts, and turn real findings into code/tests/docs instead of only making notes.

This audit is trader-view first:

- Discord posts should be useful to long-biased traders.
- Do not evaluate the system as if it serves short sellers.
- Do not add direct buy/sell instructions.
- Do not force support/resistance levels that are not supported by candle evidence.
- Keep operator/test/debug language out of Discord-visible output.

## Inputs To Gather First

1. Confirm the repo is clean enough to work:

```powershell
git status --short
git branch --show-current
```

2. Identify the trading-day session folders:

```powershell
Get-ChildItem artifacts\long-run -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 10 FullName,LastWriteTime
```

3. Identify the latest audit and runtime files:

```powershell
Get-ChildItem artifacts -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 100 FullName,LastWriteTime,Length
```

Important files usually include:

- `discord-delivery-audit.jsonl`
- `manual-watchlist-full.log`
- `manual-watchlist-operational.log`
- `manual-watchlist-diagnostics.log`
- `thread-summaries.json`
- `thread-clutter-report.json`
- `session-review.md`
- `trader-thread-recaps.md`
- `.validation-cache\candles\...`

## Build A Combined Discord Audit File

If there are multiple session folders for the same trading day, combine all relevant `discord-delivery-audit.jsonl` files into one day-level artifact.

Example:

```powershell
Get-Content artifacts\long-run\2026-04-29_*\discord-delivery-audit.jsonl |
  Set-Content artifacts\2026-04-29-combined-discord-delivery-audit.jsonl
```

Then generate the standard report pack:

```powershell
npx tsx src/scripts/generate-discord-audit-reports.ts artifacts\2026-04-29-combined-discord-delivery-audit.jsonl
```

Review these outputs:

- `artifacts\thread-post-policy-report.md`
- `artifacts\snapshot-audit-report.md`
- `artifacts\runner-story-report.md`
- `artifacts\live-post-profile-comparison.md`
- `artifacts\live-post-replay-simulation.md`
- `artifacts\long-run-tuning-suggestions.md`

## Per-Ticker Trader Story Audit

Reconstruct the full story for every ticker from first Discord post to last Discord post.

For each ticker, record:

- first post time and last post time
- first price, last price, low price, and high price from saved posts
- main posted events in order
- whether the thread would make sense to a trader reading it later
- whether the thread clearly showed what needed to hold, reclaim, or clear
- whether the post sequence overexplained a choppy move
- whether the post sequence underexplained a fast move

The trader-story audit should be done even when the level-quality audit is healthy. Good levels can still produce a confusing thread if the posts arrive in the wrong order, repeat too often, or describe the move too confidently.

## Discord Output Audit

For each active ticker, inspect:

- total post count
- post count by kind
- max 5-minute and 10-minute bursts
- repeated story clusters
- AI commentary repeats
- Discord delivery failures
- whether trader-critical delivery failures retried or were clearly surfaced for operator review
- snapshots that showed wrong-side levels
- snapshots with compacted or omitted levels
- level clear/lost posts that sounded too certain
- wording that implies a target instead of a nearby level
- any remaining system-shaped labels

High-priority language failures:

- `alert direction`
- `after the alert`
- `setup move`
- `state update`
- `setup update`
- `Decision area`
- `Status: Cleared`
- `Signal: high severity`
- `mapped support`
- `not a price target`
- `best entry`
- `can buy`
- `should buy`
- `should sell`
- `longs should`
- `traders should`
- short-side framing

When reviewing posts, ask:

- Would a new trader understand this?
- Does it explain what price is testing now?
- Does it clearly say what level needs to hold or reclaim without giving direct advice?
- Does it distinguish support from resistance correctly after a level is lost or reclaimed?
- Does it repeat the same story too many times?
- Does it say `next level` in a way that sounds predictive?
- Does the AI read add value, or does it restate the same alert?

## Activation And Runtime-State Audit

Review every trading-day `session-summary.json`, `thread-summaries.json`, and operational log.

Check:

- activation queued / started / completed counts
- restore started / completed counts
- seed failures
- IBKR failures
- Discord failures
- symbols that appear in state but not in the visible active list
- active/activating/pending counters that do not match the listed tickers
- sessions with `endedAt: null`
- repeated restart patterns
- tickers that repeatedly restored or reseeded instead of cleanly monitoring

Separate findings into:

- transient provider/session problems
- app state drift
- Discord delivery issues
- expected restarts caused by manual testing

## Stock-Context Opener Audit

Review initial stock-context posts for every newly activated ticker.

Check:

- current price appears first when available
- source labels such as `Yahoo` and `Finnhub` are not visible to traders
- unavailable values are omitted, not shown as `n/a`
- zero-valued rows like `Shares outstanding: 0.00K` are omitted
- exchange names are normal trader-friendly labels, such as `Nasdaq`
- market cap and shares are only shown when meaningful
- the opener does not become a wall of fundamentals

If a saved post used an older opener format, confirm whether current source and tests already fixed it before changing code again.

## Candle-Backed Level Audit

Use replay mode first so the audit reads the saved candle data captured during the trading day. Do not silently pull a different live data set unless the goal is specifically to compare providers or refresh the cache.

Set validation environment values:

```powershell
$env:LEVEL_VALIDATION_CACHE_MODE='replay'
$env:LEVEL_VALIDATION_LOOKBACK_DAILY='520'
$env:LEVEL_VALIDATION_LOOKBACK_4H='180'
$env:LEVEL_VALIDATION_LOOKBACK_5M='100'
```

Run every active ticker from the trading day:

```powershell
$symbols = 'SAGT','SEGG','XTLB','SKYQ','KIDZ','ATER','BIYA','ABTS','VSME','SLGB','OSRH','DRCT'
foreach ($s in $symbols) {
  Write-Host "===== $s ====="
  npm run --silent validation:levels:quality -- $s "artifacts\level-quality-$s-YYYY-MM-DD-replay-audit.json"
}
```

Review each report for:

- `no_forward_levels`
- `wide_first_gap`
- `wide_internal_gap`
- `thin_forward_ladder`
- `extension_only_forward_ladder`
- data-quality flags
- nearest support/resistance distance
- displayed count versus extension count

Do not treat all warnings equally:

- `action` usually means code or data needs review.
- `watch` means inspect candles before deciding.
- `thin_forward_ladder` may be legitimate if candle history truly has little structure.

## Manual Candle Gap Review

When the audit flags a wide gap, inspect the actual cached daily/4h/5m candles inside the gap.

Look for:

- local swing highs/lows
- barrier candles inside a larger move
- repeated lows/highs in the same price band
- strong wick rejection
- body closes respecting the same area
- volume-heavy decision candles
- daily/4h levels that are more important than 5m noise
- obvious clustered zones that should display as one zone

Useful review approach:

- For resistance gaps, scan candle highs between the lower and upper resistance.
- For support gaps, scan candle lows between the upper and lower support.
- Cluster candidates that are within roughly `2%` to `3%`.
- Prefer daily and 4h structure.
- Treat single 5m-only levels as lower confidence unless they are fresh intraday reaction zones.

Do not promote a level only because the gap is visually large. Promote it only when fetched candles show credible structure.

## Missing Or Misleading Level Checks

For each ticker, compare:

- latest snapshot ladder
- level-quality audit forward levels
- candle gap candidates
- actual intraday price path
- posts that claimed a level was cleared/lost

Specific patterns to catch:

- Resistance jumps too far, like `1.83 -> 2.31`, while daily highs exist between.
- Support jumps too far, like `4.95 -> 2.55`, while daily lows exist between.
- Nearest support/resistance disappears because a farther level scored higher.
- Multiple nearby levels display as clutter instead of one zone.
- A broken support is not treated as nearby resistance when price is below it.
- A barely crossed resistance is described as fully cleared too early.
- The app says there is no resistance when older daily candles show clear overhead levels.

## Missed Event, False-Clear, And Role-Flip Audit

Compare saved price movement against known support/resistance levels.

Check:

- crossed resistance that did not produce a clear/breakout/crossed-resistance post
- crossed support that did not produce a lost-support/breakdown/crossed-lower post
- resistance-cleared posts where price only barely tapped above the level and fell back quickly
- support-lost posts where price reclaimed the level quickly
- broken support that should become nearby resistance while price is below it
- reclaimed resistance that should become nearby support while price is above it
- posts that say a level is cleared/lost with too much certainty

Do not assume every missed-event candidate is a bug. Some are intentionally suppressed by cooldowns, burst controls, poor signal quality, or tiny/temporary crosses. The audit should identify which candidates deserve code changes and which are acceptable suppressions.

## Cluster-Crossing Audit

Look for fast moves through several nearby support/resistance levels.

Check:

- multiple level-clear posts seconds apart
- multiple support-lost posts seconds apart
- tight clusters such as `2.39 / 2.43 / 2.47`
- whether the move should have been narrated as one crossed zone
- whether clustered snapshot display already solved the readability problem

If the same move crosses several nearby levels, prefer future work that posts one cluster-cross message instead of several separate level messages.

## Follow-Through Accuracy Audit

Review follow-through posts against the price path that came after the original level event.

Check:

- whether `working`, `stalling`, and `failed` labels matched the actual price movement
- whether the follow-through post repeated the original setup without adding useful new context
- whether the post explained what level needed to hold, reclaim, or clear next
- whether a failed breakout was still treated as resistance until it was reclaimed
- whether a failed support test still explained the next support below and nearby resistance above
- whether follow-through posts arrived too soon after the original event to be meaningful

Follow-through should help a trader understand the state of the move now. If it only says that a previous alert worked, stalled, or failed, it is probably too system-shaped.

## Volume, Halt, And Fast-Move Audit

Review whether the system handled the hard parts of runner behavior.

Check:

- volume surge context when price clears an important level
- volume fading context when a move stalls
- halted symbols that stop producing fresh price movement
- fast moves that skip over a level and only post after the move is stale
- candles or ticks that arrive late from the provider
- whether missing recent candles explain a missing clear/lost event
- whether the system should wait for a better data provider before changing logic

Do not invent volume certainty from missing data. If volume is unavailable or stale, the audit should say that plainly and keep the action item on data quality.

## Trader Actionability Audit

Read each ticker thread as if a long-biased trader is already in the trade.

Check whether the thread answers:

- what level is price testing right now
- what nearby support needs to hold for the setup to stay healthy
- what resistance needs to clear before the move improves
- what level would repair a failed support or resistance test
- where risk opens if support fails
- where upside gets tighter if resistance is nearby
- whether a pullback area is only a possible reaction zone, not an instruction to buy

The thread should give useful context without telling traders what to do. Prefer language like `buyers need acceptance above 3.75` or `holding 3.20 keeps the setup cleaner` over direct instructions.

## Posting Frequency Audit

Review every high-volume runner, especially symbols with more than 30 posts.

Check:

- number of posts for the full day, not only the latest restart
- posts per 5-minute and 10-minute window
- repeated alert/follow-through/AI stories
- whether optional narration is posting after critical alerts already told the same story
- whether `working/stalling/failed` follow-through messages are meaningful or just churn
- whether level-clear updates fire too many times when price crosses a tight cluster

Use profile comparison:

```powershell
Get-Content artifacts\live-post-profile-comparison.md -TotalCount 160
```

Interpretation:

- `quiet` is the lower-noise option.
- `balanced` is the current likely production default.
- `active` is useful when the user wants more posts.

If reducing noise, prefer:

- same-story cooldowns
- clustered crossed-level narration
- burst-window caps
- optional-post suppression after critical posts
- stronger material-change thresholds

Do not hide real support/resistance levels just to reduce post count.

## AI Commentary Audit

Review AI commentary separately from deterministic alert output.

Check:

- Does it add clarity, or only restate the alert?
- Does it stay observational?
- Does it avoid direct advice?
- Does it avoid `Longs should...` and `Traders should...`?
- Does it avoid `wait for`, `best entry`, `can buy`, `should trim`, and `should exit`?
- Does it repeat the same setup several times within a short window?
- Does it mention support/reclaim/acceptance in a trader-readable way?

Safe tone examples:

- `A reclaim would make the setup cleaner for longs.`
- `Buyers still need acceptance above resistance.`
- `Holding this support would keep the setup in better shape.`
- `Below this level, risk stays elevated for longs.`

Unsafe examples:

- `Longs should wait for...`
- `Best entry is...`
- `Can buy if...`
- `Should trim...`
- `Should exit...`

## Data Quality Audit

Every candle-backed conclusion must mention data quality when relevant.

Check:

- stale final candles
- missing recent candles
- suspicious gaps
- insufficient bars
- incomplete current session data
- provider differences
- whether the audit used replay cache or refreshed provider data

If IBKR is temporary, do not overfit provider-specific quirks. Prefer robust level logic that will still make sense after switching providers.

## Code Change Rules After Audit

Only change code when the audit shows a repeated or structurally meaningful problem.

Good code-change candidates:

- swing detection missed credible daily/4h intermediate levels
- ranker skipped nearest valid support/resistance
- gap audit needs stronger coverage
- post policy allowed repeated same-story bursts
- formatter used unclear trader wording
- AI validation allowed direct advice

Poor code-change candidates:

- one questionable ticker with degraded data
- forcing a level because a gap feels uncomfortable
- suppressing levels to make fewer posts
- adding vague “not a target” disclaimers everywhere
- replacing trader language with system labels

For every code change:

- add a focused regression test
- rerun relevant replay audits
- update docs
- commit with a clear message
- push the branch when done

## Required Verification

Run targeted tests:

```powershell
npx tsx --test src/tests/level-engine.test.ts src/tests/level-quality-audit.test.ts
npx tsx --test src/tests/alert-router.test.ts src/tests/live-thread-post-policy.test.ts src/tests/trader-facing-replay-language.test.ts src/tests/trader-commentary-service.test.ts
```

Run build:

```powershell
npm run build
```

If the work touched runtime posting behavior, regenerate Discord audit reports:

```powershell
npx tsx src/scripts/generate-discord-audit-reports.ts artifacts\YYYY-MM-DD-combined-discord-delivery-audit.jsonl
```

If the work touched level logic, rerun replay quality audits for all active tickers.

## Final Report Format

The final answer to the user should include:

- whether this was a full audit or a narrower audit
- symbols reviewed
- biggest issues found
- code/docs/tests changed
- remaining warnings
- exact verification commands run
- commit hash if committed

Be direct if something was not done. Do not imply that report generation equals manual candle-backed review.

## Current Known Lessons From April 29 Audit

- ABTS-style gaps can happen when intermediate daily/4h structure is filtered out.
- SKYQ-style support gaps need support-side checks, not only resistance checks.
- BIYA showed that nearby-in-time candles can be different price levels and should not always replace each other.
- ATER showed that the nearest valid support/resistance needs protection from being outranked by farther historical levels.
- KIDZ showed that a thin ladder can be real when candle history only supports one forward level.
- Runner days need calmer post policy, but real support/resistance levels should not be hidden to reduce noise.
- Trader-facing Discord output should be trader-view only; testing language belongs in logs and docs.
