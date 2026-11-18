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

## Custom text on notified Watchlist moves

A read-only production ledger check found recent Main Session → Overnight Watches moves with confirmed default copy and no saved draft for their exact activation and destination. Closing the editor without saving previously discarded the typed text. The move editor now retains pending edits for the selected ticker, activation and destination, and a notified move saves them before submitting. Save failure stops the move so it cannot post default copy or delete prior messages. Silent moves and delivery retries keep their existing paths. A 390px Chromium fixture verified Close, reopen, Escape and destination binding. The move and heading suite passed 22 tests, including save-before-move, no move on save failure and exact custom destination copy. No Discord requests or production writes were made.

## Single Free Chat composer

The direct Free Chat action now presents editable text, the post preview, automatic-update preference, and the latest receipt in one dialog. After confirmation it checks only the exact receipt until the post is sent or reaches a terminal state. The Premium ticker preview keeps a masked heading and warns against adding identifying details. A narrow 390px Chromium fixture exercised the actual owner script, Platform handler and isolated SQLite receipt through edited preview, queued, and posted with one dialog and no real send. The 22 Runtime move/heading checks passed. Pair this slice with the Platform composer API and additive receipt migration.

## Free Chat action on published ticker-only listings

The direct Free Chat dialog now explains that the ticker must be published to the Watchlist. A website-confirmed listing without analysis receives a text-only preview and enabled confirmation through the paired Platform API. Isolated Chromium verified editable text and queued-to-posted status for a masked listing-only fixture. The 22 Runtime move and heading tests passed. No live ticker was changed and no Discord post was sent.

## Owner analysis save compatibility

The owner reported repeated generic save failures. An authenticated read-only inspection of installed Runtime source on deployment 3093d7fb confirmed the owner-edit validator still required the retired dayTradeRelevance field in catalyst edits. The released Platform editor submits only summary in both formats. Replayed actual Platform makeAnalysisEdit output against the old validator and reproduced the missing text failure in both formats. The corrected validator accepts summary-only catalyst edits, preserves recorded catalyst sources and generation identity, and tolerates the retired field from an older open editor. Focused regression checks and full Runtime TypeScript passed. Two unrelated stale owner-edit suite assertions fail identically against the unmodified parent. No live save, approval, regeneration or notification was performed. No migration is required.

## November 18 — local all-role provider profile checkpoint

The exact pre-cutover record is Coordinator
`operations/alpaca-runtime-settings-switch-20261107.json`: historical EODHD,
live EODHD, same-day Moomoo. The existing Moomoo-to-Yahoo same-day fallback is
retained and still reports its actual provider. No Moomoo-live assumption was
introduced. Alpaca profile uses Alpaca for all three roles.

New authenticated GET/POST `/api/runtime/market-data-profile` has no public
access even on a non-Railway runtime. POST accepts `profile` (`alpaca` or
`previous`) and `expectedRevision`. Responses give the effective roles,
profile (null for a custom/legacy combination), durable configuration revision
and changing state. GET has no writes. Revision uses the existing JSON
configuration timestamp, now monotonically increasing. No database migration.

One gate serializes complete-profile and existing individual-role controls.
New providers are constructed before mutation. The existing single monitor is
stopped before the synchronous all-role/config commit, then started with the
new provider. Failure restores previous sources/config before restarting the
old monitor. Stock Levels' historical fallback follows the profile instead of
remaining bound to startup. Historical lookbacks follow the selected provider
with existing explicit environment overrides preserved. AI historical loading
continues to use its existing selected-source closure. Saved analyses and all
review, approval, publication and notification settings are untouched. New AI
preparation waits for the short provider transition and discards pre-transition
prepared price action; an already active preparation defers the provider change.

Historical, disk-cache and same-day request completions reject a changed
provider generation. Moomoo same-day cache/in-flight keys include the generation;
old results cannot populate a new selection or start an obsolete Yahoo fallback.
Provider-specific validation disk-cache namespaces remain intact.

Verification: 16 focused profile/candle tests pass, covering exact profiles,
concurrent requests, normal legacy live-only switching, commit ordering,
persistence/stream rollback, lookback restoration, stale in-flight responses
and disk-cache write suppression. Runtime full TypeScript is checked separately.
No hosted settings, analyses, provider connections, preview, posts, workers or
deployments were changed during implementation. Combined Platform/Runtime
integration and real-provider switching remain separate acceptance checks.

