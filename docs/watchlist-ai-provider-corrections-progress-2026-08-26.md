# Watchlist AI and Provider Corrections Progress

**Status:** Active owner iteration; no staging review or deployment requested

**Scope:** Watchlist Admin immediate AI settings state, factual provider
health/fallback, AI generation failure visibility, new-trading-day activation,
session-volume confirmation, and Finnhub Company Details resilience.

## Completed implementation

- [x] The successful Apply Model response updates the visible current
  model/reasoning sentence before the follow-up status refresh.
- [x] Admin now distinguishes factual Watchlist market-data status, Moomoo
  connection state, primary/active same-day candle source, and Yahoo fallback
  state. Moomoo remains the default primary source; Yahoo is requested only
  after an unavailable, rejected, or failed Moomoo response.
- [x] AI audit entries preserve request/attempt counts and expose failed
  generations with their latest failure stage, timestamp, and reason.
- [x] A removed symbol activated on a later New York trading date clears the
  prior-day AI boundary/failure state before eligibility is evaluated; same-day
  request and spend guards are unchanged.
- [x] Session volume uses the existing cached live five-minute confirmation
  when a session aggregate is unavailable. It reports the actual relative
  five-minute read or a precise unavailable reason; it does not synthesize a
  session total or claim a provider outage.
- [x] Premarket-high validation now accepts only a price directly bound to the
  high claim, including an authoritative high phrased immediately before the
  label. Earlier opening-area prices are not substituted for the high.
- [x] Finnhub quote and profile retrieval are independent, so factual Company
  Details can render from a successful profile response when a quote request is
  unavailable.
- [x] Fresh activation awaits the canonical TradersLink website-article lookup
  and caches its result before the initial AI Read is scheduled. This prevents
  a concurrent initial lookup from missing an already-published internal
  article and incorrectly reaching the StockTitan title fallback first.
- [x] AI Operations defaults to `All tickers` instead of a filtered attention
  view.
- [x] The AI Read prompt asks for a farther final target when supplied daily
  history establishes a distinct, evidence-backed continuation boundary within
  roughly 50% of current price; it must still omit unsupported range rather
  than manufacture a target.
- [x] AI Operations keeps the current ticker grouping and most-recent result,
  then loads the selected ticker's complete durable run-ledger history into an
  expandable prior-operations section. Every recorded trigger, request,
  attempt, model/effort, identifier, failure, reason, and cost remains visible
  instead of being overwritten by a later generation.

## VMAR hosted durable-audit reconstruction (read-only)

The authenticated hosted `VMAR` audit returned 292 run events on 2026-08-26:
three `request_started` generations, five paid attempt records, three
zero-cost `not_needed` preflights, and two published generations. The Admin
`API requests: 5` count therefore represents paid model attempts, not five
independent published AI Reads.

1. About 11:03 AM ET: activation generation
   `VMAR-1787756611238-9s5k797v` made one successful Luna primary attempt
   ($0.0617809) and published.
2. About 12:32 PM ET: a confirmed upper-boundary crossing at $12.50 started
   `VMAR-1787761940593-un0iim38`. Its primary attempt failed for
   `max_output_tokens` ($0.07243) and its correction attempt failed for the
   same reason ($0.0505767). Validation/unhandled then failed; nothing
   published.
3. About 12:35 PM ET: another confirmed upper-boundary crossing at $12.50
   started `VMAR-1787762109698-efox2i9f`. Its primary attempt failed for
   invalid JSON ($0.0681779), its correction succeeded ($0.0311242), and the
   corrected read published about 12:37 PM ET.

The `not_needed` records at about 11:04 AM, 12:31 PM, and 12:37 PM ET were
preflight decisions only: they returned before request preparation, created no
OpenAI request, and created no cost-ledger attempt. Numerous in-flight skipped
rows were likewise zero-cost.

The source confirms the 12:35 generation was eligible after the 12:32 failure.
The pending boundary-refresh state becomes the new served regime only after a
valid read is acknowledged as published. A failed generation records its
failure but does not write `lastAutomaticRefreshRegime`; consequently the
prior published map still sees the $12.50 upper regime as unserved. The failed
attempt did increment the date-scoped automatic boundary counter, but the next
confirmed crossing can proceed while that counter remains below its configured
cap and the budget guard permits the request.

The historic VMAR records predate reasoning-effort persistence, so their exact
effort cannot be reconstructed without guessing. New attempt, run, and cost
records persist that fact for the expandable history.

## Verification and release boundary

- [x] `git diff --check` passed before targeted lint.
- [x] `git diff --check` passed. Targeted ESLint is unavailable in this
  checkout because no local ESLint binary is installed and `npx` cannot write
  its global npm cache; no dependency download was attempted.
- [x] `npm.cmd run build` passed (`tsc -p tsconfig.json`) while completing the
  separately authorized Stock Levels Railway compile follow-up. The final
  Admin-card placement change received a separate `git diff --check` review.
- [ ] Owner iteration continues before any staging request. A later coordinated
  staging review must verify CRE validator failure/attempt rendering, YYGH
  next-date reactivation, canonical article precedence, cached five-minute
  volume wording, factual Moomoo/Yahoo health transitions, immediate Apply
  Model state, AI Operations default filtering and expandable durable history,
  wider evidence-backed targets, and Company Details.

No provider request, runtime start/restart, migration, hosted configuration
change, deployment, build, broad test suite, or paid AI request is part of
this implementation checkpoint. Hosted behavior must be verified only through
the coordinated staging release.
