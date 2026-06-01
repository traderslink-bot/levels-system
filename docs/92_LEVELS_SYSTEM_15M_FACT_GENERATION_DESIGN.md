# Levels System 15m Fact Generation Design

## Purpose

This document defines how `levels-system` should eventually add 15m-derived
factual context to `LevelAnalysisSnapshot` without prematurely feeding 15m
candles into LevelEngine support/resistance detection.

This is a design and contract gate only. It does not implement 15m fact
generation, tune support/resistance behavior, change LevelEngine output, change
runtime-mode defaults, change alerts, change monitoring, change Discord
behavior, or add journal interpretation.

## Current 15m Status

`15m` is already part of the locked `LevelAnalysisSnapshot` v1 input summary
surface:

- `inputSummary.timeframes["15m"]`
- `inputSummary.candleCounts["15m"]`
- `inputSummary.filteredCandleCounts["15m"]`
- `inputSummary.excludedFutureCandleCounts["15m"]`
- `inputSummary.excludedPartialCandleCounts["15m"]`
- `inputSummary.timeframesPresent`

The from-candles builder and runner can accept optional 15m candles. Supplied
15m candles are parsed, filtered with candle-close no-lookahead semantics, and
counted in `inputSummary`.

Current hard boundary:

- 15m candles are not included in `levelEngineSeries`.
- 15m candles are not used for candidate generation.
- 15m candles are not used for clustering, scoring, ranking, surfaced buckets,
  or extension generation.
- supplied 15m input is diagnosed as reserved for future fact generation.

## Why 15m Facts May Matter

15m sits between intraday execution detail and higher-timeframe structure. It
can add useful factual context that 5m alone may make noisy and 4h/daily may
make too coarse.

Useful future contributions include:

- whether closed 15m candles show directional continuity or mixed rotation;
- whether recent 15m candles are compressing or expanding;
- whether the current price is near the recent 15m high or low range;
- whether participation on 15m bars is building, fading, or unavailable;
- whether the latest move is extended relative to recent 15m ranges;
- whether 15m data coverage is sufficient for downstream inspection.

These are chart-context facts. They are not levels, signals, instructions, or
journal conclusions.

## What 15m Should Provide

15m facts should describe closed-candle context only.

Allowed factual categories:

- data availability and completeness;
- closed candle count and time span;
- recent 15m high and low;
- current price relationship to the recent 15m range;
- 15m trend direction over a fixed closed-candle window;
- 15m compression or expansion state;
- 15m average range and latest range expansion;
- 15m volume participation summary when volume exists;
- 15m session structure summary;
- neutral momentum or continuation context;
- pullback or consolidation facts;
- diagnostics and limitations.

The facts should be deterministic, serializable, and computed from the same
closed 15m candle array already reported in `inputSummary`.

## What 15m Must Not Provide

15m facts must not:

- create support or resistance levels in this phase;
- alter LevelEngine candidate generation;
- alter LevelEngine ranking, scoring, clustering, or extensions;
- change surfaced support/resistance buckets;
- override 5m, 4h, or daily level maps;
- create synthetic historical evidence;
- create alert behavior;
- create monitoring behavior;
- create Discord behavior;
- create buy/sell/hold recommendations;
- create entry or exit decisions;
- grade trades;
- coach users;
- compute P/L;
- compute giveback;
- score behavior;
- label a trade as good, bad, mistaken, or disciplined.

Any later interpretation layer must consume these facts through an explicit
separate rule set with its own tests.

## Proposed Fact Categories

### Data Completeness

Data completeness should answer whether 15m facts are available and how much
closed data they used.

Candidate fields:

```ts
type FifteenMinuteDataCompleteness = {
  provided: boolean;
  closedCandleCount: number;
  rawCandleCount: number;
  excludedFutureCandleCount: number;
  excludedPartialCandleCount: number;
  firstClosedTimestamp?: number;
  lastClosedTimestamp?: number;
  sufficientForTrendFacts: boolean;
  sufficientForVolumeFacts: boolean;
};
```

### Range Context

Range facts should summarize the recent 15m window without calling those prices
support or resistance.

Candidate fields:

```ts
type FifteenMinuteRangeFacts = {
  lookbackCandleCount: number;
  recentHigh?: number;
  recentLow?: number;
  recentMidpoint?: number;
  latestRangePct?: number;
  averageRangePct?: number;
  rangeState: "unknown" | "compressed" | "normal" | "expanded";
  referencePosition:
    | "unknown"
    | "below_recent_range"
    | "near_recent_low"
    | "inside_recent_range"
    | "near_recent_high"
    | "above_recent_range";
};
```

