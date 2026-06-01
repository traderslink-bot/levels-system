# Levels System 15m Facts Real-Cache Validation With Supplied 15m

## Purpose

This gate validates `LevelAnalysisSnapshot` with the five existing local IBKR
15m cache files collected in the operator-write gate.

The goal is to confirm that supplied real 15m data populates
`timeframeFacts["15m"]`, remains facts-only and no-lookahead safe, and does not
change LevelEngine support/resistance output versus equivalent snapshots built
without 15m input.

This gate does not collect more cache data, overwrite cache files, use Twelve
Data, change LevelEngine behavior, tune support/resistance detection, change
runtime defaults, change alert/monitoring/Discord behavior, modify the journal
app, or add journal interpretation.

## Cache Source

Validation used the existing local IBKR validation cache:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

No network calls were made. The cache was read only. No raw `.validation-cache`
files are committed.

Cache coverage at validation time:

| Metric | Count |
| --- | ---: |
| Provider/symbol groups | 357 |
| Total cache JSON files | 2279 |
| Validation cache entries | 2279 |
| `5m` JSON files | 1219 |
| `15m` JSON files | 5 |
| `4h` JSON files | 584 |
| Daily JSON files | 471 |
| Groups with any `15m` | 5 |
| Groups with `5m`/`15m`/`4h`/daily | 5 |
| Malformed JSON files | 0 |
| Non-JSON files ignored | 0 |

Symbols with 15m:

```text
ibkr/DEVS, ibkr/DXYZ, ibkr/ENVX, ibkr/GME, ibkr/QUBT
```

## Selected Symbols

The validation set is intentionally limited to the first operator-written 15m
target set:

```text
DEVS, ENVX, DXYZ, QUBT, GME
```

The supplied 15m file used for each symbol:

```text
ibkr/<SYMBOL>/15m/100-1780329600000.json
```

The validation as-of timestamp was:

```text
2026-06-01T16:00:00.000Z
```

This matches the operator-write end time and includes the 15m candles whose
close is at or before that boundary.

## Validation Method

An offline `npx tsx -` validation harness:

1. inspected the local cache coverage;
2. selected only `DEVS`, `ENVX`, `DXYZ`, `QUBT`, and `GME`;
3. loaded the latest cached `5m`, `4h`, `daily`, and supplied `15m` files for
   each symbol;
4. built one snapshot with supplied 15m input and one equivalent snapshot
   without 15m input for each symbol;
5. used the same symbol, as-of timestamp, reference price, previous close, and
   higher/lower timeframe candle inputs for each pair;
6. validated snapshot identity, producer identity, `inputSummary`, diagnostics,
   safety flags, and `timeframeFacts["15m"]`;
7. ran `validateFifteenMinuteFacts(timeframeFacts["15m"])`;
8. ran the facts-only 15m boundary assertion;
9. compared LevelEngine output, nearest levels, surfaced buckets, extension
   levels, and LevelQualityAudit with and without 15m input;
10. wrote compact validation artifacts only.

## Per-Symbol Summary

| Symbol | 15m raw/filtered | 15m fact status | LevelEngine parity | Nearest parity | Quality parity |
| --- | ---: | --- | --- | --- | --- |
| `DEVS` | 96/96 | available | pass | pass | pass |
| `ENVX` | 96/96 | available | pass | pass | pass |
| `DXYZ` | 96/96 | available | pass | pass | pass |
| `QUBT` | 96/96 | available | pass | pass | pass |
| `GME` | 96/96 | available | pass | pass | pass |

All five supplied-15m snapshots passed.

## 15m Facts Summary

For every selected symbol:

- `schemaVersion` remained `level-analysis-snapshot/v1`;
- `producer` remained `levels-system`;
- `inputSummary.candleCounts["15m"]` was `96`;
- `inputSummary.filteredCandleCounts["15m"]` was `96`;
- `inputSummary.timeframes["15m"].provided` was `true`;
- `inputSummary.timeframesPresent` included `15m`;
- `timeframeFacts["15m"]` existed;
- `validateFifteenMinuteFacts(timeframeFacts["15m"])` passed;
- `timeframeFacts["15m"].dataCompleteness.provided` was `true`;
- `timeframeFacts["15m"].dataCompleteness.closedCandleCount` was `96`;
- 15m fact diagnostics included `15m_facts_generated`;
- 15m fact safety flags were true.

The generated 15m facts remained factual range, trend, volume, structure,
diagnostic, limitation, and safety context only.

## LevelEngine Parity Summary

For every selected symbol, the snapshot built with supplied 15m input matched
the equivalent snapshot without 15m input for:

- `levelEngineOutput`;
- nearest support;
- nearest resistance;
- major support/resistance buckets;
- intermediate support/resistance buckets;
- intraday support/resistance buckets;
- extension support/resistance levels;
- `LevelQualityAudit`.

The LevelEngine metadata did not include `15m` as a provider timeframe. This
confirms supplied 15m facts did not create or alter support/resistance levels.

## No-Lookahead Summary

The validation as-of timestamp was `2026-06-01T16:00:00.000Z`.

For every selected symbol:

- 15m raw candle count was `96`;
- 15m filtered candle count was `96`;
- excluded future 15m candle count was `0`;
- excluded partial 15m candle count was `0`;
- snapshot `safety.noLookaheadApplied` was `true`;
- 15m facts `safety.noLookaheadApplied` was `true`.

The snapshot diagnostics included:

```text
15m_facts_generated
candle_close_as_of_filter_applied
```

## Diagnostics Summary

Observed diagnostics were factual input/safety diagnostics only. They did not
introduce trading instructions, journal grading, coaching, recommendations, or
trade advice.

`LevelQualityAudit` remained stable with and without supplied 15m input.

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-supplied-real-cache-validation/latest-15m-supplied-real-cache-validation.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-supplied-real-cache-validation/latest-15m-supplied-real-cache-validation.txt
```

The artifacts contain summary metadata, selected source file paths relative to
the cache root, per-symbol 15m fact summaries, parity booleans, diagnostics,
and safety summaries. They do not contain raw candle arrays or full raw
snapshots.

## Failures Or Limitations

No validation failures were observed.

Limitations:

- coverage is intentionally limited to the five first-write target symbols;
- this is local real-cache validation, not a fresh provider fetch;
- this gate does not expand the 15m cache universe;
- this gate does not evaluate whether 15m facts should feed LevelEngine in the
  future.

## Production Bug Assessment

No production bug was found.

The supplied real IBKR 15m cache files successfully populate
`timeframeFacts["15m"]`, pass validation, remain facts-only, and preserve
LevelEngine support/resistance output parity.

## Anti-Goals

This gate did not:

- collect new cache data;
- write or overwrite 15m cache files;
- broaden the symbol list;
- use Twelve Data;
- add 15m to LevelEngine support/resistance generation;
- tune support/resistance detection;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_engine_multi_timeframe_level_quality_review
```

Reason: supplied real 15m facts now validate cleanly and LevelEngine output
remains stable. The next main levels-system improvement should review level
quality across multi-timeframe data rather than continuing infrastructure.
