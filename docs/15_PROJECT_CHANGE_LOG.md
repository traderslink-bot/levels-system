# Project Change Log

## Purpose

This document tracks concrete implementation changes made to the `levels-system` project over time so the current state of the codebase is easy to review.

## Current Testing Context

- IBKR is the active provider being used to test the system end-to-end right now.
- The current IBKR integration should be treated as the testing/integration provider for this phase.
- Provider abstraction remains intentional because the data provider may be switched after testing.
- Reminder: run live-market grading and compare-mode testing on Monday, April 20, 2026 once the market is open.

## Format

- Use Eastern time where practical, matching the rest of the project notes.
- Add entries in reverse chronological order.
- Keep each entry focused on shipped code, verification, and follow-up risk.

---

## 2026-04-29 America/Toronto

### Added clustered level display and calmer live-post replay controls

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/monitoring/live-thread-post-policy.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/level-quality-audit.test.ts`
  - `src/tests/live-thread-post-policy.test.ts`
  - `src/tests/trader-facing-replay-language.test.ts`
- What changed:
  - tight three-plus-level clusters in Discord snapshots now display as one trader-readable zone while keeping raw levels intact internally
  - added support-side wide internal gap coverage so support ladders get the same audit protection as resistance ladders
  - tightened critical burst limits so major-change alerts no longer bypass the global burst window when a symbol is already posting heavily
  - extended AI commentary same-story and same-symbol cooldowns so repeat AI reads stay quieter on runner days
  - added realistic replay language coverage to guard against old system wording and repeated-story overlap in trader-visible posts
- Replay result from the combined April 29 audit file:
  - balanced profile: `387` original posts -> `338` simulated posts, a `12.7%` reduction
  - quiet profile: `387` original posts -> `318` simulated posts, a `17.8%` reduction
  - max simulated balanced burst windows dropped to `5` posts per 5 minutes and `7` posts per 10 minutes
- Verification:
  - `npx tsx src/scripts/generate-discord-audit-reports.ts artifacts\2026-04-29-combined-discord-delivery-audit.jsonl`
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/live-thread-post-policy.test.ts src/tests/level-quality-audit.test.ts src/tests/trader-facing-replay-language.test.ts src/tests/trader-commentary-service.test.ts`

## 2026-04-29 America/Toronto

### Improved intermediate resistance detection and ladder gap auditing

- Updated:
  - `src/lib/levels/swing-detector.ts`
  - `src/lib/levels/level-quality-audit.ts`
  - `src/tests/level-quality-audit.test.ts`
- What changed:
  - loosened higher-timeframe barrier-candle promotion so meaningful interior daily/4h highs and lows inside a larger move can become level candidates instead of requiring only very clean local swing extremes
  - added `wide_internal_gap` to the level-quality audit so a ladder with enough visible levels can still be flagged when it jumps too far between adjacent forward support/resistance levels
  - verified the ABTS manual-lookback audit now surfaces intermediate resistance around `2.14` between `1.83` and `2.31`
- Why this matters:
  - trader-facing ladders should not imply there is no meaningful resistance between two far-apart levels when the daily or 4h chart has visible structure inside that space
- Verification:
  - `npx tsx --test src/tests/level-engine.test.ts`
  - `npx tsx --test src/tests/level-quality-audit.test.ts`
  - `$env:LEVEL_VALIDATION_LOOKBACK_DAILY='520'; $env:LEVEL_VALIDATION_LOOKBACK_4H='180'; $env:LEVEL_VALIDATION_LOOKBACK_5M='100'; npm run validation:levels:quality -- ABTS artifacts\abts-level-quality-audit-manual-lookbacks-after-gap-fix.json`

### Calmed remaining trader-facing level wording from live log review

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - renamed follow-through state titles from `state update` to `progress check`
  - changed fast level-cross wording from `next resistance/support is...` to nearby-level language like `nearby resistance above is...` and `nearby support below is...`
  - changed support reaction wording from `next support reaction area` to `nearby support reaction area`
  - removed deterministic `downside` wording from level-room descriptions in favor of lower-support wording
- Why this matters:
  - live posts should read like trader context, not system state labels or implied price predictions
- Verification:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/alert-intelligence.test.ts`

### Omitted unusable zero-valued stock-context fields

- Updated:
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/tests/finnhub-thread-preview.test.ts`
- What changed:
  - treats zero or invalid market cap / shares outstanding values as unavailable
  - omits unavailable profile rows instead of showing `n/a` or misleading values like `0.00K`
- Why this matters:
  - the Discord opener should only show useful context, not source artifacts that look precise but are not meaningful
- Verification:
  - `npx tsx --test src/tests/finnhub-thread-preview.test.ts`

### Added Yahoo enrichment to the initial stock-context opener

- Updated:
  - `src/lib/stock-context/yahoo-client.ts`
  - `src/lib/stock-context/stock-context-provider.ts`
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - `src/scripts/run-finnhub-thread-preview.ts`
  - `src/tests/finnhub-thread-preview.test.ts`
- What changed:
  - added a Yahoo stock-context client for quote, quote summary, and previous daily range data
  - the initial Discord stock-context opener now keeps Finnhub company/profile fields and adds source-labeled Yahoo fields when available
  - Yahoo fields include current regular/premarket/postmarket price context, current day high/low/volume, previous day high/low, 52-week range, market cap, float, shares outstanding, short interest, profitability, cash/debt, revenue/growth, and company description
  - added a combined stock-context provider so Finnhub and Yahoo can both contribute while failures in one source do not block the other
  - added `YAHOO_STOCK_CONTEXT_ENABLED=false` as the opt-out switch for Yahoo enrichment
  - refined the Yahoo opener formatting so live Discord only shows the current Yahoo price mark; other Yahoo fields stay out of the opener for now because availability is inconsistent across small-cap symbols
  - added a Yahoo chart-price fallback so the opener can still show a current Yahoo mark when the quote endpoint is empty but the chart endpoint returns regular/premarket/postmarket bars
  - moved the current price to the top of the opener, removed source labels from trader-facing text, and normalized exchange display so verbose all-caps exchange names like `NASDAQ NMS - GLOBAL MARKET` show as `Nasdaq`
- Why this matters:
  - source-specific enrichment stays internal while Discord keeps the opener trader-readable and uncluttered
  - the initial Discord thread can show more trader-relevant company context while levels are still loading
- Verification:
  - `npx tsx --test src/tests/finnhub-thread-preview.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`

### Tightened trader-view-only Discord language boundary

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/finnhub-thread-preview.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/trader-commentary-service.test.ts`
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - removed the Discord-visible `Update type: existing setup update, not a new setup` line from repeated follow-through posts; the state remains in metadata for audit/review only
  - replaced remaining dashboard-shaped Discord labels: `Status` became natural current-read / move-state lines, severity/confidence now stay in metadata instead of live Discord text, `Decision area` became `Level to watch closely`, `setup move` became `price change from trigger`, `setup update` became `what changed`, and `state recap` became `current read`
  - softened snapshot and extension posts from dashboard labels like `LEVEL SNAPSHOT`, `CURRENT READ`, `KEY LEVELS`, `FULL LADDER`, `NEXT LEVELS`, `SIDE`, and `LEVELS` into trader-facing labels such as `support and resistance`, `What price is doing now`, `Closest levels to watch`, `More support and resistance`, and `next levels to watch`
  - tightened AI commentary validation so phrases like `longs should...`, `traders should...`, `wait for...`, `best entry`, `safe if`, `can buy`, `good place to add`, `should add`, `should trim`, `should exit`, `take profit`, and `stop out` are rejected from trader-facing AI reads
  - rewrote remaining deterministic `longs need...` style caution wording into setup-context wording such as `the setup needs stabilization or a reclaim`
  - rewrote a fast support-loss fallback from an operator-like `wait for buyers...` instruction into observational trader context
  - made the stock-context opener more compact and trader-readable with plain labels and `Levels are loading.`
  - added trader-facing boundary assertions that reject system/debug/operator language and direct execution advice in Discord-visible payloads
  - added repeated-story wording coverage so a completed follow-through post owns the visible thread text instead of being echoed by weaker state/recap wording
- Why this matters:
  - Discord posts are now treated as trader-view only; operator/testing context belongs in logs, audit files, diagnostics, replay reports, and review artifacts
  - AI commentary should not be looser or more advisory than deterministic posts
- Verification:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/trader-commentary-service.test.ts src/tests/finnhub-thread-preview.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`

### Preserved untested higher-timeframe levels during refreshes

- Updated:
  - `src/lib/monitoring/level-store.ts`
  - `src/tests/level-store.test.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - level snapshot `KEY LEVELS` now prints plain `Resistance:` / `Support:` labels with each level on its own unindented line, separated by a blank line for easier Discord scanning
  - support-test alerts now use support-reaction language instead of `dip-buy` wording in trader-facing posts
  - support-lost posts now show the failed support as the reclaim / resistance area and show the next lower support separately, so the post does not imply a far overhead resistance is the next decision area
  - level-touch key levels now say `Next support` / `Next resistance` instead of `Nearby`, which avoids overstating distance when the next formal ladder level is far away
  - follow-through and state-update posts now use trader-facing wording like `price change from trigger` and `stayed strong`, removing internal phrases such as `alert direction` and `after the alert`
  - long-caution follow-through now says `support-loss warning faded` instead of ambiguous wording like `breakdown failed`
  - daily and 4h swing detection now includes controlled barrier-candle highs/lows, so meaningful prior resistance/support inside a strong rising or falling sequence can survive even when it is not a perfect local swing point
  - level refreshes now carry forward unmatched daily/4h support or resistance for a limited window when price has not tested or cleared that level yet
  - carried levels are marked as aging and tagged with `carried_forward_prior_level` internally so the system can distinguish preserved prior structure from freshly generated levels
  - carried levels are not kept if a fresh level already overlaps them, if they are too old, or if price has moved through them
  - fast resistance-crossed detection now requires price to clear the full resistance zone high, not just the representative zone price, before introducing the next resistance
- Why this matters:
  - SKYQ showed a previous ladder with `7.12` and `7.28`, but a later refresh jumped from the `7.00-7.04` zone to `7.73`
  - in runner charts, real intermediate resistance can come from prior higher-timeframe barrier candles, not only textbook local swing highs
  - if those intermediate levels were still higher-timeframe structure and price had not tested them, the runtime should not forget them simply because one refresh failed to regenerate them
  - a tap inside a zone like `7.00-7.04` should remain a test of that zone, not a confirmed move toward the next level
- Verification:
  - `npx tsc -p tsconfig.json --noEmit`
  - `npx tsx --test src/tests/level-store.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-28 America/Toronto

### Calmed runner-thread posting and improved follow-through wording

- Updated:
  - `src/lib/monitoring/live-thread-post-policy.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
  - `src/lib/review/live-post-replay-simulator.ts`
  - `src/scripts/simulate-live-post-policy.ts`
  - `src/scripts/generate-discord-audit-reports.ts`
  - `src/lib/review/discord-audit-reports.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - `scripts/start-manual-watchlist-long-run.ps1`
  - `package.json`
  - `src/tests/live-thread-post-policy.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/live-post-replay-simulator.test.ts`
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - added a critical live-post burst governor so runner symbols that already posted several trader-facing updates in a short window can suppress lower-value critical repeats
  - tightened completed follow-through posting so weak label drift such as `strong -> working` does not create another Discord post, and same-label repeats now need a larger directional change before posting again
  - repeated material follow-through outcomes are now marked as existing setup updates, not new setups
  - follow-through posts now include a `Decision area` section so traders can see which level needs to hold or be reclaimed without receiving direct buy/sell instructions
  - follow-through state wording now says a stalling setup needs a better reaction instead of leaning on rushed wording like "fresh follow-through"
  - Discord delivery audit metadata now records `repeatedOutcomeUpdate` for follow-through posts
  - added `npm run longrun:simulate:posts -- <session-folder>` plus `live-post-replay-simulation.json` / `.md` to estimate how current post-policy rules would have handled saved sessions
  - `npm run longrun:audit:reports -- <session-folder>` now also writes the replay simulation artifacts
  - live AI reads now pass optional-post and narration-burst checks before the OpenAI call, so reactive or recap-like AI reads are blocked before spending API usage when the thread is already too busy
  - added `WATCHLIST_POSTING_PROFILE=quiet|balanced|active` so live post volume can be tuned from `.env` without code edits
  - added profile-aware post-policy thresholds for follow-through, same-zone alert chop, burst limits, continuity, and AI commentary
  - added `live-post-profile-comparison.json` / `.md` so saved sessions compare quiet, balanced, and active profile output side by side
  - added `runner-story-report.json` / `.md` so ATER / BIYA-style runner reviews can start from rough price path, post quality labels, noisy-repeat samples, candidate missed level clears/losses, post mix, and key posted events instead of raw audit rows
  - fast resistance-cleared and support-lost detection now advances through the next crossed ladder level instead of jumping to the farthest crossed level when price moves quickly
  - fast resistance-crossed detection now requires price to clear the full resistance zone high, not just the representative zone price, so a tap inside a zone like `7.00-7.04` does not introduce the next resistance too early
  - resistance-cleared posts now include the pullback test level and lower risk area if the breakout cannot hold
  - support-lost posts now include a conditional support-reaction area at the next support and the risk map below the failed support
  - conditional support-reaction / support-risk language now includes the support or resistance strength, for example `next support reaction area: light support 3.34`
  - fast resistance/support bridge posts now use less final wording (`resistance crossed`, `testing breakout`, `next support/resistance`) so a brief pierce does not read like confirmed acceptance
  - intelligent alert payloads now use `Key levels` instead of `Next levels` so support/resistance context reads as a map, not a prediction
  - level snapshot `KEY LEVELS` now prints each support/resistance on its own line for easier Discord scanning
  - level-touch alerts now include the zone being tested, so a resistance touch can show both the tested resistance and nearby support context
  - balanced posting now allows fewer follow-through posts inside a short burst while keeping critical level clears/losses eligible
  - added regression coverage for fast jumps through multiple resistance/support levels so the runtime does not skip intermediate levels to reduce noise
- Why this matters:
  - ATER and BIYA live sessions showed that runner threads could stack too many repeated `working` / `failed` updates after the main idea was already clear
  - this keeps levels intact while making the Discord output calmer and more decision-focused
  - the replay simulator lets future tuning be tested against saved sessions before the next market window
- Verification:
  - `npm run longrun:simulate:posts -- artifacts\long-run\2026-04-28_15-29-05`
  - `npm run longrun:simulate:posts -- artifacts\long-run\2026-04-28_15-29-05 --profile balanced --symbols ATER,BIYA`
  - `npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/discord-audit-reports.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/live-post-replay-simulator.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/live-post-replay-simulator.test.ts`
  - `npm run build`

### Added live-thread policy extraction, audit reports, tuning suggestions, and level-quality validation

- Updated:
  - `src/lib/monitoring/live-thread-post-policy.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/review/discord-audit-reports.ts`
  - `src/lib/review/long-run-tuning-suggestions.ts`
  - `src/lib/levels/level-quality-audit.ts`
  - `src/scripts/generate-discord-audit-reports.ts`
  - `src/scripts/run-level-quality-audit.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - `src/runtime/manual-watchlist-page.ts`
  - `scripts/start-manual-watchlist-long-run.ps1`
  - `package.json`
  - `src/tests/alert-router.test.ts`
  - `src/tests/live-thread-post-policy.test.ts`
  - `src/tests/discord-audit-reports.test.ts`
  - `src/tests/long-run-tuning-suggestions.test.ts`
  - `src/tests/level-quality-audit.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/manual-watchlist-server.test.ts`
  - `README.md`
  - `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/38_CODEX_PROJECT_IMPROVEMENT_PLAN_2026-04-28.md`
- What changed:
  - extracted follow-through and AI live-post duplicate policy into a dedicated helper module so same-story decisions can be tested outside the runtime manager
  - extracted optional continuity, recap, and live follow-through-state gating into the same helper module so post-burst and same-event chatter rules can be tested directly
  - completed follow-through posts now suppress repeated same-symbol, same-event, same-level outcomes unless the label changes or the directional move materially changes
  - follow-through audit metadata now records the tracked entry level as `targetPrice`, so future policy reports can group repeated outcomes by actual level
  - continuity audit metadata now records event type and level when available, so future reports do not collapse different continuity stories into `unknown`
  - live AI reads now reserve in-flight story keys and require higher-value deterministic alerts, reducing repeated AI commentary on the same symbol move
  - added `npm run longrun:audit:reports -- <session-folder>` to rebuild JSON and Markdown policy/snapshot audit reports from `discord-delivery-audit.jsonl`
  - added `long-run-tuning-suggestions.json` / `.md` so long-run review produces ranked action/watch/info items instead of only raw reports
  - added `npm run validation:levels:quality -- <SYMBOL> [output-json-path]` for suspicious forward-ladder cases such as missing-looking overhead resistance or unusually wide first gaps
  - added a manual-runtime Review Artifacts panel and `/api/runtime/review-artifacts` endpoint so generated session reports can be previewed from the browser UI
  - the long-run launcher now generates those report files at shutdown
- Why this matters:
  - ATER / BIYA runner sessions showed that even useful follow-through can become too repetitive when the same outcome keeps posting
  - the new policy report makes repeated story clusters, post bursts, optional density, trust score, and tuning recommendations visible without manually reading raw Discord audit rows
  - the new snapshot audit report makes level-ladder questions easier to debug without exposing operator-only details in trader-facing Discord posts
  - the new tuning-suggestions artifact gives the next improvement pass a clearer first read on what deserves action versus watch-only review
  - the new level-quality audit keeps ATER-style missing-resistance questions tied to generated ladder evidence before deeper level-engine changes
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-server.test.ts src/tests/level-quality-audit.test.ts src/tests/long-run-tuning-suggestions.test.ts src/tests/discord-audit-reports.test.ts`
  - `npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/discord-audit-reports.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/trader-commentary-service.test.ts`
  - `npm run longrun:audit:reports -- artifacts\long-run\2026-04-28_15-29-05`
  - `npm run build`
  - `npm test`

### Refreshed project docs for current runtime behavior

- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/36_RUNTIME_HANDOFF_2026-04-25.md`
- What changed:
  - documented that Finnhub first-thread openers no longer include quote/price fields because the free-tier quote data can be stale during premarket/after-hours testing
  - documented that snapshot level omission/compaction diagnostics live in `discord-delivery-audit.jsonl`, not in trader-facing Discord posts
  - updated older handoff notes so the approved Finnhub opener field set matches the current implementation
- Why this matters:
  - docs now match the current live-test assumptions: IBKR/trading provider data owns price context, Finnhub only gives ticker/profile context, and level-audit details stay operator-only
- Verification:
  - docs-only update

### Added snapshot level audit metadata

- Updated:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
- What changed:
  - level snapshot payloads now include operator-only audit metadata showing every surfaced support/resistance candidate and extension resistance candidate considered for the snapshot
  - the audit marks each candidate as displayed, compacted, on the wrong side of price, or outside the forward resistance range
  - audit entries preserve source timeframes, source types, strength, confluence, evidence count, freshness, and extension status
  - `discord-delivery-audit.jsonl` now records omitted snapshot levels and their reasons without changing the trader-facing Discord snapshot text
- Why this matters:
  - when a runner appears to miss an obvious daily level, the logs can now show whether the system never found it, found it but compacted it into a nearby stronger level, filtered it because price had already crossed it, or left it outside the forward planning range
  - this keeps Discord readable while improving diagnosis of ATER-style level ladder questions
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/alert-router.test.ts`
  - `npm run build`
  - `npm test`

### Tightened live Discord post volume

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - `README.md`
- What changed:
  - manual watchlist level seeding now defaults to 520 daily candles instead of 220, with configurable `LEVEL_MANUAL_LOOKBACK_DAILY`, `LEVEL_MANUAL_LOOKBACK_4H`, and `LEVEL_MANUAL_LOOKBACK_5M` env overrides
  - runtime status now exposes the active historical lookbacks so stale/too-shallow level seeding is visible from the UI
  - fast resistance/support clear posts now advance through the active ladder after the first level is cleared, so runners can post that a later level such as 1.39 cleared instead of staying anchored to the original snapshot level
  - materially higher fast-cleared resistance levels can post even when a lower breakout/clear post happened recently
  - level-extension posts now wait until price approaches the far edge of the displayed ladder instead of the nearest resistance, preventing `NEXT LEVELS` from jumping to an extension while intermediate displayed resistance remains ahead
  - AI signal commentary is now rate-limited to one live AI read per symbol every 10 minutes
  - symbol recaps now use a 30-minute cooldown and are suppressed for 3 minutes after story-critical alerts or follow-through posts
  - symbol recaps are also suppressed when an AI read posted recently, so the thread does not get both forms of optional explanation on the same move
  - continuity/setup updates now wait longer after real alerts/follow-through posts, use a longer exact-message cooldown, and have tighter optional-post density limits
  - follow-through updates now suppress repeated same-symbol, same-event, same-level outcomes for 5 minutes, which keeps runners from posting the same working/failed result over and over
