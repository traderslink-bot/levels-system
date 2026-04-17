# Levels System Repo Review Implementation Directive

## Purpose

This document converts the repo review into a direct implementation directive that Codex can execute from without needing interpretation. It is not a loose ideas document. It is a prioritized work order.

## Current repo status note

This directive is still valid as a priority guide, but parts of the earlier text are now behind the current implementation state.

Already materially completed in code:
- Phase 1 candle-data foundation rebuild
- session-aware special intraday levels
- initial level freshness/output metadata
- watchlist activation lifecycle basics
- activation-triggered level posting
- staleness/refresh policy helper
- outermost ladder proximity handling
- distinct extension posting workflow
- explicit monitored-zone identity and remap semantics
- extension-promotion replacement into canonical monitored state
- event-context propagation for freshness/origin/remap/ladder state
- alert scoring/filtering/formatting rebuild that preserves monitoring context in trader-facing output
- runtime wiring so manual watchlist and direct runtime paths now use alert intelligence instead of generic alert payloads
- explicit posting-policy and deduplication semantics for trader-facing alert delivery
- crowding-aware level scoring and spacing-aware surfaced/extension ladder selection
- stronger multi-timeframe confluence weighting and explicit surfaced-bucket ownership for mixed structural zones
- explicit follow-through usefulness scoring so breakout-relevant structure is distinguished from incidental local reaction levels
- deterministic path-clearance and frontier-selection logic so thin-zone/open-space continuation relevance is reflected in surfaced and extension ladders
- bounded gap-continuation scoring so only held gap space, not merely raw gap presence, materially improves continuation relevance

Current highest-value open work:
- validation-driven hardening of the current support/resistance engine using targeted small-cap scenario coverage
- persistence and churn validation over rolling candle windows using the active provider path
- forward reaction validation so surfaced and extension levels can be judged by what price does afterward
- batch validation over multiple symbols so structural changes can be judged across a wider sample instead of one-off spot checks
- final monitoring semantics cleanup only where validation against the stronger level truth justifies it
- testing-driven refinement of alert delivery rules only where real runtime behavior proves it necessary

Current execution posture:
- Broad structural feature building is no longer the default.
- New level-engine changes should be made only when targeted validation reveals a real remaining weakness.
- The current repo is now in an evidence-driven hardening phase rather than an open-ended feature-expansion phase.
- Going forward, support/resistance tuning should be validated through the level-validation workflow first, not only through ad hoc live snapshot review.

The most important conclusion from the repo review is this:

1. The highest priority is fixing the candle data foundation and rebuilding support and resistance on top of the correct data.
2. The current architecture is generally clean, but several core logic areas are still early stage or heuristic.
3. The watchlist workflow and alert lifecycle still do not reflect the real trader workflow that is actually needed.
4. Codex should treat this document as an execution queue and assign itself tasks from top to bottom.

## Non Negotiable Priority Order

Codex must prioritize work in this exact order:

1. Correct candle data
2. Strong support and resistance logic built on correct candle data
3. Correct level regeneration and refresh workflow for watchlist usage
4. Monitoring and expansion logic around level ladders
5. Trader facing alert routing and formatting
6. Persistence, validation, and tests
7. Documentation updates after implementation, not before

## Primary Objective

Build the levels system into a trustworthy trader workflow system, not just a technically organized demo.

The system must become reliable enough that a trader can:
- activate a ticker into alerts
- immediately get fresh support and resistance levels
- trust that those levels were generated from the correct candle data
- continue receiving relevant monitoring alerts as price interacts with those levels
- receive the next potential resistance and support ladder before price fully runs out of current visible levels

## Hard Rules For Codex

1. Do not prioritize visual polish, docs polish, or low value formatting over data quality and level quality.
2. Do not create new parallel systems that duplicate current files unless the current files are clearly wrong and need replacement.
3. Do not leave placeholder logic in place under production sounding names.
4. Do not treat sample runners as proof of production readiness.
5. Do not stop after adding abstractions. Wire them into the real runtime path.
6. Keep naming honest. If something is approximate, do not label it as session accurate or production ready.
7. Prefer exact file by file upgrades over vague architectural drift.
8. Add tests for important scoring and detection behavior as each major layer is upgraded.
9. Keep backward compatibility only where it does not preserve weak logic.
10. When a file is no longer correct, replace it cleanly instead of layering workaround logic on top.

