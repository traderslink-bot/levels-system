# Watchlist AI and Provider Corrections Progress

**Status:** Preview-ready; Railway staging review pending

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

## Verification and release boundary

- [x] `git diff --check` passed before targeted lint.
- [x] `git diff --check` passed. Targeted ESLint is unavailable in this
  checkout because no local ESLint binary is installed and `npx` cannot write
  its global npm cache; no dependency download was attempted.
- [x] `npm.cmd run build` passed (`tsc -p tsconfig.json`) while completing the
  separately authorized Stock Levels Railway compile follow-up; it also covers
  this runtime source slice.
- [ ] Railway staging review: verify CRE validator failure/attempt rendering,
  YYGH next-date reactivation, cached five-minute volume wording, factual
  Moomoo/Yahoo health transitions, immediate Apply Model state, and Company
  Details with the hosted runtime.

No provider request, runtime start/restart, migration, hosted configuration
change, deployment, build, broad test suite, or paid AI request is part of
this implementation checkpoint. Hosted behavior must be verified only through
the coordinated staging release.
