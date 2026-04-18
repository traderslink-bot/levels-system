# Level Strength Scoring Implementation

## Purpose

This document tracks the implemented level strength scoring and ranking layer that sits after candidate level detection and before later breakout logic, watchlist prioritization, alerting, and level display decisions.

This layer scores levels by confluence, not raw touch count.

## Implemented scope

The following files now define the layer:

- `src/lib/levels/level-types.ts`
- `src/lib/levels/level-score-config.ts`
- `src/lib/levels/level-zone-utils.ts`
- `src/lib/levels/level-touch-analysis.ts`
- `src/lib/levels/level-clustering.ts`
- `src/lib/levels/level-state-engine.ts`
- `src/lib/levels/level-structural-scoring.ts`
- `src/lib/levels/level-active-scoring.ts`
- `src/lib/levels/level-ranking.ts`
- `src/lib/levels/level-score-explainer.ts`

## Scoring flow

1. Normalize candidate levels and zone bounds.
2. Analyze directional candle touches when touch metrics are not already supplied.
3. Compute a first-pass structural score.
4. Cluster nearby overlapping levels and penalize weaker duplicates.
5. Recompute structural score with the cluster penalty applied.
6. Derive deterministic level state.
7. Compute active relevance from distance, recency, local pressure, recent volume, and current interaction.
8. Combine structural and active scores into final ranking.
9. Attach confidence and explanation.
10. Rank supports and resistances separately from strongest to weakest.

## Output shape

The orchestrator returns:

- `symbol`
- `currentPrice`
- `supports`
- `resistances`
- `topSupport`
- `topResistance`
- `computedAt`

Each ranked level includes:

- `structuralStrengthScore`
- `activeRelevanceScore`
- `finalLevelScore`
- `confidence`
- `state`
- `explanation`
- `scoreBreakdown`
- `clusterId`
- `isClusterRepresentative`

## Design notes

- Structural quality remains the dominant input.
- Active relevance helps near-price levels surface without letting weak structure outrank strong structure too easily.
- Clustering suppresses duplicate nearby levels instead of deleting them outright.
- State assignment is deterministic and test-backed.
- Explanations reflect real score drivers rather than generic filler text.

## Current assumptions

- Candidate level generation already exists elsewhere in the engine.
- This layer starts from candidate levels plus either:
  - precomputed touch metrics
  - or candle arrays supplied for touch analysis
- This pass does not replace the existing surfaced-output level engine yet.
- Later integration can decide whether to:
  - augment existing `level-scorer.ts` and `level-ranker.ts`
  - or run this strength layer in parallel as a higher-level ranking stage

## Test coverage summary

Current tests cover:

- timeframe priority and confluence caps
- meaningful reactions vs weak taps
- cleanliness impact
- role flip bonus and cap
- overtest penalties
- clustering and representative selection
- deterministic state transitions
- active relevance and compression pressure
- final ranking order and score combination
- explanation wording tied to real drivers
