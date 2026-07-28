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

## When The Market Is Closed

Use the offline small-cap scenario simulator when the market is closed or when there is not enough fresh live data to judge a post-noise change.

Command:

```powershell
npm run scenario:smallcap
npm run stress:all-symbols
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run structure:replay -- --max-files-per-symbol 2
npm run structure:discord-align -- --limit all
npm run engine:capabilities
npm run candles:audit -- data/candles
npm run candles:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:calibrate -- --all-sessions
npm run candles:bulk-sim
npm run candles:import-readiness -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:import-safety -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:import-safety -- --all-sessions
npm run candles:backfill-priority -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:backfill-priority -- --all-sessions
npm run candles:backfill-manifest -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --stage 1
npm run candles:backfill -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles
npm run candles:backfill -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS --max-tasks 8
npm run levels:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run levels:calibrate -- --all-sessions
npm run audit:execution-relations -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data
npm run candles:regression-pack -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:regression-gate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:dynamic-calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:dynamic-calibrate -- --all-sessions
npm run audit:why-no-post -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- --all-sessions
npm run replay:monday -- --skip-slow
```

This writes:

- `artifacts/offline-scenarios/small-cap-scenario-simulation.json`
- `artifacts/offline-scenarios/small-cap-scenario-simulation.md`

The simulator uses deterministic small-cap paths for:

- range chop between practical support and resistance
- base building into resistance
- fake breakout and return into range
- full support-area loss
- reclaim after a flush

It runs those paths through the real monitor, alert intelligence engine, trader formatter, and live-thread post policy. Use it to prove that calmer posting rules suppress repeated same-zone noise without hiding real breakout, support-loss, or reclaim changes.

`npm run replay:monday -- --skip-slow` is the one-command closed-market checklist for the next market-open prep pass. It runs the core build, broad saved-data replay, small-cap scenarios, saved-data regression, latest-session audit reports, post-quality grading, trader-usefulness replay scoring, daily trader review, missed meaningful move audit, why-no-post proof, candle regression gate, dynamic/reference calibration, candle import safety, session behavior/readiness audit, post-reason audit, known-bad pattern scan, and volume replay when a latest session is available. Use the full command without `--skip-slow` when you also want the slower structure replay and stable-structure / Discord alignment checks.

`npm run engine:capabilities` writes `shared-engine-capabilities.json` / `.md` under `artifacts/shared-engine-capabilities`. Use it after shared candle-engine changes to confirm the public boundary, scripts, data dependencies, implemented capabilities, partial capabilities, and planned capabilities are visible in one place.

`npm run candles:audit -- data/candles` writes `candle-warehouse-audit.json` / `.md` under `artifacts/candle-warehouse-audit`. Use it when durable candle warehouse rows exist to check provider/symbol/timeframe groups, duplicate timestamps, invalid OHLC rows, zero-volume rows, and warehouse health.

`npm run candles:calibrate -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-intelligence-calibration.json` / `.md`. Use it after a long-run session to compare saved Discord posts with cached daily / `4h` / `5m` candle evidence and classify `referenceLevels`, `gapStructure`, and `executionRelations` as trusted, watch, experimental, or broken.

`npm run candles:calibrate -- --all-sessions` scans every saved long-run Discord audit file under `artifacts/long-run`. Use this when checking whether a candle-engine change holds across the full evidence set instead of only the latest session.

`npm run candles:bulk-sim` writes `bulk-candle-import-simulation.json` / `.md`. Use it to model months-style imported trade pressure and verify that repeated same-symbol/session/timeframe requests are deduped before any provider fetch.

The bulk simulation and planner now also show provider batches, coalesced trade-request counts, estimated candle counts, avoided task counts, avoided task percent, and largest task size. Use those fields to judge provider pressure before using IBKR or a future provider for bulk trade imports.

`npm run candles:import-readiness -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-import-readiness.json` / `.md`. Use it to estimate how much candle data the durable warehouse can already reuse for a saved session and what provider/symbol/session/timeframe ranges still need backfill. The report includes `Symbol / Session Coverage`, which is the practical checklist for whether a ticker/session is covered, partial, or missing before a replay conclusion is trusted.

