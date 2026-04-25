# Discord Thread Posting Suggestions

Date: 2026-04-25
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document is a focused handoff for Codex specifically about the posts that go into each ticker's Discord thread.

The main issue is not whether the project can produce useful posts.
The issue is that in many running trades, the thread still gets too many posts that are too similar, too frequent, or not useful enough to justify interrupting the trader.

The thread should primarily help a trader who:
- is already in the trade
- is considering entering
- is deciding whether to keep holding
- is deciding whether risk increased enough to trim or exit

The thread should not keep narrating the same trade unless something materially changed.

---

## Core Principle

### Only post when the trader's decision context changed

The runtime should not post just because it detected something again.
It should post only when the new information changes the trade decision context in a meaningful way.

Examples of meaningful trader-context change:
- setup confirmed in a stronger way
- setup failed or materially weakened
- first target hit
- invalidation risk materially increased
- path to next barrier materially improved or worsened
- key level was reclaimed, lost, or cleanly accepted
- follow-through changed from working to stalled, or stalled to failed

Examples of non-meaningful change:
- same setup family, same side, same broad state, small additional movement
- another low-value "still forming" or "still constructive" comment
- recap that says almost the same thing as the last continuity or live-state update
- repeated thread narration without a sharper trader implication

---

## Main Recommendation

### Optional posts should fire only on decision-change, not observation-change

This is the most important recommendation.

The system is now strong enough to observe many things.
That does not mean every observation deserves a live post.

Codex should tighten the runtime so optional live posts only fire when they change one of these trader-relevant dimensions:
- entry quality
- hold quality
- trim or exit pressure
- invalidation risk
- target clarity
- path quality to the next meaningful barrier

If none of those changed enough, the post should stay out of the live thread.

---

## Recommended Live Thread Post Model

The thread should have a small number of live post classes.

### Trader-critical live posts
These should be allowed to remain the main voice of the thread:
- important setup alert
- major structure or setup-state change
- final follow-through / outcome post
- level snapshot or extension when it materially updates the map

### Trader-helpful optional posts
These should be tightly gated:
- continuity update
- live follow-through state update
- recap post

### Operator-only information
These should mostly live in artifacts, not the Discord thread:
- rich review commentary
- extra diagnostics
- detailed suppression context
- clutter analysis
- borderline interpretation restatements

---

## Practical Posting Rules To Implement

## 1. Add a same-story fingerprint for optional posts

Every optional live post should be compared against the last optional post for that symbol and story.

Suggested fingerprint inputs:
- symbol
- event family
- side
- setup state
- follow-through state
- key level or zone anchor
- nearest barrier state
- rounded timestamp bucket

If the fingerprint is effectively unchanged, do not post.

Goal:
Prevent the thread from restating the same story with slightly different wording.

---

## 2. Require meaningful delta before reposting optional updates

A post should not be allowed just because time passed.
It should require meaningful delta.

Examples of meaningful delta:
- setup state advanced in a real way
- follow-through grade changed materially
- path quality changed from open to limited or limited to tight
- risk-to-invalidation changed enough to matter
- price moved enough that first target or invalidation meaning changes

Examples of insufficient delta:
- tiny continuation of the same move
- repeated watch-only language
- repeated setup-forming narration
- repeated "still needs confirmation" style updates

Goal:
Cut down low-value repeat narration.

---

## 3. Only allow one optional narrator per phase

At any given moment, only one of these should usually be allowed to narrate the symbol thread:
- continuity
- recap
- live follow-through state

If one already posted the current story, suppress the others unless they are clearly more important.

Examples:
- if a strong follow-through update posts, recap should usually not post right after it
- if a critical alert just posted, weaker continuity narration should yield
- if a final outcome post landed, nearby recap and low-value continuity should be suppressed

Goal:
Stop multiple post classes from describing the same moment.

---

## 4. Add a per-thread optional post budget

After a meaningful critical alert, the thread should have only a small optional narration budget until something major changes again.

