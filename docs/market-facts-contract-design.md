# Market Facts Contract Design for Trade Review

## Purpose

This document proposes a clean market-facts contract between two TypeScript applications:

1. **levels-system**
   - Owns candle fetching
   - Owns candle storage
   - Owns support/resistance
   - Owns VWAP
   - Owns EMA
   - Owns market structure
   - Owns neutral candle and market facts

2. **trader-intelligence-v2**
   - Owns completed trade review
   - Owns executions/fills
   - Owns P/L interpretation
   - Owns sizing review
   - Owns journaling
   - Owns behavior review
   - Owns coaching and learning language

The most important design boundary is:

> `trader-intelligence-v2` should not calculate VWAP, EMA, support/resistance, or market structure locally. It should consume neutral structured market facts from `levels-system` and combine those facts with P/L, sizing, journaling, and trader-review logic.

The best contract design is:

> `levels-system` returns named benchmark evidence. `trader-intelligence-v2` turns that evidence into beginner-friendly review language.

---

# Core Recommendation

Do not make `levels-system` return vague facts like:

```txt
Entry was above VWAP.
```

Instead, make it return facts against explicitly named benchmark definitions:

```txt
Entry was above the regular-session VWAP benchmark.
Entry was below the extended-session VWAP benchmark.
Entry was above the 1-minute EMA9 benchmark.
Entry was below the 1-minute EMA20 benchmark.
```

This solves the chart-context problem because the system is no longer pretending to know what the trader saw on their chart.

The system should not answer:

```txt
Was the trader above VWAP?
```

It should answer:

```txt
Against the regular-session VWAP benchmark, where was price?
Against the extended-session VWAP benchmark, where was price?
Against the 1-minute EMA9 benchmark, where was price?
How reliable was each benchmark at that timestamp?
```

---

# 1. Recommended Default Benchmark Set

The default product should work without asking the trader to configure chart settings.

Use a default benchmark profile:

```ts
export type MarketFactsBenchmarkProfile =
  | "small_cap_day_trade_v1"
  | "small_cap_day_trade_enriched_v1";
```

The recommended default profile is:

```ts
"small_cap_day_trade_v1"
```

## Default Benchmark Set

```txt
regular_session_vwap_1m
extended_session_vwap_1m
ema9_1m
ema20_1m
nearest_support
nearest_resistance
```

## Why These Benchmarks?

### Regular-session VWAP

This is the common intraday VWAP benchmark.

Recommended definition:

```txt
Start: current regular session open
End: execution timestamp
Timeframe: 1m
```

For US equities, this usually means 9:30 AM through the execution timestamp.

### Extended-session VWAP

This is important for small-cap trades because premarket volume and premarket price movement often shape the actual trading context.

Recommended definition:

```txt
Start: current extended session start
End: execution timestamp
Timeframe: 1m
```

For US equities, this often means 4:00 AM through the execution timestamp.

### 1-minute EMA9

This is a common short-term momentum reference.

### 1-minute EMA20

This is a common short-term intraday trend reference.

### Nearest support and resistance

For completed trade review, support/resistance facts are often more useful than indicators. Facts like these are valuable:

```txt
Price entered nearest resistance during the hold.
Price failed below nearby resistance.
Price broke nearest support after exit.
Price reclaimed entry after exit.
```

---

# 2. What Not to Include by Default

Do not include these in the first default profile:

```txt
ema9_5m
ema20_5m
ema9_15m
ema20_15m
anchored_vwap
```

These are useful, but they increase complexity.

Instead, add them through an enriched profile:

```ts
"small_cap_day_trade_enriched_v1"
```

Recommended enriched profile:

```txt
regular_session_vwap_1m
extended_session_vwap_1m
ema9_1m
ema20_1m
ema9_5m
ema20_5m
nearest_support
nearest_resistance
```

Anchored VWAP should not be part of the default profile. It should only be added when the anchor is explicit.

---

# 3. Recommended Response Structure

Keep the current API stable, but add a new top-level property:

```ts
marketFacts
```

Recommended high-level response shape:

```ts
export interface TradeAnalysisCandleContextResponseV2 {
  symbol: string;
  mode: "trade_analysis";
  candleFetchingOwnedBy: "levels-system";
  asOfTimestamp: string;
  supportResistanceContext: unknown;
  tradeWindow: TradeWindowResponse;
  tradeWindowFacts: unknown;
  executionRelations: unknown;
  marketFacts: MarketFactsResponseV2;
  diagnostics: MarketFactDiagnostic[];
}
```