### Trend Context

Trend facts should describe observed candle direction and close location. They
must not imply a trade action.

Candidate fields:

```ts
type FifteenMinuteTrendFacts = {
  trendState: "unknown" | "mixed" | "up" | "down" | "sideways";
  higherCloseCount: number;
  lowerCloseCount: number;
  greenCandleCount: number;
  redCandleCount: number;
  latestCloseLocation:
    | "unknown"
    | "upper_third"
    | "middle_third"
    | "lower_third";
};
```

### Volume Participation

Volume facts should stay separate from 5m `volumeFacts` and remain factual.

Candidate fields:

```ts
type FifteenMinuteVolumeFacts = {
  volumeState: "unknown" | "low" | "normal" | "elevated" | "high" | "extreme";
  latestVolume?: number;
  rollingAverageVolume?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  participationState:
    | "unknown"
    | "fading"
    | "steady"
    | "building"
    | "surging";
};
```

### Structure Summary

Structure facts should summarize the 15m candle sequence without building
support/resistance.

Candidate fields:

```ts
type FifteenMinuteStructureFacts = {
  consolidationState: "unknown" | "not_present" | "present";
  pullbackState: "unknown" | "not_present" | "present";
  continuationState: "unknown" | "not_present" | "present";
  recentHighTimestamp?: number;
  recentLowTimestamp?: number;
};
```

## Proposed Schema Additions

Recommended future shape:

```ts
type LevelAnalysisSnapshotTimeframeFacts = {
  "15m"?: FifteenMinuteFacts;
};

type FifteenMinuteFacts = {
  schemaVersion: "level-analysis-15m-facts/v1";
  symbol: string;
  asOfTimestamp: number;
  dataCompleteness: FifteenMinuteDataCompleteness;
  range: FifteenMinuteRangeFacts;
  trend: FifteenMinuteTrendFacts;
  volume?: FifteenMinuteVolumeFacts;
  structure: FifteenMinuteStructureFacts;
  diagnostics: FifteenMinuteFactDiagnostic[];
  limitations: string[];
  safety: {
    noLookaheadApplied: boolean;
    levelOutputUnchanged: true;
    factsOnly: true;
    noRuntimeBehaviorChange: true;
  };
};
```

Recommended snapshot location:

```ts
type LevelAnalysisSnapshot = {
  // existing fields...
  timeframeFacts?: LevelAnalysisSnapshotTimeframeFacts;
};
```

Why `timeframeFacts` is preferred:

- it matches the existing locked timeframe keys;
- it avoids a one-off top-level `fifteenMinuteFacts` field;
- it leaves room for future timeframe-specific facts without changing the
  overall pattern;
- it keeps facts separate from `levelEngineOutput`, `levelIntelligenceReport`,
  and `levelQualityAudit`;
- it can be additive and optional for v1 consumers that preserve unknown fields.

Compatibility recommendation:

- keep the field optional;
- do not require it for v1 fixture parsing;
- document it as an additive v1-compatible facts extension only after a contract
  gate adds deterministic fixtures;
- consider a v2 only if the field becomes required or changes existing locked
  v1 semantics.

## Diagnostics And Safety Rules

Future 15m fact generation should use factual diagnostics such as:

- `15m_facts_generated`
- `15m_facts_unavailable`
- `15m_closed_candles_missing`
- `15m_insufficient_trend_history`
- `15m_insufficient_volume_history`
- `15m_future_candles_filtered`
- `15m_partial_candles_filtered`

Diagnostics must explain data availability, filtering, or limitations. They
must not instruct a trader or score a trade.

Safety flags should include:

- `noLookaheadApplied: true` only when all facts use closed 15m candles at or
  before `asOfTimestamp`;
- `levelOutputUnchanged: true`;
- `factsOnly: true`;
- `noRuntimeBehaviorChange: true`.

If safety cannot be confirmed, 15m facts should be omitted or marked
unavailable with limitations.

## No-Lookahead Rules

15m facts must use the existing candle-close as-of semantics:

- exclude candles whose start timestamp is after `asOfTimestamp`;
- exclude candles whose close timestamp is after `asOfTimestamp`;
- report excluded future and partial counts in both `inputSummary` and 15m fact
  diagnostics;
