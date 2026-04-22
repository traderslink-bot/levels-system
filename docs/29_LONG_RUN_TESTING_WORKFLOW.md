# Long-Run Testing Workflow

## Purpose

This workflow is for multi-hour or repeat-session manual runtime testing where the main goal is:

- keep the app running in a stable way
- capture enough logs for later review
- avoid losing important failures in live terminal scrollback

## Recommended Launcher

Use the repo launcher:

- `scripts/start-manual-watchlist-long-run.ps1`

Or use the desktop shortcut batch file created for this machine:

- `C:\Users\jerac\Desktop\Levels System Long Run Test.bat`

## What The Launcher Does

The launcher:

1. creates a timestamped session directory under:
   - `artifacts/long-run/<timestamp>/`
2. stops an older `watchlist:manual` runtime if it is already using `127.0.0.1:3010`
3. enables `LEVEL_MONITORING_EVENT_DIAGNOSTICS=1` by default
4. starts `npm run watchlist:manual`
5. opens the UI at:
   - `http://127.0.0.1:3010/`
6. writes:
   - full runtime output
   - filtered high-signal output
   - simple session metadata

## Session Files

Each session writes:

- `manual-watchlist-full.log`
  - complete stdout/stderr stream from the runtime
- `manual-watchlist-filtered.log`
  - only the lines most useful for review:
    - startup confirmation
    - compare-mode lines
    - filtered monitoring diagnostics
    - activation failures
    - seeding failures
    - restore failures
    - IBKR errors
- `session-info.txt`
  - session start/end metadata and log paths

## Default Behavior

The launcher keeps the live console readable by only printing the filtered lines in the terminal window.

The full unfiltered output is still preserved in the session directory if deeper review is needed later.

## When To Use Diagnostics

Default long-run testing should leave diagnostics on because they are now filtered.

Diagnostics help most when:

- a symbol activation fails
- breakout or reclaim behavior feels wrong
- compare-mode or live monitoring decisions need explanation

If a session should be quieter, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-manual-watchlist-long-run.ps1 -DisableDiagnostics
```

## Review Workflow

After a failure or odd behavior:

1. note the symbol and rough time
2. open the newest session directory under `artifacts/long-run/`
3. check `manual-watchlist-filtered.log` first
4. only use `manual-watchlist-full.log` if the filtered log is not enough

## Best Practice For Collaboration

When asking for help on a long-run issue, the most useful thing to share is:

- the affected symbol
- what you tried to do
- the newest `manual-watchlist-filtered.log`
- optionally the matching `session-info.txt`

That should usually be enough to reconstruct what happened without needing the full noisy runtime stream.