Final local checkpoint: Runtime full `tsc --noEmit -p tsconfig.json` passes.
The paired Platform facade keeps GET read-only and marks a partially persisted
pair unsynchronized; the next explicit Apply can finish it without repeating
an uncertain Runtime mutation. Real-provider access and combined owner browser
acceptance were not exercised or claimed.

Persistence rollback readback additionally compares the saved and effective
three-role configurations. A mismatch is explicitly `persisted:false`, never a
successful complete-pair acknowledgment. Same-profile Apply can repair the saved
configuration. All 17 focused cases and full Runtime TypeScript pass.

## November 17 Eastern — inherited Runtime CI test-contract repair in progress

Production Coordinator's exact released Runtime source is
`08d5c5a3632cac671448c81e833a69fdd92cb7fb`. GitHub Node 22 baseline run
44216198902 on previous live `5c726c4b11369759ca3127594eb8fdc734cb6315` and
candidate run 44215294329 have the same 179 failed leaf cases / 183 not-OK
records, with no added or removed failure titles. Provider changes introduced
no failures in that comparison. This finding does not waive the old failures.

A coherent test-only current-contract repair is underway across the 16 failing
files. Test source runs in the exact 08d Git-tree projection recorded *before*
creation in `runtime-ci-test-repair-manifest.json`. Only explicit test postimages
are overlaid; no held Composer or dirty feature source is copied. Shared
O_EXCL + flock admission, bounded heap/concurrency, disabled compile caches and
an unexpected-network guard apply. Broad CI is reserved for the final batch.

Main repairs: native pinned open-session test clocks; explicit closed-session
review/store/feed fixtures; real constructor state for publication-policy tests;
complete DOM/owner review read-model fixtures; preserved additive ladder/mention
contracts; current prompt/schema and concise Discord caption expectations;
separate breakout checkpoint assertions; and retained candle/event scenarios
that now assert the owner-retired narrator and its requests remain disabled.
Production source, stored owner policy, deployed analyses and delivery settings
are unchanged. The existing exact prompt/schema source guard hashes remain
unchanged. Final focused qualification passes 396/396 cases with no skipped,
cancelled or todo cases; all 16 files retain their test registrations. Full Runtime
TypeScript passes on the exact released source with only these tests overlaid.
The other 792 tracked source files match the release byte for byte. Final full
GitHub CI remains pending with the Production Coordinator. Shared heavy-lock
collisions were respected rather than overlapping another lane's work.
The sealed test-only patch and pre/postimages are recorded in the manifest;
held Composer code is excluded. No production redeployment is requested for
this test-only repair.


## November 17 Eastern — owner editing follow-up after Runtime release

Owner reports the generic edit-save error again. Current Runtime deployment
`c2db86e8-c806-4bd5-bf3d-d53555349e80` has the corrected owner-edit helper
byte-identical to the deployed `5c726c4` fix (summary-only catalyst edit).
A read-only SSH probe ran the actual current Platform `makeAnalysisEdit` source
and installed Runtime `applyOwnerAnalysisEdit` entirely in memory against the
30 most recent review cycles: 23 contained drafts, all 23 round-tripped without
a validation failure. It did not call save, approve, publish, generate or any
market-data/delivery operation and wrote no production data. This verifies the
current stored-shape/editor contract, not a successful owner browser save or
the particular unrecorded failed edit. The API's generic catch does not log its
underlying exception; current logs therefore cannot establish its cause.
No approval or owner editing policy was added or changed.


Final full CI 44223627575 passes 1729/1730 cases with zero skipped, cancelled or
todo. One additional inherited stale assertion was outside the initial 16-file
repair: VRAX confirmed-flip expected the only remaining observed resistance to
be absent, contradicting the current full-ladder fallback. The same failure is
present in original source08 CI 44215294329. The test now verifies that actual
resistance, its nearest/must-clear projection, and the unchanged support flip.
All 17 affected files pass 402/402 focused cases on exact08 source; 791 other
tracked files remain byte-identical. A separate one-file patch is sealed in the
manifest for Coordinator integration and final CI. No product behavior changed.


## November 17 Eastern — Runtime CI repair completed

Independent GitHub readback confirms run 44224328223 at
`854cb22196cea071e550802d25f062e4fad56bd4` succeeded: 1730/1730 tests,
zero failures, skips, cancellations or todo. The final candidate contains the
17 test-only repairs; Coordinator verified the other 791 tracked files remain
byte-identical to Runtime08, including app source, dependencies and build config.
Actual Runtime production remains `08d5c5a` / deployment `c2db86e8`; these test
repairs caused no production redeploy, data or approval-policy change.
The manifest records sealed patches, focused/types receipts, full CI result and
bounded removal of obsolete intermediate logs after root identity and absence
of owned test processes were checked. Final evidence, source patches, current
owner-edit probe and unfinished feature source are preserved. The specific owner
browser edit remains unverified; the 23-draft in-memory check is not a live save.


