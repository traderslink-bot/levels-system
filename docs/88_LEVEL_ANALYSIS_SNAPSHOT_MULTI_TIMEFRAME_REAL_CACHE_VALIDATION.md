# LevelAnalysisSnapshot Multi-Timeframe Real-Cache Validation

## Purpose

This gate validates the hardened `LevelAnalysisSnapshot` v1 multi-timeframe
contract against local real cached ticker data.

The focus is `15m` availability, `inputSummary` completeness, no-lookahead
filtering, diagnostics, schema compatibility, and confirming that the reserved
15m path does not change LevelEngine output behavior.

This is validation and reporting only. It does not tune support/resistance
detection, change LevelEngine output behavior, change runtime-mode defaults,
change alert/monitoring/Discord behavior, or add journal interpretation.

## Cache And Source Summary

The clean validation worktree did not contain a local `.validation-cache`
folder. The validation used the existing offline cache in the original local
levels-system workspace:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

No network calls were made. No raw cache files were committed.

Cache summary:

| Metric | Count |
| --- | ---: |
| Cache JSON files | 2265 |
| Providers | 2 (`ibkr`, `stub`) |
| Provider/symbol groups | 356 |
| Groups with `5m`/`4h`/`daily` | 354 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |
| Groups with any `15m` directory | 0 |

## 15m Cache Availability

No local real-cache `15m` data was present.

That means this gate validates real-cache fallback behavior for absent `15m`
input. It does not fabricate 15m data and does not claim supplied-15m real-cache
coverage.

The supplied-15m path remains covered by deterministic fixture tests from the
multi-timeframe hardening gate:

- `docs/examples/level-analysis-snapshot/sample-15m-candles.json`
- `src/tests/level-analysis-snapshot-multi-timeframe-hardening.test.ts`

## Selected Symbols

The validation reused the previous real-cache symbols for continuity:

| Symbol | Scenario |
| --- | --- |
| `DEVS` | Low-price runner |
| `ENVX` | Clean technical mover |
| `AIM` | Choppy ticker |
| `PBM` | Thin-liquidity ticker |
| `DXYZ` | Higher-priced stock |
| `YMAT` | Low-price runner |
| `HCWB` | Low-price runner |
| `MEHA` | Sub-dollar runner |
| `INM` | Sparse intraday runner |
| `EZGO` | Sharp selloff / broken low-price ticker |
| `SOWG` | Thin-liquidity ticker |
| `CLPS` | Thin-liquidity ticker |
| `AAOI` | Higher-priced high-volume ticker |
| `FLEX` | Higher-priced clean mover |
| `QUBT` | Active technical mover |
| `GME` | Higher-priced negative mover |
| `PHOE` | Unusual higher-timeframe depth |

All selected symbols had real cached `5m`, `4h`, and `daily` coverage.

## Validation Method

An inline offline `npx tsx -` harness:

1. inspected `C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles`;
2. counted provider/symbol/timeframe coverage;
3. selected the latest cached `5m`, `4h`, and `daily` files for each symbol;
4. normalized local cache wrappers into candle arrays for the existing snapshot
   runner path;
5. derived `asOfTimestamp` from the latest selected 5m candle close;
6. derived `referencePrice` from the latest selected 5m candle close price;
7. built `LevelAnalysisSnapshot` v1 outputs through
   `runLevelAnalysisSnapshotRunner`;
8. validated schema identity, safety flags, timeframe summary fields,
   diagnostics, and absent-15m behavior;
9. wrote compact summary artifacts only.

Artifacts:

- `docs/examples/level-analysis-snapshot/real-cache-multi-timeframe/latest-multi-timeframe-real-cache-validation.json`
- `docs/examples/level-analysis-snapshot/real-cache-multi-timeframe/latest-multi-timeframe-real-cache-validation.txt`

## Per-Symbol Summary

| Symbol | 15m Raw/Filtered | Timeframes Present | 5m Raw/Filtered | 4h Raw/Filtered | Daily Raw/Filtered | Passed |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| `DEVS` | `0/0` | `5m`, `4h`, `daily` | `68/68` | `114/113` | `455/454` | Yes |
| `ENVX` | `0/0` | `5m`, `4h`, `daily` | `89/89` | `118/117` | `501/500` | Yes |
| `AIM` | `0/0` | `5m`, `4h`, `daily` | `72/72` | `114/113` | `502/501` | Yes |
| `PBM` | `0/0` | `5m`, `4h`, `daily` | `51/51` | `108/107` | `501/500` | Yes |
| `DXYZ` | `0/0` | `5m`, `4h`, `daily` | `47/47` | `117/116` | `501/500` | Yes |
| `YMAT` | `0/0` | `5m`, `4h`, `daily` | `144/144` | `110/110` | `207/207` | Yes |
| `HCWB` | `0/0` | `5m`, `4h`, `daily` | `84/84` | `118/117` | `277/276` | Yes |
| `MEHA` | `0/0` | `5m`, `4h`, `daily` | `88/88` | `112/111` | `128/127` | Yes |
| `INM` | `0/0` | `5m`, `4h`, `daily` | `8/8` | `100/99` | `501/500` | Yes |
| `EZGO` | `0/0` | `5m`, `4h`, `daily` | `160/160` | `98/97` | `502/502` | Yes |
| `SOWG` | `0/0` | `5m`, `4h`, `daily` | `27/27` | `109/108` | `501/500` | Yes |
| `CLPS` | `0/0` | `5m`, `4h`, `daily` | `30/30` | `88/87` | `495/494` | Yes |
| `AAOI` | `0/0` | `5m`, `4h`, `daily` | `114/114` | `115/114` | `500/499` | Yes |
| `FLEX` | `0/0` | `5m`, `4h`, `daily` | `104/104` | `112/111` | `501/500` | Yes |
| `QUBT` | `0/0` | `5m`, `4h`, `daily` | `76/76` | `114/113` | `501/500` | Yes |
| `GME` | `0/0` | `5m`, `4h`, `daily` | `86/86` | `114/113` | `500/499` | Yes |
| `PHOE` | `0/0` | `5m`, `4h`, `daily` | `134/134` | `77/76` | `236/236` | Yes |

