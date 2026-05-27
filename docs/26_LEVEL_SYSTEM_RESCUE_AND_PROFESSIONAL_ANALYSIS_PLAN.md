# Level System Rescue and Professional Analysis Plan

Created: 2026-05-27 America/Toronto

## Purpose

This document is the working directive for Codex to audit, consolidate, and improve the `levels-system` support and resistance engine without creating another parallel system.

The current repository appears to contain two overlapping level-analysis paths:

1. The active `LevelEngine.generateLevels()` path that produces `LevelEngineOutput` and `FinalLevelZone` groups for runtime, monitoring, scripts, alerts, and validation.
2. A richer `rankLevels()` path that includes touch analysis, structural scoring, active relevance scoring, state, confidence, score breakdowns, and explanations, but appears to be used mainly by tests at the time this document was written.

The goal is not to throw away either system. The goal is to safely consolidate the best parts into one professional, explainable, context-aware level-analysis pipeline.

## Critical rule

Do not create a third support/resistance engine.

Codex must not solve this by adding a new parallel `v3`, `advanced`, `professional`, or `next` level engine beside the existing systems. The work must first audit and consolidate what already exists.

## Current observed architecture

### Active production/runtime path

The active engine appears to run through:

```text
src/lib/levels/level-engine.ts
src/lib/levels/swing-detector.ts
src/lib/levels/raw-level-candidate-builder.ts
src/lib/levels/special-level-builder.ts
src/lib/levels/level-clusterer.ts
src/lib/levels/level-scorer.ts
src/lib/levels/level-ranker.ts
```

The main active flow appears to be:

```text
LevelEngine.generateLevels()
  -> fetch daily, 4h, and 5m candles
  -> detectSwingPoints()
  -> buildRawLevelCandidates()
  -> buildSpecialLevelCandidates()
  -> clusterRawLevelCandidates()
  -> scoreLevelZones()
  -> rankLevelZones()
  -> LevelEngineOutput
```

This path returns grouped level output such as:

```text
majorSupport
majorResistance
intermediateSupport
intermediateResistance
intradaySupport
intradayResistance
extensionLevels
specialLevels
```

This path should be treated as the active runtime path unless the audit proves otherwise.

### Richer scoring/ranking path

The richer scoring path appears to run through:

```text
src/lib/levels/level-ranking.ts
src/lib/levels/level-touch-analysis.ts
src/lib/levels/level-structural-scoring.ts
src/lib/levels/level-active-scoring.ts
src/lib/levels/level-state-engine.ts
src/lib/levels/level-score-explainer.ts
src/lib/levels/level-clustering.ts
src/lib/levels/level-score-config.ts
```

This path provides concepts such as:

```text
RankedLevel
LevelTouch
LevelTouchAnalysisResult
LevelScoreBreakdown
structuralStrengthScore
activeRelevanceScore
finalLevelScore
confidence
state
explanation
```

This logic appears valuable and should not be discarded. However, before using it in production, Codex must verify whether it is currently wired into any runtime output beyond tests.

## Primary rescue objective

Create one coherent level-analysis pipeline that preserves runtime compatibility while adding the richer analysis fields needed for professional trading analysis.

The target architecture should look like this:

```text
1. Candle and session data loading
2. Raw candidate detection
3. Session/special level detection
4. Candidate clustering into zones
5. Touch/date/volume enrichment
6. Structural scoring
7. Active/context relevance scoring
8. Level state detection
9. Confidence and explanation generation
10. Output shaping for different consumers
```

The final system should support multiple output views from the same underlying level map:

```text
allAnalyticalLevels
surfacedDisplayLevels
alertWatchLevels
journalContextLevels
extensionLevels
specialLevels
```

If backward compatibility prevents this exact output shape in the first implementation, Codex should introduce it gradually using additive fields and adapters.

## Non-negotiable design rules

