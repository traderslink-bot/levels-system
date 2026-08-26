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

## Completion evidence required for this checkpoint

1. Railway reports a successful build and healthy deployment.
2. The service has its own mounted `/data` volume.
3. The runtime log identifies shadow mode and has no external publisher enabled.
4. No desktop runtime restart or Watchlist/Discord publication is triggered.

## Next checkpoint, not yet authorized

After the shadow is healthy, copy only the reviewed durable state needed for a
like-for-like comparison, verify it produces matching levels privately, then
design the owner-only dashboard admin surface and promotion plan.
