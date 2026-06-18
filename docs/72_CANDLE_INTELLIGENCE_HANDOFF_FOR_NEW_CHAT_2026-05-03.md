# Candle Intelligence Handoff For New Chat - 2026-05-03

## Purpose

This file is for Codex in a fresh chat. It records exactly where the candle-intelligence work stopped because the local machine appeared resource-constrained during broad all-session scans. Use this file to resume without rerunning expensive work blindly.

## Current Working Context

Repo:

```text
C:\Users\jerac\Documents\TraderLink\levels-system
```

Primary plan:

```text
docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md
```

Shared-engine handoff:

```text
docs/52_TRADER_INTELLIGENCE_V2_SHARED_ENGINE_HANDOFF_2026-05-02.md
docs/51_SHARED_SUPPORT_RESISTANCE_ENGINE_BOUNDARY_2026-05-02.md
```

Important current product goal:

- Perfect the candle-data intelligence layer: support/resistance, market structure, VWAP/EMA, volume/activity, reference levels, execution relations, and audit/replay proof.
- Discord is a useful testing surface, but the candle engine is the core shared product layer for this app and future TraderLink tools.
- The next major engineering target is support/resistance quality calibration and forward-ladder improvement.

## What Was Completed Before This Handoff

### 1. Useful May 1 Candle Coverage Was Finished

The remaining May 1 `fetch_next` stage was only `1m` trade-window coverage.

Command:

```powershell
npm run candles:backfill -- artifacts\long-run\2026-05-01_10-48-03 --priority-report artifacts\long-run\2026-05-01_10-48-03\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03\backfill-fetch-next-1m-trade-window --execute --timeout-ms 180000 --throttle-ms 1200
```

Result:

```text
planned=6 attempted=6 fetched=6 failed=0
```

### 2. May 1 Reports Were Regenerated After The Fetch

Commands run:

```powershell
npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000
npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run structure:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
```

Results:

```text
Backfill priority:
- missing tasks: 18
- fetch-first: 0
- fetch-next: 0
- fetch-later: 18
- estimated missing actionable/optional candles: 5,612
- likely no-bar/history-unavailable candles: 9,972

Support/resistance calibration:
- symbols: 18
- trusted: 12
- watch: 4
- broken: 0
- unproven: 2
- no-forward-resistance: 0
- wide-gap: 0
- coverage gaps: 6
- gate: review

Market-structure calibration:
- symbols: 20
- trusted-for-suppression: 18
- watch-structure-chop: 2
- same-structure repeats: 296

Why-no-post proof:
- symbols: 18
- quiet-supported: 8
- quiet-may-hide: 0
- runtime/feed-silence: 1
- missing-candle unproven: 0
```

Interpretation:

- May 1 has no remaining blocking fetch-first or fetch-next candle work.
- The remaining fetch-later items are broad historical coverage for lower-priority symbols, not urgent Discord/support-resistance blockers.

## Remaining May 1 Support/Resistance Watch Cases

These are not currently confirmed level-engine defects.

### FATN

- Verdict: `unproven`
- Main issue: no future 5m reaction proof after first post.
- Forward ladder exists.
- Nearby levels are crowded/weak 5m levels, so this is an evidence limitation/practical-zone issue, not a no-resistance bug.

### NOK

- Verdict: `unproven`
- Main issue: levels were not touched enough after first post to prove ranking.
- Forward ladder exists.
- No no-forward-resistance bug found.

### ISPC

- Verdict: `watch`
- Main issue: crowded nearby support cluster.
- Support evidence is trusted.
- Resistance evidence was mostly untested.

### LABT

- Verdict: `watch`
- Main issue: sparse daily/4h history and weak support reaction evidence.
- Resistance ladder context exists.

### PBM

- Verdict: `watch`
- Main issue: crowded nearby resistance cluster and one broken near-distance bucket.
- Market structure supports treating the area as a practical zone.

