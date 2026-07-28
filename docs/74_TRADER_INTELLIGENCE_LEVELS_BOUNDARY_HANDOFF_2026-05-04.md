# Trader Intelligence Levels Boundary Handoff

Date: 2026-05-04

This note summarizes the product and architecture discussion around how `levels-system` should support `trader-intelligence-v2` for completed historical trade review.

The current direction is to simplify the contract for the next integration
pass:

- `levels-system` should primarily own support/resistance level discovery, level quality, level proximity, and neutral level interaction facts.
- `trader-intelligence-v2` should own trade review, P/L, sizing, behavior interpretation, pattern language, and coaching.
- VWAP and EMA should not be used as first-class intelligence feedback signals for now.
- Daily and 4h support/resistance should be the only support/resistance levels
  used for trader-facing feedback in the first pass.
- Lower-timeframe candles should still be used to measure what happened during
  the actual trade window.

## Main Concern

The original market-facts direction included VWAP and EMA facts. That created confusion because VWAP and EMA can differ by:

- session anchor
- extended-hours inclusion
- chart timeframe
- platform settings
- warmup candle availability
- whether the calculation is regular-session, extended-session, rolling, or explicitly anchored

For a beginner-focused trader review product, asking the end user to understand or configure all of that is probably the wrong product burden.

The safer current direction is:

> Do not build trader feedback around VWAP/EMA yet. Keep the intelligence layer focused on completed trade behavior plus support/resistance context.

VWAP/EMA may still return later as optional, clearly named, neutral benchmark facts, but they should not drive coaching or judgment until the contract is deliberately designed.

Consumer-side status:

- `trader-intelligence-v2` has been aligned so PatternInput no longer exposes
  VWAP/EMA relation fields as usable feedback signals.
- `trader-intelligence-v2` maps feedback-facing support/resistance levels only
  from levels that include `daily` or `4h` in `timeframeSources`.
- `trader-intelligence-v2` may still keep raw/debug dynamic benchmark data
  around if levels-system returns it, but it should not use it for pattern
  detection, scoring, coaching, or trader-facing market-context feedback.
- `trader-intelligence-v2` now has a project review at
  `src/docs/trader-execution-intelligence-project-review-2026-05-04.md`
  documenting the desired review quality and current fixture simulations.
- Current consumer simulations run through `levels-system` trade-window context
  for sample, long/short winners and losers, partial exits, open-position
  warning, rapid-fire cluster, inconsistent sizing, and repeated-add scenarios.

## Clean App Boundary

### `levels-system` Should Own

- Historical candle fetching through levels-system-owned providers/storage.
- Building support/resistance levels from historical candles.
- Multi-timeframe level context.
- Level strength/quality labels.
- Nearest support below and resistance above a price.
- Whether a trade/execution was near, above, below, into, or through support/resistance.
- Historical daily/4h level maps as-of each execution timestamp.
- Trade-window movement facts from 1m/5m candles, without treating those 1m/5m
  candles as major support/resistance.
- Level metadata:
  - timeframe sources
  - strength score
  - strength label
  - confidence
  - freshness
  - state
  - confluence
  - source evidence
- Neutral diagnostics about missing, stale, partial, or fallback candle data.

### `trader-intelligence-v2` Should Own

- Imported completed trades.
- Executions/fills.
- Entry/exit grouping.
- P/L.
- Sizing.
- Hold duration.
- Trade behavior patterns.
- Journal/review language.
- Coaching/learning feedback.
- Deciding which neutral level facts matter for the trader review.

The preferred mental model:

> `levels-system` provides the map. `trader-intelligence-v2` writes the review.

## Historical Completed Trade Requirement

`levels-system` currently supports live/current level feedback. `trader-intelligence-v2` needs the same idea, but shifted back in time.

For live feedback, the question is:

> What does the support/resistance map look like now?

For historical trade review, the question is:

> What did the support/resistance map look like at the time of this trade or execution?

That means `trader-intelligence-v2` should not review an old trade using today's levels. That would introduce lookahead bias.

The historical contract should allow `trader-intelligence-v2` to pass:

- `symbol`
- `sessionDate`
- `asOfTimestamp`
- `tradeStartTimestamp`
- `tradeEndTimestamp`
- `executions`
- requested trade window options
- support/resistance lookback/config options

Then `levels-system` should fetch/build the relevant context as of the historical timestamp.

## No-Lookahead Rule

For each execution/fill:

> Level relations should be calculated using only market data available up to that execution timestamp.

