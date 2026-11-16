# Watchlist Alpaca price status QA

## November 12 — mobile move controls and confirmed delivery retries

Both overlaps reproduced at 320/375/390px. Placement now has its own
selector/button grid with a mobile stack; delivery status occupies a separate
full row. Successful placement clears its request/choices even if delivery
failed; changing destination after an incomplete request clears old delivery
choices. Replaying a completed placement returns its receipt without retries.

Explicit Runtime retry accepts only a current completed move with a confirmed
failed Discord delivery outside cooldown or failed selected cleanup. No new
placement is allowed. Platform supplies actual Free Chat receipt status and
retries only a matching current, failed, nonexpired receipt outside cooldown.
No schema, approval, provider or saved-analysis changes.

Verified 13 move tests, five manager tests including Private preservation, full
Runtime TypeScript and diff checks. Network-blocked Chromium with actual UI and
mock requests passed 320/375/390/600/768px, no overlap or horizontal overflow,
seven retry visibility cases and separate payloads for both retries and a new
silent move. Two unrelated review API failures match November 10 CI. No real
moves, sends or deletes in testing. Owner authorized paired deployment.

## November 12 — moving a ticker with analysis to Private

Live read-only investigation: DBGI Main→Private attempts at 9:51 and 9:52 AM
ET reached Runtime, recorded pending placement, and returned HTTP400. Two new
private review cycles had only their begin event; DBGI remained Main in both
Runtime and Platform. The installed manager tried to save an edit as the first
draft in each empty cycle, which the unchanged review store rejects with “No
original analysis to edit.” No live move or recovery edit was performed.

The generic move now copies the latest saved original with its existing
generation identity, payload and validation decisions, then reapplies the saved
owner edit if present. The source review, approval and delivery history stay
intact. The private cycle has no inherited approval, generation or delivery
events. No change to concealment ordering, move notifications/cleanup choices,
analysis settings or any approval rule. No data migration or ticker exception.

Focused manager tests reproduced the old error for original and edited reads;
after the fix both pass, alongside no-analysis moves, failed concealment and
repeat-move behavior. Five focused manager tests, 26 move-choice/review-store
tests, seven publication-policy tests and full Runtime TypeScript pass. All
tests used synthetic data and fake publishing ports. No DBGI mutation or real
analysis, website publication or Discord send was used for verification. No Help
change required: this restores the existing move workflow. Owner authorized the
coordinator to deploy this narrow Runtime-only patch.

## November 10 — SMX reverse-split investigation (read-only)

Owner reported absent higher resistance and noted the chart visibly has adjusted
daily history. No generation, refresh, edit, post, deployment, restart or setting
change was performed. Existing authorized Runtime SSH and authenticated GETs
were used; saved current-cycle review originals/publications/diagnostic files
were read directly without instantiating writers or fabricating owner actors.
No credentials, actor IDs, private URLs or unrelated account/ticker evidence is
recorded here. Scanner/chart owner was asked for current handling independently;
no source collision or shared-source edits were made.

