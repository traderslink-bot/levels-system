# Adaptive Stability Layer v1 Plan for levels-system

## Progress update - 2026-04-15

This plan has now been partially executed in the local repo.

### Completed in this pass
- Added `src/lib/monitoring/adaptive-stability.ts`
- Refactored `src/lib/monitoring/adaptive-scoring.ts` so it now:
  - builds raw adaptive target state
  - routes application through the stability layer
  - separates target multipliers from applied multipliers
- Added runtime integration support:
  - `src/lib/monitoring/opportunity-runtime-controller.ts`
  - runtime wiring in `src/runtime/main.ts`
  - optional raw price-update hook in `src/lib/monitoring/watchlist-monitor.ts`
- Added structured runtime adaptive diagnostics so live validation can inspect:
  - target vs applied global multiplier
  - target vs applied event-type multiplier
  - confidence used
  - weak streak
  - disable state
  - drift dampening state
- Added replay validation support:
  - shared diagnostics formatter
  - replay validation sample runner
  - optional diagnostics file output for session review
- Added cross-run validation aggregation support:
  - multi-file `.ndjson` summarizer
  - per-symbol replay comparison
  - visibility into weak streak, disable intent, drift activation, and target/applied gaps
- Added dedicated tests:
  - `src/tests/opportunity-evaluator.test.ts`
  - `src/tests/adaptive-scoring.test.ts`
  - `src/tests/adaptive-stability.test.ts`
  - `src/tests/opportunity-diagnostics.test.ts`
  - `src/tests/opportunity-runtime-integration.test.ts`

### Verified status after implementation
- `npm run build` passes
- `npm test` passes

### Still intentionally pending
- deeper live runtime validation against real IBKR sessions
- persistence of adaptive state beyond in-memory runtime lifetime
- broader end-to-end operational validation for long-running sessions

### Important note
The conceptual architecture in this plan still stands.
What changed is that Phases 1-3 below are now implemented locally and tested.

## Repo re-check result

I attempted to re-check the updated GitHub repo before writing this plan, but the connector did not return usable file-level search results for the updated files. Because of that, I cannot honestly claim that I confirmed any new code changes from the repo re-check itself.

So this plan is based on the last confirmed file map and code you provided:

- `src/lib/monitoring/adaptive-scoring.ts`
- `src/lib/monitoring/opportunity-evaluator.ts`
- `src/tests/opportunity-decision-integrity.test.ts`

At this point, **no adjustments are required based on confirmed repo findings**, because the repo re-check did not surface any verifiable new implementation details.

---

## Current confirmed status

### Confirmed files
- Adaptive scoring layer: `src/lib/monitoring/adaptive-scoring.ts`
- Opportunity evaluator: `src/lib/monitoring/opportunity-evaluator.ts`

### Confirmed runtime status
- `AdaptiveScoringEngine` is not yet wired into live runtime flow
- `OpportunityEvaluator` is not yet wired into live runtime flow
- `OpportunityEngine` also does not appear to be wired into `src/runtime` or sample scripts yet

### Confirmed tests
- `OpportunityEngine` has tests:
  - `src/tests/opportunity-decision-integrity.test.ts`
- No dedicated test file was confirmed for:
  - `OpportunityEvaluator`
  - `AdaptiveScoringEngine`

### Practical layer status
- `OpportunityEngine`: implemented and tested
- `OpportunityEvaluator`: implemented, not wired, no dedicated tests confirmed
- `AdaptiveScoringEngine`: implemented, not wired, no dedicated tests confirmed

---

# Goal of this phase

We are **not** redesigning the system.

We are stabilizing a deterministic, feedback-driven adaptation loop.

The next layer is:

## Adaptive Stability Layer v1

This layer sits between:

**OpportunityEvaluator summary -> AdaptiveScoring target logic -> stabilized applied multipliers**

Its job is to prevent overreaction while preserving deterministic adaptation.

---

# Core design conclusion

The evaluator should continue to measure results.

The adaptive scoring layer should continue to compute **raw target adjustments**.

The new adaptive stability layer should control **how quickly** those adjustments are allowed to affect live adaptive scoring.

This means the system moves from:

- evaluator summary
- immediate multiplier calculation
- immediate disable / filter

to:

- evaluator summary
- target multiplier calculation
- stabilized application of multiplier state over time

