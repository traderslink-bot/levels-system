# Journal Connector LevelAnalysisSnapshot Fixture

This directory contains a compact `LevelAnalysisSnapshot` v1 fixture intended for TraderLink Intelligence / journal connector tests.

The fixture is factual chart-analysis context only. It is not a trading recommendation, journal score, execution review, coaching output, P/L calculation, giveback analysis, or behavior score.

## Fixture

- `journal-connector-level-analysis-snapshot-v1.json`

The fixture is intentionally smaller than the full generated replay artifacts. It preserves the locked v1 contract shape while remaining practical for downstream connector tests.

## What To Validate

Downstream connector tests should validate:

- `schemaVersion` starts with `level-analysis-snapshot/v1`
- `producer` is `levels-system`
- `symbol`, `asOfTimestamp`, and `referencePrice` are present
- `inputSummary`, candle counts, filtered/excluded counts, and `timeframesPresent` are present
- `nearestSupport` and `nearestResistance` are either `null` or follow the documented nearest-level shape
- `levelEngineOutput` includes the canonical support/resistance buckets and `extensionLevels`
- session, volume, shelf, market context, facts bundle, intelligence report, audit, diagnostics, and safety sections are present
- safety flags are present before consuming the snapshot
- unknown additive fields are preserved or ignored, not treated as connector failures

## Stable Fields

Stable v1 candidate fields include the top-level identity fields, `inputSummary`, `nearestSupport`, `nearestResistance`, `levelEngineOutput`, fact sections, `levelIntelligenceReport`, `levelQualityAudit`, `diagnostics`, and `safety`.

## Optional And Nullable Fields

Downstream systems should treat optional or nullable sections as non-fatal unless a connector-specific requirement marks them mandatory. For example, nearest support or resistance may be `null` when no eligible level exists on that side of the reference price.

## Synthetic Continuation-Map Levels

Synthetic continuation-map rows are forward-planning chart map levels only. They are not historical support/resistance and must not be treated as touch, rejection, or historical confluence evidence.

Connector tests should confirm synthetic rows remain marked with:

- `extensionMetadata.extensionSource = "synthetic_continuation_map"`
- evidence limitations such as `not_historical_support_resistance`
- zero touch/rejection-style historical evidence

## Quality Audit Findings

`levelQualityAudit` findings are quality and coverage diagnostics for the chart-analysis output. They are not trading instructions and should not be reinterpreted as journal grading or advice.

## No-Lookahead Expectations

The snapshot represents as-of candle-close analysis. Downstream replay or journal systems should preserve `asOfTimestamp`, candle summaries, and safety flags so historical analysis remains reproducible.

## What Not To Infer

Do not infer journal grading, coaching conclusions, P/L, giveback, behavior scoring, entry/exit decisions, or UI conclusions directly from this fixture. TraderLink Intelligence / the journal owns those downstream interpretations.
