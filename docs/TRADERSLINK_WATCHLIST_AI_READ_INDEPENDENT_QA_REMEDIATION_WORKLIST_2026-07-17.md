# Independent QA Remediation Worklist — TradersLink Watchlist and AI Read

**Status:** OPEN — independent QA did not accept full remediation closure  
**Date:** 2026-07-17  
**Levels repository:** `traderslink-bot/levels-system`  
**Levels working branch:** `codex/watchlist-ai-audit-remediation-20260717`  
**Handoff baseline reviewed:** `e149c11`  
**Website repository:** `traderslink-bot/traderslink-trader-improvement-system`  
**Website baseline reviewed:** PR `#99`, merge commit `a1258406b0e0d4b6cdaa04b9ff8e302b4810bc1b`

## Purpose

This document is the independent QA follow-up worklist after reviewing:

1. `docs/TRADERSLINK_WATCHLIST_AI_READ_QA_AUDIT_2026-07-17.md`
2. `docs/TRADERSLINK_WATCHLIST_AI_READ_OUTSIDE_AUDIT_REMEDIATION_HANDOFF_2026-07-17.md`
3. `docs/TRADERSLINK_WATCHLIST_AI_READ_IMPLEMENTATION_STATUS_2026-07-17.md`
4. the cited Levels implementation and tests; and
5. website PR `#99`, because timestamp truthfulness, persistence, EventSource reconciliation, and stale-state behavior cross the repository boundary.

The original outside audit and the prior remediation handoff are historical records. Do not rewrite them to erase prior conclusions. Implement the fixes below, add regression evidence, and then append a clearly dated follow-up status to this file and the handoff.

## Operating constraints

While completing this work:

- Do **not** deploy either repository.
- Do **not** restart production or local long-running services.
- Do **not** alter production/admin settings.
- Do **not** add or remove live tickers.
- Do **not** make paid OpenAI requests.
- Do **not** treat a rendered existing AI card as proof that the final configured model generated a new compliant read.
- Preserve the complete AI trade-plan packet and response contract. Cost remediation must not remove tactical fields or silently reduce the analysis packet.
- Use deterministic providers/mocks for tests.
- Treat website EventSource as a latency hint and persisted canonical state as the source of truth.

## Independent QA conclusion

The remediation contains substantive improvements, including independent mover discovery, normal activation readiness, normal replacement ordering, ticker-data revision ordering, stale-status labeling, direct removal of the application support/resistance ladder from the AI prompt, time-only refresh removal, and a durable publication outbox.

Full closure is not supported. The following source defects and verification gaps remain open:

- **P1:** 4 confirmed defects
- **P2:** 8 confirmed defects or material control gaps
- **P3:** 2 high-value hardening items
- **Verification limitation:** no newly paid live-model sample was run or authorized

---

# P1 findings — must fix before claiming audit closure

## P1-01 — A persisted stale price can be republished with `Date.now()` as its market observation time

### Evidence

In `src/lib/monitoring/manual-watchlist-runtime-manager.ts`, `refreshPriorRegularClose()` retrieves prior-close metadata and then republishes `entry.lastPrice` by calling `publishLiveTickerData()` with `timestamp: Date.now()`.

`publishLiveTickerData()` passes that timestamp into `buildLiveWatchlistTickerDataPatch()`, where it becomes both the ticker update time and `marketDataObservedAt`. The generated market-data revision is also based on that timestamp.

This can make an old restored quote appear to be a newly observed trade. Website revision reconciliation cannot protect against this because the runtime has already assigned the stale value a newer observation time and revision.

### Required remediation

- Never advance a quote observation timestamp when only metadata, prior-close context, level context, or card content changed.
- Republish an existing quote using its actual `entry.lastPriceUpdateAt` / original market observation time.
- Introduce or preserve a separate content/metadata update timestamp where needed.
- Ensure market-data revision advances only for a real accepted market observation, not for reformatting or enrichment of an existing quote.
- Audit every forced `publishLiveTickerData()` path for the same defect.

### Required regression tests

1. Persist an active ticker with an old `lastPrice` and `lastPriceUpdateAt`.
2. Complete an asynchronous prior-close lookup before any new trade arrives.
3. Assert the republished `marketDataObservedAt` equals the original price observation time.
4. Assert an enrichment-only publish cannot outrank a newer real quote.
5. Assert the website row/detail view does not show the enrichment time as the trade time.

