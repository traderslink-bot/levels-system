# Modular Signal Categories Plan

Date: 2026-04-29
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document proposes a modular expansion plan for the levels system so it can deliver more trader-useful information without turning into one giant always-on signal engine.

The key product requirement is:

> different information categories must be independently switchable on or off.

Examples:
- support / resistance can be enabled while market structure is disabled
- market structure can be enabled while candle-pattern interpretation is disabled
- reaction quality can be enabled while chart-pattern detection is disabled
- trader-facing Discord output can stay narrow even if richer operator-only categories are enabled internally

This plan is intended to guide system design, coding structure, runtime configuration, and future trader-facing output decisions.

---

## High-Level Design Principle

The system should not be built as one monolithic stream of mixed ideas.
It should be built as a **modular signal platform** where each major class of information can be:
- computed independently
- enabled or disabled independently
- exposed to live Discord separately from operator artifacts
- tested independently
- scored independently
- tuned independently

That means every future signal feature should belong to an explicit category.

---

## Main Category Model

Below is the recommended category model for the project.

## 1. Support / Resistance Category

This is the current foundation and should remain its own first-class module.

### Scope
- support levels
- resistance levels
- laddered levels
- extension levels
- nearest support / nearest resistance
- level freshness
- level durability
- level exhaustion / tactical wear
- level snapshots
- next-level extension posts

### Why it should stay separate
This is the core map layer.
It is useful even if every other category is disabled.

### Suggested toggle key
- `support_resistance`

### Output surfaces
- live Discord: yes
- operator artifacts: yes
- internal engine: yes

---

## 2. Market Structure Category

This should be its own independent category, separate from support/resistance.

### Scope
- higher high attempts
- higher low holds
- lower high formation
- lower low risk
- reclaim of prior pivot
- loss of prior pivot
- trend structure improving
- trend structure weakening
- structure break attempts
- shift from range to trend, or trend to damage

### Why it should be separate
A trader may want only support/resistance and not want structure commentary.
Another trader may want structure context heavily.

### Suggested toggle key
- `market_structure`

### Output surfaces
- live Discord: yes, selectively
- operator artifacts: yes
- internal engine: yes

---

## 3. Pivot Category

Pivots should be separate from both raw support/resistance and higher-level structure narration.

### Scope
- latest confirmed swing high
- latest confirmed swing low
- reclaim pivot
- failure pivot
- decision pivot
- pivot-based invalidation context
- pivot-based reclaim context

### Why it should be separate
Pivots are very valuable but not identical to support/resistance.
A trader may want pivot context without full structure narration.

### Suggested toggle key
- `pivots`

### Output surfaces
- live Discord: yes, selectively
- operator artifacts: yes
- internal engine: yes

---

## 4. Range / Compression State Category

This category captures whether price is balanced, compressing, or moving toward a decision.

### Scope
- inside range
- near range high
- near range low
- compressing under resistance
- compressing above support
- higher-low compression
- failed move back into range
- reclaim back into range
- balance versus expansion state

### Why it should be separate
This is valuable for traders, but it is not the same as market structure or pure support/resistance.

### Suggested toggle key
- `range_compression`

### Output surfaces
- live Discord: yes
- operator artifacts: yes
- internal engine: yes

---

## 5. Breakout / Reclaim / Failure Quality Category

This should be a separate category focused on the quality of directional moves.

### Scope
- breakout attempt quality
- breakout confirmation quality
- breakout rejection / failed breakout quality
- breakdown risk for longs
- reclaim quality
- reclaim with room versus reclaim into immediate overhead
- fake breakdown recovery quality
- early breakout versus stretched breakout

### Why it should be separate
This is one of the most useful live categories for traders, but it should be separately controllable.

### Suggested toggle key
- `breakout_reclaim_quality`

### Output surfaces
- live Discord: yes
- operator artifacts: yes
- internal engine: yes

---

## 6. Support / Resistance Reaction Quality Category

This category focuses on what kind of reaction price is having at the level.

### Scope
- clean bounce
- weak bounce
- repeated testing
- support defense weakening
- resistance getting worn down
- rejection quality
- hold quality
- reclaim follow-through quality
- reaction reliability

### Why it should be separate
This is not the same as support/resistance existence.
It is about the quality of the interaction.

### Suggested toggle key
- `reaction_quality`

### Output surfaces
- live Discord: yes
- operator artifacts: yes
- internal engine: yes

---

## 7. Volume / Activity Context Category

This should remain optional and modular, but it is likely one of the strongest future categories.

### Scope
- activity increasing into breakout attempt
- weak activity on bounce
- fading activity on extension
- strong volume on reclaim
- thin breakout attempt
- crowding or participation quality
- activity backing the move versus not backing it

### Why it should be separate
This category may require more provider support and more careful validation.
It should not be forced on all runtime modes.

### Suggested toggle key
- `volume_activity`

### Output surfaces
- live Discord: yes, once trusted
- operator artifacts: yes
- internal engine: yes

