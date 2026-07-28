# Codex Project Improvement Plan

Date: 2026-04-28
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document is a detailed handoff for Codex based on the latest repo state.

It is not focused only on one subsystem.
It is meant to guide the next meaningful project-improvement pass across:
- runtime architecture
- Discord thread behavior
- trader-facing signal quality
- operator review artifacts
- maintainability
- optional AI recap/commentary boundaries

The core goal is to improve the project in a way that makes it:
- more useful to traders
- less noisy in live Discord threads
- easier to reason about
- easier to tune with evidence
- safer for future Codex passes to extend

---

## Executive Summary

The project is now much more than a levels engine.

It is evolving into three connected products:

1. a deterministic market-structure and signal engine
2. a trader-facing live runtime with Discord thread behavior
3. an operator-facing review and diagnostics system

That direction is promising.
However, the current risks are no longer about a lack of capability.
The current risks are:
- runtime complexity
- too much logic concentrating in a few large files
- live thread output still having the potential to over-post or over-narrate
- feature surfaces growing faster than architecture is being clarified

The best next pass is **not** another broad feature-addition pass.
The best next pass is a **clarifying, decomposing, and evidence-driven tightening pass**.

## Implementation Progress

### 2026-04-28 follow-up pass

Started the recommended clarifying pass without attempting a broad runtime rewrite.

Completed:
- extracted the first dedicated live-thread post policy module for follow-through and AI same-story decisions
- added optional continuity, recap, and live follow-through-state policy decisions to the extracted module
- added isolated tests for follow-through duplicate suppression, AI same-story / in-flight gating, optional-post density, and narration-burst control
- tightened completed follow-through updates so repeated same-symbol, same-event, same-level outcomes need a label change or material directional change before posting again
- tightened live AI reads so low-value or already-in-flight duplicate story commentary is suppressed before the OpenAI call is made
- added `thread-post-policy-report.json` and `.md` generation from `discord-delivery-audit.jsonl` for repeated story clusters, output class mix, post bursts, recommendations, and per-thread trust scoring
- added `snapshot-audit-report.json` and `.md` generation from `discord-delivery-audit.jsonl` for displayed versus omitted snapshot levels and omission reasons
- wired audit report generation into the long-run launcher shutdown path and added a manual `npm run longrun:audit:reports -- <session-folder>` command
- added `long-run-tuning-suggestions.json` and `.md`, turning the policy and snapshot audit reports into ranked action/watch/info items
- added a manual-runtime `Review Artifacts` panel so generated session reports can be previewed from the browser UI
- added `npm run validation:levels:quality -- <SYMBOL> [output-json-path]` to flag thin or suspiciously wide forward ladders before changing support/resistance logic

Still open:
- activation / restore coordinator extraction
- symbol thread coordinator extraction
- broader continuity state coordinator extraction
- evidence-based tuning from the next live-market session using the new reports and tuning-suggestion artifact

---

## Current Strengths To Preserve

These areas are already becoming genuine strengths of the project and should be preserved and extended carefully.

### 1. Long-run review infrastructure

The project now has strong review surfaces such as:
- session summaries
- thread summaries
- Discord delivery audit
- human review feedback loop
- session review artifacts
- thread clutter reporting
- operator-oriented runtime diagnostics

This should remain a first-class strength.

### 2. Follow-through and outcome-aware review

The project is doing increasingly useful work around:
- follow-through grading
- family-level outcome review
- alignment between alerts and later outcomes
- distinguishing working, stalled, and failed ideas

This is one of the most valuable parts of the current direction.

### 3. Live thread discipline is improving

The runtime has already added:
- stricter repost windows
- family-aware throttling
- continuity tightening
- same-story ownership rules
- extension dedupe
- clutter-oriented review logic

That is good progress.
The next step is to make that discipline easier to understand, inspect, and maintain.

### 4. Trader-facing wording is moving in a useful direction

