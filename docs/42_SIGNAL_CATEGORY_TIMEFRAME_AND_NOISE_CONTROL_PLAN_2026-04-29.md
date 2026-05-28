# Signal Category Timeframe And Noise Control Plan

Date: 2026-04-29
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document is a follow-up to `docs/41_MODULAR_SIGNAL_CATEGORIES_PLAN_2026-04-29.md`.

Its purpose is to define:
- which candle timeframes each signal category should use
- which categories should be allowed to affect live Discord output
- which categories should stay internal or operator-only
- how to prevent new categories from turning the system into a noisy alert engine

This document uses a stricter product rule than a generic feature-expansion plan:

> New categories are only worth adding if they improve trader decision context without materially increasing noise, duplicate narration, or low-value repeat posts.

That means a category being interesting is **not enough**.
It must also be quiet enough to deserve space in the system.

---

## Core Product Rule

### The system should describe meaningful state change, not every observation

This is the main rule Codex should work from.

If the system can say:
- a bullish structure formed
- a higher low is now in place
- a reclaim improved structure
- a support reaction is now cleaner

then the system should usually say it **once** and stop there until a real state change happens.

It should not keep producing new live posts just because:
- another candle printed
- the same condition still exists
- the same structure remains intact
- the same category continues to evaluate as bullish

Good example:
- `Short-term structure improved above 2.18; that level now needs to hold.`

Bad behavior:
- repeatedly posting that structure still looks good every time price ticks slightly higher

### Design principle

Every added category must be designed around:
- state transitions
- hold/fail thresholds
- one-time recognition of the state
- quiet persistence until the state actually changes

If a category cannot be designed that way, it should not be live in Discord.

---

## Category-Level Timeframe Matrix

This section defines the recommended candle-timeframe usage for each category.

For each category, there are four things:
- primary timeframe
- secondary timeframe
- optional confirmation timeframe
- live Discord eligibility

---

## 1. Support / Resistance

### Purpose
Map the price structure around the trader with nearby support, resistance, ladders, and extension levels.

### Timeframes
- primary: `daily`, `4h`, `5m`
- secondary: none beyond those
- confirmation: not applicable

### Notes
This is the foundation map layer and should remain multi-timeframe.

### Live Discord eligibility
- yes

### Noise rule
Support/resistance itself should not create frequent new alerts just because levels exist.
It should mainly drive:
- snapshots
- important break / reclaim / failure context
- next-level extension updates only when the ladder meaningfully changes

---

## 2. Pivots

### Purpose
Track the most recent important swing points that affect reclaim/failure context.

### Timeframes
- primary: `4h`, `5m`
- secondary: `daily` for major pivot context only
- confirmation: not needed if pivot rules are explicit

### Notes
Pivots should not become a second levels system.
They should be used to clarify:
- last important high
- last important low
- reclaim pivot
- failure pivot

### Live Discord eligibility
- yes, but only when pivot state changes matter

### Noise rule
Do not post every new small pivot.
Only post when a pivot becomes the new decision pivot for the setup.

Good example:
- `Price reclaimed the last short-term pivot high; structure improved above 2.18.`

Bad example:
- posting every fresh micro swing high/low

---

## 3. Market Structure

### Purpose
Describe whether structure is improving, weakening, intact, or damaged for longs.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: `daily` only for major context, not frequent live updates

### Notes
Recommended usage:
- `5m` = live structure context
- `4h` = swing context
- `daily` = major backdrop only

### Live Discord eligibility
- yes, but very selectively

### Noise rule
Structure should only post on meaningful state changes such as:
- higher low confirmed
- structure improved above reclaim pivot
- structure weakened below key pivot
- trend structure damaged
- trend structure restored

Do **not** post repeated “still bullish” structure updates.

Preferred live behavior:
- one post when the bullish structure forms
- one post if it fails
- one post if it meaningfully improves again

If that discipline cannot be preserved, market structure should remain operator-only.

---

## 4. Range / Compression

### Purpose
Describe whether price is still inside balance or compressing into a decision area.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: none

### Notes
This is valuable context, especially before breakouts.

### Live Discord eligibility
- yes, but only as low-frequency context

### Noise rule
This category is especially dangerous for overposting.

Compression is a state that can persist for a long time.
So this category should **never** post repeatedly just because compression is still present.

Allowed live behavior:
- first meaningful compression state recognized
- breakout attempt out of compression
- failure back into range
- compression invalidated by loss of key support or reclaim of resistance

If not handled this way, this category will create too much noise.

---

