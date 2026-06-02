# Level Quality Candidate Inventory Review Wiring Contract

## Purpose

This contract locks the candidate inventory review wiring wrapper and deterministic output-shape fixtures before real candidate inventory visibility is wired into the packaged level quality review process.

This is a contract/fixture gate. It does not wire real candidate inventory into runtime review output and does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Adapter Contract

The future adapter remains a separate implementation gate. This contract locks the wrapper that the adapter must produce.

Suggested future adapter module:

```text
src/lib/levels/level-candidate-inventory-review-adapter.ts
```

Locked wrapper module:

```text
src/lib/levels/level-candidate-inventory-review-wiring.ts
```

The wrapper module is pure. It validates output shape only. It does not rebuild candidates, read cache files, call providers, write artifacts, or wire into `npm run review:level-quality`.

## Input Contract

The future adapter should accept:

- `LevelCandidatePoolDiagnosticsReport`;
- symbol;
- provider;
- as-of timestamp;
- reference price;
- source file map;
- optional limitations when candidate stage inventory is unavailable.

The adapter must not accept raw candles or full snapshots as output payloads. If it needs raw candles to rebuild diagnostics in a later gate, those candles must remain local inputs and must not be serialized in the wrapper.

## Output Wrapper Shape

Primary type:

```text
LevelCandidateInventoryReviewVisibilityWrapper
```

It is one of:

- `LevelCandidateInventoryReviewPresentWrapper`;
- `LevelCandidateInventoryReviewMissingWrapper`.

Validation helpers:

- `validateLevelCandidateInventoryReviewVisibilityWrapper(value)`
- `isLevelCandidateInventoryReviewVisibilityWrapper(value)`
- `assertLevelCandidateInventoryReviewVisibilityFactsOnly(value)`

## Present Wrapper

Present shape:

```text
{
  present: true,
  visibility: LevelCandidateInventoryVisibility,
  gapSummary: LevelCandidateInventoryGapSummary
}
```

Rules:

- `visibility` must pass `validateLevelCandidateInventoryVisibility`.
- `gapSummary` must exactly match `summarizeLevelCandidateInventoryGaps(visibility)`.
- facts-only validation must pass for both the wrapper and nested visibility.
- output must remain compact.

## Missing Wrapper

Missing shape:

```text
{
  present: false,
  limitations: ["raw_clustered_scored_inventory_not_available"],
  diagnostics: ["candidate_inventory_visibility_not_available"]
}
```

Rules:

- `limitations` must include `raw_clustered_scored_inventory_not_available`.
- `diagnostics` must include `candidate_inventory_visibility_not_available`.
- `visibility` must be omitted.
- `gapSummary` must be omitted.
- the wrapper must not infer a gap classification from surfaced levels alone.

## Text Output Shape

Future packaged review text should add one compact line per symbol only after runtime review wiring is approved.

Suggested line:

```text
- Candidate inventory: present=true; gap=closer_unsurfaced_candidate; supportCloser=1; resistanceCloser=0
```

For missing inventory:

```text
- Candidate inventory: present=false; limitations=raw_clustered_scored_inventory_not_available
```

This gate does not add those lines to the current review command.

## Baseline Compatibility Rules

Future wiring must be additive.

Existing baseline comparison fields must remain unchanged:

- nearest support/resistance;
- bucket counts;
- extension counts;
- synthetic continuation-map count and marking;
- diagnostics;
- diagnostic semantics;
- enrichment breakdown;
- density metric;
- 15m context-only checks.

The first wiring gate should report candidate-inventory presence and validation counts separately. Candidate inventory must remain excluded from old baseline mismatch counts until a separate candidate-inventory baseline lock is approved.

## Validation Rules

Wrapper validation checks:

- wrapper is an object;
- `present` is boolean;
- present wrappers include valid visibility;
- present `gapSummary` matches nested visibility;
- missing wrappers include required limitation and diagnostic;
- missing wrappers omit `visibility` and `gapSummary`;
- facts-only assertion rejects prohibited wording;
- helper calls do not mutate input.

## Safety Boundaries

The wrapper must remain:

- read-only;
- audit-only;
- compact;
- facts-only;
- outside LevelEngine generation behavior;
- outside provider calls;
- outside cache writes;
- outside alert, monitoring, Discord, and journal paths.

It must not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or surfaced levels;
- change extension generation;
- feed 15m into LevelEngine;
- serialize raw candles, full snapshots, raw candidate arrays, or full zone arrays;
- add coaching, grading, P/L, giveback, behavior scoring, recommendations, or trade advice.

## Fixture List

Fixture path:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/review-wiring-fixtures/
```

Locked fixtures:

- `review-wiring-present-no-gap.json`
- `review-wiring-present-closer-unsurfaced-support.json`
- `review-wiring-present-closer-unsurfaced-resistance.json`
- `review-wiring-present-truthful-market-context-gap.json`
- `review-wiring-missing-inventory.json`

Each fixture includes:

- schema version;
- fixture name;
- wrapper;
- expected present state;
- expected gap classification;
- expected limitations and diagnostics;
- factual-only/prohibited-language status.

## Intentionally Not Wired Yet

Candidate inventory visibility is still not wired into:

- `src/scripts/run-level-quality-review.ts`;
- `LevelQualityAuditReport`;
- `LevelAnalysisSnapshot`;
- LevelEngine runtime output;
- alert, monitoring, Discord, or journal paths.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_review_adapter
```

Reason: the output wrapper contract is now locked. The next gate should add a read-only adapter from candidate-pool diagnostics into the wrapper using deterministic fixture diagnostics only, still before real-cache packaged review wiring.