The older fields can remain for compatibility:

```txt
tradeWindowFacts
executionRelations
```

But the new canonical contract should live under:

```txt
marketFacts
```

---

# 4. Recommended TypeScript Schema

```ts
export type MarketFactsContractVersion = "market_facts.trade_review.v2";

export type MarketFactsBenchmarkProfile =
  | "small_cap_day_trade_v1"
  | "small_cap_day_trade_enriched_v1";

export type CandleTimeframe =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "daily";

export type ExecutionSide =
  | "buy"
  | "sell"
  | "short"
  | "cover";

export type BenchmarkKind =
  | "vwap"
  | "ema"
  | "support"
  | "resistance"
  | "market_structure";

export type BenchmarkRole =
  | "primary"
  | "comparison"
  | "advanced";

export type VwapMode =
  | "regular_session"
  | "extended_session"
  | "anchored";

export type SessionScope =
  | "regular_session"
  | "extended_session"
  | "multi_day"
  | "rolling";

export type PriceBenchmarkRelation =
  | "above"
  | "below"
  | "at"
  | "crossed_above"
  | "crossed_below"
  | "missing";

export type MarketFactQualityStatus =
  | "available"
  | "missing";

export type MarketFactConfidence =
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type MarketFactQualityFlag =
  | "thin_basis"
  | "fallback_timeframe"
  | "missing_volume"
  | "missing_candles"
  | "partial_candle_window"
  | "stale_candles"
  | "insufficient_ema_warmup"
  | "session_reset"
  | "extended_session_low_volume"
  | "calculation_unavailable";

export interface MarketFactsResponseV2 {
  contractVersion: MarketFactsContractVersion;
  benchmarkProfile: MarketFactsBenchmarkProfile;
  symbol: string;
  asOfTimestamp: string;
  candleFetchingOwnedBy: "levels-system";
  noLookaheadPolicy: NoLookaheadPolicy;
  benchmarkDefinitions: BenchmarkDefinition[];
  executionSnapshots: ExecutionMarketSnapshot[];
  tradeWindowSummary: TradeWindowMarketSummary;
  postTradeSummary: PostTradeMarketSummary | null;
  disagreementSummary: BenchmarkDisagreementSummary[];
  diagnostics: MarketFactDiagnostic[];
}

export interface NoLookaheadPolicy {
  policy: "closed_candles_only" | "partial_current_candle_allowed";
  candleInclusionRule: "candle_end_lte_snapshot_timestamp";
  partialCandlesRequireLowerGranularitySource: boolean;
}

export interface BenchmarkDefinition {
  benchmarkId: string;
  kind: BenchmarkKind;
  role: BenchmarkRole;
  label: string;
  timeframe?: CandleTimeframe;
  vwapMode?: VwapMode;
  emaLength?: number;
  sessionScope: SessionScope;
}

export interface ExecutionMarketSnapshot {
  snapshotId: string;
  executionId?: string;
  timestamp: string;
  price: number;
  quantity: number;
  side: ExecutionSide;
  relations: BenchmarkRelationAtSnapshot[];
  diagnostics: MarketFactDiagnostic[];
}

export interface BenchmarkRelationAtSnapshot {
  benchmarkId: string;
  kind: BenchmarkKind;
  label: string;
  value: number | null;
  price: number;
  relation: PriceBenchmarkRelation;
  priceMinusBenchmarkAbs: number | null;
  priceMinusBenchmarkPct: number | null;
  basis: BenchmarkCalculationBasis;
  quality: MarketFactQuality;
}

export interface BenchmarkCalculationBasis {
  timeframe?: CandleTimeframe;
  requestedTimeframe?: CandleTimeframe;
  fallbackUsed: boolean;
  vwapMode?: VwapMode;
  emaLength?: number;
  sessionScope: SessionScope;
  startTimestamp: string;
  endTimestamp: string;
  barsUsed: number;
  volumeBarsUsed?: number;
  missingBars: number;
  partialBars: number;
}

export interface MarketFactQuality {
  status: MarketFactQualityStatus;
  confidence: MarketFactConfidence;
  flags: MarketFactQualityFlag[];
  reasons: string[];
}

export interface TradeWindowMarketSummary {
  tradeStartTimestamp: string;
  tradeEndTimestamp: string;
  holdDurationMinutes: number;
  highDuringTrade: number | null;
  lowDuringTrade: number | null;
  maxFavorableMovePct: number | null;
  maxAdverseMovePct: number | null;
  crossedBenchmarksDuringTrade: CrossedBenchmarkFact[];
  movedIntoNearestResistance: boolean | null;
  movedIntoNearestSupport: boolean | null;
}

export interface PostTradeMarketSummary {
  postTradeStartTimestamp: string;
  postTradeEndTimestamp: string;
  maxMoveAfterExitPct: number | null;
  reclaimedEntryPriceAfterExit: boolean | null;
  reachedNearestResistanceAfterExit: boolean | null;
  brokeNearestSupportAfterExit: boolean | null;
}

export interface CrossedBenchmarkFact {
  benchmarkId: string;
  label: string;
  crossedAtTimestamp: string;
  direction: "above" | "below";
}

export interface BenchmarkDisagreementSummary {
  disagreementId: string;
  kind: BenchmarkKind;
  benchmarkIds: string[];
  summary: string;
  severity: "info" | "warning";
}

export interface MarketFactDiagnostic {
  code:
    | "THIN_REGULAR_SESSION_VWAP"
    | "EXTENDED_SESSION_VWAP_AVAILABLE"
    | "MISSING_VOLUME_FOR_VWAP"
    | "TIMEFRAME_FALLBACK_USED"
    | "PARTIAL_CANDLE_WINDOW"
    | "STALE_CANDLE_DATA"
    | "INSUFFICIENT_EMA_WARMUP"
    | "MULTI_DAY_VWAP_SESSION_RESET"
    | "INDICATOR_DISAGREEMENT"
    | "BENCHMARK_UNAVAILABLE";
  severity: "info" | "warning" | "error";
  message: string;
  affectedBenchmarkIds: string[];
}

export interface TradeWindowResponse {
  timeframe: CandleTimeframe;
  requestedTimeframe: CandleTimeframe;
  fallbackUsed: boolean;
  requestedStartTimestamp: string;
  requestedEndTimestamp: string;
  tradeStartTimestamp: string;
  tradeEndTimestamp: string;
  dynamicLevels: unknown[];
  allCandles: unknown[];
  preTradeCandles: unknown[];
  tradeCandles: unknown[];
  postTradeCandles: unknown[];
  fetch: unknown;
}
```

