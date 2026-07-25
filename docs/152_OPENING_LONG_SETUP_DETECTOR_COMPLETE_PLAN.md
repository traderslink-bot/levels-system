# Opening Long Setup Detector — Complete Product and Implementation Plan

**Repository:** `traderslink-bot/levels-system`  
**Target runtime:** TradersLink local watchlist and ticker-detail application  
**Document date:** 2026-07-24  
**Status:** Product and implementation design baseline  

## 1. Purpose

This document defines the complete first-version design for a deterministic opening-session long-setup detector.

The detector watches a premarket universe, keeps every stock that passes objective tradability requirements, receives one shared set of live market inputs for every qualified stock, and waits for one or more defined long setups to form after the 9:30 a.m. Eastern Time market open.

The detector does not force a setup onto a chart. It waits for price to create the required conditions, displays each meaningful setup event as it happens, explains what has happened in plain language, identifies what must happen next, and continuously shows the percentage room to the next meaningful level.

The first version supports four long setup families:

1. Premarket-high breakout
2. Premarket-support bounce
3. Opening flush and reclaim
4. Opening-drive first pullback

The design intentionally stays simple enough to implement and validate now while preserving clear extension points for later confirmation variants, additional setup paths, more advanced market data, and learned tuning.

---

## 2. Product outcome

At approximately 9:00 a.m., the system begins with the leading premarket stocks, commonly the top 15 scanner results.

It then:

1. Collects objective premarket data for every candidate.
2. Removes candidates that are not reasonably tradable.
3. Keeps every stock that passes; the final count is not forced.
4. Assigns a secondary strength classification of Level 1, Level 2, or Level 3.
5. Builds the premarket level and scenario context for each qualified stock.
6. Starts one shared live-data stream after the market opens.
7. Runs all four setup detectors independently for every qualified stock.
8. Displays the first meaningful indication that a setup may be forming.
9. Displays each later event as the setup advances.
10. Shows the expected first and second levels, percentage room, invalidation, and trade geometry.
11. Adapts when one setup fails and a different setup begins.
12. Allows “no setup” to remain the correct outcome.

A four-card screen may therefore show:

- one stock with no setup forming;
- one stock with the first event of a support bounce;
- one stock with two completed breakout events;
- one stock with a completed flush-and-reclaim sequence.

The trader can see which charts deserve attention without the system pretending that every qualified stock is currently a trade.

---

## 3. Locked product decisions

The following decisions are foundational and should not be changed accidentally during implementation.

### 3.1 No setup is forced

A qualified stock is not required to produce a setup.

Valid outputs include:

- no setup is currently forming;
- one setup has entered its first stage;
- several compatible setups are developing;
- a setup completed;
- a setup reset;
- a setup invalidated;
- all relevant setups expired.

### 3.2 Setup quality matters more than stock strength level

The Level 1, Level 2, and Level 3 stock classifications are secondary context.

They do not determine permission to trade. Every stock on the qualified list is considered tradable if a valid setup forms.

A Level 3 stock may become the best current opportunity when it forms a clean setup near support with substantial room to resistance. A Level 1 stock may remain only a watch when it is extended or has little room before the next level.

### 3.3 Several stocks may be equally strong

The detector must allow ties. It should not manufacture small ranking differences merely to identify one best stock before a setup exists.

### 3.4 Catalyst quality is outside the detector

The detector does not grade, interpret, or score catalysts.

Catalyst analysis is a separate problem that may require news interpretation, filing analysis, source verification, and confidence handling. The technical detector should only use inputs it can identify consistently and objectively.

A separate part of the application may display catalyst text, but catalyst quality must not be a required detector input in this first version.

### 3.5 Every meaningful setup event is visible

The first setup event is useful to the trader even though it is not an entry signal.

The card should visibly show:

- what happened;
- which setup it may become;
- which stage is complete;
- what the detector is watching for next;
- what would invalidate the sequence;
- the current percentage room to the next meaningful level.

The first event creates awareness. Later events show that the setup is advancing.

### 3.6 Setup progress and trade geometry are separate

A setup may be two stages complete but have little room before resistance.

Another setup may be only one stage complete but offer much better potential range if confirmed.

The UI must show both facts instead of collapsing them into one vague quality score.

### 3.7 The percentage must use an honest basis

Before a reliable trigger or confirmation price exists, percentage room is measured from current price.

Once the detector can estimate the likely trigger or confirmation price, percentage room must be recalculated from that price.

After the setup completes, percentage room is measured from the detected confirmation price or the application’s explicitly recorded entry basis.

The UI must identify the basis so the trader is never shown an inflated percentage based on an unrealistic early price.

---

## 4. System boundary

### 4.1 The detector owns

- premarket candidate normalization;
- objective tradability qualification;
- strength classification;
- shared market-data normalization;
- planned level context;
- live setup eligibility;
- setup event sequencing;
- setup reset, invalidation, and expiration;
- setup progress explanations;
- percentage distance to levels;
- estimated risk and reward geometry;
- trader-facing setup-state output;
- deterministic event history for replay and testing.

### 4.2 The detector does not own

- catalyst interpretation or catalyst grading;
- discretionary buy or sell orders;
- brokerage execution;
- position sizing for a user account;
- guaranteed entry prices;
- guaranteed targets;
- prediction that a setup must occur;
- Level 2 interpretation in version one;
- time-and-sales interpretation in version one;
- machine-learning pattern classification;
- short setup detection;
- midday or power-hour setup families in version one.

### 4.3 Relationship to the existing Levels System

The existing Levels System owns generated support and resistance facts and live interaction monitoring.

The opening setup detector should consume those level facts rather than create an unrelated second support/resistance engine.

The setup detector adds a higher-order sequence layer:

```text
level facts
  -> normalized live market facts
  -> setup eligibility
  -> setup event sequence
  -> setup progress and explanation
  -> trader-facing stock card
```

The detector should remain deterministic. AI-generated commentary may explain a detected result later, but AI should not be required to establish the core setup truth.

---

## 5. End-to-end operating flow

