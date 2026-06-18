# Trader Intelligence Historical Backfill And As-Of Plan

Date: 2026-05-05

Consumer project:

`C:\Users\jerac\Documents\TraderLink\trader-intelligence-v2`

Provider project:

`C:\Users\jerac\Documents\TraderLink\levels-system`

## Purpose

`trader-intelligence-v2` imports completed historical trades from broker CSVs.
For each completed trade, it needs `levels-system` to return a historical
market-context snapshot that was available at the time of the trade, not a
snapshot based on today's date, today's current price, or live watchlist state.

This document consolidates the requested boundary and should be used instead of
piecemeal prompt text.

## Current Problem

The first-100 private IBKR calibration in `trader-intelligence-v2` completed
100 decision reviews, but many reviews fell back to execution-only movement or
had weak/no daily/4h level evidence.

Observed consumer-side symptoms:

- `trade_window_excursion_measured`: 100/100 reviews
- `execution_only_fallback`: 66/100 reviews
- `levels_system_trade_window`: 34/100 reviews
- weak/no daily/4h level evidence rows: 81/100
- extreme excursion metrics: 0 after consumer-side price-alignment guard

Interpretation:

- The consumer app can import, group, and review completed trades.
- The major remaining blocker is historical market-data/provider quality.
- `levels-system` needs reliable on-demand historical candle backfill and
  historical as-of support/resistance snapshots.

## Desired Public Boundary

`trader-intelligence-v2` should continue using the public package boundary:

```ts
import {
  buildDefaultTradeAnalysisCandleContext,
  buildTradeAnalysisCandleContext,
} from "levels-system-phase1/support-resistance-engine";
```

Recommended consumer call shape:

```ts
const context = await buildDefaultTradeAnalysisCandleContext({
  symbol,
  sessionDate,
  executions: [
    { timestamp, price, quantity, side },
  ],
  tradeStartTimestamp,
  tradeEndTimestamp,
  asOfTimestamp, // usually tradeEndTimestamp + postTradeMinutes + paddingMinutes
  tradeWindow: {
    timeframe: "1m",
    preTradeMinutes: 30,
    postTradeMinutes: 60,
    paddingMinutes: 5,
  },
});
```

## Required Historical Behavior

### 1. Build As-Of Historical Market Context

For completed historical trades, do not build support/resistance using today's
date or today's current stock price.

Build the market context as-of the relevant trade/execution timestamp.

For an April 8, 2026 trade, the answer should be:

"What daily/4h levels were visible to the trader around April 8, 2026?"

Not:

"What are this symbol's levels today?"

### 2. Fetch More Than The Execution Window For Daily/4h Levels

The 1m/5m trade window and the daily/4h structural lookback are separate jobs.

For 1m/5m:

- Fetch/cache candles around the trade window:
  - pre-trade window
  - hold window
  - post-trade window
- Prefer 1m.
- Fall back to 5m with explicit diagnostics.

For daily/4h support/resistance:

- Fetch/cache enough historical daily candles before the as-of date to build the
  full support/resistance ladder.
- Fetch/cache enough historical 4h candles before the as-of timestamp to build
  the 4h level ladder.
- Do not limit daily/4h fetching to only the minutes/hours around executions.

### 3. Avoid Future Leakage

Do not use future candles to judge historical decisions.

Entry relations:

- Use only candles/levels available before or at the entry timestamp.

Add relations:

- Use only candles/levels available before or at each add timestamp.

Exit relations:

- Use only candles/levels available before or at the exit timestamp.

Daily candles:

- For intraday trades, the full daily candle of the execution day usually
  includes future high/low/close. Do not use the completed execution-day daily
  candle to judge an entry unless it was complete before the execution.
- Prefer daily lookback ending at the last completed daily candle before the
  execution day for entry context.
- If partial current-day daily context is intentionally used, label it as
  partial and return diagnostics.

4h candles:

- Use completed 4h candles only unless partial 4h candle handling is explicit
  and diagnosed.

Swing trades:

- A multi-day or multi-week trade may need multiple as-of snapshots.
- The entry should not be judged using candles from the exit day if those
  candles were not available at entry.
- Execution relations should be computed per execution timestamp.

### 4. Use Historical Price As The Relevance Anchor

Support/resistance relevance should be anchored to the historical trade price or
historical as-of price, not today's current stock price.

If a symbol traded at `$0.70` during the historical trade and trades at `$5.00`
today, levels around `$5.00` should not dominate the historical review.

### 5. On-Demand Backfill And Cache

When `trader-intelligence-v2` requests a symbol/trade window:

1. Check local candle storage/cache.
2. Determine which daily, 4h, 1m, and fallback 5m candles are missing.
3. Fetch missing historical candles from the configured provider.
4. Store fetched candles.
5. Build the context from stored/fetched candles.
6. Return diagnostics describing cache hits, fetches, fallbacks, missing data,
   stale data, provider failures, or incomplete windows.

This should allow the consumer app to trigger historical data preparation by
requesting trade context for a specific imported trade.

## Required Response Shape

The context returned to `trader-intelligence-v2` should include:

- `supportResistanceContext`
- `tradeWindow.timeframe`
- `tradeWindow.requestedTimeframe`
- `tradeWindow.fallbackUsed`
- `tradeWindow.allCandles`
- `tradeWindow.preTradeCandles`
- `tradeWindow.tradeCandles`
- `tradeWindow.postTradeCandles`
- `tradeWindow.dynamicLevels`
- `tradeWindowFacts`
- `executionRelations`
- `marketFacts`
- `diagnostics`

Support/resistance levels should include existing grade/strength fields where
available:

- strength bucket or label, such as weak/moderate/strong/major
- score
- timeframe sources
- nearest support/resistance per execution when available

## Consumer Boundary Reminder

`trader-intelligence-v2` does not compute:

- support/resistance
- VWAP
- EMA
- market structure
- candle storage
- candle provider fetching

It consumes neutral facts returned by `levels-system` and combines them with:

- broker CSV import
- execution grouping
- P/L
- sizing
- journal/review UI
- trader-facing coaching

For now, `trader-intelligence-v2` does not use VWAP/EMA for trader coaching,
even if dynamic levels are returned.

## Diagnostics Required

Return explicit diagnostics for:

- 1m unavailable and 5m fallback used
- 1m/5m candles missing
- no pre-trade candles
- no post-trade candles
- stale candles
- suspicious gaps
- provider failure
- cache hit vs fresh fetch, if available
- adjusted-price or split mismatch suspicion, if detectable
- partial current-day daily candle usage
- partial current 4h candle usage
- historical as-of snapshot built successfully

## Known Risk Areas

### Splits And Adjusted Prices

Small caps often reverse split. Broker executions and provider candles may use
different adjusted/unadjusted price bases.

If candle prices are disconnected from execution prices, the consumer app will
ignore trade-window candles and fall back to execution-only movement. Ideally,
`levels-system` should detect and diagnose likely adjustment mismatches.

### Delisted Or Renamed Symbols

