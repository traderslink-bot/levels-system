# Level Quality Candidate Inventory Volume Session Context Contract

## Purpose

This gate locks the compact facts-only contract and deterministic fixture suite for candidate/surfaced-level volume-session context.

The contract defines how future gates can describe session facts, volume facts, and volume shelf context around candidate inventory rows and surfaced levels. It does not build the context from live data, wire it into packaged review output, or use volume/session facts to change level generation, scoring, ranking, clustering, surfaced selection, or extension generation.

## Contract Shape

New pure module:

```text
src/lib/levels/level-candidate-volume-session-context.ts
```

Root type:

```text
LevelCandidateVolumeSessionContext
```

Root fields:

- `schemaVersion`: `level-candidate-volume-session-context/v1`
- `symbol`
- `provider`
- `asOfTimestamp`
- optional `asOfIso`
- optional `referencePrice`
- `contexts`
- `comparisonSummary`
- `diagnostics`
- `safety`

The contract module exports:

- `LevelCandidateVolumeSessionContext`
- `LevelCandidateVolumeSessionContextRow`
- `LevelCandidateSessionFactProximity`
- `LevelCandidateVolumeShelfOverlap`
- `LevelCandidateVolumeSessionComparisonSummary`
- `LevelCandidateVolumeSessionComparisonOutcome`
- `validateLevelCandidateVolumeSessionContext`
- `isLevelCandidateVolumeSessionContext`
- `assertLevelCandidateVolumeSessionContextFactsOnly`

## Row Shape

Each context row describes one candidate or surfaced level reference:

- `rowId`
- optional `levelId`
- optional `candidateId`
- `side`: `support` or `resistance`
- `stage`: `raw`, `clustered`, `scored`, `surfaced`, `extension_candidate`, or `extension_selected`
- `price`
- optional `zoneLow` and `zoneHigh`
- optional `distanceFromReferencePct`
- `session`
- `volume`
- `shelves`
- `diagnostics`
- `safety`

Rows are compact facts. They are not raw candidates, full zones, raw candles, full snapshots, or provider responses.

## Session Fact Proximity Model

Supported session fact names:

- `vwap`
- `premarket_high`
- `premarket_low`
- `opening_range_high`
- `opening_range_low`
- `high_of_day`
- `low_of_day`
- `previous_close`
- `regular_session_open`

Supported proximity relations:

- `overlaps`
- `near`
- `outside_threshold`

Every session fact proximity row includes:

- `fact`
- `price`
- `distancePct`
- `relation`
- `factsOnly: true`

VWAP remains facts-only context. It cannot be used by this contract to change scoring, ranking, selection, alerts, monitoring, Discord behavior, or journal behavior.

## Volume Facts Model

Each row may include compact volume facts:

- `relativeVolume`
- `dollarVolume`
- `volumeState`
- `liquidityQuality`
- `accelerationState`
- `pullbackVolumeState`
- `breakoutVolumeState`
- `diagnostics`

These fields mirror the existing `VolumeMarketFacts` vocabulary. They describe available participation facts only.

## Volume Shelf Overlap Model

Each row may include shelf context:

- `shelfId`
- `zoneLow`
- `zoneHigh`
- `representativePrice`
- `relation`: `overlaps` or `near`
- `shelfRole`
- optional `totalVolume`
- optional `dollarVolume`
- optional `percentOfWindowVolume`
- `factsOnly: true`

Volume shelves remain facts-only zones. This contract does not convert shelves into support/resistance levels or use shelf role to change generation behavior.

## Comparison Outcome Model

Supported outcomes:

- `surfaced_has_more_session_volume_context`
- `unsurfaced_has_more_session_volume_context`
- `similar_session_volume_context`
- `missing_facts_inconclusive`
- `candidate_identifier_unavailable`
- `no_nearby_session_volume_context`

Outcomes describe evidence availability and proximity only. They do not recommend changing surfaced selection, ranking, or scoring.

## Diagnostics And Missing-Facts Policy

The fixture suite locks diagnostics such as:

- `surfaced_vwap_shelf_overlap_context_present`
- `closer_unsurfaced_less_session_volume_context`
- `unsurfaced_more_session_volume_context`
- `session_facts_missing`
- `volume_facts_missing`
- `volume_shelf_facts_missing`
- `volume_session_comparison_inconclusive`
- `no_nearby_session_volume_context`
- `no_nearby_volume_shelf`
- `vwap_unavailable`

Missing facts must remain explicit. Future builders should return `missing_facts_inconclusive` or another safe comparison outcome instead of inferring a judgment from absent data.

## Safety Flags

Root safety requires:

- `factsOnly: true`
- `noLevelSelectionChange: true`
- `noRankingChange: true`
- `noRuntimeBehaviorChange: true`
- `vwapFactsOnly: true`
- `shelvesAreFactsOnly: true`
- `fifteenMinuteFedIntoLevelEngine: false`
- `volumeSessionFactsUsedForScoringOrSurfacedSelection: false`
- `supportResistanceDetectionChanged: false`
- `levelEngineScoringRankingClusteringChanged: false`
- `surfacedLevelsChanged: false`
- `extensionGenerationChanged: false`
- `providerCallsMade: false`
- `cacheFilesWritten: false`
- `rawCandlesIncluded: false`
- `fullSnapshotsIncluded: false`

Row safety requires:

- `factsOnly: true`
- `noLevelSelectionChange: true`
- `noRankingChange: true`
- `noRuntimeBehaviorChange: true`
- `vwapFactsOnly: true`
- `shelvesAreFactsOnly: true`

## Fixture List

Added deterministic compact fixtures under:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/contract-fixtures/
```

Fixtures:

- `volume-session-context-surfaced-vwap-shelf-overlap.json`
- `volume-session-context-closer-unsurfaced-less-context.json`
- `volume-session-context-unsurfaced-more-context.json`
- `volume-session-context-missing-facts-inconclusive.json`
- `volume-session-context-no-nearby-context.json`

The fixtures include no raw candles, full snapshots, cache files, or provider responses.

## Validation Rules

Validation requires:

- correct schema version
- non-empty symbol and provider
- non-negative as-of timestamp
- contexts array
- valid stage values
- valid side values
- positive prices where present
- valid session fact names
- valid session and shelf relation values
- valid comparison outcomes
- required root and row safety flags
- facts-only shelf and VWAP markers
- 15m excluded from LevelEngine
- volume/session facts not used for scoring or surfaced selection
- no raw candles or full snapshots included

The facts-only assertion rejects prohibited wording such as buy/sell/hold, recommendations, advice language, coaching, grading, P/L, giveback, behavior scoring, good/bad trade labels, and should-enter/exit/add/trim phrasing.

## Facts-Only Boundary

This contract is:

- pure
- deterministic
- additive
- review-focused
- facts-only
- not wired into runtime review output yet

It does not:

- call providers
- read or write cache files
- generate levels
- score levels
- rank levels
- cluster levels
- surface levels
- create extension rows
- change alert, monitoring, Discord, or journal behavior

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_volume_session_context_builder
```

Reason: after the facts-only contract and fixtures are locked, build a pure builder from existing `SessionMarketFacts`, `VolumeMarketFacts`, `VolumeShelf[]`, and candidate inventory rows into this contract.
