# How to Audit Trader Story Discord Posts

This is the memory-anchor doc for auditing TraderLink Discord posts after context loss.

The main idea: Discord should follow the play. It should not simply post every level touch, every recalculation, or every small price wiggle. A good thread should read like one evolving trader story for a long-biased trader: initial map, meaningful tests, breakouts, failures, reclaims, support losses, continuation, and quiet periods when nothing important changed.

Do not take "coach" literally. The app is not trying to be motivational or give direct trading instructions. It is trying to keep the Discord thread useful as the play develops.

After reading this file, read `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md` to see what has already been audited, what is only partially replay-tested, where the proof artifacts live, and what still needs coverage.

## Read These First

Start with these docs when rehydrating context:

- `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md`
  - Master coverage/index file.
  - Use it to separate thoroughly replay-tested areas from partial, smoke, live-only, data-limited, pending, or unknown coverage.
  - Points to the artifact folders that prove each audit lane.

- `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`
  - Primary audit playbook.
  - Reconstruct each ticker thread from first post to last post.
  - Ask whether the thread would make sense to a trader reading it later.
  - Check whether it explained what needed to hold, reclaim, clear, or fail.
  - Identify repeated posts, noisy bursts, missing next-level context, and misleading levels.

- `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`
  - The closest conceptual match for this work.
  - Key idea: the goal is not to add more Discord posts; the goal is to recognize when a ticker is telling one evolving story instead of many tiny support/resistance stories.
  - Use this when deciding whether the app should post, stay quiet, or update the same thread story.

- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
  - Explains how to evaluate a long-run session.
  - Practical audit question: if someone opened this Discord thread later, would it look useful or mostly noisy?
  - Operator/testing details belong in artifacts and reports, not trader-facing Discord posts.

- `docs/49_AUDIT_PROCESS_HARDENING_INSTRUCTIONS_2026-05-01.md`
  - Use this to keep audits evidence-driven.
  - Reducing noise must not hide real support/resistance.
  - Trader-facing posts must avoid direct buy/sell instructions, short framing, system labels, debug language, and overconfident language.

- `docs/39_TRADER_LANGUAGE_BOUNDARY_AND_DISCORD_RULES_2026-04-29.md`
  - Use this for Discord wording boundaries.
  - Keeps member-facing language trader-view only.

- `docs/40_FINAL_DISCORD_WORDING_CLEANUP_2026-04-29.md`
  - Use this when post language feels too mechanical, too system-like, or too verbose.

- `docs/59_TRADER_USEFULNESS_REPLAY_AND_PROVIDER_HEALTH_2026-05-02.md`
  - Use this when auditing whether saved posts helped a trader follow the ticker.
  - Adds `audit:usefulness`, usefulness labels, session/ticker behavior labels, ladder confidence, and material-change review.

- `docs/61_MISSED_MEANINGFUL_MOVE_AUDIT_2026-05-02.md`
  - Use this as the opposite-side safety check when reducing Discord noise.
  - It checks saved candles for meaningful moves that may have deserved a post.

- `docs/62_SESSION_BEHAVIOR_AND_READINESS_AUDIT_2026-05-02.md`
  - Use this before drawing a strong quiet/noisy conclusion.
  - It checks candle readiness, first-post quality, thread balance, runtime markers, and session behavior.

- `docs/65_DURABLE_CANDLE_WAREHOUSE_AND_STARTUP_CACHE_PLAN_2026-05-02.md`
  - Explains the durable candle warehouse and why stale/cache-only data should not create trader-facing Discord snapshots.

- `docs/support-resistance-story-test-queue.md`
  - Replay queue for stored warehouse candles where the stock moved enough to stress the support/resistance story map.

- `docs/watchlist-level-qa-queue.md`
  - Includes historical 5h replay QA and notes about map exhaustion, forward-level coverage, and whether the trader-facing map ran out of useful levels.

- `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md`
  - Compact regression queue created from the 20-session story-quality backtest.
  - Use it after changing posting policy, ladder filtering, role-flip behavior, or snapshot map rendering.