Historical small-cap symbols may be delisted or renamed. Provider fetches may
fail unless the data layer can map historical symbols.

### Extended Hours

Many small-cap trades happen premarket or after hours. Trade-window candles must
include extended-hours data when executions are outside regular market hours,
or diagnostics must say the window is incomplete.

### Provider Rate Limits

CSV imports may contain hundreds of grouped trades. Backfill should batch,
deduplicate, and cache requests so one import does not hammer the provider.

## Acceptance Criteria

After this is implemented in `levels-system`, rerun in `trader-intelligence-v2`:

```bash
npm run calibrate:decision-review -- --csv=artifacts/real-csv-calibration/private/<private-ibkr-file>.csv --broker=ibkr_activity_statement --account-timezone=America/Toronto --max-trades=100 --generated-at=2026-05-05T12:00:00.000Z --json --out=artifacts/real-csv-calibration/private/ibkr-april-first-100-calibration.json --no-history
npx tsx src/scripts/summarize-decision-review-calibration.ts --json=artifacts/real-csv-calibration/private/ibkr-april-first-100-calibration.json --out=artifacts/real-csv-calibration/private/ibkr-april-first-100-summary.md
```

Expected improvement:

- lower `execution_only_fallback` count
- lower weak/no daily/4h level evidence count
- `trade_window_excursion_measured` remains present
- extreme excursion metrics remain zero
- market-specific coaching headlines increase when valid daily/4h context is
  available

## Suggested Implementation Order

1. Audit current `buildDefaultTradeAnalysisCandleContext(...)` behavior for
   historical as-of handling.
2. Confirm daily/4h support/resistance lookback ends at the historical as-of
   timestamp, not now.
3. Confirm level relevance uses execution/as-of price, not today's current
   price.
4. Add on-demand candle-cache/backfill planning for daily, 4h, 1m, and 5m.
5. Add provider diagnostics for missing, stale, partial, fallback, adjusted, and
   extended-hours data.
6. Add tests for:
   - no future leakage on entry-day daily candles
   - 4h as-of cutoff
   - 1m preferred and 5m fallback
   - split/adjustment mismatch diagnostics if detectable
   - swing trade with multiple execution as-of relations
7. Rerun `trader-intelligence-v2` first-100 calibration and compare counts.

## Provider-Side Update - 2026-05-05

Status: implemented in `levels-system`; consumer rerun still needed in
`trader-intelligence-v2`.

Files changed:

- `src/lib/support-resistance/symbol-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/support-resistance-shared-api.test.ts`

What changed:

- Added timeframe-specific as-of support to
  `buildSupportResistanceContextForSymbol(...)` via
  `asOfTimestampByTimeframe`.
- Trade-analysis support/resistance snapshots now use closed higher-timeframe
  cutoffs:
  - daily context ends before the trade session, so same-day daily high/low/close
    does not leak into entry/exit review.
  - 4h context ends at the last completed 4h window before the snapshot or
    execution timestamp.
  - 5m context can still run through the as-of timestamp for intraday/dynamic
    context.
- Per-execution support/resistance contexts now pass:
  - execution timestamp as the snapshot timestamp
  - closed daily/4h cutoffs for that execution
  - execution price as the relevance anchor when available
- The outer trade-analysis support/resistance snapshot now uses the first valid
  historical execution price at/before `asOfTimestamp` as `currentPrice`, so
  historical levels are ranked around the trade price instead of today's price.
- Execution relation facts now use the execution-time support/resistance context
  for market-structure state/confidence when that context is available.
- Added diagnostics returned in `context.diagnostics`:
  - `historical_as_of_snapshot_built`
  - `historical_higher_timeframe_closed_candle_cutoff`
  - `historical_price_anchor_used`
  - `possible_price_adjustment_mismatch`
- Added a split/adjustment mismatch guard: if execution price and nearby
  trade-window candle close are disconnected by roughly 3x or more, the context
  returns `possible_price_adjustment_mismatch`.

Verification run:

```powershell
npx tsx --test src\tests\support-resistance-shared-api.test.ts
npx tsc --noEmit --pretty false
```

Result:

- Focused shared API tests passed: 22/22.
- TypeScript passed.

Notes for the other Codex working in `trader-intelligence-v2`:

- Keep calling the existing public boundary:

```ts
buildDefaultTradeAnalysisCandleContext({
  symbol,
  sessionDate,
  executions,
  tradeStartTimestamp,
  tradeEndTimestamp,
  asOfTimestamp,
  tradeWindow: {
    timeframe: "1m",
    preTradeMinutes: 30,
    postTradeMinutes: 60,
    paddingMinutes: 5,
  },
});
```

- After pulling/building this provider change, rerun the first-100 calibration
  and compare:
  - `execution_only_fallback`
  - `levels_system_trade_window`
  - weak/no daily/4h evidence rows
  - extreme excursion metrics
- Check `context.diagnostics` for:
  - 1m fallback to 5m
  - missing pre/trade/post candles
  - historical as-of snapshot success
  - daily/4h closed-candle cutoff
  - historical price anchor
  - possible split/adjustment mismatch

Open follow-up:

- If the consumer still sees many execution-only fallbacks, inspect whether
  `possible_price_adjustment_mismatch` is present. That would point to
  adjusted/unadjusted candle basis or historical symbol mapping, not level
  quality.

## Provider-Side Diagnostic Update - 2026-05-05

Status: diagnostic-only improvement implemented in `levels-system`; it does
not alter fetched candle data, support/resistance calculation, watchlist
behavior, or warehouse storage.

Files changed:

- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/support-resistance-shared-api.test.ts`

What changed:

- `possible_price_adjustment_mismatch` now also considers execution-to-nearest
  trade-window candle OHLC distance, not only the as-of execution-price to
  candle-close ratio.
- The diagnostic fires when the largest execution/candle distance exceeds
  `60%`, matching the consumer guard that rejects trade-window candles for
  trader review.
- The diagnostic message now includes:
  - historical execution/as-of price
  - nearby as-of candle close and ratio when available
  - largest execution/candle distance
  - execution timestamp
  - nearest candle timestamp and OHLC
  - likely issue families: split/adjustment, stale cache, extended-hours, or
    symbol mapping mismatch

Verification run:

```powershell
npx tsx --test src\tests\support-resistance-shared-api.test.ts
npx tsc --noEmit --pretty false
npm run build
```

Result:

- Focused shared API tests passed: 23/23.
- TypeScript passed.
- Package `dist/` was rebuilt for the consumer file dependency.

Consumer rerun after refreshing `trader-intelligence-v2` showed:

- `execution_only_fallback`: `66 -> 67`
- `levels_system_trade_window`: `34 -> 33`
- weak/no daily/4h evidence rows: `81 -> 81`
- missing trade-window excursion insights: `0 -> 0`
- extreme excursion metrics: `0 -> 0`
- fallback/generic headlines: `0 -> 0`

The diagnostic artifact exposed `62` detailed price-disconnect notes:

- `41` had ratio `>= 3x`
- `21` had ratio `< 3x` but still exceeded the consumer's `60%` candle-distance
  guard
- largest examples included `ISPC` around `27x-36x`, `VEEE` around `23x`,
  `SOAR` around `16x-18x`, and multiple `UCAR`/`AGAE`/`IMMP`/`DGNX` rows
  above `5x`

Interpretation:

- The remaining fallback problem is not solved by as-of cutoffs alone.
- The next provider-side investigation should inspect candle basis and cache
  provenance for fallback-heavy symbols, especially whether stored/provider
  candles are adjusted while broker executions are raw, whether historical
  symbol mappings are wrong, or whether stale cache rows are being reused.

## Consumer-Side Stub Guard Finding - 2026-05-05

Follow-up inspection from `trader-intelligence-v2` found a more basic provider
configuration issue:

- `levels-system` provider factory can fall through to deterministic `stub`
  data when no IBKR client is supplied.
- A sample `ISPC` April 16 trade-window diagnostic referenced intraday candles,
  but the `ibkr` warehouse had no `1m` or `5m` file for `ISPC` on that date.
- This means the consumer's previous first-100 private calibration was partly
  counting deterministic stub candles and stub daily/4h levels as if they were
  usable market data.

Consumer guard added:

- `trader-intelligence-v2` now rejects implicit default `stub` provider output
  for production-style imported-trade analysis.
- Explicit test/custom fetch services can still use stub data for deterministic
  fixtures.
- When implicit stub is detected, the consumer does not attach trade-window
  facts, support/resistance levels, execution-level relations, or market facts
  to trader-facing review.

Corrected consumer rerun:

- market context source: `none=100`
- trade-window evidence: `execution_only_fallback=100`
- stub-warning rows: `100`
- detailed price-mismatch rows: `62`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Provider implication:

- The next acceptance test should be run only after a real historical provider
  is configured for the consumer path or after the relevant historical candles
  are truly backfilled into the warehouse.
- `levels-system` may still keep deterministic stub behavior for tests and
  offline demos, but real imported-trade review needs an explicit non-stub
  provider/backfill path and diagnostics when no real provider is available.

Important provider constraint from the user:

- Assume the real provider path is IBKR plus the `data/candles` warehouse only.
- Prevent silent stub fallback for real trade-analysis requests.
- Verify/backfill IBKR warehouse candles for the fallback-heavy symbols.
- Return diagnostics when IBKR or warehouse data is unavailable.

## Provider-Side IBKR Warehouse Guard Update - 2026-05-05

Status: implemented in `levels-system`; consumer rerun still needed after
refreshing the package build in `trader-intelligence-v2`.

Reason:

- The real imported-trade review path should be IBKR plus the
  `data/candles` warehouse.
- Deterministic stub candles must remain available for explicit tests/fixtures,
  but default imported-trade analysis must not silently synthesize stub market
  data.

Files changed:

- `src/lib/support-resistance/warehouse-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/support-resistance-shared-api.test.ts`

What changed:

- Warehouse-backed default trade-analysis calls without an explicit provider now
  default to:
  - `preferredProvider: "ibkr"`
  - warehouse mode `replay`
- In that default path, an empty/missing IBKR warehouse range now raises an
  explicit durable warehouse miss instead of falling through to deterministic
  stub candles.
- Explicit test/custom providers still work. Existing focused tests continue to
  use deterministic stub providers only when a test passes a custom provider
  object.
- Direct `buildTradeAnalysisCandleContext(...)` calls with no explicit provider
  and no `fetchService` now follow the same warehouse replay guard.

Verification run:

```powershell
npx tsx --test src\tests\support-resistance-shared-api.test.ts
npx tsc --noEmit --pretty false
npm run build
```

Result:

- Focused shared API tests passed: 24/24.
- TypeScript passed.
- Package `dist/` was rebuilt for the consumer dependency.

New regression test:

- `default trade analysis context does not synthesize stub candles without an explicit provider`

Expected consumer behavior after refresh:

- If IBKR warehouse data is present for the requested symbol/window, the
  consumer should receive real IBKR-backed context.
- If IBKR warehouse data is missing and no IBKR client-backed fetch service is
  configured, the provider should fail with an explicit warehouse miss. The
  consumer should treat that as missing real market context, not as usable
  stub-derived evidence.

Next provider-side step:

- Use the fallback-heavy symbol/date list from `trader-intelligence-v2` to check
  actual `data/candles/ibkr` coverage for daily, 4h, 1m, and 5m windows.
- Backfill missing IBKR candles where a real IBKR connection is available.
- Rerun the first-100 consumer calibration only after the warehouse has real
  candles for the requested windows.

## Consumer Rerun After IBKR Warehouse Guard - 2026-05-05

Status: rerun completed in `trader-intelligence-v2`; provider backfill still
needed in `levels-system`.

Consumer setup:

- Ran `npm install` in `trader-intelligence-v2` to refresh the rebuilt
  `levels-system-phase1` file dependency.
- Confirmed installed `dist` uses default `preferredProvider: "ibkr"` and
  default warehouse mode `replay` when no explicit provider is supplied.

Rerun result:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `0`
- analysis failures: `100`
- open skipped trades: `2`
- all analysis failures were explicit durable warehouse misses for IBKR `5m`
  ranges
- deterministic stub fallback was successfully prevented

Consumer artifacts:

- `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-ibkr-warehouse-guard.json`
- `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-ibkr-warehouse-guard-readiness.md`
- `artifacts/real-csv-calibration/private/ibkr-april-first-100-stub-guard-vs-ibkr-warehouse-guard-comparison.md`

Top missing IBKR `5m` warehouse needs from the capped first-100:

- `CYCN`: `12` ranges / `1625` expected 5m candles
- `OMEX`: `9` ranges / `850` expected 5m candles
- `MYSE`: `7` ranges / `862` expected 5m candles
- `ONCO`: `6` ranges / `424` expected 5m candles
- `ELAB`: `5` ranges / `347` expected 5m candles
- `LNKS`: `4` ranges / `355` expected 5m candles
- `RCT`: `4` ranges / `347` expected 5m candles
- `SKYQ`: `4` ranges / `364` expected 5m candles
- `UCAR`: `4` ranges / `365` expected 5m candles
- `SIDU`: `1` range / `1823` expected 5m candles
- `ISPC`: `2` ranges / `556` expected 5m candles
- `VEEE`: `1` range / `306` expected 5m candles
- `SPCE`: `1` range / `384` expected 5m candles

Total capped first-100 missing `5m` estimate:

- `100` failed ranges
- `12030` expected `5m` candles

Provider implication:

- The default guard is working correctly; the next blocker is actual IBKR
  warehouse coverage.
- Backfill/check the listed IBKR `5m` ranges first, then confirm daily/4h
  support/resistance lookback coverage for the same symbols and historical
  as-of windows.
- After backfill, rerun the first-100 consumer calibration and expect completed
  review count to rise above `0` without any stub-derived market evidence.

## Non-Blocking Level QA Sidecar - 2026-05-05

While IBKR backfill work is active, the provider repo did a read-only
level-quality QA pass against already-saved IBKR `5m` candles. No backfill
scripts, provider wiring, or live API calls were touched.

Result for coordination:

- `HOWL` 0.73 is sparse after-hours tape; no provider/backfill action implied.
- `EFOI` 3.85 and `SKYQ` 7.00 look like real levels that were tested/consumed;
  this is a reporting-classifier issue, not a warehouse provider issue.
- `SKLZ` 8.08 is choppy premarket two-way tape; no broad scoring change from it.
- `SKLZ` 3.42 remains the only clear level-strength calibration example from
  this five-target pass.

Detailed notes are in
`docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`.

Provider-side level QA update:

- The non-blocking level-quality classifier refinements were implemented in
  `levels-system`.
- This did not touch IBKR backfill, provider wiring, warehouse storage,
  Discord output, or the trader-intelligence consumer boundary.
- Fresh artifacts are available under
  `artifacts/level-quality-detection-300-expanded-classifier-refined*`.
- The only target still requiring manual raw-candle review in the refined
  stress set is `SKLZ` 8.08 in the 8h report.

## IBKR Warehouse Backfill Execution - 2026-05-05

Status: first capped consumer calibration now completes on real IBKR warehouse
data for all non-`MAXN` selected trades.

Provider-side changes made during the pass:

- `BulkCandleBackfillTradeInput` now accepts `startTimestamp`, allowing
  priority-report-driven work to preserve long historical trade windows instead
  of defaulting every task to the standard lookback size.
- Priority-report trade inputs now pass `startTimestamp` through to the planner.
- Durable warehouse replay now returns a `partial_hit` when real stored candles
  exist but the provider has no bar for every theoretical interval. Empty
  ranges still throw explicit durable warehouse misses.

Backfill execution:

- Trader consumer generated an IBKR `5m` manifest from the first-100 calibration
  failures: `100` failed trade ranges, `35` symbols, `12030` expected theoretical
  `5m` slots.
- `5m` dry-run after range preservation planned `47` symbol/session ranges and
  `5987` actionable missing candle slots after likely no-bar/off-hours gaps were
  excluded.
- `5m` execute result: `47` attempted, `46` fetched, `1` failed, `6783` candles
  stored.
- Daily/4h execute result: `63` attempted, `61` fetched, `2` failed, `71629`
  candles stored.

Remaining provider failure:

- `MAXN` failed for `5m`, daily, and 4h with IBKR code `200`: no security
  definition found for the request.
- This needs symbol mapping/contract qualification review before the final two
  consumer trades can complete.

Consumer rerun after backfill:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `98`
- remaining analysis failures: `2`, both `MAXN` durable warehouse misses
- market context: `levels_system_daily_4h=98`
- trade-window evidence: `levels_system_trade_window=78`,
  `execution_only_fallback=20`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Consumer configuration used for replay:

```powershell
$env:LEVELS_SYSTEM_WAREHOUSE_DIRECTORY='C:\Users\jerac\Documents\TraderLink\levels-system\data\candles'
$env:LEVELS_SYSTEM_WAREHOUSE_MODE='replay'
```

Verification:

- `npx tsx --test src\tests\support-resistance-shared-api.test.ts` passed:
  `24/24`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.

Follow-up:

- Fix the backfill report runner so priority task selection preserves
  per-timeframe ranges. The daily/4h pass over-expanded 4h lookbacks because
  selected priority tasks are currently merged by symbol/session before the
  timeframe-specific planner step.
- Resolve `MAXN` IBKR contract lookup or add a validated symbol mapping.

## MAXN Alias And First-100 Completion - 2026-05-05

Status: the capped Trader Intelligence first-100 replay now completes on real
IBKR warehouse data.

Provider-side changes made after the first backfill pass:

- Fixed `runCandleWarehouseBackfillReport` priority execution so selected tasks
  are executed per timeframe and merged afterward. This preserves
  timeframe-specific ranges and avoids daily lookbacks widening unrelated `4h`
  work.
- Added a regression test proving priority backfill reports preserve separate
  daily and `4h` ranges.
- Qualified the former `MAXN` trade symbol through IBKR matching symbols and
  added a historical contract alias to the current `MAXNQ` SMART contract
  (`conId=733975592`). IBKR reported the resolved listing with primary exchange
  `PINK`, so this is treated as a post-delisting/symbol-change mapping for
  historical fetches. The provider still returns/stores candles under requested
  symbol `MAXN`, with resolved contract metadata included for diagnostics.
- Backfilled the remaining `MAXN` `5m`, daily, and `4h` ranges successfully.

Final capped consumer rerun:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `100`
- diagnostics: `3`
- open skipped trades: `2`
- analysis failures: `0`
- market context: `levels_system_daily_4h=100`
- trade-window evidence: `levels_system_trade_window=80`,
  `execution_only_fallback=20`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Final consumer artifacts:

- `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-maxn-contract-fix.json`
- `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-maxn-contract-fix-readiness.md`

Verification:

- `npx tsx --test src\tests\ibkr-historical-candle-provider.test.ts src\tests\candle-warehouse-backfill-report.test.ts` passed: `11/11`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- In the consumer repo, focused Vitest replay/bridge tests passed: `19/19`.
- In the consumer repo, `npx tsc --noEmit --pretty false` passed.

Next branch:

- Completion blockers are cleared for this capped run. The next provider-facing
  branch is to inspect the `20` execution-only trade-window fallbacks and `14`
  weak/no daily/4h evidence rows, then decide whether they are true historical
  no-bar cases, range/session planning gaps, or level-evidence calibration
  issues.

## Delisted/PINK Alias Fail-Safe - 2026-05-05

Status: implemented in `levels-system`.

Reason:

- `MAXN` proved that some imported trades may reference a former Nasdaq symbol
  whose current IBKR contract resolves under a post-delisting or renamed symbol
  such as `MAXNQ` on `PINK`.
- The system should review those trades when real historical candles can be
  fetched, but it must make the alias/PINK path explicit to the consumer app.
- When IBKR cannot resolve a symbol and no validated alias exists, the failure
  should point to symbol mapping/contract qualification instead of silently
  falling back or producing vague provider failure text.

Files changed:

- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/candle-warehouse/durable-candle-warehouse.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/ibkr-historical-candle-provider.test.ts`
- `src/tests/durable-candle-warehouse.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

What changed:

- The IBKR historical provider now emits explicit metadata when a validated
  historical contract alias is used:
  - requested symbol
  - resolved symbol
  - resolved conId
  - resolved exchange
  - resolved primary exchange, including `PINK`
  - alias-used flag
  - alias reason
- Durable warehouse replay now reconstructs known IBKR alias metadata from the
  requested symbol, so the diagnostics survive after candles are backfilled and
  replayed from disk.
- Trade-analysis diagnostics now include:
  - `historical_symbol_alias_used`
  - `historical_symbol_resolved_to_pink`
- IBKR code `200` failures for unmapped symbols now include guidance that a
  validated historical alias may be required for renamed, delisted, or
  OTC/PINK symbols.

Consumer policy recommendation:

- If alias diagnostics are present and candles align with executions, give
  normal trade feedback with a quiet data-quality note.
- If `historical_symbol_resolved_to_pink` is present, label the review as using
  a delisted/renamed or OTC/PINK historical data path.
- If no candles can be fetched and no validated alias exists, provide
  execution-only feedback and tell the user market data was unavailable for the
  delisted/renamed symbol.

Scope guard:

- Do not build a broad delisted-symbol discovery feature right now.
- Do not spend open-ended engineering time hunting renamed/delisted tickers.
- Only add a historical alias when it can be validated quickly through the same
  IBKR provider/contract workflow already being used for candle backfill.
- Otherwise, fail clearly and let the consumer produce execution/P&L-only
  feedback with a market-data-unavailable note.
- The consumer should continue requesting the broker/import symbol. It should
  not guess replacement tickers such as `MAXNQ`; aliasing remains a
  provider-side concern when a small validated mapping exists.

Verification:

```powershell
npx tsx --test src\tests\ibkr-historical-candle-provider.test.ts src\tests\durable-candle-warehouse.test.ts src\tests\support-resistance-shared-api.test.ts
npx tsc --noEmit --pretty false
```

Result:

- Focused tests passed: `49/49`.
- TypeScript passed.

## 1m Trade-Window Fallback Backfill - 2026-05-05

Status: the first quality pass after completion reduced capped first-100
execution-only fallbacks from `20` to `10`.

Provider-side work:

- Created a narrow Trader Intelligence `1m` priority report for the `20`
  execution-only fallback reviews.
- Dry-run collapsed those rows into `17` symbol/session tasks and about `8,690`
  missing one-minute slots.
- Executed the IBKR `1m` backfill: `17` planned, `17` fetched, `0` failed.

Consumer rerun after `1m` backfill:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `100`
- diagnostics: `3`
- open skipped trades: `2`
- analysis failures: `0`
- market context: `levels_system_daily_4h=100`
- trade-window evidence: `levels_system_trade_window=90`,
  `execution_only_fallback=10`
- candle-quality note rows: `57`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Remaining fallback classification:

- Price-basis/symbol-adjustment disconnects: `VEEE`, `ISPC` x2, `DGNX` x2.
  The 1m warehouse now has candles near the executions, but those candles are on
  a different price basis than the broker execution prices, so the trader app
  correctly rejects them for trade-window evidence.
- No candle inside the exact hold interval after 1m replay: `OMEX` x2,
  `GLMD` x2, `RCT` x1. These have nearby pre/post candles but zero candles
  counted during the actual hold, so they remain execution-only for in-trade
  excursion.

Artifacts:

- `artifacts/trader-intelligence/ibkr-april-first-100-execution-fallback-1m-priority-report.json`
- `artifacts/trader-intelligence/ibkr-april-first-100-execution-fallback-1m-dry-run/candle-warehouse-backfill.md`
- `artifacts/trader-intelligence/ibkr-april-first-100-execution-fallback-1m-execute/candle-warehouse-backfill.md`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-1m-fallback-backfill.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-1m-fallback-backfill-readiness.md`