Suggested idea:
- after a major alert, allow only a small number of optional context posts
- reset that budget only when the setup materially advances, fails, or shifts phase

This is cleaner than relying only on many local cooldowns.

Goal:
Prevent slowly running trades from becoming chatty over time.

---

## 5. Make live follow-through posts outcome-oriented

For a trader in a live trade, the most useful updates are usually not soft narration.
They are clear management-relevant updates.

Examples of strong live updates:
- now holding cleanly
- now stalling
- now failed
- now reclaimed
- now hit first target
- now lost key level

Examples of weaker updates that should be rarer:
- still forming
- still constructive
- still needs confirmation

These softer updates are only worth posting when they represent a true transition and not a restatement.

Goal:
Bias live thread output toward actionable trade management updates.

---

## 6. Add post replacement behavior, not only suppression behavior

Sometimes multiple posts are all technically valid, but all do not need to exist in the thread.

Codex should treat some posts as superseding others.

Examples:
- a final follow-through verdict should replace the need for a nearby recap
- a critical alert should replace weaker same-moment narration
- a stronger state-change post should replace a softer context post in the same short window

Goal:
Keep the thread sharper, not just quieter.

---

## 7. Use trader actionability as the final live-post filter

Before any optional post is sent, ask:

> Would a trader in the position do anything differently because of this post?

If the answer is no, do not post.

This is the simplest and best final filter.

Examples where answer is likely yes:
- invalidation pressure worsened
- continuation improved enough to hold with more confidence
- failure risk rose enough to tighten management
- setup clearly failed
- meaningful target or barrier relationship changed

Examples where answer is likely no:
- same idea restated
- setup is still generally alive but without a sharper implication
- recap repeats existing thread context

Goal:
Make every live thread post earn its place.

---

## What Should Move Out Of Live Discord More Often

These types of content should lean more heavily into review artifacts instead of live thread posting unless they are unusually valuable:
- generic setup-forming narration
- low-signal recap wording
- repeat watch-only commentary
- duplicate continuity updates that do not sharpen risk or opportunity
- most rich explanatory detail that helps operator review more than trader action

The project already has strong review artifacts.
That should be used more aggressively to protect live thread clarity.

---

## Suggested Codex Deliverables For The Next Pass

### 1. Decision-change policy for optional posts
Create explicit policy logic that decides whether the trader's decision context changed enough to justify a post.

### 2. Same-story fingerprinting for optional posts
Block reposts when the new optional post is effectively the same story as the previous one.

### 3. Per-thread optional post budget
Add a simple budgeting rule so a running trade cannot keep consuming optional narration slots endlessly.

### 4. Optional narrator ownership
Make continuity, recap, and live follow-through state compete more clearly so only one usually wins for a given moment.

### 5. Post replacement logic
Let stronger posts remove the need for weaker nearby narration.

### 6. Artifact visibility
Surface, in session artifacts:
- optional posts attempted
- optional posts allowed
- optional posts blocked
- blocked by same-story rule
- blocked by insufficient delta
- blocked by budget
- blocked by critical-post ownership
- blocked by duplicate or replacement logic

This is needed so thread cleanup can be tuned with evidence.

---

## Questions Codex Should Answer While Implementing

1. Which optional post classes are actually helping active traders?
2. Which optional post classes mostly restate the same trade story?
3. Which event families deserve more live continuity, and which should mostly stay quiet unless there is a sharper shift?
4. Is the thread telling the trader something new, or only telling the system's latest observation?
5. Are recap posts genuinely improving trade management, or mostly summarizing what was already obvious from the last few posts?

---

## Final Recommendation

The thread should become more selective, not just more throttled.

The goal is not only to reduce post count.
The goal is to make the remaining posts more trader-useful.

Best guiding rule:

> optional posts should fire only when the trader's management context changed, not when the model has another observation.

If Codex implements that rule well, the thread will become much more useful for active trades and much less repetitive during running setups.
