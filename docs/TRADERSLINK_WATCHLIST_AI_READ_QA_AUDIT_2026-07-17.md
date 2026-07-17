# TradersLink Watchlist and TradersLink AI Read — Read-Only QA Audit

**Audit date:** 2026-07-17  
**Audit type:** Broad read-only QA and small-cap trading-system review  
**Release verdict:** **NO-GO / release blocked**  
**Canonical audit branch:** `agent/traderslink-watchlist-ai-read-audit-0329014`

## Exact source snapshots

### levels-system

- Repository: `traderslink-bot/levels-system`
- Audited branch: `codex/running-watchlist-qa-snapshot-20260717`
- Audited commit: `032901436a03429af61db25f1b5627a517d1e190`

### traderslink.pro production application

- Repository: `traderslink-bot/traderslink-trader-improvement-system`
- Branch: `main`
- Audited commit: `982ce080b375d130406121c587f269fde5181f62`
- Route reviewed: `https://traderslink.pro/watchlist`

## Safety constraints followed

The audit did not deploy, restart services, merge code, mutate production data, add or remove live tickers, place trades, alter runtime settings, or make paid OpenAI requests.

The production watchlist redirected to Discord OAuth. Therefore, authenticated card rendering, signed-in detail navigation, and browser-level live EventSource behavior could not be completely exercised. These are listed as unverified production checks rather than assumed passes.

---

# Remediation update — 2026-07-17

**Scope:** Dedicated remediation branches only. No deployment, runtime restart, production mutation, live-watchlist change, or paid OpenAI request was made during this work.

## Resolution tracking matrix

| Finding | Status | Resolution evidence | Residual risk |
|---|---|---|---|
| P1-01 independent current movers | Fixed | Levels `835c9e1`; mover-only and quote-provenance regression coverage | Automatic additions now fail closed if the configured security master cannot verify common stock. |
| P1-02 activation readiness | Fixed | Levels `835c9e1`; queued/failed entries stay inactive until snapshot, monitor, and website acknowledgement complete | Live production path still needs authorized authenticated verification. |
| P1-03 hard active ceiling | Fixed | Levels `835c9e1`; incumbent retires before challenger becomes active and rollback is covered | External provider/runtime failure still needs operational monitoring. |
| P1-04 monotonic website state | Fixed | Website `90914a89`, `9e23a242`; observation time plus per-symbol revision rejects stale/equal updates and canonical polling cannot overwrite a newer stream state | Authenticated UI verification remains pending. |
| P1-05 truthful feed state | Fixed | Levels `835c9e1`, website `90914a89`; stale labels and real last-trade timing | Per-symbol production smoke check remains pending authorization. |
| P1-06 publication acknowledgement/outbox | Fixed | Levels `835c9e1`; terminal failures reject, durable outbox replays ordered patches | Production recovery drill remains pending. |
| P1-07 per-attempt cost accounting | Fixed | Levels `835c9e1`, `a5d8bde`; primary, correction, fallback, publish-error, write-failure, and corrupt-ledger tests | Invoice remains billing authority; ledger displays estimates. |
| P2-01 market-cap authority | Fixed | Levels `835c9e1`, `a5d8bde`; current Yahoo/Finnhub enrichment wins over stale discovery cap | Provider disagreement without a current enrichment value remains correctly rejected/unknown. |
| P2-02 exchange calendar | Fixed | Levels `909ca46`; shared NYSE/Nasdaq holiday, special-closure, and early-close classifier is used by scanner, candles, AI Read, and grouping fixtures | Future exceptional exchange closures must be added to the explicit exception map. |
| P2-03 ticker display timestamp | Fixed | Website `90914a89`; market-data observation/revision and state update timestamps are separated | Authenticated UI verification still pending. |
| P2-04 stale five-minute price | Fixed | Levels `835c9e1`; source candle timestamp is preserved and stale close falls back to runtime quote | Feed freshness still depends on provider availability. |
| P2-05 mechanical targets/checkpoints | Fixed | Levels `835c9e1`; all targets/checkpoints require tape language and ATR/range-aware spacing | This is validation, not a guarantee a model will choose the best discretionary level. |
| P2-06 time-only refresh | Fixed | Levels `835c9e1`; no refresh for elapsed time alone while price remains within map boundaries | A material structural change without a price boundary crossing is not independently detected yet. |
| P2-07 claim-to-source support | Changed / bounded | Levels `d298e32`; each selected source now carries publication/filing metadata, retrieval time, an explicit source excerpt/title, and bounded-window supersession status; source-topic enforcement remains active | The upstream lookup must provide parsed filing excerpts for more than title-level support; the current fallback is deliberately labelled as an article-title excerpt. |
| P2-08 combined token totals | Fixed | Levels `835c9e1`; totals reconstruct missing `total_tokens` from input/output components | Provider-reported usage can still be delayed or absent. |
| P2-09 global visibility persistence | Fixed | Levels `835c9e1`; Trader Read and Potential Gain settings persist and migrate | Runtime restart smoke check is included in focused tests, not a live restart. |
| P2-10 multi-instance EventSource | Fixed for state correctness | Website `9e23a242`; stream ready/error forces immediate canonical reconciliation, polling and stream updates are revision/observation guarded, and late responses cannot overwrite newer state | EventSource remains an opportunistic low-latency hint; canonical polling, rather than durable pub/sub, supplies cross-instance recovery. |
| P2-11 reproducible five-symbol audit | Fixed | Levels `a5d8bde`; committed sanitized fixture pack and complete validation test | It is deterministic mocked-model evidence, not a new paid live-model sample. |
| P3-01 common-equity classification | Fixed for automatic additions | Levels `d298e32`; cached EODHD `common_stock` exchange-symbol master verifies new automatic symbols and fails closed on missing/unavailable records | Manual additions remain user-directed; EODHD unavailability deliberately blocks new automatic additions until the cached/remote master is available. |
| P3-02 corrupt cost ledger | Fixed | Levels `a5d8bde`; summary exposes corrupt-line count and accounting-health warning | Corrupt bytes cannot be reconstructed automatically. |