Next branch:

- Do not bulk-fetch more candles blindly for these `10`. Separate them:
  provider/corporate-action price-basis review for `VEEE`, `ISPC`, and `DGNX`;
  exact trade-window boundary/nearest-minute handling for short-hold `OMEX`,
  `GLMD`, and `RCT` rows.

## Delisted Alias Policy And Short-Hold Overlap Fix - 2026-05-05

Delisted/renamed symbol policy confirmed with the consumer:

- Keep a small validated alias table, currently `MAXN -> MAXNQ`.
- Do not build a broad alias-discovery system.
- If IBKR quickly resolves a high-value blocking replay through normal provider
  diagnostics, add a small explicit alias.
- If it does not, fail cleanly with execution/P&L-only review and an
  unavailable-market-data diagnostic for the renamed or delisted symbol.
- Trader Intelligence should not need to know the new ticker and should not run
  a separate research workflow for delisted symbols.

Provider-side short-hold fix:

- Trade-window partitioning now treats intraday candle timestamps as interval
  starts and counts a candle as in-trade when the candle interval overlaps the
  imported hold interval.
- This fixes short holds where the one-minute candle starts before the first
  fill but still covers the hold.
- Added a regression test for an ultra-short hold where the candle timestamp is
  before `tradeStartTimestamp` but the candle interval overlaps the trade.

