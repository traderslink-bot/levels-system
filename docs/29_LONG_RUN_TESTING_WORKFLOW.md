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
- activation seeding is also timeout-bounded now, so a symbol that hangs in the seed/refresh path should fail explicitly instead of staying in `refresh_pending` forever

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
  - trader-critical `post_alert` failures now get one downstream retry; successful retries include `retryAttempt`, `retryOf`, and `retryReason`
  - alert rows now also carry movement labels / movement percentages, setup-state labels, failure-risk labels, trade-map metadata, barrier-clutter labels, path-quality labels, path-constraint scores, path-window distances, exhaustion labels, dip-buy-quality labels, continuity metadata, AI-origin flags, and follow-through metadata so post-run review can separate early moves from already-stretched ones, compare building/confirmation/continuation versus weakening/failed setups, compare contained setups against elevated-risk ones, compare clean paths against crowded ones, compare tighter first-path windows against cleaner continuation space, compare fresh zones against worn ones, and compare the original alert against what happened afterward
  - tight cluster-cross level updates include `crossedLevels`, `clusterLow`, `clusterHigh`, and `clusteredLevelClear`, so audits can prove the runtime grouped nearby levels without hiding them
  - repeated identical extension payloads should now stop after the first post until the extension ladder actually changes, which makes it easier to spot genuine extension movement instead of repeated next-level restatements
  - live Discord text should stay trader-view only: system-shaped labels, severity/confidence scoring, and operator/testing wording belong in this audit/review stream rather than in visible posts
- `session-summary.json`
  - live-updated quick rollup of lifecycle counts, delivery counts, failures, compare entries, diagnostic volume, and per-symbol activity
  - now also refreshes from `discord-delivery-audit.jsonl`, so it should keep moving even after runtime stdout goes quiet
  - now also carries evaluated follow-through buckets by alert event type plus strongest/weakest evaluated event-type highlights
  - now also carries follow-through grade counts like `strong`, `working`, `stalled`, and `failed`
- `thread-summaries.json`
  - live-updated per-symbol review artifact
  - now also keeps refreshing from the delivery audit stream when Discord activity continues after console output quiets down
  - turns session activity into a compact trader-facing summary for each active symbol
  - now includes latest evaluation context plus alert/evaluation alignment so a symbol can be reviewed by what recently worked or failed, not only by what was posted
  - now includes the latest follow-through grade summary so the newest completed setup can be judged quickly without translating raw return signs by hand
  - now also includes state-change and outcome-disagreement summaries so a repeatedly reactivated symbol can be judged more honestly
  - now also distinguishes `activating` and clearly `observational` symbols from actually noisy ones, so quiet low-output threads are reviewed more fairly
  - startup-pending symbols with no visible trader output yet are now treated more neutrally too, so a thread that is still seeding or waiting for its first visible post is less likely to be mislabeled as `noisy`
  - startup-pending symbols now also get a neutral review floor, so the verdict is less likely to contradict the `activating` status when the runtime simply has not produced visible trader-facing output yet
  - `refresh_pending` symbols with no visible trader output now also stay closer to a pending/neutral read instead of being mislabeled as noisy just because seeding or refresh has not completed yet
- `thread-clutter-report.json`
  - live-updated deterministic clutter artifact
  - now also keeps refreshing from the delivery audit stream when live posting continues after console output quiets down
  - tracks total live posts, trader-critical versus trader-helpful optional posts, alert-to-context ratio, continuity density, recap density, live-state density, and clutter-risk heuristics per symbol
  - now also reflects category-aware optional-live gating, so recap, continuity, and follow-through-state classes can be reviewed separately instead of being treated as one generic context bucket
  - now also treats truly low-context threads as low clutter even if the symbol itself was suppression-heavy internally, so the report stays focused on what actually reached the trader
  - event-family-aware runtime gating now means clutter review is especially useful for comparing `level_touch` / `compression` threads against cleaner directional families like `breakout`
  - now also recognizes controlled reactive watch-mode threads, so snapshot-led `level_touch` / `compression` monitoring can read as intentionally quiet instead of falsely cluttered
  - same-window overlap is now tighter too, so continuity is more likely to yield when live follow-through-state or fresh alert posts already told the trader the active story
  - same-zone alert reposting is now intentionally stricter too, so the clutter report should trend down when a symbol keeps revisiting the same structural level without offering meaningfully new trader information
  - reactive same-event overlap is tighter too, so a `level_touch` or `compression` setup is less likely to spend multiple optional narration beats in the same short burst window
  - continuity now also matches the triggering event side more strictly, which helps prevent support-style continuity wording from showing up right after a resistance-side alert on the same symbol
  - completed follow-through now owns same-snapshot event narration, so progress-driven live-state / continuity beats are less likely to duplicate an evaluation that already resolved the same event
  - recent Discord delivery failures now temporarily suppress optional narration for that symbol, so review artifacts can separate true signal clutter from short delivery-pressure spirals
  - makes thread clutter measurable instead of subjective