---

# Repo Review Summary

## What is already structurally good

The repo already has a useful skeleton:
- clean TypeScript structure
- separation across market data, levels, monitoring, and alerts
- a usable IBKR historical provider foundation
- a usable live monitoring provider foundation
- stronger than expected monitoring state and event logic
- a staged architecture that can be upgraded without full rewrite

This means the project should not be restarted from zero.

## What is not good enough yet

The important weak points are:
- support and resistance logic is still too heuristic and basic
- special intraday levels are not session accurate even though they are named as if they are
- alert intelligence is much weaker than monitoring intelligence
- watchlist lifecycle behavior is not aligned with the real workflow
- level refresh and next ladder discovery logic are not implemented
- candle data strategy is not stable enough yet for a trustworthy levels engine
- the current scripts are mostly sample and validation harnesses rather than production workflow entry points

---

# Phase 1: Candle Data Foundation Rebuild

## Why this is the top priority

Support and resistance quality is only as good as the candle data quality. The current repo can fetch candles, but the data strategy is not yet strong enough for a reliable levels engine. This must be fixed before deeper level logic tuning.

## Core problems to solve

1. The provider currently hardcodes broad duration windows for IBKR historical data and slices afterward.
2. The system does not yet prove that the correct candle windows are being fetched per timeframe.
3. Session awareness is not established cleanly enough for intraday special levels.
4. The system is too dependent on IBKR despite candle quality concerns already identified.
5. Candle quality, completeness, and freshness are not yet inspectable enough before level generation.

## Required end state

Codex must build a candle data layer that can do all of the following:
- fetch the correct historical depth intentionally per timeframe instead of indirectly via broad fixed durations
- normalize candle output across providers into one shared internal format
- support at least one stronger non IBKR candle provider path in addition to IBKR
- make provider choice explicit and injectable at runtime
- introduce session aware handling needed for premarket, regular session, opening range, and later intraday logic
- make candle completeness and recency inspectable
- allow validation of candle quality before level generation runs

## File targets

Primary files:
- `src/lib/market-data/candle-types.ts`
- `src/lib/market-data/candle-fetch-service.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/market-data/ibkr-pacing-queue.ts`

Likely new files:
- `src/lib/market-data/provider-types.ts`
- `src/lib/market-data/provider-factory.ts`
- `src/lib/market-data/candle-quality.ts`
- `src/lib/market-data/candle-session-classifier.ts`
- `src/lib/market-data/candle-validation.ts`
- `src/lib/market-data/provider-priority.ts`
- `src/lib/market-data/providers/<new-provider>.ts`

## Required tasks

### Task 1. Redesign candle fetch contracts

Upgrade the candle data contract so a fetch result includes:
- provider name
- requested timeframe
- requested lookback bars
- actual bars returned
- fetch start and end timestamps
- completeness status
- stale status
- validation warnings
- session metadata availability

Do not keep the candle response as only symbol, timeframe, and candles.

### Task 2. Add candle validation and quality checks

Build a candle validation layer that checks:
- zero candle results
- insufficient returned bars
- out of order timestamps
- duplicate timestamps
- invalid OHLC values
- suspicious gaps
- stale final candle
- missing expected recent candles
- incomplete current session data when relevant

This validation must return structured warnings or errors and be callable before level generation.

### Task 3. Add explicit provider abstraction with runtime selection

Refactor the provider layer so the system can choose from:
- IBKR
- at least one non IBKR provider intended to improve candle quality for levels generation

The non IBKR path must not be left as a doc only idea. It must exist in code.

### Task 4. Replace broad duration guessing with timeframe aware fetch planning

Refactor the historical fetch planning logic so the system intentionally determines fetch windows per timeframe and per provider.

Examples:
- daily should fetch enough bars for strong higher timeframe level generation
- 4h should fetch enough bars for intermediate structure
- 5m should fetch enough bars for intraday structure and session specific logic

The provider should not depend on broad hardcoded duration strings plus post slicing as the final design.

### Task 5. Build session classification support

