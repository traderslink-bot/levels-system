# Real Ticker Replay Validation More Symbols

## Purpose

This validation expands real cached ticker replay coverage beyond the initial five-symbol set before locking `LevelAnalysisSnapshot` v1. The goal is to increase confidence that the snapshot contract behaves safely across more real market structures, prices, liquidity profiles, extension coverage states, and timeframe-depth cases.

This is validation/reporting only. No support/resistance detection, LevelEngine output behavior, runtime mode defaults, alerts, monitoring, Discord behavior, trader-context behavior, journal grading, coaching, P/L, giveback, behavior scoring, journal behavior, or recommendation language was changed.

## Cache / Source Summary

The validation used the existing offline cache in the original local workspace:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

Cache summary:

- Providers present: `ibkr`, `stub`
- Cached candle JSON files: `2265`
- Provider/symbol groups: `356`
- Provider/symbol groups with `5m`, `4h`, and daily folders: `354`

No network calls were made. No raw cache files were committed.

## Existing Infrastructure Reused

The validation reused the existing snapshot runner path through `runLevelAnalysisSnapshotRunner` from:

```text
src/scripts/run-level-analysis-snapshot.ts
```

An inline `npx tsx -` review harness selected latest cached IBKR candle files, supplied in-memory candle arrays to the existing runner function, and wrote compact review artifacts only:

- `docs/examples/level-analysis-snapshot/real-cache-more-symbols/latest-expanded-real-cache-validation.json`
- `docs/examples/level-analysis-snapshot/real-cache-more-symbols/latest-expanded-real-cache-validation.txt`

These artifacts are summary-level validation outputs, not full snapshot dumps.

## Symbol Selection Criteria

The expanded validation selected real cached IBKR symbols to cover:

- Low-price runners.
- Sub-dollar runners.
- Sparse intraday history.
- Sharp selloff / broken low-price behavior.
- Thin-liquidity profiles.
- Higher-priced tickers.
- High-dollar-volume active names.
- Positive and negative movers.
- Shorter higher-timeframe depth.
- Strong, weak, and mixed extension coverage outcomes.

## Selected Symbols

| Symbol | Scenario | Selection Reason |
| --- | --- | --- |
| `YMAT` | Low-price runner | Large low-price move with high dollar volume |
| `HCWB` | Low-price runner | Large low-price move with sustained 5m coverage |
| `MEHA` | Sub-dollar runner | Very low reference price with strong intraday move |
| `INM` | Sparse intraday runner | Short 5m history with complete higher-timeframe cache |
| `EZGO` | Sharp selloff / broken low-price ticker | Extreme negative move and low reference price |
| `SOWG` | Thin-liquidity ticker | Very low dollar volume real-cache group |
| `CLPS` | Thin-liquidity ticker | Low dollar volume and sparse intraday activity |
| `AAOI` | Higher-priced high-volume ticker | High reference price and high dollar volume |
| `FLEX` | Higher-priced clean mover | Higher-priced positive mover with high dollar volume |
| `QUBT` | Active technical mover | Mid-priced high-dollar-volume active ticker |
| `GME` | Higher-priced negative mover | Higher-priced negative session with high dollar volume |
| `PHOE` | Unusual higher-timeframe depth | Higher-priced ticker with shorter 4h/daily cache depth |

This adds `12` symbols beyond the original real-cache validation set of `DEVS`, `ENVX`, `AIM`, `PBM`, and `DXYZ`.

## Commands Run

Install dependencies for the clean validation worktree:

```powershell
npm ci
```

Run the expanded real-cache validation harness using the existing snapshot runner function:

```powershell
npx tsx -
```

The inline harness:

- inspected `C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles`,
- selected latest IBKR `5m`, `4h`, and daily cache files for each symbol,
- derived `asOfTimestamp` from the latest closed 5m candle,
- derived `referencePrice` from the latest 5m close,
- supplied candle arrays to `runLevelAnalysisSnapshotRunner`,
- validated the snapshot contract fields,
- wrote compact JSON and text summaries under `docs/examples/level-analysis-snapshot/real-cache-more-symbols/`.

Validation commands:

```powershell
npx tsc --noEmit
npm test
```

## Per-Symbol Validation Summary

| Symbol | Reference | Nearest Support | Nearest Resistance | Extension Rows | Real | Synthetic | Warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `YMAT` | `1.325` | `1.31` | `1.34` | `6` | `6` | `0` | `limited_downside_extension_coverage` |
| `HCWB` | `2.945` | `1.91` | `3.78` | `1` | `1` | `0` | `no_resistance_extension_coverage` |
| `MEHA` | `0.2033` | `0.1911` | `0.22` | `4` | `4` | `0` | None |
| `INM` | `1.7199` | `1.25` | `1.95` | `3` | `3` | `0` | None |
| `EZGO` | `0.1234` | `0.1226` | `0.1298` | `3` | `2` | `1` | `limited_upside_extension_coverage` |
| `SOWG` | `1.79` | `1.57` | `1.8` | `5` | `3` | `2` | None |
| `CLPS` | `0.93` | `0.8902` | `0.96` | `5` | `4` | `1` | None |
| `AAOI` | `178.64` | `174.78` | `189.5` | `5` | `4` | `1` | None |
| `FLEX` | `126.7` | `125.27` | `126.99` | `4` | `3` | `1` | None |
| `QUBT` | `12.799` | `12.42` | `12.9727` | `4` | `4` | `0` | None |
| `GME` | `24.8` | `24.73` | `25` | `6` | `6` | `0` | None |
| `PHOE` | `34.75` | `29.85` | `40.98` | `4` | `3` | `1` | None |