- `thread-post-policy-report.json`
  - generated from `discord-delivery-audit.jsonl` at shutdown, or manually with `npm run longrun:audit:reports -- <session-folder>`
  - summarizes trader-critical versus optional posts, repeated same-story clusters, failed delivery counts, and per-symbol thread trust scores
  - is the fastest artifact for spotting whether a runner like ATER or BIYA is repeating the same outcome too many times after the live thread already told the story
- `thread-post-policy-report.md`
  - readable version of the policy report
  - best first file when you want to quickly see the weakest thread, biggest repeated story, biggest post burst, and concrete tuning recommendation
- `snapshot-audit-report.json`
  - generated from `discord-delivery-audit.jsonl` at shutdown, or manually with `npm run longrun:audit:reports -- <session-folder>`
  - summarizes which snapshot levels displayed and which levels were omitted because they were compacted, already on the wrong side of price, or outside the forward planning range
  - is the fastest artifact for diagnosing ATER-style questions about whether an apparent missing resistance was absent from generated candidates or intentionally omitted from the trader-facing ladder
- `snapshot-audit-report.md`
  - readable version of the snapshot audit report
  - best first file when the trader-facing snapshot looks like it skipped a support or resistance level
- `trading-day-evidence-report.json`
  - generated from `discord-delivery-audit.jsonl` at shutdown, or manually with `npm run longrun:audit:reports -- <session-folder>`
  - collects hard evidence for critical delivery failures, role-flip candidates, cluster-cross candidates, and trader-language examples
  - includes severity labels (`blocker`, `major`, `watch`, `historical_only`, `data_quality_only`) so audit findings do not all look equally urgent
  - treats trader-critical failed `post_alert` rows as major unless retry is proven; an equivalent later post is context, not proof of retry
  - ignores already-clustered level-clear posts as unresolved cluster-cross overposting when the audit metadata proves the grouped story carried each crossed level
- `trading-day-evidence-report.md`
  - readable evidence appendix for the audit process
  - best file for proving findings with saved Discord excerpts instead of relying on summary language
- `long-run-tuning-suggestions.json`
  - generated from the policy and snapshot audit reports at shutdown, or manually with `npm run longrun:audit:reports -- <session-folder>`
  - turns repeated-story clusters, post bursts, optional-density pressure, delivery failures, and level-audit warnings into action/watch/info items
- `long-run-tuning-suggestions.md`
  - readable version of the tuning suggestions
  - best first file when you want the system to tell you which problems deserve attention before manually scanning every report
- `live-post-replay-simulation.json`
  - generated from `discord-delivery-audit.jsonl` at shutdown, or manually with `npm run longrun:simulate:posts -- <session-folder>`
  - replays the saved post stream through the current calmer posting rules and estimates which old posts would now be suppressed
- `live-post-replay-simulation.md`
  - readable before/after replay summary
  - best first file when we want to judge whether the current policy would have calmed an ATER / BIYA-style runner without reading raw Discord posts
- `live-post-profile-comparison.json`
  - generated from `discord-delivery-audit.jsonl` by `npm run longrun:simulate:posts -- <session-folder>`
  - compares `quiet`, `balanced`, and `active` profiles against the same saved session
- `live-post-profile-comparison.md`
  - readable profile comparison table
  - best first file when deciding whether the app should post less or more before changing `.env`
- `runner-story-report.json`
  - generated from the saved delivery audit by `npm run longrun:simulate:posts -- <session-folder> --symbols ATER,BIYA`
  - summarizes rough price path, post mix, post quality labels, noisy-repeat samples, candidate missed level clears/losses, levels mentioned, and key posted events for high-activity symbols
- `runner-story-report.md`
  - readable operator story report
  - useful for runner reviews, but not a chart replacement because it infers prices and levels from saved Discord/audit text; missed-event rows are candidates that deserve review, not proof the runtime saw every tick
- `trader-thread-recaps.md`
  - live-updated readable recap artifact
  - now also keeps refreshing when new Discord delivery rows arrive after stdout quiets down
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
  - now also keeps refreshing from the delivery audit stream, so the human-readable review should not freeze early if the runtime stays quiet while Discord posting continues
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

Important launcher behavior note:

- review artifacts are no longer tied only to new runtime stdout lines
- if Discord delivery keeps happening after console output goes quiet, the launcher now refreshes summaries from `discord-delivery-audit.jsonl` so session review does not freeze early

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
   - `thread-post-policy-report.md`
   when you want the fastest readable answer to repeated same-story posts, optional-post load, and per-thread trust score
10. check:
   - `thread-post-policy-report.json`
   when you want the structured data behind the readable policy report
11. check:
   - `snapshot-audit-report.md`
   when the question is about omitted, compacted, crossed, or out-of-range support/resistance levels
12. check:
   - `snapshot-audit-report.json`
   when you want the structured data behind the readable snapshot audit report
13. check:
   - `session-review.md`
   when you want the fastest human-readable verdict on whether the run looked useful or noisy
14. optionally check:
   - `thread-ai-recaps.md`
   when you generated the AI recap layer and want a per-symbol AI pass over the deterministic summaries
15. optionally run:
   - `npm run longrun:ai:summary -- <session-folder>`
   when you want a post-run AI commentary layer over the deterministic artifacts
16. optionally run:
   - `npm run longrun:audit:reports -- <session-folder>`
   when you want to regenerate the policy and snapshot audit reports from the latest Discord audit file
17. only check:
   - `manual-watchlist-diagnostics.log`
   when the question is specifically about breakout / reclaim / fakeout reasoning
18. only check:
   - `manual-watchlist-full.log`
   if the operational and diagnostic logs still do not explain enough
19. check:
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
- `thread-post-policy-report.md` when the issue is too many repeated posts, too much optional narration, or thread trust
- `thread-post-policy-report.json` when the issue is too many repeated posts, too much optional narration, or thread trust
- `snapshot-audit-report.md` when the issue is missing-looking support/resistance levels
- `snapshot-audit-report.json` when the issue is missing-looking support/resistance levels
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
- which support/resistance candidates were displayed versus compacted or filtered from a snapshot
- whether an apparent missing level was already crossed, outside the forward planning range, or simply folded into a nearby stronger level
- did a trader-facing alert get sent
- did an extension post happen
- was there a downstream Discord failure even though the runtime stayed alive

This is especially useful when judging whether Discord output is helpful or too noisy for the end user, because it gives a clean record of what was actually sent instead of only what the runtime evaluated.
Snapshot audit details are intentionally kept in this artifact rather than posted into Discord, so trader-facing threads stay readable while level-ladder questions remain debuggable.

## Regenerating Audit Reports

