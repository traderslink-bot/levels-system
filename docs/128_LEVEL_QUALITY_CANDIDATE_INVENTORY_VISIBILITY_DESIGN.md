# Level Quality Candidate Inventory Visibility Design

## Purpose

This design defines a safe, read-only candidate inventory visibility layer for future LevelEngine quality investigations.

The visibility layer lets future reviews inspect raw, clustered, scored, surfaced, extension-candidate, and selected-extension stage visibility without changing support/resistance generation behavior.

This is a design/contract gate. It does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Source

Primary evidence:

- `docs/127_LEVEL_QUALITY_NEAREST_GAP_INVESTIGATION.md`
- `docs/examples/level-analysis-snapshot/level-quality-nearest-gap/latest-level-quality-nearest-gap-investigation.json`

Supporting implementation context:

- `src/scripts/run-level-quality-review.ts`
- `src/scripts/run-level-candidate-pool-diagnostics.ts`
- `src/lib/levels/level-candidate-pool-diagnostics.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/analysis/level-analysis-snapshot-from-candles.ts`

## Current Problem

The packaged real-cache quality review is compact and stable, but it does not expose candidate inventory before surfaced output.

That means a wide nearest-level gap can currently show:

- surfaced nearest support/resistance;
- audit diagnostics;
- density metric state;
- bucket and extension counts.

It cannot directly show:

- raw candidates around reference price;
- clustered zones around reference price;
- scored-but-unsurfaced zones around reference price;
- whether a closer candidate existed before surfaced selection;
- why a closer scored candidate did not surface.

The nearest-gap investigation used a temporary read-only harness and existing pure helpers to answer that question for `HCWB` and `PHOE`. This design packages the contract needed before wiring that visibility into the review process.

## Proposed Compact Inventory Shape

Added pure contract/helper:

```text
src/lib/levels/level-candidate-inventory-visibility.ts
```

The contract root is:

```text
LevelCandidateInventoryVisibility
```

It includes:

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

Validation helpers:

- `validateLevelCandidateInventoryVisibility`
- `isLevelCandidateInventoryVisibility`
- `summarizeLevelCandidateInventoryGaps`
- `assertLevelCandidateInventoryVisibilityFactsOnly`

The helper is pure. It validates a compact payload. It does not build candidates, call providers, load cache files, mutate LevelEngine output, or wire into runtime review output.

## Candidate Stages

The contract tracks these stages:

- `raw`
- `clustered`
- `scored`
- `surfaced`
- `extension_candidate`
- `extension_selected`

Each stage summary reports:

- support count;
- resistance count;
- total count;
- optional counts by timeframe;
- optional counts by source type.

The shape intentionally mirrors existing `level-candidate-pool-diagnostics` vocabulary while staying compact enough for committed artifacts.

## Nearest Comparison Model

The `nearest` field can record nearest support and resistance at each stage:

- nearest raw support/resistance;
- nearest clustered support/resistance;
- nearest scored support/resistance;
- nearest surfaced support/resistance;
- nearest extension-candidate support/resistance when useful;
- nearest selected-extension support/resistance when useful.

Each nearest row can include:

- stage;
- side;
- price;
- distance percentage;
- level id;
- bucket;
- surfaced flag;
- timeframe bias;
- source types.

This lets a review compare whether the nearest visible level is the nearest available candidate, or whether a closer scored candidate exists but did not surface.

## Closer-Unsurfaced Candidate Model

The `unsurfacedCloser` field is side-specific:

- `support`
- `resistance`

Each side records:

- whether a closer unsurfaced candidate is present;
- count of closer unsurfaced candidates;
- nearest closer candidate when present;
- reason availability;
- reason strings when available;
- limitations when reason strings are not available.

Current expected limitation:

```text
surfaced_selection_reason_not_serialized
```

The current system can reconstruct candidate stages with existing helpers, but it does not serialize per-zone surfaced-selection reasons. Future wiring should preserve that limitation unless a separate gate adds reason instrumentation.

## Gap Classification Model

The contract supports these classifications:

- `no_gap`
- `closer_unsurfaced_candidate`
- `truthful_market_context_gap`
- `inconclusive_missing_reasons`

Classification intent:

- `no_gap`: nearest surfaced levels and available candidate stages do not indicate a gap issue.
- `closer_unsurfaced_candidate`: a closer scored candidate exists on a side but is not surfaced.
- `truthful_market_context_gap`: raw, clustered, scored, and surfaced nearest levels align, so the wide gap appears to reflect sparse structure.
- `inconclusive_missing_reasons`: the compact input lacks enough stage inventory or reason data to classify safely.

This is diagnostic language only. It is not a trading signal and does not alter levels.

## Fixture Plan

Added deterministic contract fixtures:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/contract-fixtures/
```

Fixtures:

- `candidate-inventory-no-gap.json`
- `candidate-inventory-closer-unsurfaced-support.json`
- `candidate-inventory-closer-unsurfaced-resistance.json`
- `candidate-inventory-truthful-market-context-gap.json`
- `candidate-inventory-inconclusive-missing-reasons.json`

Each fixture includes:

- schema version;
- fixture name;
- compact input summary;
- visibility payload;
- expected classification;
- factual-only/prohibited-language status.

## Tests Added

Added focused test:

```text
src/tests/level-candidate-inventory-visibility-design.test.ts
```

Coverage:

- validates compact inventory fixtures;
- detects closer unsurfaced support;
- detects closer unsurfaced resistance;
- identifies truthful market-context gaps when candidate stages align;
- marks missing stage inventory as inconclusive;
- validates safety flags;
- guards against prohibited language;
- confirms source isolation from providers, alert/monitoring, Discord, journal, and LevelEngine behavior paths;
- confirms helper calls do not mutate inputs.

## Implementation Options

Recommended next implementation sequence:

1. Lock the visibility contract and fixtures.
2. Add a read-only builder that adapts existing candidate-pool diagnostics into this compact shape.
3. Wire the compact visibility output into `npm run review:level-quality` behind additive report fields.
4. Rerun the 10-symbol real-cache review and compare against the locked baseline.

Do not skip directly to behavior tuning. Candidate inventory visibility should be packaged first.

## Safety Boundaries

The visibility contract must remain:

- read-only;
- audit-only;
- compact;
- local-cache/read-only when used with real-cache review;
- free of raw candles and full snapshots;
- free of provider calls;
- free of alert, monitoring, Discord, and journal dependencies;
- factual-only;
- outside LevelEngine generation behavior.

It must not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or surfaced levels;
- change extension generation;
- feed 15m into LevelEngine;
- add coaching, grading, P/L, giveback, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_visibility_contract
```

Reason: the design and lightweight type/validation contract now exist. The next gate should lock the contract and fixture suite before wiring candidate inventory visibility into the packaged review process.
