# Project Change Log

## Purpose

This document tracks concrete implementation changes made to the `levels-system` project over time so the current state of the codebase is easy to review.

## Current Testing Context

- IBKR is the active provider being used to test the system end-to-end right now.
- The current IBKR integration should be treated as the testing/integration provider for this phase.
- Provider abstraction remains intentional because the data provider may be switched after testing.

## Format

- Use Eastern time where practical, matching the rest of the project notes.
- Add entries in reverse chronological order.
- Keep each entry focused on shipped code, verification, and follow-up risk.

---

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