## 5. Breakout / Reclaim / Failure Quality

### Purpose
Describe whether a directional move is early, confirming, stretched, rejected, or failing.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: `4h` when relevant, not mandatory for every live post

### Notes
This is one of the highest-value categories.

### Live Discord eligibility
- yes

### Noise rule
This category should remain one of the main live alert categories, but it still needs dedupe and same-story control.

Allowed live behavior:
- breakout attempt begins
- breakout confirms
- breakout stalls / rejects
- reclaim succeeds
- reclaim fails

Do not repost the same breakout story unless:
- quality meaningfully improves
- quality materially fails
- room/path context materially changes

---

## 6. Reaction Quality At Support / Resistance

### Purpose
Describe the quality of the actual reaction at the level.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: none

### Notes
This is very useful and should remain close to price action.

### Live Discord eligibility
- yes, but tied to actual interactions

### Noise rule
Only post when the reaction quality meaningfully changes.

Examples of allowed changes:
- weak bounce becomes clean defense
- clean defense starts weakening
- repeated testing degrades trust
- resistance is getting worn down after repeated tests

Do not keep reminding the trader that the same reaction quality still exists.

---

## 7. Volume / Activity Context

### Purpose
Describe whether the move is actually backed by meaningful activity.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: none initially

### Notes
This category should be introduced later and carefully.

### Live Discord eligibility
- not at first, or only as supporting context inside existing alert categories

### Noise rule
Do not let volume/activity become its own steady stream of posts.
It should only strengthen or weaken an existing setup story.

Preferred use:
- internal scoring first
- operator artifact reporting second
- live Discord only once the behavior is trusted

---

## 8. Candle Meaning

### Purpose
Translate specific candle behavior into plain trader meaning.

### Timeframes
- primary: `5m`
- secondary: `4h` only for very strong context
- confirmation: none

### Notes
Candle meaning should not become a constant commentary layer.

### Live Discord eligibility
- usually no as a standalone category
- yes only when folded into an existing more important alert

### Noise rule
Do not make this a live standalone post category.
It is too easy for candle commentary to become noisy.

Best use:
- as supporting explanation inside another post
- as operator-only evidence in artifacts

---

## 9. Chart Pattern Context

### Purpose
Provide descriptive context around shapes like basing, compression, pullback structure, or failed breakout shape.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: none initially

### Notes
Pattern language is easy to overuse.

### Live Discord eligibility
- no as a standalone category initially
- maybe later as supporting context only

### Noise rule
This should not be a live alert category until it proves itself.

Best use:
- operator artifacts
- internal context
- optional explanation inside existing higher-value posts

---

## 10. Follow-Through / Outcome

### Purpose
Track whether the setup is still holding up, stalling, or failing after the original alert.

### Timeframes
- primary: `5m`
- secondary: `4h`
- confirmation: none

### Notes
This is one of the most valuable trader-facing categories.

### Live Discord eligibility
- yes, tightly gated

### Noise rule
This category should post only on meaningful status change.

Allowed live behavior:
- still holding up
- stalled
- failed
- regained strength
- first major objective area reached

Do not let this become a repetitive commentary stream.
One meaningful post per real status change is enough.

---

## 11. Trader Commentary / Recap

### Purpose
Provide summary context in trader-friendly wording.

### Timeframes
- derived from active category states, not candle-timeframe-native

### Notes
This is a presentation layer, not a raw signal category.

### Live Discord eligibility
- yes, but very tightly gated

### Noise rule
This category is one of the most dangerous for overposting.
It must never become a running narration engine.

Allowed live behavior:
- meaningful recap when the state materially changed
- one calm summary when that adds real value

If a recap does not tell the trader something new, it should not post.

---

## 12. Operator Review / Diagnostics

### Purpose
Support testing, review, replay, tuning, and debugging.

### Timeframes
- all timeframes as needed

### Live Discord eligibility
- no

### Noise rule
This category should never leak directly into trader-facing Discord output.

---

## Recommended Category Eligibility For Live Discord

This section is the most important noise-control filter.

## Safe for live Discord now
These categories are worth keeping or building for live trader use:
- `support_resistance`
- `pivots`
- `market_structure`
- `breakout_reclaim_quality`
- `reaction_quality`
- `follow_through`

## Use cautiously in live Discord
These categories may be useful, but only if tightly gated:
- `range_compression`
- `trader_commentary`
- `volume_activity`

## Keep out of standalone live Discord for now
These are too likely to create noise if posted directly:
- `candle_meaning`
- `pattern_context`
- `operator_review`