The project is doing better at:
- trader-friendly zone language
- room / path awareness
- stronger state framing
- better outcome wording
- support/resistance readability

This is a strength, but it now needs consolidation more than further expansion.

### 5. AI is currently in a reasonably safe role

The optional AI layer is still positioned mainly as:
- recap enhancement
- session review support
- operator-supportive commentary

That is the correct role and should be protected.

---

## Main Problems To Solve Next

## 1. Runtime orchestration logic is becoming too concentrated

The most important structural problem is that the runtime is accumulating more and more logic in a small set of heavy orchestration files, especially the manual watchlist runtime manager.

This creates several risks:
- harder future changes
- harder reasoning about side effects
- harder debugging when post timing or suppression looks wrong
- harder testing of policy logic in isolation
- greater chance that one new feature breaks an unrelated part of runtime behavior

### Recommendation

The next pass should begin splitting orchestration responsibilities into clearer modules.

Do not attempt a giant rewrite.
Use a controlled extraction strategy.

### Suggested extraction targets

#### A. Live thread post policy module
Owns:
- critical vs optional post classing
- post budgets
- same-story dedupe
- suppression rules
- ownership / replacement rules
- decision-context-change gating

#### B. Activation / restore coordinator
Owns:
- queued activation
- restore flow
- seed timeout handling
- startup readiness sequencing
- activation rollback / grace handling

#### C. Symbol thread coordinator
Owns:
- stock-context opener sequencing
- first snapshot ordering
- extension posting sequencing
- thread-level post routing orchestration

#### D. Follow-through / continuity state coordinator
Owns:
- continuity transitions
- follow-through state transitions
- final outcome posting arbitration
- same-symbol same-event narration ownership

### Deliverable

Codex should extract at least one of these into its own module in the next pass, with tests.

---

## 2. Discord threads still need a stricter usefulness model

The live thread should help a trader who is:
- already in the trade
- deciding whether to enter
- deciding whether to keep holding
- deciding whether to trim or exit

The thread should not keep narrating the same running trade unless something materially changed.

### Recommendation

Make **decision-context change** the main posting rule for optional posts.

Optional posts should not fire because the system observed something again.
They should fire because the trader's management context changed meaningfully.

### What to implement

#### A. Decision-context change gate
Before optional post routing, determine whether one of these actually changed:
- entry quality
- hold quality
- invalidation risk
- target clarity
- path quality to next barrier
- follow-through status
- key level ownership / failure

If none materially changed, suppress the post.

#### B. Same-story fingerprinting
For optional posts, compute a story fingerprint using something like:
- symbol
- side
- event family
- setup state
- follow-through state
- key level / barrier context
- rounded time bucket

If the fingerprint is effectively unchanged from the last relevant optional post, suppress the new one.

#### C. Optional post budget per symbol thread
After a critical alert, allow only a small number of optional posts until the story meaningfully advances or fails.

Budget should reset only on:
- major state progression
- major failure
- meaningful barrier/target change
- final evaluation

#### D. One optional narrator per phase
At any given moment, continuity, recap, and live follow-through-state should not all narrate the same story.
One should win.
The others should yield.

#### E. Post replacement behavior
When a stronger post lands, weaker nearby narration should be suppressed.
Examples:
- final follow-through verdict replaces nearby recap need
- critical alert replaces same-moment weak continuity
- strong live-state update replaces weaker recap

### Deliverable

Codex should implement at least the decision-context gate and same-story fingerprinting in the next pass.

---

## 3. Trader-critical output and operator-review output need harder separation

The project has gotten rich enough that it now needs explicit rules for what belongs live and what belongs offline.

### Recommendation

Create a formal output classification model and use it consistently across runtime and artifacts.

### Suggested classes

#### Trader-critical live output
- important setup alerts
- meaningful level snapshots / extensions
- major state changes
- completed follow-through outcomes