### Closure evidence

Record the Levels commit, website commit if required, exact tests, and their output here.

---

## P1-02 — AI Read does not refresh or explicitly invalidate when its own primary momentum-failure boundary is crossed

### Evidence

`buildTradersLinkAiReadRefreshState()` stores only:

- the maximum of `breakoutContinuation` and all upside targets; and
- the minimum of `momentumFailure` and all downside checkpoints.

When a lower downside checkpoint exists, crossing the published `momentumFailure` may not reach the stored outer lower boundary or the 85% range-edge threshold. The card can therefore remain current after its own decisive failure level has been lost.

The same state model does not independently retain or reason about:

- `needsToHold`;
- `cautionBelow`;
- `momentumFailure` when a lower checkpoint exists;
- `mustClear`;
- `breakoutContinuation` when a higher target exists; or
- intermediate targets and checkpoints.

### Required remediation

Persist a typed boundary state rather than only two outer prices. At minimum retain:

- role;
- side;
- price;
- generated/read ID;
- served state;
- crossed state;
- whether the boundary invalidates, improves, or exhausts the active plan.

A decisive cross below `momentumFailure` must either:

1. trigger a new AI Read, subject to dedupe and budget controls; or
2. immediately mark the published read visibly invalid/stale until a refresh is available.

Do not create paid refreshes for every touch. Use acceptance/cross semantics and explicit served-state tracking.

### Required regression tests

1. Read generated at `$3.95`, `momentumFailure = $3.77`, lower checkpoint `$3.50`; price reaches `$3.70`.
   - Expected: refresh or visible invalidation.
2. Price merely touches and reclaims a boundary without accepted cross.
   - Expected: no duplicate paid read.
3. Price crosses the same already-served regime twice.
   - Expected: one generation for that regime.
4. Price advances through `mustClear`, `breakoutContinuation`, an intermediate target, and the outer target.
   - Assert the intended refresh/invalidation policy at each stage.
5. Persist/restart the state and repeat the same cases.

---

## P1-03 — Successful outbox replay is not acknowledged back into AI boundary/regime state, allowing a duplicate paid read

### Evidence

The AI service records the model attempt and generates a read, then publishes the card through the durable publisher. The manager persists the new AI boundary state and `lastAutomaticRefreshRegime` only after `publisher.publish()` resolves.

If publication fails:

- the completed card remains in the durable outbox;
- the manager does not commit the new boundary/regime state;
- a later ticker/health/card publish may replay the queued AI card successfully; but
- the AI manager receives no acknowledgement for that successful replay.

A later price update can therefore purchase another read for a regime that the website has already received through outbox replay.

### Required remediation

- Assign every AI generation an immutable `generationId` before the first model request.
- Persist a `generated_pending_publish` record containing the completed read, boundary state, trigger, and served regime before delivery.
- Carry `generationId` and an idempotency/revision key in the outbox payload.
- Add an acknowledgement path from successful immediate publication or later outbox replay back to the AI state manager.
- On acknowledgement, atomically commit the published generation, boundary state, and served regime.
- While an identical generation is pending publication, reuse/retry that completed generation rather than making another paid request.
- Ensure website ingest is idempotent for duplicate delivery of the same generation.

### Required regression tests

1. Model succeeds; first website publish fails; outbox contains the AI card.
2. A later unrelated publish replays the AI card successfully.
3. Price remains in/revisits the same regime.
4. Assert the model request count remains one.
5. Repeat across manager restart between generation and acknowledgement.
6. Replay the same outbox entry twice and assert website state remains idempotent.

---

## P1-04 — A cost-ledger append failure loses an already-paid attempt and does not durably stop later spending

### Evidence

The OpenAI response is received before the `onAttempt` callback writes to `TradersLinkAiReadCostLedger`. The ledger uses direct `appendFileSync()` with no accounting outbox, fallback journal, persistent unhealthy latch, or reconciliation queue.

If the append fails:

- the paid request has already happened;
- the attempt may not exist in the ledger;
- generation can abort before publication/state advancement; and
- a later price event can cause another request.

The current test proves that the append throws. It does not prove durable accounting or prevention of another paid attempt.

### Required remediation