- Why this matters:
  - ATER at 1.62 showed `Resistance: none` because the manual runtime's 220-daily-candle request only reached roughly June 2025 and omitted older overhead resistance
  - ATER cleared 1.39 during a halted runner move, but the bridge stayed stuck on the earlier 1.32 clear and did not post the materially higher resistance clear
  - ATER at 1.67 posted `NEXT LEVELS: 2.50` even though 1.87, 2.30, and 2.40 were still visible in the snapshot ladder
  - live logs still showed bursts like alert + level clear + follow-through + recap + AI inside a few seconds
  - BIYA and ATER runner logs showed repeated breakdown/compression follow-through on the same active move
  - the goal is to keep core deterministic alerts and meaningful follow-through, while cutting optional companion posts that crowd the thread
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`

### Calmed repeated live thread narration

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - removed urgent `quickly` wording from weakening/degrading trader-facing updates
  - added a 10-minute exact-message cooldown for continuity/setup updates so the same `stalling` or `kept working` line cannot keep cycling after the label changes
  - preserved fast level-clear memory through extension maintenance so repeated extension checks do not allow the same `resistance cleared` message to repost
- Why this matters:
  - live BIYA output used unnecessary urgency in `needs a better reaction quickly`
  - live logs showed repeated setup updates and repeated same-level `resistance cleared` posts, especially on SKYQ/SEGG/ATER-style movers
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/alert-router.test.ts src/tests/alert-intelligence.test.ts`
  - `npm run build`

### Suppressed duplicate fast level-clear posts

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - fast resistance/support clear updates now mark the cleared level before the Discord route resolves
  - added coverage for overlapping price ticks that cross the same cleared level while the first Discord post is still in flight
- Why this matters:
  - live logs showed BIYA and SEGG could post multiple `resistance cleared` messages within milliseconds for the same move
  - the duplicate posts came from concurrent async price-update handling, not from materially different levels
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`
  - `npm test`

### Started monitoring restored symbols during slow startup restores

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - startup restore now starts live monitoring for symbols as soon as they finish restoring instead of waiting for every persisted symbol to finish
  - startup restore level seeding now uses the same late-timeout grace path as queued activation, so a slow IBKR seed that finishes after the first timeout can still be used
  - runtime health now flips to started while restore is in progress, matching the fact that ready symbols can already be monitored
- Why this matters:
  - live logs showed KIDZ and SEGG restored successfully, but live price monitoring had not started because later symbols were still restoring or waiting on IBKR
  - DRCT also timed out during restore and then produced levels shortly after, which should not leave the whole runtime stalled
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`
  - `npm test`

### Added conditional support-reaction area to long-caution alerts

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/trader-commentary-service.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - breakdown, failed-breakout, and rejection alerts can now show a `next support reaction area` when the next support-side barrier is known
  - the support-reaction area is explicitly conditional, for example: buyers must stabilize there or reclaim the lost level
  - long-caution alerts now include a `Hold / failure map` that names the reclaim line and the next support risk area without telling the trader to buy or sell
  - the readable Discord alert includes the conditional support-reaction area in `What to watch` and labels it in `Key levels`
  - the live AI prompt now allows mentioning a provided support-reaction area only as conditional support where buyers must stabilize
  - removed direct-advice style phrases such as `avoid longs` from the raw watch-line language, replacing them with risk-context wording
- Why this matters:
  - long-only caution alerts should not only say what to avoid; they should also tell the trader where a future long setup might start to become interesting again
  - traders already in a position need a clean level map: what must be reclaimed or held, and where risk opens next if buyers do not stabilize
- Verification:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/trader-commentary-service.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`
  - `npm test`

### Tightened live AI commentary wording

- Updated:
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/trader-commentary-service.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - live AI signal commentary now asks for exactly one short sentence, capped at 35 words
  - added output blocking for `downside`, `target`, `objective`, `first support`, `next support`, `wait to open`, and `open new longs`
  - normalized AI punctuation back to ASCII before posting so Discord/audit logs stay cleaner
  - removed `Next levels` and target/barrier metadata from the live AI prompt payload so the model does not reframe support as a downside destination
- Why this matters:
  - live AI reads were successfully posting, but some still sounded too much like downside/support-target commentary instead of long-only chart context
- Verification:
  - `npx tsx --test src/tests/trader-commentary-service.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run build`
  - `npm test`

### Wired AI reads into live alert threads

- Updated:
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/runtime/manual-watchlist-page.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - `src/tests/trader-commentary-service.test.ts`
  - `src/tests/manual-watchlist-server.test.ts`
  - `README.md`
  - `docs/32_AI_COMMENTARY_WORKFLOW.md`
- What changed:
  - when `LEVEL_AI_COMMENTARY=1` and `OPENAI_API_KEY` are present, deterministic intelligent alerts still post first, then a separate `AI read` can post into the same symbol thread
  - AI commentary failures do not block deterministic alert delivery
  - added long-only AI prompt rules so bearish conditions are framed as wait/reclaim/confirmation/risk context, not short setups
  - added an output guard that drops AI text containing short-side or direct execution wording
  - updated the runtime UI/config route from `symbol recaps only` to `symbol recaps and live alert AI reads`
- Why this matters:
  - the private Discord test channel can now show whether AI commentary is actually useful beside the deterministic post, while the deterministic engine remains the source of truth
- Verification:
  - `npx tsx --test src/tests/trader-commentary-service.test.ts src/tests/manual-watchlist-server.test.ts src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts`
  - `npm run build`

### Kept Discord alert language long-only

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - reframed breakdown, failed-breakout, and resistance-rejection alerts as long-side risk/caution instead of short-side trade setups
  - removed bearish-breakdown, stay-below, rejection-continuation, and support-objective style wording from trader-facing alert copy
  - stopped long-caution events from publishing support-side targets as if they were downside objectives
  - kept bullish/reclaim/support-defense language focused on upside follow-through, confirmation, invalidation, and risk control
  - reframed live continuity updates for breakdown, failed-breakout, and rejection follow-through so they say long-side caution stayed active instead of implying a short setup worked
  - removed trader-facing `thread` and `continuity:` wording from setup updates, and added a short spacing guard so optional setup updates do not post immediately after more important alerts or follow-through posts
- Why this matters:
  - this system is intended for long-only traders, including newer traders, so bearish events should tell them when to avoid, wait, or require a reclaim rather than imply a short trade
  - Discord implementation words such as `thread` and internal labels such as `continuity` are not useful to traders reading live posts
- Verification:
  - `rg -n -i "stay below|shorting|sell short|short entry|bearish breakdown|target: first support objective|target: first resistance objective|rejection continuation|sellers defended|downside follow-through|support objective" src/lib/alerts src/lib/monitoring src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts`
  - `rg -n -i "\bshort\b|\bshorts\b" src/lib/alerts src/lib/monitoring src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts`
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts`
  - `npm run build`

### Stabilized activation after slow IBKR level seeding

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - serialized monitor restarts so old startup/restore work cannot keep reseeding symbols after the operator deactivates them
  - made activation retries reuse levels from a slow IBKR seed that finished after the timeout instead of starting another candle fetch
  - stopped monitoring restarts from starting live monitoring for symbols still in `activating`
  - made startup restore skip work for entries that were deactivated while restore was still running
  - reset `activatedAt` for reactivated or previously-stuck activating symbols so stale entries do not show huge stuck durations
  - kept forced refresh paths able to rebuild levels even when levels already exist
  - made deactivation cancel the symbol's queued activation epoch so late snapshot/seed work cannot flip removed symbols back into active health counts
  - changed runtime health counts to report live display entries, preventing inactive stored entries from appearing as active/pending in the summary cards
  - changed active-symbol boundary refreshes to use cached extension levels instead of force-rebuilding full historical candles during live movement
  - added an in-flight guard around extension checks so overlapping price updates cannot launch repeated maintenance rebuilds for the same symbol
- Why this matters:
  - live testing on April 28 showed new symbols stuck in `activating` while some had already received live prices or late `levels_seeded` events
  - the root issue was stale/repeated restore and retry work colliding with slow IBKR historical requests
  - later testing showed the visible active ticker list could be empty while summary cards still showed stale active/pending counts
  - SKYQ activation later showed active tickers could compete with new activations by repeatedly triggering full historical refreshes from extension fallback
- Verification:
  - `npm test`
  - `npm run build`

## 2026-04-27 America/Toronto

### Added trader-story Discord posts and operator controls

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/watchlist-store.ts`
  - `src/lib/monitoring/watchlist-state-persistence.ts`
  - `src/runtime/manual-watchlist-page.ts`
  - `src/runtime/manual-watchlist-server.ts`
  - related formatter, runtime, server, and persistence tests
- What changed:
  - changed intelligent alerts, follow-through updates, and fast level-clear bridge posts to use a consistent `Status`, `What it means`, `What to watch`, and `Next levels` structure
  - simplified trader-facing pressure wording while keeping scores in metadata/audit fields
  - added per-ticker operation status, last live price timestamp, last Discord post timestamp, and last Discord post kind
  - persisted the new watchlist entry health fields so startup restore and UI state are easier to inspect
  - added UI buttons to copy a thread id, repost the latest level snapshot, and manually refresh levels for an active ticker
  - added server endpoints for manual level refresh and snapshot repost
- Why this matters:
  - the Discord thread should read more like one evolving trade story instead of a stream of raw system events
  - the operator UI now explains whether a ticker is queued, building levels, posting a snapshot, monitoring live price, or waiting on retry/restore
  - manual refresh/repost controls make market-closed testing and live debugging easier without rebuilding the watchlist
- Verification:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/manual-watchlist-server.test.ts src/tests/watchlist-state-persistence.test.ts`
  - `npm run build`

### Polished alert wording for market-closed review

- Updated:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
- What changed:
  - removed raw pressure-score numbers from trader-facing intelligent alert copy while keeping the underlying score in metadata
  - formatted single-price zones as one level, so alerts say `3.10` instead of `3.10-3.10`
  - reused the single-level formatting in level-touch and compression watch lines
  - added coverage to prevent single-price zones from regressing back into duplicated ranges
- Why this matters:
  - live CAST output showed the core read was improving, but score-like text and repeated same-price ranges still made the post feel more mechanical than trader-friendly
- Verification:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`

### Added same-level story priority and fast level-clear bridge posts

- Updated:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - added a same-level story resolver so a failed breakout/breakdown suppresses older lower-value level-touch follow-through on the same price area
  - suppressed zero-move breakout/breakdown `stalling` state updates so the thread does not post `setup move: +0.00%` before a clearer outcome
  - added compact `level_clear_update` posts when price quickly clears the nearest snapshot resistance/support before the normal zone alert catches the move
  - de-duplicated those fast-clear posts per symbol/level so repeated ticks above the same cleared level do not spam Discord
- Why this matters:
  - live CAST testing showed overlapping posts for the same 2.90 area: breakout state, breakout failed, and older level-touch follow-through
  - the thread should present one evolving story per level, with breakout failure taking priority over stale level-touch success
  - fast clears such as `2.90 cleared, next test 3.10` now get their own short bridge update instead of waiting for the next level touch
- Verification:
  - `npm test`
  - `npm run build`

### Prevented level-touch state updates from posting before delayed alerts

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - when a `level_touch` alert is in the short supersede delay window, follow-through state updates for that same symbol/event are held back
  - added coverage for the exact ordering problem where a `level touch state update` could appear before the `level touch` alert itself
- Why this matters:
  - live CAST testing showed a confusing sequence where the state update posted about 0.8 seconds before the underlying alert
  - the live thread should introduce the setup first, then post follow-through/state only after the setup exists in Discord
- Verification:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/monitoring-events.test.ts`
  - `npm run build`

### Tightened live alert posts and same-zone chatter

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - changed intelligent alert Discord bodies to use a shorter `Read` section plus `Nearby levels`
  - removed raw score/risk math and internal labels from the live post body while keeping those details in metadata/audit fields
  - de-duplicated repeated nearby levels when the first objective and next barrier are the same price
  - added a short level-touch supersede delay so an immediate breakout/breakdown can replace the earlier touch instead of posting both back-to-back
- Why this matters:
  - live CAST output showed that the alert stream was closer, but still too verbose and confusing for newer traders
  - a level touch followed immediately by a breakout should read as one decision update, not two competing messages
- Verification:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/alert-intelligence.test.ts`
  - `npm run build`

### Reworked level snapshot posts for beginner readability

- Updated:
  - `src/lib/alerts/alert-router.ts`
  - `src/tests/alert-router.test.ts`
  - `docs/37_DISCORD_THREAD_POSTING_SUGGESTIONS_2026-04-25.md`
- What changed:
  - recorded live CAST feedback that the old `LEVEL SNAPSHOT` format was not readable enough for traders, especially newer traders
  - changed snapshot Discord output to lead with `CURRENT READ`, then `KEY LEVELS`, then the longer `FULL LADDER`
  - kept the full support/resistance ladder available, but moved it below the simpler read so the post no longer starts as a dense level dump
- Why this matters:
  - the old format had useful data but forced the trader to decode the map, room bias, support ladder, and resistance ladder before knowing what mattered now
  - the new format states the immediate support/resistance relationship and room condition first

## 2026-04-24 2:31 PM America/Toronto

### Gave manual first activations a longer IBKR historical timeout

- Updated:
  - `src/runtime/manual-watchlist-server.ts`
  - `README.md`
- What changed:
  - the manual runtime now constructs the IBKR historical candle provider with a longer default timeout of `90000ms` instead of relying on the provider's shorter default
  - the timeout is configurable through `MANUAL_WATCHLIST_IBKR_TIMEOUT_MS`
  - the runtime now logs the effective IBKR historical timeout at startup for easier live debugging
- Why this matters:
  - live evidence from `LIDR` showed that thread creation and activation could start successfully while historical candle seeding still timed out before levels were generated
  - when that happened, the queued activation rolled back out of the active list and looked like it vanished, even though the real issue was just a slow IBKR historical response

## 2026-04-24 1:26 PM America/Toronto

### Let slow queued activations finish during a grace window

- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- What changed:
  - queued manual activations now tolerate slow first-time level seeding beyond the initial timeout instead of immediately rolling back the symbol
  - if seeding finishes during the grace window, the symbol still completes activation and posts its first level snapshot
  - truly hung seeds still fail once the combined timeout and grace window are exhausted

### Switched Finnhub website line to a clickable full URL

- Updated:
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/tests/finnhub-thread-preview.test.ts`
- What changed:
  - the Finnhub opener now emits the website as a fully qualified URL so Discord will auto-link it reliably
  - if Finnhub ever returns a bare domain, the formatter now prepends `https://`
  - Finnhub opener posts now set Discord's suppress-embeds flag so the website stays a one-line text link instead of expanding into a preview card

## 2026-04-24 11:48 AM America/Toronto

### Simplified Finnhub opener formatting

- Updated:
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/lib/alerts/discord-rest-thread-gateway.ts`
- What changed:
  - removed the redundant `STOCK CONTEXT: SYMBOL` title from the Finnhub opener so the post starts directly with labeled company fields
  - removed the redundant `TICKER:` line from the body
  - website display now strips both the protocol and a leading `www.` prefix

## 2026-04-24 11:17 AM America/Toronto

### Marked runtime ready once IBKR is connected, not after full restore finishes

- Updated:
  - `src/runtime/manual-watchlist-server.ts`
  - `README.md`
- What changed:
  - `startupState` now flips to `ready` immediately after IBKR connection succeeds
  - the slower persisted-symbol restore pass still continues in the background, but new activations no longer stay blocked behind that entire startup workload
  - this fixes the case where the UI already shows live active symbols but `/api/watchlist/activate` still returns `Runtime is still starting`

## 2026-04-24 11:03 AM America/Toronto

### Allowed deactivation during runtime startup

- Updated:
  - `src/runtime/manual-watchlist-server.ts`
  - `README.md`
- What changed:
  - removed the shared startup gate from `/api/watchlist/deactivate`
  - new activations still wait for runtime startup to complete, but deactivation is now allowed while persisted symbols are still restoring or seeding
  - this prevents the UI from showing `Runtime is still starting` when the user is trying to stop already-visible active symbols during boot

## 2026-04-24 09:46 AM America/Toronto

### Added a separate Finnhub stock-context prototype for the first thread post

- Added:
  - `src/lib/stock-context/finnhub-client.ts`
  - `src/lib/stock-context/finnhub-thread-preview.ts`
  - `src/scripts/run-finnhub-thread-preview.ts`
  - `src/tests/finnhub-thread-preview.test.ts`
  - `package.json`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - added a standalone Finnhub client for `quote`, `stock/profile2`, and `company-news`
  - added a terminal formatter that prints the planned pre-level thread opener as a compact stock-context preview
  - added `npm run finnhub:test -- <SYMBOL>` so this first-post idea can be tested in isolation before wiring it into the live Discord/runtime flow
  - kept the prototype in new separate files so it does not tangle with the current manual watchlist runtime yet
  - later narrowed the first-post prototype to ticker-specific Finnhub quote/profile data only, leaving news for a separate future channel
  - later narrowed the preview field set further to company name, ticker, exchange, industry, country, website, market cap, current price, percent move, and open/high/low/previous close
  - later removed Finnhub quote/price fields from the live opener after premarket testing showed free-tier quote data could be stale
  - wired that labeled stock-context card into the live manual watchlist runtime so newly created Discord threads now get the opener before levels finish generating when `FINNHUB_API_KEY` is set

## 2026-04-23 8:10 PM America/Toronto

### Reduced repetitive thread noise by hardening identical extension dedupe and lengthening same-scope alert repost windows

- Updated identical extension dedupe in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated alert repost policy defaults in:
  - `src/lib/alerts/alert-config.ts`
- Updated focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/alert-intelligence.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - identical `NEXT LEVELS` payloads now stay suppressed until the extension payload actually changes, instead of becoming eligible again after the normal refresh cooldown
  - trader-facing alert repost windows are now longer across `zone_context`, `bullish_resolution`, `bearish_resolution`, and `failure` families
  - same-scope reposts also now require a larger score delta before they count as materially new
  - added a manual-runtime regression test proving an identical extension payload does not repost after the old cooldown window
  - added an alert-intelligence regression test proving a same-zone directional story is still suppressed ten minutes later when the trader-facing situation has not materially changed
- Why this matters:
  - live Discord evidence showed symbols like `AMST` reposting the exact same extension ladder and symbols like `AIXI`, `ITOC`, and `TDIC` revisiting the same structural story too often for a trader-facing notification stream
  - the goal is to keep Discord focused on actual structural progress, not repeated reminders that nothing new has happened yet
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npx tsx --test src/tests/alert-intelligence.test.ts`

---

## 2026-04-23 7:05 PM America/Toronto

### Kept long-run review artifacts updating after runtime stdout goes quiet

- Updated long-run launcher summary refresh in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - the launcher now polls `discord-delivery-audit.jsonl` and feeds newly appended delivery rows back through the same summary pipeline
  - `session-summary.json`, `thread-summaries.json`, `thread-clutter-report.json`, `session-review.md`, and `trader-thread-recaps.md` now keep refreshing even when runtime stdout stops producing lines
  - the launcher also tracks already-seen audit rows so early delivery events that still appear on stdout do not get double-counted
- Why this matters:
  - the live post-market session showed the runtime and Discord audit continuing long after the review artifacts froze at the last console line
  - long-run review should describe what actually reached Discord, not just what happened before the console went quiet
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

---

## 2026-04-23 4:45 PM America/Toronto

### Bounded hung manual activation seeds and made `refresh_pending` review language more honest

