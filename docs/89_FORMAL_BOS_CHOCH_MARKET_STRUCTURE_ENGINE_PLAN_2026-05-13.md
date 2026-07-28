# Formal BOS/CHOCH Market Structure Engine Plan

Date: 2026-05-13
Project: TraderLink levels-system
Intent: Add an explicit, testable, trader-visible BOS/CHOCH market-structure engine without replacing the current practical/stable 5m structure layer.

## Executive Summary

The current system already detects practical 5m structure: confirmed swing pivots, active ranges, higher lows, trend damage, pivot losses, reclaims, breakout attempts, and stable material state changes. That layer is useful for noise control and trader-readable posts, but it does not formally label structural events as BOS or CHOCH.

This plan adds a separate formal structure engine that explicitly detects:

- bullish BOS
- bearish BOS
- bullish CHOCH
- bearish CHOCH
- high/low liquidity sweeps
- failed breaks
- internal vs external structure
- protected highs/lows
- close-confirmed vs wick-only vs displacement-confirmed breaks
- transitional bias before a new trend is fully confirmed

The implementation should be additive. Do not rip out the current `candle-market-structure.ts`, `stable-market-structure.ts`, or `live-stable-market-structure.ts` layers. The final system should use both:

- Existing stable structure: practical state, noise suppression, Discord budget control.
- New formal BOS/CHOCH engine: explicit structural labels, test/debug output, trader diagnosis.

Important framing: formal structure should not mean "every 5m pivot is major market structure." A professional chart reader usually separates structure by timeframe:

- Higher timeframe structure defines the bigger regime and important invalidation areas.
- Lower timeframe structure gives tactical execution clues inside that bigger regime.
- A 5m BOS against a 4h bearish structure is not the same quality as a 5m BOS aligned with daily/4h structure.
- A 5m CHOCH can be useful as an early shift, but it should be described as intraday/tactical until higher timeframe structure confirms.

Therefore, v1 should make 5m formal BOS/CHOCH explicit, but the design must reserve room for a multi-timeframe structure stack. In normal Discord wording, prefer phrases like "5m structure" or "intraday structure" unless daily/4h confirmation is actually present.

This plan is written so Codex can execute it in one run without stopping for clarification. Use the assumptions and defaults in this file whenever a decision is needed.

Core architecture rule: v1 live implementation is 5m tactical/intraday structure, but the formal structure contract must be multi-timeframe-ready from day one.

## Non-Negotiable Implementation Principles

1. Keep all existing behavior working unless a test needs an intentional update.
2. Add the formal engine as a new module first, then integrate it.
3. Make the pure candle-array engine deterministic and easy to unit test before wiring live runtime.
4. Favor conservative detection over noisy detection. Missing a weak BOS is better than labeling every tiny break as structure.
5. Treat small-cap penny movement carefully. Use price-scaled tolerances.
6. Surface concise structure in normal Discord posts, and full internals only behind a debug flag.
7. Keep output trader-facing. Avoid direct buy/sell/entry/exit advice.
8. Add tests for every new formal event type before relying on it in Discord.
9. Do not require user verification mid-run. If a threshold is uncertain, use the defaults in this plan and add calibration hooks.
10. Avoid repainting: all formal BOS/CHOCH decisions must be evaluated against the prior confirmed structure state, not against a state derived from the same candle that is being classified.
11. Avoid repeated event spam: runtime material-change flags must be deduped by accepted structure key and confirmed candle boundary.

## Current Codebase Touchpoints

Existing market-structure files:

- `src/lib/structure/candle-market-structure.ts`
- `src/lib/structure/stable-market-structure.ts`
- `src/lib/structure/index.ts`
- `src/lib/monitoring/live-stable-market-structure.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/alerts/trader-message-language.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`

Existing tests to keep green:

- `src/tests/candle-market-structure.test.ts`
- `src/tests/stable-market-structure.test.ts`
- `src/tests/live-stable-market-structure.test.ts`
- `src/tests/market-structure-language.test.ts`
- `src/tests/watchlist-monitor.test.ts`
- `src/tests/alert-router.test.ts`

New files to add:

- `src/lib/structure/formal-market-structure.ts`
- `src/lib/monitoring/live-formal-market-structure.ts`
- `src/tests/formal-market-structure.test.ts`
- `src/tests/live-formal-market-structure.test.ts`

Optional review/report file to add after core integration:

- `src/lib/review/formal-market-structure-calibration-report.ts`
- `src/scripts/run-formal-market-structure-calibration-report.ts`
- `src/tests/formal-market-structure-calibration-report.test.ts`

## Current System Audit Before Implementation

Before implementing this plan, explicitly acknowledge the current state of the app:

- The existing candle market-structure engine is 5m-specific.
- `src/lib/structure/candle-market-structure.ts` returns `timeframe: "5m"` and builds states such as `range_bound`, `breakout_holding`, `pivot_lost`, and `reclaim_confirmed` from 5m candles.
- `src/lib/monitoring/live-stable-market-structure.ts` builds rolling 5m candles from live ticks and stabilizes those 5m states.
- `src/lib/support-resistance/build-support-resistance-context.ts` does use daily, 4h, and 5m candles for levels, reference levels, gaps, dynamic levels, and trader context, but its `marketStructure` field is currently built from the 5m candle series.
- Therefore, current market-structure detection is not yet a formal multi-timeframe BOS/CHOCH structure reader.

This is acceptable as a starting point, but the implementation must not preserve that limitation as the final design. The formal engine should be built as a structure stack:

1. 5m formal structure: tactical/intraday BOS, CHOCH, sweeps, failed breaks.
2. 4h formal structure: higher-confidence regime and broader protected swings.
3. Daily formal structure: major market map and important invalidation zones.
4. Confluence layer: labels whether 5m structure is aligned with, neutral to, or fighting 4h/daily structure.

Implementation rule:

- It is fine to ship the first formal detector on 5m candles because live alerts are intraday and the app already has a 5m live candle builder.
- It is not fine to word or architect it as if 5m alone is the whole market structure.
- All user-facing output from 5m-only detection should say `5m structure` or `intraday structure`.
- Once 4h/daily formal contexts are available, the app should upgrade wording only when higher timeframe agreement exists.

Professional chart-reader model:

- Use pivots/swing points as structure anchors.
- Separate internal structure from external structure.
- Identify protected highs/lows from meaningful HL/LH pivots.
- Treat BOS as continuation through a structural swing.
- Treat CHOCH as a break of the protected swing that changes the prior directional premise.
- Treat wick-only breaks as sweeps unless a candle closes beyond the level with enough displacement.
- Treat 5m structure as tactical unless confirmed or supported by 4h/daily context.

## Timeframe Philosophy: How A Strong Chart Reader Would Treat Structure

Do not treat all structure as equal. A strong discretionary chart reader usually reads structure in layers:

1. Higher timeframe structure: daily and 4h.
   - Defines the broader directional regime.
   - Identifies the bigger protected highs/lows.
   - Carries more weight for whether a move is meaningful.
   - Changes slower and should not flip from a single noisy intraday candle.

2. Intermediate/intraday structure: 5m.
   - Shows tactical shifts, acceptance, failed breaks, and early rotations.
   - Useful for live Discord alerts because the app monitors live intraday movement.
   - Should be described as "5m structure" or "intraday structure" unless it aligns with higher timeframe structure.

3. Microstructure: 1m/tick.
   - Useful for tape/entry timing.
   - Too noisy for formal BOS/CHOCH in this system.
   - Should not drive Discord BOS/CHOCH labels directly.

The first implementation should focus on 5m because:

- the live monitor already builds rolling 5m candles from ticks;
- the existing stable structure layer is 5m;
- current Discord alerts are intraday and level-reaction oriented;
- it gives enough signal to test quickly without waiting for 4h/daily candles.

But the engine must be built so higher timeframe context can be added cleanly. The final architecture should support:

- `5m` formal structure for tactical alerts;
- `4h` formal structure for regime/context;
- `daily` formal structure for major map alignment;
- a confluence layer that scores whether 5m BOS/CHOCH agrees or conflicts with 4h/daily.

Recommended language:

- 5m only: "5m structure printed bullish BOS..."
- 5m aligned with 4h/daily: "intraday BOS is aligned with higher-timeframe structure..."
- 5m against higher timeframe: "5m structure shifted, but it is still working into higher-timeframe resistance..."

Do not call a 5m BOS a full trend change when higher timeframe structure has not confirmed.

## Prior-State And Runtime Dedupe Rules

These rules must be implemented before, or at the same time as, the formal engine. They are not optional polish.

### Prior-State Rule

Formal events must be detected against the structure that existed before the event candle.

For a pure candle-array build:

1. Sort and filter candles.
2. Split the series into:
   - `priorCandles = candles.slice(0, -1)`
   - `evaluationCandle = candles.at(-1)`
3. Derive prior swings, prior bias, prior protected high/low, and prior structural targets from `priorCandles`.
4. Evaluate `evaluationCandle` and recent completed closes against that prior state.
5. After deciding the event, build the returned context using both:
   - prior state used for classification;
   - all candles for latest display/debug swings.

For live runtime:

- A still-forming 5m candle can update debug/readiness context.
- A formal BOS/CHOCH should only become confirmed when the relevant 5m candle closes.
- If early visibility is needed later, add a separate `candidateEventType`, not a confirmed BOS/CHOCH.

Reason:

- If the event candle is allowed to create the swing/bias it is then tested against, the engine can repaint or misclassify CHOCH as continuation.
- The plan must avoid look-ahead contamination.

### Runtime Dedupe Rule

The live formal tracker must remember the last accepted formal event key per symbol.

Add internal state:

```ts
type SymbolFormalStructureState = {
  completedCandles: Candle[];
  currentCandle?: Candle;
  lastCumulativeVolume?: number;
  context?: FormalMarketStructureRuntimeContext;
  lastAcceptedEventKey?: string;
  lastAcceptedEventCandleTimestamp?: number;
};
```

Build event keys from stable structural facts:

```ts
const eventKey = [
  context.bias,
  context.latestEvent.type,
  context.latestEvent.brokenSwing?.id ?? "no_broken",
  context.latestEvent.sweptSwing?.id ?? "no_sweep",
  context.latestEvent.confirmation,
  context.latestEvent.triggerTimestamp ?? "no_time",
].join("|");
```

`materialChange` should be true only when:

- latest formal event is not `none`; and
- event confidence is medium/high; and
- event key differs from `lastAcceptedEventKey`; and
- the event is confirmed on a closed 5m candle or is explicitly allowed as an early candidate.

After emitting/accepting a material formal event:

- update `lastAcceptedEventKey`;
- update `lastAcceptedEventCandleTimestamp`;
- keep future ticks inside the same candle from repeatedly marking the same event as material.

This prevents Discord from posting the same BOS/CHOCH over and over while price remains beyond the same level.

## Step 1: Define Formal Structure Types

Add `src/lib/structure/formal-market-structure.ts`.

Start by importing the existing candle type:

```ts
import type { Candle } from "../market-data/candle-types.js";
```

Define these exported types:

```ts
export type FormalStructureBias =
  | "bullish"
  | "bearish"
  | "bullish_transition"
  | "bearish_transition"
  | "range"
  | "unknown";

export type FormalStructureEventType =
  | "bos_bullish"
  | "bos_bearish"
  | "choch_bullish"
  | "choch_bearish"
  | "liquidity_sweep_high"
  | "liquidity_sweep_low"
  | "failed_break_high"
  | "failed_break_low"
  | "none";

export type FormalSwingKind = "high" | "low";

export type FormalSwingLabel =
  | "HH"
  | "HL"
  | "LH"
  | "LL"
  | "EH"
  | "EL"
  | "unclassified";

export type FormalSwingScope = "internal" | "external";

export type FormalBreakConfirmation =
  | "wick_only"
  | "close_confirmed"
  | "displacement_confirmed"
  | "follow_through_confirmed"
  | "none";

export type FormalStructureConfidenceLabel = "low" | "medium" | "high";

export type FormalStructureTimeframe = "5m" | "4h" | "daily";
```

Define pivot/swing object:

```ts
export type FormalStructureSwing = {
  id: string;
  timeframe: FormalStructureTimeframe;
  kind: FormalSwingKind;
  label: FormalSwingLabel;
  scope: FormalSwingScope;
  price: number;
  timestamp: number;
  index: number;
  strength: number;
};
```

Define event object:

```ts
export type FormalStructureEvent = {
  type: FormalStructureEventType;
  biasBefore: FormalStructureBias;
  biasAfter: FormalStructureBias;
  brokenSwing: FormalStructureSwing | null;
  sweptSwing: FormalStructureSwing | null;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  confirmation: FormalBreakConfirmation;
  displacementPct: number;
  closeBeyondPct: number;
  confidenceScore: number;
  confidenceLabel: FormalStructureConfidenceLabel;
  reasons: string[];
};
```

Define full context:

```ts
export type FormalMarketStructureContext = {
  symbol: string;
  timeframe: FormalStructureTimeframe;
  asOfTimestamp: number | null;
  bias: FormalStructureBias;
  previousBias: FormalStructureBias | null;
  latestEvent: FormalStructureEvent;
  swings: FormalStructureSwing[];
  internalSwings: FormalStructureSwing[];
  externalSwings: FormalStructureSwing[];
  latestHigh: FormalStructureSwing | null;
  latestLow: FormalStructureSwing | null;
  protectedHigh: FormalStructureSwing | null;
  protectedLow: FormalStructureSwing | null;
  swingSequence: FormalSwingLabel[];
  confidenceScore: number;
  confidenceLabel: FormalStructureConfidenceLabel;
  traderLine?: string;
  debug: {
    candleCount: number;
    leftBars: number;
    rightBars: number;
    externalLeftBars: number;
    externalRightBars: number;
    breakTolerance: number;
    medianRange: number;
    reasons: string[];
  };
  diagnostics: Array<{
    code:
      | "insufficient_candles"
      | "future_candles_filtered"
      | "no_swings"
      | "no_external_structure"
      | "range_or_unknown_bias";
    severity: "info" | "warning";
    message: string;
  }>;
};
```

Define request type:

```ts
export type BuildFormalMarketStructureRequest = {
  symbol: string;
  candles: Candle[];
  timeframe?: FormalStructureTimeframe;
  asOfTimestamp?: number | string | Date;
  currentPrice?: number;
  options?: FormalMarketStructureOptions;
};
```

If `timeframe` is omitted, default it to `"5m"`. This keeps v1 behavior aligned with the current live intraday monitor while preserving the multi-timeframe contract.

Define options:

```ts
export type FormalMarketStructureOptions = {
  leftBars?: number;
  rightBars?: number;
  externalLeftBars?: number;
  externalRightBars?: number;
  minCandles?: number;
  equalLevelTolerancePct?: number;
  breakTolerancePct?: number;
  displacementRangeMultiplier?: number;
  followThroughBars?: number;
};
```

Default values:

```ts
const DEFAULT_LEFT_BARS = 2;
const DEFAULT_RIGHT_BARS = 2;
const DEFAULT_EXTERNAL_LEFT_BARS = 4;
const DEFAULT_EXTERNAL_RIGHT_BARS = 4;
const DEFAULT_MIN_CANDLES = 24;
const DEFAULT_EQUAL_LEVEL_TOLERANCE_PCT = 0.004;
const DEFAULT_DISPLACEMENT_RANGE_MULTIPLIER = 0.6;
const DEFAULT_FOLLOW_THROUGH_BARS = 2;
```

These defaults are 5m tactical defaults. Because the formal contract accepts `4h` and `daily`, implementation must allow timeframe-specific overrides later:

- 5m: use the defaults above for v1 live tactical structure.
- 4h: should usually use fewer required recent bars than daily, wider pivot windows than 5m, and less sensitivity to single-candle noise.
- daily: should use slower pivot windows, broader tolerance rules, and enough historical candles to avoid overreacting to one recent daily bar.

Do not assume the 5m defaults are correct for 4h/daily when those contexts are wired.

## Step 2: Implement Candle Preparation Helpers

Use the same stable approach as `candle-market-structure.ts`:

- validate OHLC values
- remove invalid candles
- sort ascending by timestamp
- filter candles after `asOfTimestamp`
- track how many future candles were filtered

Do not use raw input order.

Helpers to implement:

- `parseTimestamp`
- `sortedUsableCandles`
- `roundPrice`
- `formatPrice`
- `pctDistance`
- `median`
- `medianCandleRange`
- `priceTolerance`
- `breakToleranceForPrice`

Break tolerance default logic:

```ts
function breakToleranceForPrice(price: number, overridePct?: number): number {
  if (overridePct !== undefined) return Math.abs(price) * overridePct;
  if (price < 1) return Math.max(0.01, price * 0.015);
  if (price < 2) return Math.max(0.02, price * 0.012);
  if (price < 10) return Math.max(0.04, price * 0.008);
  return Math.max(0.1, price * 0.005);
}
```

Equal high/low tolerance:

```ts
function equalLevelTolerance(price: number, options: FormalMarketStructureOptions): number {
  return Math.max(breakToleranceForPrice(price, options.equalLevelTolerancePct), price * 0.002);
}
```

Use numeric price distances internally, not string formatting.

## Step 3: Detect Internal And External Swings

