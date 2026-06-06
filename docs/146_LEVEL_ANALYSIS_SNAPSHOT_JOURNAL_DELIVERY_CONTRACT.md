# LevelAnalysisSnapshot Journal Delivery Contract

## Purpose

This gate defines the facts-only delivery contract that the TraderLink Intelligence journal should consume from `levels-system`.

The contract is intentionally a delivery boundary, not a journal app implementation. It packages the current locked `LevelAnalysisSnapshot` and packaged review evidence into a stable handoff shape for downstream ingestion. It does not change support/resistance generation, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, 15m LevelEngine eligibility, cache collection, alerts, monitoring, Discord, or journal app behavior.

## Evidence Source

Reviewed:

- `docs/79_JOURNAL_CONNECTOR_LEVEL_ANALYSIS_CONTRACT.md`
- `docs/83_DOWNSTREAM_CONNECTOR_ADAPTER_BLUEPRINT.md`
- `docs/134_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_BASELINE_LOCK.md`
- `docs/138_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_REVIEW_WIRING.md`
- `docs/143_LEVEL_QUALITY_REVIEW_BASELINE_REFRESH_CURRENT_CACHE.md`
- `docs/144_LEVEL_QUALITY_REVIEW_POST_REFRESH_STABILITY_CHECK.md`
- `docs/145_LEVEL_QUALITY_REVIEW_VOLUME_SESSION_FACT_COVERAGE_AUDIT.md`
- `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json`

The delivery contract uses the refreshed active IBKR review artifact as the current source baseline because it contains the current additive fields:

- cache fingerprints
- density metric
- candidate inventory visibility
- candidate volume/session context
- baseline parity fields
- 15m context-only checks

## Delivery Boundary

`levels-system` delivers immutable factual chart context.

The journal app owns downstream storage, UI, user workflows, execution-specific interpretation, and any product-specific wording. The journal should consume the levels-system payload as source context and preserve the raw source artifact or an equivalent immutable copy for auditability.

This contract does not authorize the journal app to mutate `LevelEngineOutput`, rerank levels, rewrite synthetic continuation-map metadata, or treat volume/session context as a level-selection input.

## Delivery Source Package

The current delivery source package has two layers.

Layer 1: compact snapshot fixture

- Path: `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- Purpose: stable v1 snapshot shape for connector parser tests.
- Status: useful for schema compatibility and base snapshot validation.

Layer 2: refreshed packaged review artifact

- Path: `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- Purpose: current ten-symbol delivery package with density, candidate inventory, volume/session context, and cache fingerprints.
- Status: current journal delivery source for additive quality/review fields.

The journal integration should start with Layer 2 for the professional chart-reading context now available, while still using Layer 1 as a small parser fixture.

## Required Delivery Fields

The delivery package should expose these factual sections.

Identity:

- `schemaVersion`
- `generatedAt`
- `provider`
- `reviewedSymbols`
- `supplied15mSymbols`

Per-symbol chart context:

- `symbol`
- `provider`
- `asOfTimestamp`
- `asOfIso`
- `referencePrice`
- `previousClose`
- `sourceFiles`
- `nearestLevels`
- `bucketCounts`
- `extensionCoverage`
- `syntheticContinuationMap`
- `qualityAudit`
- `diagnosticSemantics`
- `fifteenMinuteContext`
- `safety`

Additive review context:

- `qualityAudit.densityMetric`
- `candidateInventoryVisibility`
- `candidateVolumeSessionContext`
- `cacheFingerprintSet`
- `cacheFingerprintSummary`
- `summary`
- `prohibitedLanguageHits`

The journal should treat unknown additive fields defensively and preserve them when possible.

## Compact Journal View Shape

The journal app may derive a compact read-only view from the delivery package. Suggested shape:

```ts
type LevelAnalysisJournalDeliveryView = {
  contract: {
    schemaVersion: string;
    producer: "levels-system";
    sourceArtifact: string;
    compatible: boolean;
  };
  identity: {
    symbol: string;
    provider: "ibkr" | "stub" | "twelve_data";
    asOfTimestamp: number;
    asOfIso?: string;
    referencePrice?: number;
  };
  levelContext: {
    nearestLevels: unknown;
    bucketCounts: Record<string, number>;
    extensionCoverage: unknown;
    syntheticContinuationMap: unknown;
  };
  qualityContext: {
    diagnostics: string[];
    diagnosticSemantics: unknown[];
    densityMetric?: unknown;
  };
  candidateContext: {
    candidateInventoryVisibility?: unknown;
    gapSummary?: unknown;
  };
  volumeSessionContext: {
    candidateVolumeSessionContext?: unknown;
    comparisonSummary?: unknown;
    diagnostics: string[];
  };
  sourceIntegrity: {
    cacheFingerprintSummary: unknown;
    cacheFingerprintSet?: unknown;
    fifteenMinuteContextOnly: boolean;
  };
  safety: {
    readOnly: boolean;
    factsOnly: boolean;
    noLevelSelectionChange: boolean;
    noRuntimeBehaviorChange: boolean;
  };
  limitations: string[];
};
```