- Updated manual activation / refresh seeding in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated long-run review heuristics in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - manual level seeding now uses a bounded timeout, so a symbol that hangs during activation fails explicitly instead of sitting in `refresh_pending` forever without a `levels_seeded` or `activation_failed` outcome
  - refresh-triggered reseeds now revert back to `active` when older levels are still available but the refresh seed fails, instead of leaving the thread parked in `refresh_pending`
  - added a regression test that reproduces a hung queued activation and proves it rolls back with an `activation_failed` lifecycle event
  - long-run review now treats `refresh_pending` no-output symbols as pending work rather than falsely noisy
- Why this matters:
  - the live `INTC` session showed a real failure mode where activation reached `activation_started` and then stalled silently with no seed, snapshot, or explicit failure
  - this keeps the runtime honest for the trader and the operator: either the symbol seeds, fails clearly, or stays on older usable levels, but it does not just hang invisibly
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

---

## 2026-04-23 2:45 PM America/Toronto

### Bound the manual UI immediately so long startup restores no longer refuse the browser

- Updated runtime startup flow in:
  - `src/runtime/manual-watchlist-server.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- What changed:
  - the HTTP server now binds to `127.0.0.1:3010` immediately instead of waiting for IBKR connection plus persisted-symbol restore/seeding to finish
  - runtime boot now continues in the background with explicit `startupState` / `startupError` tracking
  - `/api/runtime/status` and `/api/watchlist` now expose that startup state
  - activate/deactivate endpoints now return `503` until runtime startup is actually `ready`, instead of failing behind a refused browser connection
- Why this matters:
  - live sessions with many restored symbols could spend minutes seeding before `listen()` ever happened, which made the UI look dead even though the process was actively restoring
  - the browser should now load immediately and make startup latency visible instead of looking like a crash
- Verification completed:
  - `npm run check`

---

## 2026-04-23 1:05 PM America/Toronto

### Tightened same-window continuity overlap and fixed event-side continuity mismatches

- Updated runtime continuity behavior in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/lib/monitoring/opportunity-interpretation.ts`
- Updated focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - same-window `follow_through_state` posts now suppress weaker `setup_forming`, `confirmation`, and `weakening` continuity more aggressively, so a state update is less likely to be followed by a near-duplicate optional narration beat
  - monitoring-event continuity now only posts when the interpretation matches the triggering event's `eventType`, side, and near-enough level, which prevents support-style continuity wording from leaking into resistance-side threads when multiple same-symbol opportunities coexist
  - added a runtime regression test that proves only the event-matching continuity beat is allowed through when both support-side and resistance-side interpretations exist for the same symbol
- Why this matters:
  - the live `AUUD` and `PAPL` sessions showed that the remaining clutter problem was no longer broad thread noise, but same-window overlap plus occasional wrong-side continuity wording
  - this keeps the live thread closer to one coherent story: the alert or state post says what happened, and continuity only adds value when it is about that same event
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-interpretation.test.ts src/tests/opportunity-runtime-integration.test.ts src/tests/alert-router.test.ts`
  - `npm run check`

---

## 2026-04-23 11:10 AM America/Toronto

### Made long-run review language more honest for activating and observational threads

- Updated long-run review heuristics in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - quality heuristics now treat still-activating symbols as pending review instead of penalizing them immediately for lacking visible output
  - observational threads with clean snapshots and no real live alert activity now read as observational instead of being pulled toward a falsely noisy verdict
  - thread summaries now show `activating` explicitly when a symbol has not yet finished producing visible live output
- Why this matters:
  - after the `AIXI` and `AKAN` sessions, the clutter report was already honest but the thread summary language still felt harsher than the actual trader-facing behavior
  - this keeps the review layer aligned with what the trader actually saw: quiet, observational, or still-starting is not the same thing as noisy
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

---

## 2026-04-23 10:55 AM America/Toronto

### Added event-family-aware continuity gating so support-test threads narrate less freely than breakout threads

- Updated runtime live-post discipline in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated focused runtime coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - `level_touch` and `compression` families now get a stricter optional-post budget than directional families like `breakout`, `breakdown`, and `reclaim`
  - reactive families now allow only a much narrower continuity / recap / live-state path, which reduces support-test narration drift
  - continuity label changes no longer bypass optional-post gating, so event-family throttling now applies to real lifecycle transitions instead of only duplicate-state reposts
  - paired regression tests now protect both sides of the behavior:
    - reactive `level_touch` threads stay quieter
    - directional breakout threads can still advance from setup-forming into confirmation
- Why this matters:
  - the live `AUUD` session showed that a support-test thread could still stack optional narration even after the broader clutter pass improved `BURU` and `AIXI`
  - this pass keeps the thread story richer where directional progression matters while treating support-test narration as a scarcer resource
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-interpretation.test.ts src/tests/alert-router.test.ts`
  - `npm run check`

---

## 2026-04-23 10:30 AM America/Toronto

### Tightened optional live-thread throttling again and fixed clutter review for quiet symbols

- Updated runtime live-post throttling in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated long-run clutter review in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - optional live posts now back off faster once recap / continuity / live-state narration starts materially outnumbering recent trader-critical posts
  - recap posts now tighten earlier when the thread is already context-heavy and no fresh critical beat has arrived recently
  - follow-through-state and continuity updates also tighten sooner when optional narration starts leading the thread instead of supporting it
  - `thread-clutter-report.json` now treats truly low-context threads as low clutter even if the symbol was suppression-heavy internally, so quiet live threads are not mislabeled as moderate-risk just because detectors kept filtering setups
- Why this matters:
  - the live `BURU` session showed that optional thread context could still stack up too aggressively after the main alert story was already established
  - the live `AIXI` session showed that clutter review was still conflating internal suppression with actual trader-facing thread clutter
  - this pass keeps the thread-review system anchored to what the trader actually saw instead of what only happened behind the scenes
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-interpretation.test.ts src/tests/alert-router.test.ts`
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-23 02:10 AM America/Toronto

### Made optional live-post gating category-aware so thread context stays rich without drifting into generic narration

- Updated runtime live-post discipline in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated interpretation contracts in:
  - `src/lib/monitoring/opportunity-interpretation.ts`
- Updated focused coverage in:
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/opportunity-diagnostics.test.ts`
  - `src/tests/opportunity-interpretation.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - the runtime now tracks recent critical versus optional live thread posts per symbol and prunes them inside a rolling window instead of treating optional context as a stateless cooldown problem
  - recap, continuity, and live follow-through-state posts now use category-aware gating rather than one generic optional-context rule
  - recap posts are stricter than continuity posts, and non-directional optional narration is less likely to post when a thread is already context-heavy without recent critical movement
  - trader continuity interpretations now carry canonical `eventType`, so live-post discipline can distinguish directional setups from weaker context-only narration without changing the deterministic wording itself
  - setup-forming narration is now explicitly covered by a runtime-manager regression test so it does not quietly slip back into live recap spam
- Why this matters:
  - the thread can stay rich when the story is genuinely evolving, but optional context is less likely to pile on top of already-dense threads
  - the system is now closer to per-category thread discipline instead of broad global suppression that could accidentally flatten useful continuity
  - this keeps the recent tightening pass aligned with the review notes in `docs/33...` and `docs/34...`: richer where earned, quieter where repetition would dominate
- Verification completed:
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-interpretation.test.ts src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts`
  - `npm run check`

---

## 2026-04-23 01:10 AM America/Toronto

### Tightened live-thread discipline, added deterministic clutter analysis, and kept AI review-only

- Updated runtime gating in:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated trader-facing wording and consolidation rules in:
  - `src/lib/alerts/trader-message-language.ts`
- Expanded operator review and AI-summary plumbing in:
  - `scripts/start-manual-watchlist-long-run.ps1`
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/scripts/generate-ai-long-run-summary.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/00_DOC_INDEX.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/32_AI_COMMENTARY_WORKFLOW.md`
- What changed:
  - long-run sessions now write `thread-clutter-report.json`, which measures per-symbol live post totals, trader-critical versus trader-helpful optional post mix, alert-to-context ratio, context density, and clutter-risk heuristics
  - session artifacts now classify output more explicitly into trader-critical live posts, trader-helpful but optional live posts, and operator-only artifacts
  - live continuity posting is tighter, including stronger suppression of low-value setup-forming regression and weaker repeat narration
  - live follow-through state posting is tighter, with cooldown and directional-delta checks so small oscillations do not keep re-posting
  - recap posting is tighter, so routine setup-forming chatter is less likely to become live recap spam unless the thread is meaningfully evolving
  - trader-facing wording is slightly more disciplined: benign default `contained` failure-risk lines, default `workable` trigger-quality lines, and fully clean one-barrier path-quality lines are now suppressed when they only restate the same non-problem
  - the AI review layer now ingests `thread-clutter-report.json` when present so post-run AI summaries can stay review-focused without expanding live AI behavior
- Why this matters:
  - the project now measures thread clutter directly instead of only inferring it from long-run feel
  - live Discord posts stay richer where it matters but are less likely to drift into narration for narration's sake
  - AI remains downstream of deterministic facts and more clearly positioned as operator/review help instead of a source of live signal truth
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/trader-commentary-service.test.ts`
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-22 11:59 PM America/Toronto

### Tightened live thread continuity, deepened path / exhaustion tradeability, and expanded AI review outputs

- Updated alert and commentary contracts in:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated monitoring and runtime flow in:
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/monitoring-event-scoring.ts`
  - `src/lib/monitoring/event-detector.ts`
  - `src/lib/monitoring/opportunity-engine.ts`
  - `src/lib/monitoring/opportunity-evaluator.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Expanded AI summary tooling in:
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/scripts/generate-ai-long-run-summary.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/opportunity-evaluator.test.ts`
  - `src/tests/trader-commentary-service.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
  - `docs/32_AI_COMMENTARY_WORKFLOW.md`
- What changed:
  - live follow-through state changes now use smarter thresholds and longer cooldowns, so `improving`, `stalling`, and `degrading` posts reflect more meaningful movement instead of low-value churn
  - continuity posts now prefer real lifecycle transitions and suppress repeat restatements more aggressively
  - multi-barrier path quality now considers barrier density, barrier strength, and compressed gaps across the first path window instead of only the nearest obstacle
  - alert metadata and Discord audit rows now carry `pathConstraintScore` and `pathWindowDistancePct` so review can compare cleaner continuation space against technically open but still cramped early paths
  - exhaustion wording is more explicit about when a support or resistance level still matters structurally but has become tactically worn or spent
  - dip-buy-quality wording now downgrades layered or worn support more decisively into watch-only or tactically poor cases
  - in-session symbol recaps now include a deterministic `What matters next` line so longer-lived threads can summarize the current state and the next requirement for continuation
  - the AI review layer now supports per-symbol thread summaries and noisy-family review, and `npm run longrun:ai:summary` now writes both `session-ai-review.md` and `thread-ai-recaps.md`
- Why this matters:
  - traders get cleaner mid-flight updates instead of a noisier stream of tiny progress changes
  - layered, compressed, or early-cramped paths can now be penalized more honestly before they become trader-facing conviction
  - per-symbol AI recaps and noisy-family review make the AI layer more useful for review while staying downstream of deterministic scoring
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-evaluator.test.ts src/tests/trader-commentary-service.test.ts`
  - `npm run check`

---

## 2026-04-22 11:59 PM America/Toronto

### Added live state changes, path-quality / exhaustion context, in-session recaps, and the first AI recap layer

- Updated alert and commentary contracts in:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated monitoring and runtime flow in:
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/monitoring-event-scoring.ts`
  - `src/lib/monitoring/event-detector.ts`
  - `src/lib/monitoring/opportunity-engine.ts`
  - `src/lib/monitoring/opportunity-diagnostics.ts`
  - `src/lib/monitoring/opportunity-evaluator.ts`
  - `src/lib/monitoring/opportunity-runtime-controller.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-events.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Added optional AI recap tooling in:
  - `src/lib/ai/trader-commentary-service.ts`
  - `src/scripts/generate-ai-long-run-summary.ts`
- Updated runtime startup plumbing in:
  - `src/runtime/manual-watchlist-server.ts`
  - `package.json`
- Updated long-run artifact generation in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated focused coverage in:
  - `src/tests/trader-commentary-service.test.ts`
  - `src/tests/opportunity-evaluator.test.ts`
  - `src/tests/opportunity-runtime-integration.test.ts`
  - `src/tests/opportunity-diagnostics.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/alert-intelligence.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
  - `docs/32_AI_COMMENTARY_WORKFLOW.md`
  - `docs/00_DOC_INDEX.md`
- What changed:
  - active setups can now post live follow-through state changes like `improving`, `stalling`, or `degrading` before the final evaluation window closes
  - active symbol threads can now post continuity updates such as `setup forming`, `confirmation`, `continuation`, `weakening`, or `failed`
  - long-lived symbols can now post in-session recap messages instead of forcing the trader to reconstruct the story from a pile of alerts
  - monitoring events, opportunity ranking, and trader-facing alerts now carry multi-barrier `path quality` plus explicit zone `exhaustion` context
  - support-test alerts now use that new context to separate cleaner actionable dip-buy tests from structurally real but tactically worn-out bounces
  - the optional AI layer can now enhance in-session symbol recaps and generate a post-run `session-ai-review.md` from deterministic session artifacts when `OPENAI_API_KEY` is available
  - the roadmap now explicitly parks the future volume/activity storytelling idea so that work is not lost while deterministic continuity and recap work takes priority
- Why this matters:
  - the trader-facing thread can now behave more like an evolving story instead of a set of disconnected setup alerts
  - layered nearby barriers and worn-out zones are now penalized earlier, which should help keep tactically messy setups from being overstated
  - the first AI layer stays safely on the explanation/summarization side instead of replacing deterministic signal detection
- Verification completed:
  - `npm test`
  - `npm run check`

---

## 2026-04-22 11:55 PM America/Toronto

### Added live follow-through updates, clutter-aware pathing, and richer trader recaps

- Updated trader-context and payload plumbing in:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
  - `src/lib/alerts/local-discord-thread-gateway.ts`
- Updated monitoring and runtime flow in:
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/monitoring-event-scoring.ts`
  - `src/lib/monitoring/event-detector.ts`
  - `src/lib/monitoring/opportunity-engine.ts`
  - `src/lib/monitoring/opportunity-evaluator.ts`
  - `src/lib/monitoring/opportunity-diagnostics.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-events.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated long-run recap generation in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/opportunity-diagnostics.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
- What changed:
  - completed opportunity evaluations now post live follow-through updates back into the symbol thread with deterministic `strong`, `working`, `stalled`, or `failed` language
  - monitoring events now carry barrier-clutter context so the system can distinguish cleaner paths from `stacked` or `dense` overhead/downside pathing
  - alert scoring, failure-risk wording, trigger quality, and room wording now account for nearby path clutter
  - support-test alerts now include deterministic `dip-buy quality:` wording so traders can tell whether a bounce looks actionable, watch-only, or tactically poor
  - long-run sessions now write `trader-thread-recaps.md` and capture live follow-through posts in the per-symbol recap flow
- Why this matters:
  - traders now get useful continuation feedback after the original alert instead of having to infer outcome from later price action alone
  - crowded pathing and weak dip-buy situations are called out earlier and more explicitly before they become expensive false positives
  - post-run review is easier because the session artifacts now have a shorter human-readable per-symbol recap layer in addition to the JSON summaries
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/opportunity-diagnostics.test.ts src/tests/opportunity-runtime-integration.test.ts`
  - `npm run check`

---

## 2026-04-22 10:40 PM America/Toronto

### Added deterministic setup-state context to trader alerts and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - trader-facing alerts now include a deterministic `setup state:` line
  - setup state is classified as `building`, `confirmation`, `continuation`, `weakening`, or `failed`
  - alert payload metadata and Discord delivery audit rows now carry `setupStateLabel`
- Why this matters:
  - end users can tell whether a message is the first setup build, a real confirmation, a continuation, a deterioration, or a failed idea instead of treating each alert as an isolated post
  - long-run review can now compare whether the app is posting enough confirmation-quality updates versus too many weakening or failed states
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 10:20 PM America/Toronto

### Added deterministic failure-risk context to trader alerts and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - trader-facing alerts now include a deterministic `failure risk:` line
  - failure risk is classified from contained / watchful / elevated / high using room, trigger timing, pressure, tired structure, degraded data, and compromised inner directional context
  - alert payload metadata and Discord delivery audit rows now carry `failureRiskLabel`
- Why this matters:
  - traders can see more quickly when a setup still looks acceptable versus when it is already carrying multiple reasons to fail
  - long-run review can now compare whether elevated-risk alerts should be downgraded or suppressed more aggressively before AI commentary is layered on top
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 09:55 PM America/Toronto

### Added deterministic follow-through grading to long-run review artifacts

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - completed evaluations are now classified into follow-through grades of `strong`, `working`, `stalled`, or `failed`
  - `session-summary.json` now tracks session-level and per-symbol follow-through grade counts instead of only raw wins, losses, and return percentages
  - `thread-summaries.json` now includes the latest follow-through summary so each symbol's newest completed setup can be reviewed quickly
  - `session-review.md` now shows the session's follow-through-grade mix alongside the strongest and weakest evaluated event types
- Why this matters:
  - post-run review can now answer whether a setup actually kept moving the right way after the alert without manually translating bullish versus bearish return signs
  - this gives us a cleaner deterministic base before AI commentary is layered on top of the session artifacts
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-22 09:20 PM America/Toronto

### Tightened directional alert scoring after live YCBD review

- Reviewed live long-run artifacts from:
  - `artifacts/long-run/2026-04-22_19-10-28`
- Updated alert scoring in:
  - `src/lib/alerts/alert-config.ts`
  - `src/lib/alerts/alert-scorer.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
- What changed:
  - directional alerts now take extra penalties when a breakout / breakdown / reclaim-style setup is both inner and not backed by strong pressure
  - degraded-data directional setups are now penalized more explicitly instead of letting high structural scores dominate the final severity
  - confidence is now capped away from `high` when the trigger itself is already `crowded` or `late`, or when pressure is still only tentative
- Why this matters:
  - live evidence from `YCBD` showed a breakout message whose wording correctly admitted tentative pressure and tired structure, but whose score still escalated it too aggressively
  - the score and confidence layer now agrees better with the trader-facing wording instead of overstating compromised entries
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 09:00 PM America/Toronto

### Added deterministic trader trigger-quality context and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - trader-facing alerts now include a deterministic `trigger quality:` line
  - trigger quality is classified as `clean`, `workable`, `crowded`, or `late` based on movement stage, pressure, and nearby room
  - alert payload metadata and Discord delivery audit rows now carry `triggerQualityLabel`
- Why this matters:
  - traders can tell more quickly whether the entry still looks timely or whether the setup is already crowded or stretched
  - long-run review can now compare whether `clean` triggers actually outperform `crowded` or `late` ones before tightening posting thresholds further
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 08:40 PM America/Toronto

### Added explicit trader pressure context and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - trader-facing alerts now include a deterministic `pressure:` line driven by `bias` plus `pressureScore`
  - the pressure line distinguishes `strong`, `workable`, `tentative`, and `balanced` control instead of leaving momentum context hidden in raw scores
  - alert payload metadata and Discord delivery audit rows now carry `pressureLabel` and `pressureScore`
- Why this matters:
  - traders can tell more quickly whether a breakout, reclaim, or support test still has real directional pressure behind it
  - long-run review can now compare whether strong-pressure alerts actually outperform tentative-pressure alerts before tightening posting rules further
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 08:20 PM America/Toronto

### Added explicit first-target trader context and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - directional alerts now include a deterministic `target:` line when the next meaningful directional barrier is known
  - the target line explicitly names the first support or resistance objective instead of forcing the trader to infer it from the `room:` line
  - alert payload metadata and Discord delivery audit rows now carry `targetSide`, `targetPrice`, and `targetDistancePct`
- Why this matters:
  - traders can see the first obvious objective faster without translating room language back into a price target themselves
  - long-run review can now compare whether alerts with clean nearby objectives are more useful than alerts where the next directional barrier is still unclear
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 07:55 PM America/Toronto

### Added bullish / bearish / balanced room classification to snapshot maps

- Updated snapshot formatting in:
  - `src/lib/alerts/alert-router.ts`
- Updated focused coverage in:
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-rest-thread-gateway.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - the snapshot `MAP:` line now classifies nearby room as `bullish room`, `bearish room`, or `balanced room` instead of only saying which side is tighter
  - snapshots still show the exact nearest support and resistance distances, but now also give a faster directional read
