# Audit And Replay Coverage Index

This is the master index for figuring out what has been audited, what has only been smoke-tested, what still needs replay proof, and which files prove each claim.

Use this after reading `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`.

The main audit standard is still: Discord should follow the play without narrating every wiggle. Replay and saved-candle audits exist to support that standard, not replace live Discord review.

## Fast Re-Entry

Read these in order:

1. `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`
2. this file
3. `docs/watchlist-level-qa-queue.md`
4. `docs/support-resistance-story-test-queue.md`
5. `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`
6. `docs/79_FUTURE_SELF_HANDOFF_2026-05-06.md`
7. `docs/82_PAST_REPLAY_EVENTS_AUDIT_2026-05-06.md`
8. `docs/83_CONTINUOUS_TRADER_STORY_AUDIT_2026-05-06.md`
9. `docs/84_UNDER100M_CANDLE_WAREHOUSE_BACKFILL_PLAN.md`
10. `docs/85_NASDAQ_MARKETCAP_UNIVERSE_AND_BACKFILL_MASTER_PLAN.md`
11. `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md`
12. `docs/87_FOCUSED_TRADER_STORY_REGRESSION_AUDIT_2026-05-07.md`

Then inspect the latest relevant artifact folder before changing code.

## Coverage Status Terms

Use these labels consistently:

- `thorough`: broad replay or audit has run, artifacts exist, and follow-up cases were inspected or resolved.
- `partial`: some replay/audit evidence exists, but coverage is incomplete or limited to a subset.
- `smoke`: a command/test/report ran only as a sanity check.
- `live_only`: live Discord/session artifacts exist, but historical replay has not proven the behavior.
- `data_limited`: saved candles are missing, stale, partial, or not overlapping the audited window.
- `timeout_contaminated`: live thread ordering, silence, or missing-post evidence overlaps a known app timeout/runtime gap, so it is not clean code-tuning evidence by itself.
- `pending`: the queue/doc says work remains.
- `unknown`: no clear tracking artifact was found.

When unsure, mark the state as `partial` or `data_limited`, not `thorough`.

## Audit Lanes