## What the Audit Is Really Checking

Audit the thread as a play lifecycle, not as isolated messages.

For each ticker, answer:

1. What was the initial map?
2. What were the key nearby support and resistance areas?
3. Did price stay inside the same practical trade area, or did it escape?
4. When price moved, did the app post only when the story changed?
5. Did it catch meaningful events like breakout, breakdown, reclaim, rejection, support hold, support loss, continuation, or failed breakout?
6. Did it avoid posting during ordinary chop inside the same range?
7. Did repeated posts add new information, or did they restate the same story with slightly different prices?
8. Did the thread show what needed to hold, what needed to clear, and what would invalidate the current read?
9. Did it miss any meaningful move that a trader would expect the thread to mention?
10. Would the full thread make sense if read later without watching the chart live?

## Focused Thread Story Audit Method

After the aggregate reports run, do a human-style focused thread read for the watch cases. This is mandatory when the operator says the story feels off, when a ticker is a known example, or when reports show weak probes, missing next-level context, map exhaustion, replay silence, or a high-move/low-post case.

Do not stop at totals like `0 repeated-story clusters` or `within budget`. Those are guardrails, not the product judgment. The real question is whether the sequence reads like one evolving play.

For each ticker, reconstruct the story in order:

1. First map: what support/resistance did the app tell the trader to care about?
2. First change: did the next post explain a real test, clear, reclaim, failure, or continuation?
3. Progression: did later posts advance the same story, or restart it as disconnected alerts?
4. Silence: were there meaningful price moves where silence made sense, or did silence hide a story change?
5. Noise: did any post repeat the same level/idea without new price progress, acceptance, failure, or next-level context?
6. Next map: after each breakout/breakdown/reclaim, did the post give the next useful level and invalidation/repair area?
7. Wrong-side context: did support/resistance maps stay on the correct side of the active trade area?
8. Final read: if a trader opened the thread later, would the last visible story match what happened?

Use this focused queue shape:

```text
Symbol:
Coverage:
Thread sequence:
Story verdict:
What worked:
What did not:
Decision:
Follow-up:
```

The `Decision` should be one of:

- `healthy_story`: thread follows the play and needs no code change.
- `watch_story`: mostly acceptable, but needs more live/replay evidence.
- `fix_story_logic`: current behavior can repeat a bad trader-facing story and needs a code/test change.
- `data_limited`: candle/runtime evidence is not strong enough.
- `replay_only_watch`: replay found a concern, but live runtime behavior has not proven a bug.
- `timeout_contaminated`: same-day live ordering, missing-post, or silence evidence overlaps a known app timeout/runtime gap, so do not tune code from that case alone.

When a ticker is `watch_story` or `fix_story_logic`, name the exact post transition that caused the verdict. Example: `snapshot -> reclaim -> stale support-extension -> breakdown`.

If a known app timeout happened during the trading window, mark affected live-thread conclusions with `timeout_contaminated`. This does not mean the thread is useless; it means gaps, late posts, and odd ordering are not clean evidence of story-logic failure. Use clean replay cases or a later uninterrupted live session before changing code.

## Ladder Gap Level Audit

Use the ladder-gap audit when a support/resistance snapshot looks technically valid but the posted ladder makes the path look more open than the chart really is. This is the DXYZ/SEGG audit pattern: a post may show `50 -> 58.50` or `1.79 -> 2.03`, while daily/4h candles show a practical reaction area inside that gap.

For normal live-session review, start with the combined story-quality report. It runs the trader-story budget review and the ladder-gap audit together:

```powershell
npm run audit:story-quality -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS --warehouse data\candles
```

For the newest long-run session:

```powershell
npm run audit:story-quality -- latest --warehouse data\candles
```

Primary outputs:

- `trader-story-quality-review.md`: one operator action queue for noisy story threads and suspect level ladders.
- `daily-trader-review.md`: per-symbol Discord story budget, best examples, and worst examples.
- `ladder-gap-level-audit.md`: candle-backed DXYZ/SEGG-style hidden ladder gap candidates.

