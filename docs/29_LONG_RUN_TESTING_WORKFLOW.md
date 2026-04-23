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

Important startup note:

- the HTTP UI now binds immediately, before IBKR restore/seeding finishes
- if persisted-symbol restore is still running, the UI should load and runtime status will show startup as `booting`
- activate/deactivate requests are intentionally blocked with `503` until startup reaches `ready`

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
  - alert rows now also carry movement labels / movement percentages, setup-state labels, failure-risk labels, trade-map metadata, barrier-clutter labels, path-quality labels, path-constraint scores, path-window distances, exhaustion labels, dip-buy-quality labels, continuity metadata, AI-origin flags, and follow-through metadata so post-run review can separate early moves from already-stretched ones, compare building/confirmation/continuation versus weakening/failed setups, compare contained setups against elevated-risk ones, compare clean paths against crowded ones, compare tighter first-path windows against cleaner continuation space, compare fresh zones against worn ones, and compare the original alert against what happened afterward
- `session-summary.json`
  - live-updated quick rollup of lifecycle counts, delivery counts, failures, compare entries, diagnostic volume, and per-symbol activity
  - now also carries evaluated follow-through buckets by alert event type plus strongest/weakest evaluated event-type highlights
  - now also carries follow-through grade counts like `strong`, `working`, `stalled`, and `failed`
- `thread-summaries.json`
  - live-updated per-symbol review artifact
  - turns session activity into a compact trader-facing summary for each active symbol
  - now includes latest evaluation context plus alert/evaluation alignment so a symbol can be reviewed by what recently worked or failed, not only by what was posted
  - now includes the latest follow-through grade summary so the newest completed setup can be judged quickly without translating raw return signs by hand
  - now also includes state-change and outcome-disagreement summaries so a repeatedly reactivated symbol can be judged more honestly
  - now also distinguishes `activating` and clearly `observational` symbols from actually noisy ones, so quiet low-output threads are reviewed more fairly
- `thread-clutter-report.json`
  - live-updated deterministic clutter artifact
  - tracks total live posts, trader-critical versus trader-helpful optional posts, alert-to-context ratio, continuity density, recap density, live-state density, and clutter-risk heuristics per symbol
  - now also reflects category-aware optional-live gating, so recap, continuity, and follow-through-state classes can be reviewed separately instead of being treated as one generic context bucket
  - now also treats truly low-context threads as low clutter even if the symbol itself was suppression-heavy internally, so the report stays focused on what actually reached the trader
  - event-family-aware runtime gating now means clutter review is especially useful for comparing `level_touch` / `compression` threads against cleaner directional families like `breakout`
  - now also recognizes controlled reactive watch-mode threads, so snapshot-led `level_touch` / `compression` monitoring can read as intentionally quiet instead of falsely cluttered
  - same-window overlap is now tighter too, so continuity is more likely to yield when live follow-through-state or fresh alert posts already told the trader the active story
  - reactive same-event overlap is tighter too, so a `level_touch` or `compression` setup is less likely to spend multiple optional narration beats in the same short burst window
  - continuity now also matches the triggering event side more strictly, which helps prevent support-style continuity wording from showing up right after a resistance-side alert on the same symbol
  - completed follow-through now owns same-snapshot event narration, so progress-driven live-state / continuity beats are less likely to duplicate an evaluation that already resolved the same event
  - recent Discord delivery failures now temporarily suppress optional narration for that symbol, so review artifacts can separate true signal clutter from short delivery-pressure spirals
  - makes thread clutter measurable instead of subjective
- `trader-thread-recaps.md`
  - live-updated readable recap artifact
  - gives each symbol a short summary with latest alert, latest follow-through, and end-of-session context without needing JSON
- `thread-ai-recaps.md`
  - optional post-run AI per-symbol recap artifact
  - generated with `npm run longrun:ai:summary -- <session-folder>` when `OPENAI_API_KEY` is set
  - turns each deterministic thread summary into a short AI recap without changing the underlying deterministic artifacts
- `session-ai-review.md`
  - optional post-run AI summary artifact
  - generated with `npm run longrun:ai:summary -- <session-folder>` when `OPENAI_API_KEY` is set
  - turns the deterministic session artifacts into a short operator/trader commentary pass
- `session-review.md`
  - live-updated human-readable review artifact
  - summarizes the session verdict, noisiest areas, most dynamic symbols, strongest/weakest evaluated alert families, and what each symbol thread looked like without needing raw JSON
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
- posted continuity updates
- posted live follow-through state changes
- posted symbol recaps
- AI-enhanced symbol recap attempts when that optional layer is enabled

The dedicated diagnostics log is where event-detector reasoning now goes.

That split makes it much easier to answer two different questions:

- operationally, what did the app do
- diagnostically, why did a specific event fire or stay suppressed

The summary artifacts now answer a third question too:

- evaluationally, which alert families have actually been holding up after they fired

And now a fourth:

- operationally over time, which symbols were repeatedly churning through state changes and whether that churn produced useful follow-through

And now a fifth:

- did the latest posted setup actually stay strong, keep working, stall out, or fail after the alert

And now a sixth:

- what mattered next for each still-live symbol and whether the recap/continuity flow stayed aligned with that evolving story

And now a seventh:

- which live thread post categories are trader-critical, which are trader-helpful but optional, and which belong in operator-only review artifacts instead of Discord

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
   - `trader-thread-recaps.md`
   when you want the shortest readable per-symbol recap without opening JSON
8. check:
   - `thread-clutter-report.json`
   when you want the fastest deterministic answer to whether optional context is earning its place in the live symbol thread
9. check:
   - `session-review.md`
   when you want the fastest human-readable verdict on whether the run looked useful or noisy
10. optionally check:
   - `thread-ai-recaps.md`
   when you generated the AI recap layer and want a per-symbol AI pass over the deterministic summaries
11. optionally run:
   - `npm run longrun:ai:summary -- <session-folder>`
   when you want a post-run AI commentary layer over the deterministic artifacts
10. only check:
   - `manual-watchlist-diagnostics.log`
   when the question is specifically about breakout / reclaim / fakeout reasoning
11. only check:
   - `manual-watchlist-full.log`
   if the operational and diagnostic logs still do not explain enough
12. check:
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
- `trader-thread-recaps.md` when you want the shortest readable per-symbol recap
- `session-review.md` when you want the fastest readable summary first
- `human-review-feedback.jsonl` when you already marked alerts as useful, noisy, late, wrong, or strong
- `session-ai-review.md` when you generated the optional AI recap layer and want me to review it too
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
- `follow_through_posted`
- `follow_through_state_posted`
- `continuity_posted`
- `recap_posted`
- `activation_completed`
- `deactivated`
- `restore_failed`

These are meant to answer operational questions quickly:

- did the app really start activation
- did IBKR seeding complete
- did a snapshot post happen
- did an alert actually get routed
- did a setup later get a live follow-through state update or completed follow-through verdict
- did the runtime explain the thread's continuity as the story evolved
- did the runtime emit a recap worth reading instead of forcing raw thread reconstruction
- did an alert get intentionally suppressed because it was duplicate, filtered, or lower-value
- did deactivation complete cleanly

This makes the testing process much less dependent on scrolling back through raw terminal noise.

## What The Session Summary Tracks Per Symbol

`session-summary.json` now keeps a `perSymbol` section so it is easier to answer:

- which symbols were activated most often
- which symbols produced Discord posts
- which symbols produced live follow-through updates in-thread
- which symbols produced live follow-through state changes and continuity posts
- which symbols produced in-session recaps
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
- whether recent evaluated follow-through was confirming or undermining the posted setups
- whether the runtime was adding enough continuity and recap context during the session instead of only at the end

## What The Thread Summaries Are For

`thread-summaries.json` is the shortest useful artifact for end-user review.

It gives each active symbol a compact narrative such as:

- whether the symbol ended active or inactive
- a usefulness score and verdict
- how many snapshots and alerts were posted
- which alert families dominated
- which suppression reasons dominated
- what the latest posted alert looked like, including whether room was `tight`, `limited`, or `open`
- what the latest posted alert looked like, including whether path quality stayed `clean`, `layered`, or `choppy`
- whether the latest zone context still looked `fresh`, `tested`, `worn`, or `spent`
- whether the latest alert came from a `firm` or `tired` zone context
- whether tactical zone fatigue was helping or hurting the setup instead of only being described textually
- what the latest evaluated follow-through looked like when the runtime already has outcome data
- whether the latest evaluated setup finished `strong`, `working`, `stalled`, or `failed`
- what the latest live follow-through state update said while the setup was still developing
- what the latest continuity update said about the thread lifecycle
- what the latest live follow-through post told the trader after the original alert
- whether optional context was being posted because the story was genuinely evolving or just because the thread had not yet hit a generic cooldown
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
- `trader-thread-recaps.md`
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

## Current Live-Post Discipline

Live thread posting is intentionally stricter than the raw runtime evaluation stream.

- `breakout`, `breakdown`, and `reclaim` families can still earn a fuller live continuity story when the setup genuinely advances.
- `level_touch` and `compression` families now get a much narrower continuity / recap / live-state budget.
- `rejection`, `fake_breakout`, and `fake_breakdown` now also sit on a tighter optional-post budget than clean directional resolution families, because they are easier to over-narrate before price has really proven the move.
- continuity, recap, live-state, and follow-through narration now also share a short burst budget, so one symbol is less likely to spray a same-window cluster of trader-facing updates.
- reactive same-event watch-mode families are tighter again, so once a `level_touch` or `compression` setup has already used one optional narration beat in the current burst window, the runtime is much less willing to spend another optional restatement on that same event immediately afterward.
- reactive same-event watch-mode families now also look at in-flight optional posts before the first route resolves, so a continuity beat and a live-state beat are less likely to race each other into the same short burst window.
- continuity now also yields more aggressively to fresh trader-critical beats, and same-label continuity transitions are collapsed even if they arrive before the first route resolves.
- if a price-update snapshot already contains a completed evaluation for the same symbol and event type, the completed follow-through post owns that story and weaker progress-driven narration is skipped.
- recent Discord delivery failures now trigger a short optional-post backoff for that symbol, so the runtime is less likely to push more continuity / live-state / recap posts into a fresh 429 burst.
- The review artifacts are meant to tell us when that discipline is helping versus when a family still needs tighter or looser thresholds.

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
