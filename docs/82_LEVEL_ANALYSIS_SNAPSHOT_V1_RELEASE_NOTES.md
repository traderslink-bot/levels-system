# LevelAnalysisSnapshot V1 Release Notes

## Release Purpose

These notes summarize the locked `LevelAnalysisSnapshot` v1 contract for TraderLink Intelligence / journal integration.

The goal is to give downstream implementation a concise handoff: what is stable, what is optional, which fixtures to use, and which product boundaries must stay outside `levels-system`.

This is a release/handoff documentation gate only. It does not change support/resistance detection, LevelEngine output behavior, runtime mode defaults, alerts, monitoring, Discord behavior, trader-context behavior, synthetic extension generation, journal grading, coaching, P/L, giveback analysis, behavior scoring, or trading recommendation behavior.

## What LevelAnalysisSnapshot V1 Is

`LevelAnalysisSnapshot` v1 is the factual candle-data chart-analysis contract produced by `levels-system`.

It packages:

- candle-close as-of identity and input summary
- canonical `LevelEngineOutput`
- nearest support and nearest resistance convenience fields
- session facts
- volume facts
- volume shelves
- market context
- facts bundle
- `LevelIntelligenceReport`
- `LevelQualityAudit`
- diagnostics
- safety flags

The snapshot is intended to be persisted or consumed as immutable market-structure context for TraderLink Intelligence / journal workflows.

## What It Is Not

`LevelAnalysisSnapshot` v1 is not:

- a trade grading payload
- a coaching payload
- a P/L payload
- a giveback analysis payload
- a behavior scoring payload
- a journal UI model
- an alert routing payload
- a Discord product format
- a buy/sell/hold instruction source
- a completed downstream execution interpretation

TraderLink Intelligence / the journal owns downstream execution interpretation, presentation, grading, coaching, P/L, giveback analysis, behavior scoring, and UI behavior.

## Stable Contract Summary

The locked schema identifier is:

```text
level-analysis-snapshot/v1
```

The locked producer is:

```text
levels-system
```

Stable v1 candidate areas:

- top-level identity fields
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- canonical `levelEngineOutput`
- fact sections for supported from-candles snapshots
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

Downstream readers should tolerate additive unknown fields and preserve the original snapshot for auditability.

## Required Top-Level Fields

Every v1 snapshot must include:

- `schemaVersion`
- `producer`
- `symbol`
- `asOfTimestamp`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

Journal-ready snapshots built from supported candle inputs should also include:

- `referencePrice`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`

If a supported fact section is absent, downstream readers should treat that as a data-completeness limitation and inspect `diagnostics`.

## Required Input Summary Fields

`inputSummary` must include:

- `timeframesPresent`
- `candleCounts`
- `filteredCandleCounts`
- `excludedFutureCandleCounts`
- `excludedPartialCandleCounts`
- `timeframes`
- `previousCloseProvided`

Locked timeframe keys:

- `5m`
- `15m`
- `4h`
- `daily`

The `15m` key may be present as a zero-count placeholder for forward compatibility.

## Required Nearest-Level Fields

`nearestSupport` and `nearestResistance` must always be present as fields.

Each may be:

- `null`, when no eligible level exists on the correct side of `referencePrice`, or
- an object with the locked nearest-level shape.

Nearest-level object fields:

- `levelId`
- `kind`
- `bucket`
- `representativePrice`
- `zoneLow`
- `zoneHigh`
- `strengthScore`
- `strengthLabel`
- `distanceFromReferencePct`
- `isExtension`
- `extensionSource`, when present on the source level

Nearest levels are derived only from `levelEngineOutput` and `referencePrice`. They do not create new levels and do not change support/resistance detection.

## Required LevelEngineOutput Fields

`levelEngineOutput` is the canonical level map.

Required fields:

- `symbol`
- `generatedAt`
- `metadata`
- `majorSupport`
- `majorResistance`
- `intermediateSupport`
- `intermediateResistance`
- `intradaySupport`
- `intradayResistance`
- `extensionLevels`
- `specialLevels`

Required extension containers:

- `extensionLevels.support`
- `extensionLevels.resistance`

Downstream systems should derive any display-specific view from this map while preserving the original snapshot unchanged.

## Optional And Nullable Fields

Optional or nullable areas include:

- `referencePrice` in degraded/prebuilt composition paths
- `nearestSupport`
- `nearestResistance`
- `sessionFacts` in degraded/prebuilt paths
- `volumeFacts` in degraded/prebuilt paths
- `volumeShelves` in degraded/prebuilt paths
- `marketContext` when insufficient facts are available
- `factsBundle` when facts are missing
- nearest-level `extensionSource`
- `FinalLevelZone.extensionMetadata`

Connector logic should distinguish missing optional data from malformed required data.

## Downstream Journal Connector Expectations

The journal connector may use the snapshot as factual chart context.

Expected connector behavior:

- validate the v1 identity fields
- read `inputSummary` before assuming data completeness
- treat `levelEngineOutput` as canonical support/resistance context
- use nearest fields as convenience fields only
- preserve unknown additive fields
- persist the original snapshot for auditability
- treat diagnostics as contract and quality context
- keep downstream execution interpretation outside `levels-system`

The connector should not mutate, rerank, or reinterpret `levelEngineOutput` bucket membership as journal scoring.

## No-Lookahead Guarantees

Supported from-candles snapshots are built with candle-close as-of filtering.

Replay/journal consumers should require:

- `asOfTimestamp`
- `inputSummary.filteredCandleCounts`
- `inputSummary.excludedFutureCandleCounts`
- `inputSummary.excludedPartialCandleCounts`
- `safety.noLookaheadApplied: true`

If `safety.noLookaheadApplied` is false, downstream replay/journal use should reject or quarantine the snapshot for review.

## Synthetic Continuation-Map Rules

Synthetic continuation-map extension rows are forward-planning chart map levels only.

They are not historical support/resistance and must not be treated as touch, rejection, or historical confluence evidence.

Synthetic rows should be identified by:

- `isExtension: true`
- `extensionMetadata.extensionSource: "synthetic_continuation_map"`
- evidence limitations such as `not_historical_support_resistance`
- notes that state synthetic continuation-map / not historical support/resistance
- zero fake historical touch/rejection/confluence evidence

Real historical/candidate extensions remain preferred by the LevelEngine behavior already accepted before this release note.

## LevelQualityAudit Rules

`LevelQualityAudit` findings are diagnostics for the level map.

They may describe:

- sparse coverage
- missing or limited extension coverage
- clustered areas
- stale or weak-context levels
- confluence summary
- quality and safety diagnostics

These findings are QA and coverage signals. They are not trading instructions and should not be transformed directly into journal grading or coaching conclusions.

## Fixture Locations

Locked contract and release docs:

- `docs/79_JOURNAL_CONNECTOR_LEVEL_ANALYSIS_CONTRACT.md`
- `docs/81_LEVEL_ANALYSIS_SNAPSHOT_SCHEMA_V1_LOCK.md`
- `docs/82_LEVEL_ANALYSIS_SNAPSHOT_V1_RELEASE_NOTES.md`

Compact connector fixture:

- `docs/examples/level-analysis-snapshot/journal-connector-contract/README.md`
- `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`

Broader replay and validation artifacts:

- `docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json`
- `docs/examples/level-analysis-snapshot/outputs/`
- `docs/examples/level-analysis-snapshot/real-cache-more-symbols/`

Focused contract tests:

- `src/tests/level-analysis-snapshot-schema-v1-lock.test.ts`
- `src/tests/level-analysis-snapshot-journal-connector-fixture.test.ts`
- `src/tests/level-analysis-snapshot-fixture-pack.test.ts`
- `src/tests/level-analysis-snapshot-replay-safety.test.ts`

## Validation Evidence Summary

Completed validation includes:

- pure `LevelAnalysisSnapshot` builder tests
- from-candles builder tests
- replay/as-of safety tests
- export/review runner tests
- multi-scenario deterministic fixture pack
- initial real-cache validation on real cached IBKR candles
- real-cache extension coverage review
- real-cache synthetic extension edge-case regression tests
- expanded 12-symbol real ticker replay validation
- v1 schema lock tests
- compact journal connector fixture tests

The expanded real ticker validation passed across 12 cached symbols and covered low-price runners, sub-dollar runners, thin-liquidity names, higher-priced names, active movers, weak extension coverage, healthy extension coverage, and synthetic continuation-map presence.

No production bug was found in the expanded validation. The current real-cache extension behavior remains accepted as the v1 baseline.

## Downstream Implementation Checklist

TraderLink Intelligence / journal integration should:

- validate `schemaVersion` starts with `level-analysis-snapshot/v1`
- validate `producer` equals `levels-system`
- require `symbol`
- require `asOfTimestamp`
- require `referencePrice` for nearest-level journal features
- preserve the original snapshot for auditability
- require `inputSummary` and timeframe candle counts
- require `safety.noLookaheadApplied` for replay/journal use
- require `safety.levelOutputUnchanged`
- require `safety.factsOnlyVWAP`
- require `safety.shelvesAreFactsOnly`
- require `safety.syntheticExtensionsClearlyMarked`
- treat `levelEngineOutput` as factual chart context
- treat `nearestSupport` and `nearestResistance` as convenience fields
- treat synthetic continuation-map rows as forward-planning chart map only
- treat `levelQualityAudit` findings as diagnostics, not trading instructions
- tolerate nullable nearest fields
- tolerate missing optional fact sections when diagnostics explain the limitation
- preserve unknown additive fields for forward compatibility
- use the compact connector fixture for connector tests
- keep journal grading, coaching, P/L, giveback analysis, behavior scoring, and UI interpretation outside `levels-system`

## Explicit Boundaries And Anti-Goals

This v1 release does not authorize `levels-system` to own:

- trade grading
- coaching
- P/L
- giveback analysis
- behavior scoring
- journal UI state
- Discord-first product decisions
- alert routing behavior for journal consumption
- user-specific execution advice

The snapshot remains factual chart-analysis context only.

## Known Limitations

Known v1 limitations:

- `15m` is reserved in the input summary but not yet a hardened multi-timeframe input path.
- Some fact sections may be absent in degraded/prebuilt composition paths.
- Human-readable explanation strings are useful but less stable than structured identity, level, fact, audit, and safety fields.
- Market context subfields may evolve additively.
- Quality audit diagnostic names may evolve additively.
- Synthetic extension spacing and ladder density may be tuned in future gates, but the metadata marking requirement is stable.
- Real-cache validation used local cached data and did not commit raw cache files.

## Recommended Next Gate

Recommended next gate:

```text
downstream_connector_adapter_blueprint
```

Reason: the v1 schema is locked, validation has passed, and a compact connector fixture now exists. The next most useful step is to design how TraderLink Intelligence / journal code should load, validate, preserve, and consume `LevelAnalysisSnapshot` without moving journal behavior back into `levels-system`.
