# Level Quality Candidate Inventory Volume Session Context Design

## Purpose

This gate designs a facts-only volume/session context layer for candidate inventory and surfaced levels.

The goal is to connect the current candidate-inventory review path with existing session facts, volume facts, and volume shelves so future reviews can explain level evidence more like a professional chart-reading system. This gate does not build or wire the context layer, and it does not change support/resistance generation, scoring, ranking, clustering, surfaced selection, extension generation, runtime defaults, alerts, monitoring, Discord output, or journal behavior.

## Evidence Source

Reviewed planning and baseline docs:

- `docs/34_SESSION_AND_VOLUME_INTELLIGENCE_PLAN.md`
- `docs/38_LEVEL_INTELLIGENCE_AND_VOLUME_ENRICHMENT_PLAN.md`
- `docs/134_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_BASELINE_LOCK.md`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-baseline-lock.json`

Reviewed existing modules:

- `src/lib/session/session-market-facts.ts`
- `src/lib/volume/volume-market-facts.ts`
- `src/lib/volume/volume-shelf-detector.ts`
- `src/lib/levels/level-candidate-inventory-visibility.ts`
- `src/lib/levels/level-candidate-inventory-review-adapter.ts`
- `src/scripts/run-level-quality-review.ts`
- `src/lib/levels/level-intelligence-profile.ts`
- `src/lib/levels/level-intelligence-report.ts`
- `src/lib/levels/level-context-explainer.ts`

## Current Problem

Candidate inventory review output can now show:

- raw, clustered, scored, surfaced, extension candidate, and selected extension stage counts
- nearest candidate visibility by stage and side
- closer scored candidates that did not surface
- truthful sparse market-context gaps
- candidate inventory parity against the locked review baseline

It does not yet explain, per candidate or surfaced level:

- whether the level is near VWAP, high of day, low of day, opening range, premarket high/low, previous close, or regular-session open
- whether a closer unsurfaced candidate has less, equal, stronger, or missing volume/session evidence compared with the surfaced level
- whether the level overlaps or is near a volume shelf
- whether available volume facts show elevated volume, dry-up, exhaustion-risk, or normal participation
- whether session, volume, shelf, or candidate identifiers are missing and make the comparison inconclusive

The missing layer is explanatory context. It is not a reason to change generation behavior.

## Existing Session And Volume Facts Available

Existing `SessionMarketFacts` can already expose:

- `previousClose`
- `regularSessionOpen`
- `currentPrice`
- `premarketHigh` and `premarketLow`
- `openingRangeHigh` and `openingRangeLow`
- `highOfDay` and `lowOfDay`
- `vwap`
- `aboveVWAP`
- `percentFromVWAP`
- first pullback, breakout, and consolidation facts when available
- diagnostics such as missing session candles or unavailable VWAP

Existing `VolumeMarketFacts` can already expose:

- `currentVolume`
- `rollingAverageVolume`
- `relativeVolume`
- `dollarVolume`
- `volumeState`
- `liquidityQuality`
- `accelerationState`
- `pullbackVolumeState`
- `breakoutVolumeState`
- diagnostics such as insufficient rolling history or missing reference price

Existing `VolumeShelf` can already expose:

- shelf id
- price zone
- representative price
- total volume and dollar volume
- percent of window volume
- touch count
- first and last timestamps
- shelf role
- confidence
- facts-only reason

Existing `LevelIntelligenceProfile` and `level-context-explainer` already provide a facts-only surfaced-level profile path. The new candidate-inventory context should reuse those concepts where useful, but it should focus on compact review visibility for candidate and surfaced comparisons.

## Proposed Context Shape

Suggested future type name:

```text
LevelCandidateVolumeSessionContext
```

Suggested compact shape:

```ts
export type LevelCandidateVolumeSessionContext = {
  schemaVersion: "level-candidate-volume-session-context/v1";
  symbol: string;
  provider: "ibkr" | string;
  asOfTimestamp: number;
  asOfIso?: string;
  referencePrice?: number;
  contexts: LevelCandidateVolumeSessionContextRow[];
  comparisonSummary: LevelCandidateVolumeSessionComparisonSummary;
  diagnostics: string[];
  safety: {
    factsOnly: true;
    noLevelSelectionChange: true;
    noRankingChange: true;
    noRuntimeBehaviorChange: true;
    vwapFactsOnly: true;
    shelvesAreFactsOnly: true;
    fifteenMinuteFedIntoLevelEngine: false;
  };
};
```

Suggested row shape:

```ts
export type LevelCandidateVolumeSessionContextRow = {
  rowId: string;
  levelId?: string;
  candidateId?: string;
  side: "support" | "resistance";
  stage:
    | "raw"
    | "clustered"
    | "scored"
    | "surfaced"
    | "extension_candidate"
    | "extension_selected";
  price: number;
  zoneLow?: number;
  zoneHigh?: number;
  distanceFromReferencePct?: number;
  session: {
    nearbyFacts: LevelCandidateSessionFactProximity[];
    vwap?: LevelCandidateSessionFactProximity;
    diagnostics: string[];
  };
  volume: {
    relativeVolume?: number;
    dollarVolume?: number;
    volumeState?: string;
    liquidityQuality?: string;
    accelerationState?: string;
    pullbackVolumeState?: string;
    breakoutVolumeState?: string;
    diagnostics: string[];
  };
  shelves: {
    nearbyShelfIds: string[];
    overlaps: LevelCandidateVolumeShelfOverlap[];
    diagnostics: string[];
  };
  diagnostics: string[];
  safety: {
    factsOnly: true;
    noLevelSelectionChange: true;
    noRankingChange: true;
    vwapFactsOnly: true;
    shelvesAreFactsOnly: true;
  };
};
```

Suggested session fact proximity:

```ts
export type LevelCandidateSessionFactProximity = {
  fact:
    | "vwap"
    | "premarket_high"
    | "premarket_low"
    | "opening_range_high"
    | "opening_range_low"
    | "high_of_day"
    | "low_of_day"
    | "previous_close"
    | "regular_session_open";
  price: number;
  distancePct: number;
  relation: "overlaps" | "near" | "outside_threshold";
  factsOnly: true;
};
```

Suggested shelf overlap:

```ts
export type LevelCandidateVolumeShelfOverlap = {
  shelfId: string;
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  relation: "overlaps" | "near";
  shelfRole: "unknown" | "support" | "resistance" | "chop_zone" | "magnet";
  totalVolume?: number;
  dollarVolume?: number;
  percentOfWindowVolume?: number;
  factsOnly: true;
};
```

## Candidate And Surfaced-Level Comparison Model

The future comparison model should focus on side-by-side factual evidence:

- surfaced support/resistance context rows
- closer unsurfaced scored support/resistance rows
- nearest raw/clustered/scored rows when surfaced and scored disagree
- extension candidate and selected extension rows when extension coverage is relevant

Suggested comparison outcomes:

- `surfaced_has_more_session_volume_context`
- `unsurfaced_has_more_session_volume_context`
- `similar_session_volume_context`
- `missing_facts_inconclusive`
- `candidate_identifier_unavailable`
- `no_nearby_session_volume_context`

These outcomes should describe evidence availability. They must not imply that one level is better for trading or that selection should change.

## HCWB And PHOE Investigation Use Case

The locked candidate inventory baseline shows:

- `HCWB`: support closer-unsurfaced, resistance truthful market-context
- `PHOE`: support closer-unsurfaced, resistance truthful market-context

The future context layer should let a review answer factual questions such as:

- Did the closer unsurfaced support have less, equal, stronger, or missing session/volume evidence than the surfaced support?
- Did the surfaced support overlap a stronger volume shelf?
- Was the surfaced support near VWAP, opening range, premarket low, low of day, previous close, or regular-session open?
- Were support-side volume facts drying up, normal, elevated, or unavailable?
- Was resistance-side truthful market context also near high of day, premarket high, opening range high, or a volume shelf?
- Were facts missing, making the comparison inconclusive?

This gate does not answer those questions with new runtime output. It only designs the shape needed for a future read-only review.

## Volume Shelf Policy

Volume shelves remain facts-only context.

Allowed future uses:

- report shelf overlap or proximity to a candidate or surfaced level
- include shelf id, zone, representative price, role, total volume, dollar volume, and percent of window volume when already available
- distinguish `overlaps` from `near`
- diagnose `no_nearby_volume_shelf` or `volume_shelf_facts_missing`

Disallowed uses without a separate behavior gate:

- converting shelves into support/resistance levels
- changing level scoring, ranking, clustering, surfaced selection, extension generation, alerts, monitoring, or Discord output
- treating shelf role as trade advice

## VWAP And Session Facts Policy

VWAP and session facts remain market facts.

Allowed future uses:

- report proximity to VWAP, premarket high/low, opening range high/low, high/low of day, previous close, and regular-session open
- include missing-fact diagnostics such as `vwap_unavailable`, `session_facts_missing`, or `regular_session_open_missing`
- compare factual proximity between surfaced and closer unsurfaced rows

Disallowed uses without a separate behavior gate:

- changing support/resistance generation
- changing LevelEngine scoring, ranking, clustering, or surfaced selection
- changing extension generation
- changing alert, monitoring, Discord, or journal behavior
- producing recommendation, coaching, grading, P/L, giveback, behavior scoring, or trade-advice language

## Diagnostics And Missing-Facts Policy

Suggested diagnostics:

- `session_facts_missing`
- `volume_facts_missing`
- `volume_shelf_facts_missing`
- `no_nearby_volume_shelf`
- `vwap_unavailable`
- `candidate_id_unavailable`
- `level_id_unavailable`
- `candidate_inventory_visibility_missing`
- `surfaced_selection_reason_not_serialized`
- `volume_session_comparison_inconclusive`

Diagnostics should be factual, compact, and safe for review output. Missing facts should produce an explicit `inconclusive` result rather than an inferred judgment.

## Safety Boundaries

The future context layer must be:

- facts-only
- read-only
- local-cache only when used by packaged review
- no raw candle output
- no full snapshot output
- no provider calls
- no cache writes
- no support/resistance generation changes
- no LevelEngine scoring, ranking, clustering, or surfaced-selection changes
- no extension generation changes
- no 15m LevelEngine input
- no alert, monitoring, Discord, or journal behavior changes
- no recommendation, coaching, grading, P/L, giveback, behavior scoring, or trade-advice language

## Future Gate Sequence

Recommended sequence:

1. `level_quality_candidate_inventory_volume_session_context_contract`
2. `level_quality_candidate_inventory_volume_session_context_builder`
3. `level_quality_candidate_inventory_volume_session_context_review_wiring`
4. `level_quality_candidate_inventory_volume_session_context_rerun`
5. `level_quality_candidate_inventory_volume_session_context_baseline_lock`

Contract and deterministic fixtures should come before builder work. Builder tests should prove immutability, facts-only language, missing-fact behavior, and no LevelEngine behavior imports. Review wiring should be additive and should preserve the locked candidate inventory and old baseline parity fields.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_volume_session_context_contract
```

Reason: after design, the safest next step is to lock a compact facts-only contract and deterministic fixtures before building or wiring volume/session context into review output.
