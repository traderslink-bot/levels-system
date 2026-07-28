# Codex Runtime And Signal Review Report

Date: 2026-04-23
Repo: `traderslink-bot/levels-system`
Primary branch reviewed: `codex/runtime-compare-tooling`

## Purpose

This report is a working handoff for the next Codex pass.

It is not focused on old-vs-new level replacement anymore.
The main purpose is to evaluate the broader runtime, signal-quality, alerting, recap, and testing work that has been added recently, then turn that review into a concrete implementation guide.

This document should help answer:

1. what recent Codex work is genuinely valuable and should be kept building forward
2. what work is becoming too broad or too noisy and needs tighter discipline
3. what the next implementation priorities should be
4. what should stay optional tooling versus what should become core runtime behavior

---

## Executive Summary

Recent Codex work has meaningfully improved the repo in three important ways:

1. long-run operational review is much stronger
2. trader-facing output and follow-through context are more mature
3. the runtime now has a much better feedback loop for judging usefulness versus noise

The strongest non-levels work is the long-run testing and review infrastructure. That work adds real value because it helps judge the app on actual runtime behavior, downstream Discord delivery, and post-alert usefulness instead of relying only on unit tests or terminal scrollback.

The main risk is scope sprawl.

The runtime is beginning to accumulate many live behaviors at once:
- lifecycle events
- alert audits
- follow-through state posts
- continuity posts
- symbol recap posts
- AI recap generation
- per-symbol thread summaries
- session summaries
- session reviews
- human review feedback loops
- many new trader-facing wording dimensions

Individually, most of these are reasonable.
Together, they risk turning the runtime into a very large multi-purpose operating layer before the core trader-value loop is fully stabilized.

The next Codex pass should therefore prioritize **discipline, reduction of surface-area confusion, and evidence-driven tightening** rather than simply adding more features.

---

## High-Value Work That Should Be Preserved And Extended

### 1. Long-run testing workflow

The long-run testing workflow is one of the best additions in the recent Codex batch.

Key strengths:
- creates session-scoped artifacts
- separates operational logs from diagnostics logs
- records Discord delivery attempts and failures
- maintains session-level and per-symbol summaries
- supports human review feedback
- makes it easier to review real runtime sessions without depending on terminal history

This is valuable because the app needs to be judged on:
- real symbol activation and reactivation behavior
- real IBKR stability
- real Discord delivery
- real signal usefulness over time
- real alert-family noise patterns

This workflow should remain a first-class part of the project.

### 2. Session summary and per-symbol thread review artifacts

The move toward:
- `session-summary.json`
- `thread-summaries.json`
- `trader-thread-recaps.md`
- `session-review.md`
- `discord-delivery-audit.jsonl`

is directionally strong.

These artifacts create a practical operator-review loop and also help answer a core business question:

> Did the runtime produce trader-useful output, or did it mostly produce noisy output?

That is the right question.

### 3. Follow-through tracking and evaluation-aware review

The additions around:
- completed follow-through grading
- live follow-through state updates
- event-family outcome summaries
- alignment between alerts and later evaluations

are highly valuable.

This is one of the most important non-levels improvements because it closes the gap between:
- what the app posted
- what actually happened afterward

That alignment should continue to be developed carefully.

### 4. More trader-friendly message language

The project is moving in a better direction by replacing internal wording with trader-facing language such as:
- light / moderate / heavy / major support and resistance
- tight / limited / open room
- path quality and clutter concepts
- setup-building / confirmation / continuation / weakening / failed framing
- follow-through grades like strong / working / stalled / failed

This is a useful direction because it makes the system more legible to actual traders.

### 5. Optional AI commentary as a recap layer only

The current AI commentary layer is acceptable because it is positioned as a summarization and explanation layer on top of deterministic facts.

That is the correct role for AI in this project.

This layer should remain:
- optional
- recap-oriented
- subordinate to deterministic runtime facts

It should not expand into core signal generation.

---

## Main Risks And Concerns

### 1. Runtime surface-area sprawl

The single biggest concern is that too many new behaviors are being introduced into the runtime at once.

The runtime is now trying to do all of the following:
- monitor symbols
- seed levels
- manage threads
- post snapshots
- post extensions
- post core alerts
- post follow-through state changes
- post completed follow-through outcomes
- post continuity updates
- post symbol recap updates
- emit lifecycle events
- write audit trails
- support AI commentary
- support long-run summary artifacts

This is a lot.

The danger is not that each feature is bad.
The danger is that the runtime becomes hard to reason about, hard to debug, and hard to tune because there are too many moving parts altering the user-facing thread behavior.

### 2. Discord thread clutter risk

The app is increasingly capable of posting multiple classes of content into the same symbol thread:
- setup alerts
- continuity posts
- follow-through state updates
- completed follow-through verdicts
- symbol recaps
- snapshots and extensions

