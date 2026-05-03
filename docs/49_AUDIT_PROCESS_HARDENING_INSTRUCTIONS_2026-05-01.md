# Audit Process Hardening Instructions

Date: 2026-05-01
Repo: `traderslink-bot/levels-system`
Branch: `codex/runtime-compare-tooling`

## Purpose

This document is a direct implementation handoff for Codex.

The current trading-day audit process is already broader and stronger than a typical post-run review, but it is still too easy to produce an audit that is polished, summary-heavy, and not evidentiary enough.

The goal of this pass is to make the audit process:
- harder to do shallowly
- more evidence-driven
- more consistent across trading days
- more useful for judging trader-facing Discord quality
- more useful for judging actual support/resistance quality from candle data
- stricter about critical delivery failures and production risk

This is **not** a request to add more narrative to the audit.
It is a request to improve the process so the most important conclusions are backed by enough proof.

---

## Core Problem To Solve

Right now the repo has:
- a strong audit playbook
- good report generation
- good replay/report artifacts
- useful tests around post policy, trader language, and level-quality gaps

But the final audit can still be too summary-oriented.

Examples of current weaknesses:
- a report can say a ladder is `healthy` without enough inline proof
- role-flip behavior can be mentioned without being shown clearly
- cluster-cross noise can be identified without enough exact post/level evidence
- a trader-critical Discord send failure can be noted without being escalated strongly enough
- wording problems can be described as historical without enough proof that current live runtime is clean now

This pass should make those weak spots harder to gloss over.

---

## Scope For This Pass

Read first:
- `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`
- `docs/47_COMPLETE_TRADING_DAY_AUDIT_2026-04-29.md`
- `docs/46_TRADING_DAY_AUDIT_ADDENDUM_2026-04-29.md`
- `docs/39_TRADER_LANGUAGE_BOUNDARY_AND_DISCORD_RULES_2026-04-29.md`
- `docs/40_FINAL_DISCORD_WORDING_CLEANUP_2026-04-29.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`

