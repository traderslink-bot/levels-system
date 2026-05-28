# Session And Volume Intelligence Plan

Date: 2026-05-27 America/Toronto
Branch: `plan/session-volume-intelligence`
Scope: planning only

## 1. Executive Summary

The level-system rescue work is merged and the Market Context Classifier now exists as a pure optional analysis layer with an explicit integration adapter. The next professional-analysis layer should add session and volume intelligence.

This phase should not change live runtime behavior. It should define how the system will derive richer market facts such as VWAP, high of day, low of day, previous close, regular-session open, premarket levels, opening-range levels, first pullback areas, volume acceleration, volume dry-up, volume exhaustion, relative volume, dollar volume, and volume shelves.

These facts will later support:

- Better market-context classification.
- Better support/resistance explanations.
- Better runner and day-trade analysis.
- Better future trading-journal execution snapshots.

This is not a new support/resistance engine. It is a fact-enrichment layer that feeds analysis safely.

## 2. Current Foundation

The current merged foundation includes:

- no-lookahead candle-close filtering for historical/replay contexts
- formal market-structure `asOfTimestamp` filtering
- runtime old/new parity safety
- legacy runtime bucket preservation
- legacy extension-ladder preservation
- optional `enrichedAnalysis` shadow metadata
- pure `classifyMarketContext(input)`
- optional Market Context integration adapter

The next layer must preserve these constraints:

- `runtimeMode: "old"` remains default.
- Old/default `LevelEngineOutput` behavior remains unchanged.
- No alert behavior changes.
- No monitoring behavior changes.
- No trader-context behavior changes.
- No support/resistance selection changes.
- No Discord output changes.
- VWAP remains market-facts-only by default.

## 3. Purpose Of Session Intelligence

Session intelligence should derive session-aware market facts from candles and known session boundaries.

It should answer factual questions such as:

- What is the premarket high?
- What is the premarket low?
- What is the regular-session open?
- What is the opening-range high?
- What is the opening-range low?
- What is high of day?
- What is low of day?
- What is previous close?
- Where is VWAP?
- Is price above or below VWAP as a fact?
- What is the first pullback low after the opening drive?
- What is the first breakout high?
- Where was the first meaningful consolidation range?

It must not answer interpretive questions yet, such as:

- Should the trader buy?
- Should the trader sell?
- Is this a good trade?
- Should alerts become more urgent?

Those belong to later interpretation layers.

## 4. Purpose Of Volume Intelligence

Volume intelligence should derive participation facts and volume-quality signals.

It should answer factual and evidence-based questions such as:

- Is volume elevated compared with recent candles?
- Is volume accelerating?
- Is volume drying up on a pullback?
- Is a breakout supported by volume?
- Is a rejection occurring on high relative volume?
- Is current liquidity thin, acceptable, good, or strong?
- What is approximate dollar volume?
- Are there high-volume price shelves that may act as magnets, chop zones, support, or resistance?

The first implementation should produce facts and labels, not trade recommendations.

## 5. Required Session Facts

The session layer should eventually produce a structure similar to:

```ts
// 2026-05-27 America/Toronto
export type SessionMarketFacts = {
  symbol: string;
  asOfTimestamp: number;
  sessionDate: string;

  previousClose?: number;
  regularSessionOpen?: number;
  currentPrice?: number;

  premarketHigh?: number;
  premarketLow?: number;
  premarketHighTimestamp?: number;
  premarketLowTimestamp?: number;

  openingRangeHigh?: number;
  openingRangeLow?: number;
  openingRangeStartTimestamp?: number;
  openingRangeEndTimestamp?: number;

  highOfDay?: number;
  lowOfDay?: number;
  highOfDayTimestamp?: number;
  lowOfDayTimestamp?: number;

  vwap?: number;
  aboveVWAP?: boolean;
  percentFromVWAP?: number;

  firstPullbackLow?: number;
  firstPullbackLowTimestamp?: number;
  firstBreakoutHigh?: number;
  firstBreakoutHighTimestamp?: number;

  firstConsolidationRange?: {
    low: number;
    high: number;
    startTimestamp: number;
    endTimestamp: number;
  };

  diagnostics: SessionMarketFactDiagnostic[];
};
```

## 6. Required Volume Facts

The volume layer should eventually produce a structure similar to:

```ts
// 2026-05-27 America/Toronto
export type VolumeMarketFacts = {
  symbol: string;
  asOfTimestamp: number;

  currentVolume?: number;
  rollingAverageVolume?: number;
  relativeVolume?: number;
  dollarVolume?: number;

  volumeState:
    | "unknown"
    | "low"
    | "normal"
    | "elevated"
    | "high"
    | "extreme";

  liquidityQuality:
    | "unknown"
    | "thin"
    | "acceptable"
    | "good"
    | "strong";

  accelerationState:
    | "unknown"
    | "decelerating"
    | "steady"
    | "building"
    | "surging"
    | "exhaustion_risk";

  pullbackVolumeState?:
    | "unknown"
    | "drying_up"
    | "normal"
    | "selling_pressure_increasing";

  breakoutVolumeState?:
    | "unknown"
    | "not_applicable"
    | "weak"
    | "confirmed"
    | "strong"
    | "exhaustion_risk";

  volumeShelves: VolumeShelf[];
  diagnostics: VolumeMarketFactDiagnostic[];
};
```

## 7. Volume Shelf Model

Volume shelves are price areas where meaningful activity occurred. They should not be treated as exact levels in the first pass. They should be factual zones that may later contribute to support/resistance explanations.