Consumer rerun after rebuild/reinstall:

- completed reviews: `100`
- market context: `levels_system_daily_4h=100`
- trade-window evidence: `levels_system_trade_window=92`,
  `execution_only_fallback=8`
- candle-quality note rows: `57`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Remaining fallback split:

- Price-basis/symbol-adjustment disconnects: `VEEE`, `ISPC` x2, `DGNX` x2.
- Remaining short-hold warehouse gaps: `OMEX` x2 and `GLMD` x1.

Queued short-hold follow-up:

- Built a priority report for the remaining non-price-disconnect short-hold
  gaps.
- Dry-run planned `2` safe-to-fetch ranges:
  - `OMEX 1m`: `2026-04-08T14:38:00.000Z` to
    `2026-04-08T17:18:00.000Z`
  - `GLMD 1m`: `2026-04-09T13:01:00.000Z` to
    `2026-04-09T15:30:00.000Z`
- Execute was blocked because IBKR/TWS was unavailable:
  `connect ECONNREFUSED 127.0.0.1:7497`.

Artifacts:

- `artifacts/trader-intelligence/ibkr-april-first-100-remaining-short-hold-1m-priority-report.json`
- `artifacts/trader-intelligence/ibkr-april-first-100-remaining-short-hold-1m-dry-run/candle-warehouse-backfill.md`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-overlap-window-fix.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-overlap-window-fix-readiness.md`

Verification:

- `npx tsx --test src\tests\support-resistance-shared-api.test.ts` passed:
  `26/26`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- Consumer focused bridge/replay Vitest passed: `20/20`.
- Consumer TypeScript passed.

Next branch:

- When IBKR/TWS is running again, execute the queued short-hold `1m` backfill,
  rerun the capped first-100 calibration, and then focus only on the remaining
  price-basis disconnects (`VEEE`, `ISPC`, `DGNX`).

## Remaining Short-Hold Backfill Completed - 2026-05-05

Status: completed after IBKR/TWS came back online.

Provider-side work:

- Executed the queued Trader Intelligence short-hold `1m` priority backfill.
- Result: `2` planned ranges, `2` attempted, `2` fetched, `0` failed.
- The fetched ranges were:
  - `OMEX 1m`: `2026-04-08T14:38:00.000Z` to
    `2026-04-08T17:18:00.000Z`
  - `GLMD 1m`: `2026-04-09T13:01:00.000Z` to
    `2026-04-09T15:30:00.000Z`

Consumer rerun after remaining short-hold backfill:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `100`
- diagnostics: `3`
- open skipped trades: `2`
- market context: `levels_system_daily_4h=100`
- trade-window evidence: `levels_system_trade_window=95`,
  `execution_only_fallback=5`
- candle-quality note rows: `54`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Remaining fallback classification:

- Short-hold warehouse gaps are cleared.
- The only remaining execution-only fallbacks are price-basis/symbol-adjustment
  disconnects: `VEEE` x1, `ISPC` x2, and `DGNX` x2.
- These rows have nearby warehouse candles, but the prices are disconnected
  from broker execution prices by more than the consumer's `60%` guard.

Artifacts:

- `artifacts/trader-intelligence/ibkr-april-first-100-remaining-short-hold-1m-execute/candle-warehouse-backfill.md`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-remaining-short-hold-backfill.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-remaining-short-hold-backfill-readiness.md`