---

# 5. Why `quality` Should Not Be a Single Enum

A simple field like this is too limited:

```ts
reliability: "reliable" | "thin" | "fallback" | "missing";
```

A benchmark can be both thin and fallback-based. Another benchmark can be available but stale. Another can be available with missing candle gaps.

Use this instead:

```ts
quality: {
  status: "available" | "missing";
  confidence: "high" | "medium" | "low" | "unknown";
  flags: MarketFactQualityFlag[];
  reasons: string[];
}
```

This gives the review layer much better control.

Examples:

```ts
quality: {
  status: "available",
  confidence: "low",
  flags: ["thin_basis"],
  reasons: ["Regular-session VWAP used only 2 one-minute bars."]
}
```

```ts
quality: {
  status: "available",
  confidence: "medium",
  flags: ["fallback_timeframe", "missing_candles"],
  reasons: [
    "Requested 1-minute candles were unavailable.",
    "5-minute fallback candles were used.",
    "The calculation window had missing candle gaps."
  ]
}
```

---

# 6. No-Lookahead Policy

The no-lookahead policy should be explicit in the response.

Recommended default:

```ts
noLookaheadPolicy: {
  policy: "closed_candles_only",
  candleInclusionRule: "candle_end_lte_snapshot_timestamp",
  partialCandlesRequireLowerGranularitySource: true
}
```

This means:

```txt
Only candles whose end timestamp is less than or equal to the execution timestamp can be used for that execution snapshot.
```

For example, if a trader enters at:

```txt
10:03:12
```

Then a full candle from 10:03 to 10:04 should not be used unless `levels-system` can reconstruct a true partial candle using lower-granularity data available only through 10:03:12.

Safe default:

```ts
"closed_candles_only"
```

Advanced mode:

```ts
"partial_current_candle_allowed"
```

Only use `partial_current_candle_allowed` when `levels-system` has tick data, sub-minute data, or another reliable way to build a non-lookahead partial candle.