Potential type:

```ts
// 2026-05-27 America/Toronto
export type VolumeShelf = {
  id: string;
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  totalVolume: number;
  dollarVolume: number;
  percentOfWindowVolume: number;
  touchCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  shelfRole: "unknown" | "support" | "resistance" | "chop_zone" | "magnet";
  confidence: number;
  reason: string;
};
```

First-pass shelf detection can be simple and deterministic:

- bucket candles by price bands
- sum volume and dollar volume per band
- rank shelves by percent of window volume
- avoid extremely narrow shelf zones
- avoid using future or partial candles

Do not use volume shelves to change runtime level selection in the first implementation.

## 8. VWAP Policy

VWAP remains market-facts-only by default.

Allowed first-pass uses:

- compute VWAP
- expose VWAP value
- expose percent from VWAP
- expose above/below VWAP as a fact
- make these facts available to the Market Context Classifier input

Disallowed first-pass uses:

- changing runtime support/resistance selection
- changing alert urgency
- changing trader-context labels
- changing monitoring behavior
- changing Discord message priority
- changing `strengthScore` or `strengthLabel`
- changing `enrichedAnalysis` scoring

Any interpretive VWAP use must wait for a later explicit policy phase.

## 9. No-Lookahead Contract

All session and volume facts must use the existing candle-close/as-of helper when `asOfTimestamp` is provided.

Rules:

- Future candles must be excluded.
- Still-forming partial candles must be excluded.
- 5m candles stamped at candle open are eligible only at or after their close timestamp.
- 4h candles are eligible only after their close timestamp.
- Daily candles are eligible only when the daily close contract allows them.
- If partial-derived candles are ever supported, they must be explicitly marked and derived from lower-timeframe closed candles only.

This is mandatory for replay and journal correctness.

## 10. Suggested Module Structure

Preferred modules:

```text
src/lib/session/session-market-facts.ts
src/lib/volume/volume-market-facts.ts
src/lib/volume/volume-shelf-detector.ts
src/lib/market-context/market-context-facts-adapter.ts
```

Alternative if the repo prefers tighter grouping:

```text
src/lib/market-context/session-market-facts.ts
src/lib/market-context/volume-market-facts.ts
```

Recommendation: keep session and volume facts separate from market-context classification so they can later be reused by levels, alerts, monitoring, and journal systems.

## 11. Integration With Market Context Classifier

The session/volume layer should eventually feed the optional Market Context integration adapter.

Example flow:

```text
closed candles + asOfTimestamp
  -> SessionMarketFacts
  -> VolumeMarketFacts
  -> MarketContextClassifierInput
  -> MarketContextProfile
```

The classifier should receive facts; it should not recompute all session and volume logic internally once this layer exists.

Do not make this flow automatic in `LevelEngine` default output yet.

## 12. Integration With Support/Resistance Levels

In a later phase, session and volume facts may help explain levels:

- resistance near high of day
- support near VWAP
- rejection on high volume
- support with volume dry-up
- breakout with volume confirmation
- volume shelf near support/resistance

First pass must not change level selection or ranking. It may only create optional facts and diagnostics.

## 13. Integration With Trading Journal Later

The trading journal will eventually use session and volume facts in execution snapshots.

Examples:

- bought near support while selling volume dried up
- added into resistance after volume exhaustion
- sold into high-of-day resistance
- held after VWAP loss
- chased far above VWAP after parabolic extension

But this phase should not implement journal behavior yet.

## 14. Tests Required Before Implementation

Tests should cover:

### Session facts

- premarket high/low detection
- opening range high/low detection
- high of day / low of day detection
- previous close handling
- regular-session open handling
- VWAP calculation as market fact
- first pullback low detection
- no-lookahead exclusion for session facts

### Volume facts

- relative volume calculation
- dollar volume calculation
- low/normal/elevated/high/extreme volume labels
- liquidity quality labels
- volume acceleration labels
- dry-up on pullback fixture
- breakout confirmation fixture
- exhaustion-risk fixture
- volume shelf detection
- no-lookahead exclusion for volume facts

### Safety tests

- old/default LevelEngine output unchanged
- `runtimeMode: "old"` remains default
- alert tests unchanged
- monitoring tests unchanged
- trader-context tests unchanged
- market-context classifier remains optional
- VWAP facts do not change interpretation by default

## 15. Implementation Order

Recommended implementation sequence:

1. Add session/volume planning doc. This document.
2. Add pure session facts types and builder.
3. Add session facts tests.
4. Add pure volume facts types and builder.
5. Add volume facts tests.
6. Add volume shelf detector tests and implementation.
7. Add an adapter that feeds session/volume facts into the existing Market Context Classifier input.
8. Keep everything optional and explicit.
9. Do not integrate into default `LevelEngineOutput` until later.
10. Do not influence alerts, monitoring, trader context, or journal behavior until later explicit phases.

## 16. Non-Goals

This phase must not:

- create a new support/resistance engine
- change runtimeMode defaults
- change old/default output behavior
- change alerts
- change monitoring
- change trader-context labels
- change Discord messages
- change journal behavior
- make trade recommendations
- use VWAP to change interpretation by default
- replace existing level scoring
- change `strengthScore` or `strengthLabel`

## 17. Recommended Next Codex Task

Implementation should start with session facts only.

Suggested first implementation task:

```text
Implement pure SessionMarketFacts builder and tests only.
Do not implement volume facts yet.
Do not integrate with LevelEngine default output.
Do not change runtime behavior.
```

This keeps the next step small and testable.