### WTO

- Verdict: `watch`
- Main issue: crowded nearby resistance cluster and limited after-post proof.
- Resistance evidence itself is mostly trusted.

## Remaining Market-Structure Watch Cases

### ABTS

- Verdict: `watch_structure_chop`
- Reasons:
  - one low-confidence replay case
  - immaterial transition ratio around 0.61
  - most raw flips were small-cap wiggles
- Conclusion:
  - keep market structure operator/suppression-only for ABTS until more evidence improves confidence.

### XTLB

- Verdict: `watch_structure_chop`
- Reasons:
  - two low-confidence replay cases
  - one case had insufficient candles
  - immaterial transition ratio around 0.67
- Conclusion:
  - keep market structure operator/suppression-only for XTLB until more evidence improves confidence.

## Broad All-Session Calibration Status

The broad all-session pass was started, but local resources became constrained.

Completed:

```powershell
npm run levels:calibrate -- artifacts\long-run --all-sessions --warehouse data\candles --out-dir artifacts\support-resistance-calibration-all-sessions
npm run structure:calibrate -- artifacts\long-run --all-sessions --warehouse data\candles --output artifacts\market-structure-calibration-all-sessions
```

Results:

```text
All-session support/resistance:
- symbols: 57
- trusted: 18
- watch: 8
- broken: 2
- unproven: 29
- no-forward-resistance: 29
- wide-gap: 0
- coverage gaps: 81
- gate: fail

All-session market structure:
- symbols: 57
- trusted: 19
- watch: 1
- repeats: 917
```

Timed out / should not be blindly rerun yet:

```powershell
npm run candles:backfill-priority -- artifacts\long-run --all-sessions --warehouse data\candles --out-dir artifacts\candle-backfill-priority-all-sessions --max-tasks-per-stage 20 --max-candles-per-stage 10000
npm run candles:import-readiness -- artifacts\long-run --all-sessions --warehouse data\candles --out-dir artifacts\candle-import-readiness-all-sessions
npm run audit:why-no-post -- artifacts\long-run --all-sessions --warehouse data\candles --out-dir artifacts\why-no-post-all-sessions
```

Timeouts observed:

- broad backfill-priority: timed out after roughly 15 minutes
- broad import-readiness: timed out after roughly 5 minutes
- broad why-no-post: timed out after roughly 15 minutes

Conclusion:

- The broad reports need bounding or optimization before they become practical on this machine.
- Do not rerun those exact heavy commands immediately in the next chat.

## Follow-Up Completed After This Handoff

The first bounded-report optimization is now implemented.

New bounded option:

```text
--max-sessions <count>
```

Affected commands:

```powershell
npm run levels:calibrate -- --all-sessions --max-sessions 1 --max-symbols 5 --warehouse data\candles --output artifacts\support-resistance-calibration-smoke-max-sessions
npm run candles:import-readiness -- --all-sessions --max-sessions 1 --max-trades 5 --warehouse data\candles --out-dir artifacts\candle-import-readiness-smoke-max-sessions
npm run audit:why-no-post -- --all-sessions --max-sessions 1 --warehouse data\candles --out-dir artifacts\why-no-post-smoke-max-sessions
npm run candles:backfill-priority -- --all-sessions --max-sessions 1 --max-trades 5 --warehouse data\candles --out-dir artifacts\candle-backfill-priority-smoke-max-sessions --max-tasks-per-stage 5 --max-candles-per-stage 1000
```

Important implementation detail:

- `candles:backfill-priority` now passes the session cap into its composed subreports: import readiness, why-no-post proof, all-symbol stress, and support/resistance calibration.
- This matters because the first attempt still timed out until the hidden all-session subreport calls were capped.

Bounded smoke results:

```text
Support/resistance smoke: symbols=2, trusted=0, watch=0, broken=0, unproven=2, noForwardR=2, coverageGaps=6, gate=review
Import-readiness smoke: trade proxies=2, planned=8, covered=0, missing=8, missingCandles=2064
Why-no-post smoke: symbols=2, quietSupported=0, mayHide=0, runtimeSilence=0, missingCandles=2
Backfill-priority smoke: missing=8, fetchFirst=8, fetchNext=0, stages=3
```

Verification after the bounded-report work:

```text
focused report tests: 24 passing, 0 failing
accidental full npm test: 656 passing, 0 failing
npm run build: passing
git diff --check: clean
```

## Important Code Changes Already Made

### No-Bar / Sparse Candle Classification

The backfill planner now separates actionable missing candles from likely no-bar gaps.

Files:

```text
src/lib/candle-warehouse/bulk-backfill-planner.ts
src/lib/market-data/candle-session-classifier.ts
src/lib/review/candle-backfill-priority-report.ts
src/lib/review/candle-import-readiness-report.ts
src/tests/durable-candle-warehouse.test.ts
src/tests/candle-backfill-priority-report.test.ts
src/tests/candle-import-readiness-report.test.ts
```

Current behavior:

- `1m` / `5m` gaps outside 04:00-20:00 ET are likely no-bar/off-hours.
- Sparse intraday gaps inside already-covered candle spans are likely no-trade gaps.
- Daily weekend/pre-history gaps are likely no-bar/history-unavailable.
- `4h` non-session/pre-history gaps are likely no-bar/history-unavailable.
- Tail gaps after the latest stored candle remain actionable.

### Market-Structure Trust Tuning

File:

```text
src/lib/review/market-structure-calibration-report.ts
```

Current behavior:

- Stable market structure can be trusted for suppression with one bounded low-confidence replay case if repeat/chop evidence proves it is reducing noisy raw flips.
- It still keeps weak cases like `ABTS` and `XTLB` in watch when there is not enough repeat/chop evidence.

## Verification State Before Handoff

Before the final resource-heavy broad scans, verification was clean:

```text
targeted warehouse/backfill/structure tests: 22 passing, 0 failing
npm run build: passing
npm test: 653 passing, 0 failing
git diff --check: clean
```

After the final doc updates for this handoff, only a light `git diff --check` should be needed unless code changes are made in the next chat.

## Do Not Forget

The user specifically wants this next:

> Step 5 is a great idea as well so don't forget we will do this when you think it is a good time.

Step 5 means:

```text
Support/resistance quality calibration and forward-ladder improvement.
```

This is the next meaningful engineering target now that May 1 has no fetch-first/fetch-next gaps.

## Recommended Next Chat Plan

1. Do not rerun the old unbounded all-session commands.
2. Use `--max-sessions` plus existing caps like `--max-symbols`, `--max-trades`, `--max-tasks-per-stage`, and `--max-candles-per-stage` for small batches.
3. Consider adding deeper optimization later:
   - explicit session/date ranges
   - reuse precomputed support/resistance and structure outputs
   - avoid repeated expensive replay generation inside priority reports
4. Continue support/resistance quality work:
   - inspect all-session `broken` and `no-forward-resistance` cases
   - distinguish true level-engine defects from missing coverage/no-bar history
   - improve forward-ladder completeness checks
   - improve ranking proof for crowded practical zones
   - keep full ladder complete while trader-facing output groups practical zones
5. Update:
   - `docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md`
   - `docs/15_PROJECT_CHANGE_LOG.md`
   - this handoff file if work remains unfinished

## Suggested First Command In New Chat

Use light inspection first:

```powershell
git status --short
Get-Content docs\72_CANDLE_INTELLIGENCE_HANDOFF_FOR_NEW_CHAT_2026-05-03.md
Get-Content artifacts\support-resistance-calibration-all-sessions\support-resistance-calibration.json | Select-Object -First 20
```

Then avoid broad heavy commands until the report path is bounded or optimized.
