# TraderLink Intelligence Level Analysis Contract

## Purpose

Reset the levels-system roadmap around its core responsibility: candle-data chart analysis and support/resistance intelligence for TraderLink Intelligence and the trading journal system to consume.

This is a documentation-only gate. It does not change LevelEngine behavior, support/resistance detection, extension generation, alert behavior, monitoring behavior, Discord behavior, or journal behavior.

## What Levels-System Owns

Levels-system owns factual, candle-data-driven market structure and level analysis:

- support/resistance detection from candles
- multi-timeframe level maps across intraday and higher timeframe candles
- major, intermediate, and intraday level classification
- extension ladders beyond the surfaced support/resistance map
- synthetic continuation-map extensions when real extension inventory is missing or shallow
- clear synthetic extension metadata that distinguishes continuation-map levels from historical support/resistance
- session facts, including high/low/opening-range/VWAP facts where available
- volume facts, including relative volume, dollar volume, liquidity, acceleration, and breakout-volume facts
- volume shelves as facts-only context, not converted into support/resistance levels
- market context classification from no-lookahead-safe candle and facts inputs
- Level Intelligence reports that explain level context and confluence
- Level Quality Audit reports that evaluate level quality, clutter, stale/fresh state, extension coverage, and weak context
- deterministic no-lookahead-safe as-of analysis for replay, historical review, and journal snapshots
- clean serializable output contracts for downstream systems

The system should optimize for level quality, explainability, replay safety, and stable contracts before presentation channels.

## What Levels-System Does Not Own

Levels-system must not become the trading journal's behavioral or coaching layer. It does not own:

- trade grading
- coaching
- realized or unrealized P/L
- giveback analysis
- behavioral scoring
- journal UI
- journal workflow state
- Discord-first product decisions
- member-facing alert packaging as a primary product objective

Downstream systems may use levels-system output to build their own product experiences, but levels-system should remain a factual analysis provider.

## Proposed Downstream Snapshot

TraderLink Intelligence and the journal app should consume one deterministic analysis snapshot per symbol/as-of moment. Proposed shape:

```ts
type LevelAnalysisSnapshot = {
  symbol: string;
  asOfTimestamp: number;
  referencePrice?: number;

  levelEngineOutput: LevelEngineOutput;

  sessionFacts?: SessionMarketFacts;
  volumeFacts?: VolumeMarketFacts;
  volumeShelves?: VolumeShelf[];
  marketContext?: MarketContextProfile;
  factsBundle?: MarketContextFactsBundle;

  levelIntelligenceReport: LevelIntelligenceReport;
  levelQualityAudit: LevelQualityAuditReport;

  safety: {
    noLookaheadApplied: true;
    candleCloseFilteringApplied: true;
    partialCandlesExcluded: boolean;
    futureCandlesExcluded: boolean;
    supportResistanceSelectionUnchangedByFacts: true;
    vwapFactsOnly: true;
    volumeShelvesFactsOnly: true;
    syntheticExtensionsMarked: true;
    runtimeBehaviorUnchanged: true;
  };
};
```

This contract should be built from candle inputs and explicit facts inputs, not from Discord messages or alert payloads.

## No-Lookahead Requirements

Every historical, replay, and journal snapshot must be built as of a specific `asOfTimestamp`.

Required rules:

- Candle filtering must use candle-close semantics.
- Future candles must be excluded.
- Still-forming candles must be excluded unless explicitly marked as a live/current incomplete input and kept out of historical replay comparisons.
- Daily, 4h, 5m, and future 15m candles must be filtered independently by timeframe close time.
- Facts builders must receive the same as-of-filtered candle sets.
- LevelEngine output, session facts, volume facts, shelves, market context, intelligence reports, and quality audits must all be derived from the same as-of data boundary.
- Snapshots should carry safety diagnostics proving the as-of filter was applied.

This is essential for journal use because the journal must inspect what the trader could have known at that exact time.

## Required Inputs

The eventual snapshot builder should accept:

- `symbol`
- `asOfTimestamp`
- 5m candles
- optional 15m candles in a later phase
- 4h candles
- daily candles
- previous close
- optional news/catalyst timestamp or metadata
- optional current/reference price

Input requirements:

- Candles should be normalized to the repository candle type.
- Timeframe identity must be explicit.
- The builder should not infer unavailable facts as evidence.
- The builder should report missing or insufficient data as diagnostics rather than silently filling gaps.
- Current/reference price should be explicit when available; otherwise it may be derived from the latest closed as-of candle with a diagnostic.

## Required Outputs For Journal And Intelligence Use