| Lane | Purpose | Current State | Read First | Proof / Artifacts |
| --- | --- | --- | --- | --- |
| Live Discord trader-story audit | What traders/operators actually saw in Discord today. | `live_only` per session until reports are generated and reviewed. | `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`, `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md` | `artifacts/long-run/<session>/discord-delivery-audit.jsonl`, `runner-story-report.md`, `thread-post-policy-report.md`, `trader-post-quality-report.md`, `trade-lifecycle-summary.md` |
| Trader story quality review | Combined operator lane for Discord story budget plus DXYZ/SEGG-style ladder-gap quality. | `new`; preferred first pass after live watchlist tests. | `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md` | `npm run audit:story-quality -- latest --warehouse data\candles`, `trader-story-quality-review.md`, `daily-trader-review.md`, `ladder-gap-level-audit.md` |
| Trader story regression queue | Compact closed-market regression set for repeated story/ladder risks after policy or level changes. | `partial`; recent clean sessions are proven clean, older sessions remain regression pressure. | `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md` | `artifacts/story-quality-backtest-2026-05-07-recent20/aggregate-findings.md`, per-session `trader-story-quality-review.md` |
| Focused trader-story regression audit | Human-style focused read of PMAX/SKK/SMX/SEGG after the regression queue was created. | `partial`; no broad code-policy change recommended yet. | `docs/87_FOCUSED_TRADER_STORY_REGRESSION_AUDIT_2026-05-07.md` | `artifacts/story-quality-focused-regression-2026-05-07/*`, focused verdict doc |
| Historical S/R story replay | Stress whether saved historical runners get a useful S/R story map. | `partial` to `thorough` for the 80-case queue, depending on batch review depth. | `docs/support-resistance-story-test-queue.md`, `docs/watchlist-level-qa-queue.md` | `artifacts/support-resistance-story-replay-batch-1` through `artifacts/support-resistance-story-replay-batch-8` |
| Specific ticker/date replay | Recreate known fast-mover windows and check map exhaustion. | `partial`; known 5h cases have been replayed and fixes were recorded. | `docs/watchlist-level-qa-queue.md` | `artifacts/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.md` |
| Saved Discord post-policy replay | Estimate how current posting policy would suppress or keep saved posts. | `partial`; useful for regression, not proof of live delivery. | `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`, `docs/59_TRADER_USEFULNESS_REPLAY_AND_PROVIDER_HEALTH_2026-05-02.md` | `live-post-replay-simulation.md`, `artifacts/saved-data-regression` |
| Trader usefulness replay | Judge whether saved posts helped follow the ticker or repeated the same story. | `partial`; run per session when reviewing noisy threads. | `docs/59_TRADER_USEFULNESS_REPLAY_AND_PROVIDER_HEALTH_2026-05-02.md` | `trader-usefulness-replay-score.md` |
| Missed meaningful move audit | Safety check before making Discord quieter. | `partial`; depends on overlapping saved candles. | `docs/61_MISSED_MEANINGFUL_MOVE_AUDIT_2026-05-02.md` | `missed-meaningful-move-audit.md`, `why-no-post-replay-proof.md` |
| Ladder gap level audit | Find DXYZ/SEGG-style cases where posted S/R ladders skip a practical decision zone inside a wide gap, or omit near-price wrong-side levels that should flip roles. | `new`; run after suspicious live level reads and before changing global detection thresholds. | `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md` | `npm run audit:ladder-gaps -- --input artifacts\long-run --all-sessions --warehouse data\candles`, `artifacts/ladder-gap-level-audit/ladder-gap-level-audit.md` |
| Session behavior/readiness | Decide whether a quiet/noisy verdict is supported by candle readiness and runtime markers. | `partial`; run per important session. | `docs/62_SESSION_BEHAVIOR_AND_READINESS_AUDIT_2026-05-02.md` | `session-behavior-audit.md`, `end-of-day-symbol-verdict.md` |
| Level-quality detection | Test whether level strength/coverage matches saved candle evidence. | `thorough` for latest 300-case event-regime pass; one known manual-review context remains. | `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`, `docs/79_FUTURE_SELF_HANDOFF_2026-05-06.md` | `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06*`, `level-quality-scoreboard.md` |
| Candle warehouse coverage/readiness | Decide whether replay evidence is trustworthy or data-limited. | `partial`; broad all-session work has had coverage gaps/timeouts. | `docs/65_DURABLE_CANDLE_WAREHOUSE_AND_STARTUP_CACHE_PLAN_2026-05-02.md`, `docs/77_TRADER_INTELLIGENCE_HISTORICAL_BACKFILL_AND_ASOF_PLAN_2026-05-05.md`, `docs/84_UNDER100M_CANDLE_WAREHOUSE_BACKFILL_PLAN.md` | `artifacts/candle-warehouse-audit`, `artifacts/candle-backfill-priority*`, `candle-import-readiness.md`, `candle-import-safety.md` |
| NASDAQ under-$100M candle backfill | Fill the durable candle warehouse for the canonical under-$100M ticker universe. | `partial`; 267/275 covered, 8 missing. 2026-05-07 execution reached IBKR but all 8 failed contract lookup with code 200/no security definition. | `docs/84_UNDER100M_CANDLE_WAREHOUSE_BACKFILL_PLAN.md`, `docs/nasdaq-under-100m-checklist-with-previous-tickers.md` | `artifacts/under100m-candle-backfill-plan-2026-05-07`, `artifacts/under100m-candle-backfill-2026-05-07-execute`, `artifacts/under100m-candle-backfill*`, `data/candles/ibkr` |
| Nasdaq market-cap universe | Build the current listed Nasdaq source of truth and under-$500M bucket/backfill views. | `new`; generated by `nasdaq:universe` and `nasdaq:under500:backfill-plan`. | `docs/85_NASDAQ_MARKETCAP_UNIVERSE_AND_BACKFILL_MASTER_PLAN.md`, `docs/nasdaq-under-500m-marketcap-universe.md` | `data/nasdaq-universe/nasdaq-current-universe.json`, `artifacts/nasdaq-marketcap-universe/*` |
| Market-structure replay | Check saved candle market-structure behavior and alignment. | `active calibration lane`; 2026-05-08 warehouse run shows stable smoothing is useful, but repeat-pressure/watch symbols still need tuning before it drives more live suppression. | `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md` | `npm run structure:replay -- --warehouse data\candles`, `npm run structure:discord-align -- --limit all --warehouse data\candles`, `npm run structure:calibrate -- artifacts\long-run --all-sessions --warehouse data\candles --audit-limit all`, `artifacts/market-structure-refresh-2026-05-08` |
| Volume replay / warehouse volume | Check whether volume context would help old alerts. | `partial`; operator-only evidence, not Discord wording permission by itself. | `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md` for boundary reminders | `artifacts/volume-replay`, `artifacts/warehouse-volume-activity` |
| Monday replay checklist | Broad closed-market gate across many audit lanes. | `smoke` to `partial` depending on latest run and failures. | `src/scripts/run-monday-replay-checklist.ts` | `artifacts/monday-replay-checklist/monday-replay-checklist.md` |