Consumer verification:

- Focused bridge/replay Vitest passed: `20/20`.
- Consumer TypeScript passed.

Next branch:

- Do not bulk-fetch more candles for the remaining `5`.
- Investigate only the price-basis/corporate-action path for `VEEE`, `ISPC`,
  and `DGNX`.
- Preserve the confirmed delisted/renamed-symbol policy: keep only the small
  validated alias table such as `MAXN -> MAXNQ`; do not build broad alias
  discovery; if IBKR cannot quickly align a blocking replay through the normal
  provider workflow, fail clearly and let the consumer produce execution/P&L-only
  feedback with a market-data-unavailable note.

## Price-Basis Diagnostic Sharpened - 2026-05-05

Status: implemented, rebuilt, refreshed in the consumer, and rerun against the
capped first-100 private IBKR calibration.

Provider-side work:

- Added `likely_price_basis_adjustment_multiple` to trade-analysis diagnostics.
- The diagnostic fires only when execution prices and warehouse candles look
  close to a whole-number adjustment multiple.
- The existing `possible_price_adjustment_mismatch` warning remains the broader
  catch-all for split/adjustment, stale cache, extended-hours, or symbol mapping
  mismatch.

Consumer-side work:

- Trader Intelligence now preserves price-basis and adjustment-multiple
  diagnostics in review `candleQualityNotes`.
- `levels-system` was rebuilt and the local file dependency was refreshed in
  the consumer app.

Consumer rerun:

- requested trades: `208`
- analyzable cap: `100`
- completed reviews: `100`
- diagnostics: `3`
- open skipped trades: `2`
- market context: `levels_system_daily_4h=100`
- trade-window evidence: `levels_system_trade_window=95`,
  `execution_only_fallback=5`
- candle-quality note rows: `54`
- weak/no daily/4h evidence rows: `14`
- missing trade-window excursion insights: `0`
- extreme excursion metrics: `0`
- fallback/generic headlines: `0`

Remaining five fallbacks now identify likely price-basis multiples:

- `VEEE`: near `38:1`
- `ISPC`: near `41:1` and `40:1`
- `DGNX`: near `8:1` on both rows

Provenance note from file/provider inspection:

- The IBKR provider requests `WhatToShow.TRADES`.
- The warehouse rows are currently written with `adjustmentMode: "raw"`.
- The remaining fallback ratios show that this label is not sufficient as a
  consumer safety guarantee. For these symbols, provider-returned candles and
  broker execution prices still appear to be on different bases, so the
  consumer should keep rejecting trade-window candles until basis alignment is
  proven.

Artifacts:

- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-price-basis-diagnostic.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-price-basis-diagnostic-readiness.md`

Verification:

- `npx tsx --test src\tests\support-resistance-shared-api.test.ts` passed:
  `26/26`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- Consumer bridge Vitest passed: `15/15`.
- Consumer TypeScript passed.

Everything still needed from `levels-system` for Trader Intelligence:

- Keep the real provider contract on IBKR plus `data/candles` warehouse replay;
  no silent stub fallback for real imported-trade review.
- Own all support/resistance, VWAP/EMA calculation, candle storage, and
  provider fetching. The consumer should continue consuming neutral facts only.
- Continue returning historical daily/4h as-of levels without future leakage.
- Continue returning `1m` preferred, `5m` explicit fallback trade-window facts.
- Keep provider/warehouse diagnostics specific enough for the consumer to say
  whether candles are missing, stale, fallback-only, alias/PINK, or price-basis
  mismatched.
- Keep alias handling narrow and validated; do not add broad delisted ticker
  discovery.
- Decide the next price-basis policy for `VEEE`, `ISPC`, and `DGNX`: either
  provide warehouse candles on the same raw/adjusted basis as broker executions,
  or keep returning explicit execution/P&L-only fallback diagnostics.

Next branch:

- Investigate raw-vs-adjusted candle provenance for `VEEE`, `ISPC`, and
  `DGNX`. Do not bulk-fetch more candles until the basis policy is clear.

## Price-Basis Policy Diagnostic - 2026-05-05

Status: implemented as a first-class diagnostic hook after coordination with
the consumer app.

Policy confirmed:

- Continue targeted price-basis policy work for `VEEE`, `ISPC`, and `DGNX`.
- Do not bulk-fetch more candles.
- Treat remaining fallbacks as basis-mismatch cases unless raw IBKR candle basis
  can be proven aligned to broker execution prices.

Provider-side implementation:

- Added `trade_window_price_basis_unverified`.
- The diagnostic is emitted only when the broader price-disconnect warning also
  looks like a likely whole-number price-basis adjustment multiple.
- Generic >60% execution/candle disconnects still get
  `possible_price_adjustment_mismatch`, but not the stricter policy diagnostic
  unless an adjustment multiple is detected.

Consumer verification:

- Trader Intelligence preserves the policy note in `candleQualityNotes`.
- The capped first-100 rerun still has:
  - `levels_system_trade_window=95`
  - `execution_only_fallback=5`
- All five remaining fallback rows now include:
  "Price-basis policy: treat these trade-window candles as unavailable for
  Trader Intelligence unless raw IBKR candle basis is proven aligned to broker
  execution prices."

Artifacts:

- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-price-basis-policy.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-first-100-after-price-basis-policy-readiness.md`

Verification:

- `npx tsx --test src\tests\support-resistance-shared-api.test.ts` passed:
  `26/26`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.
- Consumer bridge Vitest passed: `15/15`.
- Consumer TypeScript passed.

Next branch:

- Either prove an IBKR raw candle basis that matches the broker execution prices
  for `VEEE`, `ISPC`, and `DGNX`, or accept these five as execution/P&L-only
  reviews and expand calibration beyond the capped first 100.

## All-Eligible Expansion Backfill - 2026-05-05

Status: completed targeted provider backfill for all eligible completed trades.

Consumer policy decision before expansion:

- The capped first-100 price-basis rows are treated as intentional
  execution/P&L-only unless raw IBKR candle basis is later proven aligned to
  broker execution prices.
- No broad candle fetching or alias discovery was used for those price-basis
  rows.

All-eligible baseline after accepting the price-basis policy:

- requested trades: `208`
- analyzable completed trades: `206`
- completed reviews: `117`
- analysis failures: `89`
- failure family: missing `5m` warehouse candles for later import rows