## November 18 — category move heading

Generated Discord category-move headings now use moved to rather than added to
for all public destination lists, preserving attribution and the remaining
content. The Free Chat confirmation preview receives the chosen destination
so its paired Platform copy also describes a move. Approval rules, initial
listing copy, saved owner edits, retry identity and source-post deletion choices
remain unchanged. Focused heading and move suites pass all 23 cases without any
real delivery or production writes. Pair with the Platform push/email and Free
Chat copy change. No migration or runtime restart was performed. Not deployed.


## November 18 — remaining Watchlist batch QA corrections

Completed consolidated discovery and repair with the paired Platform worktree.
The Free Chat composer now reads back a possibly committed send after a lost
acknowledgement, displays its actual saved copy, and keeps reconciliation scoped
to the same cycle and published approval revision. Normal polling remains
receipt-only; manual recovery of an unknown receipt also loads its saved copy.
No automatic send retry or new approval restriction. A late reply after Close
cannot reopen the dialog. Automatic-sharing preference recovery uses GET only,
validates the cycle and boolean value, and shows an accessible unknown state
if the saved preference cannot be checked. Explicit owner choices remain usable.

New eight-case recovery regression suite passes; combined existing row, move,
heading and recovery suites pass40 cases. Full Runtime TypeScript passes.
Paired actual-script Chromium testing passes18 scenarios and the retained
custom move editor Close/Escape/reopen/destination checks. Synthetic Platform
SQLite confirms immutable queued text remains unchanged; no real delivery or
production write occurred. The paired Platform correction coalesces initial
access reads and represents unknown saved access honestly; full final evidence
is recorded in its docs/migration/watchlist-alpaca-independent-qa.md.

Custom move draft save-before-move is already present in live Runtime08d5c5a
and was only regression-tested here; do not reintroduce the old35ab slice by
ancestry alone. Pending Runtime work remains held composer plus moved wording
and move-destination preview context, now with these QA repairs. Coordinator
must integrate against exact live preimages and pair with the additive Platform
Composer migration before activating the newer composer UI. No push, deploy,
restart, provider request, approval, generation or notifications during this QA.

## November 18 — owner-approved Trader Notes alerts

Add optional default-off Notify users about updated notes beside Publish notes.
Draft saves remain silent; normal analysis/move alerts remain independently
controlled. Publish operation IDs are retained on failed acknowledgement so an
explicit retry can recover its existing receipt. Notes publication/Discord
receipts use an independent durable ledger, never an analysis review head or
approval revision. Website receipt precedes standalone alerts. Private entries
remain drafts; moved, removed, reactivated, expired or superseded operations
cannot send old alerts. Discord uses existing category routing and mention
settings, no analysis image. Confirmed rate limits can retry after cooldown;
uncertain sends never blindly repeat. Saved receipts participate in ordinary
ticker removal and optional source-channel deletion on moves. Paired Platform
outbox sends existing opted-in email/push and polls durable receipt state.
All QA uses temporary synthetic storage and fake transports; no real sends.

Notes final qualification:41 focused Runtime cases pass, plus paired Platform
103 and existing notification27 cases (171 total). Full Runtime TypeScript
passes. Actual console Chromium tests pass8 viewport/theme cases, including
explicit notify, default-off, silent draft, empty-note disable and request-ID
recovery after lost acknowledgement and reopening. The paired actual card/style
fixtures pass48 layout/type/empty/long-note cases in both formats. A same-time
operation-order regression prevents failed older notes replacing newer ones.
No notes event changes an analysis head/approval, posted date/price or provider
settings. Sender never attaches analysis images or automatically shares Free
Chat/X. Notes receipt files are durable and independent; both removal and
optional source-channel cleanup include them. No real notifications were sent.
Coordinator allocated additive Platform0220/order295. Backend/schema before new
Runtime notes UI; preserve all prior migration SQL and exact current provider,
Help and worker integration. No push, deployment or service restart here.

## November 18 — breakout investigation and one-break follow-up rule

