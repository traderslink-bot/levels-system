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
  - written live during the session
- `manual-watchlist-operational.log`
  - the main high-signal review log
  - includes lifecycle events, delivery audit events, compare output, and failures
- `manual-watchlist-filtered.log`
  - compatibility alias of the operational review stream
  - written live during the session
- `manual-watchlist-diagnostics.log`
  - dedicated diagnostic reasoning log
  - mostly `monitoring_event_diagnostic` entries
- `discord-delivery-audit.jsonl`
  - append-only local record of thread creation plus snapshot / alert / extension delivery attempts
  - includes both successful and failed downstream posts
- `session-summary.json`
  - live-updated quick rollup of lifecycle counts, delivery counts, failures, compare entries, diagnostic volume, and per-symbol activity
- `thread-summaries.json`
  - live-updated per-symbol review artifact
  - turns session activity into a compact trader-facing summary for each active symbol
- `session-review.md`
  - live-updated human-readable review artifact
  - summarizes the session verdict, noisiest areas, and what each symbol thread looked like without needing raw JSON
- `human-review-feedback.jsonl`
  - optional human feedback file for marking symbols or alerts as `useful`, `strong`, `noisy`, `late`, or `wrong`
- `session-info.txt`
  - start time, end time, log paths, and runtime URL

## What Appears In The Filtered Log

The operational log is now the main review artifact.

It is intended to capture:

- server startup confirmation
- provider-path confirmation
- structured `manual_watchlist_lifecycle` events
- structured `discord_delivery_audit` events
- compact `opportunity_snapshot` and `evaluation_update` lines
- compare-mode output
- activation failures
- seeding failures
- symbol-restore failures
- IBKR errors

The dedicated diagnostics log is where event-detector reasoning now goes.

That split makes it much easier to answer two different questions:

- operationally, what did the app do
- diagnostically, why did a specific event fire or stay suppressed

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
- if a thread is clearly useful, noisy, late, wrong, or especially strong, record feedback with:
  - `scripts/add-long-run-review-feedback.ps1`

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
   - `manual-watchlist-operational.log`
5. check:
   - `session-summary.json`
   for a fast high-level view of the session
6. check:
   - `thread-summaries.json`
   when you want the shortest per-symbol explanation of what each thread actually did
7. check:
   - `session-review.md`
   when you want the fastest human-readable verdict on whether the run looked useful or noisy
8. only check:
   - `manual-watchlist-diagnostics.log`
   when the question is specifically about breakout / reclaim / fakeout reasoning
9. only check:
   - `manual-watchlist-full.log`
   if the operational and diagnostic logs still do not explain enough
10. check:
   - `discord-delivery-audit.jsonl`
   when you want to confirm exactly what Discord received or whether a post failed downstream

## What To Share When You Want Help

When asking me to review a long-run failure, the most useful things to send are:

- the symbol
- what you tried to do
- what the UI showed
- the newest `manual-watchlist-operational.log`
- `session-summary.json` when you want a quick top-level review first
- `thread-summaries.json` when you want the quickest per-symbol usefulness review
- `session-review.md` when you want the fastest readable summary first
- `human-review-feedback.jsonl` when you already marked alerts as useful, noisy, late, wrong, or strong
- `manual-watchlist-diagnostics.log` when the question is about detector reasoning
- `discord-delivery-audit.jsonl` when the question is about missing, noisy, or confusing Discord output
- optionally `session-info.txt`

That is usually enough for me to reconstruct the issue without needing the entire noisy runtime console.

## What The New Lifecycle Events Mean

The filtered log now includes structured lifecycle markers such as:

- `activation_queued`
- `activation_started`
- `levels_seeded`
- `thread_ready`
- `snapshot_posted`
- `extension_posted`
- `alert_posted`
- `alert_suppressed`
- `activation_completed`
- `deactivated`
- `restore_failed`

These are meant to answer operational questions quickly:

- did the app really start activation
- did IBKR seeding complete
- did a snapshot post happen
- did an alert actually get routed
- did an alert get intentionally suppressed because it was duplicate, filtered, or lower-value
- did deactivation complete cleanly

This makes the testing process much less dependent on scrolling back through raw terminal noise.

## What The Session Summary Tracks Per Symbol

`session-summary.json` now keeps a `perSymbol` section so it is easier to answer:

- which symbols were activated most often
- which symbols produced Discord posts
- which symbols generated the most diagnostics
- which symbols hit activation, seed, or restore failures
- which symbols produced opportunity snapshots and evaluation updates
- which alert families each symbol actually posted
- which suppression reasons dominated for each symbol
- what human review feedback has already been recorded

That means a long session can now be reviewed both:

- at the whole-session level
- at the individual-symbol level

## What The Session Summary Is For

The session summary is the fastest way to see the shape of a run.

It keeps a rolling view of things like:

- active symbol count
- lifecycle event counts
- alert-post counts
- alert-suppression counts
- alert families by volume
- suppression reasons by volume
- Discord delivery posted vs failed
- per-operation delivery counts
- activation / restore / seed / IBKR failure counts
- compare entry count
- diagnostic entry volume
- session-level usefulness score and verdict
- noisiest symbols by combined suppression / diagnostic pressure

This is useful when you want a quick answer like:

- did this session have any real failures
- was Discord posting healthy
- was this session mostly quiet or extremely diagnostic-heavy
- which alert families became the noisiest
- whether the session looked broadly useful, mixed, noisy, or in need of attention

## What The Thread Summaries Are For

`thread-summaries.json` is the shortest useful artifact for end-user review.

It gives each active symbol a compact narrative such as:

- whether the symbol ended active or inactive
- a usefulness score and verdict
- how many snapshots and alerts were posted
- which alert families dominated
- which suppression reasons dominated
- what the latest posted alert looked like, including whether room was `tight`, `limited`, or `open`
- what the end-of-session summary says about the thread overall
- whether any human review feedback was already recorded
- whether delivery or runtime failures showed up

This is meant to answer the practical question:

- if I opened this Discord thread later, would it look useful or mostly noisy

## What The Session Review Is For

`session-review.md` is the fastest artifact to read after a long run.

It turns the JSON summary and thread summaries into a short human-readable review so you can answer:

- did this session look broadly useful or mostly noisy
- which symbols were the most promising
- which symbols need attention before trusting them
- what should we review next without reading raw JSON first

## How The Human Review Loop Fits In

The long-run workflow now supports optional human review feedback through:

- `scripts/add-long-run-review-feedback.ps1`

That script appends entries to:

- `human-review-feedback.jsonl`

When the session is still running, the launcher will fold those entries into:

- `session-summary.json`
- `thread-summaries.json`
- `session-review.md`

Use that loop when you want to mark a thread or alert as:

- useful
- strong
- noisy
- late
- wrong

## What The Discord Audit File Is For

The Discord audit file is the local proof of downstream delivery.

Use it when you want to answer questions like:

- was the thread newly created or reused
- did the initial level snapshot really post
- did a trader-facing alert get sent
- did an extension post happen
- was there a downstream Discord failure even though the runtime stayed alive

This is especially useful when judging whether Discord output is helpful or too noisy for the end user, because it gives a clean record of what was actually sent instead of only what the runtime evaluated.

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
4. later review `session-summary.json` and `manual-watchlist-operational.log`
5. only open `manual-watchlist-diagnostics.log` if the question is about event logic
6. bring me those artifacts when you want help diagnosing it
