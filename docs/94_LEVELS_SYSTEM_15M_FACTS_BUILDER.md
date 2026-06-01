# Levels System 15m Facts Builder

## Purpose

This document records the pure facts-only 15m facts builder for
`LevelAnalysisSnapshot`.

The builder computes deterministic `FifteenMinuteFacts` from already-filtered,
closed 15m candles. It gives snapshots optional 15m chart context without
feeding 15m candles into LevelEngine, without changing support/resistance
detection, and without adding journal interpretation.

## Builder Behavior

New module:

```text
src/lib/analysis/level-analysis-15m-facts-builder.ts
```

Primary helpers:

- `buildFifteenMinuteFacts(input)`
- `buildUnavailableFifteenMinuteFactsFromInput(input)`
- `summarizeFifteenMinuteCandleWindow(candles, referencePrice)`

Builder input:

- `symbol`
- `asOfTimestamp`
- optional `referencePrice`
- raw supplied 15m candle count
- filtered/closed 15m candles
- excluded future candle count
- excluded partial candle count

Builder output:

- `FifteenMinuteFacts`

The builder clones candle rows before deriving facts and does not mutate inputs.

## Thresholds Used

The first implementation intentionally uses simple deterministic thresholds:

- trend facts require at least 4 closed 15m candles;
- volume facts require at least 4 closed 15m candles with volume;
- `rangeState` is:
  - `compressed` when latest range percent is at or below `0.75 * averageRangePct`;
  - `expanded` when latest range percent is at or above `1.5 * averageRangePct`;
  - `normal` otherwise;
  - `unknown` when there is not enough closed-candle coverage.
- `trendState` is derived from higher/lower close counts plus green/red candle
  counts;
- `volumeState` is derived from latest volume relative to rolling average
  volume;
- `participationState` is derived from relative volume;
- `referencePosition` is derived from the recent 15m high/low thirds.

These thresholds are contract-grade and deterministic. They are not support or
resistance tuning.

## Unavailable Limited Available Behavior

Unavailable:

- no closed 15m candles are available;
- facts include `availabilityStatus: "unavailable"`;
- limitations explain missing 15m input or missing closed 15m candles;
- safety flags remain true because no future data is used.

Limited:

- closed 15m candles exist but are below the trend threshold;
- facts include `availabilityStatus: "limited"`;
- range and candle counts are still factual;
- trend and volume sufficiency flags are false;
- limitations record insufficient trend/volume history.

Available:

- at least 4 closed 15m candles are available;
- facts include `availabilityStatus: "available"`;
- range, trend, volume, structure, diagnostics, limitations, and safety are
  populated from closed candles only.

## No-Lookahead Behavior

The builder expects already-filtered/closed candles. The from-candles snapshot
path applies the existing candle-close as-of filter before invoking the builder.

No-lookahead rules:

- future 15m candles are excluded before fact building;
- still-forming 15m candles are excluded before fact building;
- excluded future/partial counts are reported in `dataCompleteness`;
- computed range/trend/volume/structure facts depend only on closed candles;
- appending future or still-forming 15m candles does not change the computed
  closed-candle fact sections for the same as-of boundary.

## Snapshot Integration

When optional 15m input is supplied to `buildLevelAnalysisSnapshotFromCandles`,
the snapshot now includes:

```ts
timeframeFacts: {
  "15m": FifteenMinuteFacts
}
```

When 15m input is absent, `timeframeFacts` remains omitted.

Snapshot diagnostics now include factual 15m fact status for supplied input:

- `15m_facts_generated`
- `15m_facts_limited`
- `15m_facts_unavailable`
- existing future/partial filter diagnostics when applicable

The older `15m_candles_reserved_for_future_fact_generation` diagnostic remains
available only for lower-level composition paths that pass 15m candles without
supplying 15m facts.

## LevelEngine Unchanged Guarantee

15m remains outside LevelEngine.

The from-candles builder still filters the engine input series with:

```ts
item.timeframe !== "15m"
```

The 15m facts builder does not import or call:

- swing detection;
- raw candidate generation;
- clustering;
- scoring;
- ranking;
- extension generation;
- LevelEngine runtime paths.

Focused tests compare snapshots with and without supplied 15m facts and verify:

- `levelEngineOutput` is unchanged;
- nearest support/resistance is unchanged;
- surfaced buckets are unchanged through unchanged `levelEngineOutput`;
- extension levels are unchanged through unchanged `levelEngineOutput`.

## Facts-Only Boundary

15m facts may describe:

- data completeness;
- recent high/low/midpoint;
- latest and average range percent;
- range state;
- reference position inside the recent 15m range;
- higher/lower close counts;
- green/red candle counts;
- latest close location;
- volume participation;
- simple structure states;
- diagnostics and limitations.

15m facts must not:

- create support or resistance levels;
- create raw level candidates;
- alter LevelEngine output;
- change alert, monitoring, or Discord behavior;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Fixture And Test Coverage

Focused tests:

```text
src/tests/level-analysis-15m-facts-builder.test.ts
```

Coverage includes:

- unavailable and limited facts;
- available deterministic 15m facts;
- range, trend, volume, and structure calculations;
- no-lookahead filtering counts;
- snapshot integration;
- unchanged `levelEngineOutput`;
- facts-only boundary checks;
- source isolation from LevelEngine, alerts, monitoring, and Discord paths.

Existing runner and snapshot tests were updated narrowly to expect
`timeframeFacts["15m"]` when 15m input is supplied.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_facts_real_cache_validation
```

Reason: deterministic builder tests now pass. The next safe step is validating
the facts builder against real cached symbols. If real 15m cache coverage is
still absent, the validation gate should document that gap and validate the
absent/unavailable fallback path.