```text
Premarket scanner universe
        ↓
Objective tradability qualification
        ↓
Qualified stock set; no fixed final count
        ↓
Strength Level 1 / 2 / 3 context
        ↓
Premarket levels and opening preparation
        ↓
Shared live-data collection after 9:30
        ↓
Four independent setup detectors per ticker
        ↓
First meaningful setup event becomes visible
        ↓
Next allowed event is tracked
        ↓
Setup advances, resets, invalidates, or expires
        ↓
Percentage room and trade geometry update continuously
        ↓
Cards explain what happened and what is required next
```

---

## 6. Premarket candidate universe

### 6.1 Scanner input

The detector may begin with the top 15 premarket scanner results, but 15 is an input-universe size rather than a required watchlist size.

A future implementation may use more or fewer scanner candidates without changing the detector architecture.

### 6.2 Candidate identity

Each candidate must have:

- normalized symbol;
- exchange;
- session date;
- current premarket price;
- reliable market-data identity;
- available premarket candles;
- available daily and intraday level facts.

Duplicate symbols must collapse into one candidate record.

### 6.3 Tradability qualification

Qualification should be based only on objective information available with sufficient confidence.

Suggested inputs:

- current price within configured trading scope;
- exchange within configured scope;
- reported float when available;
- premarket share volume;
- premarket dollar volume;
- relative volume when a reliable baseline exists;
- float turnover when float is available;
- bid-ask spread in dollars and percentage terms;
- quote continuity;
- trade frequency;
- candle continuity;
- identifiable support and resistance;
- meaningful movement relative to normal range;
- data freshness and completeness;
- absence of a current hard execution blocker.

### 6.4 Hard qualification blockers

A candidate should not qualify when one or more hard blockers apply, including:

- stale or incomplete market data;
- unsupported exchange or security type;
- price outside configured scope;
- insufficient quote or trade continuity;
- spread above the configured maximum for its price and volatility;
- insufficient premarket participation;
- no usable level map;
- unreliable or contradictory symbol identity;
- known data-provider error;
- trading status that prevents normal monitoring.

### 6.5 No fixed qualified count

If two stocks pass, the detector watches two.

If seven pass, the detector watches seven.

The application may display four primary cards while continuing to track additional qualified stocks in an overflow list, but the qualification engine must not lower standards merely to fill four card positions.

---

## 7. Stock strength levels

Every qualified stock receives one secondary strength label.

### 7.1 Level 1 — Strong

Typical characteristics include several of the following:

- very high premarket or opening volume;
- high dollar-volume participation;
- high relative volume;
- high float turnover;
- strong quote and trade continuity;
- controlled spread relative to price and volatility;
- clear directional premarket structure;
- repeated ability to hold important levels.

### 7.2 Level 2 — Moderate

Typical characteristics include:

- solid but less exceptional participation;
- sufficient liquidity and spread quality;
- usable structure and levels;
- enough movement to support a day-trade setup;
- no qualification blocker.

### 7.3 Level 3 — Weak

“Weak” is relative only to the other qualified stocks.

A Level 3 stock has passed the tradability filter and remains fully eligible for all four setups. It may have lower relative participation, less consistent structure, or less favourable spread than Level 1 and Level 2 names, but it is still good to monitor and may produce the best actual setup.

### 7.4 Strength-level rules

- Strength must not be treated as a trade signal.
- Strength must not suppress a valid setup.
- Several stocks may share one level.
- Strength may update when live participation changes materially.
- Strength should not fluctuate on every tick.
- Strength should be visually secondary on the card.
- Current setup progression and available range should receive greater visual prominence.

---

## 8. Unified data model

All qualified stocks use one normalized data contract. The four setup detectors must not build separate data pipelines.

## 8.1 Premarket and planned context

For each ticker, retain:

- session date;
- premarket open, high, low, and latest price;
- premarket candles and volume;
- premarket VWAP;
- strongest premarket support zones;
- strongest premarket resistance zones;
- premarket high;
- premarket low;
- previous close;
- previous-day high and low;
- relevant daily support and resistance;
- whole-dollar or half-dollar levels when technically relevant;
- primary must-hold level;
- hard invalidation level;
- first meaningful upside level;
- second meaningful upside level;
- higher extension levels when available;
- float when available;
- market capitalization when available;
- premarket share volume;
- premarket dollar volume;
- relative volume when reliable;
- float turnover when reliable;
- current spread and liquidity facts;
- strength level.

## 8.2 Live regular-session market inputs

For every qualified ticker, receive:

- current last price;
- bid price and size;
- ask price and size;
- current spread in dollars;
- current spread percentage;
- trade timestamp;
- quote timestamp;
- regular-session open;
- regular-session high of day;
- regular-session low of day;
- one-minute OHLCV candles;
- five-minute OHLCV candles;
- current regular-session VWAP;
- cumulative regular-session share volume;
- current trading or halt status;
- exchange session state;
- data freshness state.

## 8.3 Derived price-location facts

Derive:

- distance to premarket high;
- distance to premarket support;
- distance to premarket low;
- distance to VWAP;
- distance to first resistance;
- distance to second resistance;
- distance to hard invalidation;
- price above, below, or inside each level zone;
- cross above or cross below a level;
- candle close above or below a level;
- time spent above or below a level;
- retest of a level;
- hold of a level;
- rejection from a level;
- reclaim of a level;
- acceptance above or below a level.

## 8.4 Derived candle facts

For one-minute and five-minute candles, derive:

- bullish or bearish body;
- total range;
- body size;
- body as a percentage of range;
- upper wick size;
- lower wick size;
- close location within the range;
- range compared with recent candles;
- volume compared with recent candles;
- inside candle;
- outside candle;
- strong close near high;
- weak close near low;
- support-defence wick;
- resistance-rejection wick;
- momentum candle;
- controlled pullback candle.

The detector does not need subjective candlestick-pattern names. Objective body, wick, close-location, range, and volume facts are preferable.

## 8.5 Derived market-structure facts

Derive and retain:

- most recent confirmed swing high;
- most recent confirmed swing low;
- nearest lower high;
- nearest higher low;
- higher-high sequence;
- higher-low sequence;
- lower-high sequence;
- lower-low sequence;
- break of short-term structure;
- reclaim of short-term structure;
- opening-drive high;
- opening-drive low;
- pullback high;
- pullback low;
- one-minute opening range when complete;
- five-minute opening range when complete.