Provider-side `5m` backfill:

- Built a targeted priority report from the all-eligible calibration failures.
- Executed IBKR warehouse backfill:
  - planned: `39`
  - attempted: `39`
  - fetched: `39`
  - failed: `0`

Consumer rerun after `5m`:

- completed reviews: `154`
- remaining analysis failures: `52`
- failure family: daily/4h candles required for support/resistance context

Provider-side daily/4h backfill:

- Consumer added a targeted daily/4h manifest generator:
  `src/scripts/build-ibkr-daily-4h-backfill-manifest.ts`.
- The manifest collapsed the `52` failed rows into:
  - `27` symbol/session groups
  - `54` daily/4h tasks
  - `25` symbols
  - about `18,900` estimated candles
- Dry-run: `54` planned, `54` fetchable, `0` failed.
- Execute: `54` planned, `54` fetched, `0` failed.

Current all-eligible consumer rerun:

- requested trades: `208`
- analyzable completed trades: `206`
- completed reviews: `204`
- diagnostics: `4`
- open skipped trades: `2`
- remaining analysis failures: `2`
- market context: `levels_system_daily_4h=204`
- trade-window evidence:
  - `levels_system_trade_window=196`
  - `execution_only_fallback=8`
- missing trade-window excursion insights: `0`
- fallback/generic headlines: `0`

Remaining provider-data cases:

- `AVEX` and `ELMT` still fail daily/4h context after IBKR fetch.
- IBKR returned and the warehouse stored only tiny higher-timeframe history:
  - `AVEX`: `1` daily candle and `1` 4h candle
  - `ELMT`: `1` daily candle and `2` 4h candles
- Treat these as insufficient-history/provider-data cases rather than ordinary
  warehouse gaps. Do not start broad alias discovery or delisted-symbol research
  unless one becomes a high-value blocking replay.

Provider artifacts:

- `artifacts/trader-intelligence/ibkr-april-all-eligible-5m-execute/candle-warehouse-backfill.md`
- `artifacts/trader-intelligence/ibkr-april-all-eligible-daily-4h-execute/candle-warehouse-backfill.md`

Consumer artifacts:

- `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-5m-backfill.json`
- `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-5m-backfill-readiness.md`
- `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-daily-4h-backfill-manifest.json`
- `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-daily-4h-backfill.json`
- `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-daily-4h-backfill-readiness.md`

Next branch:

- Stop broad backfill. Keep `AVEX` and `ELMT` as clean insufficient-history
  diagnostics unless a targeted, high-value replay justifies more provider
  work.
- Preserve the existing price-basis policy for the remaining execution-only
  fallback rows.

## AVEX/ELMT Insufficient Context Diagnostic Cleanup - 2026-05-05

Status: completed.

Provider-side change:

- `buildSupportResistanceContextForSymbol(...)` now includes the relevant
  higher-timeframe fetch diagnostics in the thrown error when daily/4h context
  cannot be built.
- This makes replay failures distinguish normal missing warehouse ranges from
  insufficient usable higher-timeframe history under the historical cutoff.

Consumer-side change:

- Trader Intelligence added `insufficient_market_context`.
- The dry-run decision-review bridge maps that to
  `market_context_unavailable` instead of generic `analysis_failed`.

Latest all-eligible consumer rerun:

- completed reviews: `204/206`
- diagnostics: `4`
- open skipped trades: `2`
- remaining unavailable market-context trades:
  - `AVEX`
  - `ELMT`

Detailed interpretation:

- `AVEX` has same-session daily/4h files in the warehouse, but the historical
  closed-candle cutoff leaves `0` usable higher-timeframe bars for the review.
- `ELMT` has same-session daily data and two 4h bars in storage, but replay
  leaves `0` usable daily bars and only `1` usable 4h bar against the `180`
  lookback.
- This is insufficient provider/history coverage, not a reason to start broad
  alias discovery.

Artifacts:

- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-avex-elmt-diagnostics.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-avex-elmt-diagnostics-readiness.md`

Verification:

- Provider shared API tests passed: `26/26`.
- Provider TypeScript and build passed.
- Consumer focused tests passed: `22/22`.
- Consumer TypeScript passed.

## Future Warehouse Price-Basis And Reverse-Split Policy Note - 2026-05-05

Status: planning note only; do not implement broad corporate-action handling in
the current AVEX/ELMT or calibration cleanup lane.

Concern:

- `levels-system` stores candle data for reuse by Trader Intelligence and other
  apps.
- If a symbol reverse splits after candles are fetched, a later provider refetch
  may return historical OHLC on a different basis than the candles already in
  the warehouse.
- IBKR historical candle bars do not reliably include an explicit "10:1" or
  "8:1" reverse-split ratio note. The current ratio clues are inferred by
  comparing broker execution prices against nearby candle OHLC.
- IBKR contract qualification can sometimes expose `PINK`/OTC style metadata
  after a symbol is successfully resolved, but it does not guarantee discovery
  of renamed or delisted replacement symbols.

Near-term policy:

- Keep IBKR plus `data/candles` warehouse as the trusted provider path.
- Continue treating `adjustmentMode: "raw"` as provider provenance, not proof
  of execution-price alignment.
- Require execution/candle price alignment before trade-window candles are used
  for trader feedback.
- If candles are present but appear separated from executions by a split-like
  whole-number multiple, emit/keep the explicit price-basis diagnostics and let
  Trader Intelligence produce execution/P&L-only feedback.
- Do not auto-multiply or rewrite stored candles using inferred ratios such as
  `8:1`, `10:1`, `38:1`, or `40:1`.
- Keep delisted/renamed alias handling narrow and validated through the same
  IBKR provider workflow. Do not build broad alias discovery right now.

Future work:

- Add warehouse-level candle provenance and drift policy before relying on
  stored candles across long time spans and multiple apps:
  - provider, requested symbol, resolved symbol, conId, exchange, primary
    exchange, fetched-at timestamp, request type, interval, and declared
    adjustment mode per stored range;
  - refetch drift detection when the same historical range returns materially
    different OHLC values;
  - explicit basis states such as provider-raw, split-adjusted,
    execution-aligned, and unverified;
  - corporate-action awareness for known reverse splits, ticker changes,
    delistings, and OTC/PINK moves.

Coordination note:

- AVEX/ELMT remains the other Codex's insufficient-history/provider-data lane.
- This reverse-split warehouse policy note is a reminder for later architecture
  work, not a request to block or redo the current calibration results.

## Provider-Side Candle Basis Metadata Hook - 2026-05-06

Status: small provider/warehouse-side implementation completed. This is not a
corporate-action engine and does not rewrite historical prices.

Input doc read:

- `C:\Users\jerac\Documents\TraderLink\trader-intelligence-v2\src\docs\candle-warehouse-basis-policy-design-2026-05-06.md`

Provider/warehouse changes:

- New warehouse rows can preserve source metadata for candle provenance:
  - provider
  - requested symbol
  - resolved symbol
  - resolved conId
  - resolved exchange
  - resolved primary exchange
  - source fetched timestamp
  - `whatToShow`
  - RTH/extended-hours setting
  - provider-declared adjustment mode
  - warehouse adjustment mode
  - alias-used flag and alias reason
  - basis validation status
- IBKR historical provider metadata now explicitly includes:
  - `whatToShow: TRADES`
  - `useRTH: false`
  - `providerAdjustmentMode: raw`
- Durable warehouse write-through passes provider metadata into stored row
  source metadata.
- Durable warehouse replay exposes stored source metadata back through
  `providerMetadata` with `warehouse*` keys.
- Manual/older-style IBKR `MAXN` warehouse writes still reconstruct the known
  validated alias metadata (`MAXN -> MAXNQ`, `PINK`) from the narrow provider
  alias table.

Basis status model added:

- `basis_unchecked`
- `basis_aligned`
- `basis_mismatch`
- `basis_adjustment_multiple_likely`
- `basis_insufficient_evidence`

Trade-analysis diagnostics:

- Added `trade_window_basis_validation_status`.
- The diagnostic is derived from the existing execution/candle alignment guard.
- Split-like mismatches still emit the existing:
  - `possible_price_adjustment_mismatch`
  - `likely_price_basis_adjustment_multiple`
  - `trade_window_price_basis_unverified`
- The stricter policy remains unchanged: if a split-like multiple is likely,
  Trader Intelligence should treat the candles as unavailable for movement
  review unless raw IBKR candle basis is proven aligned to broker executions.

Scope guard:

- No broad corporate-action registry was added.
- No broad delisted-symbol discovery was added.
- No old warehouse files were migrated or mutated blindly.
- No candle prices were multiplied, divided, adjusted, or rewritten in place.
- Alias handling remains narrow and validated, currently `MAXN -> MAXNQ`.
- `AVEX`/`ELMT` remain insufficient usable daily/4h history cases, not
  price-basis or alias-discovery cases.

Files changed:

- `src/lib/candle-warehouse/durable-candle-warehouse.ts`
- `src/lib/candle-warehouse/backfill-executor.ts`
- `src/lib/candle-warehouse/index.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/lib/support-resistance/index.ts`
- `src/tests/durable-candle-warehouse.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