That can become valuable context.
It can also become thread clutter.

This is now one of the most important project risks.

The next phase should explicitly answer:

> Are the extra thread posts making the Discord experience better, or just denser?

This should be judged using long-run evidence, not intuition.

### 3. Too many trader-facing wording dimensions at once

Recent work adds many descriptive dimensions such as:
- room
- path quality
- path constraints
- barrier clutter
- exhaustion
- trigger quality
- failure risk
- trade map
- continuity state
- follow-through state
- recap guidance

Many of these are good ideas.
But when too many dimensions are layered into runtime output at once, the result can become over-described rather than more useful.

The project should focus on the smallest set of wording dimensions that measurably improve trader usefulness.

### 4. Risk of feature-driven development outrunning usefulness validation

The roadmap is productive, but it is broad.
There is a real risk that new features keep being added because they sound useful, rather than because the evidence shows they improve trader outcomes or reduce confusion.

The repo should move more aggressively toward:
- measure first
- tune second
- add new dimensions only when justified

### 5. AI expansion risk

The current AI layer is acceptable.
But it should remain tightly constrained.

The repo should not drift into:
- AI-generated primary signal language everywhere
- AI-generated live alert decisioning
- AI-generated signal scoring
- AI-generated operational truth

AI should remain a recap and summarization layer until the deterministic runtime is more settled.

---

## What The Recent Work Seems To Be Optimizing For

The recent Codex work is implicitly trying to improve four things:

1. trader readability
2. operator reviewability
3. runtime observability
4. post-alert truth checking

These are the correct themes.

The implementation challenge now is not theme selection.
The challenge is prioritization and reduction.

---

## Recommended Project Framing For The Next Codex Pass

For the next pass, Codex should work from this framing:

### Core principle

Optimize for **trader usefulness per unit of thread noise**.

Not:
- maximum descriptive richness
- maximum number of review artifacts
- maximum number of post types

Instead:
- better signal
- less clutter
- clearer operator review
- tighter feedback loops

### Secondary principle

Keep the runtime lean enough that it can still be understood and tuned as a system.

If a feature improves reviewability but not live thread quality, it may belong in the review artifact layer rather than in live Discord posting.

### Third principle

Prefer evidence-producing infrastructure over live behavior expansion.

Examples:
- good: richer audit logs
- good: stronger per-symbol review summaries
- good: alert-family usefulness tracking
- be careful: more automatic in-thread recap chatter
- be careful: more live post categories without proof of value

---

## What Should Stay Core Runtime Behavior

These items appear worth keeping as core:

### Keep core
- long-run session artifact generation
- Discord delivery auditing
- lifecycle event logging
- alert suppression reason tracking
- event-family follow-through tracking
- session-level and symbol-level usefulness summaries
- basic trader-friendly alert wording
- completed follow-through outcome capture

These directly help the project become more measurable and more trustworthy.

---

## What Should Likely Stay Optional Or Be Tightened Before Expansion

### Keep optional or gate tightly
- AI recap generation
- live symbol recap posts
- live continuity posts beyond major state transitions
- too-frequent follow-through state posts
- any additional trader-facing metadata layers that do not yet have usefulness evidence

These may be useful, but they should not be allowed to expand freely until evidence shows they improve the live experience.

---

## Recommended Next Implementation Priorities

The next Codex pass should not primarily add new features.
It should instead tighten the system around the most important unanswered questions.

### Priority 1. Measure Discord thread clutter versus usefulness

Build a review path that explicitly answers:
- how many posts per symbol thread are being created
- what kinds of posts dominate
- which post categories correlate with useful threads
- which post categories correlate with noisy or cluttered threads

Recommended outputs:
- per-thread post-type counts
- per-symbol ratio of alerts to recap/continuity/follow-through posts
- clutter heuristics based on thread density and usefulness feedback
- identification of thread patterns that are too chatty

Goal:
Determine whether continuity posts, recap posts, and live follow-through posts are helping or crowding the thread.

### Priority 2. Tighten posting thresholds for non-core thread updates

For continuity posts, recap posts, and follow-through state posts:
- make transitions more meaningful before posting
- increase cooldowns where needed
- prefer bigger state changes over repeated restatements
- suppress repetitive commentary when the state is effectively unchanged

Goal:
Only post when there is real incremental trader value.

### Priority 3. Distinguish live thread value from review artifact value

Codex should separate features into two buckets:

#### live thread features
Only things that genuinely help a trader in the moment

#### operator review features
Things that help you debug, tune, and score the system after or during a session

Examples that should likely lean more into operator review than live thread posting:
- some recap details
- some continuity details
- some explanation richness
- some noisy-family analysis