`npm run candles:import-safety -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-import-safety.json` / `.md`. Use it before bulk/backfill work to see naive provider tasks, deduped provider tasks, avoided requests, missing tasks, provider batches, largest task estimates, symbol/session coverage, and the safety verdict. Use `--all-sessions` when reviewing broad provider pressure across saved data.

`npm run candles:backfill-priority -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-backfill-priority.json` / `.md`. Use it after import safety when the question is what to fetch first. It ranks missing candle ranges as `fetch_first`, `fetch_next`, or `fetch_later` using quiet-risk evidence, noisy-symbol pressure, unproven candle coverage, timeframe importance, and provider-safe stage limits. Use `--all-sessions` before broad warehouse work so the first staged provider fetches target the gaps most likely to affect trader-facing conclusions.

`npm run candles:backfill-manifest -- --priority-report <candle-backfill-priority.json> --stage 1` writes `candle-backfill-stage-manifest.json` / `.md`. Use it to turn the priority report into a concrete Stage 1 handoff with the exact safe dry-run command and the explicit `--execute` command for later. The manifest is operator-only and does not call the provider.

`npm run candles:backfill -- --priority-report <candle-backfill-priority.json> --priority-stage 1` consumes the selected priority stage, recalculates current warehouse gaps, and stays dry-run by default. Add `--execute` only when provider access is intentional. This is safer than manually copying symbols because already-covered ranges are skipped after the fresh warehouse check.

`npm run candles:backfill -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-warehouse-backfill.json` / `.md`. It defaults to dry-run and should be used first with `--max-tasks`. Add `--execute` only when you intentionally want provider calls and durable warehouse writes. Use `--concurrency` and `--throttle-ms` to keep IBKR or future providers protected.

`npm run audit:execution-relations -- <session-folder-or-discord-delivery-audit.jsonl>` writes `execution-relation-replay.json` / `.md`. Use it when a saved post is missing next-level context, sounds too vague, or claims no forward level. The report rebuilds support/resistance from cached candles at the saved timestamp and shows whether relation facts were available or blocked by missing candle evidence.

`npm run candles:provider-compare -- --primary ibkr --comparison twelve_data` writes `provider-comparison-readiness.json` / `.md`. Use it before changing data providers to compare cached coverage, latest close drift, VWAP/EMA drift, and basic support/resistance count drift.

`npm run candles:regression-pack -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-intelligence-regression-pack.json` / `.md`. Use it to turn weak first snapshots, useful/hidden volume examples, missing relation evidence, missing-forward-resistance candidates, concrete quiet-may-hide examples, and post-budget noisy-symbol cases into reusable cases for future code changes.

`npm run candles:regression-gate -- <session-folder-or-discord-delivery-audit.jsonl>` writes `candle-intelligence-regression-gate.json` / `.md`. Use it after the regression pack when a change should be judged as pass/review/fail instead of only producing examples. It can fail on major candidates, weak first snapshots, missing forward resistance, quiet periods that may hide candle-backed moves, or too much missing candle evidence depending on thresholds, and it can review remaining post-budget noisy-symbol cases. Presets are available: `--preset strict` for release-style zero tolerance, `--preset review` for bounded operator-watch cases, and `--preset exploratory` for broad saved-data evidence gathering.

`npm run candles:dynamic-calibrate -- <session-folder-or-discord-delivery-audit.jsonl>` writes `dynamic-reference-calibration-report.json` / `.md` plus `dynamic-reference-calibration-report-gate.json` / `.md`. Use it before trusting opening-range, VWAP, EMA9, or EMA20 facts in trader-visible wording or shared app output. Use `--all-sessions` when the question is broad saved-data trust rather than one session.

`npm run levels:calibrate -- <session-folder-or-discord-delivery-audit.jsonl>` writes `support-resistance-calibration.json` / `.md` plus `support-resistance-calibration-gate.json` / `.md`. Use it when the core question is whether support/resistance levels were useful, complete, and well-ranked. The report rebuilds levels at the saved post timestamp, validates future 5-minute candle reactions, audits nearest/next support and resistance, flags no-forward and wide-gap ladders, adds ranking proof and market-structure alignment, and separates missing candle coverage from bad level logic. Use `--all-sessions` for the broad saved-data pass.

