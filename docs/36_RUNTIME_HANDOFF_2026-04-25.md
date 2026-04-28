# Runtime Handoff - 2026-04-25

## Purpose

This note is for the next chat so the current manual-watchlist runtime state does not need to be rediscovered from logs, Discord, and ad-hoc repros.

## Current Branch / Status

- Repo: `levels-system`
- Active branch: `codex/runtime-compare-tooling`
- Latest shipped fix before this handoff:
  - `fbea110` - `Extend manual runtime IBKR activation timeout`

## What Was Just Stabilized

### 1. Finnhub first-thread opener is live

Newly created Discord threads now get a pre-level stock-context opener before level generation finishes when `FINNHUB_API_KEY` is present.

Current intended opener behavior:

- ticker-specific data only
- no Finnhub news in this thread
- labeled fields
- clickable website URL
- Discord embed preview suppressed so the website stays a one-line text link

Relevant files:

- `src/lib/stock-context/finnhub-client.ts`
- `src/lib/stock-context/finnhub-thread-preview.ts`
- `src/scripts/run-finnhub-thread-preview.ts`
- `src/tests/finnhub-thread-preview.test.ts`
- `src/lib/alerts/discord-rest-thread-gateway.ts`
- `src/runtime/manual-watchlist-server.ts`

Current approved field set:

- company name
- exchange
- industry
- country
- website
- market cap

Explicitly removed from the live opener:

- Finnhub news
- `STOCK CONTEXT: SYMBOL`
- `TICKER: SYMBOL`
- Finnhub quote/price fields such as current price, percent change, open, high, low, and previous close
- shares outstanding
- IPO date

### 2. Manual runtime startup behavior is better

Manual runtime behavior was tightened so:

- the HTTP server binds immediately
- `startupState=ready` now means IBKR is connected, even if slower restore work is still finishing
- deactivation is allowed during startup
- activation is no longer blocked behind the entire restore pass

Relevant file:

- `src/runtime/manual-watchlist-server.ts`

### 3. Slow queued activations are more tolerant, but still bounded

Queued activations now:

- create/reuse the Discord thread first
- show an `activating` entry in the active list immediately
- tolerate slow initial seeding through a grace window instead of rolling back on the first timeout
- still fail explicitly if the seed is truly hung

Relevant file:

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`

### 4. Manual runtime now gives IBKR historical seeding more time

The latest live issue was `LIDR`:

- activation started
- thread was created
- symbol did not stay in the active list
- no levels/snapshot showed up

Root cause:

- first activation was timing out in IBKR historical candle seeding
- the manual runtime was still using the provider default `30000ms` timeout
- that made the queued activation roll back and look like it vanished

Current fix:

- manual runtime now uses a longer default IBKR historical timeout of `90000ms`
- configurable through:
  - `MANUAL_WATCHLIST_IBKR_TIMEOUT_MS`

Relevant files:

- `src/runtime/manual-watchlist-server.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/market-data/provider-factory.ts`

## Important Live Findings To Carry Forward

### 1. The system was over-posting "same story" updates

This was most visible in symbols like:

- `AMST`
- `TDIC`
- `AIXI`
- `ITOC`

What was already fixed:

- stricter same-story alert repost windows
- stronger identical `NEXT LEVELS` dedupe
- tighter optional-post gating
- family-aware continuity/live-state throttling
- same-window ownership rules so critical alerts beat weaker narration

Live thread behavior is much better than before, but this should still be validated with regular-hours symbols, not just post-market sessions.

### 2. Post-market sessions are useful, but only for some kinds of validation

Recent sessions were well into post-market, so they were still useful for:

- startup stability
- activation / refresh behavior
- clutter / thread-discipline validation
- Discord delivery behavior
- medium-cap handling checks such as `INTC`

But they are weaker evidence for:

- real breakout conviction
- true volume-backed signal quality
- production tuning of a future volume/activity layer

### 3. `INTC` hang behavior was investigated and improved

The prior issue:

- thread created
- activation started
- symbol sat in `refresh_pending`
- no seed completion, no snapshot, no clear failure

That path was tightened so:

- hung seeds fail explicitly
- refresh-pending review reads more honestly
- the specific `INTC` repro later validated successfully

### 4. Review-layer honesty was tightened a lot

The long-run review now better distinguishes:

- activating
- observational
- refresh-pending
- suppression-heavy but quiet live
- genuinely noisy

This work matters because many recent runtime problems were not only logic bugs; they were also artifact honesty bugs.

## What Is Still Most Worth Improving Next

Stay focused on the current system rather than branching out.

Best next candidates:

1. First-activation robustness and visibility

- Confirm whether slow first activations now stay visible and eventually complete more reliably with the longer manual-runtime IBKR timeout.
- If not, improve how activation failure is surfaced in the UI instead of letting the symbol simply disappear after rollback.

2. Live regular-hours validation

- Re-check thread discipline during regular market hours when symbols actually move with better liquidity.
- The current anti-spam and optional-post rules have been heavily tuned and now need more normal-market evidence, not just post-market evidence.

3. First-thread opener polish, but only if useful

- The Finnhub opener is intentionally minimal now.
- Avoid feature creep here unless the added field clearly helps the trader.
- News should stay separate from this thread for now.

4. Volume/activity layer later, not now

- This remains a strong future upgrade, but it is intentionally parked until the current runtime is more fully trusted.
- Preferred trader-facing wording later:
  - `volume`
  - `activity`
- Avoid wording like:
  - `participation`

## What Not To Do Next

- Do not treat activation speed optimization as permission to reduce structural history depth casually.
- Do not assume a shorter initial history fetch is safe without a stability-validation project.
- Do not re-expand live Discord verbosity after all the recent clutter cleanup.
- Do not add Finnhub news back into the thread opener.
- Do not move AI deeper into live signal selection.

## Good Commands / Checks To Reuse

### Runtime

```powershell
npm run watchlist:manual
```

### Finnhub opener preview

```powershell
npm run finnhub:test -- CAST ELPW SCNI
```

### Full verification

```powershell
npm run check
```

## Docs Already Kept Current

The main docs that should already reflect the current runtime/Finnhub state are:

- `README.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- `docs/32_AI_COMMENTARY_WORKFLOW.md`
- `docs/33_CODEX_RUNTIME_AND_SIGNAL_REVIEW_2026-04-23.md`
- `docs/34_CODEX_EXECUTION_BRIEF_2026-04-23.md`

## First Check To Do In The Next Chat

1. Run the manual runtime on the latest branch.
2. Activate one or two fresh symbols that create new threads.
3. Confirm:
   - they appear in the active list immediately as `activating`
   - the Finnhub opener posts first
   - the symbol stays visible while seeding
   - the first level snapshot eventually lands
4. If a symbol still disappears, inspect whether:
   - IBKR historical seeding still timed out even at `90000ms`
   - the UI is not surfacing activation failure clearly enough

## Summary

The current system is materially better than it was:

- thread clutter is far tighter
- review honesty is stronger
- startup behavior is better
- Finnhub stock-context opening posts are live
- slow queued activations have more tolerance
- manual-runtime IBKR historical timeout is now longer
- Finnhub opener posts no longer include quote/price fields
- snapshot level audit metadata now lives in `discord-delivery-audit.jsonl` for operator review

The next job is not another wide feature pass. The next job is to validate that first activations now behave reliably and visibly enough in live use.