## Post-change five-symbol AI Read audit evidence

`src/tests/fixtures/traderslink-ai-read-post-change-fixtures.json` commits five sanitized full-session five-minute packets, daily context, quote timestamps, research evidence, deterministic model drafts, and independent expected tactical ranges. The test `src/tests/traderslink-ai-read-post-change-fixtures.test.ts` executes the complete AI Read service validation path for:

- `AURX` — premarket continuation;
- `BPLN` — failed-bounce/shelf-risk setup;
- `CRVM` — range reclaim;
- `DLTX` — low-priced breakout with no verified catalyst;
- `ESCR` — higher-priced continuation with conditional merger supply context.

It verifies needs-to-hold, caution, failure, must-clear, continuation, targets, downside checkpoints, actual candle timestamp, evidence-backed research fields, zero web-search calls, and a five-attempt local cost ledger. It never sends the fixture key to OpenAI and never makes a paid request.

## Verified commands

```text
npx tsx --test --test-timeout=90000 src/tests/traderslink-ai-read-post-change-fixtures.test.ts
# 1 pass, 0 fail

npx tsx --test --test-timeout=90000 src/tests/traderslink-ai-read-cost-ledger.test.ts src/tests/traderslink-ai-read-service.test.ts
# 15 pass, 0 fail

npx tsx --test --test-timeout=90000 src/tests/auto-watchlist-selector.test.ts
# 29 pass, 0 fail

npx tsc -p tsconfig.json --noEmit
# pass

npx tsx --test --test-timeout=90000 src/tests/manual-watchlist-runtime-manager.test.ts
# 140 pass, 0 fail

npx tsx --test --test-timeout=90000 \
  src/tests/auto-watchlist-selector.test.ts \
  src/tests/auto-watchlist-dynamic-slots.test.ts \
  src/tests/live-watchlist-publisher.test.ts \
  src/tests/traderslink-ai-read-refresh.test.ts \
  src/tests/traderslink-ai-read-service.test.ts \
  src/tests/traderslink-ai-read-cost-ledger.test.ts \
  src/tests/traderslink-ai-read-settings.test.ts \
  src/tests/traderslink-ai-read-post-change-fixtures.test.ts
# 120 pass, 0 fail

# in traderslink.pro remediation worktree
npx vitest run src/lib/live-watchlist
# 48 pass, 0 fail

npx tsc --noEmit
# pass
```

The release verdict is deliberately not upgraded to a live-production pass until authorized authenticated checks and the remaining exchange-calendar/EventSource risks are resolved or explicitly accepted.

---

# Critical AI Read scope caveat

**This is the most important audit caveat and must remain attached to the findings.**

Per operator clarification, the tickers used for the independent TradersLink AI Read review were added to the watchlist **before the most recent watchlist and AI Trader Read changes were made**.

That means:

1. The code findings are valid against the pinned source snapshots.
2. The five-symbol trader-plan review is a historical professional baseline.
3. The five-symbol review does **not** prove that the latest post-change AI Read currently produces correct output.
4. The current AI Read remains unverified until at least five symbols added or regenerated after the latest changes are audited.
5. Codex must not turn the older-symbol baseline into a current release pass.

I did not repeat the live AI Read audit during this documentation pass because:

- paid OpenAI calls remained prohibited;
- no authenticated production session was available;
- no immutable five-symbol post-change input/output fixture pack was available;
- rerunning the same pre-change symbols would not validate the new implementation.

A new post-change AI Read audit is therefore a **mandatory release gate**, not optional follow-up work.

Safe ways to perform it are:

- use post-change AI Read payloads already stored in current or archived watchlist data;
- use deterministic mocked model output through the complete validation and publishing path;
- construct a sanitized fixture pack with post-change candles, quotes, generated reads, research evidence, and usage records;
- make paid OpenAI requests only with separate explicit operator approval.

---

# Executive summary

| Priority | Count | Result |
|---|---:|---|
| P0 | 0 | No confirmed uncontrolled trading action or immediate catastrophic outage |
| P1 | 7 | Confirmed release-blocking defect groups |
| P2 | 11 | Confirmed defects or material design risks |
| P3 | 2 | Lower-severity risks and auditability gaps |

## Release blockers

1. A true current Nasdaq mover can be hidden by an incomplete or stale bulk screener response.
2. Automatic activation treats “queued” as “active” before levels, monitoring, and website publication are ready.
3. Terminal activation failures can remain `active: true` and survive restart in a skipped state.
4. Replacement operations can exceed configured active-slot ceilings.
5. Older production ticker patches can overwrite newer quotes and levels.
6. A stale data feed is deliberately presented as `ON`, with a heartbeat timestamp that can look fresh.
7. Failed, corrected, and fallback OpenAI request attempts can be omitted from cost reporting.

## Core end-to-end path reviewed

```text
Nasdaq screener / Nasdaq market movers
  -> instrument filtering
  -> session activity lookup
  -> Yahoo / Finnhub enrichment
  -> qualification and ranking
  -> automatic lifecycle
  -> queued activation
  -> candle loading and startup cache
  -> level generation
  -> EODHD / IBKR live trades
  -> website quote/card/health publishing
  -> production ingest and persistence
  -> EventSource plus polling
  -> watchlist and signed detail pages
  -> TradersLink AI Read generation, validation, sourcing, publication, and cost ledger
```

The largest integrity breaks are at discovery, activation, publication acknowledgement, and production-state ordering.

---