#### Trader-helpful optional output
- continuity updates
- live follow-through state updates
- rare recap posts

#### Operator-only output
- most review commentary
- most rich diagnostics
- most clutter and suppression analysis
- most artifact-rich explanatory context

### Why this matters

The more detail the system can produce, the more important it is that not all of it speaks in the live thread.

### Deliverable

Codex should codify this classification in code and docs, not only in implied behavior.

---

## 4. The project should formalize a symbol lifecycle model

The runtime and UI now clearly deal with more than just active/inactive.

### Recommendation

Create a more explicit symbol lifecycle state model.

### Suggested states
- `activating`
- `seeding`
- `thread_ready`
- `snapshot_ready`
- `observational`
- `actionable`
- `refresh_pending`
- `stalled`
- `failed`
- `inactive`

### Why this matters

This would improve:
- UI clarity
- review honesty
- lifecycle artifacts
- activation / restore debugging
- thread policy decisions

### Deliverable

Codex should define and thread a clearer lifecycle model through persistence, runtime UI, and review artifacts.

---

## 5. Freeze wording expansion and do a wording consolidation pass

The project already has many wording layers.
That is enough for now.

### Recommendation

Do not add many new trader-language categories in the next pass.
Instead:
- consolidate overlap
- simplify live wording
- reduce repeated low-signal phrasing
- keep richer nuance in review artifacts where appropriate

### Areas to review
- setup-state wording
- failure-risk wording
- trigger-quality wording
- recap phrasing
- continuity phrasing
- optional narrative lines that restate the same benign idea

### Deliverable

Codex should run a wording audit and explicitly identify:
- wording that is core and worth keeping live
- wording that is redundant
- wording that should move toward offline artifacts

---

## 6. Protect the operator-review system as a core product feature

The operator-review side of the repo is one of the most important strategic advantages of the project now.

### Recommendation

Keep pushing investment into review artifacts instead of defaulting to more live runtime complexity.

### Useful next artifact improvements
- stronger per-symbol clutter breakdowns
- per-family usefulness rollups
- optional-post attempted vs allowed vs suppressed counts
- suppression reason counts by symbol and family
- clearer thread trust scoring

### Suggested new artifact ideas

#### A. `thread-post-policy-report.json`
Per symbol, record:
- critical posts attempted / posted
- optional posts attempted / posted / suppressed
- suppressed by reason
- story-fingerprint collisions
- post budget exhaustion
- ownership preemption counts

#### B. `family-live-output-review.json`
Per event family, record:
- critical vs optional live post ratios
- average clutter pressure
- average suppression pressure
- family-level usefulness feedback
- family-level follow-through quality

### Deliverable

Codex should add at least one artifact that makes the current live-post discipline easier to judge after a session.

---

## 7. Add a thread trust score

A thread should not only be measured by how many alerts it produced.
It should be measured by whether it stayed trustworthy.

### Suggested thread trust components
- low clutter
- low contradiction
- low repeated narration
- good critical-to-optional post ratio
- good alert-to-outcome alignment
- low delivery instability
- clear phase progression

### Recommendation

Add a deterministic `threadTrustScore` or equivalent to per-symbol summary artifacts.

### Deliverable

Codex should design a first deterministic thread trust heuristic and expose it in thread review artifacts.

---

## 8. Keep AI optional and downstream of deterministic facts

The repo is still in a good place here, but the boundary needs to stay explicit.

### Recommendation

Keep AI limited to:
- recap enhancement
- session review support
- operator commentary over deterministic artifacts

Do not expand AI into:
- live signal generation
- live signal ranking
- live signal truth ownership
- replacing deterministic alert wording by default

### Deliverable

Codex should keep AI changes scoped to recap and review enhancement only unless a separate deliberate architecture decision is made.

---

## 9. Continue investing in tests around runtime behavior, not only engine logic

