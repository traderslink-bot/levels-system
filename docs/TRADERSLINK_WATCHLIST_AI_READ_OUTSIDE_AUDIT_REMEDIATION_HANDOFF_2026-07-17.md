# Outside-Audit Remediation Handoff — TradersLink Watchlist and AI Read

**Purpose:** This is the review handoff for the outside AI that authored or reviewed the original watchlist / TradersLink AI Read QA audit. It maps the audit findings to the implemented changes, commits, test evidence, and production rollout evidence so the reviewer can independently validate the remediation.

**Date:** 2026-07-17  
**Levels repository:** `traderslink-bot/levels-system`  
**Review branch:** `codex/watchlist-ai-audit-remediation-20260717`  
**Latest remediation commit:** `690593ea1bbb8ea0317d46b56d97c291438f99c5`  
**Prior rollout-evidence commit:** `247533e8c43f9551e1c7a1b0c497e5cb10e3f81f`  
**Website repository:** `traderslink-bot/traderslink-trader-improvement-system`  
**Website production merge:** PR [#99](https://github.com/traderslink-bot/traderslink-trader-improvement-system/pull/99), merge commit `a1258406b0e0d4b6cdaa04b9ff8e302b4810bc1b`

## How to use this handoff

1. Check out the Levels review branch above, not an older audit snapshot or an unrelated local worktree.
2. Read the original external audit first: `docs/TRADERSLINK_WATCHLIST_AI_READ_QA_AUDIT_2026-07-17.md`.
3. Use this file as the finding-to-change index; then inspect the named commits, source files, and tests directly.
4. Treat the deterministic test and fixture evidence as code-level validation. Do not treat it as proof that a new paid live-model sample is perfect.
5. Review the website PR #99 in the separate website repository because P1-04, P1-05, P2-03, and P2-10 cross the runtime/website contract boundary.

## Release result at handoff

- The cost-control release was deployed before this remediation work: default model `gpt-5.6-luna`, medium reasoning, external research off, and an optional persisted daily spend guard.
- The final Levels code was fast-forwarded into the source checkout used by the Desktop `Levels System Long Run Test.bat` launcher and the runtime was restarted.
- Website PR #99 passed CI, merged, and was deployed to `https://traderslink.pro` from clean `main`.
- The final local runtime reported `startupState: ready`, three active tickers, `gpt-5.6-luna`, medium reasoning, external research disabled, daily spend guard disabled, and EODHD common-stock verification available.
- An authenticated live watchlist browser smoke check showed three current ticker rows and `Live Data: ON`. BIYA's detail page rendered the TradersLink AI Read card with the full trade-plan contract.
- No new paid OpenAI request was made solely to satisfy this audit handoff.
- The branch CI was repaired after this handoff was first recorded: GitHub Actions run `29607694169` passed on `690593e`. The repair makes a forward-validation case inconclusive when neither output was tested by price, aligns stale level-map fixtures with the current bounded Path-card contract, and covers the persisted refresh-regime field.

## Change sets

| Commit | Purpose |
|---|---|
| `17463f4` | Pins the outside-audit record and starts the remediation trail. |
| `835c9e1` | Lifecycle correctness, active-slot ceiling, publisher/outbox behavior, data truthfulness, AI tactical validation, boundary refresh dedupe, and persisted visibility controls. |
| `a5d8bde` | Sanitized reproducible five-symbol AI Read fixture audit and cost-ledger hardening. |
| `e6e1198` | Records remediation evidence. |
| `e68a118` | Lowers AI Read operating cost, adds spend guard, and removes time-only regeneration. |
| `909ca46` | Adds a shared U.S. equity exchange calendar for scanner, candle classification, AI Read, and grouping. |
| `d298e32` | Adds source-evidence metadata and EODHD common-stock verification for automatic selections. |
| `061db96` | Completes audit tracking and makes synthetic test sessions honor trading days. |
| `247533e` | Records the completed website/runtime rollout, real-provider preview, and authenticated smoke-check evidence. |
| `690593e` | Repairs the audit-branch CI regressions and records the current forward-validation, Path-card, and refresh-regime test contract. |

## Finding-by-finding remediation map

| Original finding | Result | Implementation evidence | Reviewer focus / residual limit |
|---|---|---|---|
| P1-01 — independent current movers | Fixed | `835c9e1`; `src/lib/auto-watchlist/auto-watchlist-selector.ts` now accepts current mover rows independently of stale bulk-screener membership and preserves quote provenance. | Confirm mover-only regression tests and fail-closed behavior when authoritative equity classification is unavailable. |
| P1-02 — activation readiness | Fixed | `835c9e1`; `src/lib/monitoring/manual-watchlist-runtime-manager.ts` keeps queued/failed entries out of the active state until snapshot, monitor, and required website acknowledgement complete. | Check lifecycle/restart tests. Final smoke check showed a ready runtime with three active entries. |
| P1-03 — hard active ceiling | Fixed | `835c9e1`; automatic replacement retires an incumbent before activating a challenger, with rollback/interruption coverage. | Verify manual entries remain protected and no replacement path can temporarily exceed the ceiling. |
| P1-04 — monotonic website state | Fixed | Website commits `90914a89` and `9e23a242`; `src/lib/live-watchlist/live-watchlist-reconciliation.ts` and `app/watchlist/live-watchlist-client.tsx` order state by revision, observed market time, then update time. | Review website PR #99. Stream is a latency hint; canonical polling is the recovery path. |
| P1-05 — truthful feed state | Fixed | Levels `835c9e1`; website `90914a89`; last trade/observation time is separated from heartbeat/status time. | Final authenticated index showed `Live Data: ON` and current timestamps. Provider outages can still make data stale, which is now labeled rather than masked. |
| P1-06 — publication acknowledgement / outbox | Fixed | `835c9e1`; `src/lib/live-watchlist/live-watchlist-publish-outbox.ts` and publisher paths preserve ordered retry behavior and reject terminal publication failures. | A real authenticated health publish returned HTTP 200 after the website deploy; verify durable outbox tests for full recovery behavior. |
| P1-07 — per-attempt cost accounting | Fixed | `835c9e1`, `a5d8bde`; `src/lib/ai/traderslink-ai-read-cost-ledger.ts` records primary, correction, fallback, error, and corrupt-ledger cases. | Ledger is an estimate and the OpenAI invoice remains billing authority. |
| P2-01 — market-cap authority | Fixed | `835c9e1`, `a5d8bde`; fresh Yahoo/Finnhub enrichment wins over stale discovery market cap. | Missing/disagreeing current enrichment is rejected rather than represented as known. |
| P2-02 — exchange calendar | Fixed | `909ca46`; `src/lib/market-data/us-equity-exchange-calendar.ts` is shared by candle session classification, selector sessions, AI Read session labeling, and entry grouping. | Verify recurring holidays, special 2025 closure, early closes, and the weekend-safe synthetic simulation change in `061db96`. Future exceptional closures require explicit additions. |
| P2-03 — ticker display timestamp | Fixed | Website `90914a89`; stored market observation/revision is distinct from write/update time. | Inspect website store tests and the production index/detail timestamp behavior. |
| P2-04 — stale five-minute price | Fixed | `835c9e1`; AI Read preserves source candle timestamps and falls back to a current runtime quote when a five-minute close is stale. | Still dependent on provider availability, but stale candle data must no longer masquerade as a current quote. |
| P2-05 — mechanical targets / checkpoints | Fixed | `835c9e1`; `src/lib/ai/traderslink-ai-read-service.ts` validates tape rationale, boundary order, and ATR/range-aware spacing. | This validates contract quality; it does not guarantee discretionary trading outcomes. |
| P2-06 — time-only refresh | Fixed | `835c9e1`; elapsed time alone cannot request another read while price remains inside the served tactical map. Boundary/regime tracking prevents repeat whipsaw duplication. | A major structural development without a price boundary cross is not independently detected yet. |
| P2-07 — claim-to-source support | Changed and bounded | `d298e32`; `src/lib/live-watchlist/live-watchlist-types.ts` and `src/lib/ai/traderslink-ai-read-service.ts` preserve publication/filing/retrieval metadata, a visible excerpt/title kind, and supersession status. | Current press-release fallback is explicitly title-level evidence when no parsed excerpt exists. Parsed SEC filing excerpts remain an enhancement, not a fabricated claim source. |
| P2-08 — combined token totals | Fixed | `835c9e1`; missing provider `total_tokens` is reconstructed from input/output token components. | Provider usage can be delayed or absent. |
| P2-09 — global visibility persistence | Fixed | `835c9e1`; Trader Read and Potential Gain visibility settings persist/migrate through restart. | Verify persisted runtime settings tests and admin behavior. |
| P2-10 — multi-instance EventSource | Fixed for state correctness | Website `9e23a242`; stream ready/error triggers canonical refresh and late poll/stream data cannot overwrite a newer revision/observation. | It deliberately does not claim durable cross-instance pub/sub. |
| P2-11 — reproducible five-symbol audit | Fixed | `a5d8bde`; `src/tests/fixtures/traderslink-ai-read-post-change-fixtures.json` and its test contain sanitized full-session candle packets, expected tactical ranges, research evidence, and accounting records. | It is deterministic mocked-model evidence, not a newly paid five-ticker live-model sample. |
| P3-01 — common-equity classification | Fixed for automatic additions | `d298e32`; `src/lib/auto-watchlist/eodhd-common-stock-security-master.ts` caches EODHD U.S. `common_stock` records and blocks automatic activation if unavailable/unverified. | Manual additions remain operator-directed. Final Preview Scan: 50 candidates, 12 evaluated, 6 qualified, security master available/no error, no additions. |
| P3-02 — corrupt cost ledger | Fixed | `a5d8bde`; ledger summary reports corrupt-line count and accounting health rather than silently trusting bad bytes. | Corrupt historical bytes cannot be reconstructed automatically. |

## AI Read contract specifically reviewed

The remediation intentionally avoids using the application's support/resistance ladder as a mechanical sequence of AI targets. The AI service receives the complete eligible candle context and must return a trade-preparation map with:

- current-read narrative and bias;
- `needsToHold`;
- `cautionBelow`;
- `momentumFailure`;
- `mustClear`;
- `breakoutContinuation`;
- upside targets and downside checkpoints;
- each level's tape/price-action justification; and
- source-bounded research/catalyst/dilution/listing context when that context is present and supported.

Validation rejects malformed, non-ordered, mechanically spaced, or unexplained maps. Price-boundary refresh logic prevents redundant requests when price revisits an already-served regime. No hourly or time-only refresh remains.

## Cost-control review notes

The audit remediation did not compress the full price-action packet or reduce the response ceiling. Cost reduction instead comes from:

- defaulting new reads to `gpt-5.6-luna` with medium reasoning;
- retaining `gpt-5.6-terra` only as the configured compatibility fallback;
- disabling external research in the current live runtime (no OpenAI web-search calls in the ledger at handoff);
- eliminating time-only scheduled regeneration; and
- suppressing duplicate boundary/regime revisits.

The persisted optional daily spend guard remains disabled by operator choice. It can be enabled through Watchlist Admin without removing a current published card. At handoff, the same-day ledger still contained historical `gpt-5.6-terra` requests from before the cost-model switch; no new Luna request was forced merely to create audit evidence.

## Test and verification evidence

### Levels source verification

```text
npm run build
# pass

npx tsx --test --test-timeout=90000 src/tests/traderslink-ai-read-post-change-fixtures.test.ts
# pass

npx tsx --test --test-timeout=90000 \
  src/tests/traderslink-ai-read-cost-ledger.test.ts \
  src/tests/traderslink-ai-read-service.test.ts
# 15 pass, 0 fail

npx tsx --test --test-timeout=90000 \
  src/tests/us-equity-exchange-calendar.test.ts \
  src/tests/bulk-candle-import-simulation.test.ts
# 5 pass, 0 fail

npx tsx --test --test-timeout=90000 \
  src/tests/eodhd-common-stock-security-master.test.ts \
  src/tests/auto-watchlist-selector.test.ts
# 34 pass, 0 fail
```

### Website source verification

```text
npx tsc --noEmit
# pass

npx vitest run \
  src/lib/live-watchlist/__tests__/live-watchlist-reconciliation.test.ts \
  src/lib/live-watchlist/__tests__/traderslink-ai-read.test.ts
# 5 pass, 0 fail
```

The broader `npm run check` Levels run completed after the calendar-linked synthetic-session correction. The website's full Turbopack check had a worktree `node_modules` symlink-root limitation after its focused tests and TypeScript passed; CI for PR #99 then completed successfully before merge.

After the final CI-contract repair, the focused regression set passed 15/15, `npm run check` passed locally, and GitHub Actions run `29607694169` completed successfully on the review branch.

### Production/runtime verification

```text
Website PR #99 test-and-verify: SUCCESS
Website deployment: Ready, aliases include https://traderslink.pro
Runtime after final restart: startupState ready
Authenticated ingest health POST: HTTP 200
Authenticated index: 3 ticker rows, Live Data ON, current timestamps
BIYA detail: full TradersLink AI Read card rendered
Selector Preview Scan: 50 candidates / 12 evaluated / 6 qualified / 0 additions
```

## Important rollout sequencing note

The Levels runtime was initially restarted before the compatible website ingest deployment reached Ready. The prior website ingest contract returned HTTP 400. After the website deployment, an authenticated health patch returned HTTP 200 and the runtime was restarted cleanly; final runtime and UI smoke checks passed.

For future coordinated releases, deploy the compatible website ingest/store/client change first, wait until it is Ready, then restart the runtime that publishes the newer payload. This is a deployment-order compatibility requirement, not an unresolved runtime defect.

## Deliberately open items

These are not hidden remediation failures:

1. **Parsed SEC filing excerpts:** The current system truthfully labels title-only fallback evidence. Parsing and retaining filing excerpts would further strengthen claim-level grounding.
2. **New paid five-symbol live-model sample:** The committed fixture audit is repeatable and costs nothing. A fresh paid sample was intentionally not forced because the operator requested cost control. It requires separate approval if desired.
3. **Exchange exceptional closures:** The shared calendar has recurring U.S. holidays plus the known special closure. Future exceptional closures must be explicitly added when announced.

## Requested reviewer output

Please report:

1. any audit finding that is not actually closed by the cited code and tests;
2. any regression, hidden compatibility risk, or misleading statement in this handoff;
3. whether the AI Read validation contract now prevents ladder-walk targets and unsupported research claims as intended;
4. whether cost reduction preserves the professional day-trading plan quality contract; and
5. only concrete follow-up changes, ranked by severity and evidence.