---

## 8. Candle Meaning Category

Candle-level interpretation should be separate from broader market structure.

### Scope
- bullish rejection candle meaning
- bearish rejection against longs
- indecision at resistance
- strong expansion candle
- failed breakout candle feel
- strong defense candle at support

### Important note
This category should preferably expose **meaning**, not textbook candle labels.
For example:
- `buyers rejected lower prices`
not
- `hammer candle`

### Suggested toggle key
- `candle_meaning`

### Output surfaces
- live Discord: maybe, sparingly
- operator artifacts: yes
- internal engine: yes

---

## 9. Chart Pattern Context Category

Pattern context should also be modular.

### Scope
- flag-like pullback after extension
- base under resistance
- rounded reclaim attempt
- double support test
- failed breakout shape
- compression pattern
- range expansion setup

### Important note
This category should prefer descriptive pattern language over hard textbook claims unless confidence is high.

### Suggested toggle key
- `pattern_context`

### Output surfaces
- live Discord: yes, sparingly
- operator artifacts: yes
- internal engine: yes

---

## 10. Follow-Through / Outcome Category

This category already exists in part and should stay explicitly modular.

### Scope
- move still holding up
- move stalling
- move failing
- move reclaiming after weakness
- first target reached
- path still open versus now tight
- post-alert result tracking
- family-level outcome tracking

### Why it should be separate
A trader may want setup alerts but not constant follow-through narration, or vice versa.

### Suggested toggle key
- `follow_through`

### Output surfaces
- live Discord: yes, tightly gated
- operator artifacts: yes
- internal engine: yes

---

## 11. Trader Recap / Commentary Category

This should stay a separate category because it is a presentation layer, not a raw signal category.

### Scope
- continuity updates
- recap posts
- state summaries
- AI recap enhancement
- what matters next summaries

### Why it should be separate
You may want the engine and alert categories running while recap/commentary is disabled.

### Suggested toggle key
- `trader_commentary`

### Output surfaces
- live Discord: yes, tightly gated
- operator artifacts: yes
- internal engine: no, this is presentation

---

## 12. Operator Review / Diagnostics Category

This should be explicitly separate from all trader-facing categories.

### Scope
- review artifacts
- audit reports
- replay simulation
- clutter reports
- policy reports
- operator status
- activation/recovery diagnostics
- tuning suggestions

### Why it should be separate
This category should never leak directly into trader-facing Discord output.

### Suggested toggle key
- `operator_review`

### Output surfaces
- live Discord: no
- operator artifacts: yes
- internal engine: yes

---

## Recommended Category Groups

To keep things manageable, Codex should group these categories into larger layers.

### Layer A. Core price map
- `support_resistance`
- `pivots`

### Layer B. Price state and directional context
- `market_structure`
- `range_compression`
- `breakout_reclaim_quality`
- `reaction_quality`

### Layer C. Extra interpretive context
- `volume_activity`
- `candle_meaning`
- `pattern_context`

### Layer D. Post-event trade management context
- `follow_through`
- `trader_commentary`

### Layer E. Operator-only review
- `operator_review`

---

## Configuration / Toggle Design Recommendation

Codex should not hardcode this as many scattered booleans.
It should use one typed configuration structure.

### Suggested config shape

```ts
export type SignalCategoryConfig = {
  support_resistance: boolean;
  pivots: boolean;
  market_structure: boolean;
  range_compression: boolean;
  breakout_reclaim_quality: boolean;
  reaction_quality: boolean;
  volume_activity: boolean;
  candle_meaning: boolean;
  pattern_context: boolean;
  follow_through: boolean;
  trader_commentary: boolean;
  operator_review: boolean;
};
```

### Suggested higher-level profile support

Also allow named profiles, for example:
- `minimal`
- `levels_only`
- `levels_plus_structure`
- `trader_balanced`
- `operator_full`

Example:

```ts
export type SignalCategoryProfile =
  | "minimal"
  | "levels_only"
  | "levels_plus_structure"
  | "trader_balanced"
  | "operator_full";
```

And a resolver:

```ts
function resolveSignalCategoryConfig(profile: SignalCategoryProfile): SignalCategoryConfig
```

This is better than only environment variables because it gives you presets while still allowing overrides.

---

## Output-Surface Separation Rule

Each category should also be controllable by surface.

That means a category can be:
- enabled internally
- enabled in operator review
- disabled in live Discord

Example:
- `pattern_context` could be computed and shown in operator reports, but turned off for Discord
- `volume_activity` could be used for internal scoring, but not yet shown live
- `market_structure` could be live in Discord while `candle_meaning` stays operator-only

### Suggested surface config shape