---

# Locked architecture for this phase

## 1. `src/lib/monitoring/opportunity-evaluator.ts`
Keep responsibility exactly as:

- track evaluated opportunities
- compute global expectancy
- compute per-event-type expectancy
- compute rolling expectancy
- compute drift
- compute drawdown and accuracy summaries

### No changes in purpose
No adaptive stability logic belongs here.

---

## 2. `src/lib/monitoring/adaptive-scoring.ts`
Keep responsibility as:

- derive raw adaptive intent from evaluator summary
- compute raw global target multiplier
- compute raw event-type target multiplier
- determine raw disable intent conditions

### Important adjustment
This file should stop being the place where unstable immediate application happens.

It should no longer be the last decision point that directly applies the freshest evaluator result without stabilization.

Instead, it should either:
- produce target values for the stability layer, or
- integrate with the stability layer before producing final adapted opportunities

---

## 3. New file: `src/lib/monitoring/adaptive-stability.ts`
This should be the new control layer.

### Responsibility
- store persistent adaptive state
- smooth multiplier movement
- confidence-weight adjustments by sample size
- limit max movement per update
- prevent immediate disabling of signals
- dampen adaptation during drift
- return stabilized applied adaptive state

This is the correct place for all stabilization behavior.

---

# Why this layer is required

The current adaptive scoring behavior is deterministic but too immediate.

That creates these risks:

## 1. Stateless adaptation risk
If multiplier calculation is recomputed fresh from each summary with no persistent state, there is no smoothing and no memory of prior adaptation.

## 2. Small sample overreaction risk
Per-event-type expectancy can change quickly on weak sample sizes.

## 3. Immediate suppression risk
If a weak expectancy threshold causes direct disable behavior, useful event types can be filtered out too early.

## 4. Drift misinterpretation risk
If drift directly reduces the multiplier but does not reduce adaptation intensity, the system still reacts too quickly during unstable periods.

---

# Adaptive Stability Layer v1 design

## A. Persistent adaptive state

This layer must keep memory.

Without persistent state, there is no real stabilization.

### Required stored state
At minimum, the state should track:

- current applied global multiplier
- current applied event-type multipliers by event type
- current disabled status by event type
- consecutive weak update count by event type

Optional but useful:
- last target multiplier by event type
- last confidence value by event type
- last update timestamp if later needed for pacing analysis

### Reason
Smoothing requires comparing:
- prior applied state
- new target state

That is impossible with a stateless function alone.

---

## B. Separate target state from applied state

This is the key design rule.

### Current issue
The adaptive scoring logic is effectively calculating values and applying them immediately.

### New rule
The system should distinguish between:

- **target multiplier**
- **applied multiplier**

#### Target multiplier
What the evaluator and adaptive scoring logic say *should* happen based on latest performance.

#### Applied multiplier
What the system is actually allowed to use after stability rules are enforced.

This separation keeps the system deterministic while preventing sudden reactions.

---

## C. Confidence weighted adjustment

Adjustments must be scaled by sample size.

### Confidence source
Use existing summary counts:

- global confidence from `summary.totalEvaluated`
- event-type confidence from `summary.expectancyByEventType[eventType].totalEvaluated`

### Behavioral goal
- low samples -> little movement
- moderate samples -> partial movement
- high samples -> fuller movement

### Important implementation note
Confidence should scale **delta movement toward target**, not simply the final multiplier value.

That keeps the system stable while still allowing high-confidence adaptation.

---

## D. Smoothing of multiplier movement

After confidence weighting, applied multipliers should only move **part of the way** toward target each update.

### Behavioral goal
- avoid sharp jumps
- avoid oscillation
- allow adaptation to accumulate over time

### Conceptual flow
For each adaptive unit:

1. read current applied multiplier
2. compute target multiplier
3. compute delta = target - current
4. confidence-scale the delta
5. smoothing-scale the delta
6. clamp the change
7. apply the result

---

## E. Max delta per update

Even after confidence scaling and smoothing, every update should be hard capped.

### Recommended policy
Use separate caps for:

- max upward multiplier movement per update
- max downward multiplier movement per update

### Strong recommendation
Make downward movement stricter than upward movement.

### Reason
Over-penalizing a signal too fast is usually more dangerous than rewarding a strong signal a bit slowly.

