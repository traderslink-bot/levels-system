# Market Context Classifier Plan

Date: 2026-05-28
Scope: planning only
Depends on: merged level-system rescue work from `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md` through `docs/31_PR1_FULL_DIFF_REVIEW_AND_MERGE_RISK_REPORT.md`

## Executive Summary

The Market Context Classifier should help the levels system understand the current trading environment before any future phase adjusts level explanations, scoring, or trader-facing analysis.

This is not a new support/resistance engine. The existing level engine, runtime transport, parity gates, and no-lookahead protections remain authoritative. The classifier should be a soft, confidence-based context layer that reads market facts around the current symbol and returns an explainable profile such as `premarket_runner`, `failed_runner`, `swing_structure`, or `choppy_low_quality`.

The same support/resistance levels should remain available. A later phase may use context to explain why certain levels matter more in a given environment, but this plan does not authorize changes to runtime selection, monitoring, alerts, trader-context behavior, `runtimeMode` defaults, or old/default output behavior.

VWAP must remain market-facts-only by default. It may be included as an observed fact, such as `aboveVWAP` or `percentFromVWAP`, but it must not change trader interpretation unless a later explicit policy permits that behavior.

## What The Classifier Is

The classifier is a context layer that reads existing market data and produces a soft classification of the current trading environment.

It should consume:

- candles
- session boundaries
- volume and relative volume facts
- VWAP facts
- price movement from open and previous close
- level interactions
- failed breakout or reclaim attempts
- optional future external facts such as news timestamps, float, or market cap

It should return a confidence-weighted profile with evidence, warnings, and proposed scoring adjustment metadata. It should not directly change runtime buckets, nearest levels, extension ladders, special levels, alerts, monitoring behavior, or trader-context labels in the first implementation phase.

The classifier should behave like additive analysis attached near `LevelEngineOutput` metadata or a separate analysis output. It must not replace:

- `FinalLevelZone`
- `LevelEngineOutput`
- `rankLevels()`
- the old runtime path
- the runtime compare scaffolding
- the existing support/resistance shared context

## Required Context Profiles

### `normal_intraday`

A standard regular-session environment where price action is orderly, volume is within an expected range, and support/resistance interpretation can rely on the normal blend of intraday, session, 4h, and daily structure.

Expected evidence may include:

- moderate relative volume
- no extreme gap from previous close
- no sustained parabolic move
- price respecting ordinary intraday ranges
- no repeated failed high-of-day attempts

### `premarket_runner`

A premarket environment where a symbol is moving materially before the regular session and traders need future planning around premarket highs, premarket pullbacks, and early continuation or failure risk.

Expected evidence may include:

- large gap from previous close
- high premarket relative volume
- elevated dollar volume
- higher lows during premarket
- price holding above VWAP as a fact only
- price approaching or breaking premarket high
- press-release timestamp when available later

### `day_trade_runner`

A regular-session runner with active momentum, elevated volume, and meaningful progress through nearby levels. This profile should keep practical forward-planning levels visible without assuming the move is healthy forever.

Expected evidence may include:

- strong move from open
- strong move from previous close
- volume acceleration during regular session
- higher lows after opening volatility
- price near high of day
- repeated continuation through resistance
- pullbacks respecting prior resistance as support

### `press_release_runner`

A runner likely driven by a fresh catalyst, such as a press release or news timestamp. This profile should be provisional until external news data exists; the classifier should support it without requiring the data on day one.

Expected evidence may include:

- news or PR timestamp close to the move, if available later
- sudden premarket or opening volume expansion
- large gap from previous close
- aggressive opening drive
- rapid level traversal
- elevated risk warnings when price is extended from VWAP or the opening base

### `swing_structure`

A higher-timeframe environment where daily and 4h levels should matter more than session-only noise. This context is useful for swing trades, multi-day continuation, multi-day failed breakouts, and broad structure review.

Expected evidence may include:

- multi-day trend or range structure
- daily and 4h levels near current price
- regular-session movement that is not dominated by a single opening drive
- lower dependence on premarket high, opening range, or VWAP facts
- broader multi-day higher-low or lower-high structure

### `failed_runner`

A prior runner that has started to fail. This profile is important because old highs and reclaimed/lost levels may still matter, but the interpretation should reflect broken momentum and distribution risk.