Examples:

- If entry occurred at 10:03 AM, the execution relation should use levels/context available as of 10:03 AM.
- It should not use candles from 10:04 AM through exit.
- It should not use post-exit candles.
- During-trade and post-exit facts can use later candles, but those facts must be explicitly separated from execution-time facts.

Suggested separation:

### Execution-Time Level Facts

Calculated as-of each execution timestamp:

- nearest support below
- nearest resistance above
- distance to support/resistance
- near support/resistance
- below support / above resistance
- room to next support/resistance
- level strength/label/source for nearby levels

### During-Trade Facts

Calculated from entry through exit:

- highest high during trade
- lowest low during trade
- max favorable move
- max adverse move
- moved into resistance during hold
- lost support during hold, if detectable
- reclaimed a level during hold, if detectable

### Post-Exit Facts

Calculated only after exit and bounded by `postTradeMinutes` / `asOfTimestamp`:

- continuation after exit
- reversal/relief after exit
- highest high after exit
- lowest low after exit
- reached nearby resistance after exit
- broke nearby support after exit

## Timeframe Strategy For Support/Resistance

There is no single perfect timeframe for support/resistance. Different timeframes produce different levels, and lower timeframes are noisier.

Recommended default for trader-intelligence:

### Daily / 4h

Primary truth for major structure.

Use for stronger review language:

- near major support
- near major resistance
- room into major resistance
- bounced from higher-timeframe support
- rejected at higher-timeframe resistance

For the first production-facing integration, this is the only level family that
should drive trader-intelligence feedback.

### 15m / 5m

Intraday context, useful later but lower authority than daily/4h.

For now, do not use 15m/5m support/resistance for trader-facing coaching or
pattern detection. It can remain internal evidence or future optional context.

Later, it may support cautious language such as:

- near intraday support
- near intraday resistance
- trade moved into an intraday level
- entry/exit happened around an intraday shelf
- premarket high/low or opening range context

### 1m

Execution detail only.

Use for:

- entry candle behavior
- exit candle behavior
- exact trade-window high/low
- MFE/MAE
- post-exit continuation/reversal

Do not treat 1m levels as major support/resistance.

## Existing levels-system Shape

`levels-system` already appears broadly aligned with this direction.

The level output includes fields such as:

- `strengthScore`
- `strengthLabel`: `weak | moderate | strong | major`
- `confidence`
- `state`
- `timeframeSources`
- `majorSupport`
- `majorResistance`
- `intermediateSupport`
- `intermediateResistance`
- `intradaySupport`
- `intradayResistance`

This is the kind of output `trader-intelligence-v2` should consume.

Important caveat:

Current strength labels may be approximated from surfaced-selection scores in the runtime adapter. That is acceptable if treated as neutral level quality evidence, not absolute truth.

## Current Product Recommendation

For the next integration pass, prefer this:

1. Keep `levels-system` focused on support/resistance and candle-backed level context.
2. Do not make VWAP/EMA part of trader-intelligence coaching yet.
3. Return historical level facts as-of each execution timestamp.
4. Return during-trade and post-exit facts separately from execution-time facts.
5. Make daily/4h levels the only support/resistance review input for the first pass.
6. Do not use 15m/5m support/resistance for coaching yet; reserve it for a later tactical-context layer.
7. Use 1m candles for execution/trade-window movement facts, not major level truth.
8. Keep all returned facts neutral. `levels-system` should not emit coaching or judgment.

## Implementation Ask For Other Codex Agent

Please review and adjust the current `levels-system` API so that the public
contract for `trader-intelligence-v2` explicitly centers on:

- historical as-of support/resistance context
- execution-time level relations
- during-trade level interactions
- post-exit continuation/reversal around levels
- strength/timeframe-aware level metadata

For the first pass, the data returned for trader-intelligence should support:

- daily/4h support and resistance relations at each execution
- distance to nearest daily/4h support/resistance
- whether an execution occurred near, below, above, into, or through a daily/4h level
- level strength/quality/source metadata for those daily/4h levels
- trade-window MFE/MAE and high/low facts from 1m/5m candles
- whether price reached or interacted with a daily/4h level during the hold
- post-exit continuation/reversal bounded by `postTradeMinutes` and `asOfTimestamp`
- explicit diagnostics for missing, stale, partial, fallback, or truncated data

VWAP/EMA should be removed from this trader-intelligence contract, hidden
behind an experimental flag, or left only as optional diagnostics that the
consumer does not use for feedback.