Implement local pivot detection twice:

1. Internal swings using `leftBars/rightBars`, default `2/2`.
2. External swings using `externalLeftBars/externalRightBars`, default `4/4`.

Both should produce `FormalStructureSwing[]`.

Swing high:

- candle high is greater than all left highs and all right highs
- strict greater-than for raw pivot detection

Swing low:

- candle low is lower than all left lows and all right lows
- strict less-than for raw pivot detection

Strength:

- use a reaction/local-range model similar to `localMoveStrength` in `candle-market-structure.ts`
- clamp to `0.1` through `1`

Deduping:

- if an internal and external swing share same kind and timestamp, keep the external version only in the combined `swings`
- still populate `internalSwings` and `externalSwings` separately
- combined `swings` should sort by timestamp/index ascending

IDs:

- `${symbol}:${timeframe}:formal:${scope}:${kind}:${timestamp}`

## Step 4: Classify Swing Labels

Classify highs against prior highs:

- higher high = `HH`
- lower high = `LH`
- equal high = `EH`

Classify lows against prior lows:

- higher low = `HL`
- lower low = `LL`
- equal low = `EL`

Rules:

- For first high or first low, label `unclassified`.
- Use equal-level tolerance before higher/lower classification.
- For highs:
  - current.price > previous.price + tolerance => `HH`
  - current.price < previous.price - tolerance => `LH`
  - otherwise `EH`
- For lows:
  - current.price > previous.price + tolerance => `HL`
  - current.price < previous.price - tolerance => `LL`
  - otherwise `EL`

Important:

- Classify internal and external swings separately first.
- Combined swing sequence can use external swings preferentially, but include internal labels for debug.

## Step 5: Determine Initial Bias

Use external swings first.

Bias used for event classification must be prior bias. Derive it from the candle set before the evaluation candle, not from the full candle set including the candle that may be breaking structure.

Bias rules:

- bullish if recent external sequence contains at least one `HH` and one `HL`, and no recent `LL`
- bearish if recent external sequence contains at least one `LL` and one `LH`, and no recent `HH`
- range if enough swings exist but labels conflict or are mostly equal
- unknown if insufficient external swings

Use recent last 6 external swings for initial bias, with recency and ordering constraints:

- bullish requires an `HL` that occurs after a prior meaningful low and a relevant `HH` after or near that higher-low sequence;
- bearish requires an `LH` that occurs after a prior meaningful high and a relevant `LL` after or near that lower-high sequence;
- old `HH/HL` or `LL/LH` pairs should not dominate if the most recent external sequence is conflicting;
- if recent sequence is mixed, prefer `range` or `unknown` over forcing a directional bias.

Fallback:

- if external swings are insufficient, use internal swings but lower confidence.
- if both are insufficient, return `unknown` with diagnostic `no_swings` or `no_external_structure`.

## Step 6: Track Protected High And Protected Low

Protected levels are required for formal CHOCH.

Protected low in bullish bias:

- latest external low labeled `HL`
- fallback latest internal `HL` if no external `HL`
- fallback latest swing low only if confidence is low and reasons say fallback used

Protected high in bearish bias:

- latest external high labeled `LH`
- fallback latest internal `LH`
- fallback latest swing high only if confidence is low and reasons say fallback used

Range/unknown:

- protected high = latest meaningful high
- protected low = latest meaningful low
- these are not trend-protected yet; mark reasons accordingly

After bullish BOS:

- protected low remains latest meaningful HL unless a newer higher low forms

After bearish BOS:

- protected high remains latest meaningful LH unless a newer lower high forms

After bearish CHOCH:

- bias becomes `bearish_transition`
- protected high becomes most recent meaningful high before break

After bullish CHOCH:

- bias becomes `bullish_transition`
- protected low becomes most recent meaningful low before break

## Step 7: Detect Breaks Against Structural Levels

Evaluate the latest candle and recent follow-through candles against prior-state levels.

Important candidate levels:

- latest structural high
- latest structural low
- protected high
- protected low

Use close-confirmed logic:

- bullish break if latest close > level + tolerance
- bearish break if latest close < level - tolerance

Use wick-only logic:

- high > level + tolerance and close <= level + tolerance => wick sweep above high
- low < level - tolerance and close >= level - tolerance => wick sweep below low

Use displacement:

- absolute close beyond level divided by recent median candle range
- if >= `displacementRangeMultiplier`, classify as `displacement_confirmed`

Use follow-through:

- if last N completed candle closes are beyond level, classify as `follow_through_confirmed`
- default N = 2

In live runtime, the active in-progress 5m candle must not count as a follow-through candle. It can only produce debug/candidate information unless the runtime explicitly treats the previous bucket as completed.

Break confirmation priority:

1. `follow_through_confirmed`
2. `displacement_confirmed`
3. `close_confirmed`
4. `wick_only`
5. `none`

## Step 8: Detect BOS

Bullish BOS conditions:

- prior bias is `bullish` or `bullish_transition`
- latest close confirms above latest structural high
- protected low is not broken
- confirmation is at least `close_confirmed`

Output:

- event type `bos_bullish`
- biasAfter `bullish`
- brokenSwing = structural high
- protectedLow retained
- confidence higher if external high was broken, lower if internal only

Bearish BOS conditions:

- prior bias is `bearish` or `bearish_transition`
- latest close confirms below latest structural low
- protected high is not broken
- confirmation is at least `close_confirmed`

Output:

- event type `bos_bearish`
- biasAfter `bearish`
- brokenSwing = structural low
- protectedHigh retained

Transitional confirmation:

- A `bullish_transition` becomes `bullish` on bullish BOS.
- A `bearish_transition` becomes `bearish` on bearish BOS.

## Step 9: Detect CHOCH

Bearish CHOCH conditions:

- prior bias is `bullish`
- protected low exists
- latest close confirms below protected low
- confirmation is at least `close_confirmed`

