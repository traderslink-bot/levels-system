# Levels System 15m Facts Real-Cache Validation

## Purpose

This gate validates the `LevelAnalysisSnapshot` 15m facts path against the
available local real cache.

The goal is to confirm that the new 15m facts contract is safe for downstream
snapshot consumption while preserving the LevelEngine boundary. This gate does
not tune support/resistance detection, change LevelEngine output behavior,
change runtime defaults, change alert/monitoring/Discord behavior, or add
journal interpretation.

## Source Cache Summary

Validation used the existing offline cache from the local levels-system
workspace:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

No network calls were made. No raw cache files were committed.

| Metric | Count |
| --- | ---: |
| Cache JSON files | 2274 |
| Providers | 2 (`ibkr`, `stub`) |
| Provider/symbol groups | 357 |
| Groups with `5m`/`4h`/`daily` | 355 |
| Groups with any `15m` directory | 0 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |

## 15m Availability

No local real-cache 15m candle directories were present.

Because of that cache limitation, this gate validates the real-cache
absent-15m fallback path and keeps supplied-15m real-cache validation blocked
until 15m data is collected. The gate does not fabricate 15m candles and does
not claim production supplied-15m coverage.

The deterministic supplied-15m fixture path remains covered by sample candles
and focused snapshot tests.

## Selected Symbols

The validation harness selected representative cached symbols with `5m`, `4h`,
and `daily` coverage:

| Symbol | Provider | Timeframes Found | 15m Raw/Filtered | Passed |
| --- | --- | --- | ---: | --- |
| `DEVS` | `ibkr` | `5m`, `4h`, `daily` | `0/0` | Yes |
| `ENVX` | `ibkr` | `5m`, `4h`, `daily` | `0/0` | Yes |
| `DXYZ` | `ibkr` | `5m`, `4h`, `daily` | `0/0` | Yes |
| `QUBT` | `ibkr` | `5m`, `4h`, `daily` | `0/0` | Yes |
| `GME` | `ibkr` | `5m`, `4h`, `daily` | `0/0` | Yes |

## Validation Method

An offline `npx tsx -` validation harness:

1. inspected the local cache directory;
2. counted provider, symbol, and timeframe coverage;
3. selected the latest cached `5m`, `4h`, and `daily` files for representative
   symbols;
4. normalized local cache wrappers into candle arrays;
5. built `LevelAnalysisSnapshot` v1 outputs through the from-candles path;
6. validated schema identity, producer identity, locked timeframe keys,
   `inputSummary` counts, diagnostics, and safety flags;
7. confirmed absent-15m snapshots do not include `timeframeFacts["15m"]`;
8. validated a deterministic supplied-15m sample for 15m facts generation and
   LevelEngine non-interference;
9. wrote compact summary artifacts only.

Artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-real-cache-validation/latest-15m-facts-real-cache-validation.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-real-cache-validation/latest-15m-facts-real-cache-validation.txt
```

## Supplied-15m Result

Supplied-15m real-cache validation could not run because the local cache has no
15m candle directories.

This is a cache availability limitation, not a production bug.

## Absent-15m Fallback Results

All selected real-cache snapshots passed the absent-15m fallback checks:

- `schemaVersion` remained `level-analysis-snapshot/v1...`;
- `producer` remained `levels-system`;
- locked timeframe keys remained present;
- `inputSummary.candleCounts["15m"]` was `0`;
- `inputSummary.filteredCandleCounts["15m"]` was `0`;
- `inputSummary.excludedFutureCandleCounts["15m"]` was `0`;
- `inputSummary.excludedPartialCandleCounts["15m"]` was `0`;
- `inputSummary.timeframes["15m"].provided` was `false`;
- `inputSummary.timeframesPresent` did not include `15m`;
- `timeframeFacts["15m"]` was absent;
- safety flags remained true.

## Deterministic Fixture Coverage

The deterministic sample path validates supplied 15m behavior without relying
on real-cache availability.

Summary:

| Check | Result |
| --- | --- |
| Sample 15m facts present | Yes |
| Sample 15m facts valid | Yes |
| Sample 15m availability | `limited` |
| Sample closed 15m candle count | 3 |
| LevelEngine output unchanged with 15m facts | Yes |
| Nearest support unchanged with 15m facts | Yes |
| Nearest resistance unchanged with 15m facts | Yes |
| Sample diagnostics | `15m_facts_limited` |

This confirms that supplied 15m facts can be generated as factual snapshot
context without feeding 15m candles into LevelEngine.

## LevelEngine Unchanged Summary

This gate made no production code changes.

The real-cache validation used absent 15m input, so there was no production
with-15m versus without-15m real-cache LevelEngine comparison. The deterministic
fixture path confirms the intended boundary:

- 15m facts are generated as optional `timeframeFacts`;
- 15m candles do not create support/resistance levels;
- `levelEngineOutput` remains unchanged;
- nearest support and nearest resistance remain unchanged.

## Diagnostics Summary

Observed real-cache diagnostics were factual input and no-lookahead diagnostics:

- `candle_close_as_of_filter_applied`
- `candle_inputs_reserved_for_future_fact_generation`
- `5m_partial_candles_filtered`
- `4h_partial_candles_filtered`
- `daily_partial_candles_filtered`

Observed LevelQualityAudit diagnostics included factual quality context such as:

- `clustered_level_areas_present`
- `limited_downside_extension_coverage`
- `no_resistance_extension_coverage`
- `unenriched_levels_present`

These diagnostics remain chart-analysis context only. They are not trading
instructions, journal grading, coaching, recommendations, or trade advice.

## Limitations

- The local real cache contains no 15m candle directories.
- Supplied-15m real-cache validation is blocked until 15m cache collection
  exists.
- The committed artifacts are compact validation summaries, not raw candle
  data or full generated snapshots.
- The selected validation set covers five representative cached symbols and is
  not exhaustive across all 355 complete `5m`/`4h`/`daily` provider/symbol
  groups.

## Production Bug Assessment

No production bug was found.

The absent-15m fallback is valid against the available real cache, and the
deterministic supplied-15m fixture path confirms the 15m facts builder remains
facts-only and does not alter LevelEngine output.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_plan
```

Reason: the 15m facts builder is deterministic and the absent-15m real-cache
fallback passed, but supplied-15m real-cache validation is blocked by missing
15m cached data. The next useful levels-system step is to define how 15m cache
collection should work before running broader supplied-15m real-cache
validation.
