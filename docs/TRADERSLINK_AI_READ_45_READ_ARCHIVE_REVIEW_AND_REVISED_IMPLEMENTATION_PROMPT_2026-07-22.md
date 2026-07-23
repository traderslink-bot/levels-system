# TradersLink AI Read — 45-Read Archive Review and Revised Implementation Prompt

**Date:** 2026-07-22  
**Repository:** `traderslink-bot/levels-system`  
**Archive source branch:** `codex/ai-read-archive-20260722`  
**Planning branch:** `agent/ai-read-complete-wide-plan-20260722`  
**Change type:** Documentation and implementation instructions only  
**Deployment:** Prohibited without explicit owner authorization

## Status of this document

This document is an evidence-backed addendum to:

`docs/TRADERSLINK_AI_READ_COMPLETE_WIDE_DAY_TRADE_PLAN_IMPLEMENTATION_PROMPT_2026-07-22.md`

Codex must read this archive review before implementing the earlier plan. Where this document refines the forward-target schema, compressed-plan validation, fresh-high behavior, regression strategy, or refresh behavior, this document controls.

## Owner objective

The first accepted TradersLink AI Read must provide one complete, wide day-trade preparation plan.

The plan must:

- Keep the nearest realistic outcome as the primary tactical focus.
- Also cover conditional continued, strong, and extreme momentum possibilities.
- Remain useful if a small- or micro-cap stock continues 50%, 100%, or farther.
- Avoid unnecessary AI refreshes when an inner outcome is reached.
- Never present a conditional outer scenario as a prediction or certainty.
- Never receive a hard-coded target ladder or example prices in the production prompt.
- Never restore the removed support/resistance ladder.
- Derive exact prices independently from the supplied raw price action, recent history, volatility, and price scale.

A second AI request remains acceptable after the complete first plan's outer boundary is confirmed crossed or when the trading regime materially changes. It should not be needed merely because the first read stopped after the nearest target.

---

# 1. Archive reviewed

The following files were reviewed from `codex/ai-read-archive-20260722`:

- `data/traderslink-ai-reads/README.md`
- `data/traderslink-ai-reads/archive.json`

The archive contains 45 saved historical AI Read snapshots across 45 ticker symbols.

## Archive limitation

This is a point-in-time export, not a complete version history.

It contains one surviving archived record per ticker. It does not contain every earlier read that may have been replaced or expired. Therefore:

- The archive can prove that model behavior is inconsistent across comparable small-cap situations.
- It can identify examples of complete, compressed, empty, or tactically imbalanced maps.
- It cannot by itself compare the first and later AI Reads for the same ticker.
- It cannot replace the recovered request/response audit fixtures for PN at `$7.78`, KSCP at `$1.805`, ZCMD at `$3.02`, or other overwritten first reads.
- It contains the later PN read at `$8.645`, the later KSCP read at `$2.005`, and a much later ZCMD read at `$10.77`.

Keep the earlier recovered packet fixtures in the regression suite. Do not replace them with the surviving archive snapshots.

---

# 2. Quantitative archive results

For this review, forward coverage is:

`(outer upside target - generation reference price) / generation reference price * 100`

This percentage is a diagnostic description of the saved response. It is not a target-generation formula and must not become a hard minimum or maximum.

## Distribution across all 45 saved reads

- **2 reads returned no upside targets:** SKYQ and PAPL.
- **5 reads ended less than 20% above the reference price:** KUST, DFNS, GREE, PN, and KSCP.
- **5 reads ended from 20% to less than 30% above the reference price.**
- **17 reads ended from 30% to less than 50% above the reference price.**
- **10 reads ended from 50% to less than 100% above the reference price.**
- **6 reads reached at least 100% above the reference price.**
- Among the 43 reads with at least one target, median outer coverage was approximately **43%**.

These results establish two important facts:

1. The current model and raw packet are capable of producing very wide maps.
2. The same system is inconsistent when price is at or near fresh high territory and farther outcomes require independent scenario construction rather than selection of obvious historical highs.