## 8.6 Derived volume facts

Derive:

- current one-minute volume;
- current five-minute volume;
- average of previous three one-minute candles;
- average of previous five one-minute candles;
- breakout volume ratio;
- pullback volume ratio;
- reclaim volume ratio;
- volume acceleration;
- volume contraction;
- opening-drive volume;
- support-test volume;
- cumulative volume pace;
- float turnover when float is reliable.

Relative comparisons should be preferred over one universal share-volume number.

## 8.7 VWAP facts

Derive:

- price above or below VWAP;
- distance from VWAP;
- VWAP slope;
- VWAP reclaim;
- VWAP loss;
- VWAP hold;
- repeated VWAP crossing;
- number of completed candles above or below VWAP.

## 8.8 Volatility and geometry facts

Derive:

- average one-minute candle range;
- average five-minute candle range;
- current candle range relative to recent average;
- distance from expected entry to invalidation;
- distance from expected entry to first level;
- distance from expected entry to second level;
- percentage room to each level;
- percentage risk to invalidation;
- reward-to-risk ratio to each level;
- whether the first meaningful level is too close to the expected entry;
- whether the required stop is unreasonably wide.

## 8.9 Operational integrity facts

Every evaluation must know:

- data timestamp;
- data age;
- missing-candle status;
- quote freshness;
- trade freshness;
- halt status;
- split-adjustment status for historical levels;
- whether premarket data is complete enough;
- whether VWAP uses the intended session;
- level-set version;
- detector configuration version.

A setup must not complete from stale data.

---

## 9. Level model

### 9.1 Use zones, not only exact prices

Support and resistance should retain lower and upper boundaries when the Levels System produces zones.

A setup may interact with:

- the lower edge;
- zone midpoint;
- upper edge;
- a configured interaction buffer around the zone.

### 9.2 Eligibility distance

A setup becomes potentially relevant before price reaches the exact level.

The first version should calculate a configurable eligibility buffer using objective market conditions. A practical baseline is the maximum of:

- a configured percentage of price;
- a configured multiple of the current spread;
- a configured fraction of the recent average one-minute range.

The exact constants must live in configuration and be tuned through replay, not hidden inside detector code.

### 9.3 First meaningful level

“First level” means the first meaningful resistance likely to affect the trade after the expected confirmation price.

It should not automatically be every small nearby level.

The level selector should consider:

- structural strength;
- timeframe;
- number and quality of reactions;
- spacing from the expected entry;
- crowding and near-duplicate levels;
- whether the level is already inside the trigger zone;
- whether a whole-dollar level is structurally relevant.

Minor resistance may be displayed separately, but it should not replace the first meaningful level used for the main percentage-room display.

---

## 10. Setup sequence model

## 10.1 Known context and live events

The premarket process establishes the known context, conceptually A, B, C, and D:

- the stock qualified as tradable;
- the level map exists;
- the relevant support and resistance are known;
- the live data contract is available.

After the market opens, the detector waits for setup-specific events, conceptually E, F, and G.

Each setup defines:

- its first meaningful event;
- the next allowed event;
- whether any event is optional;
- valid alternate paths;
- reset conditions;
- invalidation conditions;
- expiration conditions.

## 10.2 Events are logical, not necessarily separate candles

Two events may complete in one candle when the market action objectively satisfies both definitions.

A setup should not require events to appear on separate one-minute candles merely for implementation convenience.

## 10.3 Event types

Each event is classified as one of:

- required;
- optional;
- required unless replaced by an alternate valid event;
- failure;
- reset;
- expiration.

## 10.4 Minimum setup states

Each setup instance uses:

- `watching` — no first event yet;
- `potential` — price and structure have entered the setup’s eligibility conditions;
- `developing` — one or more required events have completed;
- `detected` — one valid complete path has finished;
- `reset` — the early sequence failed harmlessly and may begin again;
- `invalidated` — the setup is no longer valid under the current level context;
- `expired` — the event chain became stale or the session moved beyond its valid window.

The user-facing card should use readable labels and sentences rather than exposing only internal enum names.

## 10.5 Setup-instance memory

Each setup instance must retain:

- ticker;
- setup family;
- setup instance ID;
- current state;
- completed events;
- current expected events;
- first-event timestamp;
- latest-event timestamp;
- event prices;
- trigger level;
- expected confirmation price;
- detected confirmation price;
- relevant support and resistance IDs;
- current invalidation;
- first and second meaningful levels;
- reset count;
- failed-attempt count;
- expiration deadline;
- last state-change reason;
- current plain-language explanation;
- level-set version;
- detector-rule version.

## 10.6 Independent setup state

All four setup detectors run independently for every ticker.

Compatible setups may develop at the same time. For example:

- a premarket-high breakout sequence may be developing;
- an opening-drive first-pullback sequence may also begin because the same breakout created a qualifying opening drive.

Incompatible setups must clearly reset or invalidate when price changes the environment.

---

## 11. Setup 1 — Premarket-high breakout

### 11.1 Purpose

Detect a constructive approach to the premarket high, a break through that level, and either a successful hold/retest or direct continuation.

### 11.2 Required context

- premarket high is known;
- first meaningful resistance above the premarket high is known;
- nearby support and invalidation are known;
- live volume, spread, and price structure are available.

### 11.3 Stage 1 — Constructive approach

The first visible indication may complete when price enters the premarket-high eligibility zone and the approach remains constructive.

Supporting facts may include:

- price is approaching from below;
- higher lows are forming;
- price remains above major support;
- price is above or repeatedly recovering VWAP;
- pullbacks are controlled;
- repeated upper-wick rejection is not dominating;
- volume remains active;
- spread remains acceptable;
- room above the trigger remains meaningful.

Trader-facing wording example:

> Price is approaching the $3.20 premarket high with higher lows. A premarket-high breakout may be forming.

### 11.4 Stage 2 — Breakout

The breakout event completes when price objectively breaks the premarket high.

The event definition should consider:

- price exceeding the level by more than insignificant quote noise;
- breakout distance relative to spread and volatility;
- volume behaviour;
- candle close or sustained hold when required by configuration;
- absence of an immediate severe rejection;
- remaining room to the next meaningful resistance.

Trader-facing wording example:

> Price broke the $3.20 premarket high on increasing volume.

### 11.5 Stage 3 — Validation path

Two valid paths are supported.

#### Path A — Break, retest, and continue

- price pulls back toward the former premarket high;
- the former resistance holds as support;
- pullback volume is lower than breakout volume;
- price forms a higher low or otherwise stabilizes above the level;
- price resumes upward through the post-breakout high.

#### Path B — Break and direct continuation

- price remains accepted above the premarket high;
- no meaningful retest occurs;
- price continues through the post-breakout high with sufficient participation.

The retest is therefore optional when direct continuation independently validates the breakout.

Trader-facing wording examples:

> The former premarket high held as support and price resumed upward.

or:

> Price held above $3.20 and continued directly through the post-breakout high. A retest was not required for this path.

### 11.6 Reset conditions

Reset rather than permanently invalidate when:

- price approaches the premarket high but pulls away without breaking it;
- the constructive approach disappears but major support remains intact;
- price can reasonably build another attempt later.

### 11.7 Invalidation conditions

Invalidate the current setup instance when:

- price breaks the level and accepts back below it;
- a clear lower-high failure develops beneath the premarket high;
- the planned must-hold support fails;
- the first meaningful resistance leaves insufficient room from the likely confirmation price;
- spread or data quality becomes unacceptable.

A later materially different attempt may create a new setup instance.

---

## 12. Setup 2 — Premarket-support bounce

### 12.1 Purpose

Detect price entering planned premarket support, support holding, and a bullish reversal through the nearest meaningful lower high.

### 12.2 Required context

- support zone is known;
- hard invalidation beneath support is known;
- nearest reversal level is known or can be derived;
- first and second meaningful upside levels are known.

### 12.3 Stage 1 — Support test

The first visible indication completes when price enters the support eligibility zone or tests the support zone.

The card should immediately identify the possible setup.

Trader-facing wording example:

> Price entered the $1.22–$1.25 premarket support zone. A support-bounce setup may be forming.

### 12.4 Stage 2 — Support holds

Support-hold evidence may include:

- price stops producing lower lows;
- one or more candles close above the support zone;
- lower-wick rejection appears;
- selling volume slows or contracts;
- a small base forms;
- a higher low forms;
- the hard invalidation remains intact.

Trader-facing wording example:

> Support is holding and price has stopped making lower lows. A higher low is beginning to form.

### 12.5 Stage 3 — Reversal confirmation

The final event completes when price breaks the nearest meaningful lower high or reversal level with adequate participation while support remains intact.

Trader-facing wording example:

> Price broke the $1.31 reversal level on increasing volume. The premarket-support bounce sequence is detected.

### 12.6 Event-merging rule

A fast rejection from support may satisfy the support-test and initial support-hold facts during one candle. The event engine may complete two logical stages in one update when the evidence is objective.

### 12.7 Reset conditions

Reset when:

- price enters the support eligibility zone but moves away without a clean test;
- the first test is inconclusive while hard support remains intact;
- a new valid support test can occur later.

### 12.8 Invalidation conditions

Invalidate when:

- price closes and accepts below support;
- selling volume continues accelerating below support;
- buyers do not respond and lower lows continue;
- expected confirmation would leave insufficient room to the first meaningful resistance;
- execution quality becomes unacceptable.

A support-bounce failure may simultaneously begin the opening flush-and-reclaim sequence.

---

## 13. Setup 3 — Opening flush and reclaim

### 13.1 Purpose

Detect a fast failure below planned support, recovery of that support, and a confirmed reversal while the flush low remains intact.

### 13.2 Required context

- planned support or reclaim level is known;
- hard or secondary support beneath it is known;
- opening price and VWAP are available;
- nearest lower high after the flush can be derived.

### 13.3 Stage 1 — Flush below support

The first visible indication completes when price breaks below planned support and reaches the intended flush area.

Trader-facing wording example:

> Price flushed below $2.80 support. A flush-and-reclaim reversal is now possible if $2.80 is recovered.

This is not a bullish confirmation. It starts the sequence.

### 13.4 Stage 2 — Reclaim support

The reclaim event is required.

Evidence includes:

- price trades back above the failed support;
- price closes or remains accepted above the level according to configuration;
- time below support is limited;
- the flush low remains intact;
- reclaim volume improves;
- continued selling fails.

Trader-facing wording example:

> Price reclaimed $2.80 on increasing volume. The detector is watching for reclaimed support to hold.

### 13.5 Stage 3 — Hold and reverse

The final event completes when:

- reclaimed support holds;
- a higher low forms above or near the reclaimed level;
- price breaks the nearest lower high or reversal resistance;
- the flush low remains intact;
- meaningful room remains toward VWAP or the next resistance.

Trader-facing wording example:

> Reclaimed support held and price broke the $2.94 reversal level. The opening flush-and-reclaim sequence is detected.

### 13.6 Required order

The normal valid path is:

```text
flush below support
  -> reclaim support
  -> hold reclaimed support and break reversal resistance
```

The reclaim stage cannot be skipped. Without a reclaim, the action remains a breakdown rather than a bullish reversal setup.

### 13.7 Reset conditions

Reset may occur if:

- price briefly breaks support but returns to the prior range without establishing a distinct flush low;
- the reclaim attempt is inconclusive but the low has not failed;
- detector configuration permits a fresh reclaim attempt within the event window.

### 13.8 Invalidation conditions

Invalidate when:

- the flush low breaks after reclaim;
- price accepts back below reclaimed support;
- selling volume accelerates again;
- the reclaim is too weak to establish a usable reversal level;
- data, spread, or liquidity becomes unacceptable.

---

## 14. Setup 4 — Opening-drive first pullback

### 14.1 Purpose

Detect a qualifying opening drive, the first controlled pullback, and continuation through the pullback high.

### 14.2 Required context

- opening price is known;
- opening VWAP is available;
- relevant breakout or support levels are known;
- opening volume and recent candle ranges are available;
- next meaningful resistance is known.