Expected evidence may include:

- failed high-of-day breakout
- loss of VWAP as a market fact
- lower highs after an attempted continuation
- high-volume selling after a breakout attempt
- price rejecting near premarket high or opening range high
- repeated inability to reclaim a key session level

### `choppy_low_quality`

A low-quality environment where signals are noisy, repeated tests lack follow-through, and levels may be less reliable for professional interpretation.

Expected evidence may include:

- overlapping candles
- rapid alternating breaks and reclaims
- weak or inconsistent volume
- repeated small failed moves through nearby levels
- no clear higher-low or lower-high structure
- poor distance between actionable levels
- warnings about low-confidence context

### `parabolic_extension`

An environment where price is extended far from its base, VWAP, or prior consolidation. The classifier should flag risk, not recommend fading or chasing.

Expected evidence may include:

- large percent move from open or previous close
- far extension from VWAP as a market fact only
- multiple strong directional candles
- acceleration away from nearby support
- high volume followed by volume exhaustion
- thin overhead historical inventory
- price moving through extension levels quickly

## Runner Phase Model

The runner phase is separate from the primary context. For example, `day_trade_runner` may be in `first_pullback`, `high_of_day_breakout`, or `failed_breakout`.

Required runner phases:

### `not_applicable`

The symbol is not currently behaving like a runner, or available data is insufficient to classify a runner phase.

### `premarket_discovery`

Premarket price discovery is active. Price is building early structure, testing premarket highs or lows, and forming the first useful session map.

### `opening_drive`

Regular-session price is moving strongly from the open with elevated activity. The classifier should watch opening range levels, high of day, and pullback quality.

### `first_pullback`

The initial move has paused and price is testing whether prior breakout zones, opening range levels, or nearby support can hold.

### `vwap_hold`

Price is above VWAP as a market fact and pullbacks are holding near or above it. This should remain factual unless later policy permits interpretive use.

### `vwap_reclaim`

Price lost VWAP and then reclaimed it as a market fact. This can be evidence of renewed activity, but the first implementation should not turn it into a trader interpretation by default.

### `high_of_day_breakout`

Price is breaking or testing high of day after prior structure has formed. Evidence should distinguish clean continuation from repeated failed attempts.

### `second_leg_attempt`

Price is attempting continuation after a first pullback or consolidation. This phase should consider higher lows, volume behavior, and whether overhead levels are being cleared.

### `parabolic_extension`

Price has moved far enough from its base that extension risk is a defining feature. This phase can coexist with the `parabolic_extension` primary context.

### `failed_breakout`

A breakout attempt failed, especially near high of day, premarket high, opening range high, or a major level.

### `fade`

The runner has shifted into sustained downside or loss of bid. Evidence may include lower highs, failed reclaims, high-volume selling, and loss of session support facts.

## Inputs Needed

The classifier should be designed around available data, with optional expansion points for later data sources.

Required or near-term inputs:

- 5m candles
- premarket candles
- regular session candles
- previous close
- current/reference price
- VWAP as a market fact
- relative volume
- dollar volume
- move from open
- move from previous close
- extension from VWAP as market fact only
- higher-low/lower-high structure
- failed high-of-day attempts
- volume acceleration/exhaustion

Later optional inputs:

- 15m candles if available later
- news/PR timestamp if available later
- float if available later
- market cap if available later

All inputs should be represented as facts. The classifier may explain why facts support a profile, but it should not make trade recommendations.

## Output Contract

The first implementation should use an additive TypeScript contract similar to this:

```ts
export type MarketContextPrimaryContext =
  | "normal_intraday"
  | "premarket_runner"
  | "day_trade_runner"
  | "press_release_runner"
  | "swing_structure"
  | "failed_runner"
  | "choppy_low_quality"
  | "parabolic_extension";

export type RunnerPhase =
  | "not_applicable"
  | "premarket_discovery"
  | "opening_drive"
  | "first_pullback"
  | "vwap_hold"
  | "vwap_reclaim"
  | "high_of_day_breakout"
  | "second_leg_attempt"
  | "parabolic_extension"
  | "failed_breakout"
  | "fade";

export type MarketContextProfile = {
  primaryContext: MarketContextPrimaryContext;
  confidence: number;
  runnerPhase: RunnerPhase;
  evidence: string[];
  warnings: string[];
  facts: {
    percentFromPreviousClose?: number;
    percentFromOpen?: number;
    percentFromVWAP?: number;
    relativeVolume?: number;
    dollarVolume?: number;
    aboveVWAP?: boolean;
    abovePremarketHigh?: boolean;
    aboveOpeningRangeHigh?: boolean;
    nearHighOfDay?: boolean;
  };
  scoringAdjustments: {
    intradayWeightMultiplier: number;
    dailyWeightMultiplier: number;
    sessionLevelWeightMultiplier: number;
    volumeWeightMultiplier: number;
    extensionRiskPenaltyMultiplier: number;
  };
};
```