Verification:

- Focused provider tests passed:
  `npx tsx --test src\tests\durable-candle-warehouse.test.ts src\tests\support-resistance-shared-api.test.ts`
- TypeScript passed:
  `npx tsc --noEmit --pretty false`
- Package build passed:
  `npm run build`

Next branch:

- Let Trader Intelligence refresh the local `levels-system` dependency and
  preserve/display `trade_window_basis_validation_status`
  if useful, while continuing to rely on the existing mismatch/unverified
  diagnostics for execution/P&L-only fallback decisions.

## Trader Consumer Calibration After PBM/XTLB Window Fixes - 2026-05-06

Status: completed coordination update from the Trader Intelligence consumer
branch. This is the current handoff state for the other Codex.

Provider-side follow-up completed:

- `levels-system` now falls back from stale partial `1m` trade-window replay to
  `5m` when the newest partial `1m` candle is more than 15 minutes before the
  requested trade-window end.
- Regression coverage was added for that stale partial `1m` fallback path.
- This fixed the `XTLB` consumer rows, where usable `5m` warehouse candles were
  present but a tiny stale `1m` replay file blocked fallback.

Targeted backfill completed:

- `PBM` was a real `5m` coverage tail gap, not a price-basis mismatch.
- A single targeted IBKR `5m` backfill was performed for the PBM post-window
  cutoff.
- IBKR returned `91` `5m` candles ending at
  `2026-04-17T15:30:00.000Z`.

Final Trader Intelligence all-eligible replay state:

- requested trades: `208`
- analyzable completed trades: `206`
- completed decision reviews: `204`
- open skipped trades: `2`
- remaining diagnostics: `AVEX`, `ELMT` as `market_context_unavailable`
- market context source: `levels_system_daily_4h=204`
- trade-window evidence:
  - `levels_system_trade_window=199`
  - `execution_only_fallback=5`
- remaining execution-only fallback symbols:
  - `VEEE=1`
  - `ISPC=2`
  - `DGNX=2`

Interpretation:

- `PBM` and `XTLB` are resolved as candle-window coverage/replay issues.
- The only remaining execution-only fallbacks are intentional price-basis /
  likely adjustment-multiple cases.
- `VEEE`, `ISPC`, and `DGNX` should remain execution/P&L-only movement reviews
  unless raw IBKR candle basis can be proven aligned to broker execution prices.
- `AVEX` and `ELMT` remain insufficient daily/4h history diagnostics under the
  no-future-leakage cutoff. They are not alias-discovery or reverse-split
  tasks right now.

Artifacts:

- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-pbm-xtlb-window-fixes.json`
- Consumer:
  `artifacts/real-csv-calibration/private/ibkr-april-all-eligible-after-pbm-xtlb-window-fixes-readiness.md`

Verification:

- Provider shared API test passed:
  `npx tsx --test src\tests\support-resistance-shared-api.test.ts`
  with `27/27`.
- Provider TypeScript passed.
- Provider build passed.
- Consumer TypeScript passed.
- Consumer focused bridge tests passed: `16/16`.
- Consumer build passed.
- Consumer focused Playwright import dry-run tests passed: `10/10`.

Do next:

- Do not bulk-fetch more candles for this branch.
- Keep delisted alias handling narrow and validated; currently `MAXN -> MAXNQ`.
- Trader Intelligence should continue product/policy handling for:
  - the five price-basis rows (`VEEE`, `ISPC`, `DGNX`);
  - the two insufficient-history diagnostics (`AVEX`, `ELMT`).
- A small future polish item is to make the stale partial `1m` fallback
  diagnostic wording more explicit, but the replay behavior is already fixed.

## Stale Partial 1m Fallback Diagnostic Polish - 2026-05-06

Status: completed in `levels-system`.

Provider-side change:

- The stale partial `1m` replay fallback now emits a more specific
  `trade_window_one_minute_unavailable` diagnostic.
- When fallback happens because partial `1m` replay is stale, the message now
  says the newest `1m` candle timestamp, the requested window end, and that the
  newest candle was more than 15 minutes before the requested window end.
- Empty/unavailable `1m` fallback keeps the existing generic wording.
- Replay behavior is unchanged: stale partial `1m` still falls back to `5m`.

Files changed:

- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/support-resistance-shared-api.test.ts`

Verification:

- Provider shared API test passed:
  `npx tsx --test src\tests\support-resistance-shared-api.test.ts`
  with `27/27`.
- TypeScript passed:
  `npx tsc --noEmit --pretty false`
- Package build passed:
  `npm run build`

Current branch status:

- No broad candle fetching is needed.
- `PBM` and `XTLB` remain resolved.
- The remaining Trader Intelligence product/policy cases are still:
  - price-basis execution/P&L-only rows: `VEEE`, `ISPC`, `DGNX`;
  - insufficient daily/4h history rows: `AVEX`, `ELMT`.