```ts
export type SignalSurfaceConfig = {
  liveDiscord: boolean;
  operatorArtifacts: boolean;
  internalScoring: boolean;
};

export type SignalSurfaceMatrix = {
  support_resistance: SignalSurfaceConfig;
  pivots: SignalSurfaceConfig;
  market_structure: SignalSurfaceConfig;
  range_compression: SignalSurfaceConfig;
  breakout_reclaim_quality: SignalSurfaceConfig;
  reaction_quality: SignalSurfaceConfig;
  volume_activity: SignalSurfaceConfig;
  candle_meaning: SignalSurfaceConfig;
  pattern_context: SignalSurfaceConfig;
  follow_through: SignalSurfaceConfig;
  trader_commentary: SignalSurfaceConfig;
  operator_review: SignalSurfaceConfig;
};
```

This will make the system much easier to evolve safely.

---

## Trader-Facing Prioritization Recommendation

Not all categories should go live in Discord equally.

### Highest-value trader-facing categories
These should be prioritized for live Discord use:
- `support_resistance`
- `pivots`
- `market_structure`
- `breakout_reclaim_quality`
- `reaction_quality`
- `follow_through`

### Medium-priority trader-facing categories
Use carefully and selectively:
- `range_compression`
- `trader_commentary`
- `volume_activity` once trusted

### Lowest-priority live categories
Prefer these in operator artifacts first:
- `candle_meaning`
- `pattern_context`
- `operator_review`

Reason:
These are easier to overuse and easier to make noisy in live trader threads.

---

## System Design Guidance For Codex

## 1. Every category should have its own contract

Each category should have:
- input type
- output type
- enable/disable gate
- live-surface policy
- tests

Example:

```ts
export type MarketStructureSignal = {
  state: "improving" | "weakening" | "range" | "break_attempt";
  keyPivotHigh?: number;
  keyPivotLow?: number;
  message?: string;
};
```

Do not let categories emerge as loose fields scattered through many files.

## 2. Categories should compose, not merge chaotically

The system should be able to say:
- support/resistance says this is support at 2.10
- pivots says last swing low is 2.08
- market structure says higher low is still intact
- breakout quality says room is limited until 2.18 clears

without requiring one giant all-knowing formatter to invent everything at once.

## 3. Trader-facing formatters should pull from enabled categories only

The formatter should not assume every category is active.
It should be resilient to partial configuration.

That means Discord output builders should gracefully handle:
- levels only
- levels plus pivots
- levels plus structure
- levels plus structure plus follow-through

## 4. Operator artifacts should be richer than live Discord

This is important.

Even if a category is enabled, that does not mean it should be talked about live.
The operator artifacts can be much richer than live trader-facing output.

---

## Suggested Implementation Phases For Codex

## Phase 1. Category framework

### Goal
Create the typed category config and surface matrix.

### Work
- define category enum / keys
- define config object
- define profile resolver
- define surface matrix
- add tests

### Deliverable
A stable configuration foundation for modular categories.

---

## Phase 2. Extract existing categories cleanly

### Goal
Map the existing system into category ownership.

### Existing work likely already maps to:
- `support_resistance`
- `breakout_reclaim_quality`
- `reaction_quality`
- `follow_through`
- `trader_commentary`
- `operator_review`

### Work
- identify which current signals belong to which category
- stop treating all current output as one mixed stream
- thread category awareness through runtime policy and formatter layers

### Deliverable
Current project signals become more modular without changing trader behavior yet.

---

## Phase 3. Add pivots and market structure as explicit categories

### Goal
Add the highest-value next categories first.

### Work
- build pivot signal contract
- build market-structure signal contract
- define how they contribute to live Discord and operator artifacts
- add tests

### Deliverable
The system can independently enable or disable:
- pivots
- market structure

---

## Phase 4. Add range/compression and reaction-quality refinement

### Goal
Improve context around whether price is balanced, compressing, or truly moving.

### Work
- separate range/compression from raw support/resistance
- improve reaction quality outputs
- keep outputs calm and trader-readable

### Deliverable
Cleaner state context for live threads without needing pattern naming.

---

## Phase 5. Add optional interpretive categories later

### Goal
Only after core categories are stable, add richer optional categories.

### Work
- volume/activity
- candle meaning
- pattern context

### Deliverable
These remain modular and can stay operator-only until trusted.

---

## Example Profiles To Support

### `levels_only`
- support/resistance on
- all else off except operator review

### `levels_plus_structure`
- support/resistance on
- pivots on
- market structure on
- range/compression on
- breakout/reclaim quality on
- reaction quality on
- follow-through on
- commentary off or minimal

### `trader_balanced`
- support/resistance on
- pivots on
- market structure on
- breakout/reclaim quality on
- reaction quality on
- follow-through on
- commentary on
- candle/pattern off
- operator review on

### `operator_full`
- everything on
- but live Discord still selective by surface config

---

## Final Recommendation

The best next categories to add are:
1. `pivots`
2. `market_structure`
3. `range_compression`
4. `reaction_quality` refinement
5. `volume_activity` later

The strongest architectural rule is:

> every signal feature must belong to an explicit category that can be independently enabled, independently tested, and independently exposed by output surface.

That is what will let the levels system grow without turning into one giant mixed-output engine.
