# Project Level Suggestions

Date: 2026-04-23
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document captures broader project-level suggestions beyond the narrow question of old-versus-new levels.

The goal is to help guide the project toward becoming:
- more trader-useful
- more trustworthy
- less noisy
- easier to maintain
- easier to tune with evidence instead of intuition

This is intended as a strategic handoff for future Codex work.

---

## Executive Summary

The project is moving in a strong direction.

The strongest recent progress is not only in the levels work.
It is also in:
- long-run runtime review
- follow-through tracking
- session and thread summary artifacts
- alert-family evaluation
- trader-facing wording improvements
- optional AI recap tooling
- more disciplined live post gating

The biggest risk is no longer lack of capability.
The biggest risk is **complexity and sprawl**.

The system is becoming smart enough to generate many kinds of output.
That means the project now needs stronger discipline around:
- what belongs in live trader-facing threads
- what belongs in operator review artifacts
- what belongs in deterministic logic
- what should remain optional AI enhancement

The main strategic recommendation is:

> Make the project increasingly evidence-driven and increasingly selective about live output.

---

## 1. Define One Primary Success Metric

Right now the project is improving in many directions at once:
- level quality
- event detection
- message wording
- follow-through grading
- thread continuity
- clutter control
- session review
- AI recap tooling

That is productive, but the project needs one dominant scoreboard.

### Suggested primary success metric

**useful trader alerts with controlled thread noise**

This metric fits the current direction of the repo because recent work already supports it through:
- session summaries
- thread summaries
- follow-through grading
- usefulness and noise review concepts
- live post gating

### Why this matters

Without one primary metric, feature growth can look good while the product gets harder to use.

With one primary metric, the project can ask a consistent question:

> Does this change improve trader usefulness without making the thread noisier than it needs to be?

---

## 2. Separate The System Into Clearer Layers

The project is now mixing several concerns that should gradually become more explicit architectural layers.

### Current concerns that need clearer separation
- deterministic market-structure logic
- event detection
- opportunity interpretation
- live posting policy
- thread and delivery coordination
- session artifact generation
- optional AI recap/commentary

### Why this matters

If these concerns continue blending together, the project will become harder to maintain, harder to test, and harder to tune.

The clearest current example is the runtime manager becoming a central control hub for many unrelated responsibilities.

### Suggested long-term layer structure

#### Layer 1. Deterministic market logic
- levels
- event detection
- opportunity scoring
- interpretation
- follow-through grading

#### Layer 2. Live post policy
- critical vs optional post classes
- cooldowns
- dedupe
- clutter limits
- narration suppression

#### Layer 3. Delivery coordination
- Discord thread routing
- delivery failure handling
- retry/backoff behavior
- activation and restore orchestration

#### Layer 4. Review artifact generation
- session summaries
- thread summaries
- session review files
- clutter reports
- delivery audit rollups

#### Layer 5. Optional AI recap layer
- post-run summaries
- operator commentary
- recap enhancement based only on deterministic facts

### Recommendation

Do not attempt a huge rewrite immediately.
Instead, let future passes gradually push code toward these boundaries.

---

## 3. Treat Operator Review Artifacts As A Core Strength

One of the best things added recently is the long-run review workflow and session artifact system.

### Why it matters

This gives the project a real advantage:

It can now be tuned and judged using:
- real runtime behavior
- real session logs
- real Discord delivery history
- real post-alert follow-through
- real per-symbol and per-family usefulness clues

instead of relying only on:
- unit tests
- terminal logs
- one-off chart opinions

### What this means strategically

The review artifacts are not side tooling anymore.
They are now part of the product development engine of the repo.

### Recommendation

Keep investing in artifacts that make the system easier to judge honestly, especially:
- session summaries
- per-symbol summaries
- family-level performance rollups
- clutter and suppression reporting
- delivery health reporting

---

## 4. Be Stricter About What Gets To Speak In Live Discord

The project is now capable of producing many categories of live thread output.

### Current risk

A system can become worse not because the logic is weak, but because it says too much.

Recent work adds or supports multiple thread post classes such as:
- alerts
- snapshots
- extensions
- continuity posts
- follow-through state posts
- final follow-through outcome posts
- recap posts

### Strategic rule

The live symbol thread should remain a **trader tool**, not a full operator report.

### Recommendation

Keep live thread output focused on:
- important setup alerts
- major state changes
- completed follow-through outcomes
- minimal recap or continuity support only when it materially helps the trader

Put richer narrative and review detail into offline artifacts whenever possible.

---

## 5. Do A Tightening Cycle Instead Of A Feature Expansion Cycle

