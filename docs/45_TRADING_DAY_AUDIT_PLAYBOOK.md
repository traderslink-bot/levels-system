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
- `artifacts\trading-day-evidence-report.md`
- `artifacts\runner-story-report.md`
- `artifacts\live-post-profile-comparison.md`
- `artifacts\live-post-replay-simulation.md`
- `artifacts\long-run-tuning-suggestions.md`

For broad post-frequency work, also run:

```powershell
npm run stress:all-symbols
```

Review `artifacts\all-symbol-stress\all-symbol-stress-report.md`, especially `Post-Budget Attention` and `Noisy-Symbol Regression Pack`. The regression pack is the default evidence set for post-noise changes because it selects the highest-risk saved symbols and target sessions automatically.

Also run the trader post quality grader for the session being audited:

```powershell
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Review `trader-post-quality-report.md` before calling a thread trader-ready. Blocker or major findings mean the Discord-visible wording still contains direct advice, system-shaped labels, over-certain phrasing, small-cap-naive risk language, missing-level claims, or repeated-story overlap that needs explanation or a code fix.

Run the thread health and lifecycle reports too:

```powershell
npm run audit:thread-health -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:lifecycle -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:visual-replay -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:missed-moves -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:session-behavior -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Review:

- `thread-health-score.md` for repeated adjacent stories, weak probes, delivery failures, missing next-level context, and high post-count flags.
- `trade-lifecycle-summary.md` for the ticker-level story: range-bound, breakout-working, breakout-failed, support-damaged, extended-runner, or insufficient-data.
- `visual-audit-replay.html` for the symbol index and issue flags around weak probes, locked-area posts, missing next-level context, and minor-level posts.
- `missed-meaningful-move-audit.md` for candle-backed 5-minute move candidates that were covered, weakly covered, or missed by saved Discord posts.
- `session-behavior-audit.md` for candle readiness, first-post trade-map score, thread balance, current-session behavior profile, candle/post timeline samples, and runtime marker coverage.

Also review `thread-story suppressions` in the stress report. A healthy noise-control pass should prove whether repeated posts were suppressed by:

- same-story alert gates
- range-bound chop gates
- structure budgets
- thread-story phase churn gates
- optional recap/follow-through gates

If `thread-story suppressions` is low while a symbol is still noisy, inspect whether the saved rows are old and missing practical/stable structure metadata. Do not assume the phase model failed until you check whether current runtime rows include `practicalStructureState`, `practicalZoneKey`, `stableMarketStructureState`, and `stableMarketStructureMaterialChange`.

## Severity Rubric

Every final audit finding should use one of these severity labels:

- `blocker`: a trader-critical safety or trust issue that should stop release until fixed.
- `major`: a material trader-facing issue that needs a code, retry, or process fix before relying on the next run.
- `watch`: a real concern that needs targeted review or live verification, but does not yet prove an immediate code change is needed.
- `historical_only`: found in saved old posts or artifacts, but current code/runtime proof is still required before changing code.
- `data_quality_only`: explained by stale, missing, or provider-specific data; do not change trader logic until better data proves the issue.

Do not mark something as fixed because the summary sounds reassuring. The audit needs evidence: saved post excerpts, generated report rows, replay ladder evidence, candle-backed level evidence, or current source/test proof.

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
- whether `missed-meaningful-move-audit.md` shows weak or missed coverage after a quiet-posting change
- whether repeated posts were the same thread story in a different micro-phase, such as pressure -> early breakout -> pressure again inside the same practical area
- whether the symbol stayed inside one primary trade area and should have remained quiet until the area actually escaped
- whether weak probes above resistance or below support were treated as tests instead of cleanly cleared/lost levels
- whether the first post correctly ranked main support/resistance ahead of minor nearby levels

The trader-story audit should be done even when the level-quality audit is healthy. Good levels can still produce a confusing thread if the posts arrive in the wrong order, repeat too often, or describe the move too confidently.

For the top 3 to 5 highest-risk or highest-activity symbols, the final audit must include an evidence block with:

- exact saved Discord post excerpts that prove the issue or prove the current wording is clean
- exact forward support/resistance ladder from replay level-quality output
- exact candle-backed justification for any claimed missing or misleading level
- exact reason each missed-event candidate was acceptable suppression or a real bug
- exact reason each repeated story was useful, noisy, or already fixed by current policy

## Discord Output Audit

For each active ticker, inspect:

- total post count
- post count by kind
- max 5-minute and 10-minute bursts
- repeated story clusters
- AI commentary repeats
- Discord delivery failures
- whether trader-critical delivery failures retried or were clearly surfaced for operator review
- whether retry proof exists in the audit row (`retryAttempt`, `retryOf`, `retryReason`)
- snapshots that showed wrong-side levels
- snapshots with compacted or omitted levels
- level clear/lost posts that sounded too certain
- wording that implies a target instead of a nearby level
- any remaining system-shaped labels
- crossed-resistance / crossed-support posts that mention a next level only in prose, but do not show it clearly in the trader-facing level section
- posts where the current hold/reclaim level is skipped and the risk line jumps straight to a much farther support/resistance
- missed-event candidates where the audit may be wrong because price only touched the lower edge of a wider resistance zone, the upper edge was not cleared, or the level was already covered by an earlier cluster-cross post
- missed-event candidates created by future posts leaking backward into the timeline; a level should only be audited as "known" after it appeared in a saved snapshot, alert, or crossed-level post
- posts generated before the latest restart that may not represent current repo code

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
- For small-cap and microcap tickers, is the message treating a practical support/resistance area as the story, or is it overreacting to one-cent and two-cent wiggles?
- Does it distinguish support from resistance correctly after a level is lost or reclaimed?
- Does it repeat the same story too many times?
- Does it say `next level` in a way that sounds predictive?
- Does the AI read add value, or does it restate the same alert?
- Does any risk wording describe actual downside/extension risk, or is it really describing setup quality, crowding, chop, or degraded data? If the evidence is mostly crowded/tight/inner/degraded structure, trader-facing text should say the setup is fragile or messy, not that `risk is high`.
- For range-bound symbols, count the whole thread, not only alert posts. A ticker stuck inside a tight band should not keep posting level touch, support-loss, follow-through, bridge, and recap variations unless price expands, reclaims, loses a structurally meaningful area, or volume/activity materially changes the read.
- For low-priced range-bound symbols, check whether the current policy compressed repeated touch/break/reclaim/rejection chatter inside the same boxed area. The first meaningful event family can still post, but repeated same-family flicker should usually show as `range_bound_chop`, `same_story_not_material`, or `structure_budget` in replay.
- For low-priced symbols, treat one-cent or tiny-percentage `risk opens toward...` / `risk stays open toward...` wording as a major wording failure unless the level is part of a broader support area and the post explains that broader area clearly.
- Check `levelImportanceLabel`, `primaryTradeAreaLocked`, `primaryTradeAreaEscapeConfidence`, and `failedLevelOutcome` in audit rows when available. These fields should explain whether a post was a major decision, a range repeat, a weak probe, or a cleaner accepted expansion.
- If `primaryTradeAreaLocked=true` and the post is only a weak probe/testing read, require proof that it added a new trader story. Otherwise classify it as noisy or already fixed by current policy.
- If `failedLevelOutcome=probe_only` or `testing`, trader-facing language should not sound like the level was cleanly cleared or cleanly lost.
- If a post says no higher resistance or no lower support is available, verify the snapshot ladder, extension ladder, and candle-backed level audit. If levels existed but were not surfaced, classify the finding as `major`; if the cache lacked enough history, classify it as `data_quality_only`.
- Check whether fast `support crossed lower` / `resistance crossed` bridge posts are adding a new level story or just narrating tiny back-and-forth crosses inside the same cluster.
- Check whether symbol recaps are summarizing a real change or merely restating a minor failed/stalled follow-through move. Minor chop recaps should be treated as noise.
- Check whether a repeated same-level breakout, breakdown, level-touch, reclaim, or rejection post is materially different from the last one. If the trigger price, severity, score, and level area are essentially unchanged, it should usually be suppressed.
- Check whether a low-priced ticker is only flickering a cent or two inside the same practical area. Current policy should group that as the same story unless price expands, score/severity escalates, or the practical structure state actually changes.
- For $5-$10 small caps, check whether failed follow-through posts are reacting to a normal 1-2% wobble. A small move should not be framed as a clean failed setup unless the larger support/resistance story also changed.
- Check whether `support crossed lower` / `resistance crossed` bridge posts are participating in the same story memory as intelligent alerts. A bridge post should not reset the thread into a fresh story unless it crosses a truly new level or cluster.
- Check the first support/resistance post for a practical trade map:
  - main support area
  - breakout area
  - next resistance above the breakout area
  - broader support if the whole support area fails cleanly
  - short-term momentum support when recent 5-minute/intraday structure is available
