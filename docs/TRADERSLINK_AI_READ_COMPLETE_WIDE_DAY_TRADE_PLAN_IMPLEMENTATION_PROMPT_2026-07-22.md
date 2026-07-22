# TradersLink AI Read: Complete Wide Day-Trade Plan

**Date:** 2026-07-22  
**Repository:** `traderslink-bot/levels-system`  
**Change type:** Planning and implementation instructions only  
**Deployment:** Prohibited without explicit owner authorization

## Purpose

Correct the TradersLink AI Read so the **first accepted read** is a complete day-trading preparation plan rather than a short map of only the next nearby move.

The plan must emphasize the nearest realistic setup while also covering conditional extended and extreme momentum possibilities. Small- and micro-cap stocks can move 100% or more intraday. A complete preparation plan must therefore show traders what may potentially happen if momentum continues much farther than the nearest observed resistance.

The goal is to reduce unnecessary AI refreshes and API expense. Crossing an inner target should normally advance the existing plan, not require a new generation. A second read remains appropriate after the outer boundary is crossed or the market regime materially changes.

## Critical conclusions from the current request packet

1. The current packet already contains substantial market data: raw 1-minute, 5-minute and daily candles; session summaries; 15-minute aggregates; volume landmarks; impulse and consolidation evidence; pullback candidates; VWAP and EMA distances; and catalyst research.
2. The problem is not simply missing candle data. The current prompt and schema allow the model to satisfy the task with a concise, local plan.
3. The production prompt must **not contain example target prices** such as a sequence of whole- and half-dollar prices. Supplying those numbers would anchor the model and encourage it to copy them.
4. The old detected support/resistance ladder must remain excluded. It previously created too many candidates and degraded the model's ability to produce a wide plan.
5. For the first PN read described in the recovered packet, the farthest explicitly documented observed upside level was the recent daily high near `7.98`. The model was not given a prebuilt list containing `8.50`, `9.00`, `9.50`, `10.00`, or higher prices. Any farther prices had to be independently inferred from the move's volatility, range expansion, price scale, psychological boundaries and conditional momentum scenarios.
6. Therefore, farther targets must be labelled honestly. An observed historical level is different from a projected volatility or psychological scenario.

## Non-negotiable product behavior

- The first accepted read must be wide enough to remain useful through a substantial intraday move.
- The closest realistic scenario remains the primary tactical focus.
- Extended and extreme scenarios are conditional possibilities, not predictions.
- No arbitrary maximum percentage may cap the plan.
- No mechanical percentage target may be inserted merely to widen coverage.
- No hard-coded price ladder may be sent to the model.
- A plan may extend 100% or more from the reference price when the supplied regime and price action support an extreme momentum possibility.
- The model must derive exact prices independently.
- The model must identify whether each price is based on observed structure, a psychologically significant boundary, a volatility projection, or a combination.
- Concise wording is desirable. Concise coverage is not.
- The last complete acknowledged plan remains public until a complete replacement is validated, published and acknowledged.

## Root causes to correct

### 1. The prompt rewards minimal coverage

The current developer prompt begins by requesting a “concise” read and later states that returning fewer targets is normal. Those statements are reasonable for prose length and anti-hallucination safety, but together they encourage the model to stop after one or two nearby outcomes.

Replace this framing with:

> Produce a complete branching preparation map. Keep each explanation concise, but never shorten the tactical coverage merely to make the response concise.

### 2. The current target array has no required planning horizons

A generic `targets` array with a maximum of four items does not require the model to distinguish:

- the nearest realistic outcome;
- continued momentum beyond that outcome;
- a stronger expansion scenario;
- an extreme “what if momentum persists?” scenario.

The model can currently return two nearby prices and satisfy the schema.

### 3. Observed and projected prices are not distinguished

The existing target object contains only a label, price and condition. It does not state whether the price came from:

- an observed intraday or daily structure;
- a psychological price boundary;
- a volatility/range projection;
- a combined basis.

This makes it difficult to audit whether the model is using real chart evidence or inventing a price.

### 4. Volatility context is present only indirectly

The packet contains enough candles to reconstruct the regime, but the model must perform that reconstruction while also completing a large strict schema. Add compact deterministic regime measurements that do not include proposed target prices.

