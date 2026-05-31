# Downstream Connector Adapter Blueprint

## Purpose

This blueprint describes how TraderLink Intelligence / the journal app should load, validate, preserve, and consume `LevelAnalysisSnapshot` v1.

It is a downstream integration handoff. It is not a LevelEngine tuning plan, not production adapter code inside `levels-system`, and not a journal grading implementation.

## Boundary Statement

`levels-system` owns factual candle-data chart analysis:

- support/resistance detection
- canonical `LevelEngineOutput`
- nearest support/resistance convenience fields
- session facts
- volume facts
- volume shelves
- market context
- level intelligence reports
- level quality audits
- no-lookahead as-of safety metadata

TraderLink Intelligence / the journal owns downstream interpretation and presentation:

- execution interpretation
- journal UI behavior
- trade grading
- coaching
- P/L
- giveback analysis
- behavior scoring
- user-facing workflow decisions

The connector sits between those systems. It should protect the boundary by treating `LevelAnalysisSnapshot` as immutable factual chart context.

## Adapter Responsibilities

The downstream adapter may:

- load `LevelAnalysisSnapshot` v1 JSON
- validate `schemaVersion` and `producer`
- validate required fields
- verify safety flags for replay/journal use
- preserve the raw snapshot unchanged
- derive a small read-only factual connector view
- expose canonical support/resistance buckets
- expose nearest levels
- expose session, volume, shelf, and market context facts
- expose diagnostics, safety, and quality audit summaries
- expose synthetic continuation-map metadata as factual forward-planning chart context
- surface data-completeness limitations
- pass factual context to downstream journal/intelligence systems

## Adapter Non-Responsibilities

The adapter must not:

- grade trades
- coach users
- calculate P/L
- calculate giveback
- score behavior
- provide buy/sell/hold recommendations
- mutate `LevelAnalysisSnapshot`
- mutate or rerank `LevelEngineOutput`
- treat synthetic continuation-map rows as historical support/resistance
- treat `LevelQualityAudit` findings as trading instructions
- convert level scores directly into journal grades
- hide or rewrite no-lookahead and data-completeness diagnostics

## Input Sources

Recommended inputs:

- persisted `LevelAnalysisSnapshot` v1 JSON from the snapshot runner
- the compact connector fixture for tests:
  - `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- generated replay snapshots from:
  - `docs/examples/level-analysis-snapshot/outputs/`
  - `docs/examples/level-analysis-snapshot/real-cache-more-symbols/`

The adapter should not fetch candles, call live data, call alert routing, or post to Discord.

## Snapshot Loading Flow

Suggested loading flow:

1. Read snapshot JSON from storage or test fixture.
2. Parse JSON.
3. Validate base object shape.
4. Validate v1 contract fields.
5. Validate replay/journal safety flags.
6. Preserve the raw parsed snapshot unchanged.
7. Derive a compact read-only connector view.
8. Pass the view plus raw snapshot reference to downstream consumers.

If parsing fails, the adapter should quarantine the payload and report a connector-level validation error.

## Snapshot Validation Flow

Minimum validation:

1. Confirm `schemaVersion` starts with `level-analysis-snapshot/v1`.
2. Confirm `producer` equals `levels-system`.
3. Confirm `symbol` exists.
4. Confirm `asOfTimestamp` exists.
5. Confirm `inputSummary` exists.
6. Confirm candle summary fields exist.
7. Confirm `nearestSupport` and `nearestResistance` fields exist.
8. Confirm nearest levels are `null` or match the locked nearest-level shape.
9. Confirm `levelEngineOutput` exists.
10. Confirm `levelIntelligenceReport` exists.
11. Confirm `levelQualityAudit` exists.
12. Confirm `diagnostics` exists.
13. Confirm `safety` exists.
14. Confirm `safety.noLookaheadApplied` is true for replay/journal use.
15. Confirm synthetic rows are marked when present.

The adapter may accept snapshots with optional fact sections missing only when the consuming feature can operate without those facts and the limitation is surfaced.

## Snapshot Preservation / Audit Flow

The adapter should preserve the original snapshot exactly as received.

Recommended preservation rules:

- store raw JSON or a canonical parsed object
- store `schemaVersion`, `producer`, `symbol`, and `asOfTimestamp` as searchable identity fields
- store validation outcome separately from the snapshot
- store quarantine reasons separately from the snapshot
- never mutate `levelEngineOutput`
- never rewrite synthetic metadata
- never remove unknown additive fields

This allows replay, audit, and future v2 migrations to compare downstream views back to the original factual input.

## Normalized Connector View Model

The downstream app may derive a compact factual view for easier consumption.

Suggested TypeScript-style sketch:

```ts
type LevelAnalysisConnectorView = {
  contract: {
    schemaVersion: string;
    producer: "levels-system";
    compatibleV1: boolean;
  };
  identity: {
    symbol: string;
    asOfTimestamp: number;
    referencePrice?: number;
  };
  sourceSnapshot: LevelAnalysisSnapshot;
  inputSummary: LevelAnalysisSnapshot["inputSummary"];
  nearest: {
    support: LevelAnalysisSnapshot["nearestSupport"];
    resistance: LevelAnalysisSnapshot["nearestResistance"];
  };
  levelMap: {
    bucketCounts: Record<string, number>;
    extensionCounts: {
      support: number;
      resistance: number;
    };
  };
  facts: {
    hasSessionFacts: boolean;
    hasVolumeFacts: boolean;
    volumeShelfCount: number;
    hasMarketContext: boolean;
    hasFactsBundle: boolean;
  };
  diagnostics: {
    snapshot: string[];
    audit: string[];
  };
  safety: LevelAnalysisSnapshot["safety"];
  quality: {
    auditPresent: boolean;
    extensionCoverageWarnings: string[];
    clusteredAreaCount: number;
    staleLevelCount: number;
  };
  syntheticExtensions: {
    count: number;
    levels: Array<{
      id: string;
      kind: "support" | "resistance";
      representativePrice: number;
      source: "synthetic_continuation_map";
      evidenceLimitations: string[];
    }>;
  };
  compatibility: {
    preserveUnknownFields: true;
    acceptedSchemaMajor: "v1";
  };
  limitations: string[];
};
```

This view is intentionally factual. It should not contain grading, coaching, P/L, giveback, behavior score, entry, exit, or recommendation fields.

## Field Mapping From Snapshot To Connector View

Suggested mapping:

| Connector Field | Source Field |
| --- | --- |
| `contract.schemaVersion` | `snapshot.schemaVersion` |
| `contract.producer` | `snapshot.producer` |
| `contract.compatibleV1` | `snapshot.schemaVersion.startsWith("level-analysis-snapshot/v1")` |
| `identity.symbol` | `snapshot.symbol` |
| `identity.asOfTimestamp` | `snapshot.asOfTimestamp` |
| `identity.referencePrice` | `snapshot.referencePrice` |
| `sourceSnapshot` | raw parsed snapshot object |
| `inputSummary` | `snapshot.inputSummary` |
| `nearest.support` | `snapshot.nearestSupport` |
| `nearest.resistance` | `snapshot.nearestResistance` |
| `levelMap.bucketCounts` | counts from canonical `levelEngineOutput` buckets |
| `facts.hasSessionFacts` | `Boolean(snapshot.sessionFacts)` |
| `facts.hasVolumeFacts` | `Boolean(snapshot.volumeFacts)` |
| `facts.volumeShelfCount` | `snapshot.volumeShelves?.length ?? 0` |
| `diagnostics.snapshot` | `snapshot.diagnostics` |
| `diagnostics.audit` | `snapshot.levelQualityAudit.diagnostics` |
| `safety` | `snapshot.safety` |
| `quality.extensionCoverageWarnings` | `snapshot.levelQualityAudit.extensionCoverage.warnings` |
| `syntheticExtensions` | extension rows with `extensionMetadata.extensionSource` |
| `limitations` | missing optional facts, nullable nearest sides, audit warnings, validation warnings |

## Error Handling And Quarantine Rules

The adapter should quarantine, not reinterpret, malformed snapshots.

Quarantine conditions:

- JSON parse failure
- missing `schemaVersion`
- unsupported schema major version
- producer is not `levels-system`
- missing `symbol`
- missing `asOfTimestamp`
- missing `inputSummary`
- missing `levelEngineOutput`
- missing `diagnostics`
- missing `safety`
- `safety.noLookaheadApplied` is false for replay/journal use
- synthetic rows exist while `safety.syntheticExtensionsClearlyMarked` is false
- nearest-level objects do not match the documented shape

Quarantined payloads should be stored for review with validation reasons. They should not be silently coerced into a journal view.

## No-Lookahead Enforcement

For replay and journal use, the adapter should require:

- `asOfTimestamp`
- `inputSummary.filteredCandleCounts`
- `inputSummary.excludedFutureCandleCounts`
- `inputSummary.excludedPartialCandleCounts`
- `safety.noLookaheadApplied: true`

If the safety flag is false or missing, the adapter should reject or quarantine the snapshot for journal replay use.

## Synthetic Continuation-Map Handling

Synthetic continuation-map rows are valid extension rows when clearly marked.

Adapter handling rules:

- surface them only as forward-planning chart map levels
- preserve `extensionMetadata`
- preserve evidence limitations
- do not treat them as historical support/resistance
- do not infer touches, rejections, or historical confluence from them
- do not convert synthetic rows into surfaced support/resistance buckets
- do not hide the synthetic marker in downstream views

Required marker:

```text
extensionMetadata.extensionSource = "synthetic_continuation_map"
```

## LevelQualityAudit Handling

`LevelQualityAudit` should be surfaced as quality and coverage diagnostics.

Adapter handling rules:

- expose summary fields
- expose extension coverage warnings
- expose nearby coverage warnings
- expose clustered area counts
- expose stale/weak/enriched/unenriched counts when useful
- do not convert audit findings into trading instructions
- do not convert strength scores into journal grades

Audit findings are useful for downstream UI context and QA workflows, but the journal owns any execution-specific interpretation.

## Diagnostics Handling

Diagnostics should be carried forward as factual metadata.

Suggested grouping:

- snapshot diagnostics from `snapshot.diagnostics`
- audit diagnostics from `snapshot.levelQualityAudit.diagnostics`
- adapter validation warnings
- data-completeness limitations
- quarantine reasons when validation fails

Do not suppress diagnostics unless the downstream system has a clear product reason and preserves them elsewhere for audit.

## Optional / Nullable Fields Handling

The adapter should tolerate:

- `nearestSupport: null`
- `nearestResistance: null`
- missing optional fact sections in degraded/prebuilt paths
- zero-count timeframes
- absent `extensionMetadata` on real historical levels
- empty extension arrays
- empty volume shelf arrays

The adapter should record limitations when optional data is missing and the downstream feature expects it.

## Unknown / Additive Fields Handling

V1 allows additive fields.

Adapter rules:

- preserve unknown fields in `sourceSnapshot`
- do not hard-fail on unknown fields
- do not drop unknown fields when persisting raw snapshots
- do not assume unknown fields are stable until documented

Required field meanings must not be repurposed without a future schema version change.

## Version Compatibility And Future V2 Handling

V1 compatibility:

- accept schema strings beginning with `level-analysis-snapshot/v1`
- require `producer: "levels-system"`
- tolerate additive fields
- preserve unknown fields

Future v2 handling:

- reject or quarantine unknown major schema versions by default
- add an explicit v2 adapter path when available
- keep v1 fixtures and tests as regression references
- do not silently coerce v2 payloads into v1 views

## Suggested Connector API Shape

Suggested downstream API sketch:

```ts
type LoadLevelAnalysisSnapshotResult =
  | {
      ok: true;
      rawSnapshot: LevelAnalysisSnapshot;
      view: LevelAnalysisConnectorView;
      limitations: string[];
    }
  | {
      ok: false;
      rawPayload: unknown;
      quarantineReasons: string[];
    };