- Check practical structure metadata in `trading-day-evidence-report.md`:
  - `range_bound` should not keep repeating unless price expands from the area
  - `pressing_resistance` should appear only when repeated tests are actually building pressure
  - `support_failing` should not be treated the same as `structure_broken`
  - `reclaim_attempt` and `reclaim_holding` should explain repair/hold context without direct buy instructions
  - a repeated same-level post should have a practical state change, practical zone change, severity/score escalation, or real trigger expansion
- For runner symbols, compare the daily/4h ladder with recent 5-minute structure. A fast 30-50% move can fail against a recent intraday base or higher-low area even when the daily ladder still looks wide.
- Treat `If 1.01 fails, risk opens toward 1.00` style wording as a major language problem on low-priced small caps. The audit should prefer whole-area language such as `if the support area keeps failing cleanly, broader support is...`.

Historical-post versus current-code proof rule:

- Keep old saved Discord wording separate from wording still present in current formatter code.
- If a bad phrase appears only in an old saved post, mark it `historical_only` and verify current code/tests before changing code.
- If a bad phrase appears in current source or a fresh runtime post after restart, mark it `major` or `blocker` depending on trader impact.
- Do not blur old artifacts and current runtime behavior in the final report.
- Always record the runtime start time, latest commit, and session folder when reviewing live posts. If a post was produced by an older running process, say that explicitly before calling it a current bug.

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
$env:LEVEL_VALIDATION_IBKR_CLIENT_ID='202'
$env:LEVEL_VALIDATION_CACHE_MODE='replay'
$env:LEVEL_VALIDATION_LOOKBACK_DAILY='520'
$env:LEVEL_VALIDATION_LOOKBACK_4H='180'
$env:LEVEL_VALIDATION_LOOKBACK_5M='100'
```

Use a validation-only IBKR client id whenever the app is still running. The live manual watchlist runtime and the audit scripts must not share the same IBKR client id. If the audit needs fresh candles instead of replayed saved candles, keep `LEVEL_VALIDATION_IBKR_CLIENT_ID` set and use:

```powershell
$env:LEVEL_VALIDATION_CACHE_MODE='refresh'
```

After the first fresh validation pass, inspect at least one output file and confirm daily candle timestamps are real trading dates, not epoch-looking `1970` dates. A bad provider timestamp parse can make the level engine look wrong even when the candle request succeeded.

Replay mode must not require a live IBKR socket. If `LEVEL_VALIDATION_CACHE_MODE='replay'` still attempts to connect to IBKR, treat that as an audit tooling bug and fix it before accepting the audit as complete. If replay mode has a cache miss, record the cache miss separately from provider downtime.

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
- timestamp sanity for daily/4h/5m candles
- whether a supposedly far next level should actually be a role-flip hold/reclaim area from a recently crossed level

Do not treat all warnings equally:

- `action` usually means code or data needs review.
- `watch` means inspect candles before deciding.
- `thin_forward_ladder` may be legitimate if candle history truly has little structure.

For a strict audit, run this candle-backed check for every active ticker from the session, not just the ticker that looked strange in Discord. The final audit should name which tickers were validated, which passed, which produced `action` or `watch` findings, and which files contain the evidence.

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
- whether every trader-facing clear/lost/breakout/breakdown post displayed the next relevant support/resistance clearly enough for a trader to see it quickly

Specific patterns to catch:

- Resistance jumps too far, like `1.83 -> 2.31`, while daily highs exist between.
- Support jumps too far, like `4.95 -> 2.55`, while daily lows exist between.
- Nearest support/resistance disappears because a farther level scored higher.
- Multiple nearby levels display as clutter instead of one zone.
- A broken support is not treated as nearby resistance when price is below it.
- A reclaimed or crossed resistance is not treated as nearby support / breakout support while price is above it.
- A level-touch or compression post near upper resistance points to deep native support while ignoring a recently cleared resistance directly below price.
- A level-touch or compression post near lower support points to distant native resistance while ignoring recently broken support directly above price.
- A barely crossed resistance is described as fully cleared too early.
- The app says there is no resistance when older daily candles show clear overhead levels.
- A post says resistance/support was crossed but does not include a clear `Key levels` style section for the crossed level and the next level above/below.
- A post says risk opens toward a far support while skipping the crossed resistance that should first act as the hold/reclaim area.
- A post says `risk is high` when the underlying reasons are crowded trigger, tight room, dense barriers, degraded data, or inner setup. Treat this as wording debt unless there is actual price-extension/downside evidence that makes the risk label trader-meaningful.

When a post does not show a next resistance/support level, investigate before accepting it:

- Check whether the latest snapshot ladder had a valid next level.
- Check whether the latest snapshot displayed extension levels above/below the crossed level; fast crossed-level posts must not ignore extension levels that traders already saw in the snapshot.
- Check whether the level-quality audit says the forward ladder was thin, missing, or extension-only.
- Check whether a level existed in the full ladder but was filtered by display range, ranking, compaction, or stale runtime state.
- Check whether the post was from an older app instance that had not loaded the latest formatter.
- If the ladder truly has no next level, classify the finding as `data_quality_only` or `watch` with candle evidence.
- If the ladder has a next level but Discord did not surface it clearly, classify it as `major` when trader readability is materially affected.

## Missed Event, False-Clear, And Role-Flip Audit

Compare saved price movement against known support/resistance levels.

Check:

- crossed resistance that did not produce a clear/breakout/crossed-resistance post
- crossed support that did not produce a lost-support/breakdown/crossed-lower post
- resistance-cleared posts where price only barely tapped above the level and fell back quickly
- support-lost posts where price reclaimed the level quickly
- broken support that should become nearby resistance while price is below it
- reclaimed resistance that should become nearby support while price is above it
- crossed resistance that should become the first breakout support / hold area before pointing to deeper support
- crossed support that should become the first overhead reclaim area before pointing to higher resistance
- posts that say a level is cleared/lost with too much certainty

Minimum review requirements:

- review at least one broken-support case for nearby resistance behavior
- review at least one reclaimed-resistance case for nearby support behavior
- review at least one false-clear or fast-reclaim case for certainty wording
- include saved post excerpts for each reviewed case

Do not assume every missed-event candidate is a bug. Some are intentionally suppressed by cooldowns, burst controls, poor signal quality, or tiny/temporary crosses. The audit should identify which candidates deserve code changes and which are acceptable suppressions.

Before calling a missed-event candidate real, check for audit false positives:

- a posted breakout/breakdown through a zone can cover several nearby levels inside that zone
- a cluster-cross post can cover multiple levels with one Discord message
- follow-through path prices are not support/resistance levels by themselves
- a price sample that only prints exactly at a level is a touch/test, not necessarily a clear/loss
- support-touch posts may mention nearby resistance; classify them by the setup side, not by the first later level they mention

## Cluster-Crossing Audit

Look for fast moves through several nearby support/resistance levels.

Check:

- multiple level-clear posts seconds apart
- multiple support-lost posts seconds apart
- tight clusters such as `2.39 / 2.43 / 2.47`
- whether the move should have been narrated as one crossed zone
- whether clustered snapshot display already solved the readability problem

The final audit needs a dedicated cluster-cross section when candidates exist. Include:

- nearby crossed level list
- saved post sequence
- timestamps
- post count
- whether the thread likely overexplained the move
- whether one cluster-cross story would be better than several single-level messages

If the same move crosses several nearby levels, prefer future work that posts one cluster-cross message instead of several separate level messages. If current runtime output already posts one cluster-cross story, verify that the audit row includes `crossedLevels`, `clusterLow`, `clusterHigh`, and `clusteredLevelClear`; do not count that as unresolved overposting.

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
- whether a post arrived late enough that the level story was stale by the time it reached Discord
- whether audit rows include enough timing proof (`sourceTimestamp`, `deliveryLagMs`, `sendStartedAt`, `sendDurationMs`) to separate provider lag, runtime lag, and Discord delivery lag

Do not invent volume certainty from missing data. If volume is unavailable or stale, the audit should say that plainly and keep the action item on data quality.

## Critical Delivery-Failure Standard

Treat any trader-critical failed `post_alert` row as `major` unless retry or explicit operator surfacing is proven.

The audit must show:

- failed post title, symbol, event type, and timestamp
- error message
- whether the row was trader-critical
- whether retry was proven
- whether an equivalent later post reached Discord
- recommended severity

An equivalent later post is useful context, but it is not proof that retry is working.

A proven retry must preserve the same trader-critical story context and point back to the failed row with `retryOf`. Use `retryReason` to confirm the retry is tied to the same downstream failure.

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

## First Snapshot Trade-Map Audit

The initial support/resistance post should read like a practical trade map, not a raw calculator output.

Check whether the first snapshot answers:

- where price is relative to the practical support area and practical resistance area
- what resistance area matters above price without implying a guaranteed move toward it
- what support area matters below price without treating a one-cent small-cap wiggle as a full trade failure
- whether nearby penny-level supports were described as one practical area in the commentary when appropriate
- whether the full ladder still preserves the underlying support/resistance levels even when the commentary groups them into an area

For low-priced small caps, treat wording such as `If 1.02 fails, risk opens toward 1.00` as a major wording problem unless `1.00` is part of a broader meaningful support area and the text says that clearly. Prefer `Support that matters: major support 1.00-1.02 area` and `if the whole area fails cleanly, next broader support is...`.

When reviewing saved data while the market is closed, regenerate the broad replay evidence:

```powershell
npm run stress:all-symbols
```

Use the `Broad Saved-Data Replay Pack` section to sample tight chop, runners, missed-event candidates, language-boundary risk, and high-activity watch symbols before claiming the first-post wording is broadly safe.

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

Use stable structure / Discord alignment when cached 5-minute candles exist:

```powershell
npm run structure:discord-align -- --limit all
```

This audit compares saved Discord posts with the stable 5-minute market-structure state near each post. Treat a high same-structure repeat count as evidence that the thread may be reacting to tiny level flickers instead of a meaningful trade-story change. This is especially important for low-priced small caps that move a cent or two inside the same range.

When current audit rows include stable 5-minute structure metadata, also review the `Stable 5m Market Structure Evidence` section in the generated trading-day evidence report. It should show whether posted alerts were mostly repeating the same stable structure, whether material transitions were present, and whether range-bound states are reaching Discord too often.

For every full audit after the 2026-05-02 stable-structure runtime bridge, check:

- whether new `post_alert` rows include `stableMarketStructureState`
- whether `stableMarketStructureMaterialChange` appears only on real structure shifts, not tiny same-range flicker
- whether range/consolidation symbols show low material-change counts and low posted counts
- whether runner symbols still post on real expansion, pivot loss, reclaim, or breakout-holding transitions
- whether stable-state wobble without `stableMarketStructureMaterialChange=true` is being treated as a repeat, not a fresh story

Closed-market regression requirement:

```powershell
npm run scenario:smallcap
npx tsx --test src/tests/offline-small-cap-scenario-simulator.test.ts
```

The scenario pack must include both:

- a boring consolidation path that proves many raw touches do not become many posts
- a runner structure-change path that proves the policy still allows real breakout / reclaim / expansion stories

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
- stable market-structure materiality as an additional suppression input after replay proof

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
- risk/quality wording that makes a choppy or fragile setup sound like a high-probability downside call
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