- Why this matters:
  - traders get a more natural read on whether the nearby map favors upside, downside, or neither without doing the comparison themselves
  - this is a better bridge between raw level data and trader interpretation
- Verification completed:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/discord-rest-thread-gateway.test.ts`
  - `npm run check`

---

## 2026-04-22 07:45 PM America/Toronto

### Added nearest-level map summaries to trader snapshots

- Updated snapshot formatting in:
  - `src/lib/alerts/alert-router.ts`
- Updated focused coverage in:
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-rest-thread-gateway.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - Discord level snapshots now include a `MAP:` line that summarizes the nearest support, nearest resistance, and whether overhead or downside is tighter
  - the existing distance-aware ladder remains intact underneath that summary line
- Why this matters:
  - traders can tell at a glance whether overhead or downside is the tighter side before reading the full ladder
  - the snapshot now behaves more like a compact movement map than a list of detached levels
- Verification completed:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/discord-rest-thread-gateway.test.ts`
  - `npm run check`

---

## 2026-04-22 07:35 PM America/Toronto

### Added distance-aware trader snapshot formatting

- Updated snapshot formatting in:
  - `src/lib/alerts/alert-router.ts`
- Updated focused coverage in:
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-rest-thread-gateway.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - Discord level snapshots now include signed percentage distance from the current price beside each support and resistance level
  - snapshot ladders still keep strength and extension descriptors when available, but now lead with how near or far the level is from price
- Why this matters:
  - a trader can scan snapshot ladders faster without manually estimating how much room exists to the nearest support or resistance
  - this makes snapshot posts more useful for active movement tracking instead of acting like static level dumps
- Verification completed:
  - `npx tsx --test src/tests/alert-router.test.ts src/tests/discord-rest-thread-gateway.test.ts`
  - `npm run check`

---

## 2026-04-22 07:20 PM America/Toronto

### Added trade-map alert context for room versus invalidation risk

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - directional alerts now include a deterministic `trade map:` line that compares risk-to-invalidation against room-to-next-barrier
  - trade-map output now labels setups as `favorable`, `workable`, or `tight` based on room-to-risk skew
  - alert payload metadata and Discord delivery audit rows now carry `tradeMapLabel`, `riskPct`, and `roomToRiskRatio`
- Why this matters:
  - traders can see more quickly whether a setup still has usable upside or downside before the next barrier
  - this makes the alert stream more actionable by quantifying both opportunity and invalidation, not just describing structure
  - long-run review can now compare whether favorable-skew setups actually outperform tight-skew ones
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 07:05 PM America/Toronto

### Added movement-aware trader alerts and audit metadata

- Updated trader-facing alert formatting in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - trader-facing alerts now include a deterministic `movement:` line that explains how far price has already moved through or back into the zone at trigger time
  - breakout, breakdown, and reclaim alerts now distinguish between early, building, and already-extended movement states
  - level-touch, compression, rejection, and fakeout-style alerts now explain whether price is still testing inside the band or has already moved back through the edge
  - alert payload metadata and Discord delivery audit rows now carry `movementLabel` and `movementPct` for later review
- Why this matters:
  - traders can tell more quickly whether they are seeing an early move or something already getting stretched
  - post-run review can later compare whether early alerts are more useful than already-extended ones
  - this makes the app better at tracking price movement instead of only naming the setup type
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 06:40 PM America/Toronto

### Added dynamic-symbol and outcome-disagreement review to long-run artifacts

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - long-run thread summaries now include state-change summaries derived from activation, deactivation, and failure lifecycle events
  - long-run review now highlights the most dynamic symbols in the session instead of only the noisiest ones
  - thread summaries now flag outcome disagreement when a symbol posted alerts but evaluated follow-through leaned negative, or when human review and measured follow-through point in different directions
  - end-of-session summaries now treat repeated activation/deactivation churn as a first-class signal when deciding whether a thread looked trustworthy
- Why this matters:
  - a busy symbol can now be recognized as truly dynamic instead of being mistaken for pure noise
  - repeated reactivation churn is easier to separate from healthy alert flow
  - symbols that sounded convincing in Discord but did not follow through are easier to spot after the run
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-22 06:20 PM America/Toronto

### Added event-type evaluation alignment to long-run review artifacts

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - long-run session summaries now keep completed evaluation stats bucketed by alert event type, not just in one session-wide win/loss pool
  - `session-summary.json` now carries strongest and weakest evaluated alert-family highlights derived from those event-type buckets
  - per-symbol thread summaries now surface alert/evaluation alignment for the latest alert family when enough evaluated follow-through exists
  - `session-review.md` now shows strongest and weakest evaluated event types so the review tells us which alert families are actually earning trust
- Why this matters:
  - sessions can now answer whether `breakout`, `reclaim`, `compression`, or other alert families are validating cleanly instead of only telling us that "some alerts won and some lost"
  - a symbol's latest alert can be judged against the real recent behavior of that same setup family, which is much more useful than a generic thread verdict
  - this gives us a better deterministic base before we layer in AI commentary or broader tuning decisions
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-22 03:25 PM America/Toronto

### Improved trader-facing `why now` wording and made long-run review less diagnostic-biased

- Updated trader-facing alert wording in:
  - `src/lib/alerts/trader-message-language.ts`
- Updated long-run review and summary logic in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
- What changed:
  - trader-facing alerts now include a deterministic `why now:` line for breakout, breakdown, reclaim, rejection, compression, fakeout, and level-touch setups
  - long-run thread summaries now include latest evaluation context, not just the last alert and last opportunity
  - long-run quality heuristics now incorporate evaluated follow-through wins/losses
  - noisiest-symbol scoring now caps raw diagnostic pressure so a healthy but chatty symbol does not look artificially bad
  - end-of-session summaries now use evaluated outcome context before falling back to generic room/tactical wording
- Why this matters:
  - end users get a faster explanation of what changed right now instead of only seeing a setup label
  - runtime review is less likely to confuse detector verbosity with genuinely noisy trader-facing output
  - symbols like `AKAN` now produce more honest post-run summaries when they have mixed or positive evaluated follow-through
- Verification completed:
  - `npx tsx --test src/tests/alert-intelligence.test.ts`
  - `npm run build`
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

---

## 2026-04-22 05:50 PM America/Toronto

### Added usefulness/noise heuristics to long-run session review

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Added the human review helper script:
  - `scripts/add-long-run-review-feedback.ps1`
- Updated trader-facing alert wording and alert metadata in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated:
  - `README.md`
  - `docs/00_DOC_INDEX.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
  - `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
- What changed:
  - `session-summary.json` now includes a session-level quality block with score, verdict, rationale, recommendations, and noisiest symbols
  - each symbol summary now includes a quality score and verdict such as `high_signal`, `useful`, `mixed`, `noisy`, or `needs_attention`
  - the heuristic layer uses alert-post volume, suppression pressure, failure counts, Discord delivery failures, diagnostics pressure, and snapshot/opportunity activity to classify review quality
  - `thread-summaries.json` now surfaces those verdicts directly for faster end-user usefulness review
  - `session-review.md` now turns the JSON summaries into a fast human-readable run review with verdicts, rationale, noisiest areas, and per-symbol next steps
  - trader-facing alert bodies now describe barrier room as `tight`, `limited`, or `open` instead of only listing the next barrier price
  - alert payload metadata, Discord delivery audit rows, lifecycle events, and long-run thread summaries now carry room/clearance context for faster post-run review
  - long-run sessions now support optional human review feedback through `human-review-feedback.jsonl`
  - each symbol thread now gets a deterministic end-of-session summary in the review artifacts
  - trader-facing alerts and long-run summaries now also classify zone posture as `firm`, `balanced`, or `tired` based on freshness, reaction quality, and follow-through
  - tactical zone posture is now directional in scoring, so tired support is downgraded for support-hold setups while tired resistance can help a bullish breakout case
- Why this matters:
  - long-run artifacts can now answer whether a session or symbol looked broadly useful versus just technically active
  - this creates a bridge between raw deterministic logging and the later AI commentary/review layer
  - tight-room breakouts and dip-buy tests are now easier for the end user to interpret correctly
  - the project now has a real feedback path for labeling live alerts as useful, noisy, late, wrong, or strong
  - structurally strong levels that are tactically fading are now described more honestly to the trader
- Verification completed:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - PowerShell parse check for `scripts/add-long-run-review-feedback.ps1`
  - `npx tsx --test src/tests/alert-intelligence.test.ts`
  - `npx tsx --test src/tests/alert-router.test.ts`
  - `npx tsx --test src/tests/discord-audited-thread-gateway.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npm run check`

---

## 2026-04-22 05:25 PM America/Toronto

### Added alert-family / suppression tracking and per-symbol thread summaries for long-run session review

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated alert payload / audit plumbing in:
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
- Updated manual-runtime lifecycle instrumentation in:
  - `src/lib/monitoring/manual-watchlist-runtime-events.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated operator status surfacing in:
  - `src/runtime/manual-watchlist-page.ts`
- Added and expanded focused coverage in:
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/manual-watchlist-server.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - alert payloads now carry structured metadata such as event type, severity, confidence, score, posting family, and posting-decision reason
  - the audited Discord gateway now records richer alert / snapshot / extension metadata into `discord-delivery-audit.jsonl`
  - the manual runtime now emits `alert_suppressed` lifecycle events when alerts are filtered or intentionally held back by posting policy
  - long-run session summaries now track:
    - alert posts
    - alert suppressions
    - alert families by volume
    - suppression reasons by volume
    - symbol-level posted / suppressed family counts
  - each long-run session now also writes `thread-summaries.json`, a compact per-symbol narrative of runtime state, posted families, suppression reasons, latest alert context, and failure counts
- Why this matters:
  - long-run testing can now answer whether the Discord output was coherent and useful, not just whether it technically posted
  - noisy symbols and repetitive low-value alert patterns are much easier to identify after a real session
- Verification completed:
  - `npx tsx --test src/tests/discord-audited-thread-gateway.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-runtime-manager.test.ts`
  - `npx tsx --test src/tests/manual-watchlist-server.test.ts`
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`
  - `npm run check`

---

## 2026-04-22 04:35 PM America/Toronto

### Added durability-aware support and resistance scoring so defended levels separate more clearly from tired ones

- Updated level-strength ranking and runtime projection in:
  - `src/lib/levels/level-types.ts`
  - `src/lib/levels/level-structural-scoring.ts`
  - `src/lib/levels/level-ranking.ts`
  - `src/lib/levels/level-score-explainer.ts`
  - `src/lib/levels/level-surfaced-selection-explainer.ts`
  - `src/lib/levels/level-runtime-output-adapter.ts`
  - `src/lib/levels/level-ranking-comparison.ts`
- Added focused coverage in:
  - `src/tests/level-strength-ranking.test.ts`
  - `src/tests/level-ranking-comparison.test.ts`
- Updated:
  - `README.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - the structural scorer now derives a durability profile for each ranked level using defense evidence, reaction quality, retest fatigue, break damage, and recency
  - ranked levels now carry a durability label such as `fragile`, `tested`, `durable`, or `reinforced`
  - durability now influences structural score modestly, affects confidence, and shows up in trader-facing explanations
  - surfaced-selection explanations now describe durable versus fragile recent behavior instead of only generic structural strength
  - the runtime compatibility adapter now tempers the downstream `strengthLabel` when a level is structurally strong but durability-fragile, so trader-facing output is less likely to overstate tired levels as `heavy` / `major`
  - comparison output now includes durability metadata alongside state, confidence, and explanation
- Why this matters:
  - the app can now tell the difference between strong defended support / resistance and levels that still look important on paper but are starting to wear out
  - this gives the end user more honest support / resistance language and should reduce false confidence around over-tested zones
- Verification completed:
  - `npx tsx --test src/tests/level-strength-ranking.test.ts`
  - `npx tsx --test src/tests/level-ranking-comparison.test.ts`
  - `npm run check`

---

## 2026-04-22 03:20 PM America/Toronto

### Added barrier-clearance awareness to monitoring and opportunity ranking, compacted opportunity diagnostics, and expanded long-run per-symbol summaries

- Updated monitoring and opportunity layers in:
  - `src/lib/monitoring/monitoring-config.ts`
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/monitoring-event-scoring.ts`
  - `src/lib/monitoring/event-detector.ts`
  - `src/lib/monitoring/opportunity-engine.ts`
  - `src/lib/monitoring/opportunity-diagnostics.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated alert scoring in:
  - `src/lib/alerts/alert-config.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/alert-scorer.ts`
- Updated long-run session review in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Added focused coverage in:
  - `src/tests/opportunity-decision-integrity.test.ts`
  - `src/tests/watchlist-monitor.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- What changed:
  - emitted monitoring events now carry the next meaningful opposing barrier plus a clearance label of `tight`, `limited`, or `open`
  - opportunity ranking now penalizes cramped bullish / bearish setups and gives modest credit to cleaner open-space setups
  - alert intelligence can now use barrier context directly from the event layer, not only by re-deriving it from full level output
  - opportunity diagnostics are now emitted as single-line JSON so long-run tooling can parse them cleanly
  - long-run session summaries now keep a per-symbol rollup for lifecycle counts, delivery activity, diagnostics, failures, compare entries, and opportunity updates
- Why this matters:
  - the system is now better at distinguishing a technically valid setup from a setup that actually has room to work
  - long-run review is now better at answering which symbols were useful, noisy, or fragile over time

---

## 2026-04-22 02:20 PM America/Toronto

### Added a signal-quality roadmap and upgraded trader-facing level language with stronger support/resistance and barrier context

- Added ongoing roadmap tracking in:
  - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- Added trader-facing language helpers in:
  - `src/lib/alerts/trader-message-language.ts`
- Updated trader-facing alert and snapshot output in:
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/alerts/alert-router.ts`
  - `src/lib/alerts/alert-intelligence-engine.ts`
  - `src/lib/alerts/alert-types.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Updated focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/00_DOC_INDEX.md`
- What changed for end-user output:
  - alert messages now use trader-facing strength descriptors such as `light`, `heavy`, and `major` support / resistance instead of only the raw internal score label
  - breakout, breakdown, reclaim, failed-move, and level-touch messages now describe the setup in plainer English and include a clear `watch` / invalidation line
  - strong support touches now surface as dip-buy style tests instead of generic level touches
  - alerts now include nearby barrier context when a next support or resistance level is known
  - level snapshot ladders now expose strength and extension hints instead of only bare prices
- Why this matters:
  - the app is now better at telling the trader not only what happened, but how important the level is and what needs to happen next
  - end-user usefulness is now being tracked explicitly in the repo, not only discussed ad hoc in chat

---

## 2026-04-22 12:55 PM America/Toronto

### Split long-run review into operational and diagnostic surfaces, added a live session summary, and exposed runtime status in the UI

- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Updated the manual UI and runtime entrypoint in:
  - `src/runtime/manual-watchlist-page.ts`
  - `src/runtime/manual-watchlist-server.ts`
- Added and updated focused coverage in:
  - `src/tests/manual-watchlist-server.test.ts`
  - `src/tests/alert-router.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- What changed:
  - long-run sessions now write:
    - `manual-watchlist-operational.log`
    - `manual-watchlist-diagnostics.log`
    - `session-summary.json`
  - `manual-watchlist-filtered.log` now acts as the compatibility review stream while operational review is kept intentionally separate from detector-noise review
  - the session summary is updated live and tracks lifecycle counts, delivery counts, failure counts, compare entries, and diagnostic volume
  - the manual UI now exposes runtime status such as provider path, diagnostics mode, active symbol count, session folder, and the main review artifacts
- Why this matters:
  - long-run operational review is no longer buried under detector chatter
  - the app now helps the operator find the right artifacts instead of relying on memory of file names
  - it is easier to tell whether a problem was operational, downstream-delivery-related, or purely event-logic-related

---

## 2026-04-22 12:20 PM America/Toronto

### Added structured manual-runtime lifecycle logs, local Discord delivery audit, and richer trader-facing alert text

- Added structured lifecycle event support in:
  - `src/lib/monitoring/manual-watchlist-runtime-events.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/runtime/manual-watchlist-server.ts`
- Added a downstream Discord audit wrapper in:
  - `src/lib/alerts/discord-audited-thread-gateway.ts`
  - `src/runtime/manual-watchlist-discord.ts`