function loadLevelAnalysisSnapshotForJournal(
  rawJson: string,
): LoadLevelAnalysisSnapshotResult;
```

The API should keep validation and factual view derivation separate from journal interpretation.

## Suggested Test Strategy

Recommended downstream tests:

- compact fixture parses
- v1 schema and producer validate
- required top-level fields validate
- safety flags validate
- raw snapshot is preserved unchanged
- unknown additive fields are tolerated
- nearest levels are null or valid
- canonical bucket counts derive correctly
- fact presence derives correctly
- synthetic continuation-map rows remain labeled
- quality audit warnings surface as diagnostics
- malformed snapshots quarantine
- unsupported schema major versions quarantine
- derived view contains no grading, coaching, P/L, giveback, behavior score, or recommendation fields

The existing compact fixture is the first connector test fixture:

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

## Example Integration Flow

Example flow for the journal app:

1. Snapshot runner or backend job writes `LevelAnalysisSnapshot` JSON.
2. Journal connector loads the JSON.
3. Connector validates v1 identity and safety.
4. Connector persists raw snapshot unchanged.
5. Connector derives a compact factual view.
6. Journal UI reads the factual view for chart context.
7. Any execution interpretation remains in the journal domain.
8. Validation failures route to a quarantine/review queue.

## Explicit Anti-Goals

This blueprint does not add or authorize:

- support/resistance detection changes
- LevelEngine output changes
- extension behavior changes
- alert behavior changes
- monitoring behavior changes
- Discord behavior changes
- trader-context behavior changes
- trade grading
- coaching
- P/L
- giveback analysis
- behavior scoring
- recommendation language
- journal UI behavior inside `levels-system`

## Recommended Next Gate

Recommended next gate:

```text
downstream_connector_adapter_test_pack
```

Reason: the contract, release notes, compact fixture, and adapter blueprint are now sufficient for handoff. A downstream adapter test pack can turn this blueprint into a concrete set of connector-side validation cases without adding journal behavior to `levels-system`.