- Introduce a durable raw attempt journal/accounting outbox.
- Persist the attempt record independently of summary/report generation.
- If durable accounting fails after an API response, latch accounting as unhealthy and block all new paid attempts until the unrecorded attempt is reconciled.
- Preserve enough response usage metadata to reconcile later.
- Do not misclassify a ledger-write exception as model-invalid output or launch a correction request because accounting failed.
- Expose the unhealthy/unreconciled state in admin diagnostics.

### Required regression tests

1. Return a successful fake OpenAI response, then force the ledger append to fail.
2. Assert no correction/fallback request is made because of the accounting exception.
3. Assert the attempt is recoverable from a durable journal or pending-accounting record.
4. Assert all later paid requests are blocked until reconciliation succeeds.
5. Reconcile, restart, and assert the exact request appears once in totals.

---

# P2 findings — fix or explicitly re-scope with evidence

## P2-01 — The daily spend guard estimates the next request but does not reserve budget atomically

### Evidence

`getDailyCostBudgetStatus()` performs a read-only calculation using recorded spend and a recent-request estimate. It does not create a reservation. The manager has a per-symbol in-flight lock, not a global budget transaction.

Two symbols can concurrently read the same available budget and both start. A correction or fallback can also make one generation cost more than the single recent-attempt estimate.

The handoff/status wording that the guard "reserves" an estimate is not supported by the implementation.

### Required remediation

- Serialize budget admission across symbols or implement an atomic reservation ledger.
- Calculate admission using `recorded spend + active reservations + proposed reservation`.
- Reserve a conservative worst-case generation cost that accounts for primary plus allowed correction/fallback paths.
- Replace the reservation with actual usage on terminal completion.
- Release it on zero-cost pre-request failure.
- Keep the existing card visible when the guard blocks a new request.

### Required tests

- Two concurrent symbols near the limit: only the affordable requests may start.
- Primary plus correction remains within the reserved amount or cleanly blocks the correction before spending.
- Crash/restart with an active reservation does not permanently leak or silently discard it.

---

## P2-02 — Removing the application ladder is real, but semantic derivation from observed price action is not enforced

### Evidence

The AI model packet no longer contains the application's detected support/resistance arrays. This closes the simplest direct ladder-copy path.

The validator currently relies on:

- price ordering;
- broad tape-related words in rationale text;
- a forbidden-language regex; and
- minimum spacing for upside targets/downside checkpoints.

It does not establish that a returned price is actually near an observed:

- consolidation shelf;
- repeated rejection/acceptance zone;
- session high/low;
- prior close;
- high-volume pivot;
- VWAP interaction;
- recent daily high/low; or
- demonstrated psychological price.

A fabricated arithmetic staircase can pass by using acceptable tape vocabulary.

### Required remediation

- Derive deterministic candidate landmarks/evidence spans from the supplied candle packet.
- Require every non-null tactical price to reference a typed landmark or a defensible transformation/extension from observed volatility.
- Validate price proximity/tolerance to the referenced landmark.
- For projected extensions, require an explicit observed range/volatility basis rather than generic wording.
- Reject generic tape words that do not correspond to the supplied data.
- Preserve null/fewer-target behavior when the tape does not support distinct prices.

### Required tests

- A well-spaced arithmetic ladder with generic session/volume words must fail.
- A rationale naming a session high at a price not present in the packet must fail.
- A valid consolidation/rejection map tied to observed bars must pass.
- Direct application support/resistance arrays must remain absent from the request body.

---

## P2-03 — Source grounding is topic-level rather than claim-level

### Evidence

`contextuallySupportedSourceUrls()` accepts a URL when its title, optional excerpt, filing type, or URL contains broad topic keywords. Once any dilution/listing/catalyst URL passes that topic test, detailed model conclusions can be retained even when the source text does not support them.

Examples of insufficiently validated fields include:

- `canCompanyIssueToday`;
- issuance/resale status and trigger;
- earliest issuance/resale date;
- dilution severity;
- current listing procedural state; and
- near-term/immediate timing.

### Required remediation

- Parse research into typed source facts before model use.
- Store source-backed text spans for each fact.
- Validate every material output field against those facts.
- Do not infer a closing/settlement date from a filing or announcement date.
- Check superseding filings/notices rather than treating "latest in retrieved window" as global supersession proof.
- When only a title is available, restrict conclusions to what the title literally supports.
- Downgrade unsupported detail to `unknown`, `null`, or `unverified`.

