# Level Quality Candidate Inventory Review Adapter

## Purpose

This gate adds a pure read-only adapter that converts candidate-pool diagnostics into the locked candidate inventory review visibility wrapper.

The adapter is fixture-tested only. It is not wired into `npm run review:level-quality`, `LevelQualityAuditReport`, `LevelAnalysisSnapshot`, LevelEngine runtime output, alerts, monitoring, Discord, or journal paths.

This gate does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, or 15m LevelEngine eligibility.

## Adapter Input

Module:

```text
src/lib/levels/level-candidate-inventory-review-adapter.ts
```

Primary input:

```text
LevelCandidateInventoryReviewAdapterInput
```

The input accepts:

- `symbol`
- optional `provider`
- optional `asOfTimestamp`
- optional `asOfIso`
- optional `referencePrice`
- optional `sourceFiles`
- candidate-pool diagnostics through `candidatePoolDiagnostics` or `diagnostics`
- optional limitations
- optional truthful-gap distance threshold

The diagnostics input is a compact diagnostics-like shape compatible with the existing candidate-pool diagnostics stage summaries. It does not accept raw candles or full snapshots as output payloads.

## Adapter Output

Primary output:

```text
LevelCandidateInventoryReviewVisibilityWrapper
```

When inventory is available, the adapter returns:

```text
{
  present: true,
  visibility: LevelCandidateInventoryVisibility,
  gapSummary: LevelCandidateInventoryGapSummary
}
```

When inventory is unavailable or malformed, the adapter returns:

```text
{
  present: false,
  limitations: ["raw_clustered_scored_inventory_not_available"],
  diagnostics: ["candidate_inventory_visibility_not_available"]
}
```

The adapter validates the wrapper and facts-only wording before returning.

## Stage Mapping

The adapter maps candidate-pool diagnostics stages into the locked visibility stage model:

- `raw` maps from `support.raw` and `resistance.raw`
- `clustered` maps from `support.clustered` and `resistance.clustered`
- `scored` maps from `support.scored` and `resistance.scored`
- `surfaced` maps from `support.surfaced` and `resistance.surfaced`
- `extension_candidate` maps from `support.extensionCandidates` and `resistance.extensionCandidates`
- `extension_selected` maps from `support.selectedExtensions` and `resistance.selectedExtensions`

For each stage, it reports support count, resistance count, total count, and compact timeframe/source-type counts when available.

## Nearest Mapping

Nearest rows are derived from existing stage depth and price summaries:

- support uses nearest below-reference prices
- resistance uses nearest above-reference prices
- distance percentages are calculated from reference price
- surfaced-stage nearest rows are marked `surfaced: true`
- unsurfaced closer scored rows are marked `surfaced: false`

The adapter does not invent level IDs, buckets, scores, ranking reasons, or full candidate rows.

## Closer-Unsurfaced Logic

For each side, the adapter compares scored nearest distance against surfaced nearest distance.

If a closer scored candidate exists and did not surface, the side classification becomes:

```text
closer_unsurfaced_candidate
```

The side summary records:

- `present: true`
- closer scored candidate count
- nearest closer scored row
- `reasonAvailability: not_available`
- `surfaced_selection_reason_not_serialized`

This preserves the current limitation that surfaced-selection reasons are not serialized by the existing diagnostics.

## Truthful Market-Context Logic

If raw, clustered, scored, and surfaced nearest prices align, and the surfaced distance is above the adapter threshold, the side classification becomes:

```text
truthful_market_context_gap
```

This means the compact diagnostics indicate sparse nearby structure rather than a surfaced-selection visibility issue.

## Missing And Inconclusive Logic

If candidate-pool diagnostics are missing or malformed, the adapter returns the missing wrapper and does not infer a gap from surfaced levels alone.

If diagnostics are present but stage visibility is incomplete, the adapter can produce a present wrapper with:

```text
inconclusive_missing_reasons
```

That classification preserves the missing stage/reason limitation without changing generation behavior.

## Fixture And Test Coverage

Adapter fixture path:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/adapter-fixtures/
```

Fixtures:

- `adapter-no-gap.json`
- `adapter-closer-unsurfaced-support.json`
- `adapter-closer-unsurfaced-resistance.json`
- `adapter-truthful-market-context-gap.json`
- `adapter-missing-inventory.json`

Focused test:

```text
src/tests/level-candidate-inventory-review-adapter.test.ts
```

The tests cover present wrappers, missing wrappers, closer-unsurfaced support/resistance, truthful market-context gaps, incomplete diagnostics, malformed diagnostics, wrapper validation, visibility validation, facts-only guards, immutability, and source isolation.

## Safety Boundaries

The adapter is:

- read-only
- audit-only
- fixture-tested
- facts-only
- outside provider calls
- outside cache writes
- outside alert, monitoring, Discord, and journal paths
- outside `npm run review:level-quality` for this gate

It does not:

- tune support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced levels
- change extension generation
- feed 15m into LevelEngine
- serialize raw candles, full snapshots, raw candidate arrays, or full zone arrays
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Intentionally Not Wired Yet

Candidate inventory visibility is still not wired into:

- `src/scripts/run-level-quality-review.ts`
- `LevelQualityAuditReport`
- `LevelAnalysisSnapshot`
- LevelEngine runtime output
- alert, monitoring, Discord, or journal paths

The next gate should wire the already-tested adapter additively into the packaged review process and rerun the 10-symbol review.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_review_wiring
```

Reason: the pure adapter is now fixture-tested. The next safe step is additive review-process wiring plus a real-cache rerun, with existing baseline parity checks preserved.