Command:

```powershell
npm run audit:ladder-gaps -- --input artifacts\long-run --all-sessions --warehouse data\candles --out-dir artifacts\ladder-gap-level-audit
```

For a single session:

```powershell
npm run audit:ladder-gaps -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS --warehouse data\candles
```

This audit checks:

- wide posted ladder gaps, especially near the active trade path.
- compact repeated daily/4h OHLC reaction areas inside those gaps.
- near-price `wrong_side` omissions that should usually flip into reclaim resistance or hold-support context.

Treat the report as candidate evidence. Do not change global thresholds from one finding alone. The best fixes come from repeated examples where the omitted zone would have changed the next target, reclaim line, failure line, or breakout story.

## Late Delivery Audit Boundary

Do not count delayed `stock_context` company/startup posts as failed trader-story delivery.

Those posts can say things like `Current price... Levels are loading.` They are useful operator/member context, but they are not the live trade-following story. If a delayed `stock_context` post appears in the "worst examples" list, treat that as an audit bug or audit-noise candidate, not a reason to change Discord story logic.

Late delivery should matter for trader-story posts such as:

- `intelligent_alert`
- `level_snapshot`
- `level_clear_update`
- `follow_through_update`
- `continuity_update`

The 2026-05-07 audit fix updated `src/lib/review/daily-trader-review.ts` so `stock_context` rows do not create story risk solely because they were delayed.

The follow-up focused audit tightened this further: `stock_context` rows should not count against trader-story post budgets or appear as trader-story best/worst examples. Count them as visible Discord context if you are auditing channel clutter, but exclude them when judging whether the play-following thread overposted.

## What Good Discord Posts Usually Do

Good posts are short, timely, and tied to a real change in the play.

They usually include:

- The event: breakout, breakdown, reclaim, rejection, support test, continuation, failed move.
- The current meaning: early, accepted, fading, still above, back below, holding, losing.
- The next important level or area.
- What needs to hold or clear.
- What would invalidate the current read.

They should not include operator/debug/test explanations.

## What Noisy Posts Usually Look Like

Watch for these patterns:

- Full level ladders posted repeatedly into Discord when they are mostly operator-useful.
- Same-level duplicate alerts minutes or seconds apart with no real price progress.
- Score-only escalation where the app reposts because severity changed, but the trader story did not.
- Compression/range posts that explain chop instead of staying quiet.
- Empty snapshots like `Resistance: none` and `Support: none` when levels exist but are too far away to be actionable.
- Too many penny-close levels instead of one practical zone.
- Posts that give the trader no next level, no invalidation, or no explanation of what changed.
- Posts that sound like direct advice or use system/internal labels.

## Current Direction From Recent Work

Recent fixes were made to align Discord behavior with this audit framing:

- Full level ladders are Discord opt-in only through `LEVEL_DISCORD_POST_FULL_LADDER`.
- Empty snapshots are suppressed when the engine has levels but none are close enough to be useful.
- Same-story duplicate posts are suppressed when only score/severity changed and price did not materially progress.
- Compression follow-through is suppressed when that signal category is not live-enabled.
- Low-priced dense overhead resistance is compacted into practical zones when appropriate, instead of listing every nearby penny level.
- Extension ladder posts are filtered by side relative to the active snapshot/reference price, so "lower support" should not include stale levels above the live trade area.

These changes are meant to make the app follow the play without becoming noisy.

## Live Audit Versus Replay Audit

There are two related audit paths. Do not blur them together.

Live Discord audit answers:

- What did the app actually post today?
- What did the trader/operator actually see in Discord?
- Did the thread follow the live play or become noisy?
- Did delivery fail, stall, duplicate, or post from an old runtime?

Replay / saved-data audit answers:

- Would the current policy have posted less or better against saved sessions?
- Did saved candle data show meaningful moves that the quieter policy might miss?
- Did a historical runner exhaust the visible support/resistance map?
- Did the level engine have enough forward context from daily/4h/5m candles?
- Did the app treat one evolving story as many tiny support/resistance events?

Use live audit for truth about Discord output. Use replay audit to stress the logic, reproduce known fast-mover cases, and test changes before another market session.

## Saved Candle Warehouse

The project has a durable candle warehouse used for replay and historical audits:

```text
data/candles/
  ibkr/
    SYMBOL/
      5m/
        YYYY-MM-DD.jsonl
      4h/
        YYYY-MM-DD.jsonl
      daily/
        YYYY-MM-DD.jsonl
```

Each JSONL row is a normalized candle. Replay tools should use these saved candles when the purpose is deterministic historical QA. Do not fetch live/provider data during paused saved-candle QA unless the user explicitly asks.

Important rules:

- Keep the production provider path as IBKR plus `data/candles`.
- Respect historical `asOfTimestamp`; do not leak future candles into historical reviews.
- Use the historical price/as-of price as the relevance anchor, not today's current price.
- Do not post trader-facing Discord snapshots from stale cache-only levels.
- If candle evidence is stale, missing, partial, or out of overlap, mark the audit conclusion as data-limited instead of pretending the quiet/noisy verdict is proven.

## Replay Queues And Runners

Useful replay entry points:

- `src/scripts/run-support-resistance-story-replay.ts`
  - Replays stored warehouse candles through watchlist/story logic.
  - Best for asking whether support/resistance story posts would follow a fast mover and whether the map has enough forward levels.

- `src/scripts/run-specific-ticker-date-replay.ts`
  - Replays selected symbol/date/time windows.
  - Best for specific historical examples like known runners or map-exhaustion cases.

- `src/scripts/build-support-resistance-story-test-queue.ts`
  - Builds queue cases from warehouse candles with enough movement to stress the S/R story map.

- `src/scripts/run-saved-data-regression.ts`
  - Runs saved Discord/session regression checks.
  - Best before/after sanity check when tuning post policy.

- `src/scripts/run-monday-replay-checklist.ts`
  - Runs the broader replay/audit checklist.
  - Best for a comprehensive closed-market review pass.

Useful replay docs/artifacts:

- `docs/support-resistance-story-test-queue.md`
  - Batch table of stored-candle fast movers.

- `docs/watchlist-level-qa-queue.md`
  - Historical 5h replay QA, including map-exhaustion findings and fixes.

- `artifacts/support-resistance-story-replay*/support-resistance-story-replay.md`
  - Story-map replay outputs.

- `artifacts/specific-ticker-date-replay*/specific-ticker-date-replay.md`
  - Specific ticker/date replay outputs.

## Which Replay Report To Use

For "the thread felt noisy":

```powershell
npm run audit:usefulness -- artifacts\long-run\<session-folder>
npm run audit:thread-health -- artifacts\long-run\<session-folder>
npm run audit:post-reasons -- artifacts\long-run\<session-folder>
```

For "did quiet policy hide something important?":

```powershell
npm run audit:missed-moves -- artifacts\long-run\<session-folder>
npm run audit:why-no-post -- artifacts\long-run\<session-folder>
```

For "was the whole session balanced and supported by candle evidence?":

```powershell
npm run audit:session-behavior -- artifacts\long-run\<session-folder>
npm run audit:eod-verdict -- artifacts\long-run\<session-folder>
```

For "did posts make sense visually as a timeline?":

```powershell
npm run audit:visual-replay -- artifacts\long-run\<session-folder>
```

For "read this like a trader story, ticker by ticker":

```powershell
Get-Content artifacts\long-run\<session-folder>\discord-delivery-audit.jsonl |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.symbol -in @('SYMBOL1','SYMBOL2') } |
  Select-Object timestamp,symbol,title,messageKind,eventType,signalCategory,targetPrice,body |
  ConvertTo-Json -Depth 5
```

Then write the focused verdict into the current audit doc or index. Do not leave the focused read only in terminal output.

