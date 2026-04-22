# Long-Run Testing Workflow

## Purpose

This document explains the full recommended testing process for the manual watchlist runtime when the goal is to:

- run the app over a long period of time
- activate and deactivate real symbols during the session
- capture enough evidence to debug runtime issues later
- make it easy to review failures together without relying on terminal scrollback

This is the main testing workflow to use when we want to learn from real runtime behavior instead of only relying on unit tests.

## What This Process Is For

Use this workflow when you want to test things like:

- symbol activation and reactivation
- IBKR seeding stability
- snapshot posting behavior
- runtime compare behavior
- breakout, breakdown, fakeout, and reclaim decisions
- long-session reliability
- whether the app recovers cleanly after IBKR hiccups or restarts

## Prerequisites

Before starting a testing session:

1. Make sure IBKR/TWS or IB Gateway is running and logged in.
2. Make sure the repo dependencies are already installed with:
   - `npm ci`
3. Make sure you want to use the manual runtime UI at:
   - `http://127.0.0.1:3010/`
4. If you already have an old copy of the manual runtime running, do not start a second one manually.

## Recommended Way To Start A Session

Use the desktop launcher created for this machine:

- `C:\Users\jerac\Desktop\Levels System Long Run Test.bat`

That batch file runs the repo launcher:

- `scripts/start-manual-watchlist-long-run.ps1`

## What The Launcher Does

When you start the long-run launcher, it will:

1. create a timestamped session directory under:
   - `artifacts/long-run/<timestamp>/`
2. check whether something is already listening on:
   - `127.0.0.1:3010`
3. stop the older manual runtime if it recognizes that process as this app's `watchlist:manual` server
4. leave unrelated processes alone if some other program is using that port
5. enable `LEVEL_MONITORING_EVENT_DIAGNOSTICS=1` by default
6. start:
   - `npm run watchlist:manual`
7. open:
   - `http://127.0.0.1:3010/`
8. write a full session log
9. write a smaller filtered review log
10. write simple session metadata

## Why It Stops An Older Runtime

Yes: the launcher is intentionally supposed to stop an older copy of the manual runtime before starting a new one.

That is the correct behavior because it:

- prevents `EADDRINUSE` port conflicts
- avoids accidentally testing the wrong hidden runtime window
- keeps the logs matched to the runtime you actually launched

Safety rule:

- it only auto-stops the process when it looks like this app's manual runtime
- if some unrelated process is using `3010`, it stops and tells you to handle that process manually

## What Files Each Session Creates

Each long-run session creates a folder like:

- `artifacts/long-run/2026-04-22_10-30-00/`

Inside that folder:

- `manual-watchlist-full.log`
  - complete runtime stdout/stderr
- `manual-watchlist-filtered.log`
  - smaller review log with the most useful lines
- `session-info.txt`
  - start time, end time, log paths, and runtime URL

## What Appears In The Filtered Log

The filtered log is the main review artifact.

It is intended to capture:

- server startup confirmation
- provider-path confirmation
- compare-mode output
- filtered monitoring diagnostics
- activation failures
- seeding failures
- symbol-restore failures
- IBKR errors

This file is much better for review than the raw terminal output.

## Recommended Testing Process During A Session

### 1. Start The Session

- launch the desktop batch file
- wait for the browser UI to open
- confirm the runtime is responding in the UI

### 2. Use The App Normally

During the session, do real testing such as:

- add a symbol
- wait for activation
- deactivate it
- reactivate it
- add a second symbol while another one is active
- leave the app running while the market moves
- note anything that looks wrong in the UI

### 3. Keep Simple Notes

If something odd happens, note:

- the symbol
- the rough time
- what you were trying to do
- what the UI showed

Even a short note like:

- `AGPU failed after deactivate/reactivate around 9:15 AM`

is enough to make later log review much easier.

### 4. Let It Run

The point of this workflow is not only one-off actions.

It is also to learn whether the runtime stays healthy over time, including:

- repeated activations
- longer uptime
- IBKR reconnect behavior
- whether failures are random or repeatable

## When Diagnostics Should Stay On

Default long-run testing should leave diagnostics on.

That is now safe because the diagnostic stream is filtered.

Diagnostics are especially helpful when:

- a symbol activation fails
- a symbol activates after a restart but not before one
- breakout or reclaim behavior looks wrong
- compare-mode output looks suspicious

## If You Want A Quieter Session

If you want to run the same workflow without filtered monitoring diagnostics:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-manual-watchlist-long-run.ps1 -DisableDiagnostics
```

## What To Do If Something Goes Wrong

If the app behaves oddly:

1. do not immediately assume the UI tells the whole story
2. note the symbol and rough time
3. open the newest folder under:
   - `artifacts/long-run/`
4. check:
   - `manual-watchlist-filtered.log`
5. only check:
   - `manual-watchlist-full.log`
   if the filtered log does not explain enough

## What To Share When You Want Help

When asking me to review a long-run failure, the most useful things to send are:

- the symbol
- what you tried to do
- what the UI showed
- the newest `manual-watchlist-filtered.log`
- optionally `session-info.txt`

That is usually enough for me to reconstruct the issue without needing the entire noisy runtime console.

## What This Process Does Not Replace

This workflow is for operational runtime testing.

It does not replace:

- `npm run check`
- targeted unit tests
- focused compare-mode experiments
- one-off scripted validation runs

Instead, it complements them by giving us real runtime evidence over time.

## Best Practical Routine

The simplest good routine is:

1. start the desktop long-run launcher
2. use the app normally through the day or through a longer test block
3. if something weird happens, note the symbol and time
4. later review the newest filtered log
5. bring me that filtered log when you want help diagnosing it
