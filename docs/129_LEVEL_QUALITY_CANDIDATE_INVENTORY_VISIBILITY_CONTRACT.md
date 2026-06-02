# Level Quality Candidate Inventory Visibility Contract

## Purpose

This contract locks the candidate inventory visibility shape and deterministic fixture suite before any wiring into the packaged level quality review process.

The contract is read-only and audit-only. It lets future investigations inspect candidate visibility across pipeline stages without changing support/resistance generation behavior.

This gate does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Contract Shape

Primary type:

```text
LevelCandidateInventoryVisibility
```

Module:

```text
src/lib/levels/level-candidate-inventory-visibility.ts
```

Root fields:

- `schemaVersion`
- `symbol`
- `provider`
- `asOfTimestamp`
- `asOfIso`
- `referencePrice`
- `sourceFiles`
- `stageCounts`
- `nearest`
- `unsurfacedCloser`
- `gapClassification`
- `diagnostics`
- `limitations`
- `safety`

The contract is compact by design. It does not include raw candles, full snapshots, raw candidate arrays, full zone arrays, provider credentials, or cache mutation details.

## Stage Model

Locked candidate stages:

- `raw`
- `clustered`
- `scored`
- `surfaced`
- `extension_candidate`
- `extension_selected`

Each `stageCounts` entry includes:

- `stage`
- `support`
- `resistance`
- `total`
- optional `byTimeframe`
- optional `bySourceType`

Validation requires every known stage to be present and rejects unknown stage keys.

## Nearest Model

The `nearest` field is keyed by stage and side:

```text
nearest[stage].support
nearest[stage].resistance
```

Each nearest row may include:

- `stage`
- `side`
- `price`
- `distancePct`
- `levelId`
- `bucket`
- `surfaced`
- `timeframeBias`
- `sourceTypes`

The nearest model is intended to compare candidate visibility across stages, especially whether the nearest scored candidate is also the nearest surfaced level.

## Unsurfaced-Closer Model

The `unsurfacedCloser` field is side-specific:

- `unsurfacedCloser.support`
- `unsurfacedCloser.resistance`

Each side includes:

- `side`
- `present`
- `count`
- optional nearest closer scored candidate
- `reasonAvailability`
- `reasons`
- `limitations`

When `present` is true, validation requires a nearest scored candidate for that side. When `present` is false, validation requires count `0`.

## Gap Classifications

Locked classification values:

- `no_gap`
- `closer_unsurfaced_candidate`
- `truthful_market_context_gap`
- `inconclusive_missing_reasons`

Classification rules:

- `closer_unsurfaced_candidate` means a closer scored candidate exists but did not surface.
- `truthful_market_context_gap` means raw, clustered, scored, and surfaced nearest visibility align enough to treat the gap as sparse structure context.
- `inconclusive_missing_reasons` means required stage visibility or surfaced-selection reason data is missing.
- `no_gap` means the compact visibility does not indicate a nearest-gap issue.

Overall classification is derived conservatively:

- any inconclusive side makes the overall classification `inconclusive_missing_reasons`;
- otherwise any closer-unsurfaced side makes the overall classification `closer_unsurfaced_candidate`;
- otherwise any truthful market-context side makes the overall classification `truthful_market_context_gap`;
- otherwise the overall classification is `no_gap`.

## Limitation And Reason Model

Reason availability values:

- `available`
- `not_available`
- `not_needed`

Current known limitations:

- `surfaced_selection_reason_not_serialized`
- `raw_clustered_scored_inventory_not_available`

The contract can record reason strings when they exist, but it does not require the current LevelEngine to serialize surfaced-selection reasons. Future wiring should preserve that limitation unless a separate instrumentation gate adds reasons.

## Safety Flags

Required true flags:

- `readOnly`
- `auditOnly`

Required false flags:

- `providerCallsMade`
- `cacheFilesWritten`
- `rawCandlesIncluded`
- `fullSnapshotsIncluded`
- `supportResistanceDetectionChanged`
- `levelEngineScoringRankingClusteringChanged`
- `surfacedLevelsChanged`
- `extensionGenerationChanged`
- `fifteenMinuteFedIntoLevelEngine`

Any missing or unsafe flag fails validation.

## Fixture List

Fixture path:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/contract-fixtures/
```

Locked fixtures:

- `candidate-inventory-no-gap.json`
- `candidate-inventory-closer-unsurfaced-support.json`
- `candidate-inventory-closer-unsurfaced-resistance.json`
- `candidate-inventory-truthful-market-context-gap.json`
- `candidate-inventory-inconclusive-missing-reasons.json`

The fixtures are deterministic and compact. They include no raw candles, full snapshots, or cache files.

## Validation Rules

Validation helpers:

- `validateLevelCandidateInventoryVisibility(value)`
- `isLevelCandidateInventoryVisibility(value)`
- `assertLevelCandidateInventoryVisibilityFactsOnly(value)`
- `summarizeLevelCandidateInventoryGaps(value)`

Validation checks:

- schema version;
- symbol, provider, as-of, and reference fields;
- source file timeframe keys;
- stage count structure;
- unknown stage rejection;
- nearest stage and side structure;
- side-specific `unsurfacedCloser` shape;
- known gap classification values;
- limitation/reason availability values;
- safety flags;
- closer-unsurfaced side/classification consistency;
- factual-only prohibited-language guard.

## Facts-Only Boundary

The contract is factual diagnostics only.

It must not include:

- recommendation language;
- trade advice;
- grading or coaching;
- P/L or giveback interpretation;
- behavior scoring;
- good/bad trade labels;
- buy/sell/hold instructions;
- journal-owned interpretation.

The facts-only assertion rejects prohibited wording in the payload.

## Intentionally Not Wired Yet

Candidate inventory visibility is not wired into:

- `LevelQualityAuditReport`;
- `LevelAnalysisSnapshot`;
- `npm run review:level-quality`;
- LevelEngine runtime output;
- alert, monitoring, Discord, or journal paths.

The next gate should design how to adapt existing candidate-pool diagnostics into this compact visibility shape and wire it additively into the packaged review process.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_review_wiring_design
```

Reason: the candidate inventory visibility contract and fixture suite are now locked. The next step is to design a read-only adapter from existing candidate-pool diagnostics into the packaged review process before any runtime/report wiring.
