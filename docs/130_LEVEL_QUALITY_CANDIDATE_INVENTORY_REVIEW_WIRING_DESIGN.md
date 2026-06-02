# Level Quality Candidate Inventory Review Wiring Design

## Purpose

This design defines how a future gate should adapt existing candidate-pool diagnostics into the locked `LevelCandidateInventoryVisibility` shape and add it to the packaged level quality review output.

This is a design/planning gate. It does not wire candidate inventory visibility into runtime review output and does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Source

Primary evidence:

- `docs/128_LEVEL_QUALITY_CANDIDATE_INVENTORY_VISIBILITY_DESIGN.md`
- `docs/129_LEVEL_QUALITY_CANDIDATE_INVENTORY_VISIBILITY_CONTRACT.md`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-visibility-contract.json`

Implementation context:

- `src/lib/levels/level-candidate-inventory-visibility.ts`
- `src/lib/levels/level-candidate-pool-diagnostics.ts`
- `src/scripts/run-level-candidate-pool-diagnostics.ts`
- `src/scripts/run-level-quality-review.ts`
- `src/lib/analysis/level-analysis-snapshot-from-candles.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`

## Current Problem

The packaged quality review can rebuild compact `LevelAnalysisSnapshot` summaries from local cache files and compare existing baseline fields, but it does not expose candidate inventory before public surfaced output.

The candidate-pool diagnostics helper already accepts prebuilt pipeline inputs and summarizes:

- raw candidates;
- clustered zones;
- scored zones;
- surfaced buckets;
- extension candidates;
- selected extensions.

The missing step is an adapter that converts those stage summaries into the locked `LevelCandidateInventoryVisibility` contract for each reviewed symbol, then writes that compact visibility into review artifacts without changing any LevelEngine output.

## Proposed Adapter Shape

Suggested future module:

```text
src/lib/levels/level-candidate-inventory-review-adapter.ts
```

Suggested exports:

- `buildLevelCandidateInventoryVisibilityFromDiagnostics`
- `compactLevelCandidateInventoryVisibilityForReview`
- `summarizeCandidateInventoryVisibilityForText`

The adapter should accept:

- symbol;
- provider;
- as-of timestamp;
- reference price;
- source file map;
- `LevelCandidatePoolDiagnosticsReport`;
- optional baseline/source context;
- optional limitations when full reason data is unavailable.

The adapter should return a validated `LevelCandidateInventoryVisibility` payload plus a compact gap summary. It should call `validateLevelCandidateInventoryVisibility` and `assertLevelCandidateInventoryVisibilityFactsOnly` before output.

## Candidate Pipeline Stages

The future adapter should map existing candidate-pool diagnostics into the locked stage model:

- `raw`: raw candidate counts and nearest prices from `support.raw` and `resistance.raw`.
- `clustered`: clustered zone counts and nearest prices from `support.clustered` and `resistance.clustered`.
- `scored`: scored zone counts and nearest prices from `support.scored` and `resistance.scored`.
- `surfaced`: surfaced bucket counts and nearest prices from `support.surfaced` and `resistance.surfaced`.
- `extension_candidate`: extension candidate counts and nearest prices from `support.extensionCandidates` and `resistance.extensionCandidates`.
- `extension_selected`: selected extension counts and nearest prices from `support.selectedExtensions` and `resistance.selectedExtensions`.

Stage counts should preserve side counts, total counts, timeframe counts, and source-type counts when available. The adapter should not include raw candidate arrays, raw candle arrays, full zone arrays, or full snapshots.

## Adapter Responsibilities

The future adapter should be responsible for:

- extracting stage counts by side;
- extracting nearest support and resistance by stage;
- detecting closer scored candidates that did not surface;
- producing side-specific `unsurfacedCloser` summaries;
- classifying gaps as `no_gap`, `closer_unsurfaced_candidate`, `truthful_market_context_gap`, or `inconclusive_missing_reasons`;
- preserving reason limitations such as `surfaced_selection_reason_not_serialized`;
- reporting `raw_clustered_scored_inventory_not_available` when the pipeline inventory cannot be rebuilt;
- setting safety flags;
- validating the final payload;
- keeping wording factual-only.

## Review Output Field Plan

Future packaged review output should add an optional per-entry field:

```text
candidateInventoryVisibility
```

Recommended wrapper:

```text
candidateInventoryVisibility: {
  present: true,
  visibility: LevelCandidateInventoryVisibility,
  gapSummary: LevelCandidateInventoryGapSummary
}
```

When inventory cannot be rebuilt, use:

```text
candidateInventoryVisibility: {
  present: false,
  limitations: ["raw_clustered_scored_inventory_not_available"],
  diagnostics: ["candidate_inventory_visibility_not_available"]
}
```

The JSON output should include the compact visibility wrapper under each reviewed symbol entry. The text output should include one short line per symbol with overall gap classification and side-specific closer-unsurfaced counts.

## Baseline Compatibility Plan

The field should be additive and must not change existing parity fields:

- nearest support/resistance;
- bucket counts;
- extension counts;
- synthetic continuation-map count and marking;
- diagnostics;
- diagnostic semantics;
- enrichment breakdown;
- density metric;
- 15m context-only checks.

For the first wiring gate, `candidateInventoryVisibility` should be excluded from old baseline mismatch counts because the locked baseline does not contain the field. The output should still report candidate-inventory presence and validation counts separately.

After a real-cache rerun verifies the field, a separate baseline-lock gate can add candidate-inventory parity checks. At that point future comparisons should include:

- presence;
- validation status;
- per-symbol gap classification;
- stage counts;
- nearest-by-stage prices;
- unsurfaced-closer counts;
- limitation codes;
- facts-only status.

## Limitation And Reason Handling

Current limitation to preserve:

```text
surfaced_selection_reason_not_serialized
```

The existing pipeline can show that a closer scored candidate did not surface, but it does not serialize an exact per-zone surfaced-selection reason. The adapter should record reason availability as `not_available` with that limitation unless a separate instrumentation gate adds reason serialization.

If the review command cannot rebuild raw, clustered, and scored stages for a symbol, it should mark the wrapper as not present and use:

```text
raw_clustered_scored_inventory_not_available
```

It should not guess a gap classification from surfaced levels alone.

## Safety Boundaries

Future wiring must remain:

- read-only;
- audit-only;
- local-cache only;
- facts-only;
- additive to review output;
- free of provider calls;
- free of cache writes;
- free of raw candle and full snapshot output;
- outside LevelEngine generation behavior;
- outside alert, monitoring, Discord, and journal paths.

It must not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or surfaced levels;
- change extension generation;
- feed 15m into LevelEngine;
- introduce coaching, grading, P/L, giveback, behavior scoring, recommendations, or trade advice.

## Future Test Plan

Future implementation tests should cover:

- adapter builds `LevelCandidateInventoryVisibility` from fixture candidate-pool diagnostics;
- packaged review output includes `candidateInventoryVisibility`;
- old parity fields remain unchanged;
- closer unsurfaced support is detected;
- closer unsurfaced resistance is detected;
- truthful market-context gap is detected;
- inconclusive missing reasons are represented safely;
- missing inventory writes a compact not-present wrapper;
- no raw candles or full snapshots are written;
- no provider, cache-write, alert, monitoring, Discord, or journal imports are introduced;
- no prohibited language appears;
- 15m remains context-only.

## Implementation Options

Recommended sequence:

1. Add an adapter contract and output-shape fixture pack.
2. Add pure adapter tests using deterministic candidate-pool diagnostics fixtures.
3. Wire the optional wrapper into `npm run review:level-quality`.
4. Rerun the 10-symbol real-cache review and verify existing baseline parity.
5. Lock a candidate-inventory review baseline only after the field is verified.

Avoid combining adapter wiring with any behavior tuning.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_review_wiring_contract
```

Reason: the wiring design is now documented. The next gate should lock the adapter contract and output-shape fixtures before real-cache review output is wired.
