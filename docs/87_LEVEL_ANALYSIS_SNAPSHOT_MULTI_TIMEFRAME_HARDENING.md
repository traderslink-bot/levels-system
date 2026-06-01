# LevelAnalysisSnapshot Multi-Timeframe Hardening

## Purpose

This gate hardens `LevelAnalysisSnapshot` v1 multi-timeframe reporting for
downstream TraderLink Intelligence / journal consumption.

The work focuses on inputSummary completeness, no-lookahead filtering, runner
support, and the reserved `15m` path. It does not tune support/resistance
detection, change LevelEngine default behavior, change runtime-mode defaults,
change alert/monitoring/Discord behavior, or add journal interpretation.

## Current V1 Timeframe Contract

The locked v1 snapshot contract requires these `inputSummary` timeframe keys:

- `5m`
- `15m`
- `4h`
- `daily`

Each timeframe must appear in:

- `timeframesPresent`
- `candleCounts`
- `filteredCandleCounts`
- `excludedFutureCandleCounts`
- `excludedPartialCandleCounts`
- `timeframes`

Each per-timeframe summary includes:

- `provided`
- `candleCount`
- `filteredCandleCount`
- `excludedFutureCandleCount`
- `excludedPartialCandleCount`

## Current 15m Status

`15m` is now a hardened optional input path for snapshot summary and
no-lookahead readiness.

When supplied, `15m` candles are:

- parsed by the runner through `--candles-15m`
- filtered with candle-close as-of semantics
- counted in `inputSummary`
- included in `timeframesPresent` when filtered count is positive
- marked with `15m_candles_reserved_for_future_fact_generation`

`15m` candles remain reserved and are not fed into LevelEngine candidate
generation, clustering, scoring, ranking, surfaced buckets, or extension
generation.

## Discovered Gaps

Before this gate:

- `15m` existed in the schema as a zero-count placeholder only.
- the from-candles builder did not accept 15m input.
- the runner did not accept `--candles-15m`.
- from-candles `inputSummary.candleCounts` reported filtered counts instead of
  raw provided counts.
- future and still-forming candle exclusions were applied but not visible in
  `inputSummary`.

## Hardening Decisions

Decisions made in this gate:

1. Keep `15m` reserved for future fact generation and readiness.
2. Accept optional 15m candles in the from-candles builder and runner.
3. Do not include 15m candles in LevelEngine level generation.
4. Report raw provided candle counts separately from filtered candle counts.
5. Report excluded future and partial candle counts by timeframe.
6. Add diagnostics when 15m is supplied and reserved.
7. Preserve LevelEngine output for equivalent snapshots with and without 15m.

## No-Lookahead Rules By Timeframe

All supplied candle files are filtered by candle close as of `asOfTimestamp`.

- `5m`: a candle is usable only after timestamp + 5 minutes is at or before
  `asOfTimestamp`.
- `15m`: a candle is usable only after timestamp + 15 minutes is at or before
  `asOfTimestamp`.
- `4h`: a candle is usable only after timestamp + 4 hours is at or before
  `asOfTimestamp`.
- `daily`: a candle is usable only after the New York session close for that
  daily session is at or before `asOfTimestamp`.

Candles that start after `asOfTimestamp` are counted as future exclusions.
Candles that started at or before `asOfTimestamp` but have not closed are
counted as partial exclusions.

## InputSummary Expectations

For every locked timeframe key:

- `candleCounts[timeframe]` is the raw provided candle count.
- `filteredCandleCounts[timeframe]` is the usable closed candle count.
- `excludedFutureCandleCounts[timeframe]` is the number of future-start candles
  removed.
- `excludedPartialCandleCounts[timeframe]` is the number of still-forming
  candles removed.
- `timeframes[timeframe].provided` is true only when a candle array was supplied.
- `timeframesPresent` includes only timeframes with positive filtered count.

Absent reserved 15m input still appears with zero counts and `provided: false`.

## Runner Expectations

The runner now accepts:

```text
--candles-15m <path>
```

The argument is optional. When provided, the runner parses the 15m JSON using
the same local-file candle parser used for other timeframes.

Runner output must remain:

- schema v1
- producer `levels-system`
- no-lookahead safe
- facts-only
- free of downstream journal interpretation language

## Fixture And Test Coverage Added

Added:

- `docs/examples/level-analysis-snapshot/sample-15m-candles.json`
- `src/tests/level-analysis-snapshot-multi-timeframe-hardening.test.ts`

Coverage includes:

- reserved 15m absent behavior
- optional 15m provided behavior
- LevelEngine output equality with and without 15m
- future and partial exclusions across 5m, 15m, 4h, and daily
- runner `--candles-15m` parsing and output
- schema locked timeframe key compatibility
- factual-language boundary guard

Runner packaging, runner smoke, and from-candles tests were also narrowed to
cover the new 15m input path and the hardened count semantics.

## What Remains Intentionally Unchanged

This gate does not change:

- support/resistance detection behavior
- LevelEngine default output behavior
- LevelEngine timeframe config
- LevelEngine bucket definitions
- LevelEngine candidate generation
- LevelEngine scoring, ranking, clustering, or extension generation
- runtimeMode defaults
- alert behavior
- monitoring behavior
- Discord behavior
- trader-context behavior
- journal grading, coaching, P/L, giveback, behavior scoring, recommendations,
  or trade advice

## Recommended Next Gate

`level_analysis_snapshot_multi_timeframe_real_cache_validation`

Reason: deterministic fixtures now prove the hardened multi-timeframe contract.
The next best step is to validate the same behavior against real cached symbols
before any future LevelEngine 15m level-quality review.
