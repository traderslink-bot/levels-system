# Market Context Classifier Integration Plan

Date: 2026-05-28
Scope: planning only
Depends on:

- `docs/32_MARKET_CONTEXT_CLASSIFIER_PLAN.md`
- merged Market Context Classifier phase 1 implementation
- merged level-system rescue work

## Executive Summary

The Market Context Classifier now exists as a pure optional analysis function: `classifyMarketContext(input)`. The next phase should integrate it into the level system as optional metadata only.

This integration must not change runtime behavior. It must not alter `runtimeMode`, old/default `LevelEngine` output behavior, level selection, bucket membership, nearest support/resistance, extension ladders, special levels, alert behavior, monitoring behavior, trader-context behavior, or enrichedAnalysis semantics.

The safest next step is an explicit optional add-on path that builds classifier input from already-available candles, reference price, previous close, volume facts, and VWAP facts, then returns a separate market-context analysis result beside `LevelEngineOutput`. That keeps current old consumers untouched while giving tests and future journal/replay work a stable metadata contract.

VWAP remains market-facts-only by default. The classifier may expose `facts.aboveVWAP` and `facts.percentFromVWAP`, but the integration must not allow VWAP to influence scoring, labels, alerts, trader interpretation, or support/resistance selection unless a later explicit policy enables it.

## Integration Principle

`marketContext` should be integrated as optional analysis metadata only.

The classifier is not:

- a new support/resistance engine
- a replacement for `LevelEngine`
- a replacement for `FinalLevelZone`
- a replacement for enrichedAnalysis
- a runtime mode switch
- a source of alert or trader-context decisions

The first integration should answer one question: given the same as-of market facts already available to the system, what market environment does the pure classifier observe?

The answer should be carried as metadata or a sibling analysis result. It should not change any runtime decision yet.

## Possible Integration Points

### `LevelEngineOutput.metadata.marketContext`

This option adds an optional `marketContext` field under `LevelEngineOutput.metadata`.

Benefits:

- Keeps analysis near the level output it describes.
- Makes serialization straightforward when the full level snapshot is stored.
- Gives future journal/replay snapshots a single object to inspect.

Risks:

- Existing old/default output comparisons may treat any metadata addition as a shape change.
- Consumers that assume exact metadata keys may need protection tests.
- It could create pressure to compute market context every time `LevelEngine.generateLevels()` runs.

Recommendation:

- Do not use this as the first integration unless it is behind an explicit option and tests prove old/default output is byte or deep-equal unchanged when the option is absent.

### Separate `MarketContextAnalysisOutput` Beside `LevelEngineOutput`

This option returns or builds market-context metadata separately from the normal level output.

Benefits:

- Safest first path for old/default output preservation.
- Keeps classifier invocation explicit.
- Avoids changing `LevelEngineOutput` shape for existing consumers.
- Makes it easier to test no-lookahead journal/replay behavior independently.
- Keeps market context clearly observational.

Risks:

- Callers need to carry a second object when they want context.
- Later integration into stored snapshots will need a small bridge.

Recommendation:

- This is the preferred first integration point for phase 2.

### Support-Resistance Shared Context

The shared support/resistance context could eventually include optional market-context metadata for journal and replay snapshots.

Benefits:

- This area already handles as-of, execution, and shared support/resistance views.
- It is a natural place for trading journal execution snapshots.
- It can reuse the merged candle-close as-of filtering contract.

Risks:

- The shared context is consumed by replay and trader-facing workflows, so accidental behavior coupling would be easy.
- It may be tempting to use context to alter nearest support/resistance language too early.

Recommendation:

- Plan for this after the separate analysis output is stable. When added, keep it optional and additive.

### Monitoring And Opportunity Evaluation Later

Monitoring and opportunity evaluation may eventually use market context to improve diagnostics, opportunity ranking, or explanation quality.

Benefits:

- Helps distinguish normal intraday behavior from runners, failed runners, and choppy setups.
- Could improve future opportunity review and calibration.

Risks:

- Directly affects live behavior if wired too early.
- Could change alert timing, suppression, or trader-facing labels.

Recommendation:

- Not part of phase 2. Do not integrate into monitoring or opportunity evaluation until a later explicit behavior-change phase with its own tests.

### Future Trading Journal Execution Snapshots

Execution snapshots are a strong future use case because they need professional as-of context.

Benefits:

- Journal/replay use benefits from no-lookahead market classification.
- The classifier can explain the environment at the time of execution.
- It can preserve facts and warnings without changing live behavior.

Risks:

- High risk of future-candle leakage if inputs are not adapted correctly.
- Needs strict serialization and reproducibility tests.

Recommendation:

- Add only after the adapter path is stable and no-lookahead tests prove future/partial candles cannot leak into classification.

## Recommended Phase 2 Integration

Phase 2 should add an explicit optional analysis path:

```ts
const levelOutput = await engine.generateLevels(request);
const marketContext = buildMarketContextAnalysis(input);
```

The first implementation should not automatically attach market context to old/default `LevelEngineOutput`.

Recommended design:

- Add adapter types.
- Add a pure adapter function that converts existing candles and market facts into `ClassifyMarketContextInput`.
- Add an integration function that returns `MarketContextIntegrationResult`.
- Keep invocation explicit.
- Do not call it from default `LevelEngine.generateLevels()` behavior.
- If a future option adds `metadata.marketContext`, make that option opt-in and test that absence preserves old/default output exactly.

This path keeps current runtime behavior untouched while creating a safe bridge for later optional metadata attachment.

## Type Contract

The phase 1 classifier already exports:

- `MarketContextPrimary`
- `RunnerPhase`
- `MarketContextProfile`
- `MarketContextEvidence`
- `MarketContextWarning`
- `MarketContextFacts`
- `MarketContextScoringAdjustments`
- `ClassifyMarketContextInput`

Phase 2 can add additive integration types similar to:

```ts
export type MarketContextAnalysisMetadata = {
  generatedAsOfTimestamp: number;
  source: "market_context_classifier";
  version: 1;
  profile: MarketContextProfile;
  inputSummary: {
    symbol: string;
    closedFiveMinuteCandles: number;
    premarketCandles: number;
    regularSessionCandles: number;
    hasPreviousClose: boolean;
    hasVWAPFact: boolean;
    hasRelativeVolume: boolean;
    hasDollarVolume: boolean;
    hasExplicitCatalyst: boolean;
  };
  diagnostics: {
    futureCandlesExcluded: number;
    partialCandlesExcluded: number;
    warnings: MarketContextWarning[];
  };
};

export type MarketContextClassifierInputAdapterRequest = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice: number;
  candles5m: Candle[];
  previousClose?: number;
  vwap?: number;
  relativeVolume?: number;
  dollarVolume?: number;
  failedHighOfDayAttempts?: number;
  newsTimestamp?: number;
  pressReleaseTimestamp?: number;
  higherTimeframeStructure?: MarketContextHigherTimeframeStructure;
};

export type MarketContextClassifierInputAdapterResult = {
  input: ClassifyMarketContextInput;
  inputSummary: MarketContextAnalysisMetadata["inputSummary"];
  diagnostics: MarketContextAnalysisMetadata["diagnostics"];
};

export type MarketContextIntegrationResult = {
  marketContext: MarketContextAnalysisMetadata;
  levelOutputUnchanged: true;
};
```

Contract requirements:

- All types must be additive.
- `MarketContextIntegrationResult` must not replace `LevelEngineOutput`.
- `levelOutputUnchanged: true` should be a documentation and test cue, not a runtime escape hatch.
- Diagnostics should make excluded future and partial candles visible.
- Metadata should serialize cleanly as JSON.

## Input Adapter Plan

The adapter should build classifier input from existing candle/session/reference-price data without duplicating the classifier logic.

Recommended adapter behavior:

1. Accept raw or already-fetched 5m candles plus explicit `asOfTimestamp`.
2. Use the existing candle-close/as-of filtering helper before deriving session subsets.
3. Derive premarket and regular-session candles using existing session classification utilities.
4. Pass the filtered candles into `classifyMarketContext`.
5. Preserve candle arrays by copying or filtering into new arrays. Do not mutate input candles.
6. Pass VWAP only as a fact.
7. Pass previous close, relative volume, dollar volume, failed high-of-day attempts, and optional catalyst timestamps only when available.
8. Return diagnostics that summarize excluded future/partial candles and classifier warnings.

The adapter should not:

- recalculate support/resistance levels
- call `LevelEngine`
- call network APIs
- read wall-clock time
- infer news or PR from price action alone
- mutate candles
- change runtime output

The adapter may eventually live under `src/lib/market-context/` so the classifier and integration bridge remain together.

## No-Lookahead Requirements

Historical, replay, journal, and execution-snapshot classification must always use the merged candle-close/as-of filtering helper.

Required rules:

- A candle is eligible only when its close timestamp is `<= asOfTimestamp`.
- Future candles must be excluded.
- Partial candles must be excluded unless explicitly partial-derived from lower-timeframe closed data in a later approved phase.
- 5m candles stamped at 09:30 must be excluded at 09:33 and included at 09:35.
- Still-forming 4h and daily candles must not be used for higher-timeframe context unless they are closed as of the snapshot.
- Appending future candles after an execution timestamp must not change market context for that execution snapshot.