## Latest Past Replay Audit

Date: 2026-05-06

Audit lane: past replay events / saved Discord regression / historical S/R story replay / why-no-post proof

Command:

```powershell
npm run saved-data:test -- --input artifacts\long-run --all --output artifacts\past-replay-audit-2026-05-06\saved-data-regression-all
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 5 --out-dir artifacts\past-replay-audit-2026-05-06\specific-ticker-date-replay-forward-5h
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 80 --hours 5 --out artifacts\past-replay-audit-2026-05-06\support-resistance-story-replay-80
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 15 --warehouse data\candles --out-dir artifacts\past-replay-audit-2026-05-06\why-no-post-all-sessions-15
```

Input:

- `artifacts/long-run`
- `artifacts/support-resistance-story-test-queue/support-resistance-story-test-cases.json`
- `data/candles`

Output artifact:

- `docs/82_PAST_REPLAY_EVENTS_AUDIT_2026-05-06.md`
- `artifacts/past-replay-audit-2026-05-06/`

Coverage label:

- `partial` for broad saved Discord regression
- `partial` to `thorough` for the 80-case S/R story-map replay
- `data_limited` for broad why-no-post proof

Proven:

- 97 saved Discord audit files were scanned.
- Latest saved-session replay estimate for `2026-05-06_10-14-15` was 102 -> 82 alert-style posts, a 19.6% reduction.
- 80/80 support-resistance story replay cases loaded warehouse candles successfully.
- Known 5h map exhaustion remained isolated to `AKAN` and `SKLZ`; no-lookahead refresh adds higher resistance.
- Bounded why-no-post proof found 0 actionable missed candidates and 0 quiet-may-hide symbols.

Still unproven:

- Broad all-session why-no-post remains data-limited because several saved symbols lacked overlapping warehouse candles.
- `ATPC` 2026-05-04 05:45 ET remains a watch case after manual inspection: it moved +30.4%, emitted events, and produced 0 story-replay posts, but the candles were thin/liquidity-light and the replay lane does not include full live-runtime level-clear/follow-through behavior.
- Fresh live runtime must prove that `range_compression` follow-through no longer posts when `signalCategoryLiveEnabled` is false.

Code/tests changed:

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`: clustered `level_clear_update` posts now pass `majorChange` through as material structure change to the ladder-step cooldown policy.
- Verified by `manual-watchlist-runtime-manager.test.ts`, `live-thread-post-policy.test.ts`, and `live-post-replay-simulator.test.ts`.

Next action:

- Keep ATPC as a focused watch case; add a regression only if full-runtime replay or live evidence proves accepted continuation stayed silent.
- After a controlled runtime restart, rerun saved-data regression on the new session and check for any live `range_compression` leakage.

## Latest Continuous Live/Replay Audit

Date: 2026-05-06

Audit lane: fresh live Discord trader-story audit / missed-move proof / saved Discord regression / candle coverage

Command:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\2026-05-06_12-35-19
npm run quality:posts -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:thread-health -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:usefulness -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:missed-moves -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run saved-data:test -- --input artifacts\long-run --limit 20 --output artifacts\continuous-audit-2026-05-06\saved-data-regression-latest-20
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 20 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\why-no-post-latest-20
npm run candles:audit -- data\candles --out-dir artifacts\continuous-audit-2026-05-06\candle-warehouse-audit
npm run startup:cache-readiness -- --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\startup-cache-readiness
npm run candles:import-readiness -- --input artifacts\long-run --all-sessions --max-sessions 20 --max-trades 80 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\candle-import-readiness-latest-20
npm run saved-data:test -- --input artifacts\long-run --all --output artifacts\continuous-audit-2026-05-06\saved-data-regression-all-expanded-final
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 80 --hours 8 --out artifacts\continuous-audit-2026-05-06\support-resistance-story-replay-80-8h
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 8 --out-dir artifacts\continuous-audit-2026-05-06\specific-ticker-date-replay-forward-8h
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 25 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\why-no-post-latest-25-expanded
```