Owner requested investigating breakout selection and explicitly authorized
stopping replacement breakout sections once the original level is crossed.
Source inspection: Simple prompt was not restricted to session highs, but mixed
provide-one/exactly-one with optional-null and strongly favored unresolved
prior-session ceilings. Evidence catalogs prove a traded high, not a useful
breakout. Detailed path has more candidate validation; Simple shape parsing
cannot establish that a high represents a meaningful trading boundary.

Research: Schwab volume-as-market-indicator explains resistance/participation;
Warrior Trading Gap and Go uses premarket high or opening-range high in that
particular setup; StockCharts consolidation/breakout documentation distinguishes
establishing the range, breaking its ceiling and volume confirmation. Inference:
no one session high is universally the breakout. Preserve comparisons with the
same advance's earlier highs, without mandating a session label or latest high.
Sources:
https://www.schwab.com/learn/story/trading-volume-as-market-indicator
https://www.warriortrading.com/gap-go/
https://help.stockcharts.com/scanning-and-alerts/scan-writing-resource-center/scanning-case-studies/scanning-for-consolidation-and-breakouts

Clarify Simple prompt to at-most-one optional prospective, structurally explained
breakout. No arbitrary tick/percent buffer, forced latest high, ticker-specific
prices, second trigger or discarded pullbacks/targets. Persist first actual
published visible breakout per existing activation identity in independent
Runtime durable storage. Observe existing last-trade updates and already-loaded
completed1m/5m bars, never extra market requests; ignore pre-publication,
publication-spanning, incomplete or future candles. Strict crossing is > level,
not touch, not proof of successful follow-through. Keep consumed state across
re-entry, session/date changes, list moves and restart; real reactivation gets
its existing new activation identity. Recover from acknowledged current/private
ancestor publication history where available, never from unpublished drafts.
Send crossed context in both request formats and omit the generated breakout
section in code (including a cross during a request). Owner edits/approval,
existing published/historical analyses, targets/pullbacks and notifications
remain unchanged. No paid generation, live publication, sends or deployment in
this task. Test with synthetic storage and fake model responses. Artifact home:
/tmp/watchlist-breakout-qa-20261118.

Breakout final qualification:131 focused cases pass across lifecycle, real
Runtime recovery methods, actual service request/response paths, Simple prompt
and packet, plus the pending notes/API/composer regression suites. Full Runtime
TypeScript passes. Actual Simple component and detailed-level-grid render checks
show ordinary breakout sections before crossing and no breakout section after
the generated projection, retaining other content. Raw model/audit data and
previously published cards remain unchanged. An in-flight fake model response
is rechecked after a simulated live quote cross; its useful numeric objectives
remain without an autogenerated Breakout level label. Actual Runtime method
checks recover acknowledged Private ancestors, reject pre-activation history,
keep review heads unchanged and separate a true reactivation. No ticker-specific
threshold or expected stock price was added.

Selection research supports a structural boundary, not a compulsory session
high. The Simple prompt is clarified accordingly; Detailed initial selection
remains unchanged. This is not an empirical claim that the revised model now
selects every chart correctly: all new generation tests used fake responses,
no paid AI replay or real market request. Already-saved drafts and owner edits
remain available as saved; the rule applies to new generation. Historical
crosses are recovered only when existing acknowledged publication/quote or
completed-candle evidence establishes them, never guessed from an old high.

No new DB migration, settings, provider budget, approval gate, web-search tool,
notifications or existing live analysis changed. Durable lifecycle files are
under the existing Runtime data root. Storage errors produce a bounded warning
without blocking approval or the remaining analysis. Final receipts retained at
/tmp/watchlist-breakout-qa-20261118 (types-qualified, regression-final, render).
Only narrow local source commits are authorized here. Coordinator must preserve
current provider/Help/worker changes and integrate under the existing20:15
America/Toronto handoff; no early push/restart/deployment or live sends here.

## Nov18 — Admin information audit and cleanup

Owner requested every Admin section audited, historical Failed/Missing/Requests
moved into Runtime, and misleading legacy AI cards removed. Scope is presentation
and existing information only; no settings, providers, request cadence, approval,
AI generation, saved analyses or delivery behavior changed.

Findings: Showing is filtered analysis-audit ticker rows (current saved records
plus recent-event symbols), not public listings. Published is published analysis
records, not tickers listed without analysis. Failed/Missing count retained audit
events; Requests counts generation-start events, not API billing attempts. One
generation can create multiple failure events. The old active-only subtitle was
incorrect and is replaced. Audit refresh is separate from ordinary list updates.
Legacy AI Model/Service/Generated/Last Generated read the separate commentary
service, and Clean Read Model is another legacy route. Neither identifies the
current Watchlist analysis configuration. Old thread-post records do not prove
current website/Discord analysis delivery.