The defect is not a universal inability to generate wide coverage. It is failure to require a complete forward-horizon review consistently.

---

# 3. Strong examples showing the model can produce wide plans

## BIYA — 2026-07-20T18:17:08.515Z

- Reference price: approximately `$2.95`
- Targets: `$4.14`, `$4.79`, `$5.58`, `$6.90`
- Outer coverage: approximately `134%`
- Basis: prior regular-session, after-hours, and daily structure

The model mapped several separate recovery and continuation outcomes rather than stopping at the first nearby reclaim.

## NXXT — 2026-07-20T13:48:51.677Z

- Reference price: approximately `$0.268`
- Targets: `$0.36`, `$0.43`, `$0.537`
- Outer coverage: approximately `100%`
- Basis: after-hours rebound structure and a recent daily high

## VIVK — 2026-07-21T13:50:43.618Z

- Reference price: approximately `$7.24`
- Breakout continuation: `$9.00`
- Targets: `$9.18`, `$10.17`, `$14.00`
- Outer coverage: approximately `93%`
- Basis: multiple observed daily highs

## ZYBT — 2026-07-21T16:04:12.732Z

- Reference price: approximately `$2.585`
- Targets: `$4.40`, `$4.70`, `$6.15`, `$6.72`
- Outer coverage: approximately `160%`
- Basis: current regular-session, premarket, and prior-session structure

## OMH — 2026-07-22T07:25:08.046Z

- Reference price: approximately `$0.5226`
- Targets: `$0.67`, `$0.85`, `$1.09`, `$1.21`
- Outer coverage: approximately `132%`
- Basis: observed current and prior regular-session pivots and the authoritative session high
- Also contained shallow pullback, deep pullback, failure recovery, dilution, and listing branches

## CPHI — 2026-07-22T07:48:21.952Z

- Reference price: approximately `$8.86`
- Targets: `$11.55`, `$13.34`, `$16.48`, `$19.19`
- Outer coverage: approximately `117%`
- Basis: same-session observed expansion checkpoints and the authoritative high

## MTEN — 2026-07-22T15:38:17.584Z

- Reference price: approximately `$1.023`
- Targets: `$1.50`, `$1.70`, `$1.95`, `$2.25`
- Outer coverage: approximately `120%`
- Basis: failed-spike recovery structure, session high, and prior daily range

### Conclusion from the wide examples

The model already understands that a complete small-cap map may extend 100% or farther. No arbitrary percentage ceiling is needed, and no deterministic target ladder should be restored.

Wide responses usually occur when obvious historical or same-session observed prices are available. The implementation must preserve this behavior while improving fresh-high price discovery.

---

# 4. Compressed and empty examples

## SKYQ — 2026-07-20T19:37:04.810Z

- Reference price: approximately `$5.05`
- Must clear: `$5.05`
- Breakout continuation: `null`
- Targets: empty
- Current Read described the stock as pressing the session high after a large expansion.

The response treated the absence of an already-established higher pivot as permission to provide no forward map.

## PAPL — 2026-07-20T21:41:45.045Z

- Reference price: approximately `$1.2797`
- Must clear: `$1.33`
- Breakout continuation: `null`
- Targets: empty
- The stock had made a sharp postmarket expansion from roughly `$0.90`.

Again, fresh-high uncertainty caused the entire forward branch to disappear.

## KUST — 2026-07-22T13:59:14.087Z

- Reference price: approximately `$1.7201`
- Must clear: `$1.73`
- Breakout continuation: `$1.80`
- Only target: `$1.89`
- Outer coverage: approximately `9.9%`
- Risk summary explicitly described a `56.34%` one-minute impulse from `$1.10` to `$1.72`.

This is a direct example of a structurally valid but tactically inadequate map. The model recognized an extreme expansion regime but did not carry that information into the forward branch.

## DFNS — 2026-07-21T15:28:36.035Z

