# Trader Language Boundary And Discord Post Rules

Date: 2026-04-29
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document exists to lock down the intended boundary for trader-facing Discord language.

It is based on the current product direction and an explicit clarification from the product owner:

- Discord posts should now be trader-view only
- testing or operator language should not appear inside Discord posts
- the system should not give exact execution advice because the system can fail
- however, the system may still give **careful hints** about what matters for the trader to watch next

This means the trader-facing output should help a trader understand the setup, risk, support, resistance, reclaim areas, and what needs to happen next, **without pretending to be a trade execution coach**.

---

## Core Product Rule

### Discord posts are trader-view only now

Discord posts are no longer supposed to contain language that exists mainly to help the developer/operator test the system.

Anything primarily useful for testing should stay in:
- logs
- audit files
- diagnostics
- runtime status UI
- review artifacts
- replay/simulation reports

If a Discord post includes wording that feels like it is talking to the developer instead of the trader, treat that as a bug.

---

## Execution-Advice Boundary

### What should not happen

The system should not give direct execution instructions such as:
- buy here
- buy now
- sell now
- take profit
- stop out
- trim here
- add here
- enter now
- exit now
- short here
- short setup

### What is allowed

The system **can still give careful hints** about what matters for the trader.

That means it can say things like:
- buyers need acceptance above resistance
- this support needs to hold
- reclaim of this area would improve the setup
- if price loses this support, long risk increases
- upside room looks limited until price clears the next resistance
- this move is extended and needs better follow-through
- this area is acting like a decision zone

These are acceptable because they help the trader interpret context without telling them exactly what to do.

### Practical principle

The system should describe:
- what happened
- why it matters
- what needs to happen next
- what level or zone matters most now

It should **not** tell the trader exactly how to execute.

---

## Language Standard For Discord Posts

### Discord language should be:
- plain trader language
- calm
- cautious
- long-only
- understandable for newer traders
- focused on support, resistance, reclaims, holds, breakout attempts, breakdown risk, and reaction quality

### Discord language should not be:
- debugging language
- internal policy language
- system/self-referential language
- execution coaching
- false-certainty language

---

## Internal/System Language That Should Not Appear In Discord Posts

The following kinds of language should stay out of live trader-facing Discord posts unless rewritten into natural trader language:

- alert direction
- thread stayed in continuation
- mapped support
- mapped resistance
- remapped zone
- not a price target
- operator-only classifications
- story ownership
- policy suppression language
- replay/simulation concepts
- runtime-only terms
- thread clutter logic terms
- diagnostic-only terminology

If those concepts need to exist, keep them in operator artifacts and testing surfaces.

---

## Trader-Hint Language: What Good Looks Like

The following are examples of the kind of language the system **should** use.

### Good examples
- Buyers need acceptance above 3.24 before this breakout looks cleaner.
- Support near 2.18 still needs to hold or the long setup weakens.
- Reclaim of 1.42 would improve the setup after the failed push lower.
- Resistance near 4.80 is still overhead, so upside room remains limited for now.
- Price is back near support, but the reaction still needs better follow-through.
- This zone still matters, but repeated testing is making it less trustworthy.
- The move is still holding up, but it has not opened enough room yet.
- Buyers are defending the area so far, but they still need to push through nearby resistance.

These lines give guidance about context without telling the trader what exact action to take.

### Borderline language that should be rewritten
- Longs should wait for a reclaim before trusting the setup.
- Best entry is on a pullback into support.
- Traders can buy if price holds this level.
- Good place to add if this level reclaims.
- Watch for a sell if support breaks.

These lines are too close to direct execution instruction.

### Better versions of those lines
- A reclaim would make the setup cleaner for longs.
- Pullback support is nearby, but the reaction still needs to prove itself.
- This level needs to hold for the long setup to stay cleaner.
- Reclaim of this area would improve the structure.
- If support breaks, the long setup weakens and risk opens up.

---

## Discord Post Intent By Message Type

Every Discord post type should be judged by whether it is written for the trader, not for system review.

### 1. Intelligent alerts

Should answer:
- what happened
- why this matters now
- what level or zone matters most next
- whether room is open, limited, or tight

Should not include:
- internal scoring logic terms unless translated into trader language
- execution instructions

### 2. Level snapshots

Should answer:
- where the nearby support and resistance are
- which side is closer / tighter
- which levels matter next

Should not include:
- internal curation/exclusion logic
- operator-only explanations about why some levels were omitted

### 3. Follow-through updates

Should answer:
- whether the move is still holding up, stalling, or failing
- what level still needs to hold or be reclaimed
- whether the move is extended or still building

Should not include:
- language that sounds like system bookkeeping
- language that sounds like trade execution coaching