When `levels:calibrate` shows unproven symbols, read the coverage gaps/backfill hints before changing level logic. Those gaps also feed `candles:backfill-priority`, so provider work can start with the candle ranges needed to prove level quality.

When reviewing small-cap level flicker, check the trader-context evidence before calling a move meaningful. Candle reaction context now records body/range/level-distance evidence plus `materialityLabel`, and level-quality context records forward gaps plus tight cluster counts. Tiny probes inside a crowded practical zone should usually show as minor/indecisive unless the candle clears the small-cap meaningful-move floor.

`npm run discord:preflight` is the non-destructive Discord permission check. Run it before a live session when permissions were changed, old threads were deleted, or a 403/50001/50013 appeared. Use `npm run discord:preflight -- --post-test` only when you want the bot to send and delete one temporary channel message to prove write permissions.

`npm run startup:preflight` is the operator-only startup artifact checklist. Run it after a restart or before a live session to see whether the latest long-run review artifacts exist, which audit files are missing, and what should be regenerated before trusting the next review pass.

`npm run startup:cache-readiness` is the operator-only startup candle-cache checklist. Run it before or after a restart to see which active watchlist symbols have enough cached daily, 4h, and 5m candles to warm level restore quickly. The report is not a permission to post cached Discord snapshots; startup snapshots still wait for fresh candle refresh.

`npm run stress:all-symbols` is the wider saved-data check. It scans every saved long-run Discord audit stream, dedupes identical audit files, aggregates all symbols, replays the current balanced post policy, and ranks overposting, tight-range chop, fast-runner cascades, missed-event candidates, and trader-language boundary issues. Use it when the question is broad behavior across the whole evidence set, not one named ticker.

The all-symbol stress report also shows quiet-profile simulated totals. Review `Quiet-Mode Replay Attention` when a symbol is still too noisy under `balanced`; if it is also too noisy under `quiet`, the issue is usually story interpretation or level-flicker handling, not simply a profile threshold.

The replay simulator now infers practical zone, range-box, acceptance, and behavior-budget context for older saved Discord rows that do not yet contain current audit metadata. This matters when reviewing legacy CYCU/PBM/FATN-style churn: old rows can now exercise current `alert_range_box_chop`, `alert_same_story_not_material`, and related same-area suppression paths instead of being counted as totally fresh stories.

`npm run quality:posts -- <session-folder-or-discord-delivery-audit.jsonl>` is the trader post quality grader. It scans saved Discord-visible output for system/operator wording, direct or borderline advice, over-certain phrasing, tiny small-cap risk language, missing-level claims, and repeated story overlap. Run it whenever a thread “feels wrong” even if the replay post count looks acceptable.

`npm run audit:post-reasons -- <session-folder-or-discord-delivery-audit.jsonl>` is the operator-only post reason report. It summarizes `whyPosted`, `postBudgetSymbolType`, and `noLevelReason` evidence so an audit can explain why a post fired and why a nearby support/resistance level was unavailable without putting that reasoning into Discord.

`npm run audit:known-bad-posts -- <session-folder-or-discord-delivery-audit.jsonl>` is the known-bad wording regression scan. It looks for saved Discord-visible patterns that have caused real confusion, including `surfaced ladder`, `after the alert`, `alert direction move`, tiny penny-level risk language, predictive `moving toward` wording, direct advice, and old dip-buy wording.

`npm run audit:end-recap -- <session-folder-or-discord-delivery-audit.jsonl>` builds `thread-end-recap-report.json` / `.md`, which summarizes each symbol thread after a test run. Use it when a ticker is deactivated, archived, or done for the day and you want a calm summary of what the thread actually told traders.

`npm run audit:thread-health -- <session-folder-or-discord-delivery-audit.jsonl>` builds `thread-health-score.json` / `.md`, which scores each symbol thread for repeated adjacent stories, weak probes that reached Discord, missing next-level context, high post counts, and delivery failures. Start here when a thread feels noisy but you need evidence instead of vibes.

`npm run audit:usefulness -- <session-folder-or-discord-delivery-audit.jsonl>` builds `trader-usefulness-replay-score.json` / `.md`, which labels saved posts as useful changes, early-but-relevant context, repeat noise, late, or missing context. It also assigns each symbol a ticker personality and ladder-confidence label. Use it when the main question is whether Discord posts helped a trader follow the ticker or just restated the same zone.