### 14.3 Stage 1 — Qualifying opening drive

The first visible indication completes when the opening move qualifies as a drive.

Supporting evidence may include:

- strong upward movement after the bell;
- elevated opening volume;
- price above VWAP;
- price holding or breaking planned resistance;
- strong candle bodies;
- closes near candle highs;
- limited upper-wick rejection;
- acceptable spread and quote continuity;
- move not already excessively extended into resistance.

Trader-facing wording example:

> A qualifying opening drive has formed above VWAP. The detector is waiting for the first controlled pullback.

### 14.4 Stage 2 — Controlled first pullback

This stage is required because the setup specifically describes the first pullback.

Evidence includes:

- price pulls back from the opening-drive high;
- pullback volume is lower than drive volume;
- pullback candles are smaller than drive candles;
- the breakout level or opening support remains intact;
- VWAP remains intact or is immediately recovered under permitted rules;
- the pullback does not retrace an excessive portion of the drive;
- a higher low forms or begins forming.

Trader-facing wording example:

> The first pullback is controlled. Volume has declined, the breakout level remains intact, and price is forming a higher low.

### 14.5 Stage 3 — Continuation

The final event completes when:

- price breaks the pullback high or nearest meaningful lower high;
- volume expands again;
- the higher low remains intact;
- price remains above VWAP;
- the next meaningful resistance still provides usable room.

Trader-facing wording example:

> Price broke the pullback high on renewed volume. The opening-drive first-pullback sequence is detected.

### 14.6 Required order

The normal valid path is:

```text
qualifying opening drive
  -> controlled first pullback
  -> continuation through pullback high
```

The pullback stage cannot be skipped. A direct move higher remains an opening drive, not a first-pullback setup.

### 14.7 Reset conditions

Reset when:

- the opening drive remains valid but the first pullback has not clearly begun;
- an early shallow pause does not meet the pullback definition;
- a later first meaningful pullback may still form.

### 14.8 Invalidation conditions

Invalidate when:

- pullback volume exceeds or materially challenges drive volume;
- price loses VWAP and remains below it;
- the opening breakout level fails;
- the pullback becomes a lower-low sequence;
- the stop required beneath the pullback becomes too wide;
- resistance is too close to the expected continuation entry.

---

## 15. Setup adaptation

The detector must adapt as price moves from one setup environment to another.

Example:

1. Price approaches the premarket high.
2. Premarket-high breakout Stage 1 appears.
3. Price breaks the high; Stage 2 appears.
4. The breakout fails.
5. Price drops toward premarket support.
6. Support-bounce Stage 1 appears.
7. Support fails.
8. Support bounce invalidates.
9. Flush-and-reclaim Stage 1 begins immediately.
10. Price reclaims support; Stage 2 appears.
11. Price breaks the reversal high; Stage 3 completes.

The event history should preserve the explanation:

```text
09:31:12 — Premarket-high breakout approach became visible.
09:31:48 — Price broke the premarket high.
09:32:10 — Breakout failed and accepted below the level.
09:33:07 — Price entered premarket support.
09:33:29 — Support failed; support-bounce sequence invalidated.
09:33:29 — Opening flush-and-reclaim sequence began.
09:34:16 — Support was reclaimed.
09:35:02 — Reversal resistance broke; setup detected.
```

The detector should never overwrite history in a way that hides why its interpretation changed.

---

## 16. Concurrent setups

### 16.1 Across stocks

Every qualified stock runs all four detectors simultaneously.

The screen may therefore show setup progress on several stocks at once.

### 16.2 On one stock

Compatible setup sequences may coexist.

Example:

- Premarket-high breakout has completed its breakout stage.
- The same move qualifies as an opening drive.
- The breakout detector waits for hold or continuation.
- The first-pullback detector waits for a controlled pullback.

Both may appear on the card with their own progress.

### 16.3 Incompatible setup handling

When the chart invalidates one environment and starts another:

- mark the prior setup reset or invalidated;
- explain why;
- create or advance the new setup sequence;
- preserve both histories.

---

## 17. Card and screen design

## 17.1 Four-stock primary screen

The preferred desktop layout is a stable two-by-two grid of four stock cards.

All four remain visible so the trader can compare development without losing spatial orientation.

If more than four stocks qualify:

- continue tracking all qualified stocks;
- show the four highest current watch priorities in the grid;
- show overflow candidates in a compact secondary list;
- avoid constantly reordering cards on every tick;
- promote an overflow ticker only after a meaningful setup event or material opportunity improvement.

## 17.2 Card header

Display:

- ticker;
- current price;
- current session percentage change;
- stock Strength Level 1, 2, or 3;
- current data freshness indicator;
- halt indicator when applicable.

Strength level should be visible but secondary.

## 17.3 Live condition strip

Display compact objective facts such as:

- above or below VWAP;
- current volume pace;
- relative volume when available;
- float turnover when available;
- spread status;
- nearest support;
- nearest resistance.

## 17.4 Setup section

For every active or started setup, display:

- setup name;
- current readable status;
- completed event indicators;
- current event being watched;
- next required event;
- invalidation condition;
- short plain-language explanation.

Dormant setups do not need full event rows. A compact contingency label is sufficient until the first event occurs.

## 17.5 Visual event indicators

Use three simple visual states:

- unmet event — neutral empty indicator;
- completed event — completed indicator;
- current event being watched — active directional indicator.

Example:

```text
Premarket-high breakout — Developing

[✓] Price approached $3.20 with higher lows
[✓] Price broke $3.20 on increasing volume
[→] Waiting for $3.20 to hold or direct continuation above $3.28
```

The card should make progress understandable without requiring the trader to decode E, F, and G.

## 17.6 Plain-language explanation

Each state change should produce a concise explanation.

Example:

> Buyers pushed through premarket resistance. The breakout is not complete yet because the system is waiting to see whether $3.20 holds or price continues above the post-breakout high.

The explanation must be generated from deterministic facts. It should not invent trader intent or claim certainty about future movement.

## 17.7 Setup progression emphasis

Suggested card emphasis:

- neutral — no setup event;
- one completed event — setup awareness;
- two completed events — setup developing;
- complete path — setup detected;
- complete path with limited room — detected, limited range;
- complete path with favourable room — detected, favourable geometry;
- invalidated — clearly marked with reason.

Setup progression should drive card prominence more than strength level.

---

## 18. Percentage room and level display

## 18.1 Main card language

The card may show:

```text
First level: $1.48 | +18.4%
Second level: $1.65 | +32.0%
Invalidation: $1.19 | -4.8%
```

or the compact form:

```text
T1 +18.4% | T2 +32.0% | Risk -4.8%
```

## 18.2 Percentage formula

For an upside level:

```text
percentageToLevel = ((levelPrice - basisPrice) / basisPrice) * 100
```

For downside to invalidation:

```text
percentageToInvalidation = ((basisPrice - invalidationPrice) / basisPrice) * 100
```

For reward-to-risk:

```text
rewardRisk = (levelPrice - basisPrice) / (basisPrice - invalidationPrice)
```

All calculations must guard against missing, zero, inverted, or stale inputs.

## 18.3 Basis selection

Use this ordered basis model:

### Before trigger is estimable

Use current price.

Label:

> First level: +18.4% from current price

### Trigger or expected confirmation is known

Use the expected trigger or confirmation price.

Label:

> First level after trigger: +14.7% from $1.29

### Setup detected

Use the detected confirmation price or explicit system entry basis.

Label:

> First level: +13.9% from confirmation

The basis and timestamp should be stored in the setup instance.

## 18.4 Dynamic updates

Percentage room updates whenever:

- current price changes before a trigger basis is known;
- expected trigger changes;
- confirmation occurs;
- first or second meaningful level changes due to a new level set;
- invalidation changes due to newly confirmed structure.

## 18.5 Geometry labels

The UI may supplement raw percentages with deterministic labels:

- `limited` — first meaningful level is too close relative to invalidation;
- `balanced` — usable but not exceptional geometry;
- `favourable` — meaningful room relative to invalidation;
- `extended` — much of the available range has already been consumed;
- `unavailable` — entry, invalidation, or target cannot be estimated reliably.

These labels must be rule-based and configurable.

## 18.6 First event remains visible even with limited room

The first event should still appear because it improves trader awareness.

However, the card must not imply that the setup is attractive when geometry is poor.

Example:

```text
Potential support bounce

[✓] Price tested $1.25 support
[→] Waiting for support to hold

First level after estimated trigger: +4.1%
Geometry: Limited — strong resistance is close to the expected entry.
```

This distinction preserves transparency without promoting a poor trade.

---

## 19. Opportunity priority

## 19.1 No mandatory best stock before a setup

Before meaningful setup events occur, the screen may simply show all qualified stocks and their strength levels.

It should not claim one is the best trade.

## 19.2 Dynamic opportunity priority

Once setups begin forming, priority is driven mainly by:

1. setup progression;
2. clarity of the next required event;
3. expected entry location;
4. distance to invalidation;
5. percentage room to the first meaningful level;
6. percentage room to the second meaningful level;
7. reward-to-risk;
8. current volume and liquidity;
9. spread;
10. strength level as secondary context.

## 19.3 Ties are allowed

Several stocks may have equal opportunity priority.

The system must not create false precision merely to sort them.

## 19.4 Stable visual layout

Priority should influence emphasis more than constant card movement.

The trader should be able to keep watching one location on the screen while event indicators advance.

---

## 20. Reset, invalidation, and expiration

## 20.1 Reset

Use reset when the current attempt did not complete but the overall setup remains possible.

Examples:

- price approaches resistance and pulls away without breaking it;
- support is approached but not meaningfully tested;
- an early breakout attempt fails harmlessly while major support remains intact;
- the opening drive pauses but the first true pullback has not formed.

A reset may return the setup to `watching` or `potential`.

## 20.2 Invalidation

Use invalidation when the setup’s required market structure has failed.

Examples:

- support-bounce support accepts below the zone;
- flush-and-reclaim low fails after reclaim;
- premarket-high breakout accepts back below resistance and loses must-hold support;
- opening-drive pullback loses VWAP and the opening breakout structure.

The UI must explain the exact reason.

## 20.3 Expiration

Use expiration when:

- too much time passes between required events;
- the event sequence becomes stale;
- a new level set replaces the relevant context;
- a later session phase makes the opening setup no longer meaningful;
- the ticker leaves the qualified monitoring set.

## 20.4 Event windows

Each setup defines configurable maximum windows between stages.

For the first version, windows may be expressed in completed one-minute candles or elapsed seconds. They must be stored in configuration and tuned through replay.

A breakout at 9:31 must not incorrectly complete from unrelated continuation at 10:20.

---

## 21. Data and evaluation cadence

### 21.1 Streaming updates

Update current price, spread, distance, and potential-level percentages on live quote or trade updates.

### 21.2 Event evaluation

Evaluate event transitions on:

- meaningful level crosses;
- new trades beyond configured buffers;
- one-minute candle updates;
- one-minute candle closes;
- five-minute candle closes where the rule requires them;
- VWAP state changes;
- swing-high or swing-low confirmation;
- volume-ratio changes;
- halt or resume events;
- level-set version changes.

### 21.3 Idempotency

Repeated identical market updates must not duplicate setup events.

Every event should have a deterministic identity based on:

- ticker;
- session date;
- setup instance;
- event type;
- source candle or source timestamp;
- relevant level version.

### 21.4 Out-of-order data

The detector must reject or safely reconcile out-of-order updates. It must not move a setup backward or complete an event using older data without an explicit replay mode.

---

## 22. Suggested contracts

The exact code shape may differ, but implementation should preserve these concepts.

### 22.1 Qualified stock

```ts
interface QualifiedOpeningStock {
  symbol: string;
  sessionDate: string;
  strengthLevel: 1 | 2 | 3;
  qualificationReasons: string[];
  objectiveWarnings: string[];
  plannedLevels: PlannedOpeningLevels;
  premarketFacts: PremarketFacts;
  dataQuality: DataQualityState;
}
```

### 22.2 Unified live snapshot