### 5. Validation checks ordering but not tactical breadth

A plan can be numerically valid yet useless because its entire forward map ends only a few percent beyond the reference price. Validation must challenge suspiciously compressed plans without calculating the target price for the model.

### 6. Refreshes do not receive the complete previous plan

A refresh currently receives only the crossed boundary. It is effectively a new local analysis at a higher or lower price. This makes later reads inconsistent and causes them to introduce possibilities that should have been preserved from the first plan.

## Required architecture

Use a hybrid architecture, but do **not** restore deterministic target discovery.

1. Deterministic code calculates market-regime and volatility measurements.
2. The AI independently derives tactical prices from raw price action and compact regime context.
3. The schema requires separate planning horizons.
4. Deterministic validation checks breadth, role separation, evidence type and continuity.
5. A repair request challenges omissions without giving the model replacement prices.
6. The full prior complete plan is supplied during refreshes.
7. Inner scenario crossings are handled deterministically when possible.
8. A new AI request occurs only when the outer map is exhausted or the regime materially changes.

## Phase 1: Add a price-free volatility and regime profile

Extend the market packet with a compact object similar to the following. Exact names may be adjusted to existing conventions.

```json
{
  "volatilityProfile": {
    "available": true,
    "dailyHistoryCount": 60,
    "gainFromPriorClosePct": 0,
    "gainFromSessionOpenPct": 0,
    "gainFromSessionLowPct": 0,
    "sessionRangePct": 0,
    "latestSignificantImpulsePct": 0,
    "broaderSessionMovePct": 0,
    "averageDailyRange10Pct": 0,
    "averageDailyRange20Pct": 0,
    "medianDailyRange20Pct": 0,
    "maximumDailyRange30Pct": 0,
    "currentRangeMultipleOfAdr20": 0,
    "currentPriceAboveRecentDailyHigh": false,
    "regime": "normal | elevated | high_expansion | extreme_expansion",
    "limitations": []
  }
}
```

### Rules

- Do not include candidate targets or a generated price ladder.
- Use authoritative adjusted candles consistently.
- Preserve null/unavailable states when volume or history is missing.
- Regime classification should be based on multiple measurements, not a single hard-coded gain threshold.
- Keep raw component values in the packet so the model and audit can see why the regime was classified.
- Treat the classification as context, not as proof that the stock must continue.

### Suggested regime inputs

- Percentage gain from prior regular close.
- Percentage gain from regular-session open.
- Percentage gain from current-session low.
- Current session range percentage.
- Latest detected impulse percentage.
- Broader-session move percentage.
- Ten- and twenty-day average daily range.
- Median recent daily range.
- Maximum recent daily range.
- Current session range divided by recent average daily range.
- Whether price is above the highest high in the supplied daily history.
- Quote freshness and disagreement.

## Phase 2: Expand daily history adaptively

The current 30 daily bars may be insufficient for some small caps.

Implement:

- 60 recent daily bars by default when data is available.
- Up to 120 daily bars when price is above the highest high in the initial window, the regime is `high_expansion` or `extreme_expansion`, or the shorter window has no meaningful overhead history.
- Consistent split adjustment across daily and intraday data.
- Compact serialization to control input tokens.

Do not generate a list of detected daily resistance levels. Send the candles and existing summaries only.

## Phase 3: Replace the generic target array with required scenario horizons

Do not place any sample prices in the production schema descriptions or developer prompt.

Recommended shape:

```json
{
  "upsideScenarios": {
    "nearestRealistic": {
      "status": "available | unavailable",
      "price": "number or null",
      "basisType": "observed_structure | psychological | volatility_projection | combined | unavailable",
      "condition": "string",
      "rationale": "string"
    },
    "continuedMomentum": {
      "status": "available | unavailable",
      "price": "number or null",
      "basisType": "observed_structure | psychological | volatility_projection | combined | unavailable",
      "condition": "string",
      "rationale": "string"
    },
    "strongExpansion": {
      "status": "available | unavailable",
      "price": "number or null",
      "basisType": "observed_structure | psychological | volatility_projection | combined | unavailable",
      "condition": "string",
      "rationale": "string"
    },
    "extremeExpansion": {
      "status": "available | unavailable",
      "price": "number or null",
      "basisType": "observed_structure | psychological | volatility_projection | combined | unavailable",
      "condition": "string",
      "rationale": "string"
    }
  }
}
```