### Required tests

1. Offering announcement title only; model claims issuance/resale immediate.
   - Expected: downgrade.
2. Filing mentions a future closing condition; model claims `canCompanyIssueToday: true`.
   - Expected: reject/downgrade.
3. Unsupported earliest date.
   - Expected: `null`.
4. Older listing notice superseded by a current extension/stay.
   - Expected: newest supported state wins.

---

## P2-04 — Title-only evidence is retained but not visibly identified in the website AI card

### Evidence

Website parsing retains `excerptKind`, `supportingExcerpt`, `retrievedAt`, and `supersessionStatus`. The rendered source list in PR `#99` displays only source type, publication date, and filing type.

Users cannot distinguish:

- parsed article/filing summary evidence;
- article-title-only evidence; and
- web-search-title-only evidence.

The handoff/status claim that title fallback is visibly marked is therefore unsupported.

### Required remediation

In the AI Read source display:

- show a plain-language evidence label such as `Parsed summary`, `Title-only evidence`, or `Web-search title only`;
- show the bounded supporting excerpt when present and safe;
- show retrieval/supersession status in a concise disclosure;
- avoid presenting title-only evidence as equivalent to parsed filing text.

### Required tests

- Parser and component tests for all three excerpt kinds.
- Snapshot/DOM assertions that title-only evidence is visibly labeled.
- Unsupported/missing evidence metadata must fail closed or display an explicit limitation.

---

## P2-05 — Challenger activation failure plus incumbent restoration failure leaves phantom active selector state

### Evidence

Normal replacement correctly moves the incumbent to standby before activating the challenger.

`replaceManagedDecision()` copies the incumbent while its state is still `active`. If challenger activation fails, `restoreManagedEntryAfterFailedReplacement()` attempts reactivation. If that restoration also fails, the saved copy is put back in `managedEntries` without changing `state` from `active`.

The runtime can have zero active automatic tickers while selector persistence says the incumbent is active. Because no successful replacement/departure event is recorded, the empty slot can also lose its pending-replacement semantics and become blocked by the already-consumed daily-add allowance.

### Required remediation

- On restore failure, mark the incumbent as `restore_failed`, `standby`, or another explicit non-active state.
- Preserve a durable pending replacement opening.
- Reconcile selector state against runtime acknowledgement before any entry is marked active.
- Surface the failed restoration in status and allow a later qualified challenger to fill the opening without consuming a new initial-add allowance.

### Required tests

- Incumbent deactivation succeeds.
- Challenger activation fails.
- Incumbent restoration also fails.
- Assert no phantom active state, pending opening survives, restart preserves it, and a later challenger can fill the slot.

---

## P2-06 — Authoritative common-stock verification is conditional on token presence and can evict verified incumbents during an outage

### Evidence

`requireVerifiedCommonEquity` defaults to true only when an EODHD token is present. Without a token, automatic selection can fall back to heuristic classification instead of failing closed.

When verification is enabled but temporarily unavailable, all evaluated automatic entries receive `securityMasterStatus: unavailable`. Active incumbents then fail qualification and can accumulate retention failures until automatically moved to standby.

### Required remediation

- Make authoritative common-equity verification an explicit automatic-selector requirement, not an implicit consequence of token presence.
- If automatic selection is enabled and verification is unavailable, block **new automatic admissions** and expose the reason.
- Manual additions remain operator-controlled.
- Preserve the last successful verification for existing incumbents for a bounded grace period.
- Do not count a security-master transport outage as a ticker-specific retention failure.
- Continue to remove an incumbent when authoritative data positively reports `not_common_stock` or equivalent.

### Required tests

- Automatic selector enabled with no security-master credential: no additions; status says verification unavailable.
- Temporary lookup outage: new additions blocked; previously verified incumbent retained during grace period.
- Positive non-common-stock result: candidate rejected and incumbent policy applied explicitly.

---

## P2-07 — Website monotonic persistence covers ticker data but not all card, status, visibility, and health mutations

### Evidence

Website PR `#99` correctly orders ticker-data patches by market observation and revision.