- Updated the long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Added focused coverage in:
  - `src/tests/discord-audited-thread-gateway.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- Updated:
  - `README.md`
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- What changed operationally:
  - the runtime now emits structured `manual_watchlist_lifecycle` JSON lines for key milestones such as queue, seed, snapshot post, alert post, activation completion, deactivation, and restore failures
  - each long-run session now writes `discord-delivery-audit.jsonl` inside the session folder so downstream Discord delivery can be reviewed locally after the fact
  - the filtered session log now captures lifecycle and Discord-audit events alongside compare logs, diagnostics, and failures
- What changed for the end user:
  - trader-facing Discord alerts now include severity, confidence, score, and trigger-price context instead of only the structural body line
- Why this matters:
  - long-run testing is now much better at answering not only whether the app stayed alive, but also what it actually did
  - Discord usefulness and noise can now be reviewed from concrete evidence instead of memory or terminal scrollback

---

## 2026-04-22 10:05 AM America/Toronto

### Added a long-run manual testing launcher with timestamped logs and a filtered review stream

- Added a Windows long-run launcher in:
  - `scripts/start-manual-watchlist-long-run.ps1`
- Added long-run workflow documentation in:
  - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- Updated:
  - `README.md`
  - `docs/00_DOC_INDEX.md`
- What this setup now provides:
  - timestamped session directories under `artifacts/long-run/`
  - one full runtime log per session
  - one filtered review log per session
  - lightweight session metadata for later review
  - automatic browser open for the local UI
  - automatic stop of an older manual runtime already using `127.0.0.1:3010`
- Why this matters:
  - multi-hour manual testing no longer depends on terminal scrollback
  - activation and IBKR issues can be reviewed after the fact instead of being lost in noisy live output
  - collaboration is easier because the filtered log is now the main artifact to share when something odd happens

---

## 2026-04-21 10:35 PM America/Toronto

### Verified the compare-mode fix live, refined breakout/reclaim quality, and added filtered runtime diagnostics

- Confirmed the compare-mode normalization fix live after a clean runtime restart:
  - `ASBP` no longer emitted the bad deep-anchor `23.98` value as `alternateTopResistance`
  - the fresh compare log now keeps actionable compare output aligned with trader-facing intent
- Refined event-quality gating in:
  - `src/lib/monitoring/event-detector.ts`
- Added focused coverage in:
  - `src/tests/monitoring-events.test.ts`
  - `src/tests/watchlist-monitor.test.ts`
  - `src/tests/monitoring-event-diagnostic-logger.test.ts`
- Added opt-in runtime diagnostics for monitoring-event decisions in:
  - `src/lib/monitoring/monitoring-event-diagnostic-logger.ts`
  - `src/lib/monitoring/monitoring-types.ts`
  - `src/lib/monitoring/watchlist-monitor.ts`
  - `src/runtime/manual-watchlist-server.ts`
- What changed in event quality:
  - weak fly-by `breakout` / `breakdown` confirmations now stay suppressed unless there was meaningful prior interaction or the move is forceful enough to stand on its own
  - full support `reclaim` now requires a recent observed break attempt instead of any raw jump back above support
  - full reclaims no longer get mislabeled as `fake_breakdown`
- What changed in diagnostics:
  - setting `LEVEL_MONITORING_EVENT_DIAGNOSTICS=1` now enables structured `monitoring_event_diagnostic` JSON lines during `npm run watchlist:manual`
  - emitted decisions always log
  - suppressed decisions only log when they are near the decision boundary, carry meaningful state, change reason, or recur after cooldown
  - far-away idle suppressions are intentionally dropped so the live log stays readable
- Verification completed:
  - `npm run build`
  - `npm test`
  - `npm run check`
- Operational outcome:
  - live diagnostics are now usable for real runtime observation instead of producing a wall of repeated idle suppressions
  - the next practical runtime step is to let diagnostics run until a real breakout / reclaim edge case appears, then tune from that evidence instead of from guesswork

---

## 2026-04-21 08:55 PM America/Toronto

### Compare-mode handoff update after live IBKR runtime testing

- Narrowly refined compare-output normalization in:
  - `src/lib/levels/level-ranking-comparison.ts`
- Added focused regression coverage in:
  - `src/tests/level-ranking-comparison.test.ts`
- Added a dedicated handoff note for the next chat:
  - `docs/28_RUNTIME_HANDOFF_2026-04-21.md`
- What changed:
  - `normalizeSurfacedSelectionOutput(...)` no longer folds deeper anchors into the same comparable surfaced list as actionable levels
  - this means a deep context anchor should no longer appear as the compare-mode `topResistance` / `topSupport` when there is no real actionable level there
  - the runtime compatibility adapter still keeps deeper anchors in `extensionLevels`, so live extension behavior was not intentionally changed
- Why this mattered:
  - live compare testing on low-priced names exposed a bad observational read where `ASBP` could log `alternateTopResistance: 23.98` even though that level was only a deeper anchor and not a practical trader-facing resistance
  - the fix was intentionally narrow so it would clean up compare-mode interpretation without reopening the broader surfaced-selection calibration
- Verification completed:
  - `npm test -- --test src/tests/level-ranking-comparison.test.ts`
  - `npm test -- --test src/tests/level-surfaced-selection.test.ts`
- Important live findings from the same testing session:
  - multi-symbol activation is still operationally slow because IBKR historical seeding remains the bottleneck
  - adaptive diagnostics now show `level_touch` and especially `reclaim` under sustained negative expectancy pressure
  - `compression` is currently the healthiest event family in live testing
  - `breakdown` currently looks acceptable and remains enabled
- Remaining follow-up risk:
  - the user later pasted compare logs that still showed `ASBP -> 23.98`; those logs were likely produced by a process that had not restarted after the normalization change
  - the first check in the next chat should be one fresh post-restart `level_runtime_compare` line for `ASBP`

---

## 2026-04-18 09:30 AM America/Toronto

### Added a compare-mode runtime log review tool for old-vs-new surfaced-output differences

- Added the review aggregation module:
  - `src/lib/levels/level-runtime-compare-review.ts`
- Added the review runner:
  - `src/scripts/run-level-runtime-compare-review.ts`
- Added focused review coverage in:
  - `src/tests/level-runtime-compare-review.test.ts`
- Added review workflow documentation:
  - `docs/27_LEVEL_RUNTIME_COMPARE_REVIEW_PLAN.md`
- What this pass now adds:
  - parsing for compare-mode JSON objects, arrays, and newline-delimited logs
  - malformed compare-entry tracking instead of silent failure
  - aggregate counts for support/resistance changes and ladder-count changes
  - recurring disagreement grouping by symbol and category
  - explicit tracking for broken-level recurrence and approximation-related recurrence
  - a prioritized manual review queue for the most important runtime disagreements
- Why this matters:
  - compare-mode evidence can now be reviewed in batches instead of line by line
  - recurring disagreement patterns are easier to spot before any broader rollout discussion
  - the repo now has an operational review layer for real runtime experimentation, not just offline validation

---

## 2026-04-18 08:55 AM America/Toronto

### Added a safe optional runtime flag for old/new/compare surfaced-output exploration

- Added runtime mode resolution in:
  - `src/lib/levels/level-runtime-mode.ts`
- Added the runtime compatibility projection from the new surfaced adapter back into the legacy bucketed output contract in:
  - `src/lib/levels/level-runtime-output-adapter.ts`
- Added compact compare-mode logging in:
  - `src/lib/levels/level-runtime-comparison-logger.ts`
- Integrated the mode boundary into:
  - `src/lib/levels/level-engine.ts`
  - `src/runtime/main.ts`
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Added focused runtime-mode coverage in:
  - `src/tests/level-runtime-mode.test.ts`
- Added exploration tracking documentation:
  - `docs/26_LEVEL_RUNTIME_FLAG_EXPLORATION_PLAN.md`
- What this pass now enables:
  - `old` remains the default runtime path
  - `new` can be enabled explicitly through a compatibility adapter
  - `compare` can keep one path active while computing the other observationally
  - compare mode emits a compact labeled payload instead of mixing live behavior
- Why this matters:
  - the repo is now ready for controlled real-world experimentation with the new surfaced adapter
  - rollback stays config-only
  - downstream consumers keep receiving the legacy `LevelEngineOutput` shape while the new path is explored safely

---

## 2026-04-18 03:05 AM America/Toronto

### Calibrated the surfaced adapter against the shadow-mode weak spots

- Tightened surfaced-selection tuning in:
  - `src/lib/levels/level-surfaced-selection-config.ts`
  - `src/lib/levels/level-surfaced-selection.ts`
  - `src/lib/levels/level-surfaced-selection-explainer.ts`
- Tightened surfaced-validation scoring in:
  - `src/lib/levels/level-surfaced-validation.ts`
- Updated replayable shadow-case tuning and batch aggregation in:
  - `src/lib/levels/level-surfaced-shadow-evaluation.ts`
- Expanded regression coverage in:
  - `src/tests/level-surfaced-selection.test.ts`
- Added calibration tracking documentation:
  - `docs/25_LEVEL_SURFACED_ADAPTER_CALIBRATION_PLAN.md`
- What was calibrated:
  - stronger default exclusion pressure against broken levels
  - first actionable preference for credible practical-interaction levels
  - weak near-price clutter escape logic
  - tighter same-band ownership and anchor preference
  - surfaced validation now discounts weak or broken close-by levels instead of rewarding proximity alone
- Why this matters:
  - the new surfaced adapter still keeps its structural sanity edge
  - but the trader-facing metrics now give more honest credit to credible near-price levels and less credit to misleading close junk
  - shadow-mode evidence is now materially stronger before any runtime-flag decision

---

## 2026-04-18 02:20 AM America/Toronto

### Added replayable batch shadow evaluation for old surfaced output versus the new surfaced adapter

- Added the batch shadow evaluation module:
  - `src/lib/levels/level-surfaced-shadow-evaluation.ts`
- Added a practical replay runner:
  - `src/scripts/run-level-surfaced-shadow-evaluation.ts`
- Added focused aggregation coverage in:
  - `src/tests/level-surfaced-shadow-evaluation.test.ts`
- Added implementation tracking documentation:
  - `docs/24_LEVEL_SURFACED_SHADOW_EVALUATION_PLAN.md`
- What this phase now adds on top of the earlier surfaced showdown:
  - tagged replayable batch cases
  - overall old/new winner counts across a broader sample
  - category breakdowns by support, resistance, breakout, clutter, anchor, and broken-level cases
  - practical metric win counts for:
    - clutter reduction
    - first interaction alignment
    - actionable near-price usefulness
    - structural sanity
    - anchor usefulness
  - manual review queue generation
  - aggregate migration readiness guidance
- Why this matters:
  - the repo now has a broader shadow-mode evidence layer before any runtime flag discussion
  - the old surfaced path can still be tracked honestly where it remains stronger
  - calibration priorities are easier to spot from grouped results instead of one-off case reads

---

## 2026-04-18 01:35 AM America/Toronto

### Added a surfaced usefulness validation showdown between old runtime output and the new surfaced adapter

- Added the surfaced validation module:
  - `src/lib/levels/level-surfaced-validation.ts`
- Added a practical showdown runner:
  - `src/scripts/run-level-surfaced-validation.ts`
- Added focused coverage in:
  - `src/tests/level-surfaced-validation.test.ts`
- Added implementation tracking documentation:
  - `docs/23_LEVEL_SURFACED_VALIDATION_SHOWDOWN_PLAN.md`
- What this showdown now measures:
  - actionable near-price quality
  - ladder cleanliness
  - forward interaction relevance
  - first interaction alignment
  - structural sanity
  - anchor usefulness
- First deterministic showdown read:
  - total cases: `6`
  - old wins: `1`
  - new wins: `4`
  - mixed: `1`
  - inconclusive: `0`
  - average validation score old: `66.96`
  - average validation score new: `73.58`
  - migration readiness: `ready_for_shadow_mode`
- Why this matters:
  - the repo now has evidence about surfaced trader usefulness instead of only architecture comparisons
  - the new surfaced adapter looks promising enough for shadow-mode evaluation
  - but one remaining old-path win means direct replacement would still be premature

---

## 2026-04-18 12:35 AM America/Toronto

### Added a surfaced selection adapter on top of the new structural ranking layer

- Added the surfaced-selection bridge modules:
  - `src/lib/levels/level-surfaced-selection-config.ts`
  - `src/lib/levels/level-surfaced-selection.ts`
  - `src/lib/levels/level-surfaced-selection-explainer.ts`
- Added focused surfaced-selection coverage in:
  - `src/tests/level-surfaced-selection.test.ts`
- Added a comparison-prep normalization hook in:
  - `src/lib/levels/level-ranking-comparison.ts`
  so the new surfaced adapter output can later be judged against the old surfaced runtime output without changing the live runtime contract.
- Added migration tracking documentation:
  - `docs/22_LEVEL_SURFACED_SELECTION_ADAPTER_PLAN.md`
- What this bridge now does:
  - starts from the new structurally ranked levels
  - enforces minimum structural quality and confidence for surfaced eligibility
  - favors near-price actionable levels over deeper structural levels when the near levels are still credible
  - prevents weak same-band duplicates from cluttering the trader-facing ladder
  - allows one deeper structural anchor for context when it materially helps
- Why this matters:
  - the comparison harness showed the new ranking layer was richer but often deeper than the current surfaced runtime output
  - this adapter is the missing layer that makes the new structural truth more practical for trader-facing use without reverting to the old bucket logic

---

## 2026-04-18 12:10 AM America/Toronto

### Trader-facing runtime paths now consume generated interpretations directly

- Refined the real runtime consumers so they now use `snapshot.interpretations` instead of relying on the controller to print interpretations internally.
- Updated:
  - `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `src/runtime/main.ts`
- `src/lib/monitoring/opportunity-runtime-controller.ts` now stays focused on producing deterministic runtime snapshots and no longer acts as the console sink for trader-facing output.
- Why this matters:
  - the actual trader-facing paths now decide when and where interpretation output is surfaced
  - delivery is consistent with the runtime snapshot contract
  - duplicate suppression still lives in the interpretation layer, but output responsibility now lives in the real consumers
- Added one focused end-to-end manager test proving:
  - a monitoring event enters
  - interpretation output is emitted through the real runtime manager path
  - the exact trader-facing console message appears once
  - an immediate duplicate does not spam a second interpretation message
- Added focused updates in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/opportunity-diagnostics.test.ts`

---

## 2026-04-17 11:59 PM America/Toronto

### Interpretation runtime now uses canonical monitoring event types

- Refined the opportunity interpretation/runtime path so it no longer relies only on alert labels like `consolidation` when deciding interpretation behavior.
- `src/lib/monitoring/opportunity-engine.ts` now carries canonical monitoring `eventType` alongside the user-facing alert `type`.
- `src/lib/monitoring/adaptive-scoring.ts`, `src/lib/monitoring/opportunity-evaluator.ts`, and `src/lib/monitoring/opportunity-interpretation.ts` now prefer canonical `eventType` when:
  - grouping adaptive expectancy state
  - tracking evaluator outcomes
  - choosing interpretation type and zone label
- Why this matters:
  - the interpretation layer should reason from true monitoring events, not only from downstream alert wording
  - this especially fixes the `compression -> consolidation` alias path so deterministic message mapping stays correct in the live runtime
- `src/lib/monitoring/opportunity-runtime-controller.ts` now also returns generated interpretations on the runtime snapshot instead of only printing them to console.
- Added focused coverage in:
  - `src/tests/opportunity-interpretation.test.ts`
  - `src/tests/opportunity-runtime-integration.test.ts`

---

## 2026-04-17 11:55 PM America/Toronto

### Batch validation availability is now split by report type

- Refined `src/lib/validation/level-validation-batch.ts` so batch summaries no longer treat `completed` as the only meaningful availability signal.
- Batch output now distinguishes:
  - `completed`
    - symbols with both persistence and forward reports
  - `persistenceCompleted`
    - symbols with a persistence report
  - `forwardCompleted`
    - symbols with a forward report
- Why this matters:
  - a degraded symbol can still contribute valid persistence evidence even when forward validation is unavailable
  - a symbol can also contribute forward evidence without being forced into a fake all-zero persistence average
  - this keeps batch-level averages honest instead of making partial report availability look like missing or weak results
- Batch summary now prints:
  - `Report availability | persistence=<n> | forward=<n>`
- Added focused coverage in:
  - `src/tests/level-validation-batch.test.ts`

---

## 2026-04-16 09:35 PM America/Toronto

### Summary

- Reworked the validation layer so it is more actionable for support/resistance tuning and less resistance-only / averaged.
- Expanded forward reaction validation to separate:
  - full respect
  - partial respect
  - clean break
  while staying deterministic and compact.
- Added explicit forward usefulness summaries by:
  - support vs resistance
  - surfaced vs extension
  - near vs intermediate vs far distance bands
- Strengthened persistence validation with loose-match diagnostics so high persistence can be distinguished from nearby remapping inside tolerance.
- Kept the pass focused on validation usefulness for structural tuning and did not expand Discord formatting or add any auto-tuning layer.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/lib/validation/level-persistence-validator.ts`
- `src/lib/validation/level-validation-batch.ts`
- `src/tests/forward-reaction-validator.test.ts`
- `src/tests/level-persistence-validator.test.ts`
- `src/tests/level-validation-batch.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Validation output can now tell us whether the real weakness is more likely to be:
  - support vs resistance selection
  - near vs intermediate vs far usefulness
  - surfaced vs extension usefulness
  - real stability vs loose remap-style persistence

---

## 2026-04-16 08:40 PM America/Toronto

### Summary

- Improved the validation workflow so repeated live runs do not have to pull the same candle windows from IBKR every time.
- Added a validation-only candle snapshot cache with modes for:
  - `read_write`
  - `replay`
  - `refresh`
  - `off`
- Wired the candle cache into:
  - live candle-health validation
  - persistence validation
  - forward reaction validation
  - batch validation
- Reduced the default live batch validation window count from `6` to `4` and added an IBKR warning when a live batch is larger than the recommended small-group size.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `src/lib/validation/validation-candle-cache.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/scripts/run-level-candle-health-check.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/scripts/shared/validation-candle-cache.ts`
- `src/tests/validation-candle-cache.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Validation runs can now fetch once and replay the same candle windows on later passes, which should materially reduce IBKR waiting during structural tuning and make before/after comparisons more reproducible.

---

## 2026-04-16 08:10 PM America/Toronto

### Summary

- Used the first live small-cap validation batch evidence to drive the next narrow structural truth pass instead of doing more snapshot/output cleanup.
- Confirmed the engine was already stable and that the next weak spot was usefulness separation: repeatedly recycled intraday levels with weak decision quality could still score too competitively just because they accumulated touches.
- Updated `src/lib/levels/level-scorer.ts` with a bounded recycled-intraday penalty so single-timeframe `5m` levels are discounted when they show:
  - heavy local reuse
  - weak rejection/follow-through
  - shallow displacement / reaction quality
- Added focused regression and scenario coverage proving that a stronger decisive nearby anchor now outranks recycled local resistance while farther meaningful structure still survives.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-validation-scenarios.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The engine now separates “repeatedly existing” intraday resistance from more actionable decision structure more honestly, which should reduce low-usefulness surfaced levels without reopening the broader level engine.

---

## 2026-04-16 07:05 PM America/Toronto

### Summary

- Added the next practical validation step: batch validation across multiple symbols.
- Added a batch summary layer that aggregates:
  - candle-source health
  - resistance persistence/churn
  - forward reaction usefulness
- Added a live batch runner that uses the active provider path, defaults to IBKR, keeps going when one symbol fails, and emits a single summary at the end.
- Kept the implementation focused on validation workflow rather than turning it into a new tuning or dashboard system.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/level-validation-batch.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/tests/level-validation-batch.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo can now validate a small symbol batch in one pass instead of relying only on one-off symbol checks, which makes regressions easier to spot across a wider sample.

---

## 2026-04-16 06:45 PM America/Toronto

### Summary

- Added the next validation layer: forward reaction validation for support/resistance usefulness.
- Added a first forward-reaction validator that evaluates whether surfaced and extension levels are:
  - touched
  - respected
  - broken
  using post-generation `5m` candles
- Added a live runner that uses the active candle provider path, defaults to IBKR, and checks candle-source health before evaluating what price did after generation.
- Kept the validator descriptive instead of turning it into an auto-tuning system.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/tests/forward-reaction-validator.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo can now validate not only level stability across refreshes, but also whether surfaced and extension levels produce useful future reactions after they are generated.

---

## 2026-04-16 06:25 PM America/Toronto

### Summary

- Continued the validation-first hardening phase by adding level persistence and churn validation instead of reopening broad level-engine feature work.
- Added a first persistence validator that compares rolling `LevelEngineOutput` snapshots and reports:
  - surfaced support/resistance persistence
  - extension support/resistance persistence
  - surfaced churn
  - average matched price drift
- Added a live runner that uses the active candle provider path, defaults to IBKR, and checks candle-source health before generating rolling validation windows.
- Tightened the live validation path so `.env` loading also applies to candle-source health checks and persistence runs.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/level-persistence-validator.ts`
- `src/scripts/run-level-candle-health-check.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/tests/level-persistence-validator.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo now has a runnable persistence/churn validation path that uses the same active candle-provider workflow as live testing.
- Provider-health failures can be separated from level-persistence weaknesses before structural tuning starts.

---

## 2026-04-16 05:45 PM America/Toronto

### Summary

- Shifted from broad structural feature building into validation-driven hardening of the support/resistance engine.
- Expanded targeted scenario coverage for held-gap continuation versus quickly filled gaps and used that validation to confirm one real remaining weakness.
- Corrected the weakness by making gap-driven continuation relevance depend more heavily on post-gap hold behavior instead of raw gap presence alone.
- Updated the directive to reflect that the next phase is evidence-driven hardening, not feature churn.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo now has stronger scenario coverage around gap-driven continuation behavior.
- Held gaps and quickly filled gaps are separated more honestly in structural scoring.
- Build and test verification both pass after the validation-driven hardening pass.

---

## 2026-04-16 05:29 PM America/Toronto

### Summary

- Re-evaluated the remaining gap/thin-zone structural blind spots and found one real weakness: the engine recognized that a gap existed, but it still over-credited raw gap presence even when the gap filled quickly and did not remain valid continuation space.
- Added bounded `gapContinuationScore` evidence so gap-driven continuation only receives meaningful structural credit when the post-gap hold behavior supports it.
- Threaded that score through raw candidates, clustered zones, final scoring, and extension usefulness so real open continuation space is rewarded while quickly filled/artificial gaps are not overvalued.
- Kept the change deterministic and narrow instead of reopening broad monitoring or alert work.

### Files updated

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Real held gaps now contribute to continuation relevance more honestly than gaps that fill quickly.
- The engine no longer treats simple gap existence as sufficient evidence of open continuation space.
- Build and test verification both pass after the gap-continuation refinement.

---

## 2026-04-16 05:07 PM America/Toronto

### Summary

- Continued the support/resistance truth pass by improving thin-zone and open-space continuation relevance instead of reopening broad monitoring or alert work.
- Added deterministic path-clearance scoring in the level engine so zones with a cleaner breakout path to the next same-side structure gain credit over cramped zones boxed in by nearby continuation blockers.
- Rebuilt extension selection so the engine can choose the strongest structurally useful frontier level inside the next continuation window instead of always accepting the closest leftover by position alone.
- Kept the change bounded to level truth, surfaced ranking, and extension usefulness.

### Files updated

- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Zones with cleaner breakout continuation space now score more honestly than otherwise similar zones that are immediately cramped by nearby same-side structure.
- Extension ladders can now prefer a stronger frontier level over a trivial closer leftover when that produces a more useful next ladder for small-cap continuation behavior.
- Build and test verification both pass after the path-clearance and frontier-selection refinement.

---

## 2026-04-16 04:43 PM America/Toronto

### Summary

- Continued the level-engine truth pass by explicitly separating breakout-useful follow-through structure from incidental local reaction structure.
- Added deterministic `followThroughScore` evidence on raw candidates and final zones, derived from displacement, recency, session significance, gap structure, rejection quality, and overused local-reaction penalty.
- Rebuilt scoring so follow-through usefulness now materially influences final structural strength instead of being implicitly buried inside other evidence.
- Rebuilt extension selection so nearby next-level candidates compete locally on structural usefulness, which prevents weaker first leftovers from consuming extension ladder space when a stronger nearby follow-through zone exists.