`npm run audit:daily-review -- <session-folder-or-discord-delivery-audit.jsonl>` builds `daily-trader-review.json` / `.md` / `.html`, which gives an operator-only end-of-day style recap for each symbol, expected post budget by ticker behavior, no-post evidence coverage, best/worst examples, late-post evidence, and same-minute burst flags.

`npm run audit:eod-verdict -- <session-folder-or-discord-delivery-audit.jsonl>` builds `end-of-day-symbol-verdict.json` / `.md`, which gives one practical verdict per symbol: whether the first post gave a usable trade map, whether post volume was reasonable, whether candle-backed missed-move review is still needed, whether levels looked complete enough, and whether trader-facing wording stayed clean.

The end-of-day verdict now folds in the first-snapshot audit, execution-relation replay, warehouse volume replay, and missed-move audit when cache is available. It also includes representative evidence examples, which makes it a stronger single-symbol answer after a trading day rather than only a checklist of reports to run.

The end-of-day verdict also prints practical `reviewQuestions` per symbol. Use these as the final operator check after a session: did the first post map the trade, did the thread post too much, did it miss a meaningful move, were levels complete enough, was trader wording clear, does cache/provider work remain, and is advanced context trusted.

`npm run audit:missed-moves -- <session-folder-or-discord-delivery-audit.jsonl>` builds `missed-meaningful-move-audit.json` / `.md`, which compares cached 5-minute candles against saved Discord posts. Use it after post-noise tuning to make sure calmer rules did not hide meaningful breakouts, support losses, or large candle moves.

`npm run audit:why-no-post -- <session-folder-or-discord-delivery-audit.jsonl>` builds `why-no-post-replay-proof.json` / `.md`. Use it when a quieter thread looked suspicious: it classifies whether the lack of posts was supported by candles, whether meaningful moves were still covered, whether quiet behavior may have hidden a move, or whether missing candles make the verdict unproven. The `Concrete Move Examples` section shows the candle timestamp, move type, OHLC/range evidence, nearest saved posts, and why the candidate matters. Single-session reports also include balanced replay suppression evidence; `--all-sessions` aggregates candle proof across saved long-run sessions.

Treat all-session why-no-post `may_hide` and `unproven` findings carefully. When a symbol has no overlapping cached 5m candles for the saved Discord window, the report is telling you the proof layer is incomplete, not that the live policy definitely hid a real event. The next action is usually warehouse/backfill coverage or a targeted single-session candle audit before tightening live Discord rules.

`npm run audit:session-behavior -- <session-folder-or-discord-delivery-audit.jsonl>` builds `session-behavior-audit.json` / `.md`, which combines candle freshness/readiness, first-post trade-map scoring, thread balance, candle/post timeline samples, current-session behavior profiles, and runtime marker coverage. Use it when deciding whether a thread is too noisy, too quiet, balanced, or impossible to judge because candle evidence is stale.

`npm run audit:lifecycle -- <session-folder-or-discord-delivery-audit.jsonl>` builds `trade-lifecycle-summary.json` / `.md`, which summarizes the day-level ticker story: starting/ending price evidence, main support, main resistance, breakout/support events, and final state such as `range_bound`, `breakout_working`, `support_damaged`, or `extended_runner`.

`npm run audit:visual-replay -- <session-folder-or-discord-delivery-audit.jsonl>` builds `visual-audit-replay.json` and `visual-audit-replay.html`. Open the HTML when you want a quick visual timeline of where posts fired by symbol, including event type, acceptance state, range-box state, behavior budget, and approximate posted price when available.

The visual replay now includes a symbol index and issue flags for weak probes, locked-area posts, missing next-level context, and minor-level posts. Use those flags to jump directly into suspicious threads before reading every saved Discord line.

`npm run structure:replay` is the candle-only market-structure check. It scans cached IBKR 5-minute candles and compares raw structure transitions to the stable/materiality-smoothed structure read.

