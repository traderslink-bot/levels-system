# Level Ranking Comparison And Migration Plan

## Purpose

This document tracks the side-by-side comparison harness between:

1. the existing live surfaced-output ranking path
2. the newer level strength scoring and ranking layer

The goal is safe migration planning, not blind replacement.

## Current old runtime path

### Producer

- File: `src/lib/levels/level-engine.ts`
- Function: `LevelEngine.generateLevels`

Current invocation chain:

1. `detectSwingPoints`
2. `buildRawLevelCandidates`
3. `buildSpecialLevelCandidates`
4. `clusterRawLevelCandidates`
5. `scoreLevelZones`
6. `rankLevelZones`

### Old path output shape

The old path emits `LevelEngineOutput` with bucketed surfaced fields:

- `majorSupport`
- `majorResistance`
- `intermediateSupport`
- `intermediateResistance`
- `intradaySupport`
- `intradayResistance`
- `extensionLevels`
- `metadata`
- `specialLevels`

### Live runtime integration points

- `src/runtime/main.ts`
  - `seedLevels(...)` calls `engine.generateLevels(...)`
  - stores output through `LevelStore.setLevels(...)`

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - `seedLevelsForSymbol(...)` calls `levelEngine.generateLevels(...)`
  - stores output through `levelStore.setLevels(...)`

### Downstream dependencies on old shape

- `src/lib/monitoring/level-store.ts`
  - flattens surfaced bucket fields into monitored active zones
  - reads `extensionLevels` for promoted extensions

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - builds Discord snapshot payloads from surfaced bucket zones and extension ladders

- `src/lib/alerts/alert-intelligence-engine.ts`
  - scans all zones from `LevelEngineOutput`, including surfaced buckets and extensions

## New scoring path

The new path is centered on:

- `src/lib/levels/level-touch-analysis.ts`
- `src/lib/levels/level-structural-scoring.ts`
- `src/lib/levels/level-active-scoring.ts`
- `src/lib/levels/level-clustering.ts`
- `src/lib/levels/level-state-engine.ts`
- `src/lib/levels/level-score-explainer.ts`
- `src/lib/levels/level-ranking.ts`

It emits `RankedLevelsOutput` with:

- globally ranked `supports`
- globally ranked `resistances`
- `topSupport`
- `topResistance`
- `confidence`
- `state`
- `explanation`
- `scoreBreakdown`

## Why both exist

The old path is the current runtime source of truth because it is already integrated into:

- monitoring
- snapshots
- extensions
- alert enrichment

The new path is architecturally richer and more explicit, but it does not yet emit the old bucketed runtime contract.

## How comparison works

### Files

- `src/lib/levels/level-ranking-comparison.ts`
- `src/scripts/run-level-ranking-comparison.ts`
- `src/tests/level-ranking-comparison.test.ts`

### Comparison flow

1. Build shared raw candidates from the same candles, or accept injected raw candidates.
2. Run the old path:
   - `clusterRawLevelCandidates`
   - `scoreLevelZones`
   - `rankLevelZones`
3. Run the new path:
   - convert shared raw candidates into new `LevelCandidate` inputs
   - `rankLevels`
4. Normalize both outputs into a comparable side-by-side shape.
5. Compute:
   - top level changes
   - nearest level changes
   - ordering changes
   - nearby duplicate counts
   - compatibility warnings
   - migration readiness summary

### Important fairness note

Both paths use the same symbol, candle inputs, and raw candidate set whenever possible.

However, there is still one structural difference:

- the old path scores clustered surfaced zones
- the new path currently ranks richer candidate-derived levels globally

That means changed tops are informative, but not automatically regressions.

## Initial observed comparison results

From the deterministic comparison script run on:

- `ALBT`
- `GXAI`
- `TOVX`

Observed summary:

- compared symbols: `3`
- top support changed: `3`
- top resistance changed: `2`
- duplicate suppression improved: `0`
- new ranking appeared clearly better by metadata richness: `3`
- all `3` still need manual review

Key read:

- the new path is clearly richer and more explainable
- the new path is not yet a drop-in surfaced-output replacement
- on these fixtures, the new path often ranked deeper structural levels above the old near-price surfaced levels

That is a strong signal that the next safe step is shadow evaluation, not direct replacement.

## What must be verified before replacement

1. Whether the new path should rank purely by strength or whether surfaced proximity rules should be layered on top before runtime replacement.
2. Whether the new path needs a bucketed projection adapter to preserve:
   - `major`
   - `intermediate`
   - `intraday`
   - `extension`
3. Whether manual watchlist snapshots still behave sensibly when driven by new ranking outputs.
4. Whether downstream alert enrichment still gets the fields it expects.
5. Whether duplicate handling really improves on real multi-symbol live data, not only synthetic fixtures.

## Recommended migration sequence

1. Keep the old path live.
2. Run the new path in shadow comparison mode using the comparison harness.
3. Review changed top supports/resistances on real symbols and real charts.
4. Add an adapter layer that can project the new path into the old bucketed runtime contract.
5. Only then consider a non-default optional runtime flag.
6. Do not switch the live default until:
   - bucket compatibility is solved
   - changed tops have been reviewed
   - surfaced outputs still look trader-usable

## Migration recommendation

Current recommendation:

- `blocked_by_output_compatibility` for direct replacement
- operationally `ready_for_shadow_mode`

That means:

- do not replace the old runtime path yet
- use the new comparison harness to gather evidence
- then build a safe adapter or feature-flagged projection step

## Feature flag status

No runtime feature flag or adapter was added in this pass.

Reason:

- the current runtime still depends on the old `LevelEngineOutput` bucket contract in multiple downstream consumers
- adding a half-integrated dual path right now would create ambiguous runtime behavior before the comparison evidence is fully reviewed