The long-run launcher generates policy and snapshot audit reports at shutdown. You can also rebuild them at any time from an existing session folder:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\<session-folder>
```

That writes:

- `thread-post-policy-report.json`
- `snapshot-audit-report.json`
- `thread-post-policy-report.md`
- `snapshot-audit-report.md`
- `long-run-tuning-suggestions.json`
- `long-run-tuning-suggestions.md`
- `live-post-replay-simulation.json`
- `live-post-replay-simulation.md`
- `live-post-profile-comparison.json`
- `live-post-profile-comparison.md`
- `runner-story-report.json`
- `runner-story-report.md`

Use the tuning suggestions first when you want a quick action list. Use the policy report before reading raw audit rows when the question is "did this symbol post too many repeated versions of the same thing?" Use the snapshot report before reading raw audit rows when the question is "why did this level not show in the Discord snapshot?"

You can also run only the replay simulator:

```powershell
npm run longrun:simulate:posts -- artifacts\long-run\<session-folder>
```

Use `--profile quiet|balanced|active` to replay a single live profile and `--symbols ATER,BIYA` to narrow the runner-story report:

```powershell
npm run longrun:simulate:posts -- artifacts\long-run\<session-folder> --profile balanced --symbols ATER,BIYA
```

The replay simulator is operator-only. Its job is to estimate how many saved Discord posts the selected policy would suppress, compare profile choices, summarize runner stories, classify saved posts by usefulness, and flag candidate missed level events. It does not change the saved Discord thread or rewrite history.

## Runtime Review Panel

The manual UI includes a `Review Artifacts` section. During long-run sessions it lists the known review files in the current session folder, shows whether each file exists yet, and previews generated Markdown/JSON artifacts such as:

- `session-review.md`
- `thread-post-policy-report.md`
- `long-run-tuning-suggestions.md`
- `live-post-replay-simulation.md`
- `live-post-profile-comparison.md`
- `runner-story-report.md`
- `snapshot-audit-report.md`

This is an operator convenience surface only; it does not change what gets posted to Discord.

## Level Quality Audit

When a runner appears to have too few forward levels or the next resistance/support looks suspiciously far away, run:

```powershell
npm run validation:levels:quality -- <SYMBOL> [output-json-path]
```

The audit checks the generated ladder for missing forward levels, wide first gaps, thin forward ladders, and extension-only forward ladders. It is meant to catch ATER-style "did we miss older daily resistance?" questions before changing level-engine tuning by feel.

When reviewing Discord posts after a live run, also verify the running app version before treating a post as a current-code bug:

- note the active session folder and runtime start time from `/api/runtime/status`
- note the latest local commit with `git log --oneline -3`
- separate posts produced before the latest restart from posts produced after the latest code was loaded
- for every resistance/support crossed post, confirm the trader-facing text shows both the crossed level and the next relevant level clearly
- if a post says risk opens toward a far support/resistance, check whether the crossed level should first be shown as the hold/reclaim area
- if no next resistance/support appears, investigate whether the ladder truly had no next level, whether display/ranking hid it, or whether the post came from stale runtime code

## Current Live-Post Discipline

Live thread posting is intentionally stricter than the raw runtime evaluation stream.

- `breakout`, `breakdown`, and `reclaim` families can still earn a fuller live continuity story when the setup genuinely advances.
- `level_touch` and `compression` families now get a much narrower continuity / recap / live-state budget.
- `rejection`, `fake_breakout`, and `fake_breakdown` now also sit on a tighter optional-post budget than clean directional resolution families, because they are easier to over-narrate before price has really proven the move.
- continuity, recap, live-state, and follow-through narration now also share a short burst budget, so one symbol is less likely to spray a same-window cluster of trader-facing updates.
- reactive same-event watch-mode families are tighter again, so once a `level_touch` or `compression` setup has already used one optional narration beat in the current burst window, the runtime is much less willing to spend another optional restatement on that same event immediately afterward.
- reactive same-event watch-mode families now also look at in-flight optional posts before the first route resolves, so a continuity beat and a live-state beat are less likely to race each other into the same short burst window.
- optional continuity and live-state posts now also pause briefly before routing in the real runtime, which gives a fresh trader-critical alert a chance to preempt weaker narration when both are about to speak in the same small window.
- continuity now also yields more aggressively to fresh trader-critical beats, and same-label continuity transitions are collapsed even if they arrive before the first route resolves.
- if a price-update snapshot already contains a completed evaluation for the same symbol and event type, the completed follow-through post owns that story and weaker progress-driven narration is skipped.
- recent Discord delivery failures now trigger a short optional-post backoff for that symbol, so the runtime is less likely to push more continuity / live-state / recap posts into a fresh 429 burst.
- completed follow-through posts now also use a dedicated same-story policy helper, so repeated same-symbol, same-event, same-level outcomes stay suppressed unless the label changes or the directional move has materially changed.
- completed follow-through posts now require stronger same-level evidence before repeating, avoid weak label drift, and keep material-repeat context in metadata rather than trader-facing Discord copy.
- trader-facing Discord copy is now treated as trader-view only; testing/operator details belong in audit logs, policy reports, replay/simulation artifacts, diagnostics, and the runtime UI.
- a critical live-post burst governor now suppresses lower-value critical repeats when a symbol already posted several trader-facing updates in a short window, while still allowing major changes through.
- live AI reads now use a dedicated same-story policy helper too, so low-value or in-flight duplicate AI commentary is kept out of Discord while deterministic alerts remain the source of truth.
- live AI reads also pass through optional-post and narration-burst discipline before the OpenAI call, so reactive or recap-like AI output stays out of already-busy threads.
- live AI reads are profile-aware and only post for higher-value deterministic alerts, so AI commentary remains a support layer instead of becoming a second noisy stream.
- `WATCHLIST_POSTING_PROFILE=quiet|balanced|active` controls the runtime post appetite. Use `balanced` by default, `quiet` when runner threads are still too busy, and `active` when live testing shows useful posts are being missed.
- `live-post-profile-comparison.md` should be checked before changing the live profile because it shows expected post counts for the same saved session under all three profiles.
- `runner-story-report.md` summarizes high-activity symbols by rough price path, post mix, post quality, key posted events, noisy samples, candidate missed level events, and frequently mentioned levels. Treat it as an operator triage aid, not a replacement for chart review, because it infers prices and levels from saved audit/post text.
- Fast resistance-cleared and support-lost posts are intentionally ladder-step based. If price jumps through several levels, the runtime should post the next crossed level first, then advance to the next crossed level on the following live update instead of skipping straight to the farthest crossed level.
- optional continuity, recap, and live follow-through-state decisions now flow through the same policy helper module, so those chatter-control rules can be tested directly instead of only through full runtime tests.
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