The snapshot must expose factual level intelligence suitable for downstream analysis:

- nearest support and resistance around `referencePrice`
- major support and resistance
- intermediate support and resistance
- intraday support and resistance
- extension levels
- synthetic continuation-map levels clearly marked as synthetic and not historical support/resistance
- level freshness
- level strength score and strength label
- level zone width and representative price
- level source types and timeframe sources
- enriched analysis metadata when available
- session confluence
- volume confluence
- shelf confluence
- market context profile and evidence
- quality diagnostics
- stale/fresh counts
- weak-context levels
- clustered or cluttered level areas
- extension coverage and continuation-map coverage
- safety flags proving facts stayed facts-only and did not mutate support/resistance selection

The output should be usable by TraderLink Intelligence without requiring downstream systems to reconstruct level logic from raw buckets.

## Current Building Blocks

The repository already has most of the component parts:

- `LevelEngineOutput` for support/resistance buckets, extension levels, special levels, and metadata
- synthetic extension metadata on `FinalLevelZone.extensionMetadata`
- `SessionMarketFacts`
- `VolumeMarketFacts`
- `VolumeShelf[]`
- `MarketContextProfile`
- `MarketContextFactsBundle`
- `LevelIntelligenceReport`
- `LevelQualityAuditReport`
- execution context snapshots for trade-time factual context
- as-of filtering tests for candle-close safety
- multi-sample audit and diagnostics artifacts for extension and clustering quality review

The missing layer is a one-call analysis snapshot builder that assembles these pieces from candles under one as-of boundary.

## What Still Needs To Be Built

The roadmap should move away from Discord-first iteration and toward actual chart analysis quality:

1. Build a one-call `LevelAnalysisSnapshot` builder.
2. Generate session facts directly from as-of-filtered candles.
3. Generate volume facts directly from as-of-filtered candles.
4. Generate volume shelves directly from as-of-filtered candles.
5. Generate market context directly from candles, session facts, volume facts, shelves, and optional catalyst metadata.
6. Generate LevelEngine output from the same as-of-filtered candle boundary.
7. Generate Level Intelligence from `LevelEngineOutput` plus facts.
8. Generate Level Quality Audit automatically from `LevelEngineOutput` plus Level Intelligence.
9. Add as-of/replay-safe snapshot tests that prove no future candle can affect historical output.
10. Add multi-timeframe fixture tests covering 5m, future 15m, 4h, and daily data.
11. Add actual ticker/candle replay validation for runners, clean movers, choppy tickers, thin-liquidity tickers, and higher-priced stocks.
12. Add snapshot serialization tests so TraderLink Intelligence can depend on the contract.

## Proposed Builder Boundary

Recommended future API:

```ts
type BuildLevelAnalysisSnapshotRequest = {
  symbol: string;
  asOfTimestamp: number;
  candles: {
    fiveMinute: Candle[];
    fifteenMinute?: Candle[];
    fourHour: Candle[];
    daily: Candle[];
  };
  previousClose?: number;
  referencePrice?: number;
  catalyst?: {
    timestamp: number;
    source?: string;
    label?: string;
  };
};

declare function buildLevelAnalysisSnapshot(
  request: BuildLevelAnalysisSnapshotRequest,
): LevelAnalysisSnapshot;
```

Implementation constraints for the future builder:

- pure function where practical
- deterministic output
- no `Date.now`
- no network calls
- no Discord imports
- no alert or monitoring side effects
- no journal grading/coaching/P/L/giveback behavior
- explicit diagnostics for missing or insufficient inputs
- structured output that downstream systems can store and diff

## Safety Contract

The snapshot must prove:

- support/resistance selection is driven by candle data and LevelEngine rules
- session facts do not change level selection
- volume facts do not change level selection
- volume shelves do not become support/resistance levels
- market context remains contextual metadata unless a future explicitly tested gate changes a defined scoring path
- synthetic continuation-map extensions are marked and never presented as historical levels
- runtime defaults remain unchanged
- output is serializable and stable for replay

## Recommended Next Implementation Gate

Recommended next gate:

```text
level_analysis_snapshot_builder
```

That gate should create the first pure one-call builder that takes as-of-filtered candle inputs, builds `LevelEngineOutput`, derives facts, builds `LevelIntelligenceReport`, builds `LevelQualityAuditReport`, and returns a serializable `LevelAnalysisSnapshot`.

The first implementation should be narrow and heavily tested with deterministic fixtures. It should not touch Discord, alerts, monitoring behavior, journal grading, coaching, P/L, giveback, or behavioral scoring.