All `12` snapshots built successfully and passed the validation checks recorded in the summary artifact.

## Snapshot Field Completeness Summary

All selected snapshots included:

- `schemaVersion: level-analysis-snapshot/v1`
- `producer: levels-system`
- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `inputSummary`
- `timeframesPresent`
- candle counts by timeframe
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

Nearest level behavior was sane across the set:

- `12/12` snapshots had nearest support.
- `12/12` snapshots had nearest resistance.
- No nearest-level null case appeared in this expanded set; null behavior remains covered by existing snapshot tests and prior fixtures.

## No-Lookahead / Safety Summary

All selected snapshots included:

- `safety.noLookaheadApplied: true`
- `safety.levelOutputUnchanged: true`
- `safety.factsOnlyVWAP: true`
- `safety.shelvesAreFactsOnly: true`
- `safety.syntheticExtensionsClearlyMarked: true`
- `safety.noRuntimeBehaviorChange: true`

Every snapshot included the diagnostic:

```text
candle_close_as_of_filter_applied
```

The validation used explicit `asOfTimestamp` values derived from the latest selected 5m candle close. Future and still-forming candle exclusion behavior remains covered by the replay/as-of snapshot tests.

## Extension Coverage Summary

Coverage observations:

- `10/12` symbols had no extension coverage warning.
- `YMAT` had limited downside extension coverage.
- `EZGO` had limited upside extension coverage.
- `HCWB` had no resistance extension coverage.
- No expanded-set symbol had missing support extension coverage.

This is acceptable for contract validation. The warnings are quality diagnostics from the existing `LevelQualityAudit`; they do not indicate a snapshot contract failure or production bug.

## Synthetic Continuation-Map Summary

Synthetic continuation-map rows appeared in `6/12` expanded symbols:

- `EZGO`
- `SOWG`
- `CLPS`
- `AAOI`
- `FLEX`
- `PHOE`

Total synthetic continuation-map rows in the expanded set: `7`.

The validation confirmed:

- Synthetic rows were clearly marked.
- `safety.syntheticExtensionsClearlyMarked` remained `true`.
- Synthetic rows stayed in `extensionLevels`.
- No synthetic rows appeared in surfaced major/intermediate/intraday buckets.
- Synthetic rows were not treated as historical support/resistance in the validation summary.

The original five-symbol real-cache set did not produce synthetic rows. This expanded set now verifies both sides of the baseline: current real-cache behavior can block synthetic rows when safety rules require it, and it can produce clearly marked synthetic rows when the ladder is safe.

## Observed Diagnostics

Snapshot diagnostics observed:

- `candle_close_as_of_filter_applied`
- `candle_inputs_reserved_for_future_fact_generation`

Audit diagnostics observed across the set:

- `clustered_level_areas_present`
- `limited_downside_extension_coverage`
- `limited_upside_extension_coverage`
- `no_resistance_extension_coverage`
- `unenriched_levels_present`
- `wide_downside_support_gap`
- `wide_overhead_resistance_gap`

These are expected quality and completeness diagnostics, not trading instructions.

## Failures Or Limitations

Validation failures: none.

Limitations:

- The cache was available only in the original local workspace, not inside the clean validation worktree.
- The committed artifacts are compact summaries, not full generated snapshots.
- The expanded set is broader than the first five symbols but still not exhaustive across all `354` complete cache groups.
- `HCWB` still demonstrated no resistance extension coverage, which is accepted as a quality diagnostic rather than a contract failure.
- No null nearest-level case appeared in this expanded real-cache set.

## Production Bug Assessment

No production bug was found.

The expanded validation supports the current accepted behavior:

- The snapshot contract builds successfully on additional real cached IBKR candles.
- Required v1 candidate fields are present.
- No-lookahead safety flags are present and true.
- Extension quality warnings are surfaced as diagnostics.
- Synthetic continuation-map rows are generated and labeled when safety rules allow them.
- Synthetic rows are absent when current safety rules block them.

## Current Behavior Acceptance

Current behavior remains accepted for `LevelAnalysisSnapshot` v1 candidate use.

The expanded set strengthens confidence that the snapshot is useful for TraderLink Intelligence / journal consumption as factual chart context. It does not justify behavior tuning in this gate.

## Recommended Next Gate

Recommended next gate: `snapshot_schema_v1_lock`.

Rationale: the connector contract is documented, the initial real-cache validation passed, real-cache synthetic edge cases are covered by regression tests, and this expanded 12-symbol replay validation found no contract failures or production bugs. The best next step is to lock the v1 snapshot schema expectations before adding more downstream connector fixtures or multi-timeframe hardening.
