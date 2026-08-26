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
5. No public Railway domain, Discord configuration, Website ingest URL, or
   Watchlist publisher credential was configured.

## Controlled state transfer

Railway SSH was unavailable in the deployed service image. The shadow runtime
therefore exposes one temporary, token-protected state-restore endpoint that
accepts only the four named non-secret runtime-state files, only while shadow
mode is enabled. It writes each file atomically to the private `/data` volume.
The endpoint is disabled before the service becomes the live publisher.

## Next checkpoint, not yet authorized

After the shadow is healthy, copy only the reviewed durable state needed for a
like-for-like comparison, verify it produces matching levels privately, then
design the owner-only dashboard admin surface and promotion plan.