Output:

- event type `choch_bearish`
- biasBefore `bullish`
- biasAfter `bearish_transition`
- brokenSwing = protected low
- protectedHigh = most recent meaningful high

Bullish CHOCH conditions:

- prior bias is `bearish`
- protected high exists
- latest close confirms above protected high
- confirmation is at least `close_confirmed`

Output:

- event type `choch_bullish`
- biasBefore `bearish`
- biasAfter `bullish_transition`
- brokenSwing = protected high
- protectedLow = most recent meaningful low

Range/unknown handling:

- A break from range should not be called CHOCH.
- If range breaks upward, prefer `bos_bullish` only if enough swing sequence exists; otherwise set bias bullish with event `none` or a lower-confidence `bos_bullish` with reason `range_break_initial_bias`.
- If range breaks downward, same for bearish.

This is the only planned exception to the normal BOS prior-bias rule. In this exception, the event must carry reason `range_break_initial_bias`, confidence should be capped at medium, and trader wording should say "range expansion" or "initial structure break" rather than implying an established trend continuation.

## Step 10: Detect Liquidity Sweeps

High sweep:

- latest high takes a relevant prior swing high by tolerance
- latest close returns below that swing high + tolerance
- no close-confirmed bullish break

Output:

- `liquidity_sweep_high`
- sweptSwing = high
- biasAfter usually unchanged
- confirmation `wick_only`
- trader line says no confirmed breakout yet

Low sweep:

- latest low takes a relevant prior swing low by tolerance
- latest close returns above that swing low - tolerance
- no close-confirmed bearish break

Output:

- `liquidity_sweep_low`
- sweptSwing = low
- biasAfter unchanged
- confirmation `wick_only`

Sweep priority:

- If a valid CHOCH/BOS close exists, choose BOS/CHOCH.
- If wick-only, choose sweep.

Relevant swing selection:

1. Prefer the nearest active external swing high/low in the current prior structure.
2. If no external swing exists, use nearest internal swing with lower confidence.
3. Do not flag sweeps of stale, distant swings unless they are also the active range/session extreme.
4. Include the selected swing id in the debug reasons.

## Step 11: Detect Failed Breaks

Failed break high:

- one of the last 1-3 candles closed above a structural high
- latest close is back below that level
- no follow-through confirmation occurred

Output:

- `failed_break_high`
- biasAfter unchanged or range depending context
- confidence medium if break was close-confirmed and failed quickly

Failed break low:

- one of last 1-3 candles closed below structural low
- latest close is back above that level
- no follow-through confirmation occurred

Output:

- `failed_break_low`

This can be implemented in v1 after sweeps. If time is limited in a single run, implement sweeps first and add failed break tests as pending or skipped only if necessary. Prefer implementing both.

## Step 12: Event Priority Order

When multiple detections are possible, choose one latest event by this priority:

1. CHOCH
2. BOS
3. failed break
4. liquidity sweep
5. none

Reason:

- CHOCH changes bias.
- BOS confirms continuation.
- Failed break and sweep are warning/context events.

If two events have same priority, choose the one involving external swing over internal swing.

## Step 13: Confidence Scoring

Start score at `0.25`.

Add:

- `+0.2` if event broke external swing
- `+0.12` if event broke internal swing
- `+0.15` for displacement confirmation
- `+0.18` for follow-through confirmation
- `+0.1` if current bias was already well-defined
- `+0.08` if 24+ candles
- `+0.08` if 6+ swings
- `+0.08` if protected level was explicit HL/LH

Subtract:

- `-0.2` if fallback internal-only structure
- `-0.15` if range/unknown before event
- `-0.15` if break only barely exceeds tolerance
- `-0.12` if equal highs/lows dominate recent structure

Clamp 0.05 to 0.95.

Labels:

- high: `>= 0.72`
- medium: `>= 0.45`
- low: `< 0.45`

## Step 14: Trader Lines

Add `buildFormalStructureTraderLine`.

Examples:

- `5m structure printed bullish BOS above 2.50; 2.31 is the protected structure low.`
- `5m structure printed bearish BOS below 1.92; 2.08 is the protected structure high.`
- `5m structure printed bearish CHOCH below 2.31; buyers need a reclaim to repair the setup.`
- `5m structure printed bullish CHOCH above 2.08; holding above the reclaimed area keeps repair cleaner.`
- `5m structure swept the high near 3.10 but did not confirm a breakout.`
- `5m structure swept the low near 1.84 but reclaimed back inside the range.`

Avoid:

- buy/sell instructions
- "best entry"
- "safe"
- short-side advice phrasing

## Step 15: Build The Main Pure Function

Export:

```ts
export function buildFormalMarketStructureContext(
  request: BuildFormalMarketStructureRequest,
): FormalMarketStructureContext
```

Main flow:

1. Normalize symbol.
2. Parse as-of timestamp.
3. Sort and filter candles.
4. Return insufficient context if candles < minCandles.
5. Split `priorCandles` from the latest evaluation candle.
6. Build prior internal swings from `priorCandles`.
7. Build prior external swings from `priorCandles`.
8. Classify prior swings.
9. Determine prior bias.
10. Determine prior protected high/low and break targets.
11. Evaluate the latest candle/recent completed closes against prior structure.
12. Detect latest event by priority.
13. Rebuild display/debug swings from the full candle set if useful for output.
14. Calculate confidence.
15. Build trader line.
16. Return full context with debug reasons.

No network calls. No file IO.

## Step 16: Export From Structure Index

Update `src/lib/structure/index.ts`:

```ts
export {
  buildFormalMarketStructureContext,
  type BuildFormalMarketStructureRequest,
  type FormalMarketStructureContext,
  type FormalStructureEvent,
  type FormalStructureEventType,
  type FormalStructureBias,
  type FormalStructureSwing,
  type FormalSwingLabel,
  type FormalSwingScope,
  type FormalBreakConfirmation,
} from "./formal-market-structure.js";
```