### Files updated

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Stronger continuation-relevant zones now surface and score more honestly than incidental local reactions with weak forward usefulness.
- Extension ladders are more actionable because a stronger nearby continuation level can now beat a weaker first leftover in the same local band.
- Build and test verification both pass after the follow-through usefulness refinement.

---

## 2026-04-16 03:34 PM America/Toronto

### Summary

- Continued the structural truth pass by improving support/resistance output usefulness instead of reopening alert work.
- Added crowding-aware zone scoring so weaker nearby same-side levels are penalized when a stronger structural zone already owns the area.
- Rebuilt surfaced ladder selection to enforce deterministic spacing by timeframe bucket, which reduces overcrowded nearby intraday levels in the final visible ladder.
- Rebuilt extension ladder selection to skip near-duplicate leftovers that do not add meaningful next-level information for small-cap follow-through.

### Files updated

- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Surfaced ladders now prefer stronger distinct structural zones over tightly packed nearby noise.
- Extension ladders are cleaner because near-duplicate next levels are filtered before they reach watchlist posting or monitoring activation.
- Build and test verification both pass after the crowding-aware scoring and spacing-aware ladder-selection refinement.

---

## 2026-04-16 04:12 PM America/Toronto

### Summary

- Continued the level-engine truth pass by strengthening multi-timeframe confluence treatment instead of broadening alert or monitoring work.
- Rebuilt confluence scoring so mixed higher-timeframe structure gets materially more credit than incidental single-timeframe 5m reaction zones with similar raw touches.
- Rebuilt surfaced ladder ownership so a mixed zone now surfaces once in its highest structural bucket instead of competing across multiple buckets.
- Kept the pass deterministic and focused on final ladder usefulness for small-cap support/resistance output.

### Files updated

- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Mixed daily/4h structure now outranks similar incidental 5m-only reaction structure more honestly.
- Surfaced ladders no longer duplicate the same mixed structural area across multiple timeframe buckets.
- Build and test verification both pass after the confluence-weighting and surfaced-bucket ownership refinement.

---

## 2026-04-16 03:08 PM America/Toronto

### Summary

- Returned to the structural truth layer and improved support/resistance output usefulness instead of doing more alert churn.
- Added nearby-crowding discrimination in level scoring so weak/incidental zones lose strength when they sit too close to structurally stronger neighbors.
- Rebuilt surfaced level selection to be spacing-aware per timeframe bucket, so output ladders prefer stronger distinct zones over overcrowded nearby 5m noise.
- Rebuilt extension ladder selection to skip near-duplicate leftovers and preserve a cleaner next-level ladder beyond the surfaced zones.

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Surfaced resistance/support ladders now contain fewer overcrowded nearby levels and reflect stronger structural separation.
- Extension ladders are more useful for small-cap follow-through because they no longer surface near-duplicate next levels just beyond the visible ladder.
- Build and test verification both pass after the crowding-aware scoring and spacing-aware ladder refinement.

## 2026-04-16 02:41 PM America/Toronto

### Summary

- Completed the alert delivery-discipline pass on top of the rebuilt intelligence layer.
- Added explicit posting-policy and dedup semantics so the system now decides whether to post based on structural context, not just score and simple suppression:
  - explicit posting families
  - explicit scope and state keys
  - duplicate-context suppression
  - lower-value-than-recent suppression
  - materially-new-state preservation
- Preserved materially important alerts for:
  - outermost ladder interactions
  - promoted-extension interactions
  - remap/replacement state changes
  - strong fresh structural zones
- Kept routing separation intact:
  - event alerts still route separately from level snapshots and next-level extension posts
  - runtime paths now use the stronger delivery policy consistently through the alert-intelligence engine

### Files added

- `src/lib/alerts/alert-deduplication.ts`
- `src/lib/alerts/posting-policy.ts`

### Files updated

- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/12_ALERT_INTELLIGENCE_BLUEPRINT.md`
- `docs/13_ALERT_SCORING_RULES.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/alerts/alert-types.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Repeated monitoring passes for the same structural situation no longer produce repeated trader-facing alert posts.
- Materially new state transitions such as remap/replacement still survive delivery policy and post correctly.
- Manual watchlist runtime continues to route snapshots, next-ladder posts, and event alerts through separate paths while using the stronger alert delivery rules.

## 2026-04-16 02:03 PM America/Toronto

### Summary

- Completed the next alert-intelligence pass so trader-facing alerts now preserve monitoring truth instead of flattening it into generic zone text.
- Rebuilt alert scoring to explicitly use:
  - zone freshness
  - canonical vs promoted-extension origin
  - remap status
  - ladder position
  - structural zone strength and confluence
  - recent refresh state
  - recent extension-promotion state
  - data-quality degradation
- Tightened alert filtering to suppress weak inner-ladder chatter more honestly while preserving meaningful promoted-extension and outermost-ladder behavior.
- Rebuilt alert formatting into compact deterministic trader-facing output that now surfaces:
  - outermost vs inner vs promoted-extension significance
  - fresh vs aging context
  - remap/recent-refresh state when relevant
  - data-quality degradation when relevant
- Wired the live runtime paths onto the alert-intelligence engine:
  - `manual-watchlist-runtime-manager` now routes scored/formatted alerts instead of generic event payloads
  - `runtime/main.ts` now prints formatted intelligence output instead of raw generic monitoring alerts

### Files updated

- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/12_ALERT_INTELLIGENCE_BLUEPRINT.md`
- `docs/13_ALERT_SCORING_RULES.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-filter.ts`
- `src/lib/alerts/alert-formatter.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/runtime/main.ts`
- `src/scripts/run-alert-intelligence-sample.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The alert layer now preserves the richer monitoring distinctions that were added during the identity/remap/context passes instead of discarding them at posting time.
- Manual Discord routing and runtime console output now both reflect context-aware alert intelligence rather than generic zone text.
- Build and test verification both pass after the alert-threshold, scoring, formatting, and routing upgrade.

## 2026-04-16 01:14 PM America/Toronto

### Summary

- Completed the monitored-zone identity and remap-semantics pass so refreshed level sets no longer drift against prior active monitoring state:
  - active monitored zones now keep explicit identity separate from canonical generated zone ids
  - canonical refresh now distinguishes `new`, `preserved`, `merged`, `split`, and `replaced` remap outcomes
  - promoted extension zones can be replaced by regenerated canonical zones without duplicating the monitored representation
- Threaded richer monitored-zone context into event generation and scoring:
  - every monitoring event now carries explicit event context for canonical id, origin, freshness, remap status, ladder position, recent refresh state, and data-quality degradation
  - monitoring scoring/filtering now uses that context to reduce weak inner-zone noise while preserving meaningful outer-ladder and promoted-extension interactions
- Strengthened refresh reconciliation in the live monitor:
  - interaction history is preserved or remapped deterministically when refreshed levels overlap prior monitored zones
  - recent event memory is remapped onto refreshed monitored identities instead of silently dropping structurally related history
- Updated alert intelligence lookup so downstream alert processing can resolve canonical levels correctly even when monitoring uses explicit monitored-zone ids.

### Files added

- `src/tests/level-store.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/scripts/run-alert-intelligence-sample.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/opportunity-decision-integrity.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

## 2026-04-16 11:46 AM America/Toronto

### Summary

- Deepened the level-engine truth layer instead of only polishing output:
  - richer swing-to-candidate evidence now incorporates wick rejection, respect retests, local gap structure, and recency-aware session weighting
  - clustered zones now carry explicit `rejectionScore` and per-zone `freshness`
  - scoring now rewards rejection quality and freshness while penalizing overcrowded weak single-timeframe clusters
- Extended monitoring so it reconciles against refreshed level outputs and activated extension zones:
  - `LevelStore` now tracks active monitored zones separately from extension inventory
  - posted extension ladders can be activated into the monitored zone set
  - `WatchlistMonitor` now re-syncs zone state when the active level-store version changes, preventing stale interaction state from leaking across level refreshes
- Threaded stronger level context into monitoring scoring by using zone freshness, extension status, and current data-quality flags.

### Files added

- `src/tests/watchlist-monitor.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The support/resistance engine now encodes more real structural evidence before a level reaches downstream monitoring.
- Monitoring can switch cleanly onto refreshed levels and posted extension ladders without continuing to evaluate stale zone state.
- Build and test verification both pass after the deeper Phase 2 truth-layer and monitoring-reconciliation pass.

## 2026-04-16 11:20 AM America/Toronto

### Summary

- Upgraded the support and resistance engine beyond the earlier candle-foundation pass:
  - richer swing evidence
  - raw candidate quality metadata
  - stronger scoring inputs
  - level freshness/origin metadata
  - structured extension ladder output
- Fixed same-kind swing separation so nearby noisy highs or lows cannot bypass displacement/separation filtering just because an opposite-kind swing sits between them.
- Extended the manual watchlist workflow with explicit lifecycle metadata and deterministic outer-ladder handling:
  - watchlist entries now track lifecycle state, level-post timestamps, extension-post timestamps, and refresh-pending state
  - activation and restart flows keep using the same runtime manager and now preserve cleaner lifecycle state
  - outermost resistance and support proximity can now trigger distinct next-level extension posts
- Added a deterministic refresh policy helper for active level sets so the runtime can decide when existing levels need regeneration because they are missing, aging, stale, or from a prior trading session.

### Files added

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-refresh-policy.ts`
- `src/tests/level-engine.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/levels/swing-detector.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/lib/monitoring/watchlist-store.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-state-persistence.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Level outputs now carry materially stronger evidence and can expose extension ladders explicitly instead of only the currently surfaced zones.
- The manual watchlist runtime can now distinguish ordinary level snapshots from next-ladder extension posts and can post the next support/resistance set before price exhausts the visible ladder.
- Build and test verification both pass after the combined Phase 2 and watchlist-lifecycle upgrade.

## 2026-04-15 10:51 PM America/Toronto

### Summary

- Rebuilt the candle data foundation into a provider-aware, validation-aware, session-aware contract instead of the previous thin candle array response shape.
- Replaced IBKR broad duration guessing with deliberate timeframe-aware fetch planning that derives provider request windows from timeframe and requested lookback depth.
- Added structured candle validation, staleness detection, completeness status, session summaries, and diagnostics formatting for runtime and manual review.
- Added an explicit provider factory and a non-IBKR provider path in code (`twelve_data`) while preserving IBKR and stub support.
- Made the level engine reject clearly invalid candle inputs before level generation and rebuilt special intraday levels around classified session windows instead of arbitrary recent bars.

### Files added

- `src/lib/market-data/candle-quality.ts`
- `src/lib/market-data/candle-session-classifier.ts`
- `src/lib/market-data/candle-validation.ts`
- `src/lib/market-data/fetch-planning.ts`
- `src/lib/market-data/provider-factory.ts`
- `src/lib/market-data/provider-priority.ts`
- `src/lib/market-data/provider-types.ts`
- `src/lib/market-data/providers/twelve-data-historical-candle-provider.ts`
- `src/tests/provider-factory.test.ts`

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/market-data/candle-fetch-service.ts`
- `src/lib/market-data/candle-normalizer.ts`
- `src/lib/market-data/candle-types.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/runtime/main.ts`
- `src/scripts/run-manual-level-test.ts`
- `src/tests/candle-fetch-service.test.ts`
- `src/tests/ibkr-historical-candle-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Candle fetches now return provider name, requested lookback, actual bar count, fetch timing, completeness, stale status, validation issues, and session summary metadata.
- Runtime and manual testing paths can now print candle diagnostics before levels are trusted.
- Session-specific intraday level extraction now uses classified premarket and opening-range candles instead of unlabeled recent-bar slices.
- Automated coverage increased to 92 passing tests.

## 2026-04-15 07:44 PM America/Toronto

### Summary

- Extended manual watchlist behavior with deterministic level snapshot posting on activation and live level refresh posting near the highest posted resistance.
- Updated the watchlist and Discord planning docs to reflect the shipped manual watchlist operations layer.
- Added a manual watchlist operations layer for Discord-thread-managed small UI control without changing evaluator, adaptive scoring, adaptive stability, or interpretation logic.
- Extended the existing watchlist state path to persist manual symbols, notes, active status, and stored Discord thread ids across restarts.
- Added deterministic Discord thread reuse, single recovery-by-symbol-name, and create-thread behavior through the alert router layer.
- Added a minimal local manual watchlist page and server that orchestrates activation/deactivation through the shared monitoring/runtime stack instead of calling Discord or IBKR directly from the UI.
- Added per-active-symbol anti-spam snapshot metadata so level refresh reposts do not repeatedly fire at the same boundary.

### Files added

- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/runtime/manual-watchlist-server.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/watchlist-state-persistence.test.ts`

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/08_WATCHLIST_MONITORING_MASTER_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `package.json`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/watchlist-store.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Manual add/reactivate flow now normalizes symbols, preserves a single active record per symbol, reuses stored Discord thread ids when valid, and only creates a new thread when reuse truly fails.
- Deactivation now preserves thread identity while removing the symbol from the active monitoring set and stopping downstream alert routing through the shared runtime path.
- A minimal local manual watchlist page is now available through `npm run watchlist:manual`.
- Every activation now posts a separate deterministic level snapshot message into the symbol thread, including support and resistance levels.
- Active symbols now rebuild and repost level snapshots when live price approaches the highest resistance from the last posted snapshot, with anti-spam protection to avoid repeated reposts at the same boundary.
- Automated coverage increased to 85 passing tests.

## 2026-04-15 03:35 PM America/Toronto

### Summary

- Tightened the opportunity interpretation layer for exact-message determinism and fixed-format safety.
- Removed remaining interpretation wording variability by locking each interpretation type to one approved template.
- Strengthened interpretation and runtime-facing tests around exact strings, deterministic repeats, and supported-type coverage.
- Aligned the interpretation plan document with the accepted deterministic implementation and removed stale encoding noise.

### Files updated

- `docs/OPPORTUNITY-OUTPUT-LAYER-PLAN.md`
- `src/lib/monitoring/opportunity-interpretation.ts`
- `src/tests/opportunity-interpretation.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Interpretation now uses a single deterministic message template per type with stable ASCII punctuation.
- Level formatting remains deterministic for identical numeric inputs.
- Tests now verify exact message text, exact console formatting, byte-identical repeat output, and approved-path coverage for all supported interpretation types.
- Automated coverage increased to 76 passing tests.

## 2026-04-15 03:10 PM America/Toronto

### Summary

- Added the opportunity interpretation/output layer as a presentation-only runtime boundary.
- Kept the layer isolated from evaluator, scoring, stability, persistence, and diagnostics behavior.
- Added interpretation tests covering progression, weakening, duplicate suppression, and console formatting.

### Files added

- `src/lib/monitoring/opportunity-interpretation.ts`
- `src/tests/opportunity-interpretation.test.ts`

### Files updated

- `src/lib/monitoring/opportunity-runtime-controller.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Runtime now emits trader-readable context messages after adaptive scoring without affecting any core decision layer.
- Interpretation output follows the staged progression model and suppression rules for local console testing.
- Automated coverage increased to 71 passing tests.

## 2026-04-15 01:45 PM America/Toronto

### Summary

- Wired the opportunity decision stack into the runtime through a dedicated controller layer.
- Kept the staged adaptive boundary intact so runtime now consumes stabilized applied state instead of raw target multipliers.
- Added dedicated evaluator, adaptive scoring, adaptive stability, and runtime integration tests.
- Updated the adaptive stability phase plan to reflect completed implementation progress and current remaining runtime follow-up.

### Files added

- `src/lib/monitoring/adaptive-stability.ts`
- `src/lib/monitoring/opportunity-diagnostics.ts`
- `src/lib/monitoring/opportunity-runtime-controller.ts`
- `src/scripts/run-opportunity-validation-sample.ts`
- `src/scripts/run-live-opportunity-validation.ts`
- `src/scripts/scan-opportunity-recovery-windows.ts`
- `src/scripts/summarize-opportunity-validations.ts`
- `src/tests/opportunity-evaluator.test.ts`
- `src/tests/adaptive-scoring.test.ts`
- `src/tests/adaptive-stability.test.ts`
- `src/tests/opportunity-diagnostics.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`

### Files updated

- `package.json`
- `src/lib/monitoring/adaptive-scoring.ts`
- `src/lib/monitoring/opportunity-engine.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/runtime/main.ts`
- `docs/adaptive-stability-layer-v1-plan.md`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Runtime now has one explicit integration point for:
  - recent opportunity buffering
  - stabilized adaptive rescoring
  - evaluator tracking
  - evaluation completion updates
- Live flow no longer needs to bypass the adaptive stability layer to get adaptive ranking behavior.
- Runtime snapshots now include structured adaptive diagnostics for:
  - target vs applied global multiplier
  - target vs applied event-type multiplier
  - confidence used
  - weak streak
  - disable state
  - drift dampening state
- Added a replay validation runner that can emit and optionally save structured diagnostics for longer-session review.
- Added an aggregation script for combining multiple replay validation `.ndjson` files into one cross-run report.
- Multi-symbol replay validation now shows:
  - `NVDA` exercised weak-streak growth and disable intent without actually disabling
  - `TSLA` exercised drift dampening activation
  - no replay run triggered an actual disable yet
- Small-cap replay validation now shows much stronger adaptive stress behavior:
  - `BIRD` and `ALBT` triggered `disableIntent`
  - `ALBT` reached `maxWeakStreak = 11`
  - `ALBT` also exercised heavy drift activation
  - target/applied gaps widened materially versus the large-cap batch
  - no initial small-cap replay run triggered a hard disable yet
- Focused longer-window replay validation on `BIRD` and `ALBT` now shows:
  - `BIRD` finally triggered an actual hard disable on `level_touch`
  - the disable happened after a three-step weak streak with `disableReason = negative_expectancy`
  - `BIRD` still avoided abrupt multiplier collapse, with the disabled event type ending near `0.9892`
  - `ALBT` remained in a stressed but protected state with `disableIntent`, heavy drift activation, and no hard disable in the longer replay
- Added a replay-window recovery scanner for recent real `5m` candle history.
- Recovery-focused replay scanning now shows:
  - `ALBT` has multiple windows with weak-phase recovery in `level_touch` and `reclaim`
  - `BIRD` has multiple windows with weak-phase recovery in `level_touch` and `reclaim`
  - these windows do not show snap-back behavior or abrupt multiplier jumps
- Added a fixed-duration live validation runner that captures runtime diagnostics to file for real-session confirmation.
- Initial live small-cap validation (`BIRD`, `HUBC`, `IMMP`, `ALBT`) shows:
  - adaptive diagnostics were produced for `ALBT`
  - live `opportunity_snapshot` and `evaluation_update` sequencing stayed consistent
  - `maxTargetAppliedGap = 0.0326`
  - no eager weak-streak, disable-intent, drift, or hard-disable behavior appeared in this mild live session
- Automated coverage increased to 64 passing tests.

## 2026-04-15 12:55 PM America/Toronto

### Summary

- Added reconnect-state management to the shared IBKR runtime helper.
- Added runtime reconnect and disconnect callback registration.
- Integrated reconnect-aware market-data resubscription into the IBKR live price provider.
- Added tests covering `1101` re-request behavior and `1102` no-duplicate behavior.

### Files updated

- `src/scripts/shared/ibkr-runtime.ts`
- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Shared runtime now tracks:
  `isConnected` and `reconnecting`
- Shared runtime now emits callback-based reconnect/disconnect notifications.
- Live provider now re-requests market data after `1101` and avoids duplicate requests after `1102`.
- Automated coverage increased to 16 passing tests.

## 2026-04-15 12:35 PM America/Toronto

### Summary

- Centralized repeated IBKR script configuration into a shared runtime helper.
- Added restart-safety test coverage for the live provider.
- Kept the manual historical fetch path working after the script refactor.

### Files added

- `src/scripts/shared/ibkr-runtime.ts`

### Files updated

- `src/scripts/run-manual-level-test.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run manual:test -- AAPL`

### Observed outcome

- The script entrypoints no longer duplicate the default IBKR host/port/clientId setup.
- Live provider lifecycle coverage now includes stop/start reset behavior.
- Automated coverage increased to 14 passing tests.

## 2026-04-15 12:20 PM America/Toronto

### Summary

- Unified IBKR client ownership in the live alerts sample so historical seeding and live monitoring can share one `IBApi` connection.
- Updated the live provider to support injected `IBApi` clients in addition to self-owned host/port/clientId construction.
- Added tests covering injected-client behavior for the live provider.

### Files updated

- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run watchlist:alerts:test -- AAPL` (validated live output before timeout cutoff)