Official SEC November4 announcement confirms SMX2.8:1 reverse split effective
November9 (https://www.sec.gov/Archives/edgar/data/1940674/000149315226049929/ex99-1.htm).
Fresh existing gateway /history (Watchlist) and /bars?daily=1 (chart) GETs both
returned adjustment=split and identical sampled OHLCV: October16 high15.71,
November6 high5.32/close4.928, November9 high10.8/close9.35. Watchlist history
was complete for the bounded request. Those same daily values are in the saved
analysis requests. No evidence supports multiplying this history by2.8 again.
The chart response has276 daily bars, beginning October7,2025, while the latest
saved analysis has126 daily bars from May12,2026 through November9,2026 and252
four-hour bars. Its daily maximum is91.94; first November9-evening request had127
daily bars including May11 high147.15. This is bounded history, not all-time.

Saved publications show the distinction between compact display and full ladder:
- November9 10:44PM ET publication, reference10.42: compact resistance through
  11.90; Full Ladder already includes15.71,29.20,40.26 and continues to63.52.
- November10 7:33AM ET, reference15.09: compact through21.28; Full Ladder63.52.
- November10 9:11AM ET, reference19.5215: compact21.28/25.15/29.20; Full Ladder
  includes40.26,43.40,48.19,56.00,63.52 and other intermediate levels.
The last original generated9:09AM ET has targets22/25.15/27.02/29.20 while the
actual input includes daily history up to91.94 and a resistance shortlist that
also includes30.67. Earlier originals ended15.71 then21.28. No inference that
the missing higher targets were absent from provider data is justified.

Source trace: both adapters enforce split-adjusted SIP /history. Runtime compact
snapshot uses a price-dependent forward range (base50% at prices>=15), plus
qualified connected outer anchors; full ladder also retains more generated
structure. Simple prompt chooses2-3 significant upside areas, optional fourth,
requires supported30%+ coverage, explicitly says this is a floor not a ceiling.
It does not promise the all-time high in its targets. Thus existing evidence
points to history scope and selection/presentation, not missing split adjustment.
Do not label every old high resistance or re-adjust already adjusted candles.
Potential follow-up: improve broader-history/outer-level selection and make
compact-versus-full scope clear, with general tests before any correction.
Saved data-quality flags also include insufficient-bars/suspicious-gap despite
summary status full; these flags alone do not establish a split error and were
not silently corrected. No full-history maximum or exact hidden model reasoning
is claimed by this bounded investigation.

## November 10 — Admin failure handling (released and transport-verified)

Final release: paired Platform9e7db6c1ba36e8a174132b7d221019b20d2ef8f2
(parent2aba52e3, configured main), deploymentcf96a9ee-01ec-49dd-9a00-010e78e14bbe
reported SUCCESS/sole RUNNING. Runtime source/deployment below also SUCCESS.
Independent final GETs from the NEW Platform's actual configured connection:
root200/305648B with shared reader and retained-review notice, old misleading
session warning absent; watchlist200/5825B valid JSON; healthz200/38B valid JSON;
public Platform health200. No owner actor/session fabricated, mutation or send.
Owner browser editing acceptance is not substituted by these transport checks.
No scanner, catalyst, settings, provider configuration or approval rules changed.

Release qualification update: owner subsequently authorized deployment. Coordinator
integrated error-only Runtime0c292650 onto exact live parent07ffc5dd (excluding
unrelated catalyst changes), deployment abf1ec8d-cf3b-4c8b-9b4e-4ffd5ce86cd5
reported SUCCESS/sole RUNNING. Independent read-only GETs from actual Platform
configuration: root200 contains the new reader/delayed-review notice and no old
owner-session warning; watchlist API and healthz200 with valid JSON. Platform
error-handling release remains pending at this checkpoint.

Full Runtime CI is not green. Independently compared exact deployed-parent CI
42679569729 (07ffc5dd) with candidate CI42844337067 (0c292650):92 versus91 unique
TAP failure titles, zero new titles. Only the old stock-context timestamp-equality
failure disappeared. This is consistent with87 failed leaf tests in candidate
CI (suite failure nodes are also counted in the unique-title total). Mention
endpoint/panel Unexpected-token-HTML and listing-only missing-Map failures both
already failed in exact parent; their affected source/tests are unchanged by
this release. Comparison used existing candidate log and parent GitHub log in
memory; no broad rerun, source correction, live edit or send was required.

After transport recovery, the owner requested continuing the correction here.
Discovery found blind JSON parsing in the dashboard/review readers and a review
refresh catch that replaced the loaded queue with an empty Map. A shared embedded
reader now handles plaintext/HTML, malformed successful responses and structured
API errors without displaying upstream bodies or blaming a session for429/5xx.
Transient review failures preserve last-loaded same-activation controls and show
a delayed-update notice. Genuine401/403 clears cached reviews; a successful empty
queue also clears them. A different publication cycle cannot use the old review.
Failed list reads do not render an invented empty list. Successful recovery clears
the notice. No mutation retry, approval rule, provider request or delivery added.

Verification: four focused response/retention/list/script regressions pass; all
seven existing review-panel checks passed in the batch; full Runtime TypeScript
and diff checks pass. Isolated Chromium with external network aborted verified
real row markup through healthy -> plaintext429 -> healthy: editing remains
available for the matching cycle, the warning appears/clears, three GETs and zero
posts. This is synthetic browser coverage, not signed-in production acceptance.
The broader row suite has four pre-existing failures (two incomplete DOM mocks,
outdated ordinary-action count and Add fixture); executing the untouched HEAD
suite entirely from git-show in memory reproduced the same four failures. No
unrelated product changes were made to satisfy those stale tests; full CI is not
claimed green.

Paired Platform source normalizes non-JSON failed API responses and renders a
readable initial-console failure with an explicit reload link instead of a bare
edge body. This does not make an unavailable service editable or prevent a future
infrastructure outage. No hosted configuration/data changed and no Coordinator
contact was needed for implementation. Existing Help was reviewed: no feature or
workflow change requires a guide amendment. Source remains separate from the
previous Day-trade-impact removal and requires normal integration/release.

## November 10 — Admin transport incident recovered

The owner saw plaintext rate limited and every ticker's review status unavailable.
Read-only comparison confirmed the existing configured Platform-to-Runtime
public connection returned429/12-byte plaintext, while actual Runtime localhost
health/API/root returned200. The app's review UI incorrectly attributed generic
upstream failure to the owner session; no authentication/session failure was
established. Railway's LAX edge rejected the requests before Runtime ingress.
Native Under Attack mode was checked read-only and disabled. Canonical DNS had
only IPv4; ordinary Node HTTPS reproduced the same rejection. No repeat probing
or auth/security bypass was used as a repair.

Coordinator obtained direct owner authorization, tried native static egress with
an unchanged-image Platform deployment (did not recover), then obtained approval
for a temporary fixed-destination secure VPS relay. Coordinator owns its hosted
configuration/security/process records. Relay is separate from Alpaca, retains
existing bearer authentication/owner actor, refuses redirects, bounds body/time,
and does not persist raw credentials or request bodies. No existing provider,
Watchlist data, live prices, approval settings or Runtime source was changed.
Platform configuration-only deployment 5f7e8f8d-4531-420a-95eb-a7e40be1633f uses
the same 2aba52e3 source/image; Runtime remains 07ffc5dd.

Independent worker final verification from the actual newly configured Platform
container: root200/text-html302237 bytes containing the full console and review
script; watchlist API200/parseable JSON4556 bytes; healthz200/JSON38 bytes. No rate
limited responses. Existing bearer only, redirects refused, no owner actor or
session fabricated, no mutation or post. Coordinator separately verified anonymous
relay401 and synthetic forwarding/auth controls. Owner was told to refresh the
already open Admin. An attached signed-in owner browser was unavailable, so
specific browser editing/approval acceptance is not claimed. The Day-trade-impact
source-only slice below was not included in emergency recovery. Retain the relay
as an explicit operational dependency until Coordinator qualifies its replacement.

## November 10 — retire Day-trade impact (source-only)

Owner requested removing the catalyst's Day-trade impact display and AI request,
without a database migration. Both simple and detailed schemas now omit the
catalyst dayTradeRelevance field; prompts no longer request that commentary.
Normalization retains an empty compatibility string in new stored payloads, so
existing readers and saved analyses need no migration. Existing originals/edits
are not rewritten. Runtime review editing no longer offers the retired field.
No trading logic, candle inputs, target/pullback generation, approval or delivery
rules changed. No paid requests, live data edits or posts were made.

Three focused schema/hash/real-service-with-mocked-fetch tests pass, including
normalizing a response with the field absent. Seven review-panel regressions
pass; full Runtime TypeScript passes. The owner-review prompt/schema hashes were
intentionally repinned. An additionally selected existing owner-review narrative
test failed on target-list equality (the engine includes breakout 1.65 ahead of
its six targets); that unrelated assertion and target logic were not changed and
full CI is not claimed green. Paired Platform tests cover both old saved formats,
catalyst text retained, retired commentary hidden, premium preview and editors.

Separate live incident during this work: actual Platform-configured Runtime
origin returned HTTP429 plaintext rate limited (12 bytes), while authenticated
Runtime localhost healthz, watchlist API and root document all returned200.
Coordinator independently found Railway LAX edge rejection before app ingress;
VPS through ORD1 returned200. Hosted recovery is Coordinator-owned and not mixed
into this source slice. No authenticated owner session was forged.

## November 9 — new-high boundary and refresh-limit correction

Owner scope: stop automatic analyses chasing each new session high when no higher
historical structure remains, enforce the saved per-ticker daily limit, and
investigate apparently unchecked review controls. Source base b3f63e0b; no live
settings, analyses, publications or deliveries changed during this work.

Read-only hosted evidence: CKX had nine published boundary-cross generations on
November 9 while its durable boundary state contained count 0/date null. The
saved limit was 5. All six automatic/review/notification switches were still true.
The Store normalizer discarded count/date and pending-cross state, whereas the
disk normalizer retained them. Approval then copied the stripped state. The disk
normalizer also incorrectly capped valid counts at 100 despite an admin maximum
of 1000. Normalization is now shared and preserves those fields through Store,
pending publication and persistence. Unique boundary generation IDs are indexed
from the existing run ledger once at startup, so already-consumed refreshes are
not forgotten; no per-price filesystem read is added. Initial/manual requests and
fallback attempts are not extra boundary refreshes. Reservation happens after
preparation and rechecks the current limit. Successful publication retains regime
identity; failed generation does not mark the boundary serviced.

CKX's saved Potential Path had only 24.74 resistance: one weak intraday touch,
matching HOD 24.74. A read-only SIP/split-adjusted daily query returned 717 bars
since January 2024, with prior-date maximum 14.4399. This is bounded available
history, not proof of an all-time high. Automatic upper-boundary requests now
stop when price is above usable available prior daily history and no independent
higher mapped structure remains. Today's changing high is excluded from that
history ceiling. Missing/insufficient history fails open, not an invented ATH.
Initial/manual requests and downside boundary checks retain existing behavior.
Prepared/cached historical data is reused: no new per-tick provider requests.
Cache entries clear with the existing symbol lifecycle cleanup.

No coupling from saving the numeric limit to stored review booleans was found.
The panel initially rendered unchecked placeholders; a failed initial load could
leave those visible. It now hides them until a complete saved response arrives,
validates all six booleans before changing any, preserves loaded values on failed
or partial reload, and offers an explicit retry. This is a verified loading/error
path correction, not a claim that the owner's exact transient browser failure
was reproduced.

Verification: 102 focused tests passed across boundary decisions, new regressions,
review panel, persistence, realtime publication and publisher. Three additional
canonical article manager tests passed. Runtime full TypeScript passed after the
final additions. Actual isolated Chromium panel passed
initial failure, six true hydrated controls, partial response and failed reload
retention, with no page errors or network effects. No signed-in production UI
acceptance is claimed. The persistence test's stale full-object expectation was
updated to explicitly assert the current entry defaults and normalized zero/null
usage fields; that test now passes. The manager regression also verifies that
failed generation consumes one slot, manual refresh still dispatches after the
automatic limit, and lowering the limit during preparation prevents dispatch.
Paired Platform slice labels HOD references and updates Help. No push,
deployment, provider configuration, generated analysis or notification was made.

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

Paired immutable source receipt: Runtime consumer
7e34c65d333713836fb71726a0c602c8fc369012 (parent be659dec), gateway-owner
preservation e23e01d3655b3f06dce4e2a2c0f28154f4c5bde6 (parent 86ec79f7).
The gateway owner reports 395 scanner/Alpaca regression tests and ten final focused
cases passing, including session boundary, no-trade heartbeat, single shared SIP
socket and <=250 ms synthetic receipt-to-emission. These are gateway-owner results,
not reruns by this chat. The actual hub and gateway blobs read for local integration
match that preservation commit. Its whole branch is NOT a release artifact;
Coordinator must qualify exact-parent integration/pinned gateway recovery before
any owner-authorized deployment. All-deploy HOLD remains. No live acceptance yet.

## 2026-11-16 · Free Chat preview

Manual Free Chat shares and retries, opt-in approval, and opted-in moves open an owner confirmation dialog using the Platform preview endpoint. The dialog shows the message and whether attachments will be included. Existing automatic sends use the Platform delivery policy without an owner dialog. Validate with an isolated Chromium fixture and intercepted requests. All eight previews, cancel/Escape, and manual confirmation passed. The move suite passed 13 tests. Four owner-row fixture failures also reproduce on unchanged Runtime HEAD and are unrelated to Free Chat. No Discord or hosted requests.