---

# 7. Reliability and Diagnostic Rules

## VWAP Quality Rules

| Situation | Status | Confidence | Flags |
|---|---:|---:|---|
| No volume data | `missing` | `unknown` | `missing_volume`, `calculation_unavailable` |
| Fewer than 3 one-minute bars | `available` | `low` | `thin_basis` |
| 3 to 10 one-minute bars | `available` | `low` | `thin_basis` |
| 10 to 20 one-minute bars | `available` | `medium` | `thin_basis` |
| More than 20 usable one-minute bars | `available` | `high` | none |
| Missing candle gaps | `available` | `medium` or `low` | `missing_candles` |
| Fallback timeframe used | `available` | `medium` or `low` | `fallback_timeframe` |
| Extended session has very low volume | `available` | `low` or `medium` | `extended_session_low_volume` |

For regular-session VWAP at 9:31, the expected quality is usually:

```ts
quality: {
  status: "available",
  confidence: "low",
  flags: ["thin_basis"],
  reasons: ["Regular-session VWAP used only a small number of one-minute bars."]
}
```

For extended-session VWAP at 9:31 on a premarket mover, the expected quality may be:

```ts
quality: {
  status: "available",
  confidence: "medium",
  flags: [],
  reasons: []
}
```

If premarket volume is strong and candle coverage is good, confidence can be `high`.

## EMA Quality Rules

EMA needs warmup.

Suggested rules:

| EMA | Exists After | Medium Confidence | High Confidence |
|---|---:|---:|---:|
| EMA9 | 9 bars | 18 bars | 27 bars |
| EMA20 | 20 bars | 40 bars | 60 bars |

Examples:

```txt
EMA9 with 10 bars = available, low confidence
EMA9 with 20 bars = available, medium confidence
EMA9 with 30 bars = available, high confidence
EMA20 with 15 bars = missing or low-confidence synthetic depending on calculation method
EMA20 with 25 bars = available, low confidence
EMA20 with 45 bars = available, medium confidence
EMA20 with 65 bars = available, high confidence
```

Do not pretend early EMAs are as meaningful as mature EMAs.

## Support and Resistance Quality Rules

Support/resistance should also get quality metadata.

Useful signals:

| Situation | Suggested Quality |
|---|---|
| Multiple touches across meaningful history | Higher confidence |
| Level from only a tiny intraday sample | Lower confidence, `thin_basis` |
| Level created using fallback timeframe | `fallback_timeframe` |
| Level based on incomplete candle history | `missing_candles` or `partial_candle_window` |
| No nearby level found | `missing` |

Example:

```ts
{
  benchmarkId: "nearest_resistance",
  kind: "resistance",
  label: "Nearest resistance",
  value: 2.18,
  price: 2.10,
  relation: "below",
  priceMinusBenchmarkAbs: -0.08,
  priceMinusBenchmarkPct: -3.67,
  basis: {
    timeframe: "1m",
    requestedTimeframe: "1m",
    fallbackUsed: false,
    sessionScope: "regular_session",
    startTimestamp: "2026-05-04T09:30:00-04:00",
    endTimestamp: "2026-05-04T10:03:00-04:00",
    barsUsed: 34,
    missingBars: 0,
    partialBars: 0
  },
  quality: {
    status: "available",
    confidence: "medium",
    flags: [],
    reasons: ["Nearest resistance was derived from intraday structure."]
  }
}
```

---

# 8. Example: Entry 10:03, Exit 10:14

This is the cleanest case.

Execution facts:

```txt
Entry snapshot uses data through 10:03 only.
Exit snapshot uses data through 10:14 only.
```

Trade-level facts:

```txt
During-trade window = 10:03 through 10:14
Post-trade window = 10:14 through min(asOfTimestamp, requested post-trade end)
```

Example entry snapshot:

```json
{
  "snapshotId": "execution_1",
  "timestamp": "2026-05-04T10:03:00-04:00",
  "price": 1.45,
  "quantity": 1000,
  "side": "buy",
  "relations": [
    {
      "benchmarkId": "regular_session_vwap_1m",
      "kind": "vwap",
      "label": "Regular-session VWAP",
      "value": 1.42,
      "price": 1.45,
      "relation": "above",
      "priceMinusBenchmarkAbs": 0.03,
      "priceMinusBenchmarkPct": 2.11,
      "basis": {
        "timeframe": "1m",
        "requestedTimeframe": "1m",
        "fallbackUsed": false,
        "vwapMode": "regular_session",
        "sessionScope": "regular_session",
        "startTimestamp": "2026-05-04T09:30:00-04:00",
        "endTimestamp": "2026-05-04T10:03:00-04:00",
        "barsUsed": 34,
        "volumeBarsUsed": 34,
        "missingBars": 0,
        "partialBars": 0
      },
      "quality": {
        "status": "available",
        "confidence": "high",
        "flags": [],
        "reasons": []
      }
    },
    {
      "benchmarkId": "extended_session_vwap_1m",
      "kind": "vwap",
      "label": "Extended-session VWAP",
      "value": 1.51,
      "price": 1.45,
      "relation": "below",
      "priceMinusBenchmarkAbs": -0.06,
      "priceMinusBenchmarkPct": -3.97,
      "basis": {
        "timeframe": "1m",
        "requestedTimeframe": "1m",
        "fallbackUsed": false,
        "vwapMode": "extended_session",
        "sessionScope": "extended_session",
        "startTimestamp": "2026-05-04T04:00:00-04:00",
        "endTimestamp": "2026-05-04T10:03:00-04:00",
        "barsUsed": 244,
        "volumeBarsUsed": 244,
        "missingBars": 0,
        "partialBars": 0
      },
      "quality": {
        "status": "available",
        "confidence": "high",
        "flags": [],
        "reasons": []
      }
    }
  ],
  "diagnostics": []
}
```

`trader-intelligence-v2` can translate this into:

```txt
Against regular-session VWAP, entry was above the benchmark. Against extended-session VWAP, entry was below the benchmark, so VWAP evidence was mixed.
```

Avoid:

```txt
You bought above VWAP.
```

---

# 9. Example: Entry 9:31, Exit 9:43

This is where the contract matters most.

At 9:31, regular-session VWAP is technically available, but thin.

Example regular-session VWAP fact:

```json
{
  "benchmarkId": "regular_session_vwap_1m",
  "kind": "vwap",
  "label": "Regular-session VWAP",
  "value": 1.24,
  "price": 1.25,
  "relation": "above",
  "priceMinusBenchmarkAbs": 0.01,
  "priceMinusBenchmarkPct": 0.81,
  "basis": {
    "timeframe": "1m",
    "requestedTimeframe": "1m",
    "fallbackUsed": false,
    "vwapMode": "regular_session",
    "sessionScope": "regular_session",
    "startTimestamp": "2026-05-04T09:30:00-04:00",
    "endTimestamp": "2026-05-04T09:31:00-04:00",
    "barsUsed": 2,
    "volumeBarsUsed": 2,
    "missingBars": 0,
    "partialBars": 0
  },
  "quality": {
    "status": "available",
    "confidence": "low",
    "flags": ["thin_basis"],
    "reasons": ["Regular-session VWAP used only 2 one-minute bars."]
  }
}
```

Example extended-session VWAP fact:

```json
{
  "benchmarkId": "extended_session_vwap_1m",
  "kind": "vwap",
  "label": "Extended-session VWAP",
  "value": 1.38,
  "price": 1.25,
  "relation": "below",
  "priceMinusBenchmarkAbs": -0.13,
  "priceMinusBenchmarkPct": -9.42,
  "basis": {
    "timeframe": "1m",
    "requestedTimeframe": "1m",
    "fallbackUsed": false,
    "vwapMode": "extended_session",
    "sessionScope": "extended_session",
    "startTimestamp": "2026-05-04T04:00:00-04:00",
    "endTimestamp": "2026-05-04T09:31:00-04:00",
    "barsUsed": 182,
    "volumeBarsUsed": 182,
    "missingBars": 0,
    "partialBars": 0
  },
  "quality": {
    "status": "available",
    "confidence": "high",
    "flags": [],
    "reasons": []
  }
}
```

`trader-intelligence-v2` can translate this into:

```txt
Regular-session VWAP was still a thin benchmark because the trade happened shortly after the open. Against the broader extended-session VWAP benchmark, entry was below VWAP.
```

This is much better than pretending the regular-session VWAP reading has full strength at 9:31.

---

# 10. Example: Overnight or Multi-Day Trade

For default behavior:

```txt
VWAP should reset by session.
EMA should remain rolling based on timeframe and available candle history.
```

If entry is on day 1 and exit is on day 2:

```txt
Entry VWAP uses day 1 VWAP through the entry timestamp.
Exit VWAP uses day 2 VWAP through the exit timestamp.
```

Do not use one continuous multi-day VWAP by default.

Example diagnostic:

```json
{
  "code": "MULTI_DAY_VWAP_SESSION_RESET",
  "severity": "info",
  "message": "VWAP was calculated using the active session at each execution timestamp. The exit VWAP reset on the exit session.",
  "affectedBenchmarkIds": [
    "regular_session_vwap_1m",
    "extended_session_vwap_1m"
  ]
}
```

Example exit fact:

```json
{
  "benchmarkId": "regular_session_vwap_1m",
  "kind": "vwap",
  "label": "Regular-session VWAP",
  "value": 2.08,
  "price": 2.05,
  "relation": "below",
  "priceMinusBenchmarkAbs": -0.03,
  "priceMinusBenchmarkPct": -1.44,
  "basis": {
    "timeframe": "1m",
    "requestedTimeframe": "1m",
    "fallbackUsed": false,
    "vwapMode": "regular_session",
    "sessionScope": "regular_session",
    "startTimestamp": "2026-05-05T09:30:00-04:00",
    "endTimestamp": "2026-05-05T10:14:00-04:00",
    "barsUsed": 45,
    "volumeBarsUsed": 45,
    "missingBars": 0,
    "partialBars": 0
  },
  "quality": {
    "status": "available",
    "confidence": "high",
    "flags": ["session_reset"],
    "reasons": ["VWAP reset on the exit session."]
  }
}
```

Later, advanced mode can add:

```txt
anchored_vwap_from_entry
anchored_vwap_from_prior_day_high
anchored_vwap_from_gap_start
```

But these should not be default.

---

# 11. Indicator Disagreement

`levels-system` should not decide whether disagreement is good or bad.

It should return neutral disagreement facts.

Example:

```json
{
  "disagreementId": "vwap_regular_vs_extended_entry",
  "kind": "vwap",
  "benchmarkIds": [
    "regular_session_vwap_1m",
    "extended_session_vwap_1m"
  ],
  "summary": "Entry price was above regular-session VWAP and below extended-session VWAP.",
  "severity": "info"
}
```

Then `trader-intelligence-v2` can translate it into beginner-friendly review language.

Good wording:

```txt
VWAP evidence was mixed. Entry was above the regular-session VWAP benchmark, but below the extended-session VWAP benchmark.
```

Bad wording:

```txt
You were above VWAP.
```

When EMAs disagree, use wording like:

```txt
The shorter-term EMA benchmarks were supportive, but the broader benchmark was still overhead.
```

Avoid:

```txt
The trend was bullish.
```

Prefer:

```txt
The benchmark evidence was short-term supportive but mixed across timeframes.
```

---

# 12. Wording Rules for trader-intelligence-v2

## Rule 1: Always Name the Benchmark

Use:

```txt
Against regular-session VWAP...
```

Avoid:

```txt
Against VWAP...
```

Use:

```txt
Against the 1-minute EMA20 benchmark...
```

Avoid:

```txt
Against the EMA...
```

## Rule 2: Never Imply the System Knows the Trader's Chart

Avoid:

```txt
You were above VWAP on your chart.
```

Use:

```txt
Against the regular-session VWAP benchmark, entry was above VWAP.
```

## Rule 3: Mention Weak Basis When It Changes Interpretation

If quality includes:

```ts
flags: ["thin_basis"]
```

Say:

```txt
This benchmark was still thin because there were only a few regular-session bars.
```

## Rule 4: Use Mixed, Not Wrong

If indicators disagree, say:

```txt
Benchmark evidence was mixed.
```

Avoid:

```txt
The setup was bad.
```

## Rule 5: Keep Judgment Out of levels-system

`levels-system` should return:

```txt
Entry was 2.1% above regular-session VWAP.
Entry was 3.9% below extended-session VWAP.
Regular-session VWAP confidence was high.
Extended-session VWAP confidence was high.
```

`trader-intelligence-v2` can say:

```txt
This entry had mixed VWAP context, so it was not a clean single-benchmark continuation entry.
```

---

# 13. Recommended Request Shape

Keep the current request shape, but add optional market-facts options.