Implement session classification utilities so intraday candles can be grouped into:
- premarket
- regular session
- after hours when relevant
- opening range segment

This must become the basis for special level extraction.

### Task 6. Add candle diagnostics outputs for testing

Add test and debug utilities that can print:
- provider used
- candle count by timeframe
- oldest and newest timestamps
- validation warnings
- session classification summary

This must make data quality review easy before levels are trusted.

## Acceptance criteria for Phase 1

Phase 1 is only complete when all of these are true:
- the system can choose between at least two provider paths
- candle results include validation metadata
- level generation can reject or warn on low quality candle inputs
- intraday candle sets can be session classified
- fetch planning is deliberate and timeframe aware
- sample and runtime paths can surface candle diagnostics

---

# Phase 2: Support And Resistance Engine Rebuild

## Why this is next

The current levels architecture is clean, but the level quality itself is still too simple. The engine is modular, but not yet strong enough to be trusted as the main trader facing levels system.

## Core problems to solve

1. Swing detection is basic and can over generate noise.
2. Raw candidates are too simplistic.
3. Scoring is too formula driven and not market aware enough.
4. Special intraday levels are inaccurately labeled.
5. The system does not yet support proactive ladder extension when price is near the last visible level.

## Required end state

The levels engine must:
- generate stronger support and resistance zones from correct candles
- use better raw candidate logic than every local swing becoming a candidate
- keep clustering but improve how candidate quality is determined before clustering
- produce honest session based special levels
- provide next ladder discovery above current resistance and below current support
- expose enough metadata so downstream systems know which levels are fresh, session based, higher timeframe, or extension levels

## File targets

Primary files:
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/swing-detector.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/special-level-builder.ts`

Likely new files:
- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-refresh-policy.ts`
- `src/lib/levels/session-level-builder.ts`
- `src/lib/levels/level-output-formatter.ts`
- `src/lib/levels/level-ladder-utils.ts`

## Required tasks

### Task 1. Upgrade swing detection

Replace the current simple window only logic with stronger logic that accounts for:
- significance of swing magnitude
- local noise filtering
- repeated reaction history
- optional minimum displacement
- optional minimum separation between accepted swing points

The swing detector must reduce noise, not just find every local high and low.

### Task 2. Upgrade raw candidate generation

Raw level candidates must carry better evidence such as:
- reaction quality
- repeat interaction count
- displacement strength
- session significance
- whether the level comes from gap related structure
- whether it comes from opening range or premarket only after session accurate extraction exists

Do not keep raw candidates as one touch placeholders with minimal meaning.

### Task 3. Keep clustering but improve candidate pre quality

The clusterer itself is one of the stronger existing files and should likely be preserved and upgraded rather than replaced completely.

Improve:
- merge heuristics
- confidence metadata on clustered zones
- traceability from final zones back to source evidence
- rules for preventing over wide zones

### Task 4. Rebuild scoring around actual level quality

Refactor `level-scorer.ts` so final zone scoring considers:
- higher timeframe importance
- repeated reactions
- reaction magnitude
- recency
- session importance
- confluence
- structure relevance
- whether the level has meaningful evidence or is only a weak intraday artifact

The current formula is a decent skeleton but not the final model.

### Task 5. Replace inaccurate special level logic

Rebuild `special-level-builder.ts` so it becomes session accurate.

It must only label levels as:
- premarket high
- premarket low
- opening range high
- opening range low

if those are actually derived from correct session segmented candles.

If session accurate extraction does not exist yet, do not keep fake naming in place.

### Task 6. Add next ladder discovery logic

Build a level extension or ladder engine that can:
- discover the next resistance ladder above the highest currently surfaced resistance
- discover the next support ladder below the lowest currently surfaced support
- do this before price fully escapes the currently posted level set
- return extension levels in a structured way so the watchlist system can post them proactively

This is a required feature, not a future maybe.

### Task 7. Add level freshness metadata

Each level output should carry metadata such as:
- generatedAt
- provider used
- data quality flags
- session date for intraday session levels
- whether the level is initial or extension generated
- whether the output is stale and needs refresh

## Acceptance criteria for Phase 2

