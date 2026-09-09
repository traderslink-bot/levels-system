# Stock Levels AGRZ freshness correction - 2026-09-09

Status: Local implementation and scoped verification complete. Serialized coordinator release pending.

## Controlling owner correction

AGRZ was reported at reference 0.3535 while current price was about 0.39. The owner requires current price, explicitly excludes delayed EODHD quotes, and permits Yahoo first/EODHD fallback. This supersedes the prior EODHD HTTP-first 20-minute allowance. Previous EODHD daily/4h historical-only level inputs, corrected support/resistance grouping, and preserved saved history stay unchanged.

## Complete implementation inventory

- src/runtime/stock-levels-reference-price.ts: Yahoo primary; active-session maximum age 60 seconds, matching New York session/date, original observation timestamp and no future timestamp. No delayed HTTP quote fallback. Yahoo metadata and latest prepost observation are reference-price-only; never fed to historical calculation. Existing 96-hour closed-session latest-observation handling remains.
- src/runtime/stock-levels-live-price.ts (new): EODHD live trade WebSocket fallback, own bounded connection, one concurrent fallback at most, 8-second timeout, event p/t pair, exact symbol matching, ignores dark-pool messages, closes on result/failure/timeout. No changes to Watchlist subscriptions or existing streaming connection. If busy/unavailable/unauthorized/no fresh trade, generation fails closed. Source admission is timestamp-based; market-feed coverage can differ, so this does not promise broker-tick equivalence.
- src/runtime/stock-levels-generator.ts: remove obsolete extended HTTP quote dependency; keep historical profile and side repair unchanged. Existing post-calculation freshness recheck now enforces 60 seconds too.
- src/runtime/manual-watchlist-server.ts: remove Stock Levels' delayed HTTP provider construction/import. No other consumer changed.
- docs/08_WATCHLIST_MONITORING_MASTER_PLAN.md: link this checkpoint.
- This progress record.

## Evidence

At 2026-09-09T13:15:49Z EODHD HTTP us-quote-delayed returned AGRZ 0.3784 event 1788958820245 (~15m old); Yahoo latest observation was 0.4176 at 1788959749. Thus the first fix rejected overnight data but still admitted delayed intraday data.

New resolver live probe: Yahoo AGRZ 0.4048 at 1788959878000, received 2026-09-09T13:17:59.157Z (1157ms old). Independent fallback live connection: EODHD AGRZ 0.4097 at 1788959879307, received 13:17:59.662Z (355ms old). Both provider paths worked. Values were separate observations at different times/feeds, not asserted equal or equal to the owner's earlier quote.

TypeScript syntactic and semantic diagnostics for all four changed runtime source files passed. No tests or full build run, per owner instruction. No Platform source/UI changes needed for this follow-up. No historical candles, saved maps, databases or provider settings were modified.

## Release handoff

Runtime parent: f0236c6d39eeddb6d0f9537cc1ce5b6a5684bb7b, branch codex/watchlist-ai-provider-corrections-20260826. Complete allowlist is the six files above. No Platform deployment dependency. Coordinator has reserved the release lane. Serialize deployment; verify new live AGRZ result timestamp and correct sides after release; old saved results remain facts and require regeneration.

- [x] Implementation and scoped checks.
- [ ] Coordinator runtime deployment and health.
- [ ] Fresh live AGRZ rendered acceptance.
