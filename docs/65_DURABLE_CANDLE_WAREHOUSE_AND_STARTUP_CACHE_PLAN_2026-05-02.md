# Durable Candle Warehouse And Startup Cache Plan

## Purpose

This file explains the long-term candle-data plan for `levels-system` and the short-term startup-cache improvement for the Discord/manual watchlist app. It is meant to support both this app and `trader-intelligence-v2`, where users may import months of trades and need repeatable historical structure without each app fetching candles independently.

## Why This Matters

The system has two workloads:

- **Manual watchlist / Discord app:** needs fast restart behavior for currently active tickers while keeping Discord posts honest.
- **Trader intelligence app:** needs durable, repeatable candle and structure context for many historical trades, including bulk imports over weeks or months.

IBKR can be useful during testing, but it should be treated as a provider behind this project, not something every consumer app calls directly. The consumer should ask `levels-system` for structural context, trade-window candles, and diagnostics. Later the provider can change without rewriting consumer apps.

## Current State

- `ValidationCachedCandleFetchService` already saves normalized provider responses to disk.
- The cache supports:
  - `read_write`
  - `refresh`
  - `replay`
  - reusable nearby/larger-lookback cache hits
- The manual runtime now has a safe startup acceleration layer: replay-mode cache can restore levels for operator visibility, while normal runtime seeding uses provider refresh and writes fresh responses back to disk.
- The shared engine boundary already lets other apps request support/resistance, dynamic indicators, market structure, trader context, and trade-window candles from this project.

## Short-Term Startup Cache Rule

For the manual watchlist runtime:

1. Use cached candles on restart only to restore levels quickly.
2. Mark the symbol as `levels restored from cache, refreshing candles`.
3. Do not post a startup Discord snapshot from cached-only levels.
4. Force a fresh provider seed in the background.
5. Post the startup snapshot only after fresh provider seeding succeeds.
6. If fresh seeding fails, keep the symbol visible as `refresh_pending` and operator-visible instead of pretending the cached levels are fully fresh.

This keeps restart speed better without misleading traders.

## Durable Candle Warehouse Target

The long-term store should become a real candle warehouse rather than only request-shaped JSON files.

Recommended first production-friendly shape:

```text
data/candles/
  provider/
    SYMBOL/
      timeframe/
        YYYY-MM-DD.jsonl
```

Each row should be one normalized candle:

```json
{
  "symbol": "ABCD",
  "provider": "ibkr",
  "timeframe": "1m",
  "timestamp": 1777642200000,
  "open": 1.01,
  "high": 1.04,
  "low": 1.00,
  "close": 1.03,
  "volume": 123456,
  "vwap": null,
  "tradeCount": null,
  "sourceFetchedAt": 1777642500000,
  "adjustmentMode": "raw"
}
```

Later, when usage grows, move this to SQLite or a proper database table with indexes on:

- provider
- symbol
- timeframe
- timestamp
- session date

## First Warehouse Implementation

The first JSONL warehouse layer now exists under:

- `src/lib/candle-warehouse/durable-candle-warehouse.ts`
- `src/lib/candle-warehouse/index.ts`

It exposes:

- `DurableCandleWarehouse`
- `DurableCandleWarehouseFetchService`
- `DurableCandleWarehouseRow`
- range, coverage, upsert, and missing-range types

The shared public package boundary also exports those types/classes from:

```ts
levels-system-phase1/support-resistance-engine
```

Example:

```ts
import {
  CandleFetchService,
  DurableCandleWarehouse,
  DurableCandleWarehouseFetchService,
} from "levels-system-phase1/support-resistance-engine";

const warehouse = new DurableCandleWarehouse("data/candles");
const fetchService = new DurableCandleWarehouseFetchService({
  warehouse,
  delegate: new CandleFetchService({ providerName: "ibkr" }),
  mode: "read_write",
});
```

This is intentionally a first durable file-store layer, not the final database. It is useful now because it gives future website tools a stable place to reuse stored candle rows for support/resistance, market structure, VWAP/EMA, and trade-window analysis.

## Consumer API Goal

`trader-intelligence-v2` should eventually call one high-level API:

```ts
buildTradeAnalysisCandleContext({
  symbol,
  sessionDate,
  asOfTimestamp,
  executions,
  provider: "ibkr"
});
```

This project should own:

- provider fetching
- cache lookup
- missing-range backfill
- candle normalization
- 1m trade-window candles
- 5m aggregation
- daily and 4h context
- support/resistance
- VWAP / EMA
- market structure
- diagnostics

The consumer app should not fetch candles itself unless it is in a temporary migration state.

## Reliability Rules

- Never fake daily or 4h levels from 1m data unless marked as derived/diagnostic.
- Always respect `asOfTimestamp` to avoid future-candle leakage.
- Prefer cached data for speed, but surface diagnostics when it is stale or incomplete.
- Keep provider-specific assumptions inside `levels-system`.
- Do not post trader-facing Discord messages from stale cache alone.
- For bulk trade imports, dedupe fetches by symbol/date/timeframe before calling the provider.

## Implementation Phases

### Phase 1: Startup Cache Safety

Status: implemented for the manual watchlist runtime.

- Manual runtime candle cache defaults to a safe two-layer behavior:
  - startup restore uses replay-mode cache only for fast warm levels
  - live/runtime seeding uses refresh mode by default when startup cache is enabled, so fresh provider responses are fetched and then written back to disk
- Active symbols can restore cached levels if available.
- Cached symbols are marked as warming with `levels restored from cache, refreshing candles`.
- Startup Discord snapshots are held until fresh provider seeding succeeds.
- Fresh seed failure leaves the symbol visible as `refresh_pending` with operator status instead of posting cached-only trader output.
- The UI/runtime config shows requested cache mode, runtime cache mode, startup cache state, and cache path.

Manual runtime environment controls:

```text
MANUAL_WATCHLIST_CANDLE_CACHE_MODE=read_write | refresh | replay | off
MANUAL_WATCHLIST_CANDLE_CACHE_DIR=.validation-cache/candles
MANUAL_WATCHLIST_STARTUP_CANDLE_CACHE=1 | 0
```

Default behavior is intentionally conservative: `read_write` is accepted as the requested mode, but when startup cache is enabled the live runtime uses `refresh` so Discord-visible startup snapshots are based on fresh provider candles.

## End-Of-Day Replay Verdict

The manual watchlist now also has an operator-only end-of-day verdict report:

```powershell
npm run audit:eod-verdict -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

The report writes:

- `end-of-day-symbol-verdict.json`
- `end-of-day-symbol-verdict.md`

It answers one practical set of questions for each symbol:

- Did the first post give a good trade map?
- Did the app post too much?
- Did it miss a meaningful breakout or support loss?
- Were levels complete enough?
- Did trader wording make sense?

The missed-move verdict is deliberately conservative. Saved Discord rows alone cannot prove that no candle move was missed, so the report labels that category as `needs_candle_audit` unless a candle-backed audit is also consulted.

### Phase 2: Warehouse API

- Add a durable candle repository abstraction.
- Store normalized candle rows by provider/symbol/timeframe/date.
- Add range queries:
  - `getCandles(symbol, timeframe, start, end)`
  - `missingRanges(symbol, timeframe, start, end)`
  - `upsertCandles(candles)`
- Keep the current request-shaped validation cache as a compatibility layer until the warehouse is ready.

### Phase 3: Bulk Import Support

- Batch symbols and session dates.
- Backfill missing daily / 4h / 5m / 1m candles once.
- Reuse stored candles for all trades in the same symbol/date window.
- Write diagnostics for missing provider coverage.

### Phase 4: Provider Swap Readiness

- Keep provider metadata on every candle.
- Allow provider preference but keep the consumer API stable.
- Add provider comparison reports for level/structure drift before switching away from IBKR.

## Testing Checklist

- Cached startup levels restore active tickers without posting Discord snapshots.
- Fresh provider seed after cache restore posts normal startup snapshot.
- Fresh seed failure after cache restore leaves symbol in `refresh_pending`.
- Runtime UI shows cache warming status.
- Replay cache misses do not break startup.
- Bulk import planning can identify shared symbol/date/timeframe fetches.
- Shared API responses include diagnostics for stale/missing candle groups.