### Meaning of the horizons

- `nearestRealistic`: The closest meaningful outcome after breakout confirmation. It should be the most immediately actionable and realistic scenario.
- `continuedMomentum`: The next outcome if the nearest scenario is accepted and higher lows or continued volume support continuation.
- `strongExpansion`: A materially wider scenario requiring sustained momentum beyond the ordinary move.
- `extremeExpansion`: The “what if this becomes an exceptional small-cap runner?” branch. It must be conditional and may be far from the reference price.

### Rules

- All four horizon objects are required in the JSON.
- Each horizon must be available or explicitly unavailable.
- Unavailable explanations must identify the missing evidence. Generic wording such as “insufficient trading preparation” is invalid.
- Prices must be strictly ordered when available.
- Scenario prices must not duplicate `mustClear` or `breakoutContinuation`.
- The model must not populate every whole- or half-dollar price.
- Psychologically significant prices may be selected only when they create a materially distinct scenario appropriate to the stock's price scale and volatility.
- Observed historical structure must not be falsely claimed when the price is only a projection.
- An extreme scenario is not a prediction. Its condition must describe the exceptional acceptance, volume and higher-low behavior required before it becomes relevant.
- Add an optional `additionalEvidenceBackedScenarios` array only when a real observed level does not fit cleanly into the four primary horizons.

## Phase 4: Replace the production developer prompt

The implementation should preserve the existing catalyst, dilution, listing, pullback and downside rules. Replace the opening and upside-planning portions with the following intent.

### Production prompt requirements

The actual runtime prompt must not contain ticker-specific example prices or fixture expected outputs.

Use wording equivalent to:

> You produce a complete long-biased day-trading preparation read for TradersLink. Keep each explanation concise, but do not compress or omit tactical scenarios to shorten the response.
>
> The first accepted read must map the nearest realistic setup and the wider conditional paths that could matter during the rest of the trading session. Small- and micro-cap stocks can continue far beyond the nearest observed resistance. The plan must remain useful if momentum becomes unusually strong.
>
> Derive all tactical prices independently from the supplied raw OHLCV, session context, recent daily history, volatility profile and verified research. The packet intentionally contains no detected support/resistance ladder and no prebuilt target list.
>
> Do not create a mechanical percentage ladder. Do not output every round number. Use a psychological price only when it represents a materially distinct continuation scenario appropriate to the stock's price scale, realized volatility and current momentum regime.
>
> Analyze the forward map in four separate horizons: nearest realistic, continued momentum, strong expansion and extreme expansion. Complete each horizon or return a precise unavailable reason. Do not stop the plan after the first nearby outcome.
>
> For every scenario, state whether the price is based on observed structure, a psychological boundary, a volatility projection or a combination. Never call a projected price an observed historical level.
>
> The extreme-expansion branch answers what might potentially happen if an exceptional small-cap momentum move persists. It is conditional preparation, not a prediction. There is no arbitrary maximum percentage distance.
>
> Before returning JSON, re-read the full current-session and daily packet and ask whether the plan would still help a trader if price moved materially beyond the nearest scenario. Revise the plan when the strong or extreme branch was omitted merely because it seemed less likely than the nearest target.

Keep the existing rule that exact claims must be grounded in observable tape evidence. Expand valid evidence wording to permit a clearly labelled psychological or volatility-projection basis for wider conditional scenarios.

## Phase 5: Deterministic breadth validation without target generation

The validator must never calculate the model's replacement target price.

### Hard validation failures

Reject the response when:

- Any required horizon is missing.
- An unavailable horizon has no specific reason.
- Two available horizons normalize to the same price.
- Available horizons are not strictly ordered.
- A scenario duplicates breakout continuation.
- An observed-structure basis cites a price not present in supplied candles or summaries.
- A volatility-projection or psychological scenario is falsely described as historical resistance.
- Duplicate pruning removes an entire horizon without rerunning completeness validation.
- `strongExpansion` or `extremeExpansion` is unavailable only because the price is far away, unlikely, or beyond an arbitrary percentage.
- The returned read uses generic “insufficient trading preparation” language instead of identifying missing data or evidence.

### Suspicious-compression challenge