Update `src/lib/support-resistance/index.ts` similarly so public/shared consumers can import it through the existing package surface.

## Step 17: Add Formal Engine Unit Tests

Create `src/tests/formal-market-structure.test.ts`.

Use deterministic candle builders similar to existing market-structure tests:

- `candlesFromCloses`
- `candlesFromRanges`

Required tests:

1. `detects bullish BOS above prior structural high`
   - Build bullish sequence with HH/HL.
   - Last close above structural high.
   - Assert event `bos_bullish`, bias `bullish`, confirmation at least `close_confirmed`.

2. `detects bearish BOS below prior structural low`
   - Build bearish sequence with LL/LH.
   - Last close below structural low.
   - Assert `bos_bearish`.

3. `detects bearish CHOCH when bullish protected low fails`
   - Build bullish sequence.
   - Last close below latest HL/protected low.
   - Assert `choch_bearish`, bias `bearish_transition`.

4. `detects bullish CHOCH when bearish protected high breaks`
   - Build bearish sequence.
   - Last close above latest LH/protected high.
   - Assert `choch_bullish`, bias `bullish_transition`.

5. `detects high liquidity sweep without BOS`
   - Wick above high, close below.
   - Assert `liquidity_sweep_high`, confirmation `wick_only`.

6. `detects low liquidity sweep without BOS`
   - Wick below low, close above.
   - Assert `liquidity_sweep_low`.

7. `does not count tiny tolerance break as BOS`
   - Close barely above level but inside tolerance.
   - Assert not `bos_bullish`.

8. `reports insufficient data safely`
   - Fewer than min candles.
   - Assert bias `unknown`, event `none`, diagnostic.

9. `equal highs do not over-flip structure`
   - Multiple near-equal highs.
   - Assert labels include `EH` or no false BOS.

10. `follow-through confirmation upgrades break quality`
   - Two closes beyond level.
   - Assert confirmation `follow_through_confirmed`.

## Step 18: Live Formal Tracker

Add `src/lib/monitoring/live-formal-market-structure.ts`.

This should mirror `LiveStableMarketStructureTracker` but call `buildFormalMarketStructureContext`. It must also carry the prior-state/dedupe behavior described earlier in this document.

Critical live-candle rule:

- Confirmed formal BOS/CHOCH/sweep/failed-break decisions must run on completed 5m candles only.
- The active `currentCandle` may be used for debug, candidate state, or readiness output, but it must not produce a confirmed formal event unless the implementation explicitly introduces a separate `candidateEventType`.
- In v1, avoid `candidateEventType`; keep confirmed formal events completed-candle-only.
- This means live tracker recomputation should maintain two views:
  - confirmed formal context from `completedCandles`;
  - optional debug/latest display context from `[...completedCandles, currentCandle]`.
- Only the confirmed context should drive `formalStructureMaterialChange`, Discord structure lines, and alert metadata event fields.

Types:

```ts
export type LiveFormalMarketStructureTrackerOptions = {
  bucketMs?: number;
  minCandles?: number;
  maxCandles?: number;
  options?: FormalMarketStructureOptions;
};
```

Runtime context:

Add to `monitoring-types.ts`:

```ts
export type FormalMarketStructureRuntimeContext = {
  timeframe: FormalStructureTimeframe;
  bias: FormalStructureBias;
  previousBias: FormalStructureBias | null;
  eventType: FormalStructureEventType;
  confirmation: FormalBreakConfirmation;
  confidence: FormalStructureConfidenceLabel;
  confidenceScore: number;
  materialChange: boolean;
  brokenSwingPrice?: number;
  sweptSwingPrice?: number;
  protectedHigh?: number;
  protectedLow?: number;
  latestHigh?: number;
  latestLow?: number;
  swingSequence: FormalSwingLabel[];
  structureKey: string;
  traderLine?: string;
  debug: {
    candleCount: number;
    reasons: string[];
  };
};
```

Material change rules:

- true if event type is BOS or CHOCH and the accepted event key is new
- true if liquidity sweep occurs at high confidence and the accepted event key is new
- false for `none`

Do not set `materialChange=true` repeatedly for the same event key on repeated ticks or repeated recomputes of the same completed candle.

Structure key:

```ts
`${timeframe}|${bias}|${eventType}|broken:${priceOrNone}|protected:${protectedLowOrHigh}|seq:${lastFourLabels}`
```

## Step 19: Integrate Into Watchlist Monitor

Update `src/lib/monitoring/watchlist-monitor.ts`.

Add:

```ts
private readonly formalMarketStructureTracker = new LiveFormalMarketStructureTracker();
```

Reset on symbol removal:

```ts
this.formalMarketStructureTracker.reset(symbol);
```

Update on price:

```ts
symbolState.formalMarketStructure = this.formalMarketStructureTracker.update(update);
```

Do this right after stable market structure update so both contexts are available to event detection.

## Step 20: Add Monitoring Types And Event Context Fields

Update `SymbolMonitoringState`:

```ts
formalMarketStructure?: FormalMarketStructureRuntimeContext;
```

Update `MonitoringEventContext`:

```ts
formalStructureBias?: FormalStructureBias;
formalStructurePreviousBias?: FormalStructureBias | null;
formalStructureEventType?: FormalStructureEventType;
formalStructureConfirmation?: FormalBreakConfirmation;
formalStructureConfidence?: FormalStructureConfidenceLabel;
formalStructureConfidenceScore?: number;
formalStructureMaterialChange?: boolean;
formalStructureBrokenSwingPrice?: number;
formalStructureSweptSwingPrice?: number;
formalStructureProtectedHigh?: number;
formalStructureProtectedLow?: number;
formalStructureLatestHigh?: number;
formalStructureLatestLow?: number;
formalStructureSwingSequence?: FormalSwingLabel[];
formalStructureKey?: string;
formalStructureTraderLine?: string;
formalStructureDebugReasons?: string[];
```