1. Do not create another parallel engine.
2. Do not delete the old path until all consumers are identified and migrated.
3. Do not break existing monitoring or alert behavior unless the task explicitly requires a breaking change.
4. Keep `LevelEngineOutput` backward compatible during the first consolidation pass.
5. Separate market facts from trading interpretation.
6. Separate level detection from level scoring.
7. Separate structural level strength from active/current relevance.
8. Separate full analytical level maps from surfaced display lists.
9. Every new scoring field must have a score breakdown or evidence trail.
10. Every new interpretation must be explainable in plain English.
11. Every material change must add or update tests.
12. Do not rely on one hardcoded mode. Use soft context profiles and confidence-based scoring adjustments.

## Phase 1: Audit only

### Goal

Create a precise map of what exists and what is actually used.

### Codex instructions

Do not change production code in this phase.

Create a new audit document:

```text
docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md
```

The audit must answer:

1. What files call `LevelEngine.generateLevels()`?
2. What files consume `LevelEngineOutput`?
3. What files consume `FinalLevelZone`?
4. What files call `rankLevels()`?
5. What files consume `RankedLevel`?
6. Which tests cover the original path?
7. Which tests cover the richer ranking path?
8. Which fields exist in `RankedLevel` that are missing from `FinalLevelZone`?
9. Which fields exist in `FinalLevelZone` that are missing from `RankedLevel`?
10. Which modules are safe adapters and which modules are runtime-critical?

### Acceptance criteria

The audit phase is complete only when:

```text
No production code was changed.
The active runtime path is clearly identified.
The richer unused or partially used path is clearly identified.
Every known consumer of LevelEngineOutput and FinalLevelZone is listed.
A safe migration direction is recommended.
```

## Phase 2: Consolidation directive

### Goal

Create a concrete migration directive before implementation.

### Codex instructions

Create:

```text
docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md
```

This document must define:

1. The preferred unified output model.
2. Whether `FinalLevelZone` should be enriched directly or adapted into a new analytical type.
3. How `RankedLevel` logic will be wired into the active engine.
4. How monitoring compatibility will be preserved.
5. What tests will be added before and after the change.
6. What old fields are deprecated, if any.
7. What fields remain mandatory for runtime.
8. What fields are optional during migration.

### Preferred safe approach

The first implementation should be additive.

Do not remove existing `FinalLevelZone` fields. Instead, enrich active runtime output with a nested analysis object such as:

```ts
// 2026-05-27 America/Toronto
export type EnrichedLevelAnalysis = {
  structuralStrengthScore: number;
  activeRelevanceScore: number;
  finalLevelScore: number;
  confidence: number;
  state: LevelState;
  explanation: string;
  scoreBreakdown: LevelScoreBreakdown;
};
```

Then either:

```ts
// 2026-05-27 America/Toronto
export type FinalLevelZone = {
  existingFieldsRemainUnchanged: true;
  enrichedAnalysis?: EnrichedLevelAnalysis;
};
```

or create an adapter output:

```ts
// 2026-05-27 America/Toronto
export type AnalyticalLevelZone = FinalLevelZone & {
  enrichedAnalysis: EnrichedLevelAnalysis;
};
```

Codex must choose the safest option after auditing consumers.

## Phase 3: Tests before runtime rewiring

### Goal

Add guardrail tests before changing runtime behavior.

### Codex instructions

Add tests that document the current behavior and the intended enriched behavior.

Tests should prove:

1. `LevelEngine.generateLevels()` still returns the existing grouped output.
2. Existing monitoring consumers still accept the output.
3. The richer scoring logic can be applied to active level zones through a deterministic adapter.
4. Enriched output includes state, confidence, explanation, and score breakdown.
5. The enriched output does not remove existing fields.

### Acceptance criteria

The test phase is complete only when:

```text
Existing tests pass.
New tests fail only where expected before implementation.
The tests clearly describe the intended migration behavior.
```

## Phase 4: Wire richer analysis into active output

### Goal

Make the richer ranking/scoring analysis available from the active level engine.

### Codex instructions

Carefully integrate the richer path into the active runtime path.

The implementation should:

1. Preserve `LevelEngine.generateLevels()` public behavior.
2. Enrich the active zones with richer analysis where possible.
3. Avoid changing monitoring semantics on the first pass.
4. Add adapter functions instead of duplicating scoring formulas.
5. Reuse `analyzeLevelTouches()`, `computeStructuralStrengthScore()`, `computeActiveRelevanceScore()`, `deriveLevelState()`, and `explainLevelScore()` when appropriate.
6. Avoid direct copy/paste forks of the scoring logic.

### Important implementation note

The current `rankLevels()` path operates on `LevelCandidate` and produces `RankedLevel`.

The current `LevelEngine` path produces `RawLevelCandidate` and then `FinalLevelZone`.

Codex must decide whether to:

```text
A. Convert FinalLevelZone to LevelCandidate and run the richer ranking logic.
B. Move richer scoring logic onto FinalLevelZone through a shared adapter.
C. Introduce a unified internal AnalyticalLevelCandidate type used before final output shaping.
```

The preferred long-term approach is C, but A or B may be safer as an interim step.

## Phase 5: Add market context profiles

### Goal

Allow the level engine to understand the current trading environment without creating hard modes.

### New module target

```text
src/lib/context/market-context-classifier.ts
```

or, if the project structure prefers it:

```text
src/lib/levels/market-context-classifier.ts
```

### Required concepts

```ts
// 2026-05-27 America/Toronto
export type MarketContextPrimary =
  | "normal_intraday"
  | "premarket_runner"
  | "day_trade_runner"
  | "press_release_runner"
  | "swing_structure"
  | "failed_runner"
  | "choppy_low_quality"
  | "parabolic_extension";

export type RunnerPhase =
  | "not_applicable"
  | "premarket_discovery"
  | "opening_drive"
  | "first_pullback"
  | "vwap_hold"
  | "vwap_reclaim"
  | "high_of_day_breakout"
  | "second_leg_attempt"
  | "parabolic_extension"
  | "failed_breakout"
  | "fade";

export type MarketContextProfile = {
  primaryContext: MarketContextPrimary;
  confidence: number;
  runnerPhase: RunnerPhase;
  evidence: string[];
  warnings: string[];
  scoringAdjustments: {
    intradayWeightMultiplier: number;
    dailyWeightMultiplier: number;
    vwapWeightMultiplier: number;
    sessionLevelWeightMultiplier: number;
    volumeWeightMultiplier: number;
    extensionRiskPenaltyMultiplier: number;
  };
};
```

### Detection inputs

The classifier should use available data such as:

```text
5m candles
15m candles if added
premarket candles
regular session candles
previous close
current price
VWAP if available
relative volume
dollar volume
move from open
move from previous close
extension from VWAP
higher-low/lower-high structure
failed high-of-day attempts
volume acceleration or exhaustion
news/PR timestamp if available in future
```

### Required behavior

The classifier must be soft and confidence-based.

Do not do this:

```text
Hard switch: day_trade mode ignores daily levels.
```

Do this:

```text
Same levels, different weighting and explanation based on context.
```

## Phase 6: Add session and volume intelligence

### Goal

Improve level quality for day trades, premarket runners, PR runners, and journal context.

### New module targets

```text
src/lib/levels/session-level-builder.ts
src/lib/volume/volume-context-engine.ts
```

or equivalent locations that fit the repo.

### Session levels to support

The current system already supports premarket high, premarket low, opening range high, and opening range low.

Expand toward:

```text
VWAP
high of day
low of day
previous close
regular session open
after-hours high
after-hours low
first pullback low
first breakout high
first consolidation high/low
gap fill zone
halt high/low if halt data is available later
offering/warrant price levels if provided by external metadata later
```

### Volume intelligence to support

```text
relative volume at level
rolling volume ratio
session relative volume
dollar volume
liquidity quality
volume acceleration
volume dry-up into support
volume exhaustion
breakout volume confirmation
breakout follow-through volume
failed breakout volume
volume shelf zones
```

### Required output