Compute diagnostic values after normalization:

```text
outerCoveragePct = (outerAvailablePrice - referencePrice) / referencePrice * 100
realizedExpansionPct = maximum available value among:
  gainFromPriorClosePct
  gainFromSessionOpenPct
  gainFromSessionLowPct
  broaderSessionMovePct
  sessionRangePct

volatilityScalePct = maximum available value among:
  averageDailyRange20Pct
  medianDailyRange20Pct
  maximumDailyRange30Pct
```

Use these only to decide whether the plan needs another completeness review. Do not convert the percentages into a target price.

A plan is suspiciously compressed when its outer scenario is very small relative to both the move already underway and the ticker's recent volatility. Calibrate the challenge threshold against recovered real fixtures rather than treating one universal percentage as truth.

The challenge should produce a validator failure similar to:

```json
{
  "code": "FORWARD_MAP_SUSPICIOUSLY_COMPRESSED",
  "referencePrice": 0,
  "outerCoveragePct": 0,
  "realizedExpansionPct": 0,
  "volatilityScalePct": 0,
  "message": "The proposed plan maps only a small continuation beyond the reference price despite a high-expansion regime. Reassess strong and extreme scenarios without adding a mechanical price ladder."
}
```

### Calibration principle

- Percentage distance is an alarm, not the source of truth.
- The validator may challenge a 3%, 9% or 15% plan in an extreme regime.
- The validator must not automatically reject a narrow plan when the supplied data truly supports no wider scenario and the model gives a precise reason.
- The validator must never reject a far scenario merely because it exceeds 50%, 100% or any other fixed distance.

## Phase 6: Improve the correction request

The existing repair request focuses on the exact first validator error. Replace it with a complete failure bundle.

Send:

- All validator failures, not only the first.
- The original authoritative packet.
- The rejected normalized draft.
- The price-free volatility profile.
- Which horizons are missing, duplicated or suspiciously compressed.
- Which fields are locked because they already validated.
- Any normalization or duplicate-pruning changes.

Do not send replacement target prices.

Use correction wording equivalent to:

> Repair the complete rejected AI Read. Preserve validated locked facts. Correct every supplied failure in one response.
>
> The forward map was rejected because one or more planning horizons were missing, duplicated, unsupported or suspiciously compressed relative to the supplied regime. Reassess the raw candles, daily history, volatility profile and psychological price scale. Derive the exact prices independently.
>
> Do not add a mechanical percentage ladder. Do not copy a sequence of whole- and half-dollar numbers. Do not call a projected price observed structure. Return each required horizon as available or with a precise evidence-based unavailable reason.

Use high reasoning effort for this repair.

## Phase 7: Send the complete prior plan during refreshes

Replace `confirmedPriorPlanBoundary`-only refresh context with a compact complete prior-plan snapshot.

Include:

- Prior reference price and generation time.
- Needs-to-hold, caution and momentum failure.
- Must-clear and breakout continuation.
- All upside scenario horizons and whether they were reached.
- Downside checkpoints.
- Shallow and deep pullback plans.
- Failure recovery plan.
- Catalyst, dilution and listing conclusions with source references.
- The crossed boundary and its confirmation metadata.
- Prior publication acknowledgement status.

### Refresh instructions

- Preserve prior scenarios that remain valid.
- Mark reached scenarios as achieved instead of forgetting them.
- Explain every removed or materially changed outer scenario.
- Add new structure only when it formed after the prior packet.
- Do not narrow the map merely because the reference price moved higher.
- Retain the prior complete public plan until the replacement is validated and acknowledged.

## Phase 8: Minimize refreshes through deterministic plan progression

A complete initial plan should not refresh when every inner target is touched.

Implement deterministic state transitions where possible:

- `approaching`
- `testing`
- `accepted`
- `rejected`
- `achieved`
- `invalidated`

### Suggested refresh triggers

Request a new AI Read only when at least one of the following occurs:

1. Price confirms above the outer available upside scenario.
2. Price confirms below momentum failure and the existing failure/recovery map is exhausted or invalidated.
3. A materially new catalyst, filing, dilution event or listing event arrives.
4. A prolonged new consolidation creates a genuinely different regime not represented in the plan.
5. The previous plan is stale across a session change and the new session has materially different structure.
6. The authoritative market-data source changes or a material quote disagreement is resolved in a way that invalidates the existing map.