Update `event-detector.ts`:

- read `const formalMarketStructure = symbolState.formalMarketStructure`
- attach all fields in both zone-context and no-zone-context branches

## Step 21: Alert/Discord Types

Update `src/lib/alerts/alert-types.ts` metadata:

```ts
formalStructureBias?: FormalStructureBias;
formalStructurePreviousBias?: FormalStructureBias | null;
formalStructureEventType?: FormalStructureEventType;
formalStructureConfirmation?: FormalBreakConfirmation;
formalStructureConfidence?: FormalStructureConfidenceLabel;
formalStructureConfidenceScore?: number;
formalStructureMaterialChange?: boolean;
formalStructureBrokenSwingPrice?: number;
formalStructureSweptSwingPrice?: number;
formalStructureProtectedHigh?: number;
formalStructureProtectedLow?: number;
formalStructureLatestHigh?: number;
formalStructureLatestLow?: number;
formalStructureSwingSequence?: FormalSwingLabel[];
formalStructureKey?: string;
```

## Step 22: Trader Language Integration

Update `src/lib/alerts/trader-message-language.ts`.

Add a new helper:

```ts
function deriveFormalStructureLine(event: MonitoringEvent): string | null
```

Behavior:

- If `event.eventContext.formalStructureTraderLine` exists and confidence is not low, return it prefixed with `market structure:`.
- If formal event is high-confidence BOS/CHOCH, prefer it over practical structure.
- If formal event is low confidence, keep current practical/stable line.
- If formal event is sweep, include it only if `formalStructureMaterialChange` is true or event type is directly relevant.

Priority in `deriveTraderMarketStructureContext`:

1. high/medium confidence formal CHOCH
2. high/medium confidence formal BOS
3. high confidence formal sweep/failed break
4. material stable candle structure
5. practical trade structure
6. event-type fallback wording

Labels:

- BOS bullish/bullish CHOCH => `bullish_building` or `repaired`
- BOS bearish/bearish CHOCH => `damaged`
- sweeps/failed breaks => `weakening`

## Step 23: Discord Payload Output

Normal output:

- Let the existing `marketStructure` line flow into the new visible `Structure:` section already added in `alert-router.ts`.
- Ensure formal line gets into `alert.marketStructure.line`.

Debug output:

Reuse `MARKET_STRUCTURE_DISCORD_DEBUG=1`.

Add formal details to `Structure details:`:

- formal bias
- previous bias
- event type
- confirmation
- confidence
- broken swing
- swept swing
- protected high/low
- latest high/low
- sequence
- structure key

Keep stable details too. The debug section can show both stable and formal reads.

Suggested format:

```text
Structure details:
- formal=bias bullish; event bos_bullish; confirmation displacement_confirmed; confidence high 0.82
- formal levels=broken 2.50; protected low 2.31; latest high 2.50; latest low 2.31
- formal sequence=HL -> HH -> HL -> BOS
- stable=state breakout_holding; raw breakout_attempt; reason high_materiality_change
```

## Step 24: Alert Metadata

Update `formatIntelligentAlertAsPayload` in `alert-router.ts` so all formal fields are copied into metadata.

Do not rely only on visible body text. Metadata is important for audits/replays.

## Step 25: Tests For Runtime Integration

Create `src/tests/live-formal-market-structure.test.ts`.

Tests:

1. Waits for enough 5m candles before producing context.
2. Produces bullish BOS context after breakout sequence.
3. Produces bearish CHOCH context after protected low fails.
4. Preserves unknown/no-event when movement is inside tolerance.

Update `watchlist-monitor.test.ts`:

- Add assertion that emitted event context includes formal fields after enough buckets.
- Assert `formalStructureEventType` is string.
- Assert `formalStructureBias` is string.
- Assert `formalStructureKey` is string.

Update `alert-router.test.ts`:

- Test normal Discord body shows formal BOS/CHOCH in `Structure:`.
- Test debug flag shows formal details.
- Test low-confidence formal structure does not override practical wording.

Update `market-structure-language.test.ts`:

- Add direct tests for formal line priority.

## Step 26: Calibration Report

After engine integration, add a replay/calibration report if time remains.

File:

- `src/lib/review/formal-market-structure-calibration-report.ts`
- `src/scripts/run-formal-market-structure-calibration-report.ts`
- `src/tests/formal-market-structure-calibration-report.test.ts`

Inputs:

- cached 5m candles from warehouse/cache
- optional Discord audit rows

Report per symbol:

- total BOS events
- total CHOCH events
- sweeps
- failed breaks
- low-confidence events
- event-to-follow-through reaction
- noisy/tiny breaks filtered
- examples of questionable structure

Markdown output:

```md
# Formal Market Structure Calibration Report

- symbols reviewed:
- BOS bullish:
- BOS bearish:
- CHOCH bullish:
- CHOCH bearish:
- sweeps:
- failed breaks:
- watch cases:

## Watch Cases
...
```

This report is useful but not required for first implementation if core tests and Discord integration are done.

## Step 27: Build And Test Commands

Run these focused tests after implementation:

```powershell
npx tsx --test src/tests/formal-market-structure.test.ts src/tests/live-formal-market-structure.test.ts src/tests/market-structure-language.test.ts src/tests/alert-router.test.ts src/tests/watchlist-monitor.test.ts src/tests/candle-market-structure.test.ts src/tests/stable-market-structure.test.ts src/tests/live-stable-market-structure.test.ts
```

Run build:

```powershell
npm run build
```

If those pass, optionally run:

```powershell
npm test
```

If full `npm test` is too slow or blocked by unrelated existing repo state, report that focused tests and build passed, and name the blocker.

## Step 28: Acceptance Criteria

Implementation is complete when:

1. `buildFormalMarketStructureContext` exists and is exported.
2. Formal types accept `5m`, `4h`, and `daily`, even if only live `5m` is wired in v1.
3. Unit tests prove BOS bullish, BOS bearish, CHOCH bullish, CHOCH bearish, sweeps, tolerance filtering, and insufficient data behavior.
4. BOS/CHOCH tests prove events are classified against prior structure, not structure derived from the event candle.
5. Live tracker produces formal runtime context from live ticks using completed 5m candles for confirmed events.
6. Live tracker dedupes repeated material events by formal event key.
7. Watchlist monitor attaches formal structure fields to emitted events.
8. Alert/trader language can prefer high-confidence formal BOS/CHOCH.
9. Discord payload normal body can show formal structure in `Structure:`.
10. Debug mode can show formal details under `Structure details:`.
11. Metadata carries formal structure fields for audit/replay.
12. Focused tests pass.
13. `npm run build` passes.

## Step 29: Implementation Checklist

Use this checklist in order.

- [ ] Add `src/lib/structure/formal-market-structure.ts`
- [ ] Confirm current market-structure engine is 5m-only and keep wording explicit as 5m/intraday structure
- [ ] Design formal output so 4h/daily contexts can be added without changing the public contract
- [ ] Add `FormalStructureTimeframe = "5m" | "4h" | "daily"` even though v1 live runtime only wires `5m`
- [ ] Add formal types
- [ ] Add `timeframe` to pure context, runtime context, swing objects, swing IDs, and structure keys
- [ ] Default omitted request timeframe to `5m`
- [ ] Keep v1 default pivot/tolerance settings scoped to 5m and leave explicit override path for 4h/daily
- [ ] Add candle sorting/filtering helpers
- [ ] Add internal pivot detection
- [ ] Add external pivot detection
- [ ] Add swing classification labels
- [ ] Add bias derivation
- [ ] Add protected high/low derivation
- [ ] Add break confirmation logic
- [ ] Ensure BOS/CHOCH detection uses prior bias/protected levels from pre-event candles
- [ ] Add BOS detection
- [ ] Add CHOCH detection
- [ ] Add liquidity sweep detection
- [ ] Add failed break detection
- [ ] Add confidence scoring
- [ ] Add trader line generation
- [ ] Export formal engine from `src/lib/structure/index.ts`
- [ ] Export formal engine from `src/lib/support-resistance/index.ts`
- [ ] Add `src/tests/formal-market-structure.test.ts`
- [ ] Add `src/lib/monitoring/live-formal-market-structure.ts`
- [ ] Ensure live formal tracker confirms events from completed 5m candles only
- [ ] Ensure live formal tracker dedupes repeated material events by accepted event key
- [ ] Add formal runtime types to `monitoring-types.ts`
- [ ] Wire tracker into `watchlist-monitor.ts`
- [ ] Attach formal fields in `event-detector.ts`
- [ ] Add alert metadata fields
- [ ] Add formal structure priority in `trader-message-language.ts`
- [ ] Extend debug output in `alert-router.ts`
- [ ] Add `src/tests/live-formal-market-structure.test.ts`
- [ ] Update `watchlist-monitor.test.ts`
- [ ] Update `market-structure-language.test.ts`
- [ ] Update `alert-router.test.ts`
- [ ] Run focused tests
- [ ] Run `npm run build`
- [ ] Summarize changed files and remaining calibration risks

## Step 30: Known Risks And How To Handle Them

Risk: Too many BOS events in choppy small-cap ranges.
Mitigation: Use close-confirmed tolerance, external swings, confidence penalties for range/unknown bias, and debug calibration.

Risk: CHOCH flips too early on one candle.
Mitigation: CHOCH requires protected high/low break by close. Bias becomes transitional first, not full opposite trend.

Risk: Wick sweeps are mistaken for BOS.
Mitigation: Wick-only events become sweeps, not BOS.

Risk: Internal structure overwhelms external structure.
Mitigation: Prefer external swings for BOS/CHOCH. Internal-only breaks receive lower confidence.

Risk: Discord becomes noisy.
Mitigation: Normal posts show one concise line. Full internals require `MARKET_STRUCTURE_DISCORD_DEBUG=1`.

Risk: Formal engine conflicts with existing stable structure.
Mitigation: They are separate contexts. Existing stable layer remains for post budget/noise suppression. Formal layer is explicit diagnosis.

Risk: Old tests expect previous structure line wording.
Mitigation: Only high/medium-confidence formal BOS/CHOCH should override current market structure line. Low-confidence formal output should preserve existing wording.

## Step 31: Recommended First Commit Scope

If implementing in one run, keep the first commit focused on:

- pure formal engine
- live formal tracker
- event context fields
- Discord normal/debug output
- tests

Avoid adding calibration report in the same first commit unless all core work is already passing. Calibration is valuable but secondary.

## Final Product Behavior

After implementation, a normal Discord alert could show:

```text
ALBT breakout

Price is above resistance for now.

What it means:
- price is pushing farther above the zone high and follow-through is building (1.1%)
- price cleared resistance instead of stalling underneath it
- open room into next resistance 2.82 (+12.0%)

Structure:
- 5m structure printed bullish BOS above 2.50; 2.31 is the protected structure low

What to watch:
- hold above 2.50
- invalidation: back below 2.40
```

With `MARKET_STRUCTURE_DISCORD_DEBUG=1`:

```text
Structure details:
- formal=bias bullish; event bos_bullish; confirmation displacement_confirmed; confidence high 0.82
- formal levels=broken 2.50; protected low 2.31; latest high 2.50; latest low 2.31
- formal sequence=HL -> HH -> HL -> BOS
- stable=state breakout_holding; raw breakout_attempt; reason high_materiality_change
```

This gives enough visible output to test whether the engine is calling structure correctly, while keeping production posts readable when debug mode is off.