```ts
export interface TradeAnalysisCandleContextRequestV2 {
  symbol: string;
  sessionDate: string;
  asOfTimestamp: string;
  tradeStartTimestamp: string;
  tradeEndTimestamp: string;
  executions: TradeExecutionInput[];
  supportResistance: SupportResistanceRequestInput;
  tradeWindow: TradeWindowRequestInput;
  marketFacts?: MarketFactsRequestOptions;
  chartContext?: OptionalTraderChartContext;
}

export interface TradeExecutionInput {
  executionId?: string;
  timestamp: string;
  price: number;
  quantity: number;
  side: ExecutionSide;
}

export interface SupportResistanceRequestInput {
  lookbackBars: number;
  config?: unknown;
  runtimeOptions?: unknown;
}

export interface TradeWindowRequestInput {
  timeframe: CandleTimeframe;
  preTradeMinutes: number;
  postTradeMinutes: number;
  paddingMinutes: number;
}

export interface MarketFactsRequestOptions {
  contractVersion?: MarketFactsContractVersion;
  benchmarkProfile?: MarketFactsBenchmarkProfile;
  includeDisagreementSummary?: boolean;
  includePostTradeSummary?: boolean;
  noLookaheadPolicy?: NoLookaheadPolicy["policy"];
}

export interface OptionalTraderChartContext {
  primaryTimeframe?: CandleTimeframe;
  vwapMode?: "regular_session" | "extended_session" | "anchored" | "platform_unknown";
}
```

Recommended defaults:

```ts
export const DEFAULT_MARKET_FACTS_OPTIONS: Required<MarketFactsRequestOptions> = {
  contractVersion: "market_facts.trade_review.v2",
  benchmarkProfile: "small_cap_day_trade_v1",
  includeDisagreementSummary: true,
  includePostTradeSummary: true,
  noLookaheadPolicy: "closed_candles_only"
};
```

`chartContext` should stay optional. The product should work without it.

---

# 14. Optional Chart Context

Later, you can add:

```ts
chartContext: {
  primaryTimeframe: "5m",
  vwapMode: "extended_session"
}
```

But this should only change interpretation priority and wording.

For example:

```txt
If chartContext.primaryTimeframe is 5m, trader-intelligence-v2 may emphasize 5-minute EMA facts more strongly.
```

It still should not say:

```txt
This is what the trader saw.
```

Unless chart settings were explicitly captured.

---

# 15. Anchored VWAP Recommendation

Do not add vague anchored VWAP by default.

Require an explicit anchor:

```ts
export interface AnchoredVwapBenchmarkRequest {
  anchor: AnchoredVwapAnchor;
}

export interface AnchoredVwapAnchor {
  type:
    | "trade_entry"
    | "premarket_high"
    | "premarket_low"
    | "gap_start"
    | "manual";
  timestamp: string;
  price?: number;
}
```

Benchmark IDs should be explicit:

```txt
anchored_vwap_from_trade_entry
anchored_vwap_from_premarket_high
anchored_vwap_from_premarket_low
anchored_vwap_from_gap_start
```

No explicit anchor means no anchored VWAP.

---

# 16. Phased Implementation Plan

## Phase 1: Preserve Current API and Add No-Lookahead Tests

Keep the current API stable.

Add tests for:

```txt
Entry at 10:03 does not use candles ending after 10:03.
Exit at 10:14 does not use candles ending after 10:14.
Post-trade facts do not influence execution facts.
Multi-execution trades calculate each execution independently.
```

Also normalize candle timestamps internally.

Every candle should have:

```txt
startTimestamp
endTimestamp
```

Do not rely only on a candle label like `10:03`, because different systems label candles differently.

## Phase 2: Add marketFacts Beside Existing Fields

Do not break:

```txt
executionRelations
tradeWindowFacts
```

Add:

```txt
marketFacts
```

At first, `marketFacts` can wrap facts you already calculate.

The first important addition is basis metadata:

```txt
timeframe
requestedTimeframe
fallbackUsed
startTimestamp
endTimestamp
barsUsed
missingBars
partialBars
```

And quality metadata:

```txt
status
confidence
flags
reasons
```

## Phase 3: Add Dual VWAP

Add both:

```txt
regular_session_vwap_1m
extended_session_vwap_1m
```

This is probably the highest-value product improvement after the no-lookahead fix.