```ts
interface UnifiedOpeningMarketSnapshot {
  symbol: string;
  observedAt: string;
  lastPrice: number;
  bidPrice?: number;
  askPrice?: number;
  spreadAmount?: number;
  spreadPercent?: number;
  regularSessionOpen?: number;
  highOfDay?: number;
  lowOfDay?: number;
  regularSessionVwap?: number;
  oneMinuteCandles: Candle[];
  fiveMinuteCandles: Candle[];
  cumulativeVolume: number;
  sessionState: MarketSessionState;
  haltState: HaltState;
  dataQuality: DataQualityState;
  derived: UnifiedDerivedOpeningFacts;
}
```

### 22.3 Setup definition

```ts
interface OpeningLongSetupDefinition {
  setupFamily: OpeningLongSetupFamily;
  version: string;
  eligibilityRules: SetupRule[];
  eventDefinitions: SetupEventDefinition[];
  validPaths: SetupEventPath[];
  resetRules: SetupRule[];
  invalidationRules: SetupRule[];
  expirationRules: SetupRule[];
}
```

### 22.4 Setup instance

```ts
interface OpeningLongSetupInstance {
  id: string;
  symbol: string;
  sessionDate: string;
  setupFamily: OpeningLongSetupFamily;
  state: OpeningLongSetupState;
  completedEvents: CompletedSetupEvent[];
  expectedEvents: string[];
  startedAt?: string;
  updatedAt: string;
  detectedAt?: string;
  resetCount: number;
  failedAttemptCount: number;
  triggerPrice?: number;
  expectedConfirmationPrice?: number;
  detectedConfirmationPrice?: number;
  invalidationPrice?: number;
  firstLevel?: SetupLevelProjection;
  secondLevel?: SetupLevelProjection;
  geometry?: SetupGeometry;
  explanation: string;
  ruleVersion: string;
  levelSetVersion: string;
}
```

### 22.5 Card projection

```ts
interface OpeningSetupCardProjection {
  symbol: string;
  currentPrice: number;
  strengthLevel: 1 | 2 | 3;
  vwapState: string;
  volumeState: string;
  spreadState: string;
  support?: number;
  resistance?: number;
  activeSetups: SetupCardProgress[];
  firstLevelLabel?: string;
  secondLevelLabel?: string;
  invalidationLabel?: string;
  geometryLabel?: string;
  updatedAt: string;
}
```

These contracts should be deterministic and serializable so they can support replay tests, UI snapshots, and future downstream delivery.

---

## 23. Trader-facing event language

The system should maintain deterministic message templates.

### 23.1 Premarket-high breakout

- “Price is approaching the premarket high with higher lows.”
- “Price broke the premarket high on increasing volume.”
- “The former premarket high is holding as support.”
- “Price continued above the post-breakout high.”
- “The breakout failed and price accepted back below resistance.”

### 23.2 Premarket-support bounce

- “Price entered the premarket support zone.”
- “Support is holding and price has stopped making lower lows.”
- “A higher low formed above support.”
- “Price broke the nearest reversal level.”
- “Support failed and the bounce setup is invalidated.”

### 23.3 Opening flush and reclaim

- “Price flushed below planned support.”
- “Price reclaimed the failed support level.”
- “Reclaimed support is holding.”
- “Price broke reversal resistance.”
- “The reclaim failed and price made a new low.”

### 23.4 Opening-drive first pullback

- “A qualifying opening drive formed above VWAP.”
- “The first controlled pullback has started.”
- “Pullback volume is declining and support remains intact.”
- “A higher low formed during the pullback.”
- “Price broke the pullback high and resumed upward.”
- “The pullback failed after price lost opening support.”

Every message should include actual levels and objective evidence when available.

---

## 24. Example four-card state

### Card A

```text
ABCD | $3.18 | Strength Level 1
Above VWAP | Very high volume | Spread acceptable

Premarket-high breakout — Developing
[✓] Price approached $3.20 with higher lows
[✓] Price broke $3.20 on increasing volume
[→] Waiting for $3.20 to hold or continuation above $3.28

First level after trigger: $3.48 | +8.8%
Second level after trigger: $3.70 | +15.6%
Invalidation: $3.10 | -3.1%
```

### Card B

```text
EFGH | $1.25 | Strength Level 3
Near support | High volume | Spread acceptable

Premarket-support bounce — Potential
[✓] Price entered $1.22–$1.25 support
[→] Waiting for support to hold
[ ] Break reversal level at $1.29

First level after expected trigger: $1.48 | +14.7%
Invalidation: $1.19 | -7.8%
```

### Card C

```text
IJKL | $2.86 | Strength Level 2
Below prior support | Reclaim volume improving

Opening flush and reclaim — Developing
[✓] Price flushed below $2.80
[✓] Price reclaimed $2.80
[→] Waiting for $2.80 to hold and $2.96 to break

First level after expected trigger: $3.30 | +11.5%
Invalidation: $2.74 | -7.4%
```

### Card D

```text
MNOP | $4.12 | Strength Level 1
Above VWAP | High volume | Spread acceptable

No opening long setup is currently forming.
Nearest support: $3.90
Nearest resistance: $4.20
First meaningful level from current price: +1.9%
```

The trader can see progress, next conditions, and range without the system forcing a trade.

---

## 25. Testing and validation

## 25.1 Unit tests

Test:

- every event rule independently;
- every valid path;
- optional breakout retest path;
- required reclaim path;
- required first-pullback path;
- setup reset;
- setup invalidation;
- setup expiration;
- event merging in one candle;
- duplicate-event prevention;
- percentage calculations;
- basis switching;
- first-level selection;
- stale-data blockers;
- level-version changes.

## 25.2 Sequence tests

Create deterministic candle and quote sequences for:

- clean premarket-high break, retest, and continuation;
- clean direct breakout continuation;
- false breakout;
- support test, hold, and reversal;
- support failure transitioning into flush and reclaim;
- flush without reclaim;
- reclaim that later fails;
- opening drive, controlled pullback, and continuation;
- opening drive with heavy pullback failure;
- simultaneous compatible setup sequences;
- no setup forming.

## 25.3 Replay tests

Replay real historical opening sessions for qualified and rejected stocks.