Input:

- `artifacts/long-run/2026-05-06_12-35-19`
- `artifacts/long-run`
- `data/candles`

Output artifact:

- `docs/83_CONTINUOUS_TRADER_STORY_AUDIT_2026-05-06.md`
- `artifacts/long-run/2026-05-06_12-35-19/`
- `artifacts/continuous-audit-2026-05-06/`
- `artifacts/continuous-audit-2026-05-06/saved-data-regression-all-expanded-final/`
- `artifacts/continuous-audit-2026-05-06/support-resistance-story-replay-80-8h/`
- `artifacts/continuous-audit-2026-05-06/specific-ticker-date-replay-forward-8h/`
- `artifacts/continuous-audit-2026-05-06/why-no-post-latest-25-expanded/`
- `artifacts/continuous-audit-2026-05-06/clean-replay-atpc-8h-post-timeout-note/`

Coverage label:

- `partial` but live-current for the fresh restarted runtime
- `data_limited` for broad old-session conclusions

Proven:

- Fresh restarted runtime was alive on `127.0.0.1:3010` and posting.
- Fresh session reached 53 posted rows in the expanded pass, with 0 repeated-story clusters in saved replay.
- Trader post quality found 1 data-quality-only finding, 0 blocker/major/watch findings, and 0 repeated-story clusters.
- Thread health found 17 healthy symbols and 0 broken/watch/major-review symbols.
- Fresh why-no-post proof found 0 quiet-may-hide, 0 runtime/feed silence, 0 missing candles, and 0 actionable missed candidates.
- Direct fresh-session JSON review found no `range_compression` Discord posts. The old range-compression failures remain in saved sessions but were not reproduced in the fresh restarted session.
- All-session saved-data regression scanned 98 audit files and confirmed current fresh-session rows are cleaner than older noisy sessions.
- The old noisy April 28 baseline remains very different from the current runtime: hundreds of findings/repeat-noise rows versus no repeated-story clusters in the fresh session.
- 80/80 8h support-resistance replay cases loaded; `ATPC` remains the main zero-post/high-move watch case.
- Specific 8h runner replay confirmed `AKAN` and `SKLZ` can exhaust starting resistance maps; no exhaustion was found for `YCBD`, `AIXI`, `CAST`, `YAAS`, `SEGG`, or `ATER`.
- Focused thread-story audit was run on `EZGO`, `ATLN`, `SKK`, `ERNA`, `MASK`, plus `ATPC`, `AKAN`, and `SKLZ` replay cases. This audit read the thread sequence as a trader story, not just aggregate report totals.
- Clean focused ATPC 8h replay was rerun after adding the timeout-contamination note. It reproduced 62 replay candles, 13 emitted events, 12 story candidates, 0 posted story posts, and all candidates low/low with `shouldNotify: false`.

Still unproven:

- Full-day behavior for the fresh session; the session was still young and `session-behavior` remained data-unproven.
- EZGO-style thin/no-resistance maps need more replay/live evidence before changing level detection broadly.
- Low-post/high-move replay names from the 8h queue (`HCAI`, `CCM`, `UCAR`, `ABVE`, `ARKR`, `SAFX`, `RLYB`, `ATPC`, `AGAE`) need manual review before any posting threshold change.
- Same-day live-story ordering concerns from the May 6 session may be `timeout_contaminated`; do not tune code from ERNA/SKK-style order gaps unless clean replay or an uninterrupted later live session reproduces them.
- ATPC remains `replay_only_watch` / `data_limited`, not a proven global posting-policy bug. A fuller runtime-style replay is still needed before changing thresholds.
- Broad older-session conclusions remain data-limited until candle coverage is backfilled.

