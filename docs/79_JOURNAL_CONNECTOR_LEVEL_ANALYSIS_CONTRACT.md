# Journal Connector Level Analysis Contract

## Purpose

This document defines how TraderLink Intelligence / journal systems should consume `LevelAnalysisSnapshot` from `levels-system`.

`LevelAnalysisSnapshot` is a factual chart-analysis payload. It carries candle-data-driven support/resistance intelligence, market facts, level explanations, quality diagnostics, and no-lookahead safety metadata for a specific symbol and `asOfTimestamp`.

It is not a trade grading payload, coaching payload, alert payload, Discord payload, P/L payload, or journal UI model.

## Boundary Statement

`levels-system` owns factual market-structure and level-analysis generation from candle data. TraderLink Intelligence / the journal owns trade execution interpretation, journal presentation, user workflow, grading, coaching, P/L, giveback analysis, behavior scoring, and UI behavior.

Downstream systems may use the snapshot as factual chart context. They must not treat the snapshot itself as a trading recommendation or as a completed journal interpretation.

## What Levels-System Provides

`levels-system` provides:

- No-lookahead-safe candle filtering and as-of snapshot construction.
- Support/resistance detection.
- Multi-timeframe raw candidate generation, clustering, scoring, ranking, and surfaced level selection.
- Major, intermediate, intraday, and extension level buckets.
- Synthetic continuation-map extension levels when the accepted extension fallback rules allow them.
- Session facts, including factual session landmarks and VWAP facts.
- Volume facts, including relative volume, dollar volume, liquidity quality, and acceleration facts.
- Volume shelves as fact-only contextual shelves.
- Market context classification from facts and closed candles.
- Level intelligence reports and level explanations.
- Level quality audits and diagnostics.
- Safety flags describing no-lookahead and fact-only constraints.

## What Levels-System Does Not Provide

`levels-system` does not provide:

- Trade grading.
- Coaching conclusions.
- P/L analysis.
- Giveback analysis.
- Behavioral scoring.
- Journal UI state.
- Discord-first product decisions.
- Alert routing decisions for journal consumption.
- Buy/sell/hold instructions.
- User-specific execution advice.

Any downstream use that turns factual context into journal interpretation belongs outside `levels-system`.

## Snapshot Lifecycle

The expected lifecycle is:

1. A caller provides symbol, `asOfTimestamp`, reference price, and closed candle inputs or a prebuilt `LevelEngineOutput` plus facts.
2. `levels-system` applies candle-close as-of filtering before analysis.
3. `levels-system` builds or composes `LevelEngineOutput`, facts, `LevelIntelligenceReport`, and `LevelQualityAudit`.
4. `levels-system` returns a serializable `LevelAnalysisSnapshot`.
5. TraderLink Intelligence / journal persists or consumes the snapshot as immutable factual context.
6. Downstream systems may derive their own journal view models, but should preserve the original snapshot for auditability.

Consumers should treat snapshots as point-in-time artifacts keyed by symbol and `asOfTimestamp`.

## Required Snapshot Identity Fields

Downstream consumers should require:

- `schemaVersion`: must start with `level-analysis-snapshot/v1`.
- `producer`: must equal `levels-system`.
- `symbol`: normalized ticker symbol.
- `asOfTimestamp`: point-in-time analysis timestamp.
- `referencePrice`: price used for nearest-level and distance context when available.

If `referencePrice` is absent, downstream systems may still show full level maps, but should treat nearest-level convenience fields as potentially `null`.

## Required Candle / Input Summary Fields

Downstream consumers should read `inputSummary` for data availability:

- `timeframesPresent`
- `candleCounts`
- `filteredCandleCounts`
- `excludedFutureCandleCounts`
- `excludedPartialCandleCounts`
- `timeframes`
- `previousCloseProvided`

Expected timeframe keys are:

- `5m`
- `15m`
- `4h`
- `daily`

The `15m` slot may be present as an absent or zero-count placeholder for forward compatibility. Missing daily or `4h` candles should be treated as data completeness limitations, not automatic snapshot failure, unless a downstream feature explicitly requires those timeframes.

## Required Nearest Level Fields

Downstream consumers may use:

- `nearestSupport`
- `nearestResistance`

These fields are derived only from existing `levelEngineOutput` and `referencePrice`. They do not create new levels and do not change support/resistance detection.

When present, each nearest level includes:

- `levelId`
- `kind`
- `bucket`
- `representativePrice`
- `zoneLow`
- `zoneHigh`
- `strengthScore`
- `strengthLabel`
- `distanceFromReferencePct`
- `isExtension`
- `extensionSource` when available

`nearestSupport: null` or `nearestResistance: null` is an explicit absence on the correct side of the reference price, not a malformed snapshot.

## Required LevelEngineOutput Fields

Downstream consumers should treat `levelEngineOutput` as the canonical level map.

Primary fields to consume:

- `symbol`
- `generatedAt`
- `majorSupport`
- `majorResistance`
- `intermediateSupport`
- `intermediateResistance`
- `intradaySupport`
- `intradayResistance`
- `extensionLevels.support`
- `extensionLevels.resistance`
- `specialLevels`
- `metadata`

Consumers should not rerank or mutate these buckets. If a journal view needs a smaller display shape, it should derive that view from the snapshot while preserving the original `levelEngineOutput`.

## Session Facts Consumption

`sessionFacts` provides factual session context such as:

- Previous close when supplied.
- Current/reference price when available.
- Premarket high and low.
- Opening range high and low.
- High of day and low of day.
- VWAP as a fact-only market measure.

VWAP must remain fact-only. Downstream systems may display VWAP proximity as context, but should not convert VWAP facts into support/resistance levels unless a separate downstream product explicitly owns that interpretation.

## Volume Facts Consumption

`volumeFacts` provides factual volume context such as:

- Relative volume.
- Dollar volume.
- Liquidity quality.
- Volume acceleration.
- Dry-up or pressure facts when available.
- Breakout volume state when available.

These are descriptive market facts. They are not trade instructions and should not be converted directly into grades or coaching conclusions by the connector layer.

## Volume Shelves Consumption

`volumeShelves` provides fact-only high-volume price areas detected from candle data.

Downstream consumers may display shelves as context near levels, but should not treat shelves as generated support/resistance levels. Shelves are contextual facts, not replacements for `levelEngineOutput`.

## Market Context Consumption

`marketContext` provides classifier output describing the broader market setup from closed candles and facts.

Useful consumer fields may include context labels, confidence, runner phase, liquidity context, and scoring adjustments when present. Some market context subfields remain more likely to evolve than the core snapshot identity and level map, so downstream systems should read them defensively.

Market context is descriptive. It should not be treated as a trade recommendation.

## Facts Bundle Consumption

`factsBundle` groups session, volume, shelf, market, and reference facts into a single context bundle for explanation/report generation.

Downstream consumers may use it when they need the same fact set that powered `levelIntelligenceReport`. If both top-level facts and `factsBundle` are present, consumers should prefer top-level fields for simple rendering and use `factsBundle` for traceability.

## LevelIntelligenceReport Consumption

`levelIntelligenceReport` provides factual explanations of support/resistance levels and nearby facts.

Downstream systems may use it to:

- Show why a level exists.
- Show nearby session or volume confluence.
- Explain whether a level is historical, extension, or synthetic continuation-map context.
- Preserve neutral level-analysis wording for journal review.

Downstream systems must not reinterpret explanation text as trade advice. If the journal wants coaching or execution evaluation, that logic belongs in the journal system, not in `levels-system`.

## LevelQualityAudit Consumption

`levelQualityAudit` provides quality and coverage diagnostics for the snapshot's level map.

Downstream systems may use it to:

- Flag sparse coverage.
- Flag missing or limited extension coverage.
- Flag weak context or unenriched levels.
- Identify quality-audit findings for QA workflows.

`LevelQualityAudit` findings are diagnostics, not trading instructions. A finding such as missing resistance extension coverage does not mean a trade should or should not be taken.

## Synthetic Continuation-Map Metadata Consumption

Synthetic continuation-map extension levels are forward-planning chart map levels only.

A synthetic continuation-map row should be identified by:

- `isExtension: true`
- `extensionMetadata.extensionSource: "synthetic_continuation_map"`
- Notes and evidence limitations explaining that the row is synthetic, continuation-map context, and not historical support/resistance.

Downstream consumers must not treat synthetic continuation-map rows as:

- Historical support/resistance.
- Evidence of prior touches or rejections.
- Historical confluence.
- Trade advice.
- A reason to grade a trade by itself.

Real historical/candidate extension rows remain preferred by `levels-system`. Synthetic rows only fill missing or shallow coverage when current safety rules allow them.

## Diagnostics Consumption

`diagnostics` is a string array for data completeness, as-of, and construction notes.

Common diagnostics may include:

- Missing higher-timeframe candle inputs.
- Missing facts bundle.
- Candle-close as-of filtering applied.
- Market context not built.
- Synthetic extension marking issues if a marking invariant fails.

Downstream systems should display or log diagnostics for observability and QA, but should not treat every diagnostic as fatal. Fatality should be connector-specific and documented by the consumer.

## Safety Flags Consumption

Downstream consumers should require the `safety` object before using a snapshot in replay, journal, or historical review flows.

Key flags:

- `noLookaheadApplied`
- `levelOutputUnchanged`
- `factsOnlyVWAP`
- `shelvesAreFactsOnly`
- `syntheticExtensionsClearlyMarked`
- `noRuntimeBehaviorChange`

If `noLookaheadApplied` is false, the journal connector should treat the snapshot as unsuitable for historical/replay judgment until reviewed. If `syntheticExtensionsClearlyMarked` is false, downstream systems should avoid displaying synthetic rows as trusted continuation-map context.

## Stable Fields For Downstream V1 Candidate Use

Stable enough for early v1 candidate consumption:

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
- `factsBundle`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

