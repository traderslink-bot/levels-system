# Stock Levels stale price and display-side repair - 2026-09-09

Status: Local implementation complete; static checks and live quote verification recorded below. Hosted release and rendered acceptance pending. No commits, tests, builds, deployments, or restarts authorized/performed.

## Owner-approved repair scope

- Current price: EODHD first; Yahoo only when EODHD fails, is invalid, or stale.
- Preserve EODHD daily/4h historical level inputs; no same-day candle additions to level calculations.
- Classify the static Stock Levels map by reference price: support below, resistance at/above.
- Keep Watchlist monitoring role-confirmation rules unchanged.
- Separate price observation time from calculation time in current and saved-map cards.

## Evidence and implementation

- At 08:04 ET EODHD returned OLB 0.2760 with Sep 8 16:28:47 ET trade time and YMAT 1.22 with Sep 8 16:17:09 ET trade time. Both extended-hours fields were stale too.
- Added stock-levels-reference-price.ts: selects the newest usable EODHD price/event-time pair, then Yahoo quote metadata/latest one-minute observation. Yahoo observations are only price inputs; they never enter the EODHD daily/4h engine.
- Active-session acceptance requires matching New York date/session, no future timestamp, and maximum 20-minute age (delayed EODHD allowance). Closed-session acceptance permits a latest observation up to 96 hours old for overnight/weekend closures. No calendar/holiday feed was added; unavailable active-session quotes fail closed.
- Price event time is preserved instead of the quote snapshot or retrieval time. Recheck freshness after the engine finishes.
- Removed the 15-minute generated-map cache; concurrent in-flight requests still coalesce. Existing EODHD provider quote cache is 60 seconds and every returned observation is validated. Every successful new calculation remains quota-counted by the existing Platform policy; owner exemption is unchanged.
- Repartition both selected and full-ladder historical zones before shared presentation so the static card does not retain the monitoring confirmation buffer's old side.
- Changed only the current-card price note and saved-card summary in Platform. Saved numeric facts remain unchanged; previously saved incorrect maps require explicit regeneration.
- Live lookup using the new resolver returned Yahoo OLB 0.414 at 2026-09-09T12:12:58Z and YMAT 1.9803 at 2026-09-09T12:12:54Z after rejecting stale EODHD.

## Verification

- Targeted TypeScript syntactic and semantic diagnostics passed for the two changed runtime modules; the changed Platform TSX passed syntax transpilation. No output files emitted.
- Scoped git diff whitespace checks passed in both repositories.
- No tests, full builds, browser runs, or hosted changes performed.
- The EODHD primary used here is the separate us-quote-delayed HTTP quote endpoint, not a candle close and not the Watchlist WebSocket feed. The existing EodhdLivePriceProvider owns active Watchlist streaming; this fix does not modify its connections or subscriptions.

## Release handoff

Runtime source: levels-system-post-mtf-handoff-stability, branch codex/watchlist-ai-provider-corrections-20260826, parent 5c0d7382511957abb91e8bd315579298b5b99e2a. Local port 3010 was unavailable; the recorded runtime cutover identifies Railway as the live sender. Do not start the deprecated levels-system checkout or Python scanner for this fix.

Runtime allowlist: src/runtime/stock-levels-reference-price.ts, src/runtime/stock-levels-generator.ts, docs/stock-levels-price-repair-2026-09-09.md, docs/08_WATCHLIST_MONITORING_MASTER_PLAN.md.
Platform allowlist: app/(dashboard)/levels/stock-levels-client.tsx, docs/migration/stock-levels-price-repair-2026-09-09.md, docs/migration/stock-levels-generator-plan.md.

Platform has substantial unrelated staged/unstaged work: preserve it; never stage all or deploy that mixed checkout. Obtain an authorized serialized release for both runtime and Platform. No hosted SHA was verified in this task. Final acceptance must verify rendered cards and regenerate OLB/YMAT against fresh provider data.
