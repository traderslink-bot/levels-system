# Trader Intelligence Trade-Window Market Facts Contract

Date: 2026-05-04

This note is for the `levels-system` Codex agent.

Update: `docs/74_TRADER_INTELLIGENCE_LEVELS_BOUNDARY_HANDOFF_2026-05-04.md`
is the newer product direction. Use that file as the primary contract. The
important correction is that `trader-intelligence-v2` should not build
feedback around VWAP/EMA for now; it should use daily/4h support/resistance
for market-context feedback and 1m/5m candles only for trade-window movement
facts.

`trader-intelligence-v2` analyzes completed imported trades. It should not
build support/resistance, VWAP, EMA, candle storage, candle fetching, or market
structure locally. `levels-system` owns those market/candle facts and returns
neutral structured context that `trader-intelligence-v2` combines with P/L,
sizing, journaling, behavior, review, and coaching.

## Consumer Project

Consumer repo:

```text
C:\Users\jerac\Documents\TraderLink\trader-intelligence-v2
```

Current consumer bridge:

```text
src/lib/raw-trade-timeline/builders/create-raw-trade-timeline-with-levels-system-candles.ts
```

The bridge imports from:

```ts
import {
  buildTradeAnalysisCandleContext,
  buildDefaultTradeAnalysisCandleContext,
} from "levels-system-phase1/support-resistance-engine";
```

## Key Boundary

`levels-system` is the market/candle intelligence brain.

It should determine neutral facts such as:

- where the entry was relative to VWAP
- where the entry was relative to EMA9/EMA20
- whether the entry was near support
- whether the entry was near resistance
- whether the entry was below nearby support
- whether the entry cleared resistance and had room above
- whether the exit was near support/resistance
- whether the trade moved into resistance
- whether the trade lost support during the hold, if that fact is implemented
- max favorable move during the trade
- max adverse move during the trade
- post-exit continuation/relief using the requested trade-window candles
- whether 1m candles were used or 5m fallback was used
- whether historical intraday candles were missing, partial, stale, or truncated

`trader-intelligence-v2` should not calculate those from raw candles.

`trader-intelligence-v2` may decide how to interpret those facts in human
review language. For example:

- levels-system fact: entry was 0.4% below VWAP and near resistance
- trader-intelligence-v2 interpretation: this may have reduced entry quality
  when combined with the trader's outcome, hold behavior, and sizing

Do not put coaching or judgment in `levels-system`.

## Request Shape Expected By trader-intelligence-v2

`trader-intelligence-v2` sends completed trade executions/fills:

```ts
{
  symbol,
  sessionDate,
  asOfTimestamp,
  tradeStartTimestamp,
  tradeEndTimestamp,
  executions: [
    { timestamp, price, quantity, side },
  ],
  supportResistance: {
    lookbackBars,
    config,
    runtimeOptions,
  },
  tradeWindow: {
    timeframe: "1m",
    preTradeMinutes,
    postTradeMinutes,
    paddingMinutes,
  },
}
```

Important details:

- Every imported fill/execution is sent, not just entry and exit.
- `tradeStartTimestamp` and `tradeEndTimestamp` are derived from executions.
- If the caller does not provide `asOfTimestamp`, `trader-intelligence-v2`
  derives it as:

```text
tradeEndTimestamp + postTradeMinutes + paddingMinutes
```

This prevents future candles from leaking into old historical trade analysis.

## Response Fields trader-intelligence-v2 Consumes

The consumer expects these fields to exist and remain neutral:

```ts
{
  symbol,
  mode: "trade_analysis",
  candleFetchingOwnedBy: "levels-system",
  asOfTimestamp,
  tradeWindow: {
    timeframe,
    requestedTimeframe,
    fallbackUsed,
    requestedStartTimestamp,
    requestedEndTimestamp,
    tradeStartTimestamp,
    tradeEndTimestamp,
    dynamicLevels,
    allCandles,
    preTradeCandles,
    tradeCandles,
    postTradeCandles,
    fetch,
  },
  tradeWindowFacts,
  executionRelations,
  supportResistanceContext,
  diagnostics,
}
```

## Specific Facts Needed

### Dynamic Levels

`tradeWindow.dynamicLevels` should be based on the fetched historical
trade-window candles, preferably 1m and truthfully 5m if fallback was used.

Expected fields:

```ts
{
  vwap: number | null,
  ema9: number | null,
  ema20: number | null,
}
```

These are used by `trader-intelligence-v2` to know whether entry/exit happened
above or below VWAP/EMA. The consumer should not calculate VWAP/EMA.

### Execution Relations

Return one relation record for every execution/fill received.

Each relation should include:

```ts
{
  timestamp,
  timestampIso,
  price,
  quantity,
  side,
  levelRelations,
  dynamicLevelRelations,
  marketStructureState,
  marketStructureConfidence,
  diagnostics,
}
```