For "did a saved historical runner run out of S/R map?":

```powershell
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 5 --out artifacts\specific-ticker-date-replay
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 10 --hours 5 --out artifacts\support-resistance-story-replay-batch-1
```

For "is the candle warehouse healthy enough to trust replay evidence?":

```powershell
npm run candles:audit
npm run candles:import-readiness
npm run startup:cache-readiness
```

For a broad closed-market pass:

```powershell
npm run replay:monday -- --skip-slow
```

Then review the generated checklist follow-ups. Key files usually include:

- `trader-usefulness-replay-score.md`
- `daily-trader-review.md`
- `missed-meaningful-move-audit.md`
- `why-no-post-replay-proof.md`
- `session-behavior-audit.md`
- `first-snapshot-trade-map-audit.md`
- `post-reason-audit.md`
- `visual-audit-replay.html`

## Replay Findings Should Drive The Same Product Standard

Replay is not just a technical backtest. Use it to ask the same trader-story questions:

- Did the first map give enough forward support/resistance context?
- Did the replayed price path break, reject, reclaim, hold, lose support, or continue?
- Did the simulated posts follow that path as one story?
- Did the app stay quiet inside chop?
- Did the app miss the real move?
- Did the level map run out while price was still moving?
- Did replay suppression remove repeated context posts while preserving candle-backed meaningful events?

If replay says a policy would suppress many posts, confirm with missed-move and why-no-post proof before tightening live behavior.

If replay says the map ran out of levels, treat it as a level coverage problem, not a Discord wording problem.

If replay evidence is missing or stale, do not tune from it until candle readiness is fixed.

## Useful Code and Reports

Review tools and implementation areas:

- `src/lib/review/daily-trader-review.ts`
  - Operator-only review of whether each symbol thread told a useful trader story without overposting.

- `src/lib/review/live-post-replay-simulator.ts`
  - Replays live post policy and estimates what would be posted or suppressed.

- `src/lib/review/session-behavior-audit.ts`
  - Checks session behavior, first-post quality, post balance, and timeline samples.

- `src/lib/review/missed-meaningful-move-audit.ts`
  - Looks for candle-backed meaningful moves that were missed or weakly covered.

- `src/lib/review/trader-post-quality-grader.ts`
  - Checks Discord-visible wording for advice, system language, overcertainty, and repetition.

- `src/lib/review/post-reason-audit-report.ts`
  - Helps answer why a post fired.

- `src/lib/monitoring/live-thread-post-policy.ts`
  - Main live policy for whether an alert should post into the Discord thread.

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
  - Watchlist runtime, snapshots, follow-through updates, alert routing, and state handling.

- `src/lib/alerts/alert-router.ts`
  - Discord routing and formatting for alert/snapshot posts.

Useful commands for a live session folder:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\<session-folder>
npm run audit:thread-health -- artifacts\long-run\<session-folder>
npm run audit:lifecycle -- artifacts\long-run\<session-folder>
npm run audit:visual-replay -- artifacts\long-run\<session-folder>
npm run audit:missed-moves -- artifacts\long-run\<session-folder>
npm run audit:session-behavior -- artifacts\long-run\<session-folder>
npm run quality:posts -- artifacts\long-run\<session-folder>
```

For the May 6, 2026 live review discussed when this doc was created, the active session folder was:

```text
artifacts/long-run/2026-05-06_12-35-19
```

That fresh restarted session is the best May 6 live-current evidence. Earlier May 6 sessions, including `2026-05-06_10-14-15`, are still useful historical proof of bugs such as old `range_compression` leakage, but they should not be confused with the restarted runtime.

## Audit Tone

Pretend the reader is a long-biased trader trying to understand the play quickly, but do not turn the app into a "trading coach" persona.

The audit should be strict about usefulness:

- Did this post help the trader understand the live play?
- Did this post change the story?
- Did this post give the next important area?
- Did silence make more sense here?
- Did the app miss a move that mattered?

That is the standard.