- Reference price: approximately `$8.01`
- Breakout continuation: `$8.13`
- Targets: `$8.50`, `$9.00`
- Outer coverage: approximately `12.4%`
- Risk summary described the move as highly extended relative to the `$4.26` prior close.

The model used psychological extensions but stopped after two nearby prices despite the extreme regime.

## GREE — 2026-07-21T16:25:16.927Z

- Reference price: approximately `$3.02`
- Breakout continuation: `$3.10`
- Targets: `$3.30`, `$3.50`
- Outer coverage: approximately `15.9%`
- The move had already advanced sharply from the `$2.13` prior close.

## KSCP — 2026-07-22T14:35:19.335Z

- Reference price: approximately `$2.005`
- Targets: `$2.17`, `$2.38`
- Outer coverage: approximately `18.7%`
- This later read correctly included the supplied `$2.38` older daily high.
- The prior initial `$1.805` read is not in this archive and must remain a separate recovered-packet fixture.

## PN — 2026-07-22T19:07:13.477Z

- Reference price: approximately `$8.645`
- Breakout continuation: `$8.80`
- Targets: `$9.00`, `$10.00`
- Outer coverage: approximately `15.7%`
- Current Read and risk summary described a `119.38%` same-session advance.

The later PN read is better than the original `$7.78` read, but it still demonstrates the mismatch between extreme realized expansion and a relatively short uncharted-territory map.

### Conclusion from compressed examples

The problem is not simply target count.

- KUST returned one target.
- DFNS, GREE, and PN returned two targets.
- SKYQ and PAPL returned none.

A fixed requirement to return four prices could cause the model to manufacture a mechanical staircase. The correct requirement is to make separate forward-horizon decisions and justify the chosen representative prices.

---

# 5. Projected prices are already used, but inconsistently

The archive shows that the model already uses psychological or projected extension prices when observed overhead structure is absent.

Examples include:

- HIHO at 2026-07-20T20:31:56.089Z: `$1.75` and `$2.00`
- ADVB at 2026-07-20T22:43:26.494Z: `$15.50` and `$18.00`
- SLGB at 2026-07-21T09:13:00.411Z: `$2.00` and `$2.20`
- DFNS at 2026-07-21T15:28:36.035Z: `$8.50` and `$9.00`
- GREE at 2026-07-21T16:25:16.927Z: `$3.30` and `$3.50`
- ZCMD at 2026-07-22T15:30:15.292Z: `$13.50` and `$15.00`
- PN at 2026-07-22T19:07:13.477Z: `$9.00` and `$10.00`

The model is therefore not categorically refusing projected outcomes. It applies them inconsistently and often stops too early.

The revised contract must make projected scenario construction an explicit, audited responsibility whenever observed overhead history is absent or insufficient.

---

# 6. Version-3 branch quality does not guarantee complete forward coverage

Several version-3 responses contained detailed and plausible:

- shallow pullback plans;
- deep pullback plans;
- failure-recovery sequences;
- downside checkpoints;
- catalyst, dilution, and listing analysis;

while still providing compressed upside coverage.

KUST is the clearest example: it supplied shallow, deep, and recovery branches while ending the forward plan at only `$1.89` from a `$1.7201` reference.

LABT at 2026-07-22T13:16:11.675Z also supplied detailed pullback and recovery branches but returned only one target above breakout continuation.

Each major branch must be validated independently. A complete pullback or downside map cannot compensate for an incomplete upside map, and vice versa.

---

# 7. Revised forward-plan architecture

## Do not send suggested prices

The production developer prompt and market packet must not include example sequences such as:

- `$8.00`, `$8.50`, `$9.00`, `$9.50`, `$10.00`
- fixed 10%, 25%, 50%, or 100% target prices
- a precomputed whole- and half-dollar ladder
- the removed support/resistance ladder

Expected fixture prices belong only in tests and audit documents.

## Replace target-count thinking with horizon decisions

Do not merely require “four targets.”

Require the model to complete four distinct forward-horizon decisions:

1. **Nearest realistic outcome**
   - The most actionable outcome after breakout confirmation.
   - Prefer observed current-session, prior-session, or recent-daily structure.

2. **Continued momentum outcome**
   - What becomes possible after the nearest outcome is accepted.
   - May be observed structure or a derived scenario.

3. **Strong expansion outcome**
   - A materially farther conditional scenario if momentum persists.
   - Must be distinct from the first two horizons.

4. **Extreme momentum outcome**
   - The outer “what if this micro-cap move becomes exceptional?” scenario.
   - Must be considered even when no historical resistance exists above price.
   - It is conditional and not a forecast.

A horizon may be unavailable only with a structured, evidence-based reason. “No observed resistance above the current high” is not a valid reason to omit strong or extreme scenario analysis; that is precisely when projected price discovery is required.

## Suggested schema shape

```json
{
  "forwardPlan": {
    "nearestRealistic": {
      "available": true,
      "price": 0,
      "condition": "string",
      "basisType": "observed_intraday",
      "basisSummary": "string",
      "sourceFacts": ["string"]
    },
    "continuedMomentum": {
      "available": true,
      "price": 0,
      "condition": "string",
      "basisType": "observed_daily",
      "basisSummary": "string",
      "sourceFacts": ["string"]
    },
    "strongExpansion": {
      "available": true,
      "price": 0,
      "condition": "string",
      "basisType": "combined",
      "basisSummary": "string",
      "sourceFacts": ["string"]
    },
    "extremeMomentum": {
      "available": true,
      "price": 0,
      "condition": "string",
      "basisType": "volatility_projection",
      "basisSummary": "string",
      "sourceFacts": ["string"]
    },
    "additionalObservedOutcomes": []
  }
}
```

Exact property names may be adapted to existing types, but the separate horizon decisions must remain explicit.

## Basis types

At minimum support:

- `observed_intraday`
- `observed_prior_session`
- `observed_daily`
- `failed_spike`
- `psychological_boundary`
- `measured_move`
- `volatility_projection`
- `combined`

The model must not label a projected scenario as observed resistance.

## Representative outcomes, not a level ladder

The model should select a small number of representative milestones spanning the plausible forward path. It should not enumerate every nearby support/resistance level.

A good read may contain four primary horizon outcomes and a limited number of additional material observed outcomes. It should not contain a dense staircase merely to increase count.

---

# 8. Price-free deterministic market-regime profile

Add compact deterministic measurements to the packet. These measurements must not include proposed target prices.

Include when available:

- `gainFromPriorClosePct`
- `gainFromRegularSessionOpenPct`
- `gainFromCurrentSessionLowPct`
- `currentSessionRangePct`
- `latestSignificantImpulsePct`
- `broaderSessionMovePct`
- `averageDailyRange10Pct`
- `averageDailyRange20Pct`
- `largestDailyRange20Pct`
- `currentRangeVsAverageDailyRange`
- `currentPriceLocationInSessionRangePct`
- `currentPriceAtOrNearSessionHigh`
- `currentPriceAboveHighestSuppliedDailyHigh`
- `highestObservedUpsidePrice`
- `highestObservedUpsidePriceType`
- `distanceToHighestObservedUpsidePct`
- regime classification such as `normal`, `elevated`, `high_expansion`, or `extreme_expansion`

`highestObservedUpsidePrice` is a market fact, not a target recommendation. Do not send a list of all candidate levels.

The regime profile should help the model recognize that a 10% forward map may be inadequate after a 56%, 90%, or 119% realized move, without telling it which exact outer price to select.

---

# 9. Fresh-high and uncharted-price discovery mode

Activate a dedicated instruction path when:

- current price is at or near the highest supplied current-session price;
- no meaningful observed overhead price remains;
- the outer observed price is too close to provide a complete day-trade map; or
- price has moved beyond the prior plan's outer boundary.

In this mode, instruct the model to:

1. Reinspect the complete current-session and recent-daily tape.
2. Separate observed levels from projected possibilities.
3. Derive representative strong and extreme scenarios independently.
4. Consider the realized impulse, broader-session range, average daily range, recent range expansion, current price scale, and psychologically meaningful boundaries.
5. Avoid a repetitive whole-/half-dollar staircase.
6. Explain the basis facts used for each projected scenario.
7. Keep the nearest realistic outcome primary and label farther outcomes as increasingly conditional.
8. Do not stop merely because historical resistance is absent.

The runtime must not calculate or supply the projected prices.

---

# 10. Revised completeness validation

## Hard structural validation

Reject when:

- no forward horizon is returned;
- SKYQ/PAPL-style empty targets are returned while a current or fresh-high breakout scenario exists;
- must-clear, breakout continuation, and nearest outcome duplicate one another without a distinct tactical role;
- a projected price is falsely labelled as observed structure;
- strong or extreme horizons are silently omitted;
- an unavailable horizon lacks a precise reason code and explanation;
- duplicate pruning removes a horizon and completeness is not revalidated;
- one complete branch is used to excuse an incomplete branch elsewhere.

## Compressed-plan challenge

Calculate output diagnostics after normalization:

- `forwardCoveragePct`
- `realizedExpansionPct`
- `coverageToRealizedExpansionRatio`
- `outerDistanceInAverageDailyRanges`
- number of represented horizons
- whether the outer outcome is observed or projected

Use these values as a suspicion signal, not as a mechanical target rule.

A plan should receive `FORWARD_MAP_SUSPICIOUSLY_COMPRESSED` when all applicable evidence indicates an extreme regime but the map ends after only a small extension and the model has not provided a concrete reason.

Do not create a universal requirement such as “outer target must be 50% away.”

The repair message should state facts such as:

- realized move size;
- current range versus normal range;
- current-price position;
- outer coverage returned;
- missing horizon decisions;
- whether no observed overhead exists;
- whether duplicate pruning removed a scenario.

It must not supply replacement target prices.

## Stronger unavailable-state rules

The following are not sufficient reasons to mark strong or extreme analysis unavailable:

- no observed resistance;
- the price is at a fresh high;
- the outcome seems unlikely;
- the price would be far away;
- two targets were already returned.

Valid unavailable reasons require a real data limitation or contradiction, such as:

- stale or incomplete tactical price data;
- unresolved split adjustment;
- insufficient candle history to establish scale or volatility;
- a material quote conflict that prevents a defensible reference;
- corrupt or contradictory market packet.

---

# 11. One-call initial generation strategy

The owner wants to minimize additional API requests.

Use one initial model request with high reasoning effort and require an internal multi-pass review before final JSON:

1. Analyze current tactical structure.
2. Build the nearest realistic path.
3. Review prior-session and daily history for observed farther outcomes.
4. If observed coverage is incomplete, perform fresh-high/uncharted scenario construction.
5. Build downside, pullback, failure, and recovery branches.
6. Reinspect beyond the proposed outer upside and deepest downside outcomes.
7. Verify all four forward horizons.
8. Return only the final structured response.

Do not expose private reasoning. Require only concise basis summaries and source facts in the JSON.

A single focused correction request is acceptable when deterministic validation rejects the initial response. The goal is to make that correction rare and to avoid later full refreshes caused solely by short initial coverage.

---

# 12. Refresh continuity and cost control

The archive includes many reads that mention only a prior crossed boundary. The complete prior AI Read is not preserved in the generation context, which encourages every refresh to rebuild another local map.

During a real refresh, send a compact complete snapshot of the last accepted plan:

- prior reference price and generation time;
- all hold, caution, failure, must-clear, and continuation boundaries;
- all forward horizons and achieved state;
- downside checkpoints;
- shallow and deep pullback plans;
- failure recovery;
- catalyst, dilution, and listing conclusions;
- source references;
- crossed-boundary evidence;
- publication acknowledgement status.

Require the model to:

- preserve valid outer scenarios;
- mark inner scenarios achieved rather than forgetting them;
- explain every removed outer scenario;
- distinguish newly formed structure from previously available structure;
- avoid narrowing the map merely because the reference price moved higher.

## Do not request a new AI Read merely because

- the nearest realistic outcome was touched;
- an inner continuation outcome was achieved;
- the public card needs to advance to the next mapped outcome;
- a target's state changes from approaching to testing or achieved.

Advance those states deterministically.

## Normal refresh triggers

Generate a new AI Read only when one or more apply:

1. Price confirms above the complete plan's outer available upside scenario.
2. Price confirms below momentum failure and exhausts or invalidates the failure/recovery map.
3. A materially new catalyst, filing, dilution, or listing event arrives.
4. A prolonged new consolidation creates a materially different regime.
5. A new session creates materially different structure.
6. A data-source correction invalidates the current plan.

Publication retries must replay the accepted payload and must not call the model again.

---

# 13. Regression and replay requirements

## Archive-based output audit

Create a deterministic script that reads:

`data/traderslink-ai-reads/archive.json`

For each of the 45 saved records, report:

- ticker;
- generation ID;
- generation timestamp;
- reference price;
- must-clear;
- breakout continuation;
- target count;
- outer target;
- outer coverage percentage;
- represented forward horizons;
- observed versus projected basis where inferable;
- downside checkpoint count;
- shallow/deep/recovery presence;
- catalyst, dilution, and listing states;
- validation result under the new contract.

The script must identify at minimum:

- SKYQ and PAPL as missing forward maps;
- KUST, DFNS, GREE, PN, and KSCP as compressed-plan review cases;
- NXXT, BIYA, VIVK, ZYBT, OMH, CPHI, LICN, INLF, and MTEN as examples showing broad coverage is possible;
- version-3 cases where good pullback/recovery branches coexist with weak forward coverage.

Do not claim this archive contains original request packets.

## Recovered-packet replay fixtures

Continue using recovered original packets and responses for:

- PN at `$7.78`
- PN at `$8.645`
- ZCMD at `$3.02`
- the surviving later ZCMD snapshot separately
- KSCP at `$1.805`
- KSCP at `$2.005`
- KUST at `$1.7201`
- OMH variance fixtures
- SNTG
- INM
- SXTC
- ZBAO
- KAPA generation failure
- INLF generation failures
- ADVB refresh failures
- CHAI publication failure

The original first-read fixtures remain necessary because the 45-read point-in-time archive contains later surviving records for several tickers.

## Minimum success criteria

1. SKYQ- and PAPL-style empty forward maps cannot pass merely because price is at a fresh high.
2. KUST cannot pass with a single `$1.89` target unless the model provides a defensible complete horizon analysis under the new contract; under the recovered packet it should be rejected for compressed coverage and omitted daily evidence.
3. PN at `$7.78` must include `$10` at minimum and every additional supported outcome from the original packet.
4. PN at `$8.645` must explicitly evaluate a farther extreme scenario beyond the nearest `$9` and `$10` path; acceptance depends on the packet's support and basis, not a fixed percentage.
5. No production prompt or packet contains expected fixture target prices.
6. No arbitrary maximum percentage removes a valid far scenario.
7. No mechanical percentage target is inserted merely to satisfy breadth.
8. Observed and projected prices are labelled honestly.
9. Duplicate pruning triggers final completeness revalidation.
10. A good pullback or downside branch cannot hide an incomplete forward branch.
11. Inner outcomes advance without a model refresh.
12. The previous complete plan remains visible until a complete replacement is validated, published, and acknowledged.
13. Failed publication replays the accepted payload rather than regenerating it.
14. Focused AI Read tests, publisher/outbox tests, type checks, and builds pass.

---

# 14. Codex implementation prompt

Act as the implementation engineer for the TradersLink AI Read complete-wide-plan correction.

Repository:

`traderslink-bot/levels-system`

Read first:

1. `docs/TRADERSLINK_AI_READ_45_READ_ARCHIVE_REVIEW_AND_REVISED_IMPLEMENTATION_PROMPT_2026-07-22.md`
2. `docs/TRADERSLINK_AI_READ_COMPLETE_WIDE_DAY_TRADE_PLAN_IMPLEMENTATION_PROMPT_2026-07-22.md`
3. `data/traderslink-ai-reads/README.md` from branch `codex/ai-read-archive-20260722`
4. `data/traderslink-ai-reads/archive.json` from branch `codex/ai-read-archive-20260722`
5. Existing July 22 coverage audit and recovered-packet tooling.

Do not deploy. Do not restart production or local runtime services. Preserve unrelated user changes and dirty worktrees.

## Objective

Correct the first accepted AI Read so it provides a complete, wide small-cap day-trading plan in one generation whenever the supplied data permits.

Keep the nearest realistic outcome primary while also mapping conditional continued, strong, and extreme momentum possibilities. Minimize refreshes by advancing inner outcomes deterministically and requesting another model read only when the outer plan is crossed or the regime materially changes.

## Critical prohibitions

- Do not restore or send the old detected support/resistance ladder.
- Do not send a hard-coded whole-/half-dollar ladder.
- Do not send expected fixture prices to the model.
- Do not impose a maximum upside or downside percentage.
- Do not add mechanical percentage targets.
- Do not accept an empty forward map merely because price is at a fresh high.
- Do not deploy without explicit authorization.

## Required implementation direction

1. Add the price-free deterministic market-regime profile described in this document.
2. Replace generic target-count behavior with explicit nearest, continued, strong, and extreme horizon decisions.
3. Distinguish observed price structure from projected conditional scenarios in the schema and public presentation.
4. Add fresh-high/uncharted-price discovery instructions without supplying exact prices.
5. Add independent branch-completeness validation.
6. Add compressed-plan diagnostics that challenge narrow maps without calculating targets for the model.
7. Revalidate the final map after normalization and duplicate pruning.
8. Improve repair requests so all failures are supplied together without replacement prices.
9. Send the compact complete prior plan during refreshes.
10. Advance inner scenario states deterministically.
11. Preserve the last complete acknowledged plan until a complete replacement is acknowledged.
12. Replay publication failures without regenerating.
13. Add the archive-audit script and recovered-packet regression tests.
14. Verify renderer parity in the canonical website repository without deploying.

## Required report after implementation

Provide:

1. Evidence-backed diagnosis.
2. Exact files changed and why.
3. Prompt and schema changes.
4. Market-regime measurements added.
5. Validator and repair behavior.
6. Refresh and publication lifecycle changes.
7. Regression results for the 45 archive snapshots.
8. Recovered-packet replay results.
9. Rendered-card verification.
10. Remaining risks and any fixtures that still require manual trading review.

Keep the work scoped. Do not merge or deploy without explicit owner authorization.

---

# 15. Owner clarification: volatile micro/nano-cap day-trading contract

The complete-wide correction must preserve the meaningful tactical analysis that v3 produced when it followed its instructions. This is a reliability and coverage correction, not a replacement with a generic target generator.

1. The product is for day trading volatile micro-cap and nano-cap stocks, including quick movers that may sustain, break out, reject, reverse, or fully unwind.
2. One-minute and five-minute candles are primary for measuring short-time extension, acceptance, rejection, pullback structure, reversal risk, and momentum failure.
3. Daily candles remain essential day-trade evidence for former highs, failed spikes, overhead supply, volatility context, larger reset areas, and outer continuation scenarios.
4. Premarket high, regular-session HOD, prior HOD, prior close, and prior after-hours highs are role-dependent tactical references. A premarket high may be resistance below it and a hold/retest reference after regular-hours acceptance above it.
5. Complete-wide must improve the consistency of forward, pullback, and reversal coverage without inventing structures or replacing the grounded v3 read.
6. If supplied one-minute/five-minute candidate evidence supports a pullback or failure-recovery assessment, a medium/high-confidence read must not silently leave every such branch empty.