- use the filtered 15m candle array only;
- set 15m fact `asOfTimestamp` equal to the snapshot `asOfTimestamp`;
- never derive facts from future 5m, 15m, 4h, or daily candles.

Appending future or still-forming 15m candles must not change an as-of snapshot's
15m facts.

## Interaction With LevelEngine

15m facts must remain outside LevelEngine.

The builder should continue to filter `levelEngineSeries` with:

```ts
item.timeframe !== "15m"
```

Future 15m fact builders may read filtered 15m candles, but they must not:

- call `detectSwingPoints`;
- call `buildRawLevelCandidates`;
- call `clusterRawLevelCandidates`;
- call `scoreLevelZones`;
- call `rankLevelZones`;
- mutate `LevelEngineOutput`;
- alter `LevelEngineOutput.metadata.providerByTimeframe`;
- alter surfaced buckets or extension ladders.

Tests must compare snapshots with and without 15m facts and prove
`levelEngineOutput` remains identical when all non-15m inputs are identical.

## Interaction With LevelAnalysisSnapshot

Future integration should happen after `inputSummary` and before final snapshot
serialization:

1. filter 15m candles with candle-close as-of semantics;
2. build `inputSummary` as today;
3. build LevelEngine output from 5m, 4h, and daily only;
4. build existing 5m/session/volume/shelf/market-context facts as today;
5. build optional `timeframeFacts["15m"]` from filtered 15m candles;
6. pass the optional facts into `buildLevelAnalysisSnapshot`;
7. preserve existing safety flags and diagnostics.

The snapshot should remain valid when 15m facts are absent.

## Interaction With Journal Consumption

TraderLink Intelligence / the journal should treat 15m facts as factual chart
context only.

Downstream adapter behavior should:

- preserve raw snapshots unchanged;
- tolerate absent `timeframeFacts`;
- surface 15m facts as context/limitations only;
- keep existing LevelAnalysisSnapshot v1 validation centered on schemaVersion,
  producer, no-lookahead, safety, diagnostics, and raw preservation;
- avoid turning 15m facts into trade grades, coaching, P/L, giveback, behavior
  scoring, recommendations, or trade advice.

Journal-side consumption should not be updated until the levels-system contract
and fixtures exist.

## Fixture And Test Strategy

The next contract gate should add deterministic fixtures before implementation
logic.

Recommended fixture set:

- 15m unavailable: no supplied 15m input;
- 15m limited: supplied but too few closed candles;
- 15m available mixed: enough closed candles with sideways/mixed state;
- 15m compression: closed candles with narrow ranges;
- 15m expansion: closed candles with expanding range;
- 15m future/partial appended: proves no-lookahead stability.

Recommended tests:

- type/shape validation for `FifteenMinuteFacts`;
- fixture serialization and deterministic output;
- no-lookahead filtering for 15m facts;
- no mutation of candle inputs;
- `levelEngineOutput` equality with and without 15m facts;
- no imports from alert, monitoring, Discord, runtime, or journal paths;
- forbidden language guard.

## Rollout Phases

1. `levels_system_15m_facts_contract`
   Define additive optional TypeScript contract types and deterministic sample
   objects. Do not implement fact builders yet.

2. `levels_system_15m_facts_fixture_pack`
   Add compact fixture cases for unavailable, limited, available, compression,
   expansion, and no-lookahead stability.

3. `levels_system_15m_facts_builder`
   Implement a pure facts-only builder from filtered 15m candles. Keep it
   isolated from LevelEngine and runtime paths.

4. `level_analysis_snapshot_15m_facts_integration`
   Add optional `timeframeFacts["15m"]` to snapshots behind additive v1-compatible
   behavior. Update schema docs, fixtures, and downstream adapter expectations.

5. `level_analysis_snapshot_15m_real_cache_validation`
   Validate against real cached symbols once 15m cache exists.

6. `level_engine_multi_timeframe_level_quality_review`
   Review whether any future LevelEngine use is justified. This must be a
   separate behavior gate with explicit evidence and tests.

## Anti-Goals

This design does not:

- implement 15m fact generation;
- add production 15m fact fields;
- feed 15m candles into LevelEngine;
- tune support/resistance detection;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- change journal-side code;
- add grading, coaching, P/L, giveback, behavior scoring, recommendations, or
  trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_facts_contract
```

Reason: the design is now explicit. The next safe step is an additive,
facts-only TypeScript contract and deterministic fixture-like sample objects,
still without fact-generation logic or LevelEngine integration.