This is where levels-system should answer questions like:

- Was this fill above or below VWAP?
- How far was this fill from VWAP?
- How far was this fill from EMA9/EMA20?
- What was the nearest support below?
- What was the nearest resistance above?
- Was this fill near support?
- Was this fill near resistance?
- Was this fill below support?
- Was this fill above resistance?
- Did it have room to next resistance?

If a relation cannot be calculated, return `null` relation fields and
diagnostics explaining why.

### Support/Resistance Context

`supportResistanceContext` remains owned by `levels-system`.

It should provide the already-built levels and context that
`trader-intelligence-v2` maps into local read-only fields:

- reference levels
- support levels
- resistance levels
- gap structure if available
- market structure if available
- diagnostics

The consumer should not build pivots, levels, VWAP, EMA, or market structure
from its own raw candle arrays.

### Trade Window Facts

`tradeWindowFacts` should provide neutral facts around the completed trade
window.

Current consumed facts include:

```ts
{
  referenceExecutionTimestamp,
  referenceExecutionTimestampIso,
  referencePrice,
  referenceSide,
  highestHighDuringTrade,
  lowestLowDuringTrade,
  highestHighAfterExit,
  lowestLowAfterExit,
  maxFavorableMovePct,
  maxAdverseMovePct,
  postExitContinuationPct,
  postExitReliefPct,
}
```

These should be neutral measurements, not coaching.

Important unit note:

- `levels-system` currently returns move percentages as percent units.
- Example: `4.25` means `4.25%`.
- `trader-intelligence-v2` converts matching PatternInput fields to ratios
  where needed.

## Candle Data Requirement

This integration is for historical completed trades, not only live watchlist
analysis.

`levels-system` should be able to fetch/store the historical intraday candles
needed for the requested trade window:

- prefer 1m candles
- fall back to 5m if 1m is unavailable
- return truthful diagnostics when data is missing, partial, stale, or fallback
  was used

It is okay and useful for levels-system to return raw candles alongside neutral
facts so `trader-intelligence-v2` can chart evidence. But raw candles should
not force `trader-intelligence-v2` to recalculate VWAP, EMA, support,
resistance, or market structure.

## Diagnostics Needed

Please preserve explicit diagnostics for:

- 1m unavailable
- 5m fallback used
- missing pre-trade candles
- missing trade candles
- missing post-trade candles
- trade window truncated by asOfTimestamp
- provider warnings
- stale/partial/missing candle data
- execution relation skipped because an execution is after asOfTimestamp
- missing/invalid execution prices

These diagnostics let `trader-intelligence-v2` avoid overclaiming feedback.

## What levels-system Should Not Do

Do not return coaching language like:

- good entry
- bad entry
- chased
- disciplined
- poor decision
- should have sold

Instead return neutral market facts:

- entry was above/below VWAP
- entry was near resistance
- entry had X% room to next resistance
- entry was Y% above nearest support
- max favorable move was Z%
- 1m unavailable, 5m fallback used

`trader-intelligence-v2` owns the trader-facing interpretation.

## Verification Requested In levels-system

Please add or confirm tests proving:

- `buildDefaultTradeAnalysisCandleContext(...)` works for historical completed
  trade windows
- `buildTradeAnalysisCandleContext(...)` accepts every execution/fill
- explicit `tradeStartTimestamp`, `tradeEndTimestamp`, and `asOfTimestamp`
  bound the fetched candle window
- 1m is preferred
- 5m fallback is used and diagnosed when 1m is unavailable
- `tradeWindow.dynamicLevels` is returned
- `executionRelations` has one record per execution
- support/resistance/VWAP/EMA/market-structure facts are calculated in
  `levels-system`, not in `trader-intelligence-v2`
- no coaching/judgment text is emitted from this API

## Current Consumer Status

`trader-intelligence-v2` now consumes this API through
`createRawTradeTimelineWithLevelsSystemCandles(...)`.

Recent consumer verification passed:

```text
npx tsc --noEmit --pretty false
npm run verify:levels-system
npm test
```

The consumer side is ready for this contract as long as `levels-system` keeps
the response shape and semantics stable.

## Levels-System Implementation Note For Trader-Intelligence Codex

Added by levels-system Codex on 2026-05-04.

The important design decision is that `trader-intelligence-v2` should not pick
a different local calculation path based on whether a trade lasted 10 minutes,
1 hour, 5 hours, 12 hours, 23 hours, or 36 hours.

Use the same contract for every completed trade:

1. `levels-system` fetches one bounded trade window from:

```text
tradeStartTimestamp - preTradeMinutes - paddingMinutes
through
min(tradeEndTimestamp + postTradeMinutes + paddingMinutes, asOfTimestamp)
```

