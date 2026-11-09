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

## November 9: connected feed versus halted last trade

Owner clarified that an unchanged/old trade during a halt must not say Not live
when the feed is connected. The earlier age-based display semantics are superseded
by this instruction. Alpaca now exposes an optional transport-health observation
from its EXISTING SIP connected response/BOATS successful requests; no extra
market-data calls or new timers. Monitor forwards it to overall feed health.
Health expires after 30 seconds without a successful connection observation;
disconnection/error cannot be masked by a recently received trade. BOATS marks
each success when it actually arrives, not when a later slow batch ends.
Legacy providers retain their existing behavior. Session eligibility still applies.

Individual actual trade timestamps, restart-readiness quote ages and reference
replacement checks remain independent and unchanged. Platform hides Not live on
a connected feed, including halted/quiet trades; it retains last-price time when
the feed is not live. Fixed-reference notes also respect connection state without
claiming that the reference itself is a new trade. The UI does not infer a halt
merely from price silence. New fake-transport/actual-manager tests cover connected
old trades, disconnected/error/expired state, BOATS no-new-trade, no added request,
stop reset, and separate stale restart readiness. Five focused new/manager checks
pass. Final combined batch: 26 tests and full runtime TypeScript pass, including
the additional actual-manager assertion.

## November 9: owner-directed event-driven price delivery

Owner requested removing the five-second Watchlist polling wait. Discovery also
found the separate fifteen-second Runtime-to-website ticker publication gate.
Both must change together; replacing provider polling alone is not sufficient.
Scanner task owns shared gateway implementation, not this consumer. Protocol 1
is specified in its assigned Platform source at
docs/migration/alpaca-live-price-stream-contract-20261109.md. Owner's all-deploy /
restart HOLD remains in force. Do not connect to the currently installed gateway's
absent /prices endpoint or ship this consumer before matching gateway readiness.

Implementation sequence and state:

1. Receive SIP trades through one authenticated POST /prices SSE subscription for
   the active Watchlist population, using the gateway's existing SIP socket and
   independent consumer lease. No new upstream connection per viewer. Local done.
2. Atomically validate protocol/feed/population/price/provider timestamp and
   transport timestamps; preserve nanosecond ordering and original trade time.
   Heartbeats only update transport health. Bound buffer to 2 MB, silence to
   12 seconds, reconnect backoff to 1–30 seconds; stop and population changes
   await prior stream cancellation. Local done.
3. Preserve BOATS as its existing separate five-second REST path, not a claimed
   overnight WebSocket. Clock-only mode checks switch transports at session
   boundaries without adding periodic SIP quote requests. Local done.
4. Bypass the old fifteen-second website gate only for effective Alpaca, keeping
   the existing durable serialized/latest-wins outbox for delivery pressure.
   Same-millisecond eligible prices advance revisions without changing their
   trade timestamps. Ignore older reconnect trades before state mutation.
   Legacy provider cadence and historical/indicator candles remain unchanged.
   Local done. No approval, notifications or automatic-generation rule changes.
5. Qualify matching immutable gateway and Runtime code, then only after the owner
   lifts HOLD verify installed feed-to-browser latency, disconnect/reconnect,
   session transitions and representative live load. Pending; local tests cannot
   establish deployed timing or guarantee every intermediate tick is displayed.

Verification: 95 focused Runtime tests pass across ten files, including factory,
source identity, history/AI parity, actual manager publication, stream malformed /
fragmented CRLF, 2 MB and watchdog bounds, same-millisecond nanosecond ordering,
reconnect stale bootstrap, population cleanup, halt health and existing durable
outbox replay/coalescing/priority checks. Full Runtime TypeScript passes.

Additional local HTTP integration used the actual shared LivePriceHub source and
actual Runtime provider, no copied implementation. One eligible synthetic trade
traveled hub -> loopback POST /prices SSE -> Runtime in 228 ms with original
timestamp retained and connected status. This is not installed-source/live market
or complete browser latency proof. No real provider requests, model requests,
saved-analysis writes or notification sends. Local HTTP server/hub/provider were
closed after the check. An initial TSX CommonJS/ESM import mismatch failed before
starting the harness; default import resolved that harness-only issue.

Help review: the existing guide already distinguishes live-price updates from
completed-session indicator readings. No new user control or visible workflow is
introduced, so no additional Help revision is required for this transport-only
slice. No dependencies, schema, provider selection or credentials changed.