# Classification rules

- **Confirmed defect:** The implementation directly permits behavior that violates the requested contract.
- **Design risk:** The common path may work, but no durable invariant or authoritative source guarantees it.
- **Observation:** A useful control exists, or production behavior could not be fully exercised.

Line numbers are from the pinned snapshots. Re-resolve them if later code has moved.

---

# P1 — Release-blocking findings

## P1-01 — Current Nasdaq movers can be hidden by stale screener data

**Classification:** Confirmed defect  
**Area:** Market discovery  
**Primary file:** `src/lib/auto-watchlist/auto-watchlist-selector.ts`  
**Evidence:** around lines `1825-1859` and `1915-1930`

### Evidence

The code first builds `commonBySymbol` from the bulk Nasdaq screener. A live market-mover row is only retained if it can be joined to that map:

```ts
const base = marketMoversBySymbol.get(symbol) ?? commonBySymbol.get(symbol);
if (!base) continue;
```

The market-movers endpoint is therefore not an independent source. A current mover missing from a stale screener snapshot is silently discarded before enrichment.

The screener path also assigns:

```ts
quoteTime: Math.floor(this.now() / 1000)
```

That is fetch time, not trade time. When extended-hours activity lookup fails, an old candidate can appear recently quoted.

### Reproduction

1. Return a bulk screener response that omits `NEWA`.
2. Return `NEWA` in the current Nasdaq `MostAdvanced` or `MostActiveByShareVolume` response.
3. Supply valid current activity, price, market cap, and share data.
4. Run a premarket, regular, or post-market scan.

### Expected

`NEWA` is independently validated and evaluated.

### Actual

`NEWA` is skipped because it is absent from `commonBySymbol`.

### Impact

New listings, renamed symbols, temporarily omitted rows, and genuine current movers can be invisible.

### Required fix

- Admit live mover rows independently.
- Resolve security type and company metadata from authoritative sources.
- Store `fetchedAt` separately from actual `lastTradeAt`.
- Never let fetch time satisfy a staleness requirement.

### Required regression tests

- mover present while bulk screener omits it;
- symbol rename/new listing;
- activity unavailable does not create a fresh quote timestamp;
- premarket, regular, and post-market coverage.

---

## P1-02 — Queued activation is treated as completed activation

**Classification:** Confirmed defect  
**Area:** Watchlist lifecycle  
**Files:**

