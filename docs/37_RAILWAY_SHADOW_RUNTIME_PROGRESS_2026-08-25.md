# Railway Shadow Runtime Progress - 2026-08-25

## Scope

Move the existing Manual Watchlist runtime toward Railway without interrupting
the desktop runtime or publishing any Watchlist website cards or Discord posts
from the hosted copy.

## Approved first checkpoint

- deploy one separate staging service from this canonical Levels project
- use a dedicated Railway persistent `/data` volume
- bind to Railway's assigned `PORT` only when running on Railway
- require a private runtime token for every hosted UI/API request; only the
  small Railway health endpoint is unauthenticated
- set `MANUAL_WATCHLIST_SHADOW_MODE=1`, which disables every website publisher
  factory used by the runtime
- leave the desktop runtime as the only active publisher and fallback
- do not create a public domain, migrate the current active watchlist state,
  expose the admin controls, or release the hosted runtime to production yet

## Completed first checkpoint

Railway staging deployment `19477ef6-5c2d-4ce5-81bd-636786bfb2be` completed successfully on
2026-08-25 for service `traderlink-watchlist-runtime-staging`.

1. Railway health succeeded through `/api/runtime/healthz`.
2. The service has its own mounted `/data` volume.
3. Runtime logs confirm EODHD historical/live providers and that the website
   publisher is disabled by shadow mode.
4. The hosted state has zero active symbols; the desktop runtime was not
   restarted and remains the only publisher.
5. No public Railway domain was configured.

## Live sender cutover

The owner authorized Railway to take over the existing Discord channel and
Website publisher. A private Railway SSH session copied and SHA-256 verified
the exact `manual-watchlist-state.json`, `traderslink-ai-read-settings.json`,
`auto-watchlist-selector-config.json`, and `adaptive-state.json` files into
the mounted volume. The desktop sender was stopped only after its port/process
and runtime identity were verified.

Deployment `6e2a832b-b79e-4459-a144-38778fa6cab3` then started successfully
with real Discord routing, Website publishing, EODHD historical/live feeds,
and no public domain. The transferred state contains 13 saved entries and zero
currently active symbols; Railway is the sole publisher until a normal
activation or selector choice creates an active symbol.

## Next checkpoint

Build the owner-only Dashboard administration surface, then decide whether the
runtime service should move from this controlled staging service to a separate
production service after live market-session observation.
