# Downstream Connector Adapter Test Pack

## Purpose

This note describes the downstream connector adapter test pack for the locked `LevelAnalysisSnapshot` v1 contract.

The test pack is contract-focused. It validates how a TraderLink Intelligence / journal connector can load, validate, preserve, and derive a factual view from the compact snapshot fixture without adding journal behavior to `levels-system`.

## Test File

```text
src/tests/level-analysis-snapshot-downstream-adapter-test-pack.test.ts
```

## Primary Fixture

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

## What The Test Pack Validates

The pack validates:

- valid fixture acceptance
- v1 schema and producer checks
- required top-level fields
- locked input summary timeframe keys
- canonical `LevelEngineOutput` buckets
- diagnostics and safety presence
- raw snapshot preservation
- additive-field tolerance
- factual connector view derivation
- quarantine behavior for malformed snapshots
- nullable nearest-level handling
- optional fact-section limitations
- synthetic continuation-map marking
- quality audit handling as diagnostics only
- guardrails against downstream-owned journal behavior in derived views

## What It Intentionally Does Not Validate

The test pack does not validate:

- support/resistance detection changes
- LevelEngine tuning
- extension generation tuning
- alert behavior
- monitoring behavior
- Discord behavior
- trader-context behavior
- journal grading
- coaching
- P/L
- giveback
- behavior scoring
- recommendation language

## Quarantine Scenarios

The pack verifies that adapter-style validation quarantines snapshots with:

- missing `schemaVersion`
- unsupported schema major version
- wrong producer
- missing `symbol`
- missing `asOfTimestamp`
- missing `inputSummary`
- missing `levelEngineOutput`
- missing `diagnostics`
- missing `safety`
- `safety.noLookaheadApplied` set to false for replay/journal use
- synthetic rows present while `safety.syntheticExtensionsClearlyMarked` is false
- malformed nearest-level objects

## Nullable And Optional Scenarios

The pack verifies that adapter-style validation can accept degraded-but-valid snapshots while surfacing limitations for:

- `nearestSupport: null`
- `nearestResistance: null`
- empty extension arrays
- empty `volumeShelves`
- absent optional `marketContext`
- absent optional `factsBundle`
- additive unknown fields at top level and nested metadata

## Synthetic Continuation-Map Expectations

Synthetic continuation-map extension rows must:

- remain in `extensionLevels`
- stay out of surfaced major/intermediate/intraday buckets
- keep `extensionMetadata.extensionSource = "synthetic_continuation_map"`
- include evidence limitations such as `not_historical_support_resistance`
- avoid fake touch, rejection, or historical confluence evidence

## Quality Audit Expectations

`LevelQualityAudit` findings are surfaced as factual quality/coverage context.

The test pack keeps audit findings in diagnostics/limitations and does not derive instructions, advice, grades, or coaching fields from audit content.

## How Downstream Can Mirror This Pack

TraderLink Intelligence / journal connector tests can mirror the pack by:

1. Loading the compact fixture.
2. Running v1 schema validation.
3. Preserving the raw snapshot unchanged.
4. Deriving a compact factual view.
5. Testing quarantine behavior with malformed copies.
6. Testing nullable and optional-data tolerance.
7. Verifying synthetic metadata remains visible.
8. Verifying quality audit findings stay diagnostic.
9. Rejecting any connector view that introduces journal-owned interpretation fields.

## Anti-Goals

The connector test pack must not become a journal product implementation. It should not add grading, coaching, P/L, giveback, behavior scoring, entry/exit decisions, trade advice, alert routing, Discord behavior, or LevelEngine behavior changes.