## InputSummary Summary

All 17 snapshots included the locked timeframe keys:

- `5m`
- `15m`
- `4h`
- `daily`

All 17 snapshots included:

- `inputSummary.candleCounts`
- `inputSummary.filteredCandleCounts`
- `inputSummary.excludedFutureCandleCounts`
- `inputSummary.excludedPartialCandleCounts`
- `inputSummary.timeframes`

For `15m` on all selected real-cache symbols:

- `timeframes["15m"].provided` was `false`;
- `candleCounts["15m"]` was `0`;
- `filteredCandleCounts["15m"]` was `0`;
- `excludedFutureCandleCounts["15m"]` was `0`;
- `excludedPartialCandleCounts["15m"]` was `0`;
- `timeframesPresent` did not include `15m`;
- diagnostics did not include `15m_candles_reserved_for_future_fact_generation`.

This is the expected fallback behavior when real 15m candles are absent.

## No-Lookahead Summary

All 17 snapshots had:

- `safety.noLookaheadApplied: true`
- `candle_close_as_of_filter_applied`

No future-start candles were present in the selected latest cache files.

No-lookahead filtering did exclude still-forming higher-timeframe candles where
expected:

- `4h_partial_candles_filtered`
- `daily_partial_candles_filtered`

These exclusions are visible in the hardened `inputSummary` count fields.

## LevelEngine Unchanged Summary

No real 15m cache existed, so equivalent with-15m versus without-15m real-cache
LevelEngine comparisons could not be run.

This is a data availability limitation, not a production bug. The deterministic
multi-timeframe tests still assert that optional 15m input does not change
LevelEngine output.

This gate made no production code changes and found no evidence that absent 15m
reporting changes LevelEngine output behavior.

## Diagnostics Summary

Snapshot diagnostics observed:

- `candle_close_as_of_filter_applied`
- `candle_inputs_reserved_for_future_fact_generation`
- `4h_partial_candles_filtered`
- `daily_partial_candles_filtered`

The generic `candle_inputs_reserved_for_future_fact_generation` diagnostic is
expected for optional/future fact inputs. The 15m-specific diagnostic did not
appear because no 15m candles were supplied.

LevelQualityAudit diagnostics observed:

- `clustered_level_areas_present`
- `limited_downside_extension_coverage`
- `limited_upside_extension_coverage`
- `no_resistance_extension_coverage`
- `unenriched_levels_present`
- `wide_downside_support_gap`
- `wide_overhead_resistance_gap`

These remain factual quality/context diagnostics, not trading instructions.

Synthetic continuation-map rows appeared in 6 of 17 selected symbols, with 7
total synthetic rows. The compact summary confirms synthetic metadata remains
factual and separate from surfaced major/intermediate/intraday buckets.

## Failures Or Limitations

Validation failures: none.

Limitations:

- No local real-cache 15m candle directories were present.
- Supplied-15m real-cache validation is blocked until the cache includes 15m
  files.
- The committed artifacts are compact summaries, not raw candle data or full
  generated snapshots.
- The selected set covers 17 prior validation symbols and is not exhaustive
  across all 354 complete `5m`/`4h`/`daily` groups.

## Production Bug Assessment

No production bug was found.

The hardened multi-timeframe contract is valid against the available real cache:

- snapshots build successfully;
- v1 schema identity is preserved;
- required timeframe keys are present;
- absent 15m is reported consistently;
- no-lookahead safety is preserved;
- diagnostics are factual;
- synthetic rows remain clearly marked when generated.

## Recommended Next Gate

Recommended next gate: `production_snapshot_runner_batch_manifest`.

Reason: local real-cache 15m data is absent, so the next useful operational step
is a production runner batch manifest that records per-symbol artifact metadata,
timeframe coverage, missing-15m availability, and validation status. That gives
future 15m data collection and snapshot batch runs a clean audit surface before
designing 15m fact generation.