Review implementation files:
- `src/scripts/generate-discord-audit-reports.ts`
- `src/lib/review/discord-audit-reports.ts`
- `src/lib/review/live-post-replay-simulator.ts`
- `src/lib/review/long-run-tuning-suggestions.ts`
- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/trader-message-language.ts`
- `src/lib/ai/trader-commentary-service.ts`

Review tests:
- `src/tests/live-thread-post-policy.test.ts`
- `src/tests/trader-facing-replay-language.test.ts`
- `src/tests/trader-commentary-service.test.ts`
- `src/tests/level-quality-audit.test.ts`

If there are other audit/report/test files that are directly relevant, include them too.

---

## Product Rules To Preserve

Do not break these:

- The system is for long-biased traders only.
- Discord-visible posts must not contain direct buy/sell instructions.
- Hints and context are allowed; direct instructions are not.
- No short-trade framing.
- Discord-visible posts should be trader-view only.
- Operator/debug/test language belongs in logs, artifacts, docs, and diagnostics, not in Discord.
- The audit must not force support/resistance levels that are not supported by candle data.
- Reducing post noise must not hide real support/resistance levels.

---

## Required Improvements

## 1. Tighten the audit playbook itself

Update `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md` so the audit is more consistent and harder to do shallowly.

### 1A. Add a severity rubric

Define and use these levels:
- `blocker`
- `major`
- `watch`
- `historical_only`
- `data_quality_only`

Define what each means.

Suggested meaning:
- `blocker`: trader-facing production risk, should be fixed before broader rollout
- `major`: repeated or meaningful problem that should be addressed soon
- `watch`: real but not yet proven urgent, or ambiguous enough that more evidence is needed
- `historical_only`: found in saved historical output, not found in current runtime/source
- `data_quality_only`: likely provider/data issue, not enough evidence to call it engine logic

Require the final audit to classify major findings with this rubric.

### 1B. Add mandatory evidence blocks for top symbols

For the top 3 to 5 highest-risk or highest-activity symbols, require the final audit to include a structured evidence block with:
- symbol
- why it was selected
- exact saved Discord post excerpts
- exact forward support/resistance ladder from replay audit
- exact candle-backed explanation for any claimed missing/misleading level
- exact reason a missed-event candidate was acceptable suppression vs real bug

The point is to force stronger proof on the most important symbols, not on every symbol equally.

### 1C. Add explicit role-flip audit requirements

Require at least:
- one broken-support case reviewed for nearby resistance treatment
- one reclaim case reviewed for nearby support treatment
- one fast reclaim / false-clear case reviewed for certainty wording

For each, the final audit should say:
- what price did
- what nearby levels mattered
- what Discord said
- whether the long-biased trader story was accurate

### 1D. Add explicit cluster-cross audit requirements

Require a dedicated section for fast moves through tight nearby levels.

For at least one important symbol, require:
- the nearby level cluster
- the actual saved post sequence
- whether the sequence over-explained the move
- whether one cluster-cross narrative would be better than multiple single-level posts

### 1E. Strengthen critical delivery-failure handling

Add a rule that any failed trader-critical `post_alert` must be treated as at least a `major` issue unless the audit proves:
- retry happened, or
- equivalent trader-critical recovery behavior happened, or
- the failure was surfaced clearly enough for the operator to act immediately

### 1F. Require explicit historical-vs-current language separation

The final audit must clearly separate:
- wording found in saved historical Discord posts
- wording still present in current source / runtime formatters

Do not allow a vague statement like "current source should already fix this" without at least one proof point.

---

## 2. Strengthen generated reports and scripts

The reports need to produce more proof, not just more summaries.

### 2A. Add a critical delivery-failure report

Add a dedicated report or report section that shows:
- all failed `post_alert` rows
- whether each was trader-critical
- whether retry happened
- whether a later equivalent post still reached Discord
- suggested severity

Output both JSON and Markdown if possible.

### 2B. Add a role-flip report

Add a report that summarizes cases where:
- broken support should now behave as resistance
- reclaimed resistance should now behave as support
- trader-facing posts did or did not explain that correctly

### 2C. Add a cluster-cross report

Add a report that identifies:
- fast runner sequences crossing multiple nearby levels
- how many posts were produced
- whether the move likely needed one calmer cluster-cross story instead of several single-level messages
- which symbols are strongest candidates for future cluster-cross handling work

### 2D. Add a trader-language evidence appendix

Add a generated appendix or report section that pulls actual saved Discord post bodies into categories such as:
- good trader-facing language
- old system-shaped language
- borderline advisory language
- repetitive same-story language

This will make language audits far more evidence-driven.

### 2E. Strengthen healthy-ladder output

Where the report currently labels a ladder `healthy`, include enough supporting evidence to explain why.

Examples of useful supporting fields:
- nearest support / resistance
- forward ladder levels
- wide-gap status
- thin-ladder status
- extension-only status
- data quality flags

The report does not need to become huge, but it should be more evidentiary.

---

## 3. Strengthen tests

Add or improve tests so the audit process itself becomes more trustworthy.

### 3A. Audit-report completeness tests

Add tests that verify generated audit outputs include the new important sections when the data supports them:
- critical delivery failures
- role-flip candidates
- cluster-cross candidates
- representative saved post samples
- explicit severity labels where expected

### 3B. Role-flip wording tests

Add or extend tests so trader-facing wording is checked for:
- broken support now acting as resistance
- reclaimed resistance now acting as support
- long-only framing
- non-advisory phrasing

### 3C. Cluster-cross tests

Add tests that verify:
- nearby fast-crossed levels are grouped as cluster-cross candidates
- the audit/report does not overcount trivial nearby crosses as independent major events
- the reporting helps identify thread overposting risk in runner symbols

### 3D. Level-audit edge-case tests

Strengthen `src/tests/level-quality-audit.test.ts` with more edge cases for:
- role-flip-sensitive ladders
- tight clusters that should act like one zone
- healthy-but-thin ladders where extra levels should not be invented
- false "no resistance" or "no support" states caused by ranking

### 3E. Replay-language tests

Strengthen `src/tests/trader-facing-replay-language.test.ts` so it catches:
- too-certain clear/lost phrasing
- overly predictive "next level" language
- lingering system/operator language in replay text
- cluster-cross wording that sounds too noisy or fragmented

### 3F. Critical delivery-failure tests

Add tests for the audit layer around failed trader-critical sends so the report behavior is explicit and stable.

---

## 4. Improve final audit output expectations

Update the process so the final audit is not just descriptive.
It should make stronger, better-supported decisions.

### Required final audit structure

The final audit should include:
1. scope and inputs
2. severity-ranked top findings
3. top-symbol evidence blocks
4. trader-language findings
5. runtime / delivery findings
6. level-quality findings
7. role-flip findings
8. cluster-cross findings
9. data-quality/provider limitations
10. action items
11. exact verification commands used

### Required final audit honesty

The final audit must explicitly say when something was:
- proven by saved Discord evidence
- proven by replay level audit
- proven by current source/tests
- ambiguous because of provider limitations

This is important.
The audit should not imply that generated reports automatically equal deep manual review.

---

## 5. Update docs after implementation

After code/report/test changes, update:
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- `README.md`

Document:
- new audit severity model
- new generated audit reports
- new required evidence blocks
- stronger handling of critical delivery failures
- any new commands/scripts

---

## Constraints

- Do not add fake levels just to make ladders look fuller.
- Do not make the audit more verbose unless it is more evidentiary.
- Do not weaken trader-language boundaries.
- Do not weaken anti-advice rules.
- Keep the audit practical enough to run after a real trading day.

---

## Expected Deliverables

By the end of this pass, I expect:

1. a stronger `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`
2. one or more stronger generated audit report outputs
3. stronger tests around audit/report quality and evidence quality
4. updated docs
5. a concise implementation summary that tells me:
   - what audit weaknesses were fixed
   - what new reports or report sections now exist
   - what new tests were added
   - what still remains a limitation

---

## Acceptance Standard

This pass is successful only if:

- the audit process is stricter about proof for the most important symbols
- role flips and cluster crosses are now explicitly audited instead of only implied
- critical Discord delivery failures are treated more seriously in the audit output
- the reports make it easier to prove conclusions instead of just summarizing them
- tests make it harder for future audit-process regressions to slip through

---

## Final Reminder

The current audit process is already good.
This pass is about making it more trustworthy and harder to do shallowly.

The guiding principle for this work is:

> A complete trading-day audit should not only sound careful. It should visibly prove its most important conclusions.
