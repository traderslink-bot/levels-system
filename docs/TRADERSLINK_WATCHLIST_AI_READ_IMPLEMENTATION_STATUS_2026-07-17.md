# TradersLink Watchlist and AI Read — Implementation Status

**Last verified:** 2026-07-17  
**Implementation branch:** `codex/watchlist-ai-audit-remediation-20260717`  
**Original outside audit:** `docs/TRADERSLINK_WATCHLIST_AI_READ_QA_AUDIT_2026-07-17.md`  
**Status:** Code remediation is substantially complete; the audit is **not fully closed** and is **not approved for a live-production release**.

## What was completed

### Original P1 findings — fixed and regression-covered

| Finding | Result | Main evidence |
|---|---|---|
| Independent current-mover discovery | Fixed | `835c9e1`; an eligible Nasdaq mover does not require bulk-screener membership, and quote provenance is preserved. |
| Activation readiness | Fixed | `835c9e1`; queued/failed entries are not treated as active until levels, monitoring, and required website acknowledgement complete. |
| Hard automatic active-slot ceiling | Fixed | `835c9e1`; replacement order, rollback, interruption, restart recovery, and manual-ticker protection are covered. |
| Monotonic website market-data persistence | Fixed in the website repository | Website commit `90914a89`; per-symbol source-time and revision ordering reject stale/equal patches and accept higher revisions. |
| Truthful market-data status | Fixed in code | `835c9e1` and website `90914a89`; usable market-event timing is separate from health/heartbeat timing, and stale is not presented as live. |
| Publication acknowledgement and retry | Fixed | `835c9e1`; terminal publication errors reject, an ordered durable outbox retries, and local AI/publish state does not advance before acknowledgement. |
| Complete AI Read cost accounting | Fixed | `835c9e1` and `a5d8bde`; primary, correction, fallback, invalid output, transport, publication, corrupt-ledger, and ledger-write paths are covered. |

### AI Read hardening completed

- Real source candle timestamps are preserved; stale five-minute candles fall back to the current runtime quote.
- The full-session price-action packet remains intact. No prompt-packet compression was introduced.
- Every tactical boundary is validated for ordering, observable tape rationale, and meaningful ATR/range-aware spacing.
- Targets and downside checkpoints cannot be a mechanical walk through the application ladder.
- Time-only AI regeneration is removed. Automatic refresh is limited to a material range edge or map-boundary cross.
- An automatic boundary-regime marker prevents a repeat whipsaw through an already-served boundary from buying a duplicate AI Read.
- Research claims are topic-checked against their cited source context and downgraded when unsupported.
- External research can be disabled without disabling the database-first price-action trade plan or creating OpenAI web-search calls.
- Global TradersLink AI Read and Potential Gain visibility controls persist across restart.
- A sanitized deterministic five-symbol post-change fixture audit is committed at `src/tests/fixtures/traderslink-ai-read-post-change-fixtures.json` and exercises generation, validation, accounting, publication, persistence, and UI parsing without a paid OpenAI request.

### Cost-control work completed

Commit `e68a118` added the current cost controls:

- `gpt-5.6-luna` is the default Trader Read model with medium reasoning; `gpt-5.6-terra` remains the compatibility fallback and can still be selected by environment configuration.
- The Watchlist Admin shows the active AI model, reasoning profile, today/7-day/30-day/all-time expense, and model-separated totals.
- The **Optional Daily AI Spend Guard** persists across restart and defaults **off**. When enabled, it reserves a recent-request estimate before a new read starts, blocks safely if the ledger is unhealthy or unpriced, and never removes an existing published card.
- The full analysis packet and the `max_output_tokens` ceiling remain unchanged.

## Verification performed

On this branch, after the cost-control commit:

```text
npm run build
# pass

npx tsx --test --test-timeout=90000 \
  src/tests/traderslink-ai-read-refresh.test.ts \
  src/tests/traderslink-ai-read-settings.test.ts \
  src/tests/traderslink-ai-read-cost-ledger.test.ts \
  src/tests/traderslink-ai-read-service.test.ts \
  src/tests/manual-watchlist-server.test.ts
# 44 pass, 0 fail

npm run check
# pass: TypeScript build plus full test suite
```

The broader audit remediation command results and the five-symbol fixture evidence are retained in the original audit document.

## Work that remains open

These are intentional, explicitly tracked audit gaps—not hidden failures:

| Finding / gate | Why it remains open |
|---|---|
| P2-02 US exchange calendar | Session classification still uses a clock-only policy. Holiday, early-close, and special-session rules need an exchange calendar and fixtures. |
| P2-07 complete claim evidence model | URL/topic checking is implemented, but parsed filing facts, short evidence excerpts, retrieval timestamps, and supersession tracking have not been added. |
| P2-10 multi-instance stream recovery | Existing five-second polling converges clients, but there is no durable cross-instance pub/sub or explicit EventSource revision-gap recovery protocol. |
| P3-01 security classification | Automatic rejection is improved but still uses heuristic common-equity filtering; an authoritative security-master source has not been integrated. |
| Authorized authenticated production verification | Signed-in watchlist/detail routes, production publication-recovery behavior, and per-symbol stale-state display need a permitted live verification session. |
| Live sampled-model AI review | The committed five-symbol audit is deterministic and does not spend API money. It does not replace a separately authorized live/model sample or authenticated production-card review. |

## Release position

- **Watchlist:** not approved for live deployment until the remaining exchange-calendar and multi-instance-delivery risks are resolved or explicitly accepted, and authenticated production verification is completed.
- **TradersLink AI Read:** code-level post-change gate passes, including the reproducible five-symbol fixture audit. It is not yet a live-production quality pass because no paid live-model sample or authenticated production-card verification was authorized.

## Deployment state

No deployment, production restart, merge, live-watchlist mutation, environment-variable change, or paid OpenAI request was made by this remediation work. The implementation branch is pushed to GitHub and remains separate from the running runtime.
