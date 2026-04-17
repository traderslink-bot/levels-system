# Level Validation System Plan
## levels-system

---

# 1. Purpose

This plan defines the best next step for improving support and resistance quality without relying only on ad hoc chart reviews.

The goal is to build a small, practical validation system that helps us answer:

- did the level engine mark meaningful levels?
- did it over-preserve nearby noise?
- did it miss meaningful forward resistance/support?
- did a code change actually improve chart-reading quality?

This is not a separate product.

It is a development and hardening layer for the existing levels engine.

---

# 2. Why This Is Worth Building

Recent live work proved something important:

- manual tuning can improve the system
- but manual tuning alone is slow
- a fix can solve one problem and create another
- without a validation harness, it is too easy to over-correct

Examples we already saw:

- a meaningful `1.75` resistance was missed, then later found
- a later change preserved `1.75` but temporarily dropped farther valid resistance
- dense nearby resistance bands can still survive too easily and look equally important

This means the repo is now at the point where validation infrastructure is a high-value investment.

---

# 3. Core Principle

The validation system must not become the same algorithm grading itself.

That would only prove self-consistency.

Instead, the validation system should combine:

- deterministic scenario tests
- structural stability checks
- forward reaction outcome checks
- optional cross-method agreement checks later

This gives evidence without requiring expert manual chart reading on every iteration.

---

# 4. What We Should Build First

The best first version is not a giant framework.

It should be a lean validation layer with three parts:

1. synthetic scenario validation
2. level persistence and churn validation
3. forward reaction validation

That combination is strong enough to guide real improvements while staying small enough to build now.

---

# 5. Scope

This phase should focus on the support/resistance engine only.

Primary scope:

- candle data to level generation
- surfaced ladder selection
- extension ladder generation

Not primary scope:

- Discord presentation polish
- alert wording
- unrelated monitoring redesign

Those layers may consume validation output later, but they are not the target of this plan.

---

# 6. Phase 1: Synthetic Scenario Validation

## Goal

Create deterministic candle-data scenarios where the expected structural behavior is clear.

These tests should answer:

- does the engine keep the meaningful level?
- does it suppress the noisy nearby level?
- does it preserve meaningful forward ladder continuity?

## Why This Comes First

Synthetic scenarios are the cheapest way to build repeatable evidence.

They let us validate logic without needing a human to inspect every real chart.

## Scenario Categories

Build explicit candle scenarios for:

- breakout continuation into open space
- failed breakout with upper wick rejection
- held gap continuation
- quickly filled gap
- dense nearby resistance band with one stronger anchor
- dense nearby support band with one stronger anchor
- isolated daily wick-high resistance
- isolated daily wick-low support
- near resistance plus meaningful intermediate plus far-forward resistance
- nearby micro-structure crowding out stronger forward levels

## File Targets

Primary test file:

- `src/tests/level-validation-scenarios.test.ts`

Supporting utilities if needed:

- `src/tests/helpers/level-validation-fixtures.ts`
- `src/tests/helpers/candle-fixtures.ts`

## Expected Assertions

Each scenario should test things like:

- required level is present
- forbidden noise level is absent
- surfaced ordering remains sensible
- extension continuity is preserved
- dense clutter does not explode

## Acceptance Criteria

Phase 1 is complete when:

- there is a dedicated scenario-validation test file
- it covers at least 8 to 12 meaningful chart-structure cases
- failures clearly point to a specific structural weakness

---

# 7. Phase 2: Level Persistence And Churn Validation

## Goal

Measure whether meaningful levels remain stable across nearby refreshes while weaker levels rotate out.

## Why This Matters

A strong level should usually persist across small data updates.

A weak micro-level should churn more easily.

If strong levels churn too much, the engine is unstable.

If weak levels persist too much, the engine is over-preserving noise.

## What To Measure

For a symbol/timeframe sequence across rolling refreshes:

- how often major levels persist
- how often extension ladders persist
- how often surfaced levels churn
- whether the same structural band keeps changing price too much

## File Targets

Likely new files:

- `src/lib/validation/level-persistence-validator.ts`
- `src/tests/level-persistence-validator.test.ts`

If a runner is useful:

- `src/scripts/run-level-persistence-validation.ts`

## Metrics To Produce

Simple deterministic metrics:

- persistence rate of surfaced levels
- persistence rate of extension levels
- average price drift of persisted levels
- churn rate by timeframe bucket

## Acceptance Criteria

Phase 2 is complete when:

- we can run a persistence check over rolling candle windows
- output identifies whether strong levels are stable enough
- output identifies when weak levels are churning or over-persisting

Current implementation note:

- a first persistence validator now exists in code
- a live runner should use the active candle provider path and must be checked only after candle-source health is confirmed

---

# 8. Phase 3: Forward Reaction Validation

## Goal

Evaluate whether surfaced support/resistance levels are actually useful based on what price does afterward.

## Why This Is Powerful

This is the strongest no-human validation path.

Instead of asking:

- does this look right?

we ask:

- did price later react near the surfaced level?
- did stronger-ranked levels get respected more often than weaker ones?

## What To Validate

For each generated level:

- did price later reject near it?
- did price pause or reverse near it?
- did price ignore it completely?
- did the engine skip an area that price later respected strongly?

## File Targets

Likely new files:

- `src/lib/validation/forward-reaction-validator.ts`
- `src/tests/forward-reaction-validator.test.ts`

Optional runner:

- `src/scripts/run-forward-reaction-validation.ts`

## Initial Metrics

Keep the first version simple:

- hit rate by strength tier
- hit rate by timeframe bias
- hit rate by surfaced vs extension
- miss rate for skipped intermediate forward levels

## Important Constraint

This validator should stay descriptive first.

Do not immediately turn it into a giant optimization engine.

Use it to detect weaknesses, not to auto-tune everything.

## Acceptance Criteria

Phase 3 is complete when:

- we can evaluate whether stronger levels produce more future reactions than weaker levels
- we can compare surfaced vs extension usefulness
- we can use this evidence to justify future structural changes

Current implementation note:

- a first forward-reaction validator should use post-generation `5m` candles and stay descriptive rather than auto-tuning
- live forward validation must run on the active provider path only after candle-source health passes

---

# 9. Phase 4: Optional Cross-Method Validation

## Goal

Add a second, different style of level detector to compare outputs.

## Why This Is Optional

This is valuable, but it should not come before the first three phases.

It is more complex and less necessary for the first validation layer.

## Possible Example

Primary engine:

- swing and evidence driven level detector

Secondary validator:

- repeated horizontal reaction detector

Then compare:

- where both agree
- where only one finds a level

Agreement increases confidence.

Divergence flags uncertainty.

## File Targets

Possible future files:

- `src/lib/validation/comparison-level-detector.ts`
- `src/lib/validation/level-agreement-validator.ts`

---

# 10. Minimal First Build Order

This is the order I recommend:

1. create synthetic scenario validation tests
2. add a small scenario-fixture helper layer
3. add level persistence validator
4. add forward reaction validator
5. add simple scripts to run validators and print results
6. only then start using the validators to drive further tuning

This keeps the work practical and lets us start benefiting early.

---

# 11. Exact Questions This System Should Answer

After Phase 1 to 3, we should be able to answer:

- is swing detection still too noisy?
- are meaningful wick highs/lows being missed?
- is clustering over-merging or under-merging?
- is surfaced selection keeping too many nearby band levels?
- is extension selection preserving meaningful forward continuity?
- are stronger-ranked levels actually more useful afterward?
- does the engine churn too much across nearby refreshes?

If we cannot answer those, the validation system is not good enough yet.

---

# 12. What This Should Not Become

Do not turn this into:

- a new scoring engine
- an auto-tuning black box
- a big dashboard project
- a chart-image AI system