### 4. Continuity updates

Should only appear when the trader meaningfully benefits.
They should describe major context change, not repeat the same idea.

### 5. Recap posts

Should be rare and trader-centered.
They should summarize where things stand now, not narrate the system's internal interpretation process.

### 6. AI commentary

If AI commentary is used in Discord, it must follow the same trader-view rules as deterministic posts.
It should never become looser, more speculative, or more advisory than the deterministic layer.

---

## Testing Language Must Stay Out Of Discord

The system is still private and still under active testing.
That is fine.
But the testing layer belongs outside the trader-facing thread.

### Testing and operator outputs belong in:
- `discord-delivery-audit.jsonl`
- session summaries
- thread summaries
- clutter reports
- policy reports
- snapshot audit reports
- replay simulation reports
- runtime UI operator status
- logs and diagnostics

### Testing and operator outputs do not belong in:
- intelligent alert copy
- continuity update copy
- follow-through update copy
- recap copy
- AI trader-facing post copy
- stock-context opener copy

If a Discord post helps the operator more than the trader, that information is in the wrong place.

---

## Codex Implementation Guidance

## 1. Treat trader-view-only output as a hard requirement

Codex should review every trader-facing formatter and ask:

> Is this sentence helping a trader understand the setup, or is it helping the operator understand the system?

If it is mainly helping the operator, move it out of Discord.

## 2. Keep hinting language, remove execution language

Codex should allow language that hints at what matters, such as:
- needs to hold
- needs acceptance above
- reclaim would improve the setup
- risk opens if support is lost
- room stays limited until resistance clears

But it should remove or rewrite language that says what the trader should directly do.

## 3. Audit all trader-facing formatters using this rule

Main files to review and align:
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/trader-message-language.ts`
- `src/lib/ai/trader-commentary-service.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/runtime/manual-watchlist-page.ts`

The audit should focus on final Discord-visible wording, not only internal metadata.

## 4. Tighten AI commentary validation further

Current AI commentary rules are better than before, but they should be audited specifically for lines that still imply action.

Examples to reject or rewrite more aggressively:
- longs should wait
- traders should wait
- best entry
- safe entry
- can buy if
- should add
- should trim
- should exit

Replace them with more observational trader hints.

## 5. Add tests that enforce the boundary

Codex should add or tighten tests that verify trader-facing output:
- does not contain execution advice
- does not contain operator-only language
- does not contain debugging/system phrases
- remains long-only and non-short-biased
- uses trader hints instead of execution coaching

---

## Suggested Test Categories

### A. Trader-view-only wording tests

Assert that trader-facing posts do not contain:
- alert direction
- continuation thread language
- mapped / remapped phrasing
- policy or suppression language
- operator review terms

### B. No direct execution advice tests

Assert that trader-facing posts do not contain:
- buy here
- buy now
- sell now
- take profit
- stop out
- trim here
- add here
- exit now
- short setup

### C. Allowed trader-hint tests

Assert that trader-facing posts may contain:
- needs to hold
- buyers need acceptance above
- reclaim would improve the setup
- risk opens if support breaks
- room is limited until resistance clears

### D. AI commentary boundary tests

Assert that AI commentary follows the same rules and never becomes more advisory than deterministic posts.

---

## Questions Codex Should Answer In Its Implementation Notes

1. Which trader-facing phrases were rewritten because they sounded too much like execution advice?
2. Which trader-facing phrases were rewritten because they sounded like operator/debugging language?
3. What new tests now enforce trader-view-only Discord language?
4. Did any AI commentary paths still allow advisory language, and how were they tightened?
5. Which Discord-visible messages are still trader-facing only, and which information was moved to operator artifacts instead?

---

## New Work For Codex After The Latest Audit

This section is new and reflects the remaining work still needed after the latest repo audit.

### Current audit conclusion

Codex followed this document substantially, but not fully.

Good progress already made:
- a dedicated live-thread post-policy layer now exists
- trader-critical vs optional vs operator-only output is more explicit
- replay and audit tooling now exist to inspect thread noise
- AI commentary rules are stricter than before
- trader-facing alert wording is cleaner than older versions

But the audit still found gaps that need another pass.

### Remaining problems to fix

#### 1. Trader-facing Discord posts still contain some system-shaped labels

Examples that still need cleanup in Discord-visible text:
- `Status: Cleared`
- `Signal: high severity | medium confidence`
- `Decision area`
- `setup update`
- `state recap`
- `setup move`

These are better than raw debugging language, but they still feel system-shaped instead of naturally trader-facing.

#### 2. AI commentary still allows borderline instructional phrasing

A key example that is still too advisory:
- `Longs should wait for a reclaim before trusting the setup.`

This must be rewritten into observational trader language.

Preferred style:
- `A reclaim would make the setup cleaner for longs.`
- `The setup looks cleaner if price can reclaim the area first.`

#### 3. Trader-facing tests are still more formatting-focused than product-language-focused

There are good formatting tests and policy tests already, but there still need to be stronger tests for:
- newer-trader readability
- system-language leakage into Discord
- advisory phrasing leakage into AI recap/commentary
- overlapping post types that say the same thing in different words

---

## Detailed Next Steps For Codex

### Task 1. Rewrite remaining system-shaped Discord labels

Review all Discord-visible output builders and replace the remaining system-shaped phrases with calmer trader language.

#### File focus
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/trader-message-language.ts`