Goal:
Keep the live trader thread cleaner while still preserving rich review data offline.

### Priority 4. Strengthen usefulness scoring around real user outcomes

Use the existing human review loop plus long-run artifacts to tighten:
- which alert families are useful
- which alert families are noisy
- which symbol contexts churn without value
- which follow-through grades matter most by alert family

Goal:
Drive tuning from review evidence rather than from feature ideas alone.

### Priority 5. Simplify or consolidate trader-facing wording dimensions

Codex should review the growing wording stack and decide which dimensions are actually core.

Suggested likely-core dimensions:
- room
- setup state
- follow-through state
- basic path quality
- support/resistance strength

Suggested candidates for consolidation or demotion unless proven useful:
- too many overlapping trigger-quality and failure-risk variants
- too many recap-only descriptors in live threads
- wording that restates the same concept in multiple labels

Goal:
Make live output easier to scan.

### Priority 6. Keep AI strictly recap-oriented

AI should remain limited to:
- post-run session summary enhancement
- post-run symbol thread recap enhancement
- optional operator-facing commentary over deterministic artifacts

Avoid expanding AI into:
- live signal generation
- live signal selection
- live signal scoring
- replacing deterministic alert wording by default

Goal:
Protect trust and determinism.

---

## Concrete Tasks For Codex

### Task Group A. Thread clutter analysis

Implement a deterministic analysis layer that reviews each session and reports:
- total post count per symbol thread
- counts by post type
- alert-to-context ratio
- recap density
- continuity density
- follow-through update density
- symbols most at risk of thread clutter
- symbols where added context appears to improve usefulness

Suggested artifact additions:
- `thread-clutter-report.json`
- additions to `thread-summaries.json`
- additions to `session-review.md`

### Task Group B. Post-value gating review

Audit the current conditions for posting:
- continuity updates
- symbol recap updates
- follow-through state updates

Then tighten logic so that:
- repeated low-value restatements are suppressed more aggressively
- mid-flight posts require clearer new information
- recap posts are reserved for genuinely evolving threads

Expected outcome:
Cleaner live threads without losing major state information.

### Task Group C. Operator-versus-trader output separation

Review all current live post categories and classify each as one of:
- trader-critical
- trader-helpful but optional
- operator-only

Then use that classification to:
- keep trader-critical posts live
- gate or reduce trader-helpful optional posts
- move operator-only richness into artifacts instead of live thread output

### Task Group D. Usefulness-first artifact refinement

Continue investing in the artifact side, especially:
- `session-summary.json`
- `thread-summaries.json`
- `session-review.md`
- `discord-delivery-audit.jsonl`

These are the strongest recent additions and should become the main tuning surface.

### Task Group E. Wording consolidation pass

Perform a wording audit across recent trader-facing labels and reduce overlap.

Questions Codex should answer:
- which labels are truly distinct and useful
- which labels duplicate the same meaning in different words
- which labels help a trader decide what matters next
- which labels are internally clever but externally noisy

Expected outcome:
A smaller, clearer trader-facing vocabulary.

---

## Implementation Guardrails For Codex

### Guardrail 1
Do not add new live thread post categories in the next pass unless they directly support clutter reduction, usefulness measurement, or posting discipline.

### Guardrail 2
Prefer improving operator artifacts over expanding live thread verbosity.

### Guardrail 3
When in doubt, route more richness into review artifacts rather than Discord live posts.

### Guardrail 4
Keep AI optional, recap-oriented, and downstream of deterministic facts.

### Guardrail 5
Use existing long-run evidence infrastructure to justify changes whenever possible.

---

## Questions Codex Should Explicitly Answer In The Next Pass

1. Which live post categories are earning their place in the symbol thread?
2. Which live post categories are mostly adding clutter?
3. What is the minimum live context needed for a trader to understand the setup lifecycle?
4. Which review artifacts are most useful for tuning the system?
5. Which wording dimensions should remain core, and which should be consolidated or removed from live output?
6. How can the runtime stay observable without becoming chatty?

---

## Recommended Deliverables For The Next Codex Pass

1. a thread clutter analysis artifact
2. a tighter classification of live post categories
3. reduced spam risk in continuity / recap / live state posts
4. clearer separation between trader output and operator output
5. a wording consolidation pass
6. updated docs summarizing what was tightened and why

---

## Final Recommendation

The next Codex pass should **not** mainly be a feature expansion pass.
It should be a **tightening and discipline pass**.

The strongest recent work has already created enough observability and review scaffolding to support that.
Now the project needs to use that scaffolding to:
- reduce unnecessary live output
- focus on trader usefulness
- keep review richness
- protect runtime clarity

If Codex executes well on that direction, the project will become more trustworthy and easier to tune without burying the trader in too much thread chatter.
