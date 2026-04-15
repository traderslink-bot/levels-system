# Project Change Log

## Purpose

This document tracks concrete implementation changes made to the `levels-system` project over time so the current state of the codebase is easy to review.

## Format

- Use Eastern time where practical, matching the rest of the project notes.
- Add entries in reverse chronological order.
- Keep each entry focused on shipped code, verification, and follow-up risk.

---

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