Capture:

- candidate qualification result;
- strength level;
- every setup event timestamp;
- setup state transitions;
- percentages shown at each stage;
- detected confirmation price;
- invalidation or completion reason;
- false positives;
- missed setups;
- stale or duplicate events.

## 25.4 UI tests

Verify:

- four cards remain readable at common desktop resolutions;
- event progression is visually obvious;
- multiple setups can appear on one card;
- invalidated setup history remains understandable;
- percentages identify their basis;
- card order does not thrash;
- stale data is clearly visible;
- overflow stocks remain accessible.

## 25.5 Acceptance examples

The detector passes the product baseline when:

- no setup is emitted merely because a stock qualified;
- the first meaningful event appears visibly on the correct card;
- later events advance only in valid order;
- optional breakout paths work;
- required reclaim and pullback stages cannot be skipped;
- setup changes are explained;
- a failed support bounce can transition into flush and reclaim;
- all qualified stocks continue receiving unified live inputs;
- percentage room updates from the correct basis;
- a Level 3 stock can become the best current opportunity;
- a Level 1 stock can remain without a setup;
- no catalyst judgment is required.

---

## 26. Implementation phases

## Phase 1 — Contracts and unified facts

Deliver:

- qualified-stock contract;
- premarket facts contract;
- unified live snapshot;
- derived candle, volume, VWAP, structure, and geometry facts;
- data-quality contract;
- deterministic fixtures.

Do not implement setup logic until the normalized facts are reliable.

## Phase 2 — Qualification and strength levels

Deliver:

- objective hard qualification blockers;
- no-fixed-count qualification output;
- Level 1, Level 2, and Level 3 classification;
- tie support;
- qualification explanations;
- replay fixtures.

## Phase 3 — Generic sequence engine

Deliver:

- setup definitions;
- setup instances;
- event evaluation;
- allowed transitions;
- optional events and alternate paths;
- reset, invalidation, and expiration;
- event identity and deduplication;
- deterministic event journal.

## Phase 4 — Four setup detectors

Implement in this order:

1. Premarket-high breakout
2. Premarket-support bounce
3. Opening flush and reclaim
4. Opening-drive first pullback

The support-bounce-to-flush-reclaim transition should receive dedicated tests.

## Phase 5 — Geometry and level percentages

Deliver:

- current-price basis;
- expected-trigger basis;
- detected-confirmation basis;
- first and second meaningful level projections;
- invalidation percentage;
- reward-to-risk;
- deterministic geometry labels;
- basis-change history.

## Phase 6 — Four-card UI

Deliver:

- stable two-by-two layout;
- strength context;
- setup event indicators;
- next-event text;
- plain-language explanations;
- percentage level display;
- invalidation display;
- multiple setup support;
- overflow candidate list.

## Phase 7 — Historical replay and tuning

Use saved sessions to tune:

- eligibility buffers;
- event windows;
- volume ratios;
- acceptance rules;
- swing identification;
- geometry labels;
- card promotion behaviour.

Tuning must not change historical results silently. Every detector rule set needs an explicit version.

---

## 27. Future extension points

The first version should leave room for these additions without requiring them now.

### 27.1 Confirmation variants

Possible future variants:

- fast confirmation;
- standard confirmation;
- five-minute confirmation;
- aggressive and conservative paths.

These should become additional valid paths or confirmation policies inside the same sequence engine rather than separate detector architectures.

### 27.2 Additional long setups

Possible later families:

- five-minute opening-range breakout;
- VWAP reclaim;
- high-of-day break and retest;
- consolidation continuation;
- trend-support pullback;
- multi-day continuation.

### 27.3 Advanced market data

Possible later facts:

- trade speed;
- time-and-sales direction estimates;
- bid-ask depth;
- Level 2 liquidity shifts;
- halt reopening structure;
- adaptive volatility regimes.

### 27.4 Separate catalyst intelligence

Catalyst analysis may be added as an independent, confidence-aware service. It must not become a hidden prerequisite for deterministic technical setup truth.

### 27.5 Learned tuning

Historical outcomes may later tune thresholds, but learned models should not replace auditable setup events without an explicit product decision.

---

## 28. Final operating principles

1. Start with the leading premarket universe.
2. Keep every stock that objectively qualifies as tradable.
3. Do not force a fixed final count.
4. Assign Strength Level 1, 2, or 3 as secondary context.
5. Do not grade catalysts in the technical detector.
6. Feed all qualified stocks through one unified live-data model.
7. Run all four setup detectors for every stock.
8. Let current price location and structure determine which setup becomes possible.
9. Show the first meaningful setup event on the card.
10. Show every later event and explain why it matters.
11. Allow optional steps only where the setup definition explicitly permits them.
12. Reset harmless failed attempts and invalidate true structural failures.
13. Preserve event history when the chart adapts from one setup to another.
14. Calculate percentage room from an honest and clearly labelled basis.
15. Use the first meaningful resistance rather than every minor level.
16. Keep setup progress separate from trade geometry.
17. Let a Level 3 stock become the best current opportunity.
18. Let a Level 1 stock remain only a watch.
19. Permit ties.
20. Accept “no setup” as a correct result.
21. Never lower setup standards merely because the screen is quiet.
22. The detector waits for setups to come to it.

---

## 29. Definition of done for the first production-capable version

The first version is complete when the runtime can:

- ingest a premarket candidate set;
- qualify every objectively tradable stock without forcing a count;
- assign stable Level 1, Level 2, or Level 3 context;
- generate and retain the required planned level context;
- maintain unified live inputs for every qualified stock;
- run four independent deterministic setup state machines per stock;
- visibly display the first meaningful event;
- visibly display later events in plain language;
- support the alternate breakout path without requiring a retest;
- require reclaim for the flush-and-reclaim setup;
- require a pullback for the first-pullback setup;
- adapt from a failed setup to another valid setup;
- show first and second levels with dynamic percentage room;
- show invalidation and reward-to-risk from the correct basis;
- keep all primary stock cards understandable at once;
- preserve an auditable event journal;
- replay historical sessions deterministically;
- produce no setup when no valid sequence forms.

This document is the baseline product contract for that implementation.