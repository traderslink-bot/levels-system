# Candle Market Structure Engine Plan

## What This File Is For

This file is the implementation plan for the next meaningful market-structure upgrade in `levels-system`.

It exists so future Codex work can continue from a clear design instead of re-discovering the same product intent. The goal is to build a real candle-based 5-minute market-structure module that can be used by both:

- this Discord/watchlist app
- `trader-intelligence-v2` through the shared support/resistance engine boundary

The module should produce structured facts first. It should not create new standalone Discord post streams by default.

## Implementation Status

First implementation completed on 2026-05-02.

Shipped:

- pure module at `src/lib/structure/candle-market-structure.ts`
- public export through `levels-system-phase1/support-resistance-engine`
- `marketStructure` returned from full symbol context, direct candle-array context, and single-timeframe context
- 1m single-timeframe context aggregates into 5m before structure analysis and marks diagnostics as `derived_from_1m`
- tests in `src/tests/candle-market-structure.test.ts`
- shared API coverage in `src/tests/support-resistance-shared-api.test.ts`
- replay audit at `src/lib/review/market-structure-replay-audit.ts`
- CLI script `npm run structure:replay`
- replay output under `artifacts/market-structure-replay`
- stable smoothing/materiality module at `src/lib/structure/stable-market-structure.ts`
- raw-vs-stable transition comparison in the replay audit
- saved Discord / stable-structure alignment audit at `src/lib/review/stable-structure-discord-alignment.ts`
- CLI command `npm run structure:discord-align`
- optional stable 5m structure metadata on alert payloads, Discord delivery audit rows, and replay simulation
- live post-policy materiality support for stable 5m structure when runtime/audit rows provide it
- live runtime bridge at `src/lib/monitoring/live-stable-market-structure.ts`
- `WatchlistMonitor` now buckets live ticks into 5-minute candles and attaches stable market-structure metadata to emitted monitoring events after enough live candles exist
- guarded trader-facing wording in `src/lib/alerts/trader-message-language.ts` for material stable 5m structure changes
- language boundary coverage in `src/tests/market-structure-language.test.ts`

Still intentionally not shipped:

- standalone market-structure Discord posts
- trader-visible 5m structure wording for unchanged or low-confidence states

The current shipped support is intentionally metadata-first. It does not create market-structure posts. Live runtime now supplies stable 5m structure fields after enough buckets exist, so the existing post policy can use candle-backed structure materiality without adding a new Discord surface. Existing alerts can now include a short 5m structure line only when the stable candle structure changed materially or the first stable read is available with acceptable confidence.

First replay audit result:

```text
npm run structure:replay -- --max-files-per-symbol 2
```

Scanned 56 cached 5m files across 37 symbols.

Latest-state summary:

```text
pullback_to_structure: 17
range_bound: 10
trend_damaged: 8
reclaim_confirmed: 6
pressing_range_high: 6
trend_intact: 5
base_building: 2
failed_breakout: 1
pivot_lost: 1
```

The first raw replay flagged high state-transition counts for symbols including `AKAN`, `FATN`, `HCAI`, `PBM`, and `SAGT`.

Smoothing/materiality was added after that first replay. The same command now reports:

```text
high raw-transition cases: 10
high stable-transition cases: 0
average transition reduction: 60.1%
```

This means stable market structure is a better candidate for later Discord post-policy testing than raw market structure. It still should not be made trader-facing until it is compared against actual Discord post sequences.

Saved Discord alignment audit result:

```text
npm run structure:discord-align -- --limit all
```

Scanned 10,472 posted Discord rows across 97 saved audit files.

```text
aligned rows: 7,136
same-structure repeat posts: 4,531
stable transition posts: 831
raw-chop suppressed candidates: 632
```

This confirms that stable market structure is useful as an audit signal for post-noise review. Many saved posts repeated while stable 5m structure did not materially change. The next step is not to post market-structure text live; it is to let runtime supply stable structure metadata so live post policy can use the stable structure state as one more suppression/materiality input for repeated level flicker.

Follow-up policy pass completed:

- `MonitoringEventContext`, `AlertPayload.metadata`, Discord audit rows, and replay audit entries can carry stable 5m structure state, key, confidence, materiality score, and material-change flags.
- `decideIntelligentAlertPost(...)` treats unchanged stable range/base structure as one more reason to respect structure budgets.
- Material stable transitions can let a fresh story through even when price is still near the same practical area.
- `discord-audit-reports` now has a stable 5m market-structure evidence section when current/future audit rows contain the metadata.

Live runtime bridge completed:

- `LiveStableMarketStructureTracker` turns live price updates into 5-minute OHLCV candles per symbol.
- The tracker computes stable 5m structure from the live candle stream after at least 12 5-minute buckets.
- `WatchlistMonitor` stores the latest stable structure on `SymbolMonitoringState`.
- `event-detector` copies stable state, previous state, structure key, confidence, materiality score, and material-change flag into each emitted monitoring event.
- The tracker is exported through `levels-system-phase1/support-resistance-engine` for shared consumers that need the same runtime bridge.

Trader-facing wording pass completed:

- `deriveTraderMarketStructureContext(...)` can translate stable 5m candle states into calm trader-facing lines.
- Low-confidence stable structure is ignored for Discord wording.
- Unchanged stable structure is ignored for Discord wording unless it is the first stable read.
- Material stable 5m changes can override stale practical-range wording so the alert does not keep telling the old range story after candle structure changes.
- Wording remains long-biased and observational: no standalone volume/structure calls, no short setup framing, and no direct buy/sell/entry/exit instructions.
- Focused validation:

```text
npx tsx --test src/tests/market-structure-language.test.ts src/tests/alert-router.test.ts src/tests/alert-intelligence.test.ts src/tests/live-thread-post-policy.test.ts src/tests/watchlist-monitor.test.ts
```

Result: 85 passing, 0 failing.

Thread-story replay hardening completed:

- `deriveThreadStoryPhase(...)` now uses support/resistance side when practical structure metadata is unavailable, so saved-data replay and older audit rows can classify resistance touches as `pressing_resistance` instead of generic support testing.
- `decideThreadStoryPhasePost(...)` now separates useful phase progression from same-area phase churn. Range/base -> pressure -> breakout/hold can still post, but cycling backward inside the same practical area is suppressed unless price expands, structure materially changes, or the move is major.
- `live-post-replay-simulator` now reports `threadStorySuppressions` in totals and per-symbol rows, making the audit prove how much post reduction came from same-area story control.
- `all-symbol-stress-report` now carries the same thread-story suppression count into broad saved-data audits.
- Focused validation:

```text
npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/live-post-replay-simulator.test.ts src/tests/all-symbol-stress-report.test.ts
npm run stress:all-symbols
npm run scenario:smallcap
```

Latest broad saved-data result:

```text
all-symbol stress: 5,075 original posts -> 2,030 simulated posts
reduction: 60.0%
thread-story suppressions: 12
still-noisy symbols: 9
CYCU latest high-activity saved session: 31 -> 5
```

Important limitation: many old saved audit rows predate practical/stable structure metadata, so the thread-story suppression count is conservative. New live rows should carry richer structure keys and give this gate more evidence.

## Product Goal

Build a real 5-minute candle-based market-structure read that answers:

- What is the current 5m structure?
- What are the confirmed swing highs and swing lows?
- Is price making higher lows or lower highs?
- Is price range-bound, building, breaking out, failing, or reclaiming?
- Which pivot matters right now?
- Is trend structure intact or damaged?
- How confident is the read?

The output should help traders understand the trade story while avoiding direct trade advice and avoiding extra Discord noise.

## Non-Goals

Do not:

- create standalone market-structure Discord posts in v1
- frame anything as a short setup
- tell traders to buy, sell, enter, exit, trim, or wait
- fake structure when candle data is insufficient
- let one-cent small-cap flickers become structure changes
- replace support/resistance levels with market-structure guesses
- weaken the existing support/resistance engine

## New Module Shape

Add:

```text
src/lib/structure/
  candle-market-structure.ts
  index.ts
```

This module should be pure TypeScript:

- no Discord
- no OpenAI
- no runtime watchlist state
- no provider-specific code
- no filesystem access

It should accept normalized candles and return deterministic structure output.

## Input Contract

Suggested input:

```ts
type BuildCandleMarketStructureRequest = {
  symbol: string;
  candles: Candle[];
  timeframe?: "5m";
  asOfTimestamp?: number | string | Date;
  currentPrice?: number;
  options?: CandleMarketStructureOptions;
};
```

`candles` should normally be 5-minute candles sorted or sortable by timestamp.

When used from a 1-minute shared path, aggregate 1m into 5m first and mark diagnostics as derived from 1m.

## Output Contract

Suggested output:

```ts
type CandleMarketStructureContext = {
  symbol: string;
  timeframe: "5m";
  asOfTimestamp: number | null;
  state: CandleMarketStructureState;
  confidence: CandleMarketStructureConfidence;
  pivots: CandleMarketStructurePivots;
  trend: CandleMarketStructureTrend;
  range: CandleMarketStructureRange | null;
  pivotEvent: CandleMarketStructurePivotEvent | null;
  traderLine?: string;
  diagnostics: CandleMarketStructureDiagnostic[];
};
```

Suggested state union:

```ts
type CandleMarketStructureState =
  | "insufficient_data"
  | "range_bound"
  | "base_building"
  | "pressing_range_high"
  | "breakout_attempt"
  | "breakout_holding"
  | "failed_breakout"
  | "pullback_to_structure"
  | "higher_lows_intact"
  | "trend_intact"
  | "trend_damaged"
  | "pivot_lost"
  | "reclaim_attempt"
  | "reclaim_confirmed";
```

Long-biased wording rule:

- Say `trend damaged`, `pivot lost`, `setup needs repair`, or `needs reclaim`.
- Do not say `short setup`, `sell signal`, or downside-target wording.

## Step 1. Confirmed Swing Highs And Swing Lows

Detect confirmed pivots from 5m candles.

Initial rule:

```text
leftBars = 2
rightBars = 2
```

A swing high is confirmed when its high is higher than the highs of the left/right confirmation windows.

A swing low is confirmed when its low is lower than the lows of the left/right confirmation windows.

Suggested pivot type:

```ts
type CandleStructurePivot = {
  id: string;
  kind: "swing_high" | "swing_low";
  price: number;
  timestamp: number;
  index: number;
  strength: number;
  confirmed: true;
};
```

Pivot strength should consider:

- how far price moved away after the pivot
- local candle range around the pivot
- whether the pivot is distinct from nearby pivots
- volume later, if reliable

## Step 2. Higher-Low / Lower-High Read

Use confirmed pivots to derive:

- higher lows
- lower highs
- higher highs
- lower lows

Suggested trend output:

```ts
type CandleMarketStructureTrend = {
  direction: "building" | "fading" | "uptrend" | "damaged" | "range" | "unknown";
  higherLowCount: number;
  lowerHighCount: number;
  higherHighCount: number;
  lowerLowCount: number;
  latestHigherLow?: CandleStructurePivot;
  latestLowerHigh?: CandleStructurePivot;
};
```

Important:

- `damaged` means long-side structure is weakened.
- Do not call it a short setup.

## Step 3. Range High / Range Low

Detect active ranges from recent confirmed pivots and recent candle highs/lows.

A useful range should have:

- repeated interaction near the high or low
- enough width to matter
- enough rotations to avoid calling one noisy candle a range

Suggested range output:

```ts
type CandleMarketStructureRange = {
  active: boolean;
  high: number;
  low: number;
  widthPct: number;
  touchCountHigh: number;
  touchCountLow: number;
  quality: "clean" | "loose" | "choppy";
};
```

Use practical small-cap tolerance. A $0.01 flicker on a low-priced stock should not create a new structure state.

This is critical for CYCU/PBM-style overposting problems.

## Step 4. Reclaim / Loss Of Pivot

Detect pivot events from candle closes, not single prints.

Examples:

- reclaim: price lost a pivot and then closes back above it
- pivot loss: price closes below a meaningful swing low or range low
- failed reclaim: price briefly pushes above a pivot but closes back below

Suggested output:

```ts
type CandleMarketStructurePivotEvent = {
  type: "reclaim" | "loss" | "failed_reclaim" | "none";
  pivot?: CandleStructurePivot;
  triggerPrice?: number;
  confirmation: "early" | "confirmed";
};
```

Use closes to reduce false structure shifts from tiny wick-through moves.

## Step 5. Trend Intact Vs Trend Damaged

Combine:

- pivots
- higher lows / lower highs
- range state
- pivot events
- current price

Then classify current structure.

Examples:

```text
higher_lows_intact
trend_intact
trend_damaged
pivot_lost
reclaim_attempt
reclaim_confirmed
range_bound
base_building
```

Trader-facing meaning:

- `higher_lows_intact`: recent 5m pullbacks are holding above prior lows
- `trend_damaged`: the prior higher-low structure has been lost
- `pivot_lost`: price closed below a meaningful structure pivot
- `reclaim_attempt`: price is trying to repair lost structure

## Step 6. Structure Confidence

Confidence must be evidence-based.

Suggested output:

```ts
type CandleMarketStructureConfidence = {
  score: number; // 0 to 1
  label: "low" | "medium" | "high";
  reasons: string[];
};
```

Inputs:

- candle count
- confirmed pivot count
- pivot clarity
- range quality
- repeated higher-low evidence
- repeated lower-high evidence
- noise/chop penalty
- small-cap flicker penalty
- whether the latest close confirms the read

Examples:

```text
high: 4 confirmed higher lows and range high tested 3 times
medium: range is visible but pivots are choppy
low: only 8 candles and no confirmed pivots
```

## Step 7. Trader-Facing Summary Line

The module may produce one optional safe line:

```ts
traderLine?: string;
```

Examples:

```text
5m structure is building higher lows under 1.12 resistance.
```