#### Specific replacements to implement
- `Status: Cleared` -> `Price is above resistance for now`
- `Status: working` -> `The move is still holding up`
- `Status: failed` -> `The move lost momentum and the setup weakened`
- `Signal: high severity | medium confidence` -> either remove from trader-facing Discord or rewrite to something softer like `Importance: high | Confidence: medium`
- `Decision area:` -> `Level that needs to hold:` or `Level to watch closely:`
- `setup update` -> `What changed`
- `state recap` -> `Current read` or `Where things stand now`
- `setup move` -> `Price move since the setup:` or `Move since the signal:`

#### Rule
If a line sounds like a dashboard label more than trader language, rewrite it.

### Task 2. Tighten AI commentary validation again

#### File focus
- `src/lib/ai/trader-commentary-service.ts`
- `src/tests/trader-commentary-service.test.ts`

#### New rule
Reject or rewrite commentary that uses instruction-like constructions even if they do not use classic buy/sell words.

#### Phrases to block more aggressively
- `Longs should...`
- `Traders should...`
- `Wait for...`
- `Best entry...`
- `Good place to add...`
- `Safe if...`
- `Can buy if...`
- `Should trim...`
- `Should exit...`

#### Allowed replacement style
- `A reclaim would make the setup cleaner for longs.`
- `Buyers still need acceptance above resistance.`
- `The long setup looks weaker while price stays below that area.`
- `Holding this support would keep the setup in better shape.`

#### Test additions required
Add explicit tests that reject the above blocked forms and accept the observational rewrites.

### Task 3. Add stronger trader-view-only language tests

#### File focus
- `src/tests/alert-router.test.ts`
- add any new focused trader-language test file if needed

#### Add assertions that trader-facing Discord text does not contain:
- alert direction
- continuation thread language
- mapped / remapped
- operator-only
- policy / suppression language
- replay / simulation terms
- runtime-only labels

#### Add assertions that trader-facing text does contain natural trader hints like:
- needs to hold
- buyers need acceptance above
- reclaim would improve the setup
- risk opens if support breaks
- room remains limited until resistance clears

### Task 4. Add repeated-story wording tests

#### Goal
Not only prevent duplicate posts by policy, but prevent different post types from saying the same thing in slightly different words.

#### File focus
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/live-thread-post-policy.test.ts`
- add targeted wording-level tests if needed

#### Add test scenarios where:
- a critical alert posts and a weaker continuity post should not restate the same trader meaning
- a follow-through state post posts and a recap should not say the same thing again in softer words
- a final follow-through verdict posts and continuity/recap should yield

### Task 5. Keep testing and operator language out of Discord stock-context opener too

#### File focus
- `src/lib/alerts/discord-rest-thread-gateway.ts`
- `src/lib/stock-context/finnhub-thread-preview.ts`
- tests around those files

#### Rule
The stock-context opener must stay compact and trader-readable.
It should not become a testing/info dump and should not add operator-style explanation to the thread.

### Task 6. Update docs to reflect the stricter boundary

#### File focus
- `README.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`

#### Required doc update themes
- Discord posts are trader-view only
- operator/testing language belongs in artifacts and logs
- AI commentary is observational and non-instructional
- remaining system-shaped wording cleanup completed in this pass

---

## Required Acceptance Standard For This Next Pass

This next pass should be considered complete only if all of the following are true:

1. Trader-facing Discord posts no longer contain the main remaining system-shaped labels listed above.
2. AI commentary no longer permits `Longs should...` or similar borderline-instructional phrasing.
3. Trader-facing tests explicitly enforce the no-system-language and no-advice boundary.
4. New tests cover repeated-story wording overlap, not just posting suppression logic.
5. Docs reflect that Discord is trader-view only and testing language belongs elsewhere.

---

## Final Rule To Remember

Best summary rule:

> Discord posts should now read as trader context only.
> They may hint at what matters for the trade, but they should not tell the trader exactly what to do.
> Anything mainly useful for testing the system belongs outside Discord.

That is the boundary Codex should work from going forward.