For small-cap review, this is more useful than adding many EMA variants.

## Phase 4: Add Disagreement Summary

Once both VWAPs exist, add:

```txt
disagreementSummary
```

This lets `trader-intelligence-v2` produce clean beginner language like:

```txt
VWAP evidence was mixed.
```

Instead of manually inferring every contradiction.

## Phase 5: Add Enriched Benchmark Profile

Add:

```ts
"small_cap_day_trade_enriched_v1"
```

With:

```txt
ema9_5m
ema20_5m
```

Do not force these into the beginner default.

Use enriched mode for:

```txt
advanced reports
deeper reviews
users who want more technical breakdowns
```

## Phase 6: Add Optional Chart Context

Later, allow:

```ts
chartContext: {
  primaryTimeframe: "5m",
  vwapMode: "extended_session"
}
```

This should affect weighting and wording, not the basic ability to run the review.

## Phase 7: Add Anchored VWAP Only with Explicit Anchors

Require:

```ts
anchor: {
  type: "trade_entry" | "premarket_high" | "premarket_low" | "gap_start" | "manual";
  timestamp: string;
  price?: number;
}
```

No explicit anchor, no anchored VWAP.

---

# Final Recommendation

Use this default benchmark profile:

```txt
small_cap_day_trade_v1
```

Returning these facts:

```txt
regular_session_vwap_1m
extended_session_vwap_1m
ema9_1m
ema20_1m
nearest_support
nearest_resistance
```

Every benchmark relation should include:

```txt
benchmarkId
label
kind
value
relation
priceMinusBenchmarkPct
basis
quality
diagnostics
```

The most important metadata fields are:

```txt
basis.startTimestamp
basis.endTimestamp
basis.barsUsed
basis.fallbackUsed
quality.confidence
quality.flags
quality.reasons
```

This design:

- avoids pretending the system knows the trader's chart
- avoids forcing new traders to configure indicators
- supports early-open trades
- supports normal intraday trades
- supports overnight and multi-day trades
- keeps market calculations inside `levels-system`
- keeps review language inside `trader-intelligence-v2`
- gives beginner-friendly explanations without false certainty
- stays practical to implement in TypeScript

The central product principle is:

> Return named benchmark evidence, not overconfident chart truth.

---

# Implementation Note: First Additive Slice In levels-system

Added by levels-system Codex on 2026-05-04.

The first additive implementation slice is now in `buildTradeAnalysisCandleContext(...)`.

Implemented:

```ts
context.marketFacts
```

Current contract version:

```ts
"market_facts.trade_review.v2"
```

Current benchmark profile:

```ts
"small_cap_day_trade_v1"
```

Current benchmark definitions:

```txt
regular_session_vwap_1m
extended_session_vwap_1m
ema9_1m
ema20_1m
nearest_support
nearest_resistance
```

Implemented enriched profile additions:

```txt
ema9_5m
ema20_5m
```

The implementation is intentionally additive. Existing response fields remain:

```txt
tradeWindow
tradeWindowFacts
executionRelations
supportResistanceContext
diagnostics
```

Implemented behavior:

- one `marketFacts.executionSnapshots[]` item per execution/fill
- named benchmark relations per execution
- basis metadata per relation
- quality metadata per relation
- regular-session VWAP from 9:30 ET through the execution snapshot
- extended-session VWAP from 4:00 ET through the execution snapshot
- EMA9/EMA20 over available rolling trade-window candles through the execution
  snapshot
- explicit closed-candle no-lookahead policy metadata
- regular-vs-extended VWAP disagreement summary
- thin regular-session VWAP diagnostics near the open
- fallback/stale/missing/warmup quality flags where applicable
- support/resistance benchmark relations in `marketFacts.executionSnapshots`
- `tradeWindowSummary`
- `postTradeSummary`
- enriched profile with 5m EMA variants
- `trader-intelligence-v2` raw timeline result now exposes
  `levelsSystemMarketFacts`

Known remaining work:

- add optional chartContext later as weighting/wording context only
- add anchored VWAP only when anchors are explicit
- update deeper trader-intelligence-v2 review wording to prefer
  `levelsSystemMarketFacts`

Consumer guidance:

`trader-intelligence-v2` can migrate new review language toward
`marketFacts.executionSnapshots` while keeping compatibility with
`executionRelations` and `tradeWindowFacts`.