Rapid suppression can starve the system of future evidence.

---

## F. Protected disable logic

This is the most important behavioral protection.

### Current risk
Immediate disable on a single threshold cross is too brittle for a feedback loop.

### v1 rule
An event type should **not** be disabled immediately just because expectancy is below a threshold.

### Disable should require all of the following
- expectancy below the disable threshold
- enough sample size to trust the evidence
- sustained weakness across multiple update cycles

### Why
This prevents:
- short-term noise from removing a valid signal
- under-sampled event types from disappearing too early
- feedback starvation where a signal stops surfacing before it has been fairly evaluated

---

## G. Protected floors

The layer should protect event-type multipliers from collapsing too quickly.

### Two floor concepts

#### Soft floor
For low-confidence or newly weak event types:
- do not allow the multiplier to fall below a protected floor

#### Hard floor
For sustained, high-confidence weakness:
- allow movement closer to the configured minimum
- only after disable protection conditions are meaningfully approached or met

### Why
This prevents weak evidence from crushing event relevance prematurely.

---

## H. Drift dampening

Drift should not only affect target multiplier logic.

It should also affect adaptation intensity.

### When drift is active
The stability layer should:
- reduce allowed delta per update
- strengthen smoothing
- make disable harder to trigger
- generally slow adaptive movement

### Behavioral rule
Drift means **be more cautious**, not **react more strongly**.

This protects the system during unstable market behavior.

---

# Exact v1 behavior to implement

## Global multiplier path

1. Adaptive scoring computes raw global target multiplier
2. Stability layer compares it to current applied global multiplier
3. Confidence is derived from total evaluated count
4. Drift can dampen the allowed movement
5. Delta is smoothed and capped
6. New applied global multiplier is stored

---

## Event-type multiplier path

For each event type:

1. Adaptive scoring computes raw event-type target multiplier
2. Stability layer reads event-type sample size
3. Confidence is derived from event-type sample count
4. Delta is scaled by confidence
5. Delta is smoothed
6. Delta is capped
7. Protected floor is enforced
8. Disable eligibility is checked using persistence and confidence rules
9. New applied event-type state is stored

---

## Final scoring path

Once stabilized state is available:

1. combine stabilized global multiplier and stabilized event-type multiplier
2. clamp final multiplier to configured bounds
3. compute final adaptive score
4. only filter disabled opportunities when disable state is truly active under stability rules

This keeps final adaptation deterministic while preventing abrupt system behavior.

---

# File level implementation blueprint

## 1. New file: `src/lib/monitoring/adaptive-stability.ts`

### Recommended exports

#### Types
- `AdaptiveStabilityConfig`
- `AdaptiveStabilityState`
- `AdaptiveEventTypeState`
- `AdaptiveTargetState`
- `AdaptiveEventTypeTarget`
- `AdaptiveStabilityResult`

#### Class
- `AdaptiveStabilityLayer`

### Recommended core responsibilities
- initialize default adaptive state
- build confidence factors from sample size
- apply smoothing
- apply delta caps
- apply protected floor rules
- apply disable protection rules
- apply drift dampening
- return stabilized state and final applied values

---

## 2. Update: `src/lib/monitoring/adaptive-scoring.ts`

### Keep
- normalization helpers
- expectancy interpretation
- global target multiplier formula
- event-type target multiplier formula

### Change
Refactor so these helpers produce **target** outputs rather than immediately final behavior.

### Add
- integration with `AdaptiveStabilityLayer`
- use stabilized applied multipliers before building final adapted opportunities
- disable behavior should use stability output, not raw threshold alone

### Important
Do not redesign scoring logic.
Do not redesign ranking logic.
Only change how multiplier intent is applied.

---

## 3. Leave mostly unchanged: `src/lib/monitoring/opportunity-evaluator.ts`

### Keep intact
- evaluation tracking
- summary building
- rolling expectancy
- drift calculation
- event-type expectancy summaries

### Optional future enhancement
Do not change evaluator just for stability unless a tiny helper export becomes necessary later.

At this stage, evaluator already exposes enough data for v1 stability.

---

# Recommended config design

The stability layer needs its own config.

## Suggested `AdaptiveStabilityConfig` fields

