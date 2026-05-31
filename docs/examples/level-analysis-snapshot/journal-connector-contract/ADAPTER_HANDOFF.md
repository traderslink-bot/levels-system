# Downstream Adapter Handoff

## Purpose

This note explains how TraderLink Intelligence / journal connector code should use the compact `LevelAnalysisSnapshot` v1 fixture.

Use this file together with:

- `docs/79_JOURNAL_CONNECTOR_LEVEL_ANALYSIS_CONTRACT.md`
- `docs/81_LEVEL_ANALYSIS_SNAPSHOT_SCHEMA_V1_LOCK.md`
- `docs/82_LEVEL_ANALYSIS_SNAPSHOT_V1_RELEASE_NOTES.md`
- `docs/83_DOWNSTREAM_CONNECTOR_ADAPTER_BLUEPRINT.md`

## Fixture

Use:

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

The fixture is compact, deterministic, and suitable for connector tests. It includes real historical levels, one synthetic continuation-map extension row, facts, diagnostics, safety flags, a level intelligence report, and a level quality audit.

## What The Downstream App Should Validate

Connector tests should validate:

- `schemaVersion` begins with `level-analysis-snapshot/v1`
- `producer` equals `levels-system`
- `symbol` and `asOfTimestamp` are present
- `inputSummary` and candle counts are present
- `nearestSupport` and `nearestResistance` are present as fields
- `levelEngineOutput` has canonical buckets
- facts, diagnostics, reports, audit, and safety sections are present
- `safety.noLookaheadApplied` is true for replay/journal use
- synthetic rows remain marked as `synthetic_continuation_map`
- unknown additive fields are preserved or ignored safely

## How To Map To A Connector View

Derive a read-only factual view from the snapshot:

- contract identity from `schemaVersion` and `producer`
- snapshot identity from `symbol`, `asOfTimestamp`, and `referencePrice`
- nearest levels from `nearestSupport` and `nearestResistance`
- bucket counts from `levelEngineOutput`
- fact presence from `sessionFacts`, `volumeFacts`, `volumeShelves`, `marketContext`, and `factsBundle`
- quality context from `levelQualityAudit`
- diagnostics from snapshot and audit diagnostics
- safety from `snapshot.safety`
- synthetic extension summary from extension rows with `extensionMetadata.extensionSource`

Keep the original snapshot unchanged and available for audit.

## What To Preserve

Preserve:

- raw snapshot JSON or equivalent parsed object
- unknown additive fields
- `levelEngineOutput` bucket membership
- synthetic continuation-map metadata
- quality audit findings
- diagnostics
- safety flags

## What Not To Infer

Do not infer:

- trade grading
- coaching
- P/L
- giveback
- behavior scoring
- buy/sell/hold decisions
- entry/exit instructions
- journal UI conclusions

The snapshot is factual chart context only.

## Failure And Quarantine Handling

Quarantine snapshots when:

- JSON parsing fails
- schema major version is unsupported
- producer is not `levels-system`
- required fields are missing
- replay/journal use lacks `safety.noLookaheadApplied: true`
- synthetic rows exist without clear synthetic marking
- nearest-level fields have malformed shapes

Keep quarantine reasons separate from the raw snapshot so failed payloads can still be inspected.

## Future V2 Preparation

For future schema versions:

- keep v1 fixture tests
- preserve unknown fields
- reject unknown major versions by default
- add explicit v2 adapter handling when a v2 schema exists
- do not silently coerce v2 snapshots into v1 views
