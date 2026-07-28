# Operational Reliability Preflight And Restart Readiness

## Purpose

This document records the operator-facing reliability work added on May 2, 2026. The goal is to make restarts, Discord permissions, and historical level seeding easier to inspect without adding any trader-facing Discord noise.

## What Changed

- Runtime health now includes level-seeding stats:
  - attempts
  - successes
  - failures
  - timeouts
  - in-flight seed operations
  - average and last seed duration
  - last seed symbol and last seed error
- Runtime health now includes per-symbol restart readiness:
  - level status: `ready`, `seeding`, `waiting`, or `failed`
  - price status: `fresh`, `stale`, or `waiting`
  - Discord status: `ready` or `missing_thread`
  - operator reason explaining what the app is waiting on
- The manual watchlist UI shows seed stats and restart readiness below `Provider Health`.
- Discord permission preflight can be run without touching the channel.
- Optional Discord post/delete preflight can prove the bot can send and clean up a temporary test message.
- Startup operator preflight writes a local artifact checklist so missing review/audit artifacts are visible before relying on a restarted session.
- Startup cache restore can now make active symbols usable to the operator faster while fresh provider candles are fetched in the background.
- Cached-only startup levels are marked as warming and cannot produce trader-facing startup snapshots until a fresh provider seed succeeds.

## Commands

Run the non-destructive Discord permission preflight:

```powershell
npm run discord:preflight
```

Run the opt-in post/delete Discord permission preflight:

```powershell
npm run discord:preflight -- --post-test
```

Run the startup operator artifact checklist:

```powershell
npm run startup:preflight
```

## Artifacts

- `artifacts/discord-permission-preflight/discord-permission-preflight.json`
- `artifacts/discord-permission-preflight/discord-permission-preflight.md`
- `artifacts/startup-operator-preflight/startup-operator-preflight.json`
- `artifacts/startup-operator-preflight/startup-operator-preflight.md`

## Product Boundary

These reliability checks are operator-only. They do not change trader Discord wording and they do not post test/operator language into ticker threads. Cached candles can help operators understand readiness, but trader-visible posts still need current runtime context before they are trusted.

## How To Use After A Restart

1. Start the manual watchlist app.
2. Watch `Provider Health` for seed attempts, seed timeouts, and in-flight seeds.
3. Use the restart readiness list to see which symbols are waiting on levels, fresh price, Discord thread access, or fresh-candle confirmation after cache restore.
4. If Discord errors appear, run `npm run discord:preflight`.
5. If review artifacts are stale or missing, run `npm run startup:preflight` and then the relevant audit command from its checklist.

## Startup Candle Cache

The manual runtime can use the validation candle cache as a restart accelerator without treating stale cache as live trader evidence.

- `MANUAL_WATCHLIST_CANDLE_CACHE_MODE` controls the requested cache mode and defaults to `read_write`.
- When startup cache is enabled and the requested mode is `read_write`, the live runtime uses `refresh` mode so provider candles are fetched fresh and written back to disk.
- Startup restore uses a separate replay-mode cache reader to warm levels quickly.
- The UI shows both `Candle Cache` and `Runtime Candle Cache` so operators can see the requested mode versus the live seeding mode.
- Symbols warmed from cache show `levels restored from cache, refreshing candles` until fresh seeding succeeds.

This is intentionally not a full candle warehouse yet. It is a safe restart layer while the longer-term durable candle store is planned in `docs/65_DURABLE_CANDLE_WAREHOUSE_AND_STARTUP_CACHE_PLAN_2026-05-02.md`.