- `baseSmoothingFactor`
- `driftSmoothingFactor`
- `minSamplesForConfidence`
- `samplesForFullConfidence`
- `globalMinSamplesForConfidence`
- `globalSamplesForFullConfidence`
- `maxIncreasePerUpdate`
- `maxDecreasePerUpdate`
- `disableMinSamples`
- `disableWeakStreakThreshold`
- `protectedFloorMultiplier`
- `driftDampeningFactor`
- `driftDecreaseMultiplier`
- `driftDisableProtection`

### Purpose of each group

#### Smoothing config
Controls how much of target delta can be applied each update.

#### Confidence config
Controls how quickly low-sample signals are trusted.

#### Delta caps
Prevents sudden jumps or collapses.

#### Disable config
Prevents immediate removal of weak signals.

#### Floor config
Protects under-sampled or temporarily weak signals from collapsing.

#### Drift config
Slows the adaptation process when system behavior is unstable.

---

# Recommended types

## `AdaptiveEventTypeState`
Should hold:
- `eventType`
- `multiplier`
- `disabled`
- `disableReason`
- `weakUpdateStreak`

Optional:
- `lastTargetMultiplier`
- `lastConfidence`

---

## `AdaptiveStabilityState`
Should hold:
- `globalMultiplier`
- `eventTypes: Record<string, AdaptiveEventTypeState>`

---

## `AdaptiveEventTypeTarget`
Should hold:
- `eventType`
- `targetMultiplier`
- `disableIntent`
- `disableReason`
- `expectancy`
- `sampleSize`

---

## `AdaptiveTargetState`
Should hold:
- `targetGlobalMultiplier`
- `globalSampleSize`
- `driftDeclining`
- `driftDelta`
- `eventTypeTargets: Record<string, AdaptiveEventTypeTarget>`

---

## `AdaptiveStabilityResult`
Should hold:
- `state`
- `appliedGlobalMultiplier`
- `appliedEventTypeMultipliers`
- `disabledEventTypes`
- `diagnostics`

Optional diagnostics:
- confidence used
- delta applied
- dampening applied
- disable protection triggered

These diagnostics would make testing much easier.

---

# Deterministic policy details

## Confidence model
Use a deterministic linear or stepped confidence ramp based on sample size.

### Example behavior
- below minimum confidence sample count -> very low confidence
- between minimum and full confidence -> interpolated confidence
- above full confidence -> full confidence

No randomness.
No probabilistic behavior.

---

## Delta policy
Every update computes:
- target minus current
- confidence scaled delta
- smoothing scaled delta
- drift dampened delta if needed
- hard capped final delta

This should be fully deterministic and testable.

---

## Disable policy
A signal should only disable when:
- target disable intent is true
- sample size is above disable minimum
- weak streak threshold is reached

Before that:
- leave disabled as false
- allow multiplier to reduce gradually
- enforce protected floor

---

## Recovery policy
If an event type starts improving again:
- weak streak should reset
- disabled should be able to recover deterministically if the applied rules say so

For v1, this recovery can be simple and deterministic.
No special advanced recovery subsystem is needed.

---

# Test plan

This should be done before runtime wiring.

## 1. Evaluator tests
Create dedicated tests for:

- expectancy calculation
- win/loss summary math
- average win and loss calculation
- rolling expectancy window behavior
- performance drift detection
- early exit completion
- drawdown tracking
- event-type expectancy summary generation

### Suggested file
- `src/tests/opportunity-evaluator.test.ts`

---

## 2. Adaptive scoring tests
Create dedicated tests for:

- positive event-type expectancy boost
- negative event-type expectancy penalty
- global positive expectancy boost
- global negative expectancy penalty
- drift penalty effect on target logic
- clamping to min and max multiplier
- raw disable intent behavior

### Suggested file
- `src/tests/adaptive-scoring.test.ts`

---

## 3. Adaptive stability tests
Create dedicated tests for:

- low sample size produces very small movement
- high sample size produces larger movement
- upward delta is capped
- downward delta is capped more tightly
- protected floor prevents early collapse
- disable does not happen on first weak update
- disable happens after sustained weak updates with enough samples
- drift reduces movement intensity
- disabled event type can recover if target improves and rules allow it
- state persists and compounds across updates

### Suggested file
- `src/tests/adaptive-stability.test.ts`

---

# Implementation order

