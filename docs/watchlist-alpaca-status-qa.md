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

## November 9: SMX halted/reverse-split session correction

Owner reported the only failing analysis today, SMX, resumed from its split halt
at 09:00 ET. Recorded 09:40–09:42 runtime logs show the additional AI history
loader still requested EODHD and received HTTP 401 for previous-session and daily
history. Server installed bare buildTradeCandleContext, whose legacy routing
ignores the runtime's selected historical provider. Main Alpaca history/stored
fallback could mask this in other analyses. Success of a generated response did
not establish completeness of every downstream input.

Add an explicit provider override to the generic builder, with no change to its
legacy defaults. The Watchlist-only loader evaluates effective provider selection
on each call and overrides all history frames to Alpaca when selected. Empty or
failed Alpaca history does not silently mix another provider's adjustment basis.
No ticker-specific price/rule, threshold weakening, split-ratio guessing, synthetic
halt candles, approval restriction, provider-setting change or model call added.

Read-only verification replayed the actual manager's context method at the
original 09:42:11 ET cutoff using real Alpaca SMX bars: 34 one-minute candles,
7 completed current five-minute bars, 166 prior-session five-minute bars,
173 merged five-minute bars, 127 daily bars and 247 four-hour bars. Availability
validation now passes. Actual service outgoing requests captured locally for BOTH
simple and detailed formats contain 31 selected one-minute, 173 five-minute,
127 daily and 247 four-hour observations. The transport was fake: no OpenAI
request, saved-analysis change, notification or publication occurred. Actual
gateway responses report SIP/split-adjusted/complete. Reverse-split corporate
action correctness beyond the provider's declared adjustment is not independently
certified by this check.

Twelve focused tests pass (new loader, generic legacy builder and both-format
packet parity); full runtime TypeScript passes. The new regressions cover server
wiring, every historical timeframe, recent/older windows, empty/error handling,
dynamic selection and sparse halt-resumption context. Existing generic fallback
tests remain unchanged. Help requires no change: this restores existing provider
and analysis behavior without a new user workflow. Local correction remains
separate from deployment/live verification.