Phase 2 is only complete when:
- special levels are session accurate
- raw candidate generation is materially richer
- swing detection is less noisy
- final levels have stronger evidence
- level outputs include freshness and origin metadata
- extension ladders can be generated beyond the current visible resistance or support set

---

# Phase 3: Real Watchlist Lifecycle Workflow

## Why this matters

The current system detects events around existing levels, but it does not yet match the actual workflow needed.

The trader workflow requirement is:

Every time a ticker is newly selected into alerts, the system should immediately generate and post fresh support and resistance levels.

This does not only mean the first time a thread is created. It means every new time the ticker becomes an actively monitored alert symbol.

Also, when price starts getting close to the last resistance level or last support level, the system should proactively generate and post the next levels before price enters that empty space.

## Required end state

The watchlist system must:
- detect ticker activation into alerts
- regenerate fresh levels on activation
- post those levels immediately
- keep monitoring whether the visible level ladder is running out
- proactively extend and post the next ladder when price is nearing the outermost current level
- refresh stale levels according to defined policy
- not rely on manual intervention for these steps

## File targets

Primary files:
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/monitoring-config.ts`

Likely new files:
- `src/lib/watchlist/watchlist-lifecycle.ts`
- `src/lib/watchlist/watchlist-level-refresh.ts`
- `src/lib/watchlist/watchlist-posting-types.ts`
- `src/lib/watchlist/outer-level-proximity.ts`
- `src/lib/watchlist/activation-handler.ts`

## Required tasks

### Task 1. Define watchlist activation lifecycle

Introduce a real lifecycle model for symbols such as:
- inactive
- activating
- active
- stale
- refresh_pending
- extension_pending

This can live in monitoring or a separate watchlist module, but the lifecycle must be explicit.

### Task 2. Generate levels on every activation

When a symbol is moved into alerts or otherwise marked active:
- fetch correct candles
- validate candles
- generate levels
- store levels
- format a trader facing level summary
- route that summary to the posting layer

This must happen every time the symbol becomes active, not only once ever.

### Task 3. Add staleness and refresh policy

Build explicit rules for when levels should be refreshed, for example:
- newly activated symbol
- levels generated from stale data
- new trading session started
- strong breakout beyond current ladder
- manual refresh request

### Task 4. Detect outermost level proximity

Add logic that evaluates:
- distance to highest surfaced resistance
- distance to lowest surfaced support
- whether price is close enough that the current ladder is no longer sufficient

When that happens, trigger extension generation before price fully reaches empty space.

### Task 5. Post extension ladders

When outermost level proximity logic triggers:
- generate extension levels
- format them clearly as next levels
- post them in a trader friendly way
- avoid duplicate repost spam

### Task 6. Preserve level state cleanly

Refactor level storage so it can distinguish:
- current active level set
- extension level set
- generation timestamp
- session tag
- source provider
- staleness flags

The current memory only `LevelStore` is not enough for final workflow.

## Acceptance criteria for Phase 3

Phase 3 is only complete when:
- ticker activation always generates and posts fresh levels
- stale levels can be recognized and refreshed
- the system can detect when the outer ladder is nearly exhausted
- extension levels can be generated and posted before price fully enters that space
- duplicate spam posting is controlled

---

# Phase 4: Monitoring Layer Upgrade

## Why this is not the top priority

The monitoring layer is already one of the stronger parts of the repo. It should be upgraded after candle data and levels are corrected, not before.

## Required end state

Monitoring must remain modular but become aware of:
- level freshness
- extension ladders
- session context
- refreshed level sets replacing old ones
- outer ladder proximity state

## File targets

Primary files:
- `src/lib/monitoring/interaction-state-machine.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/symbol-state.ts`
- `src/lib/monitoring/ibkr-live-price-provider.ts`

## Required tasks

### Task 1. Make monitoring aware of level freshness

Events should know whether they are acting on:
- fresh levels
- stale levels
- session specific levels
- extension generated levels

### Task 2. Reconcile state after level refresh

When levels are regenerated for a symbol:
- interaction state must be safely reset or remapped
- stale zone state should not leak into the new zone set
- recent event memory should be reviewed for what should persist and what should reset

### Task 3. Add extension related event context

If price is interacting with extension levels, the event payload should reflect that so the alert layer can present it correctly.

### Task 4. Re validate threshold tuning after level rebuild

All breakout, rejection, compression, and failure thresholds should be recalibrated after the new levels engine is in place.

### Task 5. Preserve the strong parts

Do not throw away the good monitoring architecture. Upgrade it around the new level lifecycle.

## Acceptance criteria for Phase 4

Phase 4 is complete when:
- monitoring works correctly across fresh level generations
- extension levels are treated cleanly
- stale zone state does not contaminate refreshed level sets
- event scoring is re tuned for the new level quality

---

# Phase 5: Alert And Posting Layer Rebuild

## Why this needs work

The alert layer is currently much weaker than the monitoring layer. Final alert scoring is too shallow, formatting is minimal, and routing is still starter level.

## Required end state

The alert layer must become a real trader facing posting system that can:
- post initial level summaries
- post monitoring events with useful trader context
- post next ladder extensions
- suppress junk without hiding important information
- use the richer monitoring intelligence rather than flattening it away

## File targets

Primary files:
- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/alerts/alert-filter.ts`
- `src/lib/alerts/alert-formatter.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`