Code/tests changed:

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`: rapid level-clear clusters now pass `majorChange` as material structure to the ladder-step policy.
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`: extension ladder payloads are now side-aware relative to the active snapshot/reference price, so support-extension posts cannot include stale above-price levels as "lower support."
- Verified by `manual-watchlist-runtime-manager.test.ts`, `alert-router.test.ts`, `live-post-replay-simulator.test.ts`, and `npx tsc --noEmit --pretty false`.

Next action:

- Let the restarted runtime accumulate more rows, rerun the fresh-session audit stack, and keep checking for any `range_compression` / `signalCategoryLiveEnabled: false` rows.
- Track EZGO, ATPC, AKAN/SKLZ map exhaustion, ERNA, and MASK as watch cases, not immediate global posting-policy changes. ERNA ordering is `timeout_contaminated` until reproduced in a clean run.
- Continue focused thread-story audits for watch cases. The required method is now documented in `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`; do not rely on aggregate report totals alone when the operator says the story feels off.

## Latest Story Quality Regression Backtest

Date: 2026-05-07

Audit lane: trader story quality review / ladder gap level audit / regression queue creation

Command:

```powershell
npm run audit:story-quality -- artifacts\long-run\<session> --warehouse data\candles --out-dir artifacts\story-quality-backtest-2026-05-07-recent20\<session>
```

Input:

- 20 most recent `artifacts/long-run/<session>` folders with `discord-delivery-audit.jsonl`
- `data/candles`

Output artifact:

- `artifacts/story-quality-backtest-2026-05-07-recent20/aggregate-findings.md`
- `artifacts/story-quality-backtest-2026-05-07-recent20/aggregate-results.json`
- `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md`

Coverage label:

- `partial` for older-session regression pressure
- `live_only` / clean for the current May 7 live session until more uninterrupted market action accumulates

Proven:

- Current session `2026-05-07_15-32-55` was clean: 9 symbols, 77 posts, 0 story risks, 0 ladder findings.
- Prior clean test session `2026-05-07_14-47-29` was clean: 2 symbols, 8 posts, 0 story risks, 0 ladder findings.
- Repeated regression symbols from older sessions are now tracked: `PMAX`, `SKK`, `SMX`, `SEGG`, `AKAN`, `EZGO`, `MASK`, `SDOT`, plus secondary watch names.
- Delayed `stock_context` startup/company posts are not trader-story late failures. `src/lib/review/daily-trader-review.ts` now excludes them from late story-risk scoring.

Still unproven:

- Older `needs_review` results are not proof that the current live code is broken; many are historical/regression pressure.
- Hidden ladder gaps still need focused chart/story inspection before broad threshold changes.
- Low-volume/chop over-budget names need missed-move/why-no-post proof before making the live app quieter.

Code/tests changed:

- `src/lib/review/daily-trader-review.ts`: late delivery risk now applies to trader-story posts, not `stock_context`.
- `src/tests/daily-trader-review.test.ts`: added coverage for delayed `stock_context` exclusion.

Next action:

- Use `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md` after any posting-policy, ladder filtering, role-flip, or snapshot-map change.
- Keep current clean May 7 session as the first smoke check before rerunning older regression-pressure sessions.

## Latest Focused Story Regression Audit

Date: 2026-05-07

Audit lane: focused trader-story regression audit

Command:

```powershell
npm run audit:story-quality -- artifacts\long-run\<selected-session> --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\<selected-session>
```

Input:

- `PMAX`, `SKK`, `SMX`, and `SEGG` from `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md`
- Selected sessions from May 6 and May 7

Output artifact:

- `docs/87_FOCUSED_TRADER_STORY_REGRESSION_AUDIT_2026-05-07.md`
- `artifacts/story-quality-focused-regression-2026-05-07/`

Coverage label:

- `partial`

Proven:

- Current session `2026-05-07_15-32-55` remains clean under the tighter audit definition: 9 symbols, 71 trader-story posts, 0 story risks, 0 ladder findings.
- `stock_context` company/startup rows are excluded from trader-story post budgets and examples.
- SEGG's older hidden-gap/wrong-side issues appear improved in the current clean session.
- SKK and PMAX remain watch cases for old low-volume/chop or repeated support-loss cadence.
- SMX has the strongest repeated hidden-ladder candidate: `2.08-2.14` inside the posted `1.91/1.95 -> 2.23` gap.

Still unproven:

- No current-code live bug is proven for PMAX, SKK, SMX, or SEGG.
- SMX-style hidden OHLC reaction-zone promotion needs a narrow fixture before changing global level detection.
- PMAX/SKK cadence changes should wait for clean current-runtime reproduction or missed-move/why-no-post proof.

Code/tests changed:

- `src/lib/review/daily-trader-review.ts`: exclude `stock_context` from trader-story post budgets.
- `src/tests/daily-trader-review.test.ts`: coverage for excluding stock-context rows.

Next action:

- If continuing closed-market improvement, prototype a narrow ladder-detection promotion for compact daily/4h OHLC clusters inside wide forward gaps, using SMX first and validating against SEGG/PMAX/AKAN.

## Latest May 11-12 Activation Audit

Date: 2026-05-12

Audit lane: live Discord trader-story audit / ladder-gap level audit / missed meaningful move audit / why-no-post proof / session behavior readiness

Command:

```powershell
npm run audit:story-quality -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:missed-moves -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\<session> --warehouse data\candles
npm run audit:session-behavior -- artifacts\long-run\<session> --warehouse data\candles
```

Input:

- `artifacts/long-run/2026-05-08_06-58-18`
- `artifacts/long-run/2026-05-08_14-54-55`
- `artifacts/long-run/2026-05-08_16-34-38`
- `artifacts/long-run/2026-05-10_18-29-57`
- `artifacts/long-run/2026-05-10_18-35-02`
- `artifacts/long-run/2026-05-11_09-19-29`
- `artifacts/long-run/2026-05-11_11-14-36`
- `artifacts/long-run/2026-05-12_08-58-04`
- `artifacts/long-run/2026-05-12_09-59-54`
- `data/candles`

Output artifact:

- `docs/88_MAY_11_12_ACTIVATION_AUDIT_2026-05-12.md`
- Per-session `trader-story-quality-review.md`
- Per-session `missed-meaningful-move-audit.md`
- Per-session `why-no-post-replay-proof.md`
- Per-session `session-behavior-audit.md`

Coverage label:

- `partial` for May 8 and May 10 backfill sessions
- `partial` for May 11
- `data_limited` for May 12 early session because all 11 symbols were `unproven_runtime_silence`
- `watch` for May 12 later session because story behavior was clean but AIIO had a repeated ladder-gap watch finding

Proven:

- May 11 and May 12 activated symbols were audited, and previous May 8/May 10 unaudited sessions were backfilled with the same audit stack.
- `2026-05-11_11-14-36` was clean: 7 symbols, 16 posts, 0 story risks, 0 ladder findings, 0 missed candidates.
- `2026-05-12_09-59-54` had 0 story risks and 0 missed candidates, but AIIO repeated as a hidden forward-resistance watch case.
- `MEHA`, `HTCO`, `POET`, and `AIIO` are the strongest level-map follow-ups: near wrong-side omissions and hidden practical resistance zones.
- `2026-05-12_08-58-04` had 121 missed candidates and 48 major missed candidates, but why-no-post proof attributed the issue to runtime/feed silence rather than policy suppression.

Still unproven:

- Whether the May 12 early missed moves were caused by live feed gaps, activation timing, stale candle readiness, or another runtime issue.
- Whether `AIIO`/`POET` hidden ladder zones need a global scoring threshold change or a narrow OHLC reaction-zone promotion rule.
- Whether `CNCK`, `HTCO`, `TDIC`, and `RPGL` over-budget/burst findings reproduce in a clean current runtime.

Code/tests changed:

- None in this audit pass.

Next action:

- Add focused fixtures for `AIIO 1.42-1.50`, `AIIO 1.57-1.63`, and `POET 16.07-16.51` hidden resistance zones.
- Keep `MEHA 0.1372/0.1422` and `HTCO 9.17` as near wrong-side role-flip regression cases.
- Investigate May 12 early runtime/feed silence before changing live posting thresholds.

## Current Known Coverage

### Historical 5h Replay QA

Tracked in `docs/watchlist-level-qa-queue.md`.

Known replayed cases:

- `AKAN` - 2026-04-22 11:00 ET
- `YCBD` - 2026-04-22 12:00 ET
- `AIXI` - 2026-04-22 09:30 ET
- `SKLZ` - 2026-04-23 12:15 ET
- `CAST` - 2026-04-24 08:00 ET
- `YAAS` - 2026-04-27 09:15 ET
- `SEGG` - 2026-04-28 08:25 ET
- `ATER` - 2026-04-28 08:50 ET

Recorded findings:

- `AKAN` and `SKLZ` exhausted the starting resistance map during the 5h window.
- A fresh no-lookahead rebuild produced higher resistance once price moved.
- `YCBD`, `AIXI`, `CAST`, `YAAS`, `SEGG`, and `ATER` did not exhaust the visible map inside the replay window.
- Fixes were recorded for outer-boundary refresh, lower support extension refresh, compact continuation maps, and refreshing before the last visible level is exhausted.

Proof:

- `artifacts/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.md`
- `artifacts/specific-ticker-date-replay-forward-5h/specific-ticker-date-replay.json`

### Support/Resistance Story Replay Queue

Tracked in `docs/support-resistance-story-test-queue.md`.

Known state:

- Purpose: replay stored warehouse candles where the stock moved enough to stress the S/R story map.
- Queue size: 80 cases.
- Batch shape: 8 batches of 10.
- Cases were built from stored warehouse `5m` candles with enough daily/4h context.

Proof:

- `artifacts/support-resistance-story-test-queue/support-resistance-story-test-cases.json`
- `artifacts/support-resistance-story-replay-batch-1/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-2/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-3/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-4/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-5/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-6/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-7/support-resistance-story-replay.md`
- `artifacts/support-resistance-story-replay-batch-8/support-resistance-story-replay.md`

Important caution:

- The story replay artifact is for story-map quality. It is not proof of actual Discord delivery behavior.

### Watchlist Level QA Queue

Tracked in `docs/watchlist-level-qa-queue.md`.

Known state:

- Under-30M market-cap QA is marked complete through `AUID`.
- The current batch says none pending for that under-30M queue.
- Many completed batches are listed, but this is a manual QA ledger, not a full historical replay ledger.
- There is also a `Pending` section later in the file that contains nano / very small micro style tickers; treat that section carefully because some symbols appear elsewhere as completed historical batches.

Use this file to identify:

- what batches were manually checked,
- which user-selected symbols were covered,
- and whether a ticker is in a pending/manual queue.

### Level-Quality Detection

Tracked in `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md` and `docs/79_FUTURE_SELF_HANDOFF_2026-05-06.md`.

Known latest baseline:

- Latest event-regime artifacts:
  - `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06`
  - `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-2h`
  - `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-8h`
- Report state:
  - 5h: 300 cases, 300 scored, 0 unscored, 72 clean-break targets
  - 2h: 300 cases, 300 scored, 0 unscored, 67 clean-break targets
  - 8h: 300 cases, 300 scored, 0 unscored, 67 clean-break targets
- Final known issue:
  - `SKLZ` 2026-05-01 `8.08` resistance remains the only `needs_manual_review` style context across the final pass.

Important boundary:

- Do not change trader-facing Discord wording from level-quality replay alone.
- Do not change broad S/R scoring thresholds without inspecting raw candles.
- Use saved warehouse candles only unless the user explicitly asks for provider fetches.

## Current Known Gaps

These are the main organization gaps future sessions should preserve or fix:

- The under-$100M candle backfill is close but incomplete: 8 canonical symbols still need warehouse candles (`ATNF`, `BSGM`, `CYCC`, `CYTO`, `FGEN`, `KTRA`, `NBY`, `WTOU`). A real IBKR attempt on 2026-05-07 reached the provider but all 8 returned code 200/no security definition, so the next step is current-contract/alias resolution.
- There is no single generated dashboard that marks every symbol/date/session as `thorough`, `partial`, `smoke`, `pending`, or `data_limited`.
- Live Discord sessions are audited per `artifacts/long-run/<session>`, but not every session has every report regenerated.
- Historical S/R story replay has a clear 80-case queue, but the doc/artifact review depth may differ by batch.
- Some broad all-session candle/why-no-post/import-readiness scans have previously timed out or shown coverage gaps. Treat those as `partial` until a bounded rerun succeeds.
- Candle availability determines audit confidence. Missing overlap can make a replay/audit verdict `data_limited` even when saved Discord rows exist.
- Watchlist manual QA batches and historical replay batches are related but not the same thing.

## How To Update This Index

When a new audit or replay pass is run:

1. Add or update the lane in the audit table.
2. Record the exact command that ran.
3. Record the artifact folder.
4. Record the coverage label.
5. Record what was actually proven.
6. Record what remains unproven.
7. If code was changed because of the audit, link the test or file that guards the behavior.

Use this format:

```text
Date:
Audit lane:
Command:
Input:
Output artifact:
Coverage label:
Proven:
Still unproven:
Code/tests changed:
Next action:
```

## Commands For Rebuilding Evidence

For a live session:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\<session-folder>
npm run quality:posts -- artifacts\long-run\<session-folder>
npm run audit:usefulness -- artifacts\long-run\<session-folder>
npm run audit:daily-review -- artifacts\long-run\<session-folder>
npm run audit:missed-moves -- artifacts\long-run\<session-folder>
npm run audit:why-no-post -- artifacts\long-run\<session-folder>
npm run audit:session-behavior -- artifacts\long-run\<session-folder>
npm run audit:post-reasons -- artifacts\long-run\<session-folder>
npm run audit:visual-replay -- artifacts\long-run\<session-folder>
```

For historical S/R story replay:

```powershell
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 10 --hours 5 --out artifacts\support-resistance-story-replay-batch-1
```

Change `--offset` by 10 for each batch:

- batch 1: `--offset 0 --limit 10`
- batch 2: `--offset 10 --limit 10`
- batch 3: `--offset 20 --limit 10`
- batch 4: `--offset 30 --limit 10`
- batch 5: `--offset 40 --limit 10`
- batch 6: `--offset 50 --limit 10`
- batch 7: `--offset 60 --limit 10`
- batch 8: `--offset 70 --limit 10`

For specific ticker/date replay:

```powershell
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 5 --out artifacts\specific-ticker-date-replay
```

For level-quality detection:

```powershell
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-new-review
```

For a broad closed-market pass:

```powershell
npm run replay:monday -- --skip-slow
```

For the NASDAQ under-$100M candle warehouse backfill:

```powershell
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --dry-run --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-plan
npm run candles:audit -- data\candles --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-plan\warehouse-audit
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --symbols ATNF,BSGM,CYCC,CYTO,FGEN,KTRA,NBY,WTOU --timeframes daily,4h,5m --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-execute --throttle-ms 1500 --ibkr-timeout-ms 30000
npx tsx src\scripts\run-under100m-candle-warehouse-backfill.ts --dry-run --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-verify
npm run candles:audit -- data\candles --out-dir artifacts\under100m-candle-backfill-YYYY-MM-DD-verify\warehouse-audit
```

For the Nasdaq market-cap universe and under-$500M dry-run backfill plan:

```powershell
npm run nasdaq:universe:check
npm run nasdaq:universe -- --write
npm run nasdaq:under500:backfill-plan
npm run nasdaq:under500:backfill -- --stage 1 --max-symbols 25
```

## Decision Rules

- If a user asks about today's Discord posts, start from the live session artifacts, not historical replay.
- If a user asks whether the app can handle a known runner pattern, use historical replay and saved candles.
- If a user asks whether reducing noise is safe, run missed-move and why-no-post proof before tightening policy.
- If an audit says a map ran out of levels, investigate level coverage/refresh first, not wording.
- If an audit says posts are repetitive but missed-move proof is data-limited, fix candle coverage before making the app quieter.
- If replay output looks better but live Discord still looked bad, trust live Discord as the product evidence and use replay only as a reproduction tool.