The view is optional. The journal may store the source package directly and derive its own internal view, but it should keep the same factual boundaries.

## Current Readiness Evidence

The current refreshed review baseline is stable:

- reviewed symbols: `10`
- baseline mismatch count: `0`
- cache fingerprints: `35`
- LevelEngine input fingerprints: `30`
- context-only fingerprints: `5`
- 15m context-only fingerprints: `5`
- density metric present: `10/10`
- candidate inventory present and valid: `10/10`
- candidate volume/session context present and valid: `10/10`
- session facts present: `10/10`
- volume facts present: `10/10`
- volume shelf context present: `10/10`
- restricted-language hits: `0`

The current delivery evidence supports journal ingestion of factual chart context. It does not imply that generation behavior should be tuned.

## Journal Consumption Rules

The journal connector should:

- validate `schemaVersion` and `provider`
- validate required per-symbol fields
- validate cache fingerprint shape
- validate `densityMetric` when present
- validate candidate inventory wrappers
- validate candidate volume/session context
- preserve source artifacts or immutable parsed equivalents
- preserve unknown additive fields
- surface limitations separately from the raw payload
- keep 15m context-only unless a future approved gate changes that
- treat synthetic continuation-map rows as synthetic chart-map context only
- treat volume shelves and VWAP as facts-only context

The journal connector should not:

- mutate level buckets
- rerank levels
- rewrite surfaced support/resistance
- rewrite extension rows
- collapse candidate inventory into runtime generation behavior
- use volume/session facts to select levels
- infer user-specific outcomes from quality diagnostics alone

## Required Journal-Side Validation

The journal-side connector should include tests that mirror the levels-system fixture tests:

- parse current delivery artifact
- validate all ten symbols are present
- validate cache fingerprints and 15m context-only status
- validate density metrics
- validate candidate inventory wrappers
- validate candidate volume/session context
- validate baseline mismatch count remains `0`
- validate no raw candles, full snapshots, raw cache wrapper payloads, or provider responses are required
- validate restricted wording remains absent
- validate unknown additive fields are tolerated
- validate malformed payloads are quarantined instead of coerced

## Current Limitations To Surface

The journal connector should surface these limitations without treating them as fatal:

- candidate identifiers are unavailable for some unsurfaced scored comparison rows
- surfaced selection reasons are not serialized
- some compact context rows have no nearby volume shelf
- some symbols have limited regular-session or premarket candle facts in compact session context
- cache fingerprint validation issues describe wrapper/input completeness and should be shown as source-integrity context

These limitations help the journal tell users what facts were available, but they are not behavior-tuning evidence by themselves.

## Integration Ownership

Levels-system owns:

- snapshot and review artifact generation
- support/resistance map output
- density metric output
- candidate inventory visibility output
- candidate volume/session context output
- cache fingerprint output
- facts-only safety flags

The journal app owns:

- persistence
- ingestion jobs
- UI presentation
- account/user workflow
- journal record linking
- any user-specific interpretation layer

The two systems should integrate through the contract and artifacts, not through private LevelEngine internals.

## Hard Boundaries

This gate did not:

- tune support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts to change scoring or surfaced selection
- collect cache data
- write cache wrapper files
- commit raw cache files
- include raw candles
- include full snapshots
- change runtime defaults
- change alert, monitoring, or Discord behavior
- modify journal app files
- add journal-owned interpretation behavior

## Artifact Map

New contract artifacts:

- `docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.json`
- `docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.txt`

Primary source artifacts:

- `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json`

## Recommended Next Gate

Recommended next gate:

```text
level_analysis_snapshot_journal_delivery_handoff
```

Reason: the delivery contract is now defined and fixture-backed on the levels-system side. A short handoff should tell the journal app Codex which artifact to consume, which fields are stable, which limitations to surface, and which boundaries must remain outside `levels-system`.