Likely new files:
- `src/lib/alerts/level-summary-formatter.ts`
- `src/lib/alerts/discord-message-builder.ts`
- `src/lib/alerts/posting-policy.ts`
- `src/lib/alerts/alert-deduplication.ts`
- `src/lib/alerts/extension-alert-formatter.ts`

## Required tasks

### Task 1. Stop discarding monitoring intelligence

Refactor final alert scoring so it incorporates:
- monitoring event strength
- monitoring confidence
- priority
- pressure score
- structure context
- whether the level is extension based
- whether the level is fresh or stale
- zone quality and timeframe quality

Do not re flatten everything into only event base score plus zone label.

### Task 2. Add dedicated level summary posting

Build a posting formatter for newly activated tickers that includes:
- support levels
- resistance levels
- notable session levels
- generation timestamp or freshness indicator
- any quality or warning flags if data quality is degraded

### Task 3. Add dedicated extension posting

Build a formatter specifically for “next levels” posts so those messages are clearly different from ordinary event alerts.

### Task 4. Replace starter router logic

The current router style output is too basic. Replace it with a routing system that can handle:
- initial level posts
- monitoring event posts
- extension ladder posts
- future Discord or channel specific formatting

### Task 5. Improve suppression policy

Suppression must account for:
- duplicate events
- low value churn
- stale level alerts
- repeated extension notices
- weak intraday only noise

without suppressing meaningful trader information.

## Acceptance criteria for Phase 5

Phase 5 is complete when:
- initial ticker activation can produce a real level post
- event alerts preserve the richer monitoring intelligence
- next ladder posts exist and are distinct
- routing is no longer starter level
- suppression policy is practical rather than minimal

---

# Phase 6: Persistence And Runtime Reliability

## Why this matters

The repo currently relies heavily on memory only state. That is not enough for a serious watchlist system.

## Required end state

The system must persist enough state to survive restarts and maintain correct behavior.

## Required tasks

### Task 1. Persist level sets

Persist:
- latest level output per symbol
- generation time
- provider used
- staleness flags
- extension levels
- session tags

### Task 2. Persist watchlist state

Persist:
- active symbols
- symbol activation timestamps
- last level post timestamp
- last extension post timestamp
- refresh pending state

### Task 3. Persist important monitoring state where useful

At minimum evaluate whether these should persist:
- recent events
- bias state
- pressure memory
- extension exhaustion state

### Task 4. Protect runtime restart flows

After restart, the system should be able to:
- reload active symbols
- reload recent level sets
- decide which symbols need refresh
- avoid duplicate immediate repost spam if not appropriate

## Acceptance criteria for Phase 6

Phase 6 is complete when:
- the system can recover its symbol and level state after restart
- restarts do not destroy the workflow
- extension and refresh logic remain coherent across sessions

---

# Phase 7: Tests, Validation, And Calibration

## Why this matters

Codex must not only implement logic. It must verify that the logic behaves correctly.

## Required test categories

### Candle data tests
- provider normalization
- validation errors and warnings
- duplicate timestamp handling
- stale data detection
- session classification