Implemented: top audit summary now Audit tickers, Published analyses, Needs
attention. Runtime contains Failed audit events, Missing audit events, Analysis
requests with scope explanation. Runtime config uses aiReadConfigured/model/
reasoning/fallback fields from actual status; Configured does not assert external
provider health. Removed obsolete commentary/Clean Read/zero counters, obsolete
thread-post delivery cards, unconditional IBKR/Moomoo badges and internal log/
cache/config filenames. Source logs, audit API and operational controls remain.
Provider-neutral Indicator Audit wording and Help are in the Platform companion.

All11 sections were source-audited: Watchlist, Runtime, Market Data, AI Controls,
Discord notifications, Live Website Controls, Automatic Low-Float Selection,
Usage, Daily Recaps, Indicator Audit, Setup Detection/Results. Full decisions and
suggestions are in the Platform progress record's matching Nov18 entry. Keep
working selection/reversal/setup controls; Off does not establish obsolete.
Recommend actual generation/in-flight/delivery queues, loaded timestamps and an
effective-provider summary as separate future improvements. Setup alert preference
currently does not connect a delivery sender; preserve the honest existing copy.

Verification:14/14 focused renderer and existing row-review regressions pass;
full Runtime tsc --noEmit passes; Platform targeted ESLint passes. Isolated
Playwright uses actual expanded Runtime page and Platform navigation with
synthetic audit/config fixtures and blocked network. All8 viewport/scheme cases
(320/390/844/1280, light/dark browser preference) keep3 current audit cards in the
persistent summary and3 historical cards solely in Runtime; Watchlist/Runtime
switching,17 audit rows, actual model and removal of legacy model labels pass.
Provider controls are stubbed in this render fixture; no signed-in live walkthrough
or all-control functional acceptance is claimed. Browser preference does not
establish production theme styling. Receipts: /tmp/watchlist-admin-audit-20261118
(tests-final.log, types.log, render.log, lint.log). No full build needed for this
presentation-only slice. No migration, push, restart, deployment or real send.
Include in the existing20:15 Eastern handoff, preserving newer source work.

## Nov18 — useful Runtime activity/delivery details (owner requested)

Added actual analyses-running count from the live in-flight set to existing
compact/full status responses. Detailed status reads full retained validation
history for the last successful analysis (including privately saved drafts), not
attempt success, website publication time or the disabled commentary service.
A new read-only ledger snapshot distinguishes missing/damaged history from no
recorded successful analysis. Damaged histories identify a known result as
partial; missing evidence shows Unavailable. Current active public review-cycle
latest approval Discord receipts and current move destinations provide saved
pending/failed/unconfirmed counts. Cancelled/private/silent approvals and older
move attempts cannot create new pending delivery counts. Started but unacknowledged
Runtime deliveries are unconfirmed, not assumed still-running or safe to retry.

Runtime UI adds compact Analysis activity cards and a scrollable Delivery status
table. It joins the companion Platform SELECT-only queue summary on the existing
detailed status relay: Free Chat, member email/push (publication/update/move/notes),
owner Discord, notes Discord, Gain/Recap posts and X/Buffer. Member counts are per
recipient/device. Table scope explains Runtime rows versus retained queue rows;
failed receipts are not current failed-ticker counts. Silent/completed/cancelled/
expired receipts are excluded as applicable; expired/cancelled notes intents do
not contribute Discord pending/failure counts. X acceptance ends at Buffer.
Unreadable/missing schema is Unavailable rather than0. Source read times shown
for Runtime status, analysis details, Watchlist receipts, notification queues and
the independently loaded audit. Last Price Age card removed as requested.

Uses existing5-second compact/60-second detailed Admin checks only: no additional
browser/provider polling, workers, retries, paid generation, approvals, settings,
notifications, saved-analysis or data mutation. No new migration. Status reads
preserve prior detailed displays across compact responses; failed reads preserve
the existing snapshot/time instead of inventing a refresh. No services/previews
restarted; no deployment/push. Preserve the scheduled20:15 Eastern handoff.