`npm run structure:discord-align -- --limit all` is the saved Discord alignment check. It compares posted rows with the stable 5-minute structure state near each post, then flags repeated posts that happened while structure did not materially change. Use it before wiring market structure into live post policy.

After changing post-noise policy, compare the new all-symbol scorecard against the previous scorecard. The current practical small-cap tuning target is not just a higher reduction percentage; it should also reduce `still noisy after current policy`, max posts per session, and max 5-minute bursts while keeping missed-event candidates from increasing. Start the manual review with the `Noisy-Symbol Regression Pack` section because it lists the worst saved symbols, why they were selected, and the exact sessions that should be replayed after each policy change.

The current post-noise policy includes thread story phase control. When reviewing a replay, look for `phase_same_phase_repeat` suppressions. Those mean the current code would keep a repeated same-area, same-phase post out of Discord while preserving the underlying support/resistance level in the ladder and audit metadata.

The current post-noise policy also includes `practical_area_flip_chop` and `stable_structure_repeat`. These are expected suppressions when price is still flickering inside the same practical small-cap support/resistance box without accepted expansion. Accepted breaks, critical changes, and true structure expansion should still appear in saved replay output.

The all-symbol stress report also includes post-budget labels:

- `within_budget`: current replay count is acceptable for review
- `watch`: count is above the healthy budget and needs a human skim before changing policy
- `excessive_chop`: tight-range saved sessions are still producing too many simulated posts
- `runner_review`: a fast runner still posts heavily, so the audit should prove those posts are meaningful expansion, hold/failure, reclaim, or support/resistance beats

The same report now includes a noisy-symbol regression pack. Use it as the default saved-data test set for post-frequency work. It should include tight-range chop names, fast-runner review names, missed-event candidates, and language-boundary risk, with target sessions such as `2026-05-01_10-48-03 (53->27)`.

The all-symbol stress report also includes a `Broad Saved-Data Replay Pack`. Use this when changing post-noise policy, first snapshot wording, support/resistance significance wording, or trader-language boundaries. It intentionally samples across:

- tight-range chop
- fast-runner cascades
- missed-event candidates
- language-boundary risk
- high-activity watch symbols

This is the default closed-market evidence set when the concern is "does this still work across many tickers?" rather than one hand-picked ticker. The pack should be regenerated after every meaningful posting-policy or snapshot-format change with:

```powershell
npm run stress:all-symbols
```

Use these labels before tightening live posting. A runner-review symbol should not be treated the same as a low-range chop symbol.

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
  - alert rows now also carry `signalCategory`, `signalCategoryLiveEnabled`, and supporting category metadata, so audits can prove whether a post belonged to support/resistance, reaction quality, breakout/reclaim quality, follow-through, trader commentary, or an explicitly enabled optional category
  - tight cluster-cross level updates include `crossedLevels`, `clusterLow`, `clusterHigh`, and `clusteredLevelClear`, so audits can prove the runtime grouped nearby levels without hiding them
  - alert rows can now include operator-only `whyPosted`, `postBudgetSymbolType`, and `noLevelReason`, so audits can explain why a post fired, how the symbol was budgeted, and why a next support/resistance was unavailable without putting that language into Discord
  - repeated identical extension payloads should now stop after the first post until the extension ladder actually changes, which makes it easier to spot genuine extension movement instead of repeated next-level restatements
  - live Discord text should stay trader-view only: system-shaped labels, severity/confidence scoring, and operator/testing wording belong in this audit/review stream rather than in visible posts
  - repeated same-level alert stories should now require a material trigger/score/severity change before reposting; post-run replay should prove this with `alert_same_story_not_material` suppressions on choppy small-cap symbols
  - first snapshot posts should show a practical `Trade map` that treats nearby penny-level supports as one support area when appropriate, names the upside path above resistance, identifies the support that matters, and avoids making tiny one-cent moves sound like full trade failures
