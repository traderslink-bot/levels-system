# Level Quality Enrichment Mapping Hardening

## Purpose

This gate improves LevelEngine enrichment mapping coverage and audit diagnostics without changing support/resistance generation behavior. The goal is to make enrichment status more accurate and more actionable while preserving level prices, bucket assignment, ranking, clustering, extension generation, runtime defaults, alerts, monitoring, Discord behavior, and journal boundaries.

## Root Cause Found

The multi-timeframe quality review reported `unenriched_levels_present` for every reviewed symbol. The investigation found two related causes:

1. The old/default runtime path intentionally emits stable `FinalLevelZone` buckets without `enrichedAnalysis` shadow metadata. That means a quality audit over default output can truthfully report missing enrichment even when level generation is working as designed.
2. The quality audit collapsed all missing `enrichedAnalysis` rows into one broad diagnostic. Historical levels, historical extension rows, and synthetic continuation-map rows were all counted under `unenriched_levels_present`, which made the diagnostic less useful and risked treating synthetic forward-planning rows as historical enrichment failures.

The new projected runtime adapter already had a price/source/timeframe fallback for enrichment mapping, but it did not explicitly prefer an exact level ID match before that fallback.

## Fix Summary

Changes made:

- Added exact ID-first enrichment matching in `src/lib/levels/level-runtime-output-adapter.ts`.
- Kept the existing normalized price/source/timeframe fallback mapping for ID misses.
- Added enrichment diagnostic breakdowns for:
  - historical runtime zones
  - historical extension zones
  - synthetic continuation-map zones
- Kept synthetic continuation-map rows unenriched by design, even if a same-ID ranked candidate is present, so they do not inherit historical `rankLevels` metadata.
- Added `LevelQualityAuditReport.enrichmentBreakdown` as optional additive diagnostic detail.
- Added specific audit diagnostics:
  - `unenriched_historical_levels_present`
  - `unenriched_extension_levels_present`
  - `unenriched_synthetic_levels_present`
- Preserved the existing broad `unenriched_levels_present` diagnostic for compatibility.

## Diagnostics Changes

Before this gate:

- Missing enrichment appeared only as `unenriched_levels_present`.
- Synthetic continuation-map rows could contribute to the same broad diagnostic as historical levels.
- Runtime projection diagnostics only reported total enriched and unenriched zone counts.

After this gate:

- Runtime projection diagnostics still report total enriched/unenriched counts, plus category-specific counts and unmatched IDs.
- LevelQualityAudit keeps the broad compatibility diagnostic and adds specific categories.
- Synthetic continuation-map rows are counted as synthetic enrichment gaps, not historical enrichment failures.

## Parity Guarantees

This gate does not change:

- support/resistance candidate generation
- LevelEngine scoring, ranking, clustering, or surfaced selection
- support/resistance bucket membership
- level prices, zones, labels, or nearest support/resistance
- extension generation behavior
- runtime mode defaults
- alert, monitoring, or Discord behavior
- journal app behavior

The enrichment metadata remains additive shadow metadata.

## Tests Added

Added `src/tests/level-quality-enrichment-mapping-hardening.test.ts` covering:

- exact ID mapping still enriches a matching runtime zone
- fallback mapping still enriches by normalized price, source, and timeframe when IDs differ
- output price, side, bucket, and zone identity remain unchanged
- extension and synthetic enrichment gaps are separated from historical gaps
- synthetic continuation-map rows stay clearly marked and are not enriched from ranked historical candidates
- enrichment hardening source stays outside alerts, monitoring, Discord, journal, and 15m LevelEngine input paths
- no recommendation, coaching, grading, P/L, giveback, behavior scoring, or trade-advice language is introduced

## Real-Cache Quality Review Follow-Up

This gate did not rerun the ten-symbol real-cache quality review. The code change is deterministic and covered by focused tests, and the next safer gate is a dedicated review rerun that compares the same symbols from docs/106:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`
- `AIM`
- `HCWB`
- `YMAT`
- `AAOI`
- `PHOE`

The rerun should compare:

- enrichment diagnostics before/after
- `unenriched_levels_present` and specific enrichment diagnostics
- LevelEngine output parity
- nearest support/resistance parity
- bucket parity
- extension parity
- synthetic continuation-map markings

## Limitations

- Default old runtime output can still have unenriched historical levels because that path intentionally does not attach shadow metadata.
- This gate improves mapping and diagnostics; it does not tune level quality.
- The broad `unenriched_levels_present` diagnostic remains for compatibility, so downstream reports should use the new specific diagnostics for sharper classification.
- 15m facts remain context only and are still outside LevelEngine support/resistance generation.

## Recommended Next Gate

Recommended next gate:

`level_engine_multi_timeframe_quality_review_rerun`

Reason:

Rerun the same ten-symbol review to confirm that enrichment diagnostics are more precise and that LevelEngine prices, buckets, nearest levels, extension levels, and synthetic continuation-map behavior remain unchanged.

## Anti-Goals

- No support/resistance detection tuning.
- No LevelEngine scoring, ranking, clustering, bucket assignment, or extension generation changes.
- No 15m LevelEngine input.
- No runtime default changes.
- No alert, monitoring, or Discord behavior changes.
- No journal app changes.
- No grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.
