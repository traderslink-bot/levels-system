# Level System Pipeline Consolidation Directive

Date: 2026-05-27
Run scope: Run 2 from `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md`
Input audit: `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md`

## Purpose

This directive defines the safe consolidation path for the level system before any implementation work begins. It converts the Run 1 audit into an implementation sequence that preserves runtime behavior, reuses the richer ranking/scoring logic, and avoids creating a third support/resistance engine.

This document is documentation-only. It does not authorize production code changes by itself.

## Non-Negotiable Constraints

1. Do not create a new `v3`, `advanced`, `professional`, `next`, or parallel support/resistance engine.
2. Keep `FinalLevelZone` as the runtime transport type for now.
3. Keep `LevelEngineOutput` backward compatible.
4. Preserve `runtimeMode: "old" | "new" | "compare"` semantics.
5. Keep `runtimeMode: "old"` as the default until parity gates pass.
6. Add richer fields additively. Do not remove or rename existing runtime fields in the first consolidation pass.
7. Fix P1 no-lookahead prerequisites before any journal/replay enrichment becomes trusted output.
8. Keep market facts separate from trader interpretation.

## Required P1 No-Lookahead Prerequisite

No journal, replay, post-trade review, or execution-context enrichment may rely on newly enriched level analysis until the no-lookahead contract is implemented and tested.

The required contract is:

- Candle inclusion must use candle-close semantics, not candle-start semantics.
- A candle is eligible at `asOfTimestamp` only when its computed close timestamp is `<= asOfTimestamp`.
- If the system receives 5m candles stamped at candle open, the 09:30 candle is not eligible at 09:33; it becomes eligible at 09:35.
- Higher-timeframe candles must use timeframe-aware close timestamps.
- Daily candles must not be treated as complete until the relevant session close boundary is reached, unless the provider explicitly marks them as closed historical candles.
- Partial candles may be included only when they are derived from lower-granularity closed candles and explicitly marked as partial-derived facts.

This prerequisite applies to:

- `buildSupportResistanceContextFromNormalizedCandles()`
- trade-analysis and execution-context snapshots
- dynamic level calculations used in journal/replay contexts
- practical candle market structure
- formal BOS/CHOCH market structure
- stable market structure if it is exposed through shared replay/journal contracts
- any future enrichedAnalysis journal snapshot

Required P1 tests before journal/replay enrichment:

- A 5m candle stamped at 09:30 is excluded for an execution at 09:33 and included at 09:35.
- A 1m-derived partial 5m candle is allowed only when explicitly marked as partial-derived and only from closed 1m inputs.
- Dynamic levels for an execution snapshot use only candles whose close timestamp is `<= asOfTimestamp`.
- Execution-level relations and nearest support/resistance context do not change when a future partial candle is appended after the execution time.
- Higher-timeframe cutoffs exclude still-forming 4h and daily candles.
- Diagnostics report future or partial candles that were excluded.

## Runtime Transport Decision

`FinalLevelZone` remains the runtime transport type during the consolidation.

The active runtime contract continues to be:

- `LevelEngine.generateLevels()` returns `LevelEngineOutput`.
- `LevelEngineOutput` contains grouped `FinalLevelZone[]` arrays.
- Monitoring, alerts, validation, review tools, and shared support/resistance context continue to consume the existing grouped output.
- Existing `FinalLevelZone` fields remain mandatory where they are currently mandatory.

This means the first implementation pass must not force downstream consumers to understand `RankedLevel`.

## Additive Enrichment Model

Richer analysis should be added as an optional nested field on `FinalLevelZone`:

```ts
export type EnrichedLevelAnalysis = {
  structuralStrengthScore: number;
  activeRelevanceScore: number;
  finalLevelScore: number;
  confidence: number;
  state: LevelState;
  durabilityLabel?: LevelDurabilityLabel;
  rank?: number;
  explanation: string;
  scoreBreakdown: LevelScoreBreakdown;
  touchStats?: {
    meaningfulTouchCount: number;
    rejectionCount: number;
    failedBreakCount: number;
    cleanBreakCount: number;
    reclaimCount: number;
    roleFlipCount: number;
    strongestReactionMovePct: number;
    averageReactionMovePct: number;
    bestVolumeRatio: number;
    averageVolumeRatio: number;
    cleanlinessStdDevPct: number;
    ageInBars: number;
    barsSinceLastReaction: number;
  };
};
```

Then:

```ts
export type FinalLevelZone = {
  // Existing fields remain unchanged and mandatory.
  enrichedAnalysis?: EnrichedLevelAnalysis;
};
```

Rules for this field:

- Optional during migration.
- Read-only from the perspective of downstream consumers.
- Must not affect alerting, monitoring, or bucket selection until explicit tests authorize that behavior.
- Must be explainable and traceable to existing ranking/scoring modules.
- Must not duplicate scoring formulas in a new engine.