Contract requirements:

- `confidence` should be bounded from `0` to `1`.
- `evidence` should contain deterministic, testable reasons.
- `warnings` should explain degraded data, low confidence, or risk context.
- `facts` should remain factual and should not contain recommendations.
- `scoringAdjustments` should be proposed metadata only until a later phase explicitly wires it into scoring or explanations.
- The classifier output must be optional and backward compatible when attached to existing outputs.

## Context Evidence Rules

Evidence rules should be deterministic, explainable, and soft. A profile should win by accumulated evidence and confidence, not by a single hard trigger.

### `normal_intraday`

Supporting evidence:

- percent move from previous close is modest
- percent move from open is modest
- relative volume is near normal
- regular-session candles are orderly
- no strong premarket gap behavior
- high-of-day attempts are not repeatedly failing

Counter-evidence:

- extreme gap or extension
- high relative volume and fast level traversal
- repeated failed breakout attempts
- severe candle overlap with no directional structure

### `premarket_runner`

Supporting evidence:

- large gap from previous close before regular session
- high premarket relative volume
- meaningful premarket dollar volume
- higher lows during premarket
- holding above VWAP as a market fact
- approaching or breaking premarket high

Warnings:

- low dollar volume despite high percent move
- thin or missing premarket candles
- extreme extension from VWAP before the open

### `day_trade_runner`

Supporting evidence:

- strong move from open during regular session
- high relative volume
- price near high of day
- higher lows after initial volatility
- pullback holds above prior breakout or opening range support
- resistance levels are being cleared with volume

Warnings:

- too extended from VWAP
- volume exhaustion after a vertical move
- repeated failed continuation attempts

### `press_release_runner`

Supporting evidence:

- PR/news timestamp near the start of the move, when available
- sudden premarket or opening volume spike
- large gap from previous close
- rapid movement through nearby levels
- price holding above session breakout facts

Warnings:

- no external catalyst data available
- move is already parabolic
- volume spike fades quickly after the catalyst window

### `swing_structure`

Supporting evidence:

- multi-day trend, base, or range is visible
- daily and 4h levels are near current price
- regular-session price respects higher-timeframe support or resistance
- session levels are less decisive than daily/4h structure
- current move is not only a single premarket or opening spike

Warnings:

- intraday move is so extreme that swing context is temporarily secondary
- daily or 4h candles are incomplete and excluded by as-of filtering

### `failed_runner`

Supporting evidence:

- failed high-of-day break
- VWAP loss as a market fact
- lower highs after a breakout attempt
- high-volume selling after extension
- inability to reclaim premarket high, opening range high, or high of day

Warnings:

- a failed runner profile should not hide remaining overhead resistance or downside support
- a single wick failure should not dominate if later closed candles reclaim the structure

### `choppy_low_quality`

Supporting evidence:

- repeated overlapping candles
- frequent small breaks and reclaims
- inconsistent volume
- no clean higher-low or lower-high sequence
- low confidence across competing profiles
- support and resistance are clustered too tightly for clear interpretation

Warnings:

- context confidence should be visibly lower
- proposed scoring adjustments should avoid over-amplifying any single level family

### `parabolic_extension`

Supporting evidence:

- extreme percent move from open or previous close
- far extension from VWAP as a market fact only
- multiple large directional candles
- distance from last consolidation/base is large
- volume acceleration followed by exhaustion
- price has moved quickly through extension levels

Warnings:

- high extension risk
- thin nearby support after vertical movement
- overhead levels may be synthetic or sparse

## No-Lookahead Requirement

All historical, replay, journal, and execution-snapshot classification must use the merged candle-close as-of filtering.

The required rule is:

- no future candles
- no partial candles unless they are explicitly partial-derived from lower-timeframe closed data
- candle eligibility is based on candle close timestamp `<= asOfTimestamp`
- daily and 4h candles must respect timeframe-aware close semantics
- classification evidence must be reproducible from the as-of snapshot

The classifier should reuse the merged `candle-as-of-filter` behavior and diagnostics. It must not reintroduce candle-start leakage or rely on still-forming higher-timeframe bars when evaluating replay or journal snapshots.

If a context profile changes when candles after `asOfTimestamp` are appended, that is a bug unless the new candles are outside the historical/replay path and the classifier is running live with an explicitly current snapshot.

## Integration Points

The first implementation should be optional and observational.

Potential integration points:

- `LevelEngineOutput` metadata as an optional `marketContext` field
- a separate analysis output returned beside `LevelEngineOutput`
- `level-runtime-output-adapter` as shadow metadata only
- support/resistance shared context for journal and replay snapshots
- monitoring/opportunity evaluation as a future gated input
- future trading journal execution snapshots

Integration constraints:

- Do not change `runtimeMode` defaults.
- Do not change old/default output behavior.
- Do not alter bucket membership, nearest levels, extension levels, special levels, `strengthScore`, or `strengthLabel`.
- Do not use context to change alerts or trader-context language until a later explicit phase approves it.
- Keep market facts separate from trader interpretation.
- Keep VWAP facts factual unless a future policy explicitly allows interpretive use.

## Tests Needed Before Implementation

Before production integration, add focused tests for:

- classifier does not use future candles
- classifier excludes partial candles using candle-close semantics
- premarket runner fixture
- failed runner fixture
- parabolic extension fixture
- normal intraday fixture
- swing structure fixture
- confidence and evidence determinism
- VWAP facts-only policy
- no `runtimeMode` default change
- old/default output unchanged
- classifier output serializes as optional metadata
- low-confidence and degraded-data warnings
- press-release runner behavior with and without a news timestamp
- choppy low-quality behavior under overlapping candles
- runner phase transitions without future leakage

Specific no-lookahead tests should include:

- a 5m candle stamped at 09:30 is excluded at 09:33 and included at 09:35
- a still-forming 4h candle is excluded from a replay snapshot
- a still-forming daily candle is excluded from a replay snapshot
- adding a future high-of-day failure after the execution timestamp does not change the as-of context

## Implementation Order

Recommended sequence:

1. Add TypeScript types for `MarketContextProfile`, profile ids, runner phases, facts, and proposed scoring adjustment metadata.
2. Add a pure classifier function that accepts already-filtered candles and explicit as-of inputs.
3. Add fixture builders for normal intraday, premarket runner, failed runner, parabolic extension, swing structure, and choppy low-quality contexts.
4. Add no-lookahead tests before any integration.
5. Add confidence, evidence, warning, and VWAP facts-only policy tests.
6. Integrate as optional metadata only, preferably near `LevelEngineOutput` metadata or a separate analysis output.
7. Add serialization/backward-compatibility tests.
8. Keep monitoring, alerts, trader-context, and opportunity evaluation unchanged.
9. Only in a later explicit phase, evaluate whether context should influence explanations or scoring.

The implementation should remain pure and deterministic where possible. It should not read wall-clock time implicitly for replay or journal use. Any current-time or as-of value should be provided explicitly.

## Non-Goals

This phase is not:

- making trade recommendations
- replacing the support/resistance engine
- creating a new level engine
- making a new runtime default
- changing `runtimeMode`
- changing alerts
- changing monitoring behavior
- changing trader-context labels
- changing old/default output behavior
- changing bucket membership, nearest levels, extension levels, or special levels
- overwriting legacy `strengthScore` or `strengthLabel`
- using VWAP to change trader interpretation by default
- bypassing the merged no-lookahead candle-close safety
- bypassing formal `asOfTimestamp` filtering

## Recommended Next Phase

After this planning document is reviewed, the next implementation phase should be a small test-first classifier skeleton:

- types only
- pure function only
- deterministic fixtures
- no-lookahead tests
- VWAP facts-only tests
- optional metadata integration only after the pure classifier is proven

The classifier should remain observational until a later directive explicitly authorizes it to affect explanations, scoring adjustments, alerts, or trader-facing context.