Do not refresh simply because:

- the nearest realistic scenario was touched;
- an inner continuation scenario was achieved;
- a target label needs to change to “achieved”;
- the card needs to advance to the next already-mapped scenario.

## Phase 9: Model and token strategy

Recommended starting configuration for testing:

- Initial complete read: primary model with `high` reasoning.
- Repair after breadth failure: `high` reasoning.
- Normal refresh supplied with full prior plan: `medium` reasoning unless the regime is extreme or the prior plan is being materially replaced.
- Publication retry: replay the accepted payload; do not call the model again.
- Catalyst-only metadata update: avoid regenerating the tactical map unless the event changes the trading regime.

Keep the current 8,000 output-token ceiling initially. The new schema should use concise fields rather than longer prose.

## Phase 10: Renderer requirements

The public card must make the difference between realistic and conditional outcomes obvious.

Recommended presentation:

- **Nearest realistic outcome**
- **If momentum continues**
- **Strong expansion possibility**
- **Extreme momentum possibility**

For each, show:

- price;
- condition;
- basis label;
- concise rationale.

Use trader-safe wording such as “possible,” “conditional,” and “requires.” Do not present the outer scenario as likely or guaranteed.

Do not expose internal compression metrics, token accounting or validator details publicly.

## Regression fixtures and acceptance tests

Fixture expected prices belong only in tests and audit documents. They must never be embedded in the production developer prompt or runtime packet.

### Required recovered fixtures

- PN first read at the original reference price.
- PN later read.
- ZCMD.
- KUST.
- KSCP first and later reads.
- OMH repeated generations.
- SNTG.
- INM.
- SXTC.
- ZBAO.
- KAPA generation failure.
- INLF generation failures.
- ADVB refresh failures.
- CHAI publication failure.

### PN acceptance behavior

For the recovered PN first packet:

- The first plan must not end at the previously returned nearby outer outcome.
- It must include distinct nearest, continuation, strong and extreme branches.
- The known fixture should demonstrate at least the wider scenario coverage previously identified in later reads, including the `10.00` possibility at minimum when replaying that exact packet.
- A farther price may be labelled psychological or volatility-based if the packet does not contain an observed historical level there.
- The production prompt must not be given `10.00` as an expected answer.

### General assertions

- KUST cannot silently stop below a meaningful daily high that exists in its original packet.
- KSCP cannot defer a supplied meaningful daily outcome until a later refresh.
- OMH must not randomly omit the same material observed price across identical packets.
- Duplicate pruning cannot erase one of the required horizons.
- A compressed first plan must fail with an exact breadth error.
- A far outcome may not be rejected solely because it is more than 50% or 100% away.
- A projected psychological price cannot be described as an observed daily resistance.
- Refreshes must retain unreached valid outer scenarios.
- Reaching an inner scenario must not trigger a new model call.
- Publication failures must replay the accepted payload without regeneration.

## Replay audit and success metrics

Re-run all recovered accepted reads and compare them with their later refreshes.

Record:

- Initial outer coverage percentage.
- Realized expansion percentage.
- Volatility scale.
- Number of populated scenario horizons.
- Basis type of every scenario.
- Whether a later read introduced a scenario already supportable from the first packet.
- Number of model calls per ticker per session.
- Initial rejection rate.
- Repair rate.
- Publication retry rate.
- Average input and output tokens.
- Estimated API cost before and after.

### Product success criteria

1. The first read emphasizes the nearest realistic plan and includes wider conditional branches.
2. The first read remains useful through inner target crossings.
3. The number of refresh requests decreases materially.
4. No old support/resistance ladder is restored.
5. No production prompt contains hard-coded example target sequences.
6. Far scenarios are honest about being observed, psychological, projected or combined.
7. No arbitrary percentage ceiling limits the plan.
8. The full prior plan is preserved during refreshes.
9. Inner plan progression does not require model regeneration.
10. The website displays all scenario horizons clearly.

## Implementation scope to inspect

At minimum inspect and update, as applicable:

- `src/lib/ai/traderslink-ai-read-service.ts`
- `src/lib/ai/traderslink-ai-read-price-action.ts`
- AI Read payload and live-watchlist type definitions
- JSON schema
- normalization and duplicate pruning
- tactical validation
- refresh boundary state
- generation/cost ledger
- publisher/outbox/acknowledgement lifecycle
- recovered coverage audit script and fixtures
- website ingest/parser/renderer in the canonical website repository

Preserve unrelated user changes and dirty worktrees. Do not deploy or restart production.

---

# Codex implementation prompt

Act as the implementation engineer for the TradersLink AI Read complete-wide-plan correction.

Repository:

`C:\Users\jerac\Documents\TraderLink\levels-system`

Canonical website renderer, inspect and update only when required for payload parity:

`C:\Users\jerac\Documents\TraderLink\traderslink.pro`

Read this plan first:

`docs/TRADERSLINK_AI_READ_COMPLETE_WIDE_DAY_TRADE_PLAN_IMPLEMENTATION_PROMPT_2026-07-22.md`

Also inspect the existing July 22 coverage audit and recovered fixtures if present:

- `artifacts/TRADERSLINK_AI_READ_COVERAGE_AUDIT_2026-07-22.md`
- `scripts/audit-traderslink-ai-read-coverage.mjs`

## Objective

Make the first accepted TradersLink AI Read a complete, wide day-trading preparation plan. It must prioritize the nearest realistic outcome while also mapping conditional continued, strong and extreme momentum possibilities so traders do not need repeated AI requests merely because an inner target was crossed.

## Critical restrictions

- Do not restore or send the old detected support/resistance ladder.
- Do not send the model a prebuilt list of prices.
- Do not place ticker-specific expected prices or example whole-/half-dollar sequences in the production prompt.
- Do not use an arbitrary maximum percentage.
- Do not generate mechanical percentage targets.
- Do not deploy, restart runtime services or merge without explicit owner authorization.
- Preserve unrelated user changes and dirty worktrees.

## Required work

1. Audit the current developer prompt, schema, normalization, validation, duplicate pruning, refresh context and publisher lifecycle.
2. Add a deterministic price-free volatility/regime profile.
3. Expand daily history adaptively without generating a target ladder.
4. Replace the generic target array with required nearest-realistic, continued-momentum, strong-expansion and extreme-expansion horizons.
5. Require each scenario to disclose whether its basis is observed structure, psychological, volatility projection or combined.
6. Rewrite the developer prompt so prose remains concise but coverage is complete.
7. Add deterministic suspicious-compression validation that challenges the model without supplying replacement prices.
8. Send all validation failures in one repair request and use high reasoning for repair.
9. Send the full prior complete plan during refreshes.
10. Progress inner scenario states deterministically and avoid an AI refresh for ordinary target crossings.
11. Preserve the last complete acknowledged plan until a complete replacement is acknowledged.
12. Update website ingest and rendering so all four scenario horizons are visible and clearly conditional.
13. Add recovered regression fixtures and replay the July 22 audit.
14. Measure refresh count and estimated API cost before and after.

## Required evidence before editing

Document:

- Why the current schema permits locally compressed plans.
- Which exact current fields and rules encourage fewer targets.
- Whether daily history length contributed to each recovered omission.
- Which later-read scenarios were based on data already present in the first packet.
- Which later scenarios were genuinely created by new price action.

## Validation expectations

- PN's first recovered fixture must no longer pass with the old narrow plan.
- The known PN fixture must cover the wider possibility previously identified in later reads without placing that expected price in the production prompt.
- KUST and KSCP must not silently omit meaningful supplied daily outcomes.
- Duplicate pruning must rerun complete-horizon validation.
- A compressed plan must produce an exact validator error.
- An inner target crossing must not automatically cause a new AI generation.
- Publication retry must not regenerate an already accepted plan.
- Focused AI Read tests, publisher/outbox tests, type checks and builds must pass.

## Deliverables

1. Evidence-backed diagnosis.
2. Exact files changed and rationale.
3. Updated prompt and schema.
4. Deterministic regime metrics and breadth validator.
5. Refresh-continuity implementation.
6. Regression fixtures and replay results.
7. Website renderer verification.
8. API-call and estimated cost comparison.
9. Remaining risks.
10. A documentation-only implementation and audit handoff file.

Keep the work on a dedicated branch and open a draft PR. Do not deploy or merge.