## Phase 1
Create `adaptive-stability.ts` with:
- config
- state types
- target types
- stabilization logic
- deterministic policies

Status: completed locally

## Phase 2
Refactor `adaptive-scoring.ts` to:
- compute target state
- pass target state into stability layer
- use stabilized outputs to build adapted opportunities

Status: completed locally

## Phase 3
Add dedicated tests for:
- evaluator
- adaptive scoring
- adaptive stability

Status: completed locally

## Phase 4
Only after tests pass:
- wire these layers into runtime flow
- then test end to end behavior

Status: started locally

### Phase 4 progress notes
- Runtime now consumes stabilized adaptive outputs through a dedicated controller layer rather than applying raw target multipliers directly in the entrypoint.
- Evaluator updates are now driven from explicit live price updates passed through the monitor boundary.
- Adaptive rescoring remains mediated by `AdaptiveScoringEngine` plus `AdaptiveStabilityLayer`.
- A runtime integration test now verifies:
  - opportunity tracking and evaluation completion
  - stabilized adaptive behavior
  - no immediate first-cycle disable path
- Runtime snapshots now expose structured diagnostics needed for live behavior validation and longer-session observation.
- Replay validation tooling now exists so the same structured diagnostics shape can be inspected in deterministic historical-replay sessions before longer live sessions.
- Early multi-symbol replay validation has now exercised:
  - weak-streak growth and disable intent (`NVDA`)
  - drift dampening activation (`TSLA`)
  while still avoiding premature hard disable behavior.
- Small-cap replay validation has now exercised stronger stress paths:
  - `disableIntent` (`BIRD`, `ALBT`)
  - long weak-streak accumulation (`ALBT`)
  - substantial drift activation (`ALBT`)
  - materially wider target/applied gaps than the large-cap set
  while still avoiding immediate or unjustified hard disables.
- Focused longer-window replay validation has now exercised the hard-disable path:
  - `BIRD` disabled `level_touch` after a sustained weak sequence
  - disable occurred at `weakStreak = 3` with `disableReason = negative_expectancy`
  - the applied multiplier was still near the protected region (`0.9892`) rather than collapsing abruptly
  - `ALBT` remained a strong stress case with heavy drift and disable intent, but still stayed on the protected side of hard disable in the longer replay
- Recovery-focused replay window scanning now shows post-weakness recovery behavior:
  - `ALBT` produced multiple real-candle replay windows where `level_touch` and `reclaim` entered weakness and later recovered without hard disable
  - `BIRD` produced multiple real-candle replay windows where `level_touch` and `reclaim` recovered after a weak phase
  - these recoveries were gradual weak-phase resets, not snap-back behavior
  - this completes replay evidence for baseline stability, stress handling, drift behavior, hard disable reachability, and weak-phase recovery
- Initial live-session confirmation now exists using real IBKR runtime sequencing:
  - a short small-cap capture on `BIRD`, `HUBC`, `IMMP`, and `ALBT` produced adaptive diagnostics for `ALBT`
  - live `opportunity_snapshot` and `evaluation_update` entries stayed internally consistent
  - target/applied separation stayed controlled (`maxTargetAppliedGap = 0.0326`)
  - no premature weak streak, disable intent, drift activation, or disable noise appeared in this mild live session
  - this supports the replay conclusion that the runtime boundary is behaving cleanly under real session timing

---

# What should not change in this phase

Do not:

- redesign evaluator architecture
- redesign opportunity engine architecture
- redesign ranking pipeline
- introduce random adaptation
- introduce regime prediction models
- collapse multiple layers together
- add runtime wiring before stabilization logic is tested

This phase is about **stabilization**, not expansion.

---

# Final recommendation

The correct next move is:

1. build `src/lib/monitoring/adaptive-stability.ts`
2. update `src/lib/monitoring/adaptive-scoring.ts` to use target vs applied flow
3. add dedicated tests for evaluator, adaptive scoring, and adaptive stability
4. wire runtime later

This keeps the system deterministic, layered, and behaviorally stable.

---

# Follow up note

If a later repo check reveals:
- runtime integration already started
- tests already added
- adaptive scoring refactored toward target state

then this plan should be adjusted only at the integration details level, not at the conceptual level.

The conceptual design above remains the correct stabilization-first approach for this phase.