2. The requested trade-window timeframe remains `"1m"` by default. If 1m data
   is unavailable, `levels-system` explicitly falls back to `"5m"` and returns
   `tradeWindow.fallbackUsed = true` plus diagnostics. For long holds, do not
   add a separate trader-intelligence timeframe heuristic before calling
   levels-system. Let levels-system return the actual timeframe and
   diagnostics.

3. `executionRelations[]` are calculated independently for every fill. For each
   execution, dynamic VWAP/EMA facts use only candles with:

```text
candle.timestamp <= execution.timestamp
```

No candle after the execution may influence that execution's VWAP/EMA relation.

4. VWAP is session-scoped to the execution's own market session date. This
   matters for overnight and multi-day holds: a fill on day 2 should not use the
   day-1 VWAP just because `tradeStartTimestamp` was on day 1. EMA9/EMA20 are
   rolling dynamic levels over the available trade-window candle prefix through
   the execution timestamp.

5. Broader support/resistance context and execution-time level relations stay in
   levels-system. The top-level `supportResistanceContext` is the broader
   review context. Each execution relation is built from a support/resistance
   context requested as of that execution timestamp where available. If that
   execution-time context cannot be built, the relation returns null fields plus
   diagnostics instead of trader-facing judgment.

6. `tradeWindowFacts` may use the completed bounded window because those facts
   answer during-trade and post-exit questions: max favorable/adverse move,
   highest/lowest during the hold, and continuation/relief after exit.

The simple consumer rule is:

- Use `executionRelations` for what was knowable at each fill.
- Use `tradeWindowFacts` for what happened during and after the completed trade.
- Use `supportResistanceContext` for broader higher-timeframe market context.
- Do not recompute VWAP, EMA, levels, or market structure in
  `trader-intelligence-v2`.

## Chart Timeframe / VWAP Clarification

Important clarification from the user on 2026-05-04:

A trader may have been looking at a 1m, 5m, 15m, hourly, daily, or some other
chart when entering the trade. The VWAP shown on a trading platform can differ
depending on platform settings, chart aggregation, anchor/session behavior, and
whether the tool is using intraday bars or higher-timeframe bars.

`levels-system` therefore must not claim to know what the trader literally saw
on their chart unless `trader-intelligence-v2` sends that chart configuration in
the request.

For the current contract, define VWAP/EMA execution facts as canonical market
benchmarks, not trader-screen reconstruction:

- `executionRelations.dynamicLevelRelations.aboveVwap` means above/below
  `levels-system`'s canonical execution-time VWAP.
- Canonical execution-time VWAP uses the finest available trade-window candles,
  preferably 1m, and resets to the execution's own market session date.
- If 1m is unavailable and 5m fallback is used, VWAP/EMA facts are still
  returned, but `tradeWindow.timeframe`, `tradeWindow.fallbackUsed`, and
  diagnostics must make that lower-resolution evidence explicit.
- EMA9/EMA20 execution facts are rolling dynamic benchmarks over candles
  available through the execution timestamp.
- These facts are useful for consistent review, but they should be described as
  levels-system market facts, not guaranteed replicas of a trader's exact chart
  indicator.

If future `trader-intelligence-v2` work needs chart-specific reconstruction, add
an explicit request field rather than guessing. A simple future shape would be:

```ts
chartContext?: {
  primaryTimeframe?: "1m" | "5m" | "15m" | "1h" | "daily";
  vwapMode?: "session" | "anchored" | "platform_unknown";
}
```

Until such a field exists, `trader-intelligence-v2` should phrase any
interpretation as based on canonical levels-system facts, not as "the trader saw
price above/below VWAP on their chart."

## Product Decision: Do Not Make Traders Choose Indicator Basis

Important product clarification from the user on 2026-05-04:

The system should not require a trader, especially a newer trader, to know or
enter their exact chart timeframe before the review can be useful. Chart
timeframe may become an optional advanced setting later, but the default product
experience must work without it.

Therefore, the better default is not "guess the trader's chart." The better
default is "return a compact indicator evidence set with explicit basis
metadata."

Recommended levels-system direction:

1. Keep a canonical beginner-safe benchmark.

   Default canonical execution facts should use the finest reliable intraday
   candles available, preferably 1m, calculated only through the execution
   timestamp. This gives consistent market evidence without asking the trader to
   configure anything.

2. Add a small number of alternate benchmark facts, not every possible chart.

   Useful defaults for small-cap trade review:

   - regular-session VWAP, from 9:30 through execution
   - extended-session VWAP, from premarket through execution, when data exists
   - fast EMA facts on the finest available trade-window timeframe
   - optional coarser EMA facts such as 5m/15m only if/when levels-system can
     calculate them cleanly and label the basis