- `src/runtime/manual-watchlist-server.ts`, around `881-893`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`, around `9995-10082`, `9303-9350`, and `8688-8710`
- `src/lib/auto-watchlist/auto-watchlist-selector.ts`, around `1408-1449`
- `src/lib/monitoring/watchlist-store.ts`, around `208-210`

### Evidence

The automatic selector is wired to:

```ts
activateSymbol: (input) => manager.queueActivation(input)
```

`queueActivation()` immediately writes:

```ts
active: true
lifecycle: "activating"
operationStatus: "queued for activation"
```

and returns before candle loading, level generation, initial snapshot posting, monitor restart, and website publication finish.

The selector treats this return as success, records the symbol as a managed active entry, and consumes an addition or replacement opening.

A later failure can persist:

```ts
active: true
lifecycle: "activation_failed"
```

`getActiveEntries()` filters only on `active`. Startup loads these entries as active, then deliberately skips `activation_failed` entries.

### Reproduction

1. Configure one automatic active slot.
2. Return a qualified candidate.
3. Let thread preparation succeed.
4. Fail level seeding, snapshot posting, monitor restart, or website publication after queueing.
5. Inspect selector and persisted state.
6. Restart the runtime.

### Expected

Only a fully monitor-ready and publication-ready ticker counts as active. Terminal failure leaves it inactive or quarantined and preserves the opening.

### Actual

The ticker counts as active immediately after queueing. A failed ticker can survive restart as active but skipped.

### Impact

- unusable tickers consume slots and daily limits;
- selector and monitor state diverge;
- website state can disagree with runtime readiness;
- restart does not restore the invariant.

### Required fix

Use an explicit activation transaction, for example:

```text
reserved
-> queued
-> seeding
-> snapshot_ready
-> monitor_ready
-> publish_acknowledged
-> active
```

Only the final state counts toward the active ceiling. Terminal failure must set `active: false` while preserving audit history.

### Required regression tests

- queue acknowledgement is not readiness;
- failure at each activation stage restores the slot;
- failed state is reconciled after restart;
- crash between activation stages is recoverable.

---

## P1-03 — Active-slot ceilings are not transactionally enforced

**Classification:** Confirmed defect  
**Area:** Replacement lifecycle  
**Primary file:** `src/lib/auto-watchlist/auto-watchlist-selector.ts`  
**Evidence:** around lines `2352-2448`

### Evidence

Normal and obvious-runner replacement paths activate the challenger before deactivating the incumbent.

If incumbent deactivation fails, the code tries to deactivate the challenger. If that rollback also fails, both can remain active. Updating the selector’s internal challenger state to standby does not prove the runtime stopped monitoring or publishing it.

Even in the normal success path there is a transient interval above the configured ceiling.

### Reproduction

1. Set `maxActiveMainSessionTickers = 1`.
2. Start with `OLD` active.
3. Produce qualified `NEW`.
4. Let `queueActivation(NEW)` return.
5. Fail `deactivateSymbol(OLD)`.
6. Fail rollback `deactivateSymbol(NEW)`.

### Expected

The active count never exceeds one, and the transition aborts safely.

### Actual

Both symbols may remain runtime-active.

### Impact

- slot limit becomes advisory;
- live-provider capacity can be exceeded;
- website and Discord may receive an unintended ticker;
- selector state can be false relative to runtime state.

### Required fix

Use a two-phase replacement:

1. reserve and prepare challenger without exposing it as active;
2. verify levels/thread/readiness;
3. retire incumbent;
4. commit challenger activation;
5. persist one transition revision;
6. reconcile both sides after any failure.

### Required regression tests

- maximum concurrent count during replacement;
- incumbent retirement failure;
- challenger rollback failure;
- crash between prepare and commit.

---

## P1-04 — Older website ticker patches can overwrite newer state

**Classification:** Confirmed defect  
**Area:** Production market-data integrity  
**Production files:**

- `src/lib/live-watchlist/live-watchlist-store.ts`, around `572-610`
- `app/api/live-watchlist/ingest/route.ts`, around `104-176`

### Evidence

`tickerData` patches unconditionally replace:

- latest price;
- nearest support and resistance;
- level map;
- volume;
- extended quote.

There is no comparison between incoming source time and stored market-data time. The general symbol `updatedAt` cannot guard ordering because ticker updates deliberately retain `existing.updatedAt`.

The ingest route validates shape, writes state, and broadcasts it without monotonic source-time or revision enforcement.

### Reproduction

1. Ingest `ABC` at `T+1` with price `$3.00` and current levels.
2. Deliver a delayed retry at `T` with price `$2.50` and older levels.
3. Read API state or observe SSE.

### Expected

The older patch is rejected or retained only as audit history.

### Actual

The state can regress to the older quote and level map.

### Impact

Reconnects, retries, and concurrent publishers can make quote, cards, levels, and status refer to different revisions.

### Required fix

Add fields such as:

```text
marketDataObservedAt
marketDataRevision
publisherInstanceId
sourceSequence
```

Enforce compare-and-set in the persistence mutation:

```text
accept when observedAt is newer
or when observedAt is equal and revision is higher
```

### Required regression tests

- newer then older patch;
- equal timestamp, lower revision;
- equal timestamp, higher revision;
- reconnect retry ordering;
- concurrent Neon writers.

---

## P1-05 — `stale` is intentionally presented as live `ON`

**Classification:** Confirmed specification defect  
**Area:** Data-status truthfulness  
**Files:**

- Production `src/lib/live-watchlist/live-watchlist-labels.ts`, around `6-48`
- `src/runtime/manual-watchlist-server.ts`, around `385-444`

### Evidence

Production maps both `live` and `stale` to:

```text
Live Data: ON
Live Ticker Data: On
live visual tone
```

Tests explicitly encode this behavior.

The runtime health publisher uses:

```ts
marketDataUpdatedAt: Date.now()
```

on each heartbeat, including when the feed is stale. This is the health-publish time, not the last usable trade time.

### Reproduction

1. Receive one EODHD trade.
2. Stop receiving trades until the feed is stale.
3. Keep the runtime and health timer alive.
4. Observe badge and timestamp.

### Expected

Show `STALE`, warning tone, and the actual last usable market-event time.

### Actual

Show `ON`, while the health timestamp continues advancing.

### Impact

A trader cannot distinguish streaming data from stale data.

### Required fix

Expose distinct states:

- `STARTING` — no usable stream established;
- `ON` — recent source-backed trade;
- `STALE` — provider exists but the last usable trade is old;
- `OFF` — provider unavailable or runtime failed/stopped.

Separate `healthPublishedAt` from `lastTradeAt`, preferably per symbol.

### Required regression tests

- starting with no trade;
- live after recent trade;
- stale after threshold;
- offline after provider failure;
- one fresh and one stale symbol.

---

## P1-06 — Terminal website publication failure is swallowed

**Classification:** Confirmed defect  
**Area:** Publication acknowledgement  
**Primary file:** `src/lib/live-watchlist/live-watchlist-publisher.ts`, around `1986-2074`

### Evidence

After retry exhaustion, `publishPayload()` calls `onError`. It throws only if no callback exists. The environment factory always installs an `onError` callback, so production callers see a resolved promise after a terminal failure.

AI Read awaits that resolved promise and then advances local refresh state. It can suppress future generation even though production never received the read.

### Reproduction

1. Make production ingest return `500` or time out for every retry.
2. Trigger ticker, status, visibility, or AI Read publication.
3. Observe caller state after retry exhaustion.

### Expected

Caller receives a rejection and retains retryable publish-pending state.

### Actual

A warning is logged and callers continue as though publication succeeded.

### Impact

- runtime and website diverge;
- AI freshness state advances on an unpublished read;
- activation may appear complete without public state;
- no durable reconciliation record remains.

### Required fix

- always reject terminal failure;
- let callbacks report but not consume failure;
- persist an outbox with payload revision and retry state;
- advance local publish state only after exact-revision acknowledgement.

### Required regression tests

- exhausted retries reject;
- AI state does not advance on failure;
- outbox replay after recovery;
- replay idempotency.

---

## P1-07 — Failed OpenAI request attempts are absent from cost reporting

**Classification:** Confirmed defect  
**Area:** AI grounding and cost  
**Files:**

- `src/lib/ai/traderslink-ai-read-service.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`, around AI generation and record call
- `src/lib/ai/traderslink-ai-read-cost-ledger.ts`, around `178-221`

### Evidence

The service can issue:

- a primary Responses API call;
- a correction call after validation failure;
- a fallback-model call for model/access errors.

If the final read remains invalid, `generate()` throws before returning usage. The runtime records only after successful generation.

The ledger also catches append errors and only logs a warning.

### Reproduction

1. Return a paid primary response with invalid tactical ordering.
2. Return a paid correction response that is also invalid.
3. Let generation throw.
4. Inspect per-request, per-ticker, token, and search summaries.

### Expected

Two failed attempt records with all usage and search calls.

### Actual

No record is written.

### Impact

Request count, per-ticker cost, tokens, web-search calls, model totals, and total spend can all be understated.

### Required fix

Record one immutable event immediately after every API response, including:

```text
requestId
generationId
symbol
attemptType: primary | correction | fallback
status: success | invalid_output | transport_error | publish_error
model
trigger
inputTokens
cachedInputTokens
outputTokens
totalTokens
webSearchCallCount
tokenCostUsd
webSearchCostUsd
receivedAt
```

### Required regression tests

- primary invalid output;
- primary plus correction failure;
- fallback-model attempt;
- publication failure after valid generation;
- ledger write failure.

---

# P2 — Material defects and design risks

## P2-01 — Stale screener market cap wins over fresher enrichment

**Classification:** Confirmed defect  
**File:** `src/lib/auto-watchlist/auto-watchlist-selector.ts`, around `2019-2043`

Candidate enrichment uses the first non-null value:

```ts
candidate.marketCap ?? yahoo.marketCap ?? finnhub.marketCapitalization
```

A stale `$80M` screener cap can override a current `$500M` enrichment value and allow an oversized issuer to qualify.

**Fix:** resolve conflicts by source authority and freshness, or reject conflicting data.

---

## P2-02 — Session classification has no exchange calendar

**Classification:** Design risk  
**Files:** automatic selector and `src/lib/market-data/candle-session-classifier.ts`

Weekdays are classified only by Eastern clock ranges. Holidays and early closes are not modeled.

**Fix:** use a US exchange calendar with early-close and holiday fixtures.

---

## P2-03 — Ticker-only quote changes retain an old display timestamp

**Classification:** Confirmed specification defect  
**Production file:** `src/lib/live-watchlist/live-watchlist-store.ts`, around `579-607`

Price and level state can change while `updatedAt` remains the older card timestamp. Existing tests expect this.

**Fix:** separate `cardUpdatedAt`, `marketDataObservedAt`, `stateUpdatedAt`, and `healthPublishedAt`.

---

## P2-04 — A 24-hour-old five-minute close can be represented as current

**Classification:** Confirmed defect  
**File:** `src/lib/ai/traderslink-ai-read-price-action.ts`, around `181-218`

A candle up to 24 hours old is accepted. Its close becomes the reference price, but `dataAsOf` is replaced by `context.fetchedAt`.

**Fix:** preserve the bar timestamp and apply session-aware freshness limits.

---

## P2-05 — Targets and downside checkpoints can still be mechanical ladder steps

**Classification:** Confirmed validation gap  
**File:** `src/lib/ai/traderslink-ai-read-service.ts`, tactical map assertion around `695-786`

Observable tape evidence is required for the five primary boundaries, but targets/checkpoints are checked only for numeric order. Fixed 0.5% tolerance is not observed-volatility spacing.

**Fix:** require tape evidence and ATR/range-aware spacing for every target and checkpoint.

---

## P2-06 — AI Read refresh is not boundary-only

**Classification:** Confirmed contract mismatch  
**File:** `src/lib/monitoring/manual-watchlist-runtime-manager.ts`, around `236-294` and the AI state update

A 60-minute timer can refresh inside an unchanged map. State tracks only the highest upside and lowest downside edge, not every meaningful boundary or invalidation.

**Fix:** persist a structural fingerprint and explicit material-change reasons. Remove time-only refresh if the required policy is boundary/invalidation-only.

---

## P2-07 — URL membership does not prove claim support

**Classification:** Design/enforcement risk  
**File:** `src/lib/ai/traderslink-ai-read-service.ts`, source URL normalization around `423-445`

A real URL can be cited even when it does not support the model’s catalyst, dilution, issuance, resale, or listing conclusion.

**Fix:** attach structured claim evidence: source type, filed/published date, supporting parsed fact or excerpt, retrieval time, and supersession check.

---

## P2-08 — Combined `totalTokens` can be understated

**Classification:** Confirmed accounting defect  
**File:** AI service combined usage construction

If one attempt reports input/output components but omits `total_tokens`, the aggregate can be non-zero yet lower than combined input plus output.

**Fix:** reconcile total from components when any attempt lacks a trustworthy total.

---

## P2-09 — Global Trader Read and Potential Gain toggles do not persist across restart

**Classification:** Confirmed persistence defect  
**File:** `src/lib/monitoring/manual-watchlist-runtime-manager.ts`

Setters change in-memory fields and republish cards but do not persist settings. Per-ticker AI Read visibility is persisted; the two global controls are not.

---

## P2-10 — EventSource delivery is process-local

**Classification:** Design risk  
**Production files:**

- `src/lib/live-watchlist/live-watchlist-events.ts`
- `app/watchlist/live-watchlist-client.tsx`

Subscribers live in a module-level map. In a multi-instance deployment, ingest on instance A cannot broadcast to a stream connected to B. Five-second polling eventually converges but provides no durable event ordering or gap recovery.

**Fix:** use durable pub/sub or revision-based reconciliation with event IDs.

---

## P2-11 — The five-symbol AI baseline is not source-reproducible

**Classification:** Auditability risk  
**Related document:** `docs/95_LEVELS_SYSTEM_15M_FACTS_REAL_CACHE_VALIDATION.md`

The representative symbols are documented, but raw immutable candle inputs were not committed. A reviewer cannot reproduce the exact plans from source and hashes alone.

**Fix:** create a sanitized deterministic fixture pack.

---

# P3 — Lower-severity findings

## P3-01 — Common-equity classification remains heuristic

**Classification:** Design risk  
**File:** `src/lib/review/nasdaq-marketcap-universe.ts`, around `152-176` and `214-230`

The classifier blocks obvious warrants, rights, units, preferreds, notes, ETFs, ETNs, funds, and trusts. A structured or non-operating security without one of those strings can still pass.

**Fix:** use authoritative instrument/security-master type.

## P3-02 — Corrupt cost-ledger lines are silently dropped

**Classification:** Confirmed lower-severity defect  
**File:** `src/lib/ai/traderslink-ai-read-cost-ledger.ts`, around `202-221`

Invalid JSONL records are ignored without a corrupt-record count, offset, or health failure.

---

# Confirmed positive controls

## Market qualification

The selector explicitly rejects:

- unavailable recent activity when required;
- stale latest trade;
- insufficient last-15-minute dollar volume;
- out-of-range price;
- unknown or excessive market cap;
- insufficient gain, volume, or dollar volume;
- unavailable share data when required;
- excessive float or outstanding shares.

Default automatic limits are approximately:

- `$100M` market cap;
- `50M` float;
- `60M` outstanding shares;
- separate premarket, regular, and post-market activity thresholds;
- separate main-session and post-market active ceilings.

## Lifecycle

The normal fill path does not force a quota; it fills only from qualified candidates. Existing tests cover ordinary standby transitions, unfilled replacement openings, persistence across selector restart, later replacement, and manual entries outside automatic slot limits.

Manual reactivation of an automatic symbol changes it to manual protection.

Selector settings, managed entries, and replacement history are persisted with a temporary-file rename pattern.

## AI prompt contract

The prompt correctly tells the model to:

- derive the plan from raw OHLCV rather than the application ladder;
- use premarket, regular, and post-market action;
- weight prior regular sessions and daily candles;
- treat the runtime quote as secondary when conflicting;
- distinguish must-clear from breakout continuation;
- cite observable tape evidence;
- avoid fabricated symmetric ladders;
- separate catalyst, dilution, and listing analysis;
- separate issuance from public resale;
- avoid unsupported immediate-delisting claims.

The release problem is incomplete runtime enforcement, not the prompt’s stated intent.

## External research disabled

Web search can be disabled while retaining the price-action plan. The production card can hide catalyst, dilution, listing, and source sections without removing the tactical map.

## Admin controls

The admin markup retains controls for manual activation, Discord cleanup, removal by group, global card visibility, automatic selector settings, provider selection, provider health, artifacts, and activity. AI controls are additive.

---

# Independent five-symbol AI Read baseline

## Scope warning

All five audited symbols predate the latest watchlist and AI Trader Read changes. These plans are historical independent QA baselines and are not a current implementation pass.

No paid model call was made, and immutable raw candle packets were not available in the repository.

## DEVS — no normal active-Nasdaq plan

An official filing indicated Nasdaq suspension was scheduled for 2026-06-24 and the appeal did not stay suspension.

Professional conclusion:

- Needs to hold: `null`
- Caution below: `null`
- Momentum failure: `null`
- Must clear: `null`
- Breakout continuation: `null`
- Targets: none
- Downside checkpoints: none

The system should first verify active venue, executable quote, bid/ask, current symbol, and current volume. A normal active-Nasdaq momentum card would be an eligibility defect.

## ENVX — failed bounce unless upper range is reclaimed

Audit context was approximately price `$4.65`, open `$4.57`, range `$4.55-$4.785`, prior close near `$4.70`, below short-term EMA context.

- Needs to hold: `$4.57`
- Caution below: `$4.55`
- Momentum failure: approximately `$4.40`
- Must clear: `$4.79`
- Breakout continuation: `$4.99-$5.03`
- Upside checkpoints: `$5.11`, `$5.21`, `$5.35-$5.50`
- Downside checkpoints: `$4.55`, `$4.40`, approximately `$4.20`
- VWAP requirement: reclaim and hold; below VWAP remains low confidence.

## QUBT — below trend; prior-day ceiling is the meaningful confirmation

Audit context was approximately price `$7.65`, open `$7.47`, range `$7.41-$7.74`, prior close `$7.64`, preceding regular high near `$8.00`, below short-term EMA context.

- Needs to hold: `$7.64`
- Caution below: `$7.54`
- Momentum failure: `$7.41`
- Must clear: `$7.74`
- Breakout continuation: `$8.00`
- Upside checkpoints: approximately `$8.32`, `$8.50`, `$8.75-$9.00`
- Downside checkpoints: `$7.54`, `$7.41`, `$7.20`, `$7.00`
- VWAP requirement: a breakout without VWAP support and volume expansion is only a range probe.

QUBT was far above default automatic small-cap market-cap/share ceilings and should be manual-only under default policy.

## DXYZ — manual-only closed-end vehicle

Audit context was approximately price `$25.61`, open `$25.70`, range `$25.12-$26.02`, prior close `$27.15`, recent highs near `$27.69` and `$28.30`.

- Needs to hold: `$25.12`
- Caution below: approximately `$25.00`
- Momentum failure: `$24.60`
- Must clear: `$26.02`
- Breakout continuation: `$26.51`
- Upside checkpoints: `$27.15`, `$27.69`, `$28.30`
- Downside checkpoints: `$25.12`, `$24.60`, `$24.25`, `$23.98`
- VWAP requirement: reclaim VWAP and hold above `$26.02`.

DXYZ is a closed-end management investment vehicle and should not be admitted by a Nasdaq operating-company small-cap selector.

## GME — range-bound; acceptance above the pivot/EMA cluster matters

Audit context was approximately price `$21.92`, open `$21.86`, range `$21.67-$22.00`, prior close `$21.92`, recent highs near `$22.51`, `$22.62`, `$22.89`, and `$23.11`.

- Needs to hold: `$21.86`
- Caution below: `$21.67`
- Momentum failure: `$21.53`
- Must clear: `$22.00`
- Breakout continuation: `$22.26-$22.30`
- Upside checkpoints: `$22.51-$22.62`, `$22.89`, `$23.11`
- Downside checkpoints: `$21.67`, `$21.53`, `$21.17`, `$20.93`
- VWAP requirement: an isolated move above `$22.00` is not continuation without VWAP and `$22.26-$22.30` acceptance.

GME is far above the default automatic small-cap limits and should be rejected automatically while remaining eligible for manual testing.

---

# Mandatory post-change AI Read re-audit

## Minimum symbol mix

Use at least five symbols added or regenerated after the latest AI Read changes, preferably including:

- a premarket runner;
- a regular-hours runner;
- a post-market runner;
- a failed momentum setup;
- an instrument that should be rejected or unavailable;
- both sub-dollar and above-dollar prices when practical.

## Capture for each symbol

- instrument type and exchange;
- activation and generation times;
- quote source and actual source timestamp;
- full five-minute premarket, regular, and post-market candles;
- prior regular-session candles;
- recent daily candles;
- volume, VWAP, and EMA inputs;
- application AI Read payload;
- research-enabled flag;
- cited sources and content hashes;
- every API-attempt usage record if paid generation is authorized;
- website publication revision and acknowledgement;
- independent QA plan.

## Compare

- needs-to-hold;
- caution-below;
- momentum-failure;
- must-clear;
- breakout-continuation;
- upside targets;
- downside checkpoints;
- volatility-relative spacing;
- rationale evidence;
- ladder-step similarity;
- quote freshness/disagreement;
- catalyst grounding;
- dilution timing grounding;
- listing grounding;
- refresh trigger;
- request-attempt and total cost accounting.

## Pass criteria

A symbol passes only when:

- each non-null boundary has observable price-action evidence;
- ordering is correct;
- spacing is defensible for observed volatility;
- targets are not a mechanical walk through detected levels;
- stale/conflicting data blocks generation or reduces confidence;
- research claims are supported by evidence, not just a URL;
- website state matches the generated revision;
- all request attempts are included in the ledger.

---

# Required regression suite

## Discovery

1. Mover absent from bulk screener.
2. New listing or renamed symbol.
3. Fetch time cannot masquerade as trade time.
4. Conflicting screener and current market cap.
5. Common, warrant, unit, right, preferred, ETF, closed-end fund, OTC, suspended, renamed, and delisted matrix.
6. Holiday, early close, weekend, and DST session cases.

## Lifecycle

7. Queued activation is not active.
8. Failure at each activation stage restores the opening.
9. Terminal failure becomes inactive/quarantined.
10. Restart reconciles pending and failed activation.
11. Maximum concurrent active count during replacement.
12. Dual rollback failure.
13. Manual protection across restart.
14. Existing unfilled replacement-opening test remains.

## Market data and publishing

15. Newer patch followed by older patch.
16. Same timestamp with lower/equal/higher revision.
17. Startup cache, first live quote, disconnect, reconnect, and delayed retry maintain one coherent revision.
18. Per-symbol stale state.
19. Truthful `STARTING`, `ON`, `STALE`, and `OFF` labels.
20. Terminal publisher failure rejects.
21. Durable outbox replay and idempotency.
22. Multi-instance EventSource or revision-gap recovery.

## AI Read

23. Target rationale must cite tape evidence.
24. Downside checkpoint rationale must cite tape evidence.
25. Volatility-aware spacing rejects adjacent mechanical targets.
26. Every meaningful primary/intermediate boundary crossing is represented.
27. No time-only refresh under a boundary-only policy.
28. Stale candle retains actual timestamp and blocks/lowers confidence.
29. Quote disagreement lowers confidence.
30. Source URL that does not support the claim is rejected/downgraded.
31. Research disabled produces zero web-search calls and preserves the tactical plan.
32. Post-change five-symbol fixture audit.

## Cost

33. Primary invalid response still records usage.
34. Primary plus correction failure records both attempts.
35. Fallback model records each attempt/model.
36. Missing `total_tokens` is reconciled from components.
37. Publish failure retains generation cost.
38. Ledger write failure exposes accounting health.
39. Corrupt JSONL line is counted and reported.

## Admin and production UI

40. Global visibility toggles survive restart.
41. Every existing admin control ID and handler remains present.
42. EventSource reconnect recovers missed revisions.
43. Logged-out, non-premium, premium, unknown-symbol, and deactivated-symbol detail access.
44. Card visibility and settings persistence after runtime restart.

---

# Recommended Codex work order

## Phase 0 — Reconfirm against current HEAD

- Read this report fully.
- Compare current code with both pinned audited commits.
- Re-resolve file and line evidence.
- Mark findings still present, fixed, changed, or not reproducible.
- Do not dismiss a finding merely because code moved.

## Phase 1 — Failing P1 tests first

1. independent mover discovery;
2. activation-readiness transaction;
3. hard slot-ceiling invariant;
4. monotonic production state;
5. truthful stale status;
6. publication-failure propagation;
7. per-attempt AI cost accounting.

## Phase 2 — Fix transaction and timestamp invariants

Prefer:

- explicit state machines;
- source timestamps;
- immutable revisions;
- compare-and-set persistence;
- durable outboxes;
- deterministic reconciliation.

Do not add loosely coordinated booleans to mask transaction problems.

## Phase 3 — Harden the AI Read

This is the highest product priority after P1 data/lifecycle safety:

- preserve true candle times;
- enforce target and checkpoint evidence;
- use observed volatility for spacing;
- prove outputs are not ladder stepping;
- track every meaningful boundary;
- align refresh policy to material invalidation;
- validate claim-to-source support;
- retain the tactical plan with research disabled;
- record every paid attempt.

## Phase 4 — Perform the new post-change five-symbol audit

Do not use the historical sample as proof of current quality. Use deterministic fixtures or stored post-change reads unless paid calls are explicitly authorized.

## Phase 5 — Update this document

For each finding append:

- status;
- resolution commit;
- tests and commands;
- test result;
- residual risk;
- post-change AI audit evidence;
- revised release verdict.

---

# Definition of done

The system is not ready until:

- every still-present P1 has a failing-before/passing-after regression test;
- queueing does not count as active;
- failed activations cannot remain active and skipped;
- active-slot ceilings hold at every intermediate state;
- current movers are independently discoverable;
- market-data writes are monotonic and revisioned;
- quote, card, state, and health timestamps have distinct meanings;
- stale data is visibly stale;
- terminal publication failure propagates and is retryable;
- every OpenAI attempt is accounted for;
- all tactical targets/checkpoints are evidence-validated;
- refresh policy matches documented material boundaries;
- global UI visibility settings survive restart;
- a reproducible post-change five-symbol AI audit passes;
- authenticated staging or authorized production UI behavior is verified.

---

# Updated release verdict

## Watchlist

**CODE REMEDIATION COMPLETE; AUTHENTICATED PRODUCTION VERIFICATION REMAINS.** The original P1 findings and the remaining calendar, automatic-security-master, and cross-instance reconciliation code paths are regression-covered. Production still requires the website branch to be merged/deployed through the guarded site flow and an authorized signed-in watchlist/detail and recovery smoke test.

## TradersLink AI Read

**CODE-LEVEL POST-CHANGE GATE PASSED; NOT YET A LIVE-PRODUCTION QUALITY PASS.** The required five-symbol reproducible audit now passes without paid generation, and the tactical-map, stale-price, quote-conflict, source-topic, publication, refresh, cost, evidence-metadata, and automatic-security protections are regression-covered. The remaining limitation is that the fixture uses deterministic mocked model drafts; it does not replace an operator-authorized paid/live sampled-model review or authenticated production card verification.

---

# Codex handoff prompt

```text
Work in the GitHub repository traderslink-bot/levels-system.