- first snapshot posts should use conditional `Cleaner above` wording for the next resistance area rather than predictive `next level` wording
  - first snapshot trade maps should separate main support and main resistance, rank the practical importance of levels, and avoid making minor low-priced flickers sound like major trade failures
  - alert rows can carry practical structure metadata (`practicalStructureState`, `practicalStructureKey`, `practicalZoneKey`, and `practicalStructureMaterialChange`) so audits can prove whether a post represented a real range/base/breakout/support-failure/reclaim state change
  - alert rows can carry level-importance, primary-trade-area, and failed-level-memory metadata so audits can prove whether a post was a major decision, a locked-range repeat, a weak probe, or a clean accepted expansion
  - current post-policy replay also keeps thread story phase state, so repeated same-area phases can be identified as `phase_same_phase_repeat` instead of becoming another Discord-visible post
  - small-cap story buckets are wider than raw price precision, so a one- or two-cent flicker should usually appear as `alert_same_story_not_material`, `alert_zone_chop`, or `alert_structure_budget` unless price expands, severity/score escalates, or practical structure changes
  - level-clear updates are included in replay story memory, so repeated crossed-level chatter can be suppressed by the same policy that governs intelligent alerts
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
  - includes volume/activity evidence when available: reliable symbols, unreliable symbols, examples where activity enriched a post, and examples where activity was suppressed
  - category metadata should be reviewed when a noisy-looking post appears; operator/internal categories such as `range_compression` should stay out of live Discord unless the corresponding `SIGNAL_CATEGORY_*_LIVE_DISCORD` override was intentionally enabled
- `trading-day-evidence-report.md`
  - readable evidence appendix for the audit process
  - best file for proving findings with saved Discord excerpts instead of relying on summary language
- `post-reason-audit.json`
  - generated from `discord-delivery-audit.jsonl` by `npm run longrun:audit:reports -- <session-folder>` or directly with `npm run audit:post-reasons -- <session-folder>`
  - summarizes `whyPosted`, `postBudgetSymbolType`, `noLevelReason`, missing post-reason rows, and per-symbol reason counts
  - best file when the question is "why did this post fire?" or "why did the post not name a next support/resistance?"
- `post-reason-audit.md`
  - readable version of the post reason audit
  - keeps operator/testing explanation out of Discord while still making the audit evidence reviewable
- `known-bad-post-patterns.json`
  - generated from `discord-delivery-audit.jsonl` by `npm run longrun:audit:reports -- <session-folder>` or directly with `npm run audit:known-bad-posts -- <session-folder>`
  - lists saved Discord-visible text that matches known confusing patterns such as system-shaped labels, over-certain next-level language, tiny penny-risk wording, direct advice, and old dip-buy language
  - findings can be historical if they came from old saved posts; compare against current-code tests before calling them live regressions
- `known-bad-post-patterns.md`
  - readable evidence appendix for the known-bad pattern pack
  - useful after the trader says a post sounded wrong and we want to know whether that exact wording class still appears in saved output
- `saved-data-regression-report.json`
  - generated with `npm run saved-data:test -- --limit 8`
  - checks recent saved `discord-delivery-audit.jsonl` files through the current report/replay builders
  - fails on current-format category, trader-language, direct-advice, or volume-reliability rule violations
  - reports old saved wording and missing new metadata as historical/info findings instead of pretending old Discord output came from the current runtime
- `saved-data-regression-report.md`
  - readable version of the saved-data regression run
  - useful before a market-open test when you want to make sure current report/replay logic still handles the saved evidence already on disk
- `all-symbol-stress-report.json`
  - generated with `npm run stress:all-symbols`
  - scans all saved long-run Discord audit files by default and aggregates every symbol into broad stress patterns
  - includes the noisy-symbol regression pack for targeted saved-data replay after policy changes
  - useful when deciding which app behavior class deserves the next tuning pass
- `all-symbol-stress-report.md`
  - readable version of the all-symbol stress test
  - best file for broad post-noise review across all saved tickers rather than one hand-picked example
  - use the `Noisy-Symbol Regression Pack` section before drawing conclusions from any single ticker
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
   when you want to regenerate the policy, snapshot, post-reason, known-bad-pattern, evidence, replay, and tuning reports from the latest Discord audit file
17. optionally run:
   - `npm run audit:post-reasons -- <session-folder>`
   when you want only the post-reason / no-level audit without rebuilding every report
18. optionally run:
   - `npm run audit:known-bad-posts -- <session-folder>`
   when you want only the known-bad trader wording scan
19. optionally run:
   - `npm run replay:monday -- --skip-slow`
   when the market is closed and you want the core checklist before the next live run
