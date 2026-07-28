# Shared Support / Resistance Engine Boundary

## Purpose

The candle, level-building, support/resistance, structure, and future candle-pattern logic should evolve in one place and be reusable by other TraderLink apps without copying source files between projects.

This project now exposes a stable shared boundary through:

```ts
import {
  buildSupportResistanceContextFromCandles,
  buildSupportResistanceContextForSymbol,
  buildTradeAnalysisCandleContext,
  buildDynamicLevelsFromCandles,
  buildExecutionLevelRelations,
  buildGapStructure,
  buildReferenceLevels,
  buildWarehouseBackedSupportResistanceContextForSymbol,
  buildWarehouseBackedTradeAnalysisCandleContext,
  buildSupportResistanceContextFromSingleTimeframeCandles,
  fetchSupportResistanceContextFromSingleTimeframeCandles,
  buildCandleMarketStructureContext,
  LevelEngine,
  calculateLatestEma,
  calculateLatestVwap,
  planBulkCandleBackfill,
} from "levels-system-phase1/support-resistance-engine";
```

The current package name is still the local repo package name, `levels-system-phase1`. If this is later published or moved into a dedicated package, the intended public package name is:

```text
@traderlink/support-resistance-engine
```

## What The Shared Boundary Owns

- normalized candle types
- candle acquisition through the shared provider layer
- candle fetch contracts
- level engine orchestration
- support/resistance level output types
- level extension helpers
- level quality audit helpers
- practical 5-minute structure context
- intraday price structure tracking
- volume/activity context that is derived from candles or live volume
- VWAP and EMA utilities derived from normalized candles
- future candle type recognition and candle pattern logic

## What Stays Outside The Boundary

- Discord posting
- manual watchlist UI
- thread lifecycle and cleanup
- OpenAI commentary
- runtime activation/restore behavior
- app-specific alert routing and post policy
- provider credentials and provider session management

## Direct Candle Usage

Most consumer apps should use the symbol-level API below, where this package owns candle fetching. The direct candle-array entry point remains useful for tests, replay, saved data, and advanced consumers that already have correctly prepared daily / 4h / 5m candles.

## Symbol-Level Usage

Consumer apps that should not own candle fetching can request full structural context by symbol and timestamp:

```ts
import {
  buildSupportResistanceContextForSymbol,
  CandleFetchService,
} from "levels-system-phase1/support-resistance-engine";

const context = await buildSupportResistanceContextForSymbol({
  symbol: "ABCD",
  sessionDate: "2026-05-01",
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
  fetchService,
  lookbackBars: {
    daily: 520,
    "4h": 180,
    "5m": 120,
  },
});

console.log(context.levels);
console.log(context.dynamicLevels.vwap);
console.log(context.dynamicLevels.ema9);
console.log(context.dynamicLevels.ema20);
console.log(context.marketStructure.state);
console.log(context.fetches);
console.log(context.diagnostics);
```

The symbol-level response includes:

```ts
{
  mode: "symbol",
  candleFetchingOwnedBy: "levels-system",
  requestedTimeframes: ["daily", "4h", "5m"],
  levels: LevelEngineOutput,
  dynamicLevels: DynamicLevelsFromCandles,
  marketStructure: CandleMarketStructureContext,
  fetches: SupportResistanceSymbolFetchSummary[],
  diagnostics: SupportResistanceSymbolContextDiagnostic[]
}
```

`daily` and `4h` are required for full support/resistance. `5m` is optional in the lower-level engine, but strongly recommended because it improves dynamic, intraday, special-level, and volume/activity context.

`asOfTimestamp` is passed to every fetch as the request end time. This keeps consumers from accidentally evaluating a trade or scan with candles that happened after the event being studied.

## Trade-Analysis Candle Package Usage

Trade-review apps that should not fetch chart data locally can request the full shared support/resistance context plus normalized trade-window candles:

```ts
import {
  buildTradeAnalysisCandleContext,
} from "levels-system-phase1/support-resistance-engine";

const context = await buildTradeAnalysisCandleContext({
  symbol: "ABCD",
  sessionDate: "2026-05-01",
  asOfTimestamp: "2026-05-01T16:15:00.000Z",
  executions: [
    {
      timestamp: "2026-05-01T15:32:00.000Z",
      price: 1.24,
      quantity: 1000,
      side: "buy",
    },
    {
      timestamp: "2026-05-01T15:44:00.000Z",
      price: 1.31,
      quantity: 1000,
      side: "sell",
    },
  ],
  preferredProvider: "ibkr",
  supportResistance: {
    lookbackBars: {
      daily: 520,
      "4h": 180,
      "5m": 120,
    },
  },
  tradeWindow: {
    timeframe: "1m",
    preTradeMinutes: 60,
    postTradeMinutes: 60,
  },
});
```

The response shape is:

```ts
{
  mode: "trade_analysis",
  candleFetchingOwnedBy: "levels-system",
  supportResistanceContext: SupportResistanceSymbolContext,
  tradeWindow: {
    timeframe: "1m" | "5m",
    tradeStartTimestamp: number,
    tradeEndTimestamp: number,
    preTradeCandles: Candle[],
    tradeCandles: Candle[],
    postTradeCandles: Candle[],
    allCandles: Candle[],
    fetch: { provider, requestedLookbackBars, actualBarsReturned, ... }
  },
  diagnostics: TradeAnalysisCandleContextDiagnostic[]
}
```

The API can also accept explicit `tradeStartTimestamp` and `tradeEndTimestamp` when executions are not available. `asOfTimestamp` truncates the post-trade window so a review cannot accidentally use candles that occurred after the analysis cutoff.

This is the preferred future shape for `trader-intelligence-v2` if that app should stop fetching candles entirely. That project can map `tradeWindow.preTradeCandles`, `tradeWindow.tradeCandles`, and `tradeWindow.postTradeCandles` into its raw trade timeline while using `supportResistanceContext` for levels, VWAP/EMA, and market structure.

## Durable Candle Warehouse Usage

The shared boundary also exposes the first durable candle warehouse layer:

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

The warehouse stores normalized candle rows by provider, symbol, timeframe, and UTC session date. This is for website-scale reuse, bulk trade imports, and shared candle/structure analysis. It does not change Discord posting behavior by itself.

Warehouse-backed context builders are now available when a consumer wants the shared APIs to read/write the durable store automatically:

```ts
const context = await buildWarehouseBackedSupportResistanceContextForSymbol({
  symbol: "ABCD",
  sessionDate: "2026-05-01",
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
  warehouseDirectoryPath: "data/candles",
  mode: "read_write",
});
```

For bulk imports, `planBulkCandleBackfill(...)` dedupes repeated symbol/session/timeframe candle needs before the provider is called.

Other apps that already have candles should use the candle-array entry point. This avoids leaking IBKR, Discord, or this app's runtime into the other project.

```ts
import {
  buildSupportResistanceContextFromCandles,
  type Candle,
} from "levels-system-phase1/support-resistance-engine";

const result = await buildSupportResistanceContextFromCandles({
  symbol: "ABCD",
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
  sessionDate: "2026-05-01",
  candlesByTimeframe: {
    daily: dailyCandles,
    "4h": fourHourCandles,
    "5m": fiveMinuteCandles,
  },
});

console.log(result.levels.majorSupport);
console.log(result.levels.majorResistance);
console.log(result.levels.extensionLevels.resistance);
console.log(result.dynamicLevels.vwap);
console.log(result.dynamicLevels.ema9);
console.log(result.dynamicLevels.ema20);
console.log(result.marketStructure.traderLine);
```

`daily` and `4h` candles are required. `5m` candles are optional, but including them improves intraday structure, fresh levels, and volume/activity context.

The public candle input accepts either this repo's numeric timestamp candles or external normalized candles with a `number`, ISO `string`, or `Date` timestamp:

```ts
type SharedSupportResistanceCandle = {
  symbol?: string;
  timestamp: number | string | Date;
  timeframe?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number | null;
  tradeCount?: number | null;
  source?: string | null;
  sessionBucket?: string | null;
};
```

ISO timestamps are parsed as absolute timestamps. Consumers should pass UTC ISO strings when possible, for example `2026-05-01T13:30:00.000Z`.

`asOfTimestamp` is a public anti-lookahead control. When supplied, candles later than that timestamp are filtered out before levels, VWAP, or EMA are calculated. This lets a consumer evaluate structure as it existed at the time of a scan, alert, or execution instead of accidentally using future candles.

## Single-Timeframe / 1-Minute Usage

Some consumer apps may start with only one-minute trade-window candles instead of a complete daily / 4h / 5m ladder. The shared boundary supports that as a transitional path without pretending that one-minute candles are full support/resistance context.

Use supplied one-minute candles:

```ts
const partial = buildSupportResistanceContextFromSingleTimeframeCandles({
  symbol: "ABCD",
  timeframe: "1m",
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
  sessionDate: "2026-05-01",
  candles: oneMinuteCandles,
});
```

Or let this package fetch one-minute candles through the shared provider layer:

```ts
const partial = await fetchSupportResistanceContextFromSingleTimeframeCandles({
  symbol: "ABCD",
  timeframe: "1m",
  lookbackBars: 390,
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
  fetchService,
});
```

The single-timeframe result is intentionally partial:

```ts
{
  mode: "single_timeframe",
  completeness: "partial",
  sourceTimeframe: "1m",
  levels: null,
  aggregatedCandles: { "5m": Candle[] },
  dynamicLevels: {
    vwap: number | null,
    ema9: number | null,
    ema20: number | null
  },
  marketStructure: CandleMarketStructureContext,
  diagnostics: [
    { code: "missing_higher_timeframe_candles", ... }
  ]
}
```

One-minute candles are aggregated into five-minute candles for shared dynamic context. Full support/resistance levels still require daily and 4h candles. Do not treat the partial result as a full level map.

## Dynamic Levels

The shared boundary now exposes pure candle indicator utilities:

```ts
calculateEmaSeries(candles, 9);
calculateLatestEma(candles, 20);
calculateVwapSeries(candles, { sessionDate: "2026-05-01" });
calculateLatestVwap(candles, { sessionDate: "2026-05-01" });
buildDynamicLevelsFromCandles(fiveMinuteCandles, { sessionDate: "2026-05-01" });
```

The support/resistance context builder also returns:

```ts
{
  dynamicLevels: {
    vwap: number | null,
    ema9: number | null,
    ema20: number | null,
    emaByPeriod: Record<number, number | null>,
    diagnostics: Array<{ code: string, message: string }>
  }
}
```

For now, dynamic levels are exposed for shared-engine consumers and tests. They are not automatically added to this project's Discord trader posts.

When a current price is provided, dynamic levels also include optional `priceContext` facts for price versus VWAP, EMA9, and EMA20. These are shared facts only; they do not automatically become trader-facing Discord text.

## Reference Levels, Gap Structure, And Execution Relations

`SupportResistanceContext` now includes:

```ts
{
  referenceLevels,
  gapStructure
}
```

`referenceLevels` exposes previous-day high/low/close, premarket high/low/base, opening-range high/low, and current-session high/low with diagnostics when the candle evidence is missing.

`gapStructure` exposes nearest open gaps above/below, recent gap zones, fill status, and diagnostics. This is diagnostic/shared context first and should stay out of trader-facing wording until calibrated.

The shared boundary also exports:

```ts
buildExecutionLevelRelations({
  price,
  levels,
  referenceLevels,
});
```

This returns nearest support/resistance, room above/below, stacked barriers, open-air context, near-level booleans, and nearest reference-level match. It is generic market-structure math for consumer apps, not an app-specific coaching decision.

## Candle Market Structure

The shared boundary now exposes deterministic 5-minute candle structure context:

```ts
buildCandleMarketStructureContext({
  symbol: "ABCD",
  candles: fiveMinuteCandles,
  asOfTimestamp: "2026-05-01T15:45:00.000Z",
});
```

The support/resistance context builders also return:

```ts
{
  marketStructure: {
    timeframe: "5m",
    state: "range_bound" | "higher_lows_intact" | "trend_intact" | "trend_damaged" | "...",
    confidence: {
      score: number,
      label: "low" | "medium" | "high",
      reasons: string[]
    },
    pivots: {
      confirmedHighs,
      confirmedLows,
      latestSwingHigh,
      latestSwingLow
    },
    trend,
    range,
    pivotEvent,
    traderLine,
    diagnostics
  }
}
```

The market-structure module detects:

- confirmed 5m swing highs and swing lows
- higher lows / lower highs
- active range high / range low
- reclaim and loss of pivot from candle closes
- trend intact versus trend damaged
- evidence-based structure confidence

Single-timeframe `1m` context aggregates candles into `5m` before building market structure and adds a `derived_from_1m` diagnostic. The module is shared context only for now; it does not create standalone Discord market-structure posts.

## Operator Calibration Reports

The shared boundary is supported by operator reports that prove the candle facts before another app or Discord wording relies on them:

```powershell
npm run structure:calibrate -- --max-files-per-symbol 2 --audit-limit all
npm run candles:advanced-context -- --max-symbols 25
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data
npm run startup:cache-readiness
```

- `structure:calibrate` joins 5m replay evidence with saved Discord alignment evidence and tells whether market structure is trusted for suppression/materiality, still operator-only, or needs chop review.
- `candles:advanced-context` summarizes reference levels, gaps, VWAP/EMA availability, market structure, candle reaction, opening range, halt awareness, level/data quality, first-post-plan lines, data-quality reasons, primary weak-data cause, and missing facts from cached candles.
- `candles:provider-compare` compares cached providers for coverage, latest-close drift, average-volume drift, VWAP/EMA drift, market-structure drift, and support/resistance drift.
- `startup:cache-readiness` checks active watchlist symbols for cached daily/4h/5m restart coverage. It is operator proof only; Discord snapshots still wait for fresh candle refresh.

These reports are not consumer APIs; they are calibration proof for maintaining the shared engine safely.

## Local Dependency Usage

For another local VS Code project:

```json
{
  "dependencies": {
    "levels-system-phase1": "file:../levels-system"
  }
}
```

Then run this in `levels-system` before consuming the package:

```powershell
npm run build
```

The public export is backed by compiled files under `dist/lib/support-resistance`.

## Adapter Rule

Other apps should not import files like:

```ts
import { LevelEngine } from "../levels-system/src/lib/levels/level-engine";
```

That is brittle. They should import only from the public boundary and adapt their own app types at the edge:

```text
other app normalized Candle[]
-> support-resistance-engine
-> other app StructuralLevel / ReferenceLevels / relations
```

This keeps provider assumptions, runtime assumptions, and Discord behavior from leaking across apps.

## Current Stage

This is stage 1: a stable public boundary inside the existing repo package. The next stage, if needed, is to move the reusable engine internals into a physical workspace package while keeping this same public API stable.

Do not move runtime or Discord modules into the shared engine package.