3. Every indicator fact must carry basis metadata.

   Facts should explain their basis structurally, for example:

   ```ts
   {
     value,
     above,
     distancePct,
     basis: {
       indicator: "vwap",
       timeframe: "1m",
       mode: "regular_session" | "extended_session",
       startTimestamp,
       endTimestamp,
       barsUsed,
       fallbackUsed,
       reliability: "reliable" | "thin" | "fallback" | "missing"
     }
   }
   ```

4. Trader-intelligence-v2 should turn this into simple review language.

   Beginner-friendly language should avoid platform-specific certainty:

   - Good: "Against the session VWAP benchmark, entry was slightly above VWAP."
   - Good: "Premarket-inclusive VWAP told a different story, so this was mixed
     indicator evidence."
   - Bad: "You were above the VWAP on your chart."

5. If benchmark facts disagree, that is useful evidence.

   Example: price above regular-session VWAP but below extended-session VWAP
   means the trade may have looked stronger on the regular-session benchmark
   while still being below the broader morning volume anchor. That should be
   returned as neutral mixed evidence, not collapsed into one forced verdict.

6. Optional future chart settings should be additive.

   If the trader later enters a preferred chart timeframe, levels-system can add
   chart-specific facts. But the default workflow must remain useful without
   that field.

Near-term implementation recommendation:

- Keep current canonical execution relations stable.
- Extend execution dynamic facts with explicitly named VWAP variants and basis
  metadata.
- Do not ask trader-intelligence-v2 to compute or infer these locally.

## Implementation Status: marketFacts V2 Additive Contract

Added by levels-system Codex on 2026-05-04 after reviewing
`docs/market-facts-contract-design.md`.

`buildTradeAnalysisCandleContext(...)` now returns a new additive top-level
field:

```ts
context.marketFacts
```

Existing fields remain for compatibility:

```ts
context.executionRelations
context.tradeWindowFacts
context.tradeWindow
context.supportResistanceContext
```

The first implemented `marketFacts` contract version is:

```ts
"market_facts.trade_review.v2"
```

The first implemented profile is:

```ts
"small_cap_day_trade_v1"
```

Implemented benchmark evidence:

- `regular_session_vwap_1m`
- `extended_session_vwap_1m`
- `ema9_1m`
- `ema20_1m`
- `nearest_support`
- `nearest_resistance`

Implemented enriched-profile evidence:

- `ema9_5m`
- `ema20_5m`

Important semantics:

- `marketFacts.executionSnapshots[]` has one snapshot per execution/fill.
- Every snapshot relation is calculated without future candles.
- The explicit no-lookahead policy is:

```ts
{
  policy: "closed_candles_only",
  candleInclusionRule: "candle_end_lte_snapshot_timestamp",
  partialCandlesRequireLowerGranularitySource: true
}
```

- Regular-session VWAP basis starts at 9:30 ET for the execution's market
  session.
- Extended-session VWAP basis starts at 4:00 ET for the execution's market
  session.
- EMA benchmarks are rolling over available trade-window candles through the
  execution timestamp.
- Each relation includes `basis` metadata: timeframe, requested timeframe,
  fallback status, session scope, start/end timestamps, bars used, missing bars,
  and partial bars.
- Each relation includes `quality` metadata: status, confidence, flags, and
  neutral reasons.
- 9:31-style regular-session VWAP facts are flagged as `thin_basis`.
- 5m fallback is surfaced in `basis.fallbackUsed` and `quality.flags`.
- VWAP disagreement between regular-session and extended-session benchmarks is
  returned in `marketFacts.disagreementSummary`.
- Support/resistance benchmark facts are returned alongside indicator
  benchmarks in each execution snapshot.
- `marketFacts.tradeWindowSummary` wraps completed during-trade facts.
- `marketFacts.postTradeSummary` wraps bounded post-exit facts when post-exit
  candles are available.
- `marketFacts.benchmarkProfile = "small_cap_day_trade_enriched_v1"` adds 5m
  EMA benchmark facts.
- `trader-intelligence-v2` now carries `levelsSystemMarketFacts` through the
  raw trade timeline build result.

Consumer guidance:

- `trader-intelligence-v2` should prefer `marketFacts.executionSnapshots` for
  new review language.
- Existing consumers can continue using `executionRelations` during migration.
- Do not phrase these as the trader's exact chart. Phrase them as named
  benchmark evidence, for example:

```text
Against regular-session VWAP, entry was above the benchmark.
Against extended-session VWAP, entry was below the benchmark.
VWAP benchmark evidence was mixed.
```

Still planned / not yet implemented:

- optional chartContext weighting
- anchored VWAP with explicit anchors only
- deeper trader-intelligence-v2 interpretation language that prefers
  `levelsSystemMarketFacts` over legacy fields
