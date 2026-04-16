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

## 2026-04-16 03:35 PM America/Toronto

### Summary

- Fixed structural duplication issue in level ranking where multi-timeframe zones were appearing in multiple output ladders.
- Introduced deterministic bucket ownership so each zone belongs to exactly one timeframe ladder.
- Added targeted validation tests to enforce bucket ownership behavior.

### Files updated

- `src/lib/levels/level-ranker.ts`

### Files added

- `src/tests/level-ranker.test.ts`

### Verification completed

- Pending local verification

### Observed outcome

- Mixed timeframe zones are now assigned to a single highest-priority timeframe bucket.
- Ladder duplication is eliminated, improving clarity and downstream alert reliability.

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

... (rest unchanged)