This layer should stay:

- deterministic
- testable
- evidence-focused
- tightly scoped to improving support/resistance quality

---

# 13. Initial File Blueprint

Recommended first-pass additions:

- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `src/tests/level-validation-scenarios.test.ts`
- `src/tests/helpers/level-validation-fixtures.ts`
- `src/lib/validation/level-persistence-validator.ts`
- `src/tests/level-persistence-validator.test.ts`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/tests/forward-reaction-validator.test.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/scripts/run-forward-reaction-validation.ts`

The exact file count can stay smaller if helpers are unnecessary.

---

# 14. Recommended Implementation Posture

Use the validation layer as a guardrail, not a replacement for engineering judgment.

The best workflow will be:

1. detect a weakness through validation
2. identify the first weak stage in the level pipeline
3. fix that stage narrowly
4. rerun validation
5. confirm improvement without regressions

This is better than continuing with only ad hoc live adjustments.

Practical usage note:

- validation is materially more useful once it can run over a small batch of symbols instead of one symbol at a time
- batch validation should summarize:
  - provider health
  - persistence/churn
  - forward reaction usefulness
  in one report so regressions are easier to spot

---

# 15. My Recommendation

Build this.

Not as a giant project.

Build a lean v1 validation system now, because the support/resistance engine is already strong enough that the next limiting factor is evidence quality, not just code structure.

The best first milestone is:

- synthetic scenario validation
- persistence/churn validation
- forward reaction validation

That will give us a much better way to improve the system than continuing only with one-off manual chart adjustments.

---

# 16. Next Step

Start with Phase 1 immediately:

- create `src/tests/level-validation-scenarios.test.ts`
- seed it with the clearest structural cases already surfaced during live work
- use that as the first guardrail for future level-engine refinement

## Reminder

When future level-engine tuning is proposed:

- run the validation workflow first
- use the active candle provider path when doing live validation
- confirm whether failures come from chart-reading logic or from candle-source health before changing support/resistance logic
- do not rely only on live Discord snapshot inspection before changing structural logic

Recommended validation command order before and after any meaningful level-engine change:

1. `npm run validation:levels:live -- <SYMBOL>`
2. `npm run validation:levels:persistence -- <SYMBOL>`
3. `npm run validation:levels:forward -- <SYMBOL>`
4. `npm run validation:levels:batch -- <SYMBOL1> <SYMBOL2> <SYMBOL3> ...`

Recommended live validation workflow:

- prefer small IBKR live batches of about `4` to `5` symbols at a time
- use candle-cache mode during validation runs so repeat passes do not keep depending on live provider speed
- cache controls:
  - `LEVEL_VALIDATION_CACHE_MODE=read_write`
  - `LEVEL_VALIDATION_CACHE_MODE=replay`
  - `LEVEL_VALIDATION_CACHE_MODE=refresh`
  - `LEVEL_VALIDATION_CACHE_MODE=off`
- optional cache directory override:
  - `LEVEL_VALIDATION_CACHE_DIR=<path>`

What the validation output should now be used to detect:

- whether weakness is stronger on `support` or `resistance`
- whether weakness is mainly in:
  - `near` levels
  - `intermediate` levels
  - `far` levels
  - `extension` levels
- whether forward usefulness is:
  - full respect
  - partial respect
  - clean break
- whether high persistence is honest stability or loose nearby remapping inside tolerance

Interpretation reminder for future Codex work:

- do not treat high persistence alone as success
- compare:
  - surfaced support usefulness
  - surfaced resistance usefulness
  - extension support usefulness
  - extension resistance usefulness
- check the `near / intermediate / far` usefulness bands before deciding where the level engine is weakest
- check loose surfaced match rates before declaring a persistence result meaningfully stable

Minimum expectation for future Codex work:

- run the full automated suite with:
  - `npm test`
  - `npm run build`
- then run the level-validation workflow before declaring a structural-tuning pass complete
