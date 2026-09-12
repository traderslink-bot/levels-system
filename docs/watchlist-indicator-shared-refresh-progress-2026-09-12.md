# Watchlist shared Indicators refresh

Controlling plan: TraderLink Platform `docs/migration/watchlist-deterministic-indicators-plan.md`, assigned Platform worktree `e70f`.

## Narrow supporting connection

- Owner authorized this canonical runtime connection on 2026-09-12. Runtime parent: `fb85207`; tracked tree was clean before this slice. Existing ignored/untracked data, editor settings and orphaned-link file were preserved.
- New `platform-watchlist-indicator-loader.ts` derives the refresh URL from the existing publisher ingest URL and uses the existing publisher authorization. OAuth stays in Platform. Ten-second timeout, redirect rejection, bounded response size, completed five-minute OHLCV validation and safe failure results are included.
- The existing runtime poll uses this shared source every two minutes when configured, sequentially with 500 ms spacing. It reuses candles for existing consumers rather than running another parallel Yahoo poll. Shared warming/provider failure is handled without duplicate requests. Missing/older bridge retains the old Yahoo fallback. Superseded activations cannot publish a returned window.
- AI generation, owner approval/editing, Discord settings, price streaming and Potential Path formulas remain unchanged. No environment variables were changed, no servers started and nothing deployed.

## Verification and release boundary

- Platform focused verifier `src/scripts/verify-watchlist-indicator-runtime-bridge.mjs`: 24 offline assertions against this actual loader and changed manager methods. Strict standalone loader TypeScript passed. Platform POST and refresh integration have separate focused verification.
- Platform endpoint must be released before relying on the shared path. Runtime source needs reconciliation with the then-current release parent; this checkout's parent is not proof of the deployed SHA. Coordinator owns release after owner authorization. No build, push, restart, migration or deployment occurred.
- This is a supporting implementation checkpoint, not complete Indicators feature acceptance. Provider/live-data coverage and final integrated acceptance remain open in the controlling Platform plan/progress.