```text
Price is still range-bound between 0.98 support and 1.06 resistance; small moves inside that range are lower-quality noise.
```

```text
The latest higher low is still intact; losing 1.03 would damage the 5m structure.
```

```text
Price reclaimed the prior pivot, but the reclaim still needs acceptance above 1.12.
```

Forbidden:

```text
buy
sell
best entry
should enter
should exit
short setup
downside target
guaranteed follow-through
```

## Step 8. Thread Into Shared API

Add market-structure context to:

```ts
buildSupportResistanceContextForSymbol
buildSupportResistanceContextFromCandles
buildSupportResistanceContextFromSingleTimeframeCandles
```

Suggested response field:

```ts
context.marketStructure
```

For full symbol context:

- build from fetched 5m candles
- if 5m unavailable, return `insufficient_data`

For direct candle-array context:

- build from supplied 5m candles

For single-timeframe 1m context:

- aggregate 1m into 5m first
- build market structure from aggregated candles
- diagnostic: `derived_from_1m`

## Step 9. Use Internally Without Adding Noise

Do not create standalone market-structure posts in v1.

Use market structure to:

- enrich existing alerts later
- improve initial snapshot context later
- suppress repeated range-bound noise
- improve audit explanations
- support `trader-intelligence-v2` structure review

## Step 10. Tests

Add:

```text
src/tests/candle-market-structure.test.ts
```

Cover:

- confirmed swing highs
- confirmed swing lows
- higher lows detected
- lower highs detected
- range-bound chop detected
- breakout attempt over range high
- failed breakout back into range
- pivot loss
- pivot reclaim
- confidence low with insufficient candles
- confidence high with clean repeated structure
- no short-side/direct-advice language
- 1m aggregated into 5m structure through shared API

Also extend:

```text
src/tests/support-resistance-shared-api.test.ts
```

Cover:

- symbol context includes `marketStructure`
- candle-array context includes `marketStructure`
- single-timeframe context includes `marketStructure`
- `asOfTimestamp` prevents future candles from affecting structure

## Step 11. Docs

Update:

```text
docs/15_PROJECT_CHANGE_LOG.md
docs/30_SIGNAL_QUALITY_ROADMAP.md
docs/51_SHARED_SUPPORT_RESISTANCE_ENGINE_BOUNDARY_2026-05-02.md
docs/52_TRADER_INTELLIGENCE_V2_SHARED_ENGINE_HANDOFF_2026-05-02.md
```

This file should remain the detailed implementation plan.

## Target Final Shape

After implementation, shared output should be able to expose:

```ts
context.marketStructure = {
  timeframe: "5m",
  state: "higher_lows_intact",
  confidence: {
    score: 0.78,
    label: "high",
    reasons: [
      "3 confirmed higher lows",
      "range low held twice"
    ]
  },
  pivots: {
    latestSwingHigh,
    latestSwingLow,
    confirmedHighs,
    confirmedLows
  },
  range: {
    active: true,
    low: 1.03,
    high: 1.12
  },
  trend: {
    direction: "building",
    higherLowCount: 3,
    lowerHighCount: 0
  },
  traderLine: "5m structure is building higher lows under 1.12 resistance."
};
```

## Acceptance Standard

This work is complete when:

- confirmed 5m pivots are calculated deterministically
- higher-low / lower-high structure is available
- range high / range low is available
- pivot reclaim/loss is available from closes
- trend intact/damaged state is available
- confidence and reasons are available
- shared APIs return `marketStructure`
- no new standalone Discord post category is created
- tests cover all core structure states
- docs explain the output and limitations

## Current Priority

This should be the next real market-structure upgrade after the shared engine handoff stabilizes.

It is more important than adding more live Discord wording because it gives the system a better structure brain first. Once the structure facts are reliable, trader-facing wording can use them carefully.

## 2026-05-02 Closed-Market Quality Update

After the initial market-structure implementation, this repo added supporting
closed-market tooling around trader-facing Discord quality:

- `npm run quality:posts` grades saved Discord posts for system language,
  advice-like phrasing, over-certainty, tiny small-cap risk wording,
  missing-level claims, and repeated story overlap.
- `npm run stress:all-symbols` now includes quiet-profile totals and a
  `Quiet-Mode Replay Attention` section.
- fast crossed/lost support/resistance bridge posts avoid `surfaced ladder`
  language and no longer frame one-cent low-priced moves as a fresh risk story.
- `docs/54_CLOSED_MARKET_POST_QUALITY_AND_MONDAY_CHECKLIST_2026-05-02.md`
  records the closed-market audit checklist.

This does not change the market-structure API itself. It improves the review
loop around how market-structure, support/resistance, and post-policy facts
eventually appear to traders.