### Levels tests
- noise filtering in swing detection
- candidate generation quality
- clustering behavior
- session accurate special levels
- extension ladder generation
- freshness metadata

### Watchlist lifecycle tests
- activation triggers level generation
- re activation triggers fresh generation
- stale levels refresh
- outer ladder proximity triggers extension generation
- duplicate extension suppression

### Monitoring tests
- state reset or remap after level refresh
- extension level event handling
- recalibrated event scoring
- bias and pressure continuity rules

### Alert tests
- initial level summary formatting
- event alert scoring with monitoring intelligence included
- extension ladder alert formatting
- suppression policy correctness

## Required validation utilities

Build or upgrade runnable utilities that can:
- inspect candle quality before level generation
- generate levels for a symbol and print full diagnostics
- simulate activation and verify a level post is generated
- simulate outer ladder proximity and verify an extension post is generated

## Acceptance criteria for Phase 7

Phase 7 is complete when:
- all major runtime paths have tests
- the test harness can validate the trader workflow, not just isolated helpers
- Codex can demonstrate the exact activation to level post to extension post sequence

---

# Required Repo Cleanup

## Files or logic that likely need direct cleanup

### `src/lib/levels/special-level-builder.ts`
This file currently uses production sounding labels for logic that is not session accurate enough. It must be rebuilt or renamed during transition.

### `src/lib/alerts/alert-router.ts`
This appears to be starter level routing logic. It should either be replaced or reduced to a legacy compatibility helper.

### Sample runner scripts
These should remain as diagnostics and test harnesses, but must not be mistaken for production workflow. Rename or reorganize if needed so that distinction is clear.

---

# Exact Missing Workflow Requirements That Must Be Implemented

These requirements are mandatory and should be treated as product truth.

## Requirement 1
Every time a ticker is newly selected into alerts, the system must generate and post fresh support and resistance levels.

Important clarification:
This does not only mean the first time a thread is ever created.
It means every new time that ticker is selected to be active in alerts.

## Requirement 2
The system must monitor whether price is approaching the outermost current resistance or support ladder.

If price gets close enough to the outermost currently posted level, the system must generate and post the next potential levels before price fully moves into that empty space.

## Requirement 3
Support and resistance quality depends on correct candle data.
Therefore the candle data foundation must be corrected before deep tuning of alerts or formatting.

---

# Recommended Implementation Order For Codex

Codex should assign itself work in this exact order:

1. Candle data contract redesign
2. Candle validation and diagnostics
3. Multi provider candle path
4. Session classification support
5. Levels engine raw candidate rebuild
6. Swing detector upgrade
7. Session accurate special levels
8. Level scoring rebuild
9. Level extension engine
10. Level freshness metadata
11. Watchlist activation lifecycle
12. Activation triggered level generation and posting
13. Staleness and refresh policy
14. Outermost ladder proximity detection
15. Extension post workflow
16. Monitoring refresh reconciliation
17. Alert scoring rebuild to preserve monitoring intelligence
18. Initial level summary formatter
19. Extension formatter
20. Routing rebuild
21. Persistence layer
22. End to end tests and calibration
23. Final docs update

---

# Deliverable Expectations For Codex

For each major block above, Codex should:
- identify the exact files to change
- implement the logic completely
- wire the logic into runtime paths
- add or update tests
- summarize what was changed and what remains

Codex should not respond with only strategy text after this. It should execute the tasks.

---

# Definition Of Done

The project is not done until all of the following are true:

1. Candle data is trustworthy enough for levels generation
2. Support and resistance logic is materially stronger than the current heuristic version
3. Special levels are session accurate
4. Ticker activation always generates and posts fresh levels
5. The system can proactively generate and post next ladder levels
6. Monitoring remains stable across level refreshes
7. Alert output is trader facing and preserves monitoring intelligence
8. State survives restarts well enough for real usage
9. Tests validate the actual trader workflow, not only helper functions

---

# Final Instruction To Codex

Treat this file as a build directive, not a discussion prompt.

Start with Phase 1 and Phase 2 immediately.

Do not skip ahead to presentation or output polish before candle data and support and resistance quality are corrected.