One positive sign in the repo is continued test expansion around:
- runtime manager behavior
- alert router behavior
- thread gateway behavior
- persistence
- commentary service behavior
- server/runtime flows

That should continue.

### Recommendation

Keep adding tests for:
- same-story suppression
- post budget exhaustion
- narrator ownership
- replacement behavior
- activation visibility and failure clarity
- thread lifecycle honesty
- artifact correctness under low-output vs noisy-output conditions

### Deliverable

Every meaningful new runtime policy rule should come with targeted tests.

---

## Proposed Next Codex Pass: Ordered Work Plan

## Phase 1. Runtime posting-policy clarification

### Goal
Make live-post discipline easier to understand and safer to evolve.

### Work
1. Extract or create a dedicated live-thread post policy module.
2. Implement decision-context change gating.
3. Implement same-story fingerprinting.
4. Implement or refine per-thread optional post budget.
5. Add tests for all of the above.

### Success condition
Live thread optional posting becomes easier to reason about and less dependent on one large orchestration file.

---

## Phase 2. Artifact visibility for post-policy behavior

### Goal
Make anti-noise behavior measurable.

### Work
1. Add policy-report artifact with optional-post attempted/allowed/suppressed counts.
2. Add suppression reasons to symbol review rollups.
3. Add family-level live-output review artifact or summary section.
4. Add thread trust or equivalent deterministic thread-health score.

### Success condition
The project can prove whether live-post discipline is helping rather than only assuming it is.

---

## Phase 3. Symbol lifecycle clarification

### Goal
Improve startup, activation, restore, and UI honesty.

### Work
1. Define explicit symbol lifecycle states.
2. Thread those states through runtime manager, persistence, UI, and review artifacts.
3. Improve visibility for activation failure, long seeding, and stalled states.
4. Ensure startup-pending or refresh-pending threads are not misclassified as noisy.

### Success condition
Traders and operators can tell whether a symbol is genuinely noisy, still activating, or truly unhealthy.

---

## Phase 4. Wording consolidation pass

### Goal
Reduce live-thread wording overlap without losing clarity.

### Work
1. Audit current live wording categories.
2. Identify overlap and redundancy.
3. Keep a smaller core live vocabulary.
4. Push richer nuance toward review artifacts when it is not crucial for live trading decisions.

### Success condition
Live output becomes easier to scan and less repetitive.

---

## Phase 5. Runtime decomposition continuation

### Goal
Reduce control-hub complexity.

### Work
1. Extract one or more runtime coordination responsibilities into focused modules.
2. Keep behavior preserved with tests.
3. Update docs to reflect new boundaries.

### Success condition
Future Codex passes can change one part of runtime policy without touching half the system.

---

## Implementation Guardrails For Codex

1. Do not expand live thread verbosity in the next pass unless it directly improves trader decision usefulness.
2. Prefer stronger offline artifacts over richer live narration when there is a tradeoff.
3. Do not let AI move upstream into live signal truth.
4. Avoid giant rewrites; use extraction with behavior-preserving tests.
5. Keep all post-discipline logic inspectable and measurable.

---

## Questions Codex Should Explicitly Answer In Its Implementation Notes

1. What live-post rule now determines whether an optional thread update is worth sending?
2. How is same-story duplicate narration prevented?
3. What are the current post classes, and which are trader-critical versus optional versus operator-only?
4. How can an operator now tell whether a thread was noisy, quiet, pending, or trustworthy?
5. Which runtime responsibilities were extracted or clarified in this pass?
6. What wording was simplified or consolidated?

---

## Final Recommendation

The project should now move from:

**powerful runtime with many rules**

toward:

**clear runtime architecture with inspectable policy layers and evidence-backed live thread discipline**

That is the most important next step.

The project already has strong foundations.
The next improvement is not mainly more capability.
It is:
- cleaner architecture
- stricter live usefulness standards
- better policy observability
- clearer lifecycle honesty
- safer maintainability for future Codex passes