Final QA:20/20 focused Runtime tests and19/19 Platform queue/relay/FreeChat move
regressions pass. Full Runtime TypeScript, targeted Platform helper TypeScript and
changed Platform TypeScript lint pass. Eight isolated actual-page/navigation
Playwright cases at320/390/844/1280 with light/dark browser preference pass activity,
queue count placement, compact refresh preservation, unavailable-not-zero states,
ET timestamp rendering, contained keyboard-scrollable delivery table and tab
switching. All browser network blocked. Fixtures stub provider controls and do
not establish hosted/signed-in or production-theme acceptance. Evidence under
/tmp/watchlist-runtime-details-20261118 (tests-final/types/platform-tests/
platform-types/lint/render logs and isolated fixture scripts). Diff checks pass.

## Nov18 — entire remaining Watchlist batch final QA

Owner requested a final QA for tonight's deployment. Runtime source fd944b9 and
Platform51f8e591d implementations were checked together using existing assigned
worktrees, isolated storage/fake transports and blocked browser network. Pending
inventory: editable/current-policy FreeChat incl ticker-only; per-destination move
copy and moved language; row concealment and optional actual-publication Added;
exact intro/curated-copy removal; optional notes alerts/bottom-row layout;
optional/crossed-breakout lifecycle; Admin cleanup and real activity/queue metrics.
No live data/generation/providers/notification/service/release operations occurred.

Runtime131/131 focused cases pass across16 files, including owner API/panel/rows,
FreeChat lost-ack recovery, notes, review storage/policy, moves/heading, boundary/
price-discovery/breakout, listing-only/automatic context and new Runtime metrics.
Platform114 Vitest +62 Node cases pass (307 tests combined). Six isolated UI
fixtures pass106 cases total across all four widths and recorded light/dark
contexts; actual Simple/detailed breakout grids also pass. Runtime full TypeScript
and Platform9-root/886-file graph pass. Four-additive-migration synthetic legacy
preservation plus SQLite integrity/FK/backup-restore pass. Exact canonical DB/build
and signed-in hosted checks remain Coordinator release gates, not claimed here.

Consolidated discovery found only stale Node/browser fixtures (new CSS/price-order
imports, numbered pullbacks/current card inputs, Watchlist owner auth and fifth
access flag) and one contradictory Help notes-position sentence. These were
corrected in the Platform test/Help batch and all affected checks retested green;
no Runtime functional code changed. Original discovery evidence preserved, final
receipts at /tmp/watchlist-final-release-qa-20261118. No dependency or untracked
source loss. Shared resource lease respected.20:15 Eastern reminder remains active.
Preserve source/Help/providers/workers and backend/schema-before-Runtime order;
Composer0213 canonical270, row0218/293, Added0219/294, notes0220/295, existing
Home0214/269 and combined manifest. No early deployment/push requested.

## Nov18 — compact provider-usage cards (owner requested)

Owner reports obsolete top Moomoo Connection/waiting despite Alpaca use and asks
for smaller cards per market-data provider. Runtime now emits marked usage cards
for Alpaca, Moomoo, EODHD, IBKR and Yahoo from the actual status-configured live,
historical and same-day roles. No role => Off when configuration is complete;
missing configuration => Unknown. Existing Moomoo connection-loader diagnostics
cannot imply use. Yahoo may be Standby for a configured fallback or In use with
Last candle response when existing diagnostics record fallback use; stale
fallback diagnostics from another selected profile are ignored. In use is role/
recorded-fallback attribution, not a connection-health assertion. Overall
Watchlist Market Data remains independent. Same-day diagnostic display no longer
invents Moomoo when provider evidence is missing. No provider switching, probe,
new request, background work, setting or stream change.

Platform companion clones explicitly marked provider cards plus overall market
data; it never clones the old unconditionally waiting Moomoo badge, including
older Runtime compatibility. Compact responsive summary uses smaller card width/
padding and clear role subtitles. Actual provider change observations refresh
cards using existing status/navigation observers. Help explains status scope.

QA18/18 focused Admin summary/provider/row regressions pass, Runtime full
TypeScript and Platform targeted ESLint pass. Eight isolated actual-page + actual
navigation browser cases (320/390/844/1280, light/dark preference) verify exactly
6 summary cards, Alpaca roles + unused Moomoo Off despite legacy waiting field,
profile changes observed back/forth, compact desktop widths (<180px), contained
mobile grid, existing activity/queue cards and Runtime/Watchlist navigation.
No external network; no signed-in/hosted or production-theme acceptance claimed.
Receipts /tmp/watchlist-provider-cards-qa-20261118 (tests/types/render/lint logs).
No migration/dependency, live data/generation/notification, push/restart/deploy.
Include this extension in tonight's existing20:15Eastern handoff, preserving newer
canonical provider profile and Help/navigation changes by narrow integration.