General card/status patches can still replace newer card content without comparing card revision/source time. State `updatedAt` is kept at the maximum, which can make an old retried card appear current. Health updates also overwrite without revision/source-time ordering, and the client directly accepts health events and poll values.

### Required remediation

- Add monotonic revision/source-time semantics to all mutable state families:
  - cards, including AI Read generation IDs;
  - lifecycle/status/deactivation/reactivation;
  - visibility controls;
  - global health; and
  - ticker data.
- Persist idempotency keys for outbox replay.
- Reject old card/status/health payloads even when they arrive after a newer payload.
- Define and test reactivation epochs so an old deactivation cannot remove a newer activation and an old activation cannot resurrect a deactivated symbol.

### Required tests

- Late old AI card after a newer card.
- Late deactivation from a prior activation epoch.
- Late visibility patch.
- Late health `live` after a newer `stale/offline`, and the reverse based on source time/revision.
- SSE and polling permutations across two simulated instances.

---

## P2-08 — Global feed health can mask a stale individual ticker

### Evidence

Runtime feed health is based on a manager-wide last price update. One actively trading ticker can keep the global status `live` while another ticker has not received an observation for an extended period.

The website detail page displays the global status beside the individual ticker and uses generic `updatedAt`, not a dedicated visible quote observation timestamp.

### Required remediation

- Compute and publish per-symbol freshness from `latestPriceObservedAt`.
- Show both:
  - global provider/feed status; and
  - ticker-specific quote freshness.
- On index and detail views, label whether a displayed time is `Quote observed`, `Card/content updated`, or `Generated`.
- Do not allow unrelated card/enrichment writes to make a ticker price look fresh.

### Required tests

- Ticker A remains active while ticker B stops receiving observations.
- Global feed remains live.
- B must display `Ticker data stale` with its actual observation time.
- Card updates for B must not reset ticker freshness.

---

# P3 high-value hardening

## P3-01 — Fresh runtime quote can be analyzed against intraday candles nearly 24 hours old

### Evidence

A five-minute candle older than 30 minutes correctly stops being used as the current quote, but the broader price-action eligibility gate permits the newest intraday candle to be up to 24 hours old.

This can combine a fresh isolated runtime trade with prior-session-only structure after the current tradable session has begun.

### Required hardening

- Add explicit current-session coverage requirements based on market session and elapsed session time.
- Permit prior-session-only planning only in an explicitly labeled pre-session/closed-market mode.
- During an active session, require a minimum number and freshness of current-session bars or lower confidence/block generation.
- Expose the exact coverage limitation in the payload and card.

---

## P3-02 — Production smoke evidence should be reproducible without relying only on an operator-authenticated narrative

### Evidence

The protected production watchlist requires authentication. Independent QA could not reproduce the handoff's authenticated row/detail smoke result from repository evidence alone.

### Required hardening

Add a deterministic cross-repository verification path that does not expose production credentials:

- fixture API/store state;
- authenticated test-session harness or local e2e auth stub;
- browser assertions for rows, timestamps, stale labels, AI card, source evidence labels, and deactivation;
- artifact containing commit/build IDs and test output.

Do not deploy merely to satisfy this item.

---

# Unsupported or overstated handoff claims to correct

After the fixes above, update the handoff/status documents so the wording matches the actual evidence. At minimum correct these statements unless new implementation evidence supports them:

1. **"Every tactical boundary is ATR/range-aware spaced."**  
   Current spacing enforcement applies to target/checkpoint sequences, not every primary boundary.

2. **"The spend guard reserves a recent-request estimate."**  
   Current code performs a read-only estimate check and has no atomic reservation.

3. **"Title-only evidence is visibly marked."**  
   Evidence kind is retained in data but is not currently displayed in the source list.

4. **"The five-symbol fixture exercises publication, persistence, and UI parsing."**  
   `src/tests/traderslink-ai-read-post-change-fixtures.test.ts` exercises the service/validator and cost ledger with pre-authored fake model responses. It does not invoke the publisher, outbox, website ingest/store, SSE reconciliation, website parser, or React rendering.

5. **"The remaining items are optional enrichment rather than unresolved source defects."**  
   Do not restore this statement until every P1 item is fixed and every retained P2 item is accurately scoped.