The project has enough moving parts now that another feature-expansion burst is less valuable than a tightening cycle.

### What a tightening cycle should focus on
- reducing overlap
- simplifying wording
- validating thresholds
- confirming clutter reduction
- improving maintainability
- clarifying architectural boundaries

### Why this is the right time

The repo already has enough instrumentation and artifacts to support evidence-driven refinement.
Now it should use that evidence before adding many more concepts.

### Recommendation

Favor a few passes of:
- tuning
- cleanup
- decomposition
- artifact improvement

before a larger new feature wave.

---

## 6. Think More In Terms Of Alert Families Than Individual Alerts

The project already appears to be moving in this direction, and that is correct.

### Why this matters

The most valuable learning usually comes from patterns like:
- which alert families work repeatedly
- which families stall out
- which families become late too often
- which families are structurally sound but trader-noisy

rather than from isolated one-off alerts.

### Recommendation

Make family-level review a first-class lens in the project.

Use existing and future artifacts to answer:
- which families are truly earning their place
- which families are mostly noise
- which families need threshold tightening
- which families need wording improvement rather than logic changes

---

## 7. Keep AI In A Strict Supporting Role

The current AI commentary layer is reasonable because it is recap-oriented and downstream of deterministic facts.

### Good use cases for AI in this project
- post-run session summaries
- post-run thread recap enhancement
- operator-facing noisy-family review assistance
- summarization of deterministic artifacts

### Bad use cases for AI in this project
- signal generation
- signal scoring
- replacing deterministic truth
- acting as the source of market interpretation without deterministic grounding

### Recommendation

Keep AI:
- optional
- recap-oriented
- operator-supportive
- clearly downstream of deterministic runtime facts

---

## 8. Treat Thread Trust As A Product-Level Concept

A good thread is not just a thread that had a few good alerts.
It is a thread that **feels trustworthy over time**.

### Suggested components of thread trust
- low clutter
- low contradiction
- clear setup progression
- clear closure through follow-through or failure
- consistent wording
- limited repeated low-value narration
- good alignment between posted alerts and later outcomes

### Recommendation

Add thread trust as a mental model for future tuning and review.
A thread can be judged not only on whether it posted something technically correct, but on whether it remained credible and useful over time.

---

## 9. Decide Which Parts Are Stable Enough To Lock Down

The project is still evolving rapidly, but some areas now look mature enough to treat as more stable.

### Likely stable enough to commit to more strongly
- long-run session artifact system
- delivery auditing
- follow-through grading direction
- usefulness/noise-oriented review approach
- AI staying optional and recap-oriented

### Still evolving and should remain flexible
- live narration policy
- wording density and label count
- exact continuity and recap behavior
- optional post thresholds and budgets

### Recommendation

Be more deliberate about which parts of the repo are still experimental and which should now be treated as core architecture.

---

## 10. Keep The Project Biased Toward Trader Reality, Not Internal Cleverness

This is the most important broad suggestion.

The repo is becoming sophisticated enough that it can produce lots of smart internal descriptions.
That does not automatically mean it is becoming more useful to the trader.

### Decision filter for future work

For every meaningful addition, ask:

1. does this improve trader usefulness
2. does this improve trust
3. does this reduce confusion or noise
4. does this improve operator review enough to justify the added complexity

If the answer is no, the feature should likely either:
- stay offline in review artifacts
- stay optional
- or not be added

---

## Suggested Strategic Priorities Going Forward

### Priority A. Protect live thread clarity
- keep live output selective
- continue reducing repeated optional narration
- prefer meaningful state changes over commentary density

### Priority B. Expand evidence quality, not feature count
- improve review artifacts
- improve clutter reporting
- improve family-level usefulness analysis
- improve suppression and delivery reporting

### Priority C. Gradually separate architectural concerns
- move toward cleaner layering
- reduce control-hub files over time
- make policy logic easier to inspect and test

### Priority D. Validate the wording layer before expanding it further
- consolidate overlapping concepts
- keep a smaller core live vocabulary
- use evidence to decide what language earns its place

### Priority E. Preserve deterministic trust
- keep AI downstream
- keep core signal truth deterministic
- use AI to summarize, not decide

---

## Final Recommendation

The project is in a strong phase.
It has enough capability now.

The next step is not mainly more capability.
The next step is:
- clearer structure
- stronger evidence loops
- cleaner live output
- more disciplined boundaries

The best strategic framing is:

> make the system better at being selectively useful, not just more expressive

That is the direction most likely to make the project stronger over time without burying the trader in unnecessary thread chatter or burying the codebase in avoidable complexity.