If TypeScript compatibility or consumer risk makes direct enrichment unsafe, an adapter type may be introduced as a temporary documentation and test target:

```ts
export type AnalyticalLevelZone = FinalLevelZone & {
  enrichedAnalysis: EnrichedLevelAnalysis;
};
```

However, `AnalyticalLevelZone` must remain an adapter view, not a separate runtime engine.

## Reusing Richer Ranking Without A Third Engine

The richer path must reuse existing modules:

- `rankLevels()`
- `analyzeLevelTouches()`
- `computeStructuralStrengthScore()`
- `computeActiveRelevanceScore()`
- `deriveLevelState()`
- `explainLevelScore()`
- surfaced selection and comparison helpers where appropriate

Allowed approaches:

- Convert existing old-path candidates or zones into `LevelCandidate` inputs and call `rankLevels()`.
- Build a narrow adapter from `FinalLevelZone` plus source evidence into the richer scoring inputs.
- Move shared scoring primitives behind common helper functions when duplication pressure appears.

Disallowed approaches:

- New parallel level engines.
- Copy/paste forks of scoring formulas.
- New runtime output shapes that bypass `LevelEngineOutput`.
- Making `RankedLevel` the direct runtime transport before all consumers and parity gates are covered.

## Runtime Mode Preservation

The current runtime modes must remain:

- `old`: default active behavior using the existing bucketed path.
- `new`: projected richer/surfaced path through runtime-compatible output.
- `compare`: computes both paths and logs differences while preserving `compareActivePath`.

Required behavior:

- `old` remains default until parity gates pass.
- `new` remains opt-in.
- `compare` remains the primary migration safety mechanism.
- Any enrichedAnalysis emitted by the old path must not change bucket membership, alert triggers, or surfaced levels by default.
- Any enrichedAnalysis emitted by the new path must preserve the legacy `LevelEngineOutput` shape.
- Comparison logs must distinguish output-shape compatibility from behavioral parity.

## Parity Gates Before New Path Can Become Default

The new path cannot become default until these gates pass across deterministic fixtures and replay scenarios:

1. Bucket parity: support/resistance bucket counts are equal or within an explicitly approved tolerance.
2. Price proximity parity: nearest support and nearest resistance around the reference price are equivalent within configured price tolerance.
3. Extension parity: extension ladder depth, direction, and low-price/runner coverage match old-path expectations.
4. Special-level parity: premarket high/low and opening-range high/low remain unchanged.
5. Strength compatibility: old `strengthScore` and `strengthLabel` remain stable or mapped by a documented, tested rule.
6. Alert parity: watchlist alerts triggered from old and new output are identical, or approved differences are documented.
7. Trader-context parity: downstream trader-context labels do not change unless explicitly authorized.
8. Runtime storage parity: `level-store` can save, load, and expire output with optional enrichment.
9. Performance parity: runtime cost stays within an approved budget for live watchlist use.
10. Explainability: enriched fields include score breakdowns and plain-English explanations.

## Required Old/New Output Parity Tests

Add tests before changing runtime defaults:

- `level-runtime-mode` tests proving `old`, `new`, and `compare` modes still return `LevelEngineOutput`.
- Fixture tests comparing old/new bucket counts by major, intermediate, intraday, and extension groups.
- Fixture tests comparing nearest support/resistance around a reference price.
- Fixture tests proving special levels are identical across old/new modes.
- Tests proving `compareActivePath: "old"` returns old output and logs new-path comparison data.
- Tests proving `compareActivePath: "new"` returns new projected output without changing the public output shape.
- Tests covering low-price runners where old extension behavior currently expands ladder coverage.
- Tests proving strength-label mapping is deterministic and documented.
- Downstream tests proving alert scoring and trader-message language do not change in default old mode.
- Serialization tests proving optional `enrichedAnalysis` does not break stored `LevelEngineOutput`.

## Required Partial-Candle Exclusion Tests

Add tests before any journal/replay enrichment:

- 5m open-stamped candle exclusion at an execution timestamp inside that candle.
- 5m candle inclusion exactly at its close timestamp.
- 4h candle exclusion while still forming.
- Daily candle exclusion before session close when using intraday as-of snapshots.
- Dynamic levels built from execution-time candles exclude future and partial candles.
- Execution support/resistance context does not use a future candle appended after the execution.
- Diagnostics identify excluded future or partial candles.
- Partial-derived candles from lower-granularity closed inputs are explicitly identified and tested separately.

These tests should use a shared candle-close helper once implemented, so the contract is not duplicated in test-only logic.

## Required Formal Structure `asOfTimestamp` Tests

Formal market structure must gain the same no-lookahead behavior as practical candle market structure before it is used in shared replay or journal output.

Required tests:

- `buildFormalMarketStructureContext()` accepts `asOfTimestamp`.
- Future candles after `asOfTimestamp` are excluded.
- Excluded future candles produce diagnostics equivalent in spirit to practical market-structure diagnostics.
- A future BOS/CHOCH event does not appear in context for an earlier snapshot.
- Formal structure output is stable when future candles are appended after `asOfTimestamp`.
- Multi-timeframe formal structure honors each timeframe's candle-close semantics.

## Shared Support/Resistance Context Expansion

The shared support/resistance context should eventually expose practical, stable, and formal multi-timeframe structure additively.

Do not replace the current field:

```ts
marketStructure: CandleMarketStructureContext;
```

Instead, add a new optional structure view:

```ts
marketStructureByTimeframe?: {
  "5m"?: {
    practical?: CandleMarketStructureContext;
    stable?: StableMarketStructureContext;
    formal?: FormalMarketStructureContext;
  };
  "15m"?: {
    practical?: CandleMarketStructureContext;
    stable?: StableMarketStructureContext;
    formal?: FormalMarketStructureContext;
  };
  "1h"?: {
    practical?: CandleMarketStructureContext;
    stable?: StableMarketStructureContext;
    formal?: FormalMarketStructureContext;
  };
  "4h"?: {
    practical?: CandleMarketStructureContext;
    stable?: StableMarketStructureContext;
    formal?: FormalMarketStructureContext;
  };
  daily?: {
    practical?: CandleMarketStructureContext;
    stable?: StableMarketStructureContext;
    formal?: FormalMarketStructureContext;
  };
};
```

Migration rules:

- Keep `marketStructure` as the legacy 5m practical context.
- Add multi-timeframe structure as optional.
- Only include formal/stable contexts when they are no-lookahead safe.
- Add tests proving old consumers continue reading `marketStructure`.
- Add tests proving new consumers can read practical/stable/formal context without changing existing output.

## VWAP Market Facts Policy

VWAP should be treated as a market fact by default.

Default allowed uses:

- expose VWAP value
- expose percent from VWAP
- include VWAP in raw dynamic levels or market facts
- show VWAP as context in reports when clearly labeled as a fact

Default disallowed uses:

- changing trader-context labels
- marking a move stretched or extended
- changing story-memory materiality
- changing post/no-post behavior
- changing confidence or alert urgency

VWAP may influence trader interpretation only behind an explicit policy switch or context profile, for example:

```ts
vwapInterpretationPolicy: "facts_only" | "allow_trader_interpretation";
```

Required tests:

- Default trader-context output does not change labels solely because price is far from VWAP.
- VWAP remains visible in market facts when available.
- Enabling explicit VWAP interpretation changes output only in tests that opt into that policy.
- Story memory does not treat VWAP-only extension as material under the default policy.

## Migration Sequence

1. Add no-lookahead tests and formal `asOfTimestamp` tests first.
2. Implement the no-lookahead candle-close helper and apply it to replay/journal-facing paths.
3. Add formal structure `asOfTimestamp` filtering and diagnostics.
4. Add old/new output parity tests for runtime modes and compare logs.
5. Define `EnrichedLevelAnalysis` and add optional `enrichedAnalysis` to `FinalLevelZone`.
6. Add an adapter that reuses `rankLevels()` and existing richer scoring modules.
7. Emit `enrichedAnalysis` in shadow/compare contexts without changing runtime behavior.
8. Expand parity coverage across watchlist alerts, trader context, level store, and validation/review flows.
9. Add shared support/resistance multi-timeframe structure additively after no-lookahead safety is proven.
10. Keep `runtimeMode: "old"` default until all parity gates pass and differences are explicitly approved.
11. Only then consider making the richer projected path default.

## Required Test Gates Before Runtime Behavior Changes

Before any runtime behavior changes:

- Existing tests pass.
- New no-lookahead tests pass.
- New formal `asOfTimestamp` tests pass.
- Old/new output parity tests pass or approved differences are documented.
- Default `runtimeMode: "old"` behavior is unchanged.
- Optional `enrichedAnalysis` does not alter existing consumers.
- VWAP remains market facts only unless explicit policy opt-in is tested.

Before making the new path default:

- Runtime compare logs show acceptable parity across representative historical scenarios.
- Alert and monitoring behavior are unchanged or intentionally approved.
- Extension levels match old-path practical coverage requirements.
- Shared support/resistance and trader-context outputs are no-lookahead safe.
- Level store and serialized output compatibility are proven.
- Performance is acceptable for live watchlist runtime.

## Acceptance Criteria For This Directive

- Documentation only.
- No production code changes.
- No new engine.
- Clear migration sequence.
- Clear no-lookahead prerequisite before journal/replay enrichment.
- Clear test gates before runtime behavior changes.
- Clear preservation of `FinalLevelZone`, `LevelEngineOutput`, and `runtimeMode`.
- Clear VWAP market-facts policy.
- Clear shared support/resistance expansion path.