Volume should not only affect score. It should also produce explainable labels such as:

```text
high_volume_rejection
low_volume_pullback
volume_dry_up_at_support
breakout_with_confirmation
breakout_without_confirmation
exhaustion_volume
accumulation_shelf
chop_volume_zone
thin_liquidity_level
high_dollar_volume_level
```

## Phase 7: Trading journal context contract

### Goal

Expose level and market context so a trading journal can evaluate actual executions.

The levels system should provide snapshots that describe the market structure at the time of a buy or sell.

### New contract target

```text
src/lib/journal-context/execution-market-context.ts
```

or a docs-only contract if the journal lives in another repo.

### Required type concept

```ts
// 2026-05-27 America/Toronto
export type ExecutionMarketContextSnapshot = {
  symbol: string;
  executionTimestamp: number;
  executionPrice: number;
  side: "buy" | "sell";

  nearestSupport: EnrichedLevelSnapshot | null;
  nearestResistance: EnrichedLevelSnapshot | null;

  vwap: number | null;
  percentFromVWAP: number | null;

  marketContext: MarketContextProfile;

  volumeContext: {
    relativeVolume: number | null;
    dollarVolume: number | null;
    volumeState: "low" | "normal" | "elevated" | "high" | "exhaustion";
  };

  extensionRisk: "low" | "moderate" | "high" | "extreme";

  tradeLocation:
    | "near_support"
    | "near_resistance"
    | "middle_of_range"
    | "breakout_area"
    | "breakdown_area"
    | "extended_above_vwap"
    | "below_vwap"
    | "chop_zone";

  riskContext: {
    nearestInvalidationLevel: number | null;
    distanceToInvalidationPct: number | null;
    nearestTargetLevel: number | null;
    distanceToTargetPct: number | null;
  };
};
```

### Journal questions this must support

The journal should eventually be able to answer:

```text
Did the trader buy near support or into resistance?
Did the trader add after confirmation or into extension?
Did the trader sell into logical resistance?
Did the trader hold after VWAP loss or support failure?
Was there a clear invalidation level at entry?
Was the entry a chase compared to VWAP and nearest base?
Was the trade in a runner, failed runner, swing, or chop context?
What did the trader do well?
What hurt the trade?
What should the trader improve next time?
```

## Suggested Codex run order

### Run 1: Audit only

Prompt Codex to read this file and create `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md`.

No code changes.

### Run 2: Consolidation directive only

Prompt Codex to create `docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md`.

No code changes.

### Run 3: Guardrail tests

Prompt Codex to add tests documenting current behavior and desired enriched behavior.

### Run 4: Safe enriched-output integration

Prompt Codex to wire richer analysis into the active engine using additive fields or adapters.

### Run 5: Context classifier

Prompt Codex to add market context classification after the enriched output is stable.

### Run 6: Volume/session intelligence

Prompt Codex to expand session levels and volume analysis.

### Run 7: Journal snapshot contract

Prompt Codex to define and optionally implement execution context snapshots for the trading journal.

## Validation commands

Codex should inspect `package.json` and use the repo's actual scripts, but likely commands include:

```bash
npm test
npx tsc --noEmit
```

If the repo has specialized validation scripts, Codex must list and run them as part of the audit or implementation PR.

## Final expected outcome

The finished system should be able to produce professional support/resistance analysis that explains:

```text
where the level came from
when it was created
when it was last tested
how often it reacted
how clean the reactions were
whether volume confirmed it
whether price is currently interacting with it
whether the level is fresh, respected, weakened, broken, reclaimed, or flipped
whether the stock is in a runner, failed runner, swing, or chop context
whether the level is useful as an entry area, breakout trigger, target, invalidation, warning, or avoid/chop zone
```

The finished system should also expose enough context for the trading journal to evaluate real executions against the structure that existed at the time of each buy or sell.

## Most important reminder

Do not build a new system beside the current system.

First audit.
Then consolidate.
Then enrich.
Then add context intelligence.
Then add journal integration.