Phase 2 tests should prove the adapter uses the existing helper rather than its own ad hoc timestamp logic.

## VWAP Policy

VWAP remains market-facts-only by default.

Allowed:

- `facts.aboveVWAP`
- `facts.percentFromVWAP`
- warnings or diagnostics stating that VWAP was recorded as a fact
- serialization of VWAP-derived facts for review

Not allowed in phase 2:

- VWAP changing primary context scoring
- VWAP changing runner phase
- VWAP changing support/resistance selection
- VWAP changing bucket membership
- VWAP changing nearest support/resistance
- VWAP changing extension ladders
- VWAP changing alert behavior
- VWAP changing monitoring behavior
- VWAP changing trader-context labels

Any future interpretive VWAP use needs a separate explicit policy, tests, and review.

## Runtime Safety Rules

Phase 2 must obey these rules:

- `runtimeMode old` remains default.
- Old/default `LevelEngine` output remains unchanged.
- No alert behavior changes.
- No monitoring behavior changes.
- No trader-context behavior changes.
- No support/resistance selection changes.
- No bucket membership changes.
- No nearest support/resistance changes.
- No extension ladder changes.
- No special-level changes.
- No new support/resistance engine.
- No behavior decisions based on classifier output.
- Classifier integration must be optional and additive.
- enrichedAnalysis remains shadow metadata only.
- VWAP remains facts-only by default.

The integration should fail closed. If classifier input cannot be built safely, it should return diagnostics or no market-context metadata rather than guessing or changing runtime behavior.

## Tests Required Before Implementation

Phase 2 should add tests before any integration code is trusted.

Required tests:

- Optional market-context metadata does not change the `LevelEngineOutput` shape used by old consumers.
- Old/default output remains unchanged when market context is not requested.
- `runtimeMode old` remains default.
- The classifier is called only when explicitly requested if the separate analysis path is chosen.
- No-lookahead filtering is preserved through the adapter.
- A 5m candle stamped 09:30 is excluded at 09:33 and included at 09:35.
- Future candles appended after an execution timestamp do not change as-of classification.
- VWAP facts-only behavior remains intact.
- VWAP facts do not alter classifier evidence, primary context, runner phase, or scoring adjustments.
- Market-context metadata serializes and deserializes as JSON.
- No impact on enrichedAnalysis metadata.
- No impact on old/new bucket parity.
- No impact on nearest support/resistance.
- No impact on extension levels.
- No impact on special levels.
- Input candles are not mutated.
- Missing optional facts produce warnings or lower confidence, not runtime errors.

If an opt-in `LevelEngineOutput.metadata.marketContext` path is later added, add tests proving:

- metadata is absent by default
- metadata appears only when explicitly requested
- existing old/default snapshots remain compatible
- storage remains backward compatible

## Implementation Order

Recommended sequence:

1. Add adapter types under the market-context module.
2. Add a pure adapter function that builds `ClassifyMarketContextInput` from existing candles and explicit market facts.
3. Add adapter unit tests for no-lookahead, VWAP facts-only behavior, input immutability, and missing optional facts.
4. Add a separate optional integration result function, such as `buildMarketContextAnalysis(...)`.
5. Add serialization tests for `MarketContextAnalysisMetadata`.
6. Add tests proving old/default `LevelEngineOutput` is unchanged.
7. Add tests proving `runtimeMode old` remains default.
8. Keep integration behind an explicit option or separate function.
9. Do not use market context for alert, monitoring, trader-context, or support/resistance decisions.
10. Only after tests pass, consider an opt-in metadata attachment path for journal/replay snapshots.

Phase 2 should stop once the optional metadata path is available and tested. Behavior changes belong to a later phase.

## Non-Goals

This integration phase is not:

- changing alerts
- changing monitoring behavior
- changing trader-context labels
- making trade recommendations
- replacing the support/resistance engine
- creating a new support/resistance engine
- changing `runtimeMode` defaults
- changing old/default `LevelEngine` output behavior
- changing level selection
- changing bucket membership
- changing nearest support/resistance
- changing extension ladders
- changing special levels
- changing enrichedAnalysis from shadow metadata into behavior
- using VWAP for trader interpretation by default
- adding network calls or catalyst lookups
- making `press_release_runner` inference from price action alone

## Recommended Next Step

After this document is reviewed, the next implementation task should be small and test-first:

- add market-context adapter types
- add a pure adapter function
- add no-lookahead and VWAP facts-only tests
- add optional separate analysis result metadata
- do not attach it to default `LevelEngineOutput`
- do not use it for behavior decisions

This keeps the classifier useful for review and future journal/replay work while preserving every runtime safety guarantee from the level-system rescue.