Use this exact audit branch:
agent/traderslink-watchlist-ai-read-audit-0329014

Read this file before changing code:
docs/TRADERSLINK_WATCHLIST_AI_READ_QA_AUDIT_2026-07-17.md

The report is pinned to levels-system commit 032901436a03429af61db25f1b5627a517d1e190. It also audits traderslink-bot/traderslink-trader-improvement-system production main commit 982ce080b375d130406121c587f269fde5181f62.

Critical AI caveat:
The five tickers independently reviewed in the report were added before the most recent watchlist and AI Trader Read changes. Their plans are a historical QA baseline, not validation of the current AI Read. The AI Trader Read is the most important part of this work. Do not declare it fixed or release-ready until you complete a reproducible audit of at least five symbols added or regenerated after the latest changes. Use deterministic fixtures, archived post-change payloads, or already-stored reads. Do not make paid OpenAI requests unless the operator separately and explicitly authorizes them.

Safety constraints:
- Do not deploy.
- Do not restart production services.
- Do not merge.
- Do not mutate production data or the live watchlist.
- Do not place trades.
- Do not make paid OpenAI calls.
- Work on a dedicated branch and create reviewable commits/tests only.

Tasks:
1. Re-resolve every finding against current HEAD because files and line numbers may have moved.
2. Build a P0-P3 tracking table with exact current file/line evidence and status: present, fixed, changed, or not reproducible.
3. Add failing tests for every still-present P1 before changing production code.
4. Fix P1 findings in this order unless a demonstrated dependency requires another sequence:
   a. independent current-mover discovery and true quote-time provenance;
   b. activation transaction so queued is not active;
   c. transactional slot ceilings and rollback reconciliation;
   d. monotonic/revisioned production ticker-data ingest;
   e. truthful STARTING/ON/STALE/OFF status based on the last usable trade;
   f. terminal publication failure propagation and durable retry;
   g. per-API-attempt AI cost accounting for primary, correction, fallback, invalid, and publish-failure cases.
