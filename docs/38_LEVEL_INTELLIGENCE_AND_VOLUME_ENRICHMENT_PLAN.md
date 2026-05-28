# Level Intelligence And Volume Enrichment Plan

Status: planning and next-gate directive  
Scope: facts-only support/resistance intelligence improvements  
Runtime impact: none until a later explicitly approved scoring/selection phase

## Executive Summary

The level system already has many of the ingredients needed for more professional support/resistance analysis:

- runtime `FinalLevelZone` transport
- richer `enrichedAnalysis` shadow metadata
- no-lookahead candle-close filtering
- session facts
- volume facts
- volume shelves
- market context facts
- facts-only level explanations, reports, and formatting

The next best step is not to change live level selection or scoring yet. The next best step is to create a pure, optional level intelligence profile that unifies the existing facts around each supplied `FinalLevelZone`.

That profile should explain why a level exists, how fresh it is, how clean or messy it is, how price reacted there, what volume facts are nearby, whether volume shelves overlap it, whether it is close to market/session landmarks, and what information is missing. It must remain facts-only and must not become trade grading or coaching.

## Current State

The current runtime output already carries useful level metadata:

- `FinalLevelZone.id`
- `symbol`
- `kind`
- `timeframeBias`
- `zoneLow`
- `zoneHigh`
- `representativePrice`
- `strengthScore`
- `strengthLabel`
- `touchCount`
- `confluenceCount`
- `sourceTypes`
- `timeframeSources`
- `reactionQualityScore`
- `rejectionScore`
- `displacementScore`
- `sessionSignificanceScore`
- `followThroughScore`
- `gapContinuationScore`
- `sourceEvidenceCount`
- `firstTimestamp`
- `lastTimestamp`
- `freshness`
- `isExtension`
- optional `enrichedAnalysis`

The richer path already carries additional shadow metadata:

- structural strength
- active relevance
- final level score
- confidence
- state
- rank
- explanation
- score breakdown
- touch stats
- reaction counts
- failed breaks
- clean breaks
- reclaims
- average and strongest reaction move
- volume ratios
- cleanliness standard deviation
- age in bars
- bars since last reaction

The market facts layers already provide:

- session high/low
- premarket high/low
- opening range high/low
- regular-session open
- current/reference price
- VWAP as facts-only context
- relative volume
- dollar volume
- liquidity quality
- volume acceleration
- pullback volume state
- breakout volume state
- volume shelves as facts-only zones
- market context and runner phase facts

The latest explanation layers provide:

- `explainLevelContext(...)`
- `buildLevelContextReport(...)`
- `formatLevelContextReport(...)`

These are optional, facts-only, and not wired into runtime paths.

## What The ChatGPT Idea Already Matches

The external suggestion overlaps heavily with current docs and code.

Already present or partly present:

- Level origin: `sourceTypes`, `timeframeSources`, `timeframeBias`, richer `originKinds`.
- Touch and reaction quality: `touchCount`, reaction/rejection/displacement/follow-through scores, `touchStats`.
- Freshness: runtime `freshness` plus richer state.
- Zone width: `zoneLow`, `zoneHigh`, `representativePrice`.
- Source timeframe: runtime and richer timeframe fields.
- Broken/respected/reclaimed/flipped status: richer `LevelState`.
- Volume facts: `VolumeMarketFacts`.
- Volume shelves: `VolumeShelf`.
- Human-readable reason: `enrichedAnalysis.explanation` and facts-only level explanations.

Still missing or not unified:

- a single per-level intelligence profile that gathers all facts in one place
- explicit `zoneWidthPercent`
- explicit distance from reference price and neutral distance category
- per-level volume context tied directly to the level zone
- round-number confluence
- candle reaction labels such as wick rejection, wide-range break, failed break, or inside-zone chop
- gap/offering/warrant/news-price metadata, unless provided later by external inputs
- clear diagnostics for missing evidence
- test fixtures proving good, weak, messy, stale, shelf-overlap, and high-volume-reaction examples

Intentionally out of bounds for levels-system:

- trade grading
- coaching
- behavior scoring
- P/L
- giveback analysis
- journal product interpretation
- action labels such as good/bad trade

## Boundary Rules

Levels-system owns facts-only support/resistance intelligence:

- what level exists
- where the zone is
- what created it
- what candles touched it
- what reaction evidence exists
- what volume facts exist nearby
- what session facts exist nearby
- what confidence/state metadata exists
- what evidence is missing or low quality

The trading journal app owns product interpretation:

- trade grading
- coaching
- behavior scoring
- P/L
- giveback analysis
- journal workflow labels
- user-facing judgment about execution quality

VWAP remains facts-only. Volume shelves remain facts-only and are not support/resistance levels.

## Proposed Additive Contract

The next implementation should introduce a pure profile type similar to:

```ts
export type LevelIntelligenceProfile = {
  levelId: string;
  symbol: string;
  kind: "support" | "resistance";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  zoneWidthPercent: number;

  origin: {
    sourceTypes: string[];
    timeframeSources: string[];
    primaryTimeframe: string;
    isExtension: boolean;
  };

  freshness: {
    firstTimestamp: number;
    lastTimestamp: number;
    label: "fresh" | "aging" | "stale";
    state?: string;
  };

  reaction: {
    touchCount: number;
    meaningfulTouchCount?: number;
    rejectionCount?: number;
    failedBreakCount?: number;
    cleanBreakCount?: number;
    reclaimCount?: number;
    averageReactionMovePct?: number;
    strongestReactionMovePct?: number;
    cleanlinessStdDevPct?: number;
  };

  distance?: {
    referencePrice: number;
    distanceFromReferencePct: number;
    category: "near" | "approaching" | "extended" | "far";
  };

  volume?: {
    volumeState?: string;
    relativeVolume?: number;
    dollarVolume?: number;
    liquidityQuality?: string;
    accelerationState?: string;
    pullbackVolumeState?: string;
    breakoutVolumeState?: string;
    nearbyShelfIds: string[];
  };

  confluence: {
    nearSessionFacts: string[];
    nearVolumeFacts: string[];
    nearShelfFacts: string[];
    nearRoundNumber?: {
      value: number;
      type: "whole" | "half" | "quarter" | "ten_cent";
      distancePct: number;
    };
  };

  diagnostics: string[];
  reason: string;
  safety: {
    factsOnly: true;
    noRuntimeBehaviorChange: true;
    vwapFactsOnly: true;
    shelvesAreFactsOnly: true;
  };
};
```

This type is only a suggested shape. The implementation should fit the repo's existing naming and avoid changing existing runtime transport fields.

## First Implementation Gate

Create a pure optional level intelligence profile builder.

Suggested file:

```text
src/lib/levels/level-intelligence-profile.ts
```

Suggested test file:

```text
src/tests/level-intelligence-profile.test.ts
```

The builder should accept:

- an existing `FinalLevelZone`
- optional reference price
- optional `SessionMarketFacts`
- optional `VolumeMarketFacts`
- optional `VolumeShelf[]`
- optional `MarketContextProfile`
- optional `MarketContextFactsBundle`

The builder should not accept raw external broker or news data in the first pass.

The builder must:

- be pure and deterministic
- not call `Date.now`
- not call LevelEngine
- not generate levels
- not mutate inputs
- not change `FinalLevelZone`
- not change `LevelEngineOutput`
- not change runtime selection or scoring
- not affect alerts, monitoring, Discord, or trader-context behavior
- keep VWAP facts-only
- keep shelves facts-only
- avoid grading, coaching, and trade recommendation language

## First Gate Fields

The first implementation should prioritize:

1. zone width percent
2. source/origin summary from existing runtime fields
3. freshness summary
4. richer state and confidence from `enrichedAnalysis`
5. touch and reaction summary from existing scores and `touchStats`
6. distance from reference price and neutral distance category
7. volume state/liquidity/relative volume/dollar volume facts
8. nearby volume shelf overlap facts
9. nearby session fact tags through the existing explainer if useful
10. diagnostics for missing data
11. one neutral human-readable reason

Do not add `tradeRole` in this gate. If a role-like field is needed later, use neutral names such as `levelUseContext` and keep it facts-only. Journal-specific role and coaching labels belong in the trading journal repo.

## Tests Required First

Add focused tests proving:

- output is deterministic
- input level and facts are not mutated
- zone width percent is computed correctly
- source/timeframe/origin fields are copied from the existing level
- freshness and timestamps are preserved
- enriched state/confidence are included when present
- missing `enrichedAnalysis` is handled safely
- distance from reference price is computed correctly
- neutral distance categories are deterministic
- volume facts are copied as facts-only
- volume shelf overlaps are facts-only and are not converted into levels
- VWAP stays facts-only
- diagnostics identify missing facts
- no LevelEngine import or call exists
- no runtime wiring modules are imported
- forbidden grading/coaching/recommendation language is absent
- `runtimeMode old` remains default

## Later Gates

After the pure profile builder exists, continue with these gates:

1. Add a `LevelIntelligenceReport` for all levels in a supplied `LevelEngineOutput`.
2. Add a formatter for the intelligence report if needed.
3. Add richer per-level volume context using closed candles only.
4. Add round-number confluence as facts-only metadata.
5. Add candle reaction labels as facts-only metadata.
6. Add fixture audits for runners, failed runners, parabolic extensions, and choppy setups.
7. Only after those tests exist, consider whether any facts should influence scoring or surfaced selection.

## Runtime Change Gate

Do not change live scoring or selection until a later explicit phase proves:

- old/default runtime output remains unchanged unless the phase is intentionally changing it
- old/new parity gates are updated
- alerts and monitoring behavior are explicitly tested
- Discord output changes are separately reviewed
- trader-context behavior is separately reviewed
- no-lookahead filtering is preserved

## Non-Goals

This plan does not authorize:

- a new support/resistance engine
- changing `runtimeMode` defaults
- replacing `FinalLevelZone`
- changing level selection
- changing bucket membership
- changing nearest levels
- changing extension levels
- changing special levels
- changing `strengthScore` or `strengthLabel`
- changing `enrichedAnalysis` scoring
- changing alerts
- changing monitoring
- changing Discord output
- changing trader-context output
- trade grading
- coaching
- behavior scoring
- P/L
- giveback analysis
- trade recommendation language

## Recommendation

Start with the pure `LevelIntelligenceProfile` builder. It is the smallest useful step that brings the ChatGPT ideas, the rescue docs, and the current code together without risking runtime behavior.

Once that exists, the system will have a clean place to accumulate level evidence before any future scoring or selection changes.
