# Watchlist Alpaca price status QA

Source base 849b6d991de45fa596d90e3a031ae5e6f45c2aaf. Owner requested independent
Watchlist provider/AI/indicator QA and truthful price availability. Scanner task
confirmed no ownership overlap. Paired Platform base is ffb309d4; this is a
source-only correction, not a release or configuration change.

The deployed mapper omitted Alpaca and fell through to IBKR offline. Manager
health and restart rows forced closed overnight despite recent BOATS trades.
The fix maps Alpaca through actual feed health and enables its verified
weekday overnight window via a callback to the selected live provider. The
existing two-minute observation freshness rule is unchanged. Selection alone
does not establish live data. Legacy providers retain their behavior.

A one-time overnight level reference can now be released by a current accepted
overnight trade, not only a later premarket quote. The corresponding late lookup
is checked against accepted trade time. Optional observedAt preserves the
initial BOATS trade time across Platform, loader and saved reference validation;
old references remain compatible. Receipt time is never relabeled trade time.
Provider transport, history calculations, prompts, approval rules and delivery
are unchanged.

Tests cover Eastern boundaries, DST, weekends, actual/stale/missing trade data,
provider changes, actual manager health/restart rows and metadata compatibility.
An actual-service test intercepts fake outgoing OpenAI requests for both simple
and detailed formats and proves all four candle groups are preserved unchanged
between Moomoo and Alpaca identities. It never contacts a model or touches a live
analysis. The original strict source-provenance guards remain intact.

Focused commands (no cleanup hooks):

```
node node_modules/tsx/dist/cli.mjs --test src/tests/manual-watchlist-market-data-status.test.ts src/tests/watchlist-price-feed-status.test.ts src/tests/watchlist-overnight-health-integration.test.ts src/tests/watchlist-alpaca-packet-parity.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false -p tsconfig.json
```

Final verification: eleven tests and the full TypeScript check pass, including
the additive metadata test and both outgoing AI request formats. No cleanup
hooks, model requests or provider calls were used by those tests. Full independent live-read and
UI evidence is in the paired Platform docs/migration/watchlist-alpaca-independent-qa.md.
No production writes, restart, provider configuration changes, real AI request
or notifications were used for this QA. Coordinator owns integration/release;
exclude the local AGENTS setup overlay from any commit.