5. Then prioritize AI Read hardening:
   - preserve actual candle timestamps and reject or clearly mark stale packets;
   - require observable tape evidence for targets and downside checkpoints;
   - use ATR/range/observed volatility for meaningful spacing;
   - prove targets are not adjacent support/resistance ladder entries;
   - track needs-to-hold, caution, failure, must-clear, continuation, each target, and each checkpoint;
   - remove time-only refresh if the required policy is boundary/invalidation-only, or document/test any explicit exception;
   - require claim-to-source support for catalyst, dilution, listing, SEC, and web-search conclusions;
   - keep the full tactical plan working when external research is disabled;
   - record every request attempt and reconcile total tokens from component usage.
6. Add persistence tests/fixes for global Trader Read and Potential Gain visibility controls.
7. Add multi-instance or revision-gap EventSource/polling coverage.
8. Create a sanitized post-change five-symbol AI fixture pack with full-session 5-minute candles, recent daily candles, quote source timestamps, generated payloads, source evidence, usage records, and independent expected ranges.
9. Run focused tests, relevant full test suites, and TypeScript checks.
10. Update the audit document with resolution commits, test commands/results, remaining risks, post-change symbol evidence, and a new release verdict.

Engineering expectations:
- Prefer explicit state machines, immutable revisions, source timestamps, compare-and-set writes, and durable outboxes.
- Never represent fetch time as trade time.
- Never advance local publish or AI refresh state without acknowledgement of the same production revision.
- Keep manual tickers protected.
- Treat active limits as hard ceilings throughout a transition, not only eventual counts.
- Keep AI fields null when the tape does not establish a defensible boundary.
- Do not claim current AI Read quality passes until the new post-change five-symbol audit is complete.

Deliver:
- dedicated-branch commits;
- exact changed files;
- tests added and commands/results;
- updated P0-P3 matrix;
- post-change five-symbol AI audit artifacts;
- explicit remaining limitations;
- final watchlist and AI Read release verdict;
- no deployment or merge.
```