### Observed outcome

- The live provider now works in both modes:
  self-managed connection and injected shared client.
- The integrated live alerts sample emitted trader-facing output while using the shared client path.
- Test coverage increased to 13 passing tests.

## 2026-04-15 12:05 PM America/Toronto

### Summary

- Added mocked tests for both IBKR providers.
- Reduced monitoring noise further by making resistance rejection detection episodic in tests and logic.
- Kept the replay monitoring sample compact and validated after the detector change.

### Files added

- `src/tests/ibkr-historical-candle-provider.test.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Files updated

- `src/lib/monitoring/event-detector.ts`
- `src/tests/monitoring-events.test.ts`

### Verification completed

- `npm test`
- `npm run watchlist:test -- AAPL`

### Observed outcome

- Automated coverage increased from 6 tests to 12 tests.
- IBKR historical provider behavior is now covered for:
  request mapping, response mapping, empty response handling, and request-scoped error handling.
- IBKR live provider behavior is now covered for:
  subscription setup, normalized updates, ignored invalid ticks, and cleanup.
- Replay monitoring sample for `AAPL` now reports only 4 emitted events in the current run.

## 2026-04-15 11:40 AM America/Toronto

### Summary

- Added an ongoing change-log document and linked it from the docs index.
- Initialized the project as a local Git repository on branch `main`.
- Added a repository `README.md`.
- Added `.gitattributes` for cleaner Git line-ending behavior.
- Created a short GitHub setup doc covering the remaining remote-push steps.
- Created the initial repository commit.

### Files added

- `README.md`
- `.gitattributes`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/16_GITHUB_REPO_SETUP.md`

### Files updated

- `.gitignore`
- `docs/00_DOC_INDEX.md`

### Git state

- Local repository initialized with `git init -b main`
- Initial commit created:
  `Initial project import and IBKR integration progress`

### Remaining GitHub step

- Create a remote repository on GitHub and push `main`
- See `docs/16_GITHUB_REPO_SETUP.md`

## 2026-04-15 11:25 AM America/Toronto

### Summary

- Added a lightweight automated test suite and test script.
- Reduced monitoring noise by making compression alerts episodic instead of per-tick.
- Centralized script-level IBKR connection waiting logic.
- Hardened the real IBKR live price provider lifecycle.
- Fixed missing alert intelligence types and IBKR historical provider typing issues.
- Converted key runtime flows to real IBKR-backed historical data and validated them.

### Files added

- `src/tests/candle-fetch-service.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/scripts/shared/ibkr-connection.ts`

### Files updated

- `package.json`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/scripts/run-manual-level-test.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run alert:test`
- `npm run manual:test -- AAPL`
- `npm run watchlist:test -- AAPL`
- `npm run watchlist:alerts:test -- AAPL`

### Observed outcome

- The project compiles cleanly.
- The new automated tests pass.
- Historical fetch, replay monitoring, and live watchlist alert flows all ran successfully in this environment.
- Replay monitoring noise improved materially:
  `AAPL` replay sample dropped from `189` emitted events to `39`, with compression events dropping from `152` to `3`.

### Remaining follow-up ideas

- Reduce rejection-event noise further.
- Add mocked tests around the IBKR historical and live providers.
- Unify ownership of `IBApi` clients across scripts and runtime flows.

## 2026-04-15 11:20 AM America/Toronto

### Symbol memory and context layer

- Added `src/lib/monitoring/symbol-state.ts` to track per-symbol recent event memory, derived bias, and pressure score.
- Extended monitoring events with `bias` and `pressureScore` so downstream alerting receives symbol context with every emitted signal.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to incorporate recent behavior into signal scoring:
  repeated tests increase breakout odds, failed breakouts strengthen rejection context, and conflicting bias penalizes signals.
- Wired `src/lib/monitoring/event-detector.ts` and `src/lib/monitoring/watchlist-monitor.ts` into the new symbol-state flow so emitted events update memory instead of staying stateless.
- Patched alert fixtures in `src/tests/alert-intelligence.test.ts` and `src/scripts/run-alert-intelligence-sample.ts` to match the richer event shape.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The event pipeline now preserves short-term symbol context without breaking the existing monitor or alert engine interfaces.
- Build and test verification both pass after the symbol-memory upgrade.

## 2026-04-15 11:55 AM America/Toronto

### Time-decay weighting for symbol memory

- Updated `src/lib/monitoring/symbol-state.ts` to decay symbol memory over time instead of treating all recent events equally.
- Recent events now carry an internal `memoryWeight` based on exponential decay, with deterministic pruning of stale events older than the configured memory window.
- Bias and pressure calculations now use weighted event memory, so newer interactions influence context more than older ones.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to score signals against decayed symbol context using the event timestamp as the reference point.
- Added `src/tests/symbol-state.test.ts` to verify stale-event pruning and recency-weighted bias behavior.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Symbol-level context is now more responsive to fresh behavior while still retaining short-lived memory of recent tests and failures.
- Build and test verification both pass after the decay-weighting update.

## 2026-04-15 12:20 PM America/Toronto

### Pressure structure detection layer

- Extended `src/lib/monitoring/symbol-state.ts` with deterministic structure detection built on top of weighted symbol memory.
- Symbol context now identifies:
  - `compression`
  - `breakout_setup`
  - `rejection_setup`
- Structure detection uses explicit thresholds based on weighted repeated tests, accelerating test intervals, recent bias, and failed breakout memory.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` so breakout-oriented events are boosted during `breakout_setup` and rejection-oriented events are boosted during `rejection_setup`.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The scoring layer now responds to higher-order setup patterns instead of only raw event counts.
- Build and test verification both pass after the structure-layer upgrade.

## 2026-04-15 12:40 PM America/Toronto

### Range compression and structure resolution

- Refined `src/lib/monitoring/symbol-state.ts` so compression structure now combines:
  - repeated tests
  - tightening test intervals
  - shrinking trigger-price range
- Added `rangeCompressionScore` to symbol context and incorporated it into compression and breakout-setup detection.
- Switched structure strength to non-linear scaling using `1 - exp(-pressureScore + bonus)` style behavior for smoother saturation under high pressure.
- Added structure resolution behavior: when a zone resolves with breakout, breakdown, rejection, or reclaim, compression-related memory for that zone is cleared so stale setup pressure does not linger.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to amplify rejection-oriented signals when high pressure and failed-breakout memory stack together.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Compression setups now require both repeated interaction and visibly tightening structure.
- Resolved zones reset their local setup memory, which keeps future scoring cleaner and less sticky.
## 2026-04-16 11:40 AM America/Toronto

### Trader-facing Discord snapshot zone compression

- Updated Discord level snapshot output to render compact display zones instead of only dense nearby discrete prices.
- Snapshot payloads now carry price-relative `supportZones` and `resistanceZones`, where each displayed zone includes:
  - `representativePrice`
  - optional `lowPrice`
  - optional `highPrice`
- Final display zones are formed after the existing price-relative filtering, duplicate removal, and near-level compaction pass.
- Nearby displayed levels are now merged into deterministic trader-facing zones using a bounded display-layer tolerance.
- Representative selection within a displayed zone uses existing metadata in deterministic order:
  - `strengthScore`
  - `confluenceCount`
  - `sourceEvidenceCount`
  - timeframe bias
  - freshness
  - then actionable distance to current price
- Snapshot formatting now shows:
  - representative price always
  - range only when it adds real meaning
  - nearest support zones first going downward
  - nearest resistance zones first going upward

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live Discord snapshots are now materially more readable and trader-usable because tightly packed neighboring prices are presented as compact zones instead of dense numeric staircases.

## 2026-04-16 11:10 AM America/Toronto

### Price-anchored Discord level snapshots

- Updated manual watchlist snapshot posting so trader-facing support and resistance are now partitioned relative to the snapshot reference price instead of the original structural support/resistance origin buckets.
- Added `referencePrice` to level output metadata, sourced from the freshest available runtime candle path with preference order:
  - `5m` last close
  - `4h` last close
  - `daily` last close
- Updated snapshot formatting to include the current reference price explicitly in the Discord level snapshot message.
- Added deterministic near-price tolerance handling so levels extremely close to the snapshot price are excluded from both displayed support and displayed resistance instead of being misclassified by tiny drift.
- Added targeted tests covering:
  - snapshot price inclusion
  - price-relative support/resistance partitioning
  - deterministic near-price tolerance behavior

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live level snapshots now read like trader-facing ladders anchored to the actual snapshot price, which avoids showing "resistance" below market or "support" above market.

## 2026-04-16 10:20 AM America/Toronto

### Real Discord manual activation path

- Added `src/lib/alerts/discord-rest-thread-gateway.ts` to support real Discord thread reuse, recovery, creation, and message posting through the existing alert-router boundary.
- Updated `src/runtime/manual-watchlist-server.ts` so the manual watchlist activation flow now uses the real Discord REST gateway when `DISCORD_BOT_TOKEN` and `DISCORD_WATCHLIST_CHANNEL_ID` are configured, while preserving the existing local gateway fallback for manual/local testing.
- Added `src/tests/discord-rest-thread-gateway.test.ts` to verify:
  - thread creation under the configured watchlist channel
  - exact-name recovery
  - deterministic level snapshot posting into the target thread
- Added `.env` loading for the manual runtime via `dotenv/config`, plus startup diagnostics that show whether Discord env values are present or missing and whether the runtime is using the real Discord gateway or local fallback.
- Added `.env.example` with the Discord/manual runtime variables needed for the first live watchlist test.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The existing manual activation workflow is now wired to a real Discord posting path without changing the watchlist/runtime architecture.
- Ticker entry can now drive real thread creation/reuse and initial level posting when Discord credentials are present.

## 2026-04-16 11:05 AM America/Toronto

### Discord snapshot ladder coverage and zone display hardening

- Updated the manual watchlist snapshot display path in `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so resistance snapshots now honor the product's forward planning window and can surface meaningful resistance zones out to 50 percent above the snapshot price when valid levels exist.
- Kept support and resistance display price-relative while preserving the existing duplicate removal, near-level compaction, representative selection, and deterministic ordering behavior.
- Added a minimum meaningful zone-width rule so very narrow grouped zones now collapse to a single representative level instead of rendering as visually noisy low-to-high ranges.
- Updated `src/tests/manual-watchlist-runtime-manager.test.ts` to cover:
  - forward resistance ladder coverage through the 50 percent planning range
  - narrow grouped zone collapse to a single level
  - preservation of wider grouped zone range formatting
  - deterministic compact snapshot behavior

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live Discord level snapshots now carry farther forward-looking resistance coverage without reverting to dense micro-level output, and narrow reaction clusters no longer present fake-looking trader-facing zones.

## 2026-04-16 11:40 AM America/Toronto

### Resistance snapshot selection validation hardening

- Validated the live resistance snapshot path against a real chart-review concern where a meaningful isolated intermediate wick-high could be skipped inside the forward ladder window.
- Confirmed the weakness was in the final capped trader-facing resistance selection, not a broad failure of raw level generation.
- Updated `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so capped resistance snapshot zones now preserve:
  - nearest resistance context
  - farthest forward-planning context
  - the strongest representative inside each middle coverage segment
- This keeps the Discord ladder compact while allowing a structurally meaningful intermediate wick-high zone to survive final display selection when it is genuinely stronger than nearby leftovers.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Trader-facing resistance snapshots remain compact, but they are less likely to skip a useful intermediate wick-high level inside the forward planning range.

## 2026-04-16 12:20 PM America/Toronto

### Structural truth audit: resistance extension ladder

- Audited the candle-data-to-level pipeline across:
  - swing detection
  - raw candidate generation
  - candidate evidence quality
  - clustering
  - scoring
  - surfaced selection
  - extension ladder generation
- Confirmed isolated meaningful wick highs are still detected as raw resistance candidates from candle data.
- Identified the first materially weak stage as extension ladder generation: nearby micro-structure could consume forward extension slots and crowd out a stronger isolated higher-timeframe wick-high farther ahead.
- Updated `src/lib/levels/level-extension-engine.ts` with a bounded pruning step that removes a weaker nearby forward candidate when a materially stronger forward structural candidate exists in the same local band.
- This keeps the ladder compact while making forward resistance planning less dependent on stair-step local leftovers.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The structural pipeline now preserves meaningful isolated forward wick-high resistance more reliably without reopening the broader level engine or reverting to cluttered ladders.

## 2026-04-16 12:45 PM America/Toronto

### Forward resistance ladder continuity refinement

- Refined `src/lib/levels/level-extension-engine.ts` so forward resistance extension selection now preserves:
  - near resistance context
  - at least one meaningful intermediate structural step when available
  - far-forward planning reach
- Kept the 50 percent forward-range behavior intact while preventing the far-forward slot from effectively wiping out all intermediate ladder continuity.
- Added/updated tests in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- New coverage confirms:
  - raw isolated wick-high resistance is still detected
  - nearby micro-structure does not crowd out a stronger forward wick-high
  - compact runtime snapshots preserve near, intermediate, and far resistance continuity without regressing into clutter

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Forward resistance ladders now remain compact while carrying a more usable stepwise path for traders instead of jumping too directly from nearby levels to the far bound.

## 2026-04-16 04:40 PM America/Toronto

### Cluster representative truth and temporary discrete snapshot output

- Refined `src/lib/levels/level-clusterer.ts` so clustered zones now keep a trader-meaningful representative price instead of averaging nearby candidates into a midpoint.
- Representative selection now prefers stronger existing candle evidence:
  - higher timeframe
  - stronger rejection
  - stronger follow-through
  - stronger reaction quality / displacement / touch evidence
- This preserves real wick-led prices inside merged zones more honestly, especially for nearby resistance and support areas that should remain anchored to an actual chart price.
- Updated `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so live snapshots temporarily output discrete representative levels only and no longer collapse nearby levels into bracketed display ranges.
- Updated snapshot formatting tests in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-rest-thread-gateway.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The structural pipeline now preserves actual wick/decision prices more faithfully, and live Discord snapshots show discrete levels directly while structural tuning continues.

## 2026-04-16 05:15 PM America/Toronto

### Surfaced ladder same-band dominance refinement

- Refined `src/lib/levels/level-ranker.ts` so surfaced selection is less likely to preserve every nearby resistance/support step inside the same local band when one nearby level is already materially stronger.
- This change does not add a new scoring system. It strengthens the existing surfaced-selection dominance rule by:
  - using a slightly wider same-band radius suitable for volatile small-cap names
  - still requiring the nearby incumbent level to be materially stronger before suppressing a challenger
- Added focused regression coverage in `src/tests/level-engine.test.ts` to confirm:
  - weaker nearby band clutter is reduced
  - stronger near-anchor levels still survive
  - farther meaningful structure still survives

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Dense nearby resistance bands are now less likely to surface as a staircase of equally important-looking levels when one nearby anchor level is clearly stronger.

## 2026-04-16 05:45 PM America/Toronto

### Level validation system plan added

- Added `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`.
- This plan formalizes the next high-value build direction:
  - synthetic scenario validation
  - level persistence and churn validation
  - forward reaction validation
- The goal is to give future support/resistance tuning a stronger evidence base than ad hoc live chart review alone.

## 2026-04-16 06:05 PM America/Toronto

### Validation workflow kickoff and live candle-source health checks

- Added `src/tests/level-validation-scenarios.test.ts` as the first dedicated scenario-validation file for the support/resistance engine.
- Added `src/tests/helpers/level-validation-fixtures.ts` to keep structural scenario setup reusable and deterministic.
- Added `src/lib/validation/candle-source-health.ts` to classify live candle-provider behavior as:
  - `healthy`
  - `degraded`
  - `unavailable`
- Added `src/tests/candle-source-health.test.ts` to verify:
  - healthy provider responses
  - empty provider responses
  - thrown provider failures
- Added `src/scripts/run-level-candle-health-check.ts` and package script:
  - `npm run validation:levels:live -- <SYMBOL>`
- The live validator uses the active provider path and is intended to run against IBKR now, while still supporting future provider switching through environment/config.
- Updated `src/runtime/manual-watchlist-server.ts` to log the active candle provider path at startup so live validation can distinguish provider-path issues from level-logic issues.
- Added reminder notes in:
  - `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
  - `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
  so future tuning stays validation-first.

## 2026-04-16 08:35 PM America/Toronto

### Evidence-led extension selection refinement

- Used the improved validation stack in small live IBKR passes on `GXAI` and `PBM` instead of making another guess-driven structural change.
- Confirmed:
  - persistence is still honest and strong
  - `near` usefulness can work
  - `intermediate` / `far` usefulness remains weaker
  - extension usefulness remains the weakest consistent area
- Narrowly refined `src/lib/levels/level-extension-engine.ts` so forward resistance selection now:
  - rewards decision quality more explicitly
  - penalizes weak `5m` continuation leftovers more directly
  - preserves an actionable near continuation step instead of pruning it too early
- Added focused tests proving:
  - a decisive forward resistance can outrank a weak intraday leftover
  - near / intermediate / far continuity still survives when the near step is genuinely actionable

## 2026-04-17 09:40 AM America/Toronto

### Practical forward-bound extension refinement

- Used live IBKR validation and live snapshot inspection on small-cap symbols including:
  - `GXAI`
  - `PMNT`
  - `PBM`
  - `RMSG`
  - `FJET`
- Confirmed the next real weakness was not churn:
  - persistence remained strong
  - loose remapping stayed near zero
  - far / extension usefulness remained the weak area
- Found the narrower structural issue:
  - very far surfaced resistance could push the extension frontier too far forward
  - resistance extension selection could still choose the absolute farthest candidate instead of the practical forward frontier
- Refined `src/lib/levels/level-extension-engine.ts` so resistance extensions now:
  - use the practical surfaced frontier relative to live `referencePrice`
  - cap resistance extension candidates to the trader-facing forward planning range when `referencePrice` is available
  - preserve actionable near / intermediate continuity while avoiding unusably far extension jumps
- Passed the practical live spot check:
  - `GXAI` extension resistance moved into `1.74 / 1.82 / 1.97`
  - `PMNT` extension resistance moved into `0.4945 / 0.5200 / 0.5600`

## 2026-04-17 10:05 AM America/Toronto

### Surfaced resistance capped to practical forward range

- Ran a live market-hours evidence pass on:
  - `GXAI`
  - `PMNT`
- Confirmed the post-extension-refinement pattern:
  - surfaced usefulness remained positive
  - extension usefulness still lagged
  - the next narrow weakness was the surfaced/extension boundary, not general stability
- Found that surfaced resistance could still include levels beyond the trader-facing `50%` forward planning range before extension selection even began.
- Refined `src/lib/levels/level-ranker.ts` so surfaced resistance selection now:
  - uses the live `referencePrice` when available
  - excludes surfaced resistance zones beyond the practical forward planning range
  - leaves support behavior unchanged
- Added a focused test in `src/tests/level-ranker.test.ts` proving resistance beyond the practical forward range does not surface when `referencePrice` is known.
- Live snapshot improvement after the ranker change:
  - `GXAI` no longer surfaced `2.65`; snapshot tightened to `1.36 / 1.40 / 1.53 / 1.64 / 1.67 / 1.85`
  - `PMNT` no longer surfaced `0.80`; snapshot tightened to `0.3823 / 0.4699 / 0.5200`

## 2026-04-17 10:10 AM America/Toronto

### Forward validation now ignores non-actionable wrong-side levels

- During the next live market-hours evidence pass on:
  - `PBM`
  - `RMSG`
- Found that the forward reaction validator was still grading raw surfaced zones even when:
  - a `support` was already above the live reference price
  - or a `resistance` was already below the live reference price
- That meant the validation layer could understate real support/resistance usefulness compared with the trader-facing snapshot, which already filters levels relative to the current price.
- Refined `src/lib/validation/forward-reaction-validator.ts` so forward validation now evaluates only actionable levels:
  - supports below the live reference price
  - resistances above the live reference price
- Added focused coverage in `src/tests/forward-reaction-validator.test.ts`.
- Live effect after the validation fix, without touching the level engine:
  - `PBM/RMSG` combined surfaced resistance usefulness improved from `0.0500` to `0.1250`
  - combined `far` usefulness improved from `0.0000` to `0.0384`
- This clarified that part of the earlier weak resistance / far reading was a validation mismatch, not only a structural chart-reading failure.

## 2026-04-17 10:35 AM America/Toronto

### Surfaced bucket ownership now respects the live side of price

- After correcting the forward validator, used a fresh live market-hours pass on:
  - `GXAI`
  - `PMNT`
- Found the next structural weakness more clearly:
  - raw surfaced support / resistance buckets could still retain zones on the wrong side of the live reference price
  - those wrong-side surfaced zones were being filtered out later by the snapshot path, but they could still distort surfaced ownership and extension handoff inside the engine
- Refined `src/lib/levels/level-ranker.ts` so surfaced bucket selection now only keeps actionable zones when `referencePrice` is available:
  - supports below live price
  - resistances above live price and within the practical forward planning range
- Added focused coverage in `src/tests/level-ranker.test.ts`.
- Live post-fix evidence:
  - raw surfaced resistance no longer kept obvious below-price leftovers on `GXAI` / `PMNT`
  - `PMNT` regained a real extension resistance ladder: `0.5600 / 0.5800 / 0.5877`
  - `GXAI/PMNT` batch rerun improved combined surfaced resistance usefulness to `0.3333`
  - combined `far` usefulness improved to `0.0667`
- Fresh trader-facing snapshots after the fix:
  - `GXAI` -> `1.36 / 1.40 / 1.53 / 1.64 / 1.67 / 1.85 / 1.97`
  - `PMNT` -> `0.4183 / 0.4500 / 0.4699 / 0.5100 / 0.5200 / 0.5600 / 0.5877`

## 2026-04-17 11:30 AM America/Toronto

### Timeframe role-split plan added

- Added `docs/19_TIMEFRAME_ROLE_SPLIT_PLAN.md`.
- Captured the current design recommendation from live small-cap work:
  - `daily` should remain the major structural backbone
  - `4h` should remain the intermediate structural layer
  - `15m` is the best candidate for future intraday structural context
  - `5m` should be treated more like micro-context than a major support/resistance authority
- Also documented the related higher-timeframe lookback problem:
  - some small-cap runners likely need deeper `daily` / `4h` history to expose real overhead resistance
- This is a design-direction document, not a rushed timeframe implementation.

## 2026-04-17 12:05 PM America/Toronto

### Structural reads now tolerate missing `5m`

- Implemented the first concrete step from the timeframe role-split plan:
  - weak or missing `5m` should not make the whole symbol unreadable when `daily` and `4h` are still usable
- Refined `src/lib/levels/level-engine.ts` so:
  - `daily` and `4h` remain mandatory structural inputs
  - `5m` is now optional for structural generation
  - when `5m` is unavailable, the engine falls back to higher-timeframe structure instead of failing the full symbol
  - `referencePrice` falls back from `5m` to `4h` to `daily`
  - output metadata now records `5m:unavailable`
- Refined `src/lib/validation/level-validation-batch.ts` and `src/scripts/run-level-validation-batch.ts` so:
  - a symbol is only fully `unavailable` when `daily` or `4h` are unavailable
  - `5m`-only failures are treated as `degraded`
  - batch validation can still produce persistence and partial structural evidence when forward `5m` validation is unavailable
- Added focused coverage in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/level-validation-batch.test.ts`
- Live effect on a weak-intraday name:
  - `FAMI` no longer collapses into an unusable symbol just because `5m` is poor
  - validation can still surface a higher-timeframe structural read and show that the real weak area is extension usefulness, not total unreadability

