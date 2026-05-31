# LevelAnalysisSnapshot Schema V1 Lock

## Schema Lock Purpose

This document locks the `LevelAnalysisSnapshot` v1 schema expectations for TraderLink Intelligence / journal consumption.

The lock follows the completed evidence chain:

- `LevelAnalysisSnapshot` builder.
- From-candles snapshot builder.
- Replay/as-of safety tests.
- Snapshot export runner.
- Schema stabilization.
- Multi-scenario fixture pack.
- Initial real-cache validation.
- Real-cache extension behavior acceptance.
- Real-cache synthetic extension regression tests.
- Journal connector consumption contract.
- Expanded 12-symbol real cached replay validation.

This is a schema/contract hardening gate only. It does not change support/resistance detection, LevelEngine output behavior, runtime mode defaults, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, extension generation, journal grading, coaching, P/L, giveback, behavior scoring, or recommendation language.

## V1 Schema Status

`LevelAnalysisSnapshot` is now locked as the v1 factual chart-analysis contract candidate for downstream TraderLink Intelligence / journal use.

The locked schema identifier is:

```text
level-analysis-snapshot/v1
```

The locked producer is:

```text
levels-system
```

Downstream consumers should treat this as the stable v1 contract unless a future `v2` schema is introduced.

## Required Top-Level Fields

Every v1 snapshot must include these top-level fields:

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

Those fact sections can be absent in degraded or prebuilt-output composition paths, but absence must be treated as a data-completeness limitation and should be reflected by `diagnostics`.

## Required Identity Fields

Required identity fields:

- `schemaVersion`: string beginning with `level-analysis-snapshot/v1`
- `producer`: `levels-system`
- `symbol`: normalized symbol
- `asOfTimestamp`: numeric point-in-time snapshot timestamp
- `referencePrice`: numeric price used for distance and nearest-level context when present

`referencePrice` remains optional at the type level for compatibility with prebuilt or degraded snapshot composition. TraderLink Intelligence / journal connector flows that need nearest-level context should require it.

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

Each per-timeframe entry in `inputSummary.timeframes` must include:

- `provided`
- `candleCount`
- `filteredCandleCount`
- `excludedFutureCandleCount`
- `excludedPartialCandleCount`

The `15m` key is intentionally present for forward compatibility even when no `15m` input is provided.

## Required Nearest-Level Shape

`nearestSupport` and `nearestResistance` must always be present as fields.

Each field may be:

- `null`, when no level exists on the correct side of `referencePrice`, or
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
- `extensionSource`, only when present on the source level

Nearest levels are derived only from existing `levelEngineOutput` and `referencePrice`. They must not create new levels or change support/resistance detection.

## Required LevelEngineOutput Presence

`levelEngineOutput` is the canonical level map and must be present.

Required fields inside `levelEngineOutput`:

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

Required extension container fields:

- `extensionLevels.support`
- `extensionLevels.resistance`

Downstream consumers must not mutate, rerank, or reinterpret bucket membership as journal grading.

## Required Fact Sections

For supported from-candles journal snapshots, the following sections should be present:

- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`

These sections are factual chart and market context only.

Compatibility note: the schema allows these sections to be absent in prebuilt or degraded paths. Consumers should treat missing fact sections as non-fatal only when the consuming feature can operate without them and diagnostics explain the limitation.

## Required Intelligence / Audit Sections

Every v1 snapshot must include:

- `levelIntelligenceReport`
- `levelQualityAudit`

`levelIntelligenceReport` provides factual level explanations and nearby context. It is not trade advice.

`levelQualityAudit` provides quality and coverage diagnostics. It is not a trading instruction.

## Required Diagnostics And Safety Sections

Every v1 snapshot must include:

- `diagnostics`
- `safety`

`diagnostics` must be an array of string diagnostic codes or notes.

`safety` must include:

- `noLookaheadApplied`
- `levelOutputUnchanged`
- `factsOnlyVWAP`
- `shelvesAreFactsOnly`
- `syntheticExtensionsClearlyMarked`
- `noRuntimeBehaviorChange`

For supported from-candles journal snapshots, these safety flags should be true:

- `noLookaheadApplied`
- `levelOutputUnchanged`
- `factsOnlyVWAP`
- `shelvesAreFactsOnly`
- `syntheticExtensionsClearlyMarked`
- `noRuntimeBehaviorChange`

If `noLookaheadApplied` is false, downstream replay/journal consumers should reject or quarantine the snapshot for review.

## Optional / Nullable Fields

Nullable or optional v1 fields:

- `referencePrice`: optional in degraded/prebuilt composition, required by journal features that need nearest-level context.
- `nearestSupport`: nullable.
- `nearestResistance`: nullable.
- `sessionFacts`: optional in degraded/prebuilt paths.
- `volumeFacts`: optional in degraded/prebuilt paths.
- `volumeShelves`: optional in degraded/prebuilt paths.
- `marketContext`: optional when insufficient facts are available.
- `factsBundle`: optional when facts are missing.
- `nearestSupport.extensionSource`: optional.
- `nearestResistance.extensionSource`: optional.
- `FinalLevelZone.extensionMetadata`: optional and present mainly for synthetic continuation-map rows.

Consumers should distinguish missing optional data from malformed required data.

## Experimental / Additive Fields

These areas are useful but may evolve additively:

- Detailed `levelQualityAudit` finding names and nested diagnostic arrays.
- Market context subfields such as runner phase and scoring adjustments.
- Human-readable explanation strings.
- Synthetic extension spacing and ladder density.
- Future `15m` timeframe support.
- Future source-data completeness metadata beyond `inputSummary`.
- Future compact connector view models derived from the full snapshot.

Downstream systems should preserve unknown fields and should not hard-fail on additive fields.

## Compatibility Rules

V1 compatibility rules:

- Required top-level fields must remain present for v1.
- Additive fields are allowed.
- Unknown fields must be tolerated by downstream readers.
- Existing required field meanings must not be repurposed without a schema version change.
- Optional sections may be absent only when input/fact availability does not support them.
- `levelEngineOutput` remains the canonical level map.
- `nearestSupport` and `nearestResistance` remain convenience fields derived from `levelEngineOutput`.
- Synthetic continuation-map rows must remain explicitly marked when present.

## No-Lookahead Requirements

Every historical, replay, or journal snapshot must use an explicit `asOfTimestamp`.

No-lookahead rules:

- Future candles must be excluded.
- Still-forming candles must be excluded using candle-close semantics.
- Appending future candles must not change a snapshot for the same `asOfTimestamp`.
- `levelEngineOutput.generatedAt` must not exceed `asOfTimestamp`.
- Fact timestamps must not exceed `asOfTimestamp`.
- `safety.noLookaheadApplied` must be true for supported replay/journal snapshots.

## Downstream Consumption Guarantees

TraderLink Intelligence / journal consumers can rely on:

- Stable v1 identity fields.
- Stable input-summary containers.
- Stable nearest-level field presence and nullable behavior.
- Stable `levelEngineOutput` presence as the canonical map.
- Stable fact sections for supported from-candles snapshots.
- Stable intelligence and audit section presence.
- Stable diagnostics and safety section presence.
- Synthetic continuation-map rows being clearly marked when present.
- VWAP and volume shelves remaining facts-only.
- The snapshot being factual chart-analysis context, not journal grading.

## What Is Explicitly Not Guaranteed

The v1 schema does not guarantee:

- Every snapshot has nearest support.
- Every snapshot has nearest resistance.
- Every bucket contains levels.
- Every snapshot has extension rows.
- Every snapshot has synthetic continuation-map rows.
- Every snapshot has healthy extension coverage.
- Human-readable explanation wording remains byte-identical forever.
- Detailed market context subfields are final.
- Detailed audit finding names are final.
- A downstream journal UI shape.
- Trade grading, coaching, P/L, giveback, behavior scoring, or trade recommendations.

## Schema Evolution Rules

Allowed within v1:

- Additive fields.
- New optional diagnostics.
- New optional facts metadata.
- Additional optional fields inside existing report/audit sections.
- Additional optional source/timeframe details.

Requires v2:

- Removing required top-level fields.
- Renaming required top-level fields.
- Changing required field types.
- Replacing `levelEngineOutput` as the canonical level map.
- Changing `schemaVersion` semantics.
- Making trade grading/coaching/P/L/giveback behavior part of the snapshot contract.

## Migration Rules For Future V2

If a future v2 is introduced:

- Keep v1 generation available until downstream consumers migrate.
- Publish a v1-to-v2 migration note.
- Provide a fixture pair showing the same candle input rendered as v1 and v2.
- Preserve no-lookahead guarantees.
- Preserve factual chart-analysis boundaries.
- Keep synthetic continuation-map metadata clearly distinguishable from historical support/resistance.
- Do not add journal grading/coaching/P/L/giveback behavior to `levels-system`.

## Validation Checklist

Consumers and tests should verify:

- `schemaVersion` starts with `level-analysis-snapshot/v1`.
- `producer` equals `levels-system`.
- `symbol` is present.
- `asOfTimestamp` is present.
- `referencePrice` is present for journal features requiring nearest-level context.
- `inputSummary` includes candle counts, filtered counts, excluded future/partial counts, `timeframesPresent`, and per-timeframe summaries.
- `nearestSupport` is either `null` or matches the nearest-level shape.
- `nearestResistance` is either `null` or matches the nearest-level shape.
- `levelEngineOutput` is present.
- `sessionFacts`, `volumeFacts`, `volumeShelves`, `marketContext`, and `factsBundle` are present for supported from-candles snapshots.
- `levelIntelligenceReport` is present.
- `levelQualityAudit` is present.
- `diagnostics` is present.
- `safety` is present.
- Safety flags are true for supported from-candles snapshots.
- Synthetic continuation-map rows, when present, include explicit synthetic metadata and evidence limitations.
- Synthetic continuation-map rows are not treated as historical support/resistance.
- Snapshot-generated text does not include recommendation, coaching, grading, P/L, or giveback language.
- Unknown additive fields are tolerated.

## Validation Coverage Added

Focused schema lock tests were added in:

```text
src/tests/level-analysis-snapshot-schema-v1-lock.test.ts
```

The tests validate:

- Current deterministic from-candles snapshot shape.
- Generated sample artifact shape.
- Nullable nearest-level behavior.
- Additive unknown-field tolerance.
- Synthetic continuation-map marking.
- Absence of recommendation/coaching/grading language.

Existing snapshot, from-candles, replay-safety, runner, fixture-pack, real-cache synthetic edge-case, and expanded real-cache validation work remain part of the evidence for this lock.

## Recommended Next Gate

Recommended next gate: `journal_connector_contract_test_fixture`.

Rationale: the v1 schema is now locked and validated. The next best step is to produce a small, stable, downstream-oriented fixture specifically for TraderLink Intelligence / journal connector tests, so the consuming system has a compact contract sample without depending on large real-cache artifacts.