Important note:
If a category adds more alerts/posts than real decision value, it should not be live, even if it is technically interesting.

---

## State-Change Design Rule For Every Category

Every live-eligible category must define:
- how a state begins
- what level or condition must hold
- how the state fails
- what counts as meaningful improvement
- what counts as meaningful deterioration
- what counts as no-change / hold state

### Required live behavior
- post when the state begins
- stay quiet while the state remains intact
- post when it materially improves or fails

### Example
Market structure:
- `bullish structure formed above 2.18`
- then quiet
- `structure weakened below 2.18`
- then quiet

That is the model Codex should use for every live category.

---

## Output Surface Matrix Recommendation

Codex should implement category toggles and surface toggles separately.

### Category config

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

### Surface config

```ts
export type SignalSurfaceConfig = {
  liveDiscord: boolean;
  operatorArtifacts: boolean;
  internalScoring: boolean;
};
```

### Important design rule
A category may be enabled internally while still disabled for live Discord.

This is essential for keeping interesting features from automatically becoming trader-facing noise.

---

## Recommended Profiles

### `levels_only`
Live Discord:
- support_resistance only

Internal / operator:
- operator_review

### `levels_plus_structure`
Live Discord:
- support_resistance
- pivots
- market_structure
- breakout_reclaim_quality
- reaction_quality
- follow_through

Operator artifacts:
- range_compression
- operator_review

### `trader_balanced`
Live Discord:
- support_resistance
- pivots
- market_structure
- breakout_reclaim_quality
- reaction_quality
- follow_through
- limited trader_commentary

Operator artifacts:
- range_compression
- volume_activity (if enabled)
- operator_review

### `operator_full`
Everything enabled internally and in operator review,
but live Discord still limited by surface rules.

---

## Coding Guidance For Codex

## 1. Do not let every category create its own live post type

This is one of the most important rules.

A category may produce signals internally without being allowed to create a new live post stream.

For example:
- `candle_meaning` should probably strengthen wording inside another alert, not create its own thread post
- `pattern_context` should probably enrich artifacts first, not create standalone live alerts
- `volume_activity` should probably modify quality context before becoming its own posting category

## 2. Use categories to improve existing trader posts before adding more post classes

A new category should first answer:
- does it improve an existing post type
- does it improve scoring
- does it improve operator review

Only after that should it be considered for standalone live exposure.

## 3. Default new categories to operator-only until proven useful

This is the safest path.

If a category is new, set it up like this first:
- compute internally
- log or summarize in artifacts
- evaluate usefulness
- only then consider live Discord exposure

## 4. Add tests for quiet persistence

This is critical.

For each live category, add tests that verify:
- state post happens when the state forms
- no repeat post happens while the state simply remains true
- a new post happens only when the state materially changes

This is the best way to prevent category expansion from creating noise.

---

## Suggested Implementation Phases For Codex

## Phase 1. Add timeframe + category config framework

### Goal
Create the typed configuration and surface matrix.

### Work
- add category config
- add surface matrix
- add profile resolver
- add tests

### Deliverable
The system can model categories explicitly and independently.

---

## Phase 2. Map existing behavior into categories

### Goal
Move current live behavior into explicit category ownership.

### Existing categories already present in some form
- support_resistance
- breakout_reclaim_quality
- reaction_quality
- follow_through
- trader_commentary
- operator_review

### Deliverable
Existing features become more modular without changing trader-visible behavior too much.

---

## Phase 3. Add pivots and market structure

### Goal
Add the highest-value next categories first.

### Deliverable
- pivot category implemented
- market structure category implemented
- both independently toggleable
- both quiet by default unless the state actually changes

---

## Phase 4. Add range/compression carefully

### Goal
Capture compression and balance state without creating repetitive narration.

### Deliverable
Range/compression becomes available, but only posts on real state transitions.

---

## Phase 5. Add optional internal-only categories later

### Goal
Add volume/activity, candle meaning, and pattern context without immediately exposing them live.

### Deliverable
These categories improve scoring and operator review first.

---

## Final Recommendation

The strongest next categories are:
1. `pivots`
2. `market_structure`
3. `range_compression`
4. `reaction_quality` refinement
5. `volume_activity` later

The strongest safety rule is:

> new categories should be quiet by default and should only create live trader-facing posts when the category's state actually changes in a way that matters to the trader.

And the strongest architecture rule is:

> a category being interesting is not enough to deserve live Discord exposure.
> it must also prove that it adds trader value without becoming noise.

That is the standard Codex should work from.
