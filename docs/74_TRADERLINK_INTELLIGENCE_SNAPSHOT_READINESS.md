# TraderLink Intelligence Snapshot Readiness

## Readiness Answer

`LevelAnalysisSnapshot` is ready for early downstream contract consumption by TraderLink Intelligence / journal systems as a factual chart-analysis payload.

It is not yet final-locked as a permanent schema. The recommended next confidence step is real cached ticker replay validation.

## Stable Enough To Consume First

These fields are stable enough for TraderLink Intelligence / journal consumers to read first:

- `schemaVersion`
- `producer`
- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

Recommended first consumer path:

- Use `schemaVersion` to verify the contract.
- Use `safety.noLookaheadApplied` before showing replay/journal analysis.
- Use `nearestSupport` and `nearestResistance` for quick chart context.
- Use `levelEngineOutput` for the full canonical level map.
- Use `extensionLevels` and `extensionMetadata` for continuation-map context.
- Use `sessionFacts`, `volumeFacts`, and `volumeShelves` for factual market context.
- Use `levelIntelligenceReport` for level explanations.
- Use `levelQualityAudit` for quality diagnostics and weak-coverage flags.

## Optional Or Experimental Areas

These fields are useful but should be treated as more likely to evolve:

- Detailed `levelQualityAudit` diagnostic arrays and finding names.
- `marketContext.scoringAdjustments`.
- `marketContext.runnerPhase`.
- Human-readable profile `reason` strings.
- Synthetic extension spacing and ladder density.
- Any currently empty or sparse major/intermediate level coverage in deterministic fixtures.
- Future `15m` timeframe support.

## What Should Remain Inside Levels-System

These responsibilities should stay owned by `levels-system`:

- Candle-close/as-of filtering.
- Support/resistance detection.
- Multi-timeframe raw candidate generation.
- Clustering, scoring, ranking, and level selection.
- Synthetic continuation-map extension generation and labeling.
- Session facts.
- Volume facts.
- Volume shelf detection.
- Market context classification.
- Level intelligence report construction.
- Level quality audit construction.
- Snapshot schema generation.

Downstream TraderLink Intelligence / journal consumers should not reimplement these analytics. They should consume the snapshot.

## What TraderLink Intelligence / Journal Should Consume

Initial journal-facing consumption should focus on factual chart context:

- Symbol and as-of identity.
- Reference price.
- Nearest support and nearest resistance.
- Major/intermediate/intraday levels from `levelEngineOutput`.
- Extension levels with synthetic continuation-map metadata when present.
- Session facts such as high/low of day, opening range, premarket range, and VWAP facts.
- Volume facts such as relative volume, dollar volume, liquidity quality, and acceleration state.
- Volume shelves as fact-only context.
- Market context profile.
- Level explanation profiles.
- Quality audit summary and diagnostics.
- Safety flags.

## What TraderLink Intelligence / Journal Should Not Consume As Instructions

The snapshot is not a journal scoring or coaching payload. It does not provide:

- trade grading
- coaching
- P/L analysis
- giveback analysis
- behavior scoring
- journal UI state
- Discord/test-channel output

## Fixture Pack Readiness Findings

The multi-scenario fixture pack proves:

- Every snapshot is valid JSON.
- Every snapshot has `schemaVersion` and `producer`.
- Every snapshot has `inputSummary`.
- Every snapshot has `nearestSupport` / `nearestResistance` fields.
- Every snapshot has `LevelEngineOutput`.
- Every snapshot has `LevelIntelligenceReport`.
- Every snapshot has `LevelQualityAudit`.
- Synthetic extensions are clearly marked when present.
- No fixture snapshot includes Discord, alert, or monitoring contract fields.

The pack also shows areas to validate with real data:

- Low-price runner fixture had no nearest resistance or extension ladder.
- Major/intermediate level coverage was sparse across deterministic samples.
- Market context classification can be conservative relative to fixture intent.
- Synthetic continuation-map coverage appears in multiple scenarios, but real cached data should validate spacing and usefulness.

## Contract Readiness Summary

`LevelAnalysisSnapshot` is ready as the core factual chart-analysis object for a first TraderLink Intelligence / journal connector contract.

It should be considered `v1 candidate` rather than `v1 locked` until real cached ticker replay validates:

- actual support/resistance density,
- major/intermediate level availability,
- extension ladder behavior,
- synthetic continuation-map behavior,
- market context classification,
- quality audit usefulness.

## Recommended Next Gate

Recommended next gate: `real_ticker_replay_validation_with_actual_cached_data`.

Rationale: deterministic fixtures validate schema and contract shape. Actual cached candle replay is the next necessary proof that the same snapshot contract is useful on real market data without changing support/resistance behavior.