20. only check:
   - `manual-watchlist-diagnostics.log`
   when the question is specifically about breakout / reclaim / fakeout reasoning
21. only check:
   - `manual-watchlist-full.log`
   if the operational and diagnostic logs still do not explain enough
22. check:
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
- `post-reason-audit.json`
- `post-reason-audit.md`
- `known-bad-post-patterns.json`
- `known-bad-post-patterns.md`

Use the tuning suggestions first when you want a quick action list. Use the policy report before reading raw audit rows when the question is "did this symbol post too many repeated versions of the same thing?" Use the snapshot report before reading raw audit rows when the question is "why did this level not show in the Discord snapshot?" Use the post-reason audit when the question is "why did this post fire?" Use the known-bad pattern report when the question is "is this trader-facing wording still leaking old confusing language?"

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
- `post-reason-audit.md`
- `known-bad-post-patterns.md`

This is an operator convenience surface only; it does not change what gets posted to Discord.

## Level Quality Audit

When a runner appears to have too few forward levels or the next resistance/support looks suspiciously far away, run:

```powershell
npm run validation:levels:quality -- <SYMBOL> [output-json-path]
```

The audit checks the generated ladder for missing forward levels, wide first gaps, thin forward ladders, and extension-only forward ladders. It is meant to catch ATER-style "did we miss older daily resistance?" questions before changing level-engine tuning by feel.

## Bounded Broad Candle Reports

Use `--max-sessions` before rerunning broad all-session candle reports on a resource-constrained machine. It caps the saved session audit files before rows, replay evidence, and candle context are loaded.

Examples:

```powershell
npm run levels:calibrate -- --all-sessions --max-sessions 5 --max-symbols 25 --warehouse data\candles --output artifacts\support-resistance-calibration-batch-01
npm run candles:import-readiness -- --all-sessions --max-sessions 5 --max-trades 50 --warehouse data\candles --out-dir artifacts\candle-import-readiness-batch-01
npm run audit:why-no-post -- --all-sessions --max-sessions 5 --warehouse data\candles --out-dir artifacts\why-no-post-batch-01
npm run candles:backfill-priority -- --all-sessions --max-sessions 5 --max-trades 50 --warehouse data\candles --out-dir artifacts\candle-backfill-priority-batch-01 --max-tasks-per-stage 10 --max-candles-per-stage 5000
```

Do not rerun old unbounded `--all-sessions` backfill-priority, import-readiness, or why-no-post commands just to "see if they finish." Increase `--max-sessions` gradually and keep output directories batch-specific.

If the manual watchlist app is still running, set a validation-only IBKR client id before running fresh candle checks:

```powershell
$env:LEVEL_VALIDATION_IBKR_CLIENT_ID='202'
```

Use replay mode when the goal is to audit exactly what the session saw. Use refresh mode only when the goal is to compare the current provider response against the saved session. In either case, check the output for daily timestamp sanity before trusting level findings; daily candles should show real trading dates, not `1970` epoch dates.

Replay mode is expected to work even when TWS/IB Gateway is closed. If a replay audit tries to open `127.0.0.1:7497`, fix the validation tooling before continuing; replay should read cached candle evidence and only report cache misses when evidence is unavailable.

When reviewing Discord posts after a live run, also verify the running app version before treating a post as a current-code bug:

- note the active session folder and runtime start time from `/api/runtime/status`
- note the latest local commit with `git log --oneline -3`
- separate posts produced before the latest restart from posts produced after the latest code was loaded
- for every resistance/support crossed post, confirm the trader-facing text shows both the crossed level and the next relevant level clearly
- if a post says risk opens toward a far support/resistance, check whether the crossed level should first be shown as the hold/reclaim area
- for level-touch and compression posts near an upper/lower edge, check whether recently crossed resistance/support should be surfaced as a nearby hold/reclaim area
- if no next resistance/support appears, investigate whether the ladder truly had no next level, whether display/ranking hid it, or whether the post came from stale runtime code
- when reviewing missed-event candidates, distinguish real missed clears/losses from audit false positives caused by zone posts, cluster-cross posts, exact level touches, or follow-through path prices being mistaken for structural levels

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