## 2026-04-17 01:10 PM America/Toronto

### Validation lookbacks are now configurable for deeper overhead testing

- Added `src/lib/validation/validation-lookback-config.ts` and wired it into:
  - `src/scripts/run-level-candle-health-check.ts`
  - `src/scripts/run-level-persistence-validation.ts`
  - `src/scripts/run-forward-reaction-validation.ts`
  - `src/scripts/run-level-validation-batch.ts`
- Validation runners now accept per-timeframe env overrides:
  - `LEVEL_VALIDATION_LOOKBACK_DAILY`
  - `LEVEL_VALIDATION_LOOKBACK_4H`
  - `LEVEL_VALIDATION_LOOKBACK_5M`
- This does not change the live level engine defaults yet.
- Purpose:
  - let validation test whether weak far / extension usefulness is partly caused by shallow higher-timeframe history
  - especially for small-cap runners with important older overhead spike zones
- Also aligned validation prechecks with the new structural-read rule:
  - `daily` and `4h` remain structurally required
  - `5m`-only unavailability degrades validation but does not automatically abort structurally useful runs
- Added focused coverage in `src/tests/validation-lookback-config.test.ts`.

## 2026-04-17 02:05 PM America/Toronto

### Forward validation now separates reachability from reaction quality

- Refined `src/lib/validation/forward-reaction-validator.ts` and `src/lib/validation/level-validation-batch.ts`.
- Forward summaries now include:
  - `touch` / reachability
  - `usefulWhenTouched`
- This keeps the original usefulness metrics but makes them more interpretable for deeper higher-timeframe overhead levels.
- Why this matters:
  - far or extension resistance can look weak under a short forward window simply because price never got there
  - `usefulWhenTouched` now tells us whether a level was weak once reached, instead of collapsing "not reached" and "reached but poor" into the same read
- Batch output now prints:
  - surfaced and extension `useful when touched`
  - distance-band `touch`
  - distance-band `useful when touched`
- Added coverage in `src/tests/level-validation-batch.test.ts`.

## 2026-04-17 04:55 PM America/Toronto

### Surfaced support persistence now exposes `daily / 4h / 5m` bucket splits

- Refined `src/lib/validation/level-persistence-validator.ts` and `src/lib/validation/level-validation-batch.ts`.
- Persistence output now prints:
  - `Support bucket persistence | daily / 4h / 5m`
  - `Support bucket loose matches | daily / 4h / 5m`
- Batch output now carries the same support-bucket split into:
  - summary lines
  - per-symbol lines
- Why this matters:
  - the next structural question is whether support instability is broad or mostly intraday
  - this bucket split now lets future live passes say that directly instead of inferring it from one blended support-persistence number
- Live read from the first support-focused pass:
  - `FAMI` support buckets were stable across `daily / 4h / 5m`
  - `EFOI` support weakness was concentrated in `5m`
  - that points more toward intraday support instability than higher-timeframe support weakness
- Added focused coverage in:
  - `src/tests/level-persistence-validator.test.ts`
  - `src/tests/level-validation-batch.test.ts`

## 2026-04-17 06:20 PM America/Toronto

### Support forward validation now exposes `daily / 4h / 5m` bucket usefulness

- Refined `src/lib/validation/forward-reaction-validator.ts` and `src/lib/validation/level-validation-batch.ts`.
- Forward output now prints surfaced support bucket splits for:
  - `Support bucket usefulness`
  - `Support bucket touch`
  - `Support bucket useful when touched`
- Batch output now carries the same support-bucket forward split into:
  - summary lines
  - per-symbol lines
- Why this matters:
  - support persistence alone was not enough to tell whether the weak bucket was actually failing once touched
  - this now separates:
    - unstable but never reached
    - reached and useful
    - reached and weak
- Live read from the repeat ticker set:
  - `GXAI` repeated weak `4h` support persistence, but no surfaced support bucket was touched in the short forward window
  - `PMNT` showed `5m` support doing the real near-term work, with `daily` support partially useful and `4h` untouched
  - `FAMI` support weakness was mainly a `daily` bucket remap issue, and the `daily` support bucket was useful when touched
  - `EFOI` kept `5m` as the weaker persistence bucket, but none of its surfaced support buckets were reached in that forward window
- Added focused coverage in:
  - `src/tests/forward-reaction-validator.test.ts`
  - `src/tests/level-validation-batch.test.ts`

## 2026-04-17 06:45 PM America/Toronto

### Validation runners now support a longer IBKR historical fetch timeout

- Refined `src/lib/market-data/provider-factory.ts` so an explicit IBKR historical timeout can be passed through when creating the provider.
- Wired `LEVEL_VALIDATION_IBKR_TIMEOUT_MS` into:
  - `src/scripts/run-level-candle-health-check.ts`
  - `src/scripts/run-level-persistence-validation.ts`
  - `src/scripts/run-forward-reaction-validation.ts`
  - `src/scripts/run-level-validation-batch.ts`
- Why this matters:
  - fresh-cache validation runs were hitting the provider’s default `30000ms` timeout before the next support-horizon comparison could complete
  - this keeps the change scoped to validation and live evidence gathering, not the main level engine
- Added focused coverage in:
  - `src/tests/provider-factory.test.ts`

## 2026-04-17 09:10 PM America/Toronto

### Support forward validation now exposes closest-approach context

- Refined `src/lib/validation/forward-reaction-validator.ts` and `src/lib/validation/level-validation-batch.ts`.
- Forward output now prints:
  - `Support bucket closest approach`
- Batch output now also carries per-symbol support approach context via:
  - `supportBucketApproach=daily/4h/5m`
- Why this matters:
  - several fresh live runs showed surfaced support buckets with `touch=0.0000`
  - that still left an ambiguity between:
    - support that was never realistically approached
    - support that came close but still was not touched
- The new metric reports the smallest normalized distance from future price action to each surfaced support bucket.
- Interpretation:
  - `0.0000` means the bucket was touched
  - a small non-zero value means price got close without touching
  - a larger value means the bucket sat meaningfully below the realized path
- Added focused coverage in:
  - `src/tests/forward-reaction-validator.test.ts`
  - `src/tests/level-validation-batch.test.ts`

## 2026-04-18 12:05 AM America/Toronto

### Support bucket output now exposes evaluated counts

- Refined `src/lib/validation/forward-reaction-validator.ts` and `src/lib/validation/level-validation-batch.ts`.
- Forward output now prints:
  - `Support bucket evaluated`
- Batch output now also carries:
  - summary-level `Support bucket evaluated`
  - per-symbol `supportBucketEval=daily/4h/5m`
- Why this matters:
  - `supportBucketApproach=0.0000` was still ambiguous
  - it could mean:
    - the bucket was touched
    - or there was no surfaced support bucket for that timeframe on that symbol
- The new evaluated counts remove that ambiguity.
- Live replay read after the change:
  - `PMNT` showed `supportBucketEval=4/5/0`
  - `FAMI` showed `supportBucketEval=1/1/0`
  - `EFOI` showed `supportBucketEval=3/1/0`
  - so those names did not have a surfaced `5m` support bucket in the first place, which explains some prior `0.0000` lines more honestly
- Added focused coverage in:
  - `src/tests/level-validation-batch.test.ts`

## 2026-04-17 11:25 PM America/Toronto

### Validation candle cache now reuses the nearest prior matching window

- Refined `src/lib/validation/validation-candle-cache.ts`.
- Validation candle caching no longer requires an exact timestamp match for every rolling request.
- The cache layer now reuses the nearest prior cached file for the same:
  - `symbol`
  - `timeframe`
  - requested lookback or a larger compatible lookback
  when the cached end time is within one bar of the requested end time in `read_write`.
- In `replay` mode, the cache can now also reuse the latest prior compatible cached file even when it is older than one bar.
- Reused cache responses are rewritten with the current request's:
  - `requestedStartTimestamp`
  - `requestedEndTimestamp`
  so candle-health and staleness checks stay honest.
- Why this matters:
  - rolling `5m` validation requests were frequently missing cache by a single bar and falling back to IBKR historical unnecessarily
  - this improves `read_write` and `replay` validation reliability without pretending materially older data is current
- The fallback stays intentionally conservative:
  - prior-only, never future
  - `read_write` still keeps the one-bar gap rule
  - `replay` can use older prior cache on purpose for offline analysis
  - larger-lookback reuse is allowed, smaller-lookback reuse is not
- This materially improved offline validation on cached symbols like:
  - `GXAI`
  - `EFOI`
  by turning prior 5m cache misses into completed replay-mode forward validation runs.
- Added focused coverage in:
  - `src/tests/validation-candle-cache.test.ts`

## 2026-04-23 3:20 PM America/Toronto

### Tightened cross-family narration ownership and delivery-aware optional backoff

- Refined `src/lib/monitoring/manual-watchlist-runtime-manager.ts` again:
  - reactive same-event watch-mode families like `level_touch` and `compression` now spend optional continuity / live-state beats more sparingly inside the short burst window
  - when a single price-update snapshot already contains a completed evaluation for the same symbol and event type, the completed follow-through post now owns that story and weaker progress-driven narration is skipped
  - recent Discord delivery failures now trigger a short optional-post backoff for that symbol, reducing the chance that continuity / live-state / recap chatter feeds a fresh 429 burst
  - live thread post state now carries event-type context so the runtime can arbitrate same-symbol narration more precisely instead of treating every optional post like generic context
- Added focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-23 3:40 PM America/Toronto

### Closed the in-flight reactive narration race

- Refined `src/lib/monitoring/manual-watchlist-runtime-manager.ts` again:
  - reactive same-event optional-post arbitration now looks at in-flight narration attempts before the first Discord route resolves
  - this closes the race where `level_touch` / `compression` threads could still briefly post both a continuity update and a live-state update in the same short window
- Added focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-23 3:55 PM America/Toronto

### Made startup-pending thread review more neutral

- Refined `scripts/start-manual-watchlist-long-run.ps1` again:
  - startup-pending review now uses a shared helper so quality verdicts, end-of-session summaries, and per-thread status all agree on what counts as `activating`
  - symbols with no visible trader output yet now stay closer to neutral/activating instead of being pulled into `noisy` just because seeding or first-post startup has not finished
  - the fallback penalty for truly no-output threads is now lighter, which keeps review tone more proportional when the runtime simply has not told its story yet
- Verification:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

## 2026-04-23 4:00 PM America/Toronto

### Aligned startup-pending verdicts with activating status

- Refined `scripts/start-manual-watchlist-long-run.ps1` once more:
  - startup-pending, failure-free threads now get a neutral quality floor in review scoring
  - this prevents the review summary from showing `activating` in the headline while still assigning a `noisy` verdict just because no visible trader-facing output has happened yet
- Verification:
  - PowerShell parse check for `scripts/start-manual-watchlist-long-run.ps1`

## 2026-04-23 11:35 AM America/Toronto

### Tightened reactive thread discipline and support-test tradeability

- Tightened live optional-post gating again in `src/lib/monitoring/manual-watchlist-runtime-manager.ts`:
  - `rejection`, `fake_breakout`, and `fake_breakdown` now keep a much tighter continuity / follow-through-state / recap budget than cleaner breakout / breakdown / reclaim families
  - reactive `level_touch` / `compression` behavior remains constrained, but the gating is now more explicit about fragile directional families too
- Tightened support-test tradeability in:
  - `src/lib/alerts/trader-message-language.ts`
  - `src/lib/alerts/alert-scorer.ts`
  - `src/lib/monitoring/opportunity-engine.ts`
- The support-test pass now:
  - downgrades repeatedly tested support more aggressively when nearby overhead is layered or limited
  - makes poor dip-buy conditions show up in both trader-facing wording and the deterministic scoring/ranking layers
  - preserves the distinction between structurally real support and support that is no longer tactically buyable
- Refined long-run review honesty in `scripts/start-manual-watchlist-long-run.ps1`:
  - controlled reactive watch-mode threads now read more honestly instead of being treated like clutter by default
  - end-of-session summaries can now say when the symbol stayed in reactive watch mode rather than forcing a vague observational/noisy framing
- Added focused coverage in:
  - `src/tests/alert-intelligence.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/opportunity-decision-integrity.test.ts`

## 2026-04-23 12:20 PM America/Toronto

### Added burst control and stronger extension dedupe from live `AKAN` / `BURU` evidence

- Tightened live thread behavior again in `src/lib/monitoring/manual-watchlist-runtime-manager.ts`:
  - continuity, follow-through-state, recap, and follow-through posts now share a short per-symbol narration burst budget
  - directional continuity progression still works, but same-window narration cascades are now cut down before they hit Discord
  - overlapping refresh paths now dedupe identical `NEXT LEVELS` payloads more reliably by keying on stable content instead of timestamped payload JSON
- Refined long-run review heuristics in `scripts/start-manual-watchlist-long-run.ps1`:
  - symbols with multiple Discord delivery failures and still-positive outcomes are more likely to read as delivery-choked or bursty instead of automatically low-signal
  - clutter review now has better guidance when downstream delivery pressure is distorting the live thread
- Added focused coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-23 12:45 PM America/Toronto

### Tightened continuity overexpression from live `AIXI` / `AUUD` evidence

- Refined `src/lib/monitoring/manual-watchlist-runtime-manager.ts` again:
  - setup-forming continuity now yields to a freshly posted trader-critical alert instead of restating the story right after the alert already landed
  - continuity state is now tracked optimistically during routing, so same-label continuity updates collapse even if they arrive before the first post resolves
  - progress-driven continuity now yields more often to live follow-through-state posts, and evaluation-driven continuity now yields to completed follow-through posts when the trader-critical follow-through message already told the story
- Added focused regression coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-23 4:35 PM America/Toronto

### Added a short runtime-only settle window so fresh critical alerts can preempt weaker optional narration

- Updated `src/lib/monitoring/manual-watchlist-runtime-manager.ts`:
  - continuity and live follow-through-state posts can now wait briefly in the real runtime before routing
  - that short settle window lets a fresh trader-critical alert claim the story first when both are about to post in the same small window
  - the settle delay is runtime-configured, so production gets the preemption behavior without slowing the existing unit-test suite
- Updated `src/runtime/manual-watchlist-server.ts`:
  - the manual runtime now opts into the optional-post settle delay explicitly
- Added focused coverage in:
  - `src/tests/manual-watchlist-runtime-manager.test.ts`

## 2026-04-17 10:20 PM America/Toronto

### Added a production-oriented level strength scoring and ranking layer

- Added the new scoring modules:
  - `src/lib/levels/level-score-config.ts`
  - `src/lib/levels/level-zone-utils.ts`
  - `src/lib/levels/level-touch-analysis.ts`
  - `src/lib/levels/level-clustering.ts`
  - `src/lib/levels/level-state-engine.ts`
  - `src/lib/levels/level-structural-scoring.ts`
  - `src/lib/levels/level-active-scoring.ts`
  - `src/lib/levels/level-ranking.ts`
  - `src/lib/levels/level-score-explainer.ts`
- Extended `src/lib/levels/level-types.ts` with the shared contracts for:
  - level states
  - touch records
  - score breakdowns
  - ranked outputs
  - scoring context
- The new layer scores levels by confluence rather than raw touch count, combining:
  - structural strength
  - active relevance
  - duplicate-cluster penalties
  - deterministic state
  - confidence
  - explanation output
- Added focused coverage in:
  - `src/tests/level-strength-ranking.test.ts`
- Added implementation tracking documentation:
  - `docs/20_LEVEL_STRENGTH_SCORING_IMPLEMENTATION_PLAN.md`
  - and a pointer in `docs/level-strength-scoring-blueprint.md`

## 2026-04-17 11:35 PM America/Toronto

### Added side-by-side comparison harness for old and new level ranking paths

- Added the comparison module:
  - `src/lib/levels/level-ranking-comparison.ts`
- Added a manual comparison script:
  - `src/scripts/run-level-ranking-comparison.ts`
- Added focused coverage in:
  - `src/tests/level-ranking-comparison.test.ts`
- Added migration tracking documentation:
  - `docs/21_LEVEL_RANKING_COMPARISON_AND_MIGRATION_PLAN.md`
- What this comparison pass now does:
  - traces the current old runtime path from `LevelEngine.generateLevels(...)`
  - runs the old bucketed surfaced-output path and the new strength ranking path on shared inputs
  - normalizes both outputs into a comparable shape
  - reports top-level changes, ordering shifts, duplicate suppression differences, and compatibility warnings
  - produces a migration readiness summary instead of guessing whether the new layer is safe to replace the old path with
- Initial deterministic fixture read from the comparison script:
  - all `3/3` symbols changed top support
  - `2/3` changed top resistance
  - `0/3` showed better nearby duplicate suppression in the compared subset
  - the new path was richer on metadata in every case, but direct replacement remains blocked by output compatibility because live consumers still expect bucketed `LevelEngineOutput`