6. **"Boundary-regime dedupe prevents repeat duplication."**  
   This is not true across generation success, publication failure, later outbox replay, and manager restart until acknowledgement is integrated.

## Five-symbol fixture wording

Keep the deterministic fixture, but describe it accurately:

- It validates schema/normalization/contract behavior for five supplied candle packets and five supplied fake model outputs.
- It is useful code-level evidence.
- It is not an independent derivation oracle.
- It is not a live-model sample.
- It does not establish publication-to-browser behavior unless expanded into a real cross-repository test.

---

# Explicit live-model validation limitation

No newly paid OpenAI sample was authorized or run during independent QA.

The following are established at code level:

- the detected application support/resistance ladder is omitted from the model packet;
- the complete price-action packet and full trade-plan schema remain present;
- external web search can be disabled;
- schema, ordering, lexical rationale, and target/checkpoint spacing checks exist; and
- deterministic fake responses can pass/fail those checks.

The following are **not** established without a new authorized live-model sample:

- that `gpt-5.6-luna` with medium reasoning consistently identifies the best tactical boundaries;
- that returned prices are genuinely derived from the supplied candles rather than plausible invented numbers;
- that current live-model dilution/listing conclusions are entailed by source content; or
- that five new post-remediation outputs pass an independent trader review.

Do not make a paid request as part of this work. Leave this limitation explicitly open unless the operator separately authorizes and budgets a live-model review.

---

# Required implementation workflow for Codex

1. Read the three original documents and this worklist.
2. Revalidate each finding against the latest branch head before changing code.
3. Work finding-by-finding, starting with P1-01 through P1-04.
4. Add failing regression tests before or with each fix.
5. Make the smallest coherent implementation that closes the root cause, not only the cited example.
6. For cross-repository findings, create a website branch and a separate website commit/PR. Do not commit website changes to deployed `main` directly.
7. Do not deploy or restart services.
8. Do not make paid OpenAI requests.
9. Run targeted tests after each finding, then the appropriate full repository checks.
10. Update this file with a closure table containing:
    - finding ID;
    - implementation commit;
    - files changed;
    - exact tests added/run;
    - pass/fail output;
    - residual limitation.
11. Update the handoff and implementation-status documents only after evidence exists.
12. Explicitly distinguish:
    - deterministic code-level validation;
    - provider-backed but non-mutating verification;
    - authenticated browser verification; and
    - a newly paid live-model sample.

## Required non-paid verification

### Levels repository

Run at minimum:

```text
npm run build
npm run check
```

Also run focused tests covering:

- timestamp truthfulness;
- AI boundary/invalidation state;
- publication failure/outbox acknowledgement;
- durable attempt accounting;
- concurrent budget admission;
- selector replacement double failure;
- security-master outage behavior; and
- AI semantic/source validation.

### Website repository

Run at minimum:

```text
npx tsc --noEmit
npx vitest run
```

Add focused coverage for:

- card/status/health monotonic persistence;
- reactivation epochs;
- EventSource/poll permutations;
- per-symbol freshness;
- evidence-kind display; and
- outbox idempotency/generation IDs.

Use a deterministic local browser/e2e fixture where possible. Do not use production mutation to obtain evidence.

---

# Completion gate

This worklist may be marked closed only when:

- all four P1 findings have implementation and regression evidence;
- each P2 finding is fixed or narrowly re-scoped with explicit operator acceptance;
- no handoff claim exceeds the code/test evidence;
- both repositories pass their required checks;
- no deployment, restart, ticker mutation, setting mutation, or paid OpenAI request was performed; and
- the final report clearly states that live-model quality remains untested unless separately authorized.

## Closure table

| Finding | Status | Commit(s) | Tests/evidence | Residual limitation |
|---|---|---|---|---|
| P1-01 | Open |  |  |  |
| P1-02 | Open |  |  |  |
| P1-03 | Open |  |  |  |
| P1-04 | Open |  |  |  |
| P2-01 | Open |  |  |  |
| P2-02 | Open |  |  |  |
| P2-03 | Open |  |  |  |
| P2-04 | Open |  |  |  |
| P2-05 | Open |  |  |  |
| P2-06 | Open |  |  |  |
| P2-07 | Open |  |  |  |
| P2-08 | Open |  |  |  |
| P3-01 | Open |  |  |  |
| P3-02 | Open |  |  |  |
