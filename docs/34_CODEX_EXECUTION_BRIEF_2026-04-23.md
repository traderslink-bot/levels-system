# Codex Execution Brief

Date: 2026-04-23
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Mission

Do a **tightening pass**, not a feature-expansion pass.

The project now has enough runtime instrumentation, session artifacts, review outputs, and trader-facing message layers to begin trimming noise and enforcing discipline.

The next pass should optimize for:

- trader usefulness per unit of thread noise
- better separation between live trader output and operator review output
- fewer low-value repeat posts
- stronger evidence about which post types are helping versus cluttering

Do **not** treat this pass as a license to add more live runtime post categories or more descriptive layers unless they directly support clutter reduction or usefulness measurement.

---

## Main Problem To Solve

The runtime now has many live behaviors:
- setup alerts
- snapshots and extensions
- continuity posts
- follow-through state posts
- completed follow-through posts
- recap posts
- lifecycle events
- audit logging
- long-run session review artifacts
- optional AI recap outputs

The main risk is that the live Discord symbol thread becomes too chatty even if the offline review artifacts are useful.

The core question for this pass is:

> Which live post categories are improving trader understanding, and which are mostly creating clutter?

---

## What Must Stay Strong

Preserve and keep investing in:
- long-run session artifact generation
- Discord delivery auditing
- session summary generation
- per-symbol thread summaries
- follow-through tracking and evaluation-aware review
- suppression reason tracking
- lifecycle logging
- basic trader-friendly alert wording

These are useful and should remain part of the project.

---

## What Should Be Treated Carefully

Do not expand these aggressively without evidence:
- live symbol recap posts
- continuity post frequency
- follow-through state post frequency
- AI commentary in live runtime behavior
- additional trader-facing wording dimensions that do not clearly improve decisions

---

## Priority Tasks

### Priority 1. Build deterministic thread clutter analysis

Add a deterministic analysis layer for long-run sessions that reports, per symbol thread:
- total post count
- post count by category
- alert-to-context ratio
- recap density
- continuity density
- follow-through density
- symbols most likely suffering from clutter
- symbols where extra context appears to correlate with useful threads

Suggested outputs:
- `thread-clutter-report.json`
- additions to `thread-summaries.json`
- additions to `session-review.md`

Goal:
Make clutter measurable instead of subjective.

### Priority 2. Tighten non-core live post gating

Audit and tighten the posting logic for:
- continuity posts
- recap posts
- follow-through state posts

Requirements:
- fewer repeat restatements
- more meaningful state-change thresholds
- stronger cooldowns where needed
- preference for major lifecycle changes over narration of minor drift

Goal:
Reduce thread chatter without losing important state changes.

### Priority 3. Explicitly classify live versus operator output

Review all current outputs and classify each as one of:
- trader-critical
- trader-helpful but optional
- operator-only

Then use that classification to:
- keep trader-critical output live
- gate trader-helpful optional posts more tightly
- move operator-only richness into artifacts instead of Discord live thread posts

Goal:
Keep live threads clean while preserving rich review data offline.

### Priority 4. Consolidate trader-facing wording

Audit current trader-facing dimensions and reduce overlap.

Likely-core dimensions:
- support/resistance strength
- room
- setup state
- follow-through state
- basic path quality

Candidates for reduction or consolidation unless proven useful:
- overlapping trigger-quality wording
- overlapping failure-risk wording
- recap-only descriptors that do not change trader actionability
- labels that restate the same idea in different words

Goal:
Smaller, clearer live vocabulary.

### Priority 5. Keep AI optional and recap-only

Do not expand AI into:
- signal generation
- signal ranking
- live signal scoring
- replacing deterministic live alert wording by default

AI may continue to support:
- post-run session review
- post-run thread recap enhancement
- optional operator commentary over deterministic artifacts

Goal:
Protect determinism and trust.

---

## Deliverables Expected From This Pass

1. deterministic thread clutter analysis
2. reduced spam risk in continuity, recap, and follow-through live posts
3. explicit live-versus-operator output classification
4. wording consolidation pass
5. updated docs explaining what was tightened and why

---

## Guardrails

1. Do not add new live post categories unless they directly support clutter reduction or usefulness measurement.
2. Prefer artifact richness over live thread verbosity.
3. When in doubt, route more detail to offline review artifacts instead of Discord live output.
4. Keep AI downstream of deterministic facts.
5. Use long-run evidence infrastructure to justify tuning decisions.

---

## Questions To Answer In The Implementation Notes

When this pass is complete, the implementation notes should explicitly answer:

1. Which live post categories are earning their place in the symbol thread?
2. Which live post categories are mostly clutter?
3. What was tightened to reduce repeat low-value posts?
4. Which information was moved toward operator artifacts rather than live thread output?
5. Which wording layers were consolidated or reduced?

---

## Success Condition

This pass is successful if the project ends up with:
- cleaner live trader threads
- no loss of major state awareness
- stronger operator review artifacts
- fewer repeated low-value posts
- tighter language
- clearer evidence about which runtime behaviors are truly helping
