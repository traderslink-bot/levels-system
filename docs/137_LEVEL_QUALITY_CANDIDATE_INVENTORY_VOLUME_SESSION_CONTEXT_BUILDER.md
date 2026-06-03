# Level Quality Candidate Inventory Volume Session Context Builder

## Purpose

This gate adds a pure facts-only builder for candidate/surfaced-level volume-session context.

The builder converts already-available `SessionMarketFacts`, `VolumeMarketFacts`, `VolumeShelf[]`, and compact candidate/surfaced rows into the locked `LevelCandidateVolumeSessionContext` contract. It does not wire the context into packaged review output, collect cache data, call providers, write cache files, or use volume/session facts to change support/resistance generation, scoring, ranking, clustering, surfaced selection, or extension generation.

## Builder Input

New module:

```text
src/lib/levels/level-candidate-volume-session-context-builder.ts
```

Primary input:

- `symbol`
- `provider`
- `asOfTimestamp`
- optional `asOfIso`
- optional `referencePrice`
- compact `rows`
- optional `SessionMarketFacts`
- optional `VolumeMarketFacts`
- optional `VolumeShelf[]`
- optional proximity thresholds
- optional diagnostics and limitations

Compact row input:

- `rowId`
- optional `levelId`
- optional `candidateId`
- `side`
- `stage`
- `price`
- optional `zoneLow`
- optional `zoneHigh`
- optional `distanceFromReferencePct`

Rows are candidate/surfaced references only. They are not raw candles, full snapshots, raw candidate arrays, or provider responses.

## Builder Output

The builder returns:

```text
LevelCandidateVolumeSessionContext
```

It calls:

- `validateLevelCandidateVolumeSessionContext`
- `assertLevelCandidateVolumeSessionContextFactsOnly`

The output keeps optional fields omitted when unavailable so committed and future review artifacts remain compact.

## Session Proximity Logic

The builder maps available session prices into row-level proximity facts:

- `vwap`
- `premarket_high`
- `premarket_low`
- `opening_range_high`
- `opening_range_low`
- `high_of_day`
- `low_of_day`
- `previous_close`
- `regular_session_open`

Session relation rules:

- `overlaps` when the fact price falls inside the row zone or within the overlap threshold
- `near` when the fact price is within the near threshold
- `outside_threshold` when no nearby session fact is present and the closest available fact is retained for context

Missing session facts add factual diagnostics such as `session_facts_missing`, `vwap_unavailable`, or `no_nearby_session_fact`.

## Volume Facts Mapping

The builder maps existing `VolumeMarketFacts` into each context row:

- `relativeVolume`
- `dollarVolume`
- `volumeState`
- `liquidityQuality`
- `accelerationState`
- `pullbackVolumeState`
- `breakoutVolumeState`

When volume facts are unavailable, the builder reports `volume_facts_missing`. These fields remain context only and are not used to change scoring or surfaced selection.

## Volume Shelf Overlap Logic

The builder maps existing `VolumeShelf[]` into row-level shelf context:

- `overlaps` when the candidate/surfaced zone intersects the shelf zone
- `near` when the row zone is within the configured shelf proximity threshold
- `no_nearby_volume_shelf` when shelves are available but none overlap or sit nearby
- `volume_shelf_facts_missing` when shelf facts are not supplied

Shelf ids, zones, representative prices, roles, total volume, dollar volume, and percent-of-window volume remain facts-only context.

## Comparison Summary Logic

The builder compares surfaced rows with closer unsurfaced scored rows when both are supplied.

Supported outcomes remain the locked contract outcomes:

- `surfaced_has_more_session_volume_context`
- `unsurfaced_has_more_session_volume_context`
- `similar_session_volume_context`
- `missing_facts_inconclusive`
- `candidate_identifier_unavailable`
- `no_nearby_session_volume_context`

The comparison is intentionally simple and deterministic:

- count nearby session facts
- count shelf overlaps/proximities
- consider volume fact availability only as supporting context
- return missing/inconclusive when required facts are absent
- do not infer a better level, better trade, or selection change

## Missing-Facts Behavior

Missing session, volume, or shelf facts stay explicit. The builder returns factual diagnostics and avoids inferred judgments from absent facts.

Important diagnostics include:

- `session_facts_missing`
- `volume_facts_missing`
- `volume_shelf_facts_missing`
- `vwap_unavailable`
- `candidate_id_unavailable`
- `level_id_unavailable`
- `no_nearby_session_fact`
- `no_nearby_volume_shelf`
- `volume_session_comparison_inconclusive`

## Fixture And Test Coverage

Added builder fixtures under:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/builder-fixtures/
```

Fixtures:

- `builder-surfaced-vwap-shelf-overlap.json`
- `builder-closer-unsurfaced-less-context.json`
- `builder-unsurfaced-more-context.json`
- `builder-missing-facts-inconclusive.json`
- `builder-no-nearby-context.json`

Added focused test:

```text
src/tests/level-candidate-volume-session-context-builder.test.ts
```

The test covers exact fixture output, session proximity thresholds, shelf overlap/proximity, missing-fact diagnostics, validation, facts-only assertions, immutability, and source isolation from generation/runtime paths.

## Safety Boundaries

This gate did not:

- wire volume/session context into runtime review output
- change support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts to change scoring or surfaced selection
- collect cache data
- write cache files
- change alert, monitoring, Discord, or journal behavior
- add recommendation, coaching, grading, P/L, giveback, behavior scoring, or trade-advice language

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_volume_session_context_review_wiring
```

Reason: after the pure builder is fixture-tested, wire it additively into the packaged review process and rerun the 10-symbol review.