The safest initial journal integration should consume identity fields, nearest levels, the canonical level buckets, facts, quality audit summary, diagnostics, and safety flags.

## Optional / Experimental Fields

Treat these areas as useful but more likely to evolve:

- Detailed quality-audit finding names and nested arrays.
- Market context subfields such as runner phase and scoring adjustments.
- Human-readable explanation strings.
- Synthetic extension spacing and density.
- Future `15m` timeframe support.
- Any future source-data completeness object beyond `inputSummary`.
- Any future compact journal view model derived from the full snapshot.

Consumers should preserve unknown fields for forward compatibility and avoid hard-failing on optional sections unless the downstream feature explicitly requires them.

## Fields Downstream Systems Must Not Reinterpret As Trade Advice

Downstream systems must not directly reinterpret these as trade advice:

- `strengthScore`
- `strengthLabel`
- `distanceFromReferencePct`
- `marketContext`
- `levelQualityAudit` findings
- `volumeFacts`
- `volumeShelves`
- `extensionLevels`
- Synthetic continuation-map rows
- Level explanation text

These fields describe chart structure and market facts. Any trade execution interpretation, journal grading, coaching, P/L, giveback, or behavior analysis must be owned by the downstream journal/intelligence layer.

## No-Lookahead Expectations

Every historical, replay, or journal snapshot must be built with an explicit `asOfTimestamp`.

Expected behavior:

- Closed candles at or before the as-of boundary may be used.
- Future candles must be excluded.
- Still-forming candles must be excluded using candle-close semantics.
- Appending future candles should not change the snapshot for the same `asOfTimestamp`.
- Snapshot consumers should preserve `asOfTimestamp` with any derived journal record.

The journal connector should reject or quarantine snapshots where no-lookahead safety is not asserted.

## Versioning And Compatibility Expectations

The current contract is a v1 candidate:

- `schemaVersion` should start with `level-analysis-snapshot/v1`.
- `producer` should equal `levels-system`.
- Additive fields are allowed.
- Unknown fields should be preserved by downstream systems.
- Required top-level fields should not be removed without a schema version change.
- Optional sections may be absent when inputs are unavailable.

Downstream systems should implement tolerant readers and strict writers: validate required fields, preserve unknown fields, and avoid assuming optional subfields are always present.

## Recommended Connector Validation Rules

Connector validation checklist:

- Confirm `schemaVersion` starts with `level-analysis-snapshot/v1`.
- Confirm `producer` is `levels-system`.
- Confirm `symbol`, `asOfTimestamp`, and `referencePrice` are present when the consuming feature requires nearest-level context.
- Confirm `inputSummary.candleCounts`, `inputSummary.filteredCandleCounts`, and `inputSummary.timeframesPresent` are present.
- Confirm `safety` flags are present before using the snapshot.
- Require `safety.noLookaheadApplied === true` for replay/journal analysis.
- Require `safety.factsOnlyVWAP === true` before showing VWAP as fact-only context.
- Require `safety.shelvesAreFactsOnly === true` before showing volume shelves as fact-only context.
- Treat missing optional sections as non-fatal unless a feature explicitly requires them.
- Preserve unknown fields for forward compatibility.
- Do not infer journal grading directly from level scores.
- Do not treat synthetic extension rows as historical evidence.
- Do not treat quality-audit findings as trading instructions.
- Do not mutate `levelEngineOutput`.

## Example Downstream Usage Patterns

Practical consumer patterns:

- Journal chart context panel: show symbol, as-of time, reference price, nearest support, nearest resistance, and core level buckets.
- Level explanation panel: show `levelIntelligenceReport` sections with nearby session and volume facts.
- QA/debug panel: show `levelQualityAudit`, `diagnostics`, and `inputSummary`.
- Replay-safe journal record: persist the full snapshot with the trade record, keyed by `symbol` and `asOfTimestamp`.
- Synthetic extension display: show synthetic continuation-map rows separately from historical candidate rows and include their evidence limitations.

These patterns are factual chart-context uses. They are not trade grading or coaching features.

## Explicit Anti-Goals

The connector must not:

- Pull journal grading into `levels-system`.
- Pull coaching conclusions into `levels-system`.
- Add P/L or giveback analysis to `levels-system`.
- Add behavior scoring to `levels-system`.
- Treat Discord/test-channel output as the primary product contract.
- Reinterpret synthetic continuation-map rows as historical support/resistance.
- Re-score or re-rank support/resistance levels downstream.
- Make buy/sell/hold recommendations from the snapshot.

## Recommended Next Gate

Recommended next gate: `real_ticker_replay_validation_more_symbols`.

Rationale: the connector consumption boundary is now documented, and initial real-cache validation plus regression tests support the v1 candidate. Before locking the schema as final v1, the best next confidence step is broader real cached ticker replay validation across more symbols and market conditions. That should prove the contract remains useful and stable beyond the first five real-cache symbols, then `snapshot_schema_v1_lock` can follow with stronger evidence.
