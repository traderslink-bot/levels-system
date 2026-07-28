# Continuous Trader Story Audit - 2026-05-06

Purpose: respond to the operator request for a larger continuous audit pass, not another tiny spot-check. This pass audited the fresh restarted runtime, saved Discord regressions, replay/candle coverage, and the current noise-suppression safety checks.

Read this with:

- `docs/80_HOW_TO_AUDIT_TRADER_STORY_DISCORD_POSTS.md`
- `docs/81_AUDIT_AND_REPLAY_COVERAGE_INDEX.md`
- `docs/82_PAST_REPLAY_EVENTS_AUDIT_2026-05-06.md`

## Runtime State

Fresh runtime:

- URL: `http://127.0.0.1:3010/`
- Session: `artifacts/long-run/2026-05-06_12-35-19`
- Runtime PID in audit markers: `14056`
- Launcher PID reported by PowerShell: `14240`
- Diagnostics: off by default
- Active symbols restored at startup: `17`

The app was restarted after the earlier timeout/silence concern. The current fresh session is the main source for live Discord truth in this audit.

## Commands Run

Fresh live-session audit:

```powershell
npm run longrun:audit:reports -- artifacts\long-run\2026-05-06_12-35-19
npm run quality:posts -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:thread-health -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:usefulness -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:missed-moves -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run audit:session-behavior -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run audit:first-snapshots -- artifacts\long-run\2026-05-06_12-35-19
```

Cross-session and candle-coverage audit:

```powershell
npm run saved-data:test -- --input artifacts\long-run --limit 20 --output artifacts\continuous-audit-2026-05-06\saved-data-regression-latest-20
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 20 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\why-no-post-latest-20
npm run candles:audit -- data\candles --out-dir artifacts\continuous-audit-2026-05-06\candle-warehouse-audit
npm run startup:cache-readiness -- --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\startup-cache-readiness
npm run candles:import-readiness -- --input artifacts\long-run --all-sessions --max-sessions 20 --max-trades 80 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\candle-import-readiness-latest-20
npm run levels:quality-detect -- --max-cases 80 --windows-per-day 2 --min-selection-score 6 --allow-repeat-symbols --out artifacts\continuous-audit-2026-05-06\level-quality-detection-80-smoke
```

Focused verification after the ladder-step materiality fix:

```powershell
node --test --import tsx src\tests\manual-watchlist-runtime-manager.test.ts
node --test --import tsx src\tests\live-thread-post-policy.test.ts src\tests\live-post-replay-simulator.test.ts
npx tsc --noEmit --pretty false
```

## Fresh Session Results

Coverage label: `partial` but live-current for this restarted runtime.

Fresh session facts at audit time:

- `discord-delivery-audit.jsonl`: 32 rows, 32 posted, 0 failed.
- Posted compression/non-live rows: 0.
- `quality:posts`: 31 posted rows graded, 0 findings, 0 blockers, 0 major, 0 watch, 0 repeated-story clusters.
- `thread-health`: 17 symbols healthy, 0 watch, 0 major review, 0 broken.
- `trader-usefulness`: 17 symbols, 14 follow-up posts reviewed, 9 useful changes, 5 early-but-relevant, 0 repeat noise, 0 late, 0 missing context.
- `why-no-post`: 17 symbols, 14 quiet-supported, 3 quiet-preserved-meaningful-moves, 0 quiet-may-hide, 0 runtime/feed silence, 0 missing candles.
- `missed-moves`: 3 meaningful move candidates, 0 missed, 0 major missed.
- `first-snapshots`: 17 symbols, 16 strong, 1 weak, 0 missing, average 83.8/100.
- `session-behavior`: 17 symbols, readiness 0 ready / 6 partial / 11 blocked, thread balance 17 data-unproven.

Interpretation:

- The original 3010 timeout/silence concern is not reproduced in the fresh runtime. The app is posting, delivery is succeeding, and no thread is marked broken.
- The fresh run does not show the old `range_compression` leak. That was the highest-risk saved-regression failure from older sessions.
- Current noise controls are not obviously too strict in the fresh live session: no actionable missed candidates, no quiet-may-hide verdict, and no runtime/feed silence.
- Session-behavior remains `data_unproven` because it needs more overlapping candle time before it can say a symbol was definitively too quiet or too noisy across the whole session.

## Expanded Continuous Pass

This section records the deeper follow-up after the operator asked for a more thorough continuous audit rather than another quick spot-check.

Additional commands:

```powershell
npm run audit:eod-verdict -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles
npm run audit:post-reasons -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:known-bad-posts -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:visual-replay -- artifacts\long-run\2026-05-06_12-35-19
npm run audit:daily-review -- artifacts\long-run\2026-05-06_12-35-19
npm run saved-data:test -- --input artifacts\long-run --all --output artifacts\continuous-audit-2026-05-06\saved-data-regression-all-expanded-final
npx tsx src/scripts/run-support-resistance-story-replay.ts --cases artifacts\support-resistance-story-test-queue\support-resistance-story-test-cases.json --offset 0 --limit 80 --hours 8 --out artifacts\continuous-audit-2026-05-06\support-resistance-story-replay-80-8h
npx tsx src/scripts/run-specific-ticker-date-replay.ts --hours 8 --out-dir artifacts\continuous-audit-2026-05-06\specific-ticker-date-replay-forward-8h
npm run audit:why-no-post -- --all-sessions --input artifacts\long-run --max-sessions 25 --warehouse data\candles --out-dir artifacts\continuous-audit-2026-05-06\why-no-post-latest-25-expanded
npm run quality:posts -- artifacts\long-run\2026-05-06_12-35-19 --output artifacts\continuous-audit-2026-05-06\quality-fresh-expanded-after-rerun
npm run audit:known-bad-posts -- artifacts\long-run\2026-05-06_12-35-19 --output artifacts\continuous-audit-2026-05-06\known-bad-fresh-expanded-after-rerun
```

Fresh live session, expanded read:

- Latest saved-data regression snapshot: 53 fresh posted rows, 35 current metadata rows, replay estimate 53 -> 50 posts, 0 repeated-story clusters.
- `quality:posts` after more runtime accumulation: 52 posted rows, 1 data-quality-only finding, 0 blocker/major/watch findings, 0 repeated-story clusters.
- `known-bad-posts`: 52 posted rows checked, 0 pattern hits.
- `daily-review`: 17 symbols, 48 posts, 0 over-budget symbols, 0 late posts, 0 same-minute bursts.
- `why-no-post` on the fresh session remained clean: 0 quiet-may-hide, 0 runtime/feed silence, 0 missing candles.
- Direct JSON filtering of `discord-delivery-audit.jsonl` found no fresh-session `range_compression` Discord posts. The `range_compression` failures in the all-session regression belong to older sessions, especially `2026-05-06_10-14-15` and `2026-05-06_07-08-26`.

Trader-story read:

- The fresh thread set is not noisy by current evidence. It is following real level clears, breakouts, support losses, reclaims, and a small number of current-read/context posts.
- The main current weakness is not overposting. It is occasional missing next-level context on thin maps, most clearly EZGO.
- ATLN is a good example of the desired story shape in the fresh session: range map, resistance test, then breakout context. Its weak-probe/current-read posts should be watched, but the thread is not a noise failure.

Old noisy baseline:

- `artifacts/long-run/2026-04-28_12-34-46` remains a useful contrast case.
- `quality:posts`: 390 posted rows, 398 findings, 351 major, 36 repeated-story clusters.
- `audit:usefulness`: 383 posts, 81 repeat-noise rows. ATER, SEGG, BIYA, and SKYQ scored poorly.
- `thread-health`: SKYQ broken; ATER, SEGG, DRCT, and BIYA major review.
- Saved replay estimates show the current policy would heavily reduce old noisy sessions, including roughly 87% reduction on `2026-04-28_12-34-46`.

Interpretation:

- The recent noise-reduction direction is working compared with the old April 28 noisy baseline.
- Do not loosen the current policy from the fresh session. The thread is not starved, and it is not repeating the same story.
- Continue to audit for missing next-level context and wrong-side extension maps, because those are story-quality problems that can appear even when post count is healthy.

## Focused Thread Story Audit

This is the trader-story read the operator wanted: not just totals, but whether the thread sequence follows the play.

Method:

- Reconstruct the ticker thread in chronological order from `discord-delivery-audit.jsonl`.
- Read each transition as a trader would: first map, test, clear/failure/reclaim, next level, invalidation/repair area, and final visible story.
- Use aggregate reports as guardrails only. A clean total does not replace the thread read.
- Verdict labels: `healthy_story`, `watch_story`, `fix_story_logic`, `data_limited`, `replay_only_watch`, or `timeout_contaminated`.
- Same-day live-thread ordering and missing-post conclusions from this date are partially contaminated by the known app timeout/runtime gap. Do not tune code from those timing/order anomalies unless replay or a later uninterrupted session reproduces them.

### EZGO

Coverage: fresh live thread plus daily review.

Thread sequence:

1. Snapshot at `0.2221`: thin nearby ladder, support `0.2109`, no resistance shown.
2. Reclaim: back above `0.2109`, first resistance `0.2250`, resistance map through `0.3000`.
3. Current read: reclaim still primary, but follow-through stalling.
4. Follow-through: support loss faded, reclaim of `0.2041` would repair.
5. Extension post: `Lower support levels: 1.22, 1.19, 1.16, ... 0.2109, 0.2054`.
6. Breakdown: support lost at `0.2054`.
7. Later stale support-cluster clear: price slipped through `1.19-1.22`.
8. Later breakdown: support lost at `0.2054`, now with nearby support `0.1837`.

Story verdict: `fix_story_logic`.

What worked:

- The reclaim post was useful and trader-readable.
- The later `0.2054` breakdown with nearby `0.1837` support is the right shape.
- The thread stayed within budget.

What did not:

- The support-extension post was wrong-side context. It called levels around `1.22` lower support while the trade area was near `0.20`.
- That stale extension context then contaminated the story with a later `1.19-1.22` support-cluster clear that should not be part of the live EZGO thread around `0.20`.
- The first snapshot had no resistance, so the story depended heavily on the later reclaim map.

Decision:

- Fixed in code: extension payloads are now side-aware relative to the active snapshot/reference price.
- Keep EZGO as a watch case for thin-ladder/missing-next-level behavior, but do not loosen global posting thresholds from EZGO alone.

Follow-up:

- After another live run, confirm EZGO-like sub-dollar names no longer post stale above-price support extensions.
- If thin first maps continue, investigate level generation/extension coverage separately from Discord posting policy.

### ATLN

Coverage: fresh live thread plus daily review.

Thread sequence:

1. Snapshot at `1.38`: range between support `1.32-1.34` and resistance `1.40-1.46`; next resistance zone `1.59-1.66`.
2. Level touch near `1.40`: testing resistance, acceptance needed, resistance map to `1.86`.
3. Current read: breakout remains primary, but path is layered/tight and buyer reaction needs to be cleaner.
4. Breakout through `1.42`: hold above `1.42`, invalidation back below, first resistance `1.46`, map to `1.86`.
5. Later level touch at `1.46`: testing next resistance, support/hold area `1.42`, map still intact.

Story verdict: `healthy_story` with a small `watch_story` note.

What worked:

- This is close to the desired product shape: map, test, breakout, then next resistance test.
- The breakout post is strong because it gives hold/invalidation and the next resistance map.
- The snapshot compacted the crowded `1.40-1.46` area into a practical zone, which reads better than penny-by-penny resistance.

What did not:

- The `current read` is useful for an operator, but it is wordier and more abstract than the cleaner event posts.
- The `1.46` level-touch after breakout is acceptable, but it should be watched to avoid repeating "testing resistance" if price does not materially progress.

Decision:

- No code change from ATLN.
- Use ATLN as a positive example for the focused story audit, not as a rigid template.

Follow-up:

- Watch whether symbol recap/current-read posts add enough trader value, especially after a clean event post already owns the story.

### SKK

Coverage: fresh live thread plus daily review.

Thread sequence:

1. Snapshot at `5.57`: range between support `5.31` and resistance `5.77`; broader support `5.13`.
2. Resistance crossed at `5.40`: old resistance now support, next resistance `5.55`.
3. Support crossed lower at `5.31`: reclaim `5.31` needed, next support `5.13`.
4. Support crossed lower at `5.13`: reclaim `5.13` needed, next support `4.89`.
5. Breakdown at `5.31`: support lost, reclaim `5.31`, nearby support `5.13`.

Story verdict: `watch_story` / `timeout_contaminated`.

What worked:

- The thread followed both sides of a volatile range: failed upside attempt, support loss, then lower support progression.
- The level-clear posts are practical and short.
- Post count stayed within budget.

What did not:

- The final `5.31` breakdown partly revisits a story already introduced by the earlier `5.31` support-crossed-lower post.
- It is not obvious from the text whether the final breakdown added enough new evidence beyond "support is still failing."

Decision:

- No immediate code change. This may be acceptable confirmation, but it is the kind of sequence the focused audit should keep checking.

Follow-up:

- If more cases show `support crossed lower` followed by a same-level `breakdown` without new acceptance/failure evidence, tighten same-level breakdown confirmation or merge the second post into a lower-noise follow-through.

### ERNA

Coverage: fresh live thread plus daily review.

Thread sequence:

1. Snapshot at `5.67`: range between support `5.48-5.55` and resistance `5.86-5.93`; next resistance `6.23`.
2. Level touch at `5.92-5.93`: resistance test, acceptance above `5.93`, nearby hold area `5.86`.
3. Level touch at `6.23-6.26`: next resistance test, hold area `5.93`, resistance map to `8.55`.
4. Resistance cluster crossed `5.86-5.93`: old cluster now support, next resistance `6.23`.

Story verdict: `watch_story`.

What worked:

- The thread did move the story upward from first resistance to the next resistance area.
- The resistance-cluster clear is useful context for repair/hold if price pulls back.
- The maps were coherent and not too noisy.

What did not:

- The order is slightly awkward: the thread tests `6.23-6.26`, then later announces the `5.86-5.93` cluster crossed. A trader may wonder why the lower-cluster confirmation arrived after the next resistance test.
- Because this same-day live thread overlaps the known timeout/runtime gap, treat that ordering concern as contaminated until a clean session repeats it.

Decision:

- No code change yet. Watch for delayed lower-cluster confirmation after a higher-level touch in a clean uninterrupted runtime.

Follow-up:

- If repeated outside a timeout-contaminated session, consider suppressing or rewriting late lower-cluster clears when a newer/higher resistance-test post has already advanced the story.

### MASK

Coverage: fresh live thread plus daily review.

Thread sequence:

1. Snapshot at `2.36`: range between support `2.35` and resistance `2.40`; next major resistance `2.46-2.53`.
2. Resistance crossed at `2.40`: old resistance now support, nearby resistance `2.46`.
3. Follow-through after level touch around `2.46`: level touch stayed strong, price changed +1.22%, level should keep holding.

Story verdict: `healthy_story`.

What worked:

- The story is simple and coherent: range map, breakout attempt, then follow-through around the next level.
- The thread did not overpost.
- The next level was clear.

What did not:

- No current issue from this focused read.

Decision:

- No code change.

Follow-up:

- Keep as a clean example of a low-post thread that still follows the play.

### ATPC Replay

Coverage: clean focused 8h support/resistance story replay, not live Discord proof.

Clean replay artifact:

- `artifacts/continuous-audit-2026-05-06/clean-replay-atpc-8h-post-timeout-note/support-resistance-story-replay.md`
- `artifacts/continuous-audit-2026-05-06/clean-replay-atpc-8h-post-timeout-note/support-resistance-story-replay.json`

Replay sequence:

1. Start `2.30`, forward high `3.00` (+30.4%).
2. 62 replay candles, 13 emitted events, 12 story candidates.
3. 0 trader-facing story posts passed policy.
4. Candidate maps had resistance reach up to `34.7%`, but all candidate alerts stayed low quality.

Story verdict: `replay_only_watch` / `data_limited`.

What worked:

- The replay had candidate map context; this was not a no-level situation.

What did not:

- A +30% high move with 0 story posts is uncomfortable and deserves review.
- Focused extraction found every replay candidate was filtered with low severity/low confidence; scores ranged from `0` to `22.25`, with `shouldNotify: false` for all 12 story candidates.
- The clean rerun reproduced the same shape: 62 replay candles, 13 emitted events, 12 story candidates, 0 posted story posts.
- Candle inspection showed the early window was mostly flat/zero-volume prints around `2.30`, then the move appeared later on relatively thin prints. This is not clean evidence that the live policy hid a strong accepted continuation.

Decision:

- Keep ATPC as a replay watch case, but do not loosen global live posting thresholds from it.
- No code change from ATPC in this pass. The evidence points more toward replay/data-quality limitations and low-quality candidate scoring than a proven post-policy bug.
- Add a regression only if full-runtime replay or live evidence proves accepted continuation stayed silent despite higher-quality market/volume context.

Follow-up:

- Build or run a fuller runtime-style replay for ATPC before changing live posting thresholds. The current S/R story replay intentionally ignores volume, VWAP, EMA, P/L, AI commentary, Discord delivery, and some live-runtime state.
- If a future replay can model volume/liquidity context better and still shows accepted continuation with no post, add a narrow one-post continuation rule rather than reducing broad thresholds.

Clean replay verification:

- `node --test --import tsx src\tests\manual-watchlist-runtime-manager.test.ts`: passed 93/93, including the side-aware support-extension regression.
- `npx tsc --noEmit --pretty false`: passed.

### AKAN and SKLZ Replay

Coverage: specific ticker/date replay, 8h.

Replay sequence:

- `AKAN` 2026-04-22 11:00 ET: start `3.40`, max high `12.33` (+262.6%), starting resistance top `4.995`, refresh at first hit would add resistance to `7.6442`.
- `SKLZ` 2026-04-23 12:15 ET: start `4.38`, max high `20.00` (+356.6%), starting resistance top `6.39`, refresh at first hit would add resistance to `9.63`.

Story verdict: `watch_story` for forward-map refresh, not Discord verbosity.

What worked:

- The replay proves refresh would add higher resistance.
- This supports the dynamic-map-refresh direction.

What did not:

- The starting maps can still be exhausted by extreme runners.

Decision:

- Do not solve AKAN/SKLZ by adding generic noisy posts.
- Keep improving timely forward-map refresh so the story has fresh overhead context as the runner advances.

Follow-up:

- Audit live/replay cases where a runner exhausts the displayed map before refresh context reaches the thread.

## Ticker Notes

### ATLN

ATLN was specifically called out by the operator earlier, so it was reviewed closely.

Fresh session:

- Posts: snapshot, level touch, current read.
- Thread health: healthy.
- Usefulness: level touch marked useful/material; current read marked early but relevant.
- Missed-move audit: no candle-backed meaningful move candidate in the audited window.

Decision:

- No code change from ATLN in this pass.
- The fresh ATLN story is not showing repeated adjacent noise or missing next-level context.
- Continue to prefer practical zones/stronger representatives over penny-close duplicate resistance on `$1+` names, but do not remove useful follow-up posts just because one example looked wordy.

### EZGO

EZGO is the main watch item from the fresh session.

Evidence:

- First snapshot score: weak 58/100.
- Snapshot audit: displayed latest levels were `1 support / 0 resistance`.
- Usefulness report: ladder confidence thin.
- Missed-move audit: +6.0% 5m close move and +10.9% candle range were weakly covered by the initial snapshot, with 0 missed and 0 major missed.

Decision:

- Do not tune global posting policy from EZGO alone.
- Treat EZGO as both a level-map coverage watch case and a regression case for wrong-side extension ladders.
- A bad `EZGO next levels to watch` post showed `Lower support levels` such as `1.22`, `1.19`, and `1.16` while the live trade area was near `0.20`. That is a stale/wrong-side support-extension story, not useful trader context.
- Code now filters extension ladders by side relative to the active snapshot/reference price before posting. Support extensions must be below the active trade area; resistance extensions must be above it.
- If future live/replay evidence shows EZGO-like names repeatedly have no resistance map while price has realistic forward targets, investigate level generation/extension for sub-dollar thin-ladder symbols.

### ERNA and MASK

Both had weakly covered meaningful-move candidates:

- ERNA: +6.1% 5m range, nearby snapshot existed.
- MASK: -3.3% support loss style move, nearby snapshot existed.

Decision:

- These are watch candidates, not missed-post failures.
- Keep them in later review if more candles accumulate and the thread still does not explain the move.

### EDHL

The replay suppression proof found one balanced-policy suppression:

- Suppressed reason: `alert_zone_chop`
- Event: EDHL resistance crossed
- Why-no-post verdict: quiet supported by candles

Decision:

- This is healthy evidence for the noise policy. It suppressed one likely choppy repeat while preserving meaningful moves.

## Cross-Session Results

Coverage label: `partial` / `data_limited`.

Latest 20 saved Discord files:

- Rows: 1,578
- Posted rows: 1,578
- Current metadata rows: 668
- Fail findings: 27
- Warn findings: 1
- Fresh session `2026-05-06_12-35-19` had no findings in that early snapshot.

Interpretation:

- The nonzero saved-data regression is driven by older sessions, especially saved `range_compression` rows from before the live suppression fix.
- The fresh restarted session is the important proof for whether the bug still exists, and it has 0 non-live/compression posted rows so far.

Why-no-post latest 20 saved sessions:

- Symbols: 12
- Quiet supported: 1
- Quiet preserved meaningful moves: 1
- Quiet may hide: 0
- Runtime silence: 2
- Missing candles: 8
- Actionable missed candidates: 0

Interpretation:

- This is not proof that every older session was perfect. It is proof that the available saved evidence did not find actionable quiet-policy misses.
- The broad historical verdict remains data-limited until older sessions have better overlapping candles.

Expanded why-no-post latest 25 saved sessions:

- Symbols: 14
- Quiet supported: 1
- Quiet preserved meaningful moves: 2
- Quiet may hide: 0
- Runtime/feed silence: 2
- Missing candles: 9
- Actionable missed candidates: 0

Interpretation:

- The broader silence proof still does not show policy suppression hiding actionable moves.
- It does show old-session replay is candle/data-limited. `YCBD` and `AKAN` had runtime/feed-silence candidates; many others lacked overlapping candles.
- Treat broad old-session quiet conclusions as `data_limited`, not clean proof.

Saved-data all-session regression final:

- Audit files checked: 98
- Rows: 7,428
- Posted rows: 6,797
- Current metadata rows: 727
- Findings: 27 fail / 69 warn / 118 info
- Fresh session `2026-05-06_12-35-19`: 53 posted rows, 0 repeated-story clusters, no findings under that session block.
- Older session `2026-05-06_10-14-15`: still contains `range_compression` failures, proving the earlier runtime had the leak.

Interpretation:

- The app restart/fix path matters. The current fresh session is clean for `range_compression`; older saved sessions remain historical proof of the bug.
- Keep checking new sessions for any `range_compression` or `signalCategoryLiveEnabled: false` Discord rows.

## Historical Replay Expansion

Support/resistance story replay, 80 cases over 8h:

- Cases: 80
- Loaded successfully: 80
- Main concern: `ATPC` 2026-05-04 05:45 ET had events and a +30.4% high move, but 0 trader-facing story posts passed policy in the story replay lane.
- Low-post/high-move watch queue from the 8h run: `HCAI`, `CCM`, `UCAR`, `ABVE`, `ARKR`, `SAFX`, `RLYB`, `ATPC`, `AGAE`.

Decision:

- `ATPC` remains the focused watch case, not a global threshold change. Earlier manual review found thin early candles/low-liquidity context, and this replay lane is not identical to full live Discord runtime behavior.
- The low-post/high-move names should be reviewed as a queue before loosening policy. The right question is whether the level map/story ran out, not whether any large candle automatically deserves more Discord posts.

Specific ticker/date replay, 8h:

- `AKAN` 2026-04-22 11:00 ET: map exhausted; max high 12.33 (+262.6%); starting resistance top 4.995; refresh would add higher resistance to 7.6442.
- `SKLZ` 2026-04-23 12:15 ET: map exhausted; max high 20 (+356.6%); starting resistance top 6.39; refresh would add higher resistance to 9.63.
- `YCBD`, `AIXI`, `CAST`, `YAAS`, `SEGG`, and `ATER`: no map exhaustion inside the 8h replay window.

Decision:

- For extreme runners like AKAN/SKLZ, the continuing need is dynamic forward-map refresh, not noisier generic posting.
- For non-exhaustion names, preserve the current compact trader story and avoid full ladders in Discord unless explicitly operator-enabled.

## Candle Coverage

Warehouse audit:

- Groups: 1,100
- Rows: 313,312
- Watch groups: 249
- Broken groups: 0

Startup cache readiness:

- Active symbols: 17
- Ready for fast restore: 0
- Partial cache: 17
- Blocked: 0

Interpretation:

- The warehouse is structurally intact.
- Startup cache is not deep enough for fast restore under the strict lookback rules, so fresh refresh before Discord snapshot remains required.
- This is a process/coverage issue, not evidence that the Discord thread logic is broken.

Candle import readiness latest 20:

- Trade proxies: 20
- Planned tasks: 80
- Fully covered tasks: 25
- Missing tasks: 55
- Estimated missing candles: 15,829

Missing/partial symbols called out by the report include:

- Missing: `AMST`, `BURU`, `INTC`, `ITOC`, `PAPL`, `TDIC`
- Partial: `AKAN`, `AUUD`, `AIXI`, `YCBD`, `FFAI`

Interpretation:

- Any broad claim about old sessions involving these symbols should be marked `data_limited`.
- Backfill these before using old sessions as proof that quiet policy is safe or unsafe.

## Level-Quality Smoke

Command:

```powershell
npm run levels:quality-detect -- --max-cases 80 --windows-per-day 2 --min-selection-score 6 --allow-repeat-symbols --out artifacts\continuous-audit-2026-05-06\level-quality-detection-80-smoke
```

Result:

- Cases: 80
- Scored: 80
- Unscored: 0
- Forward-resistance missing cases: 0
- Clean broken level diagnostics not explained yet: 0
- Clean strong/major broken diagnostics not explained yet: 0

Interpretation:

- This smoke does not demand a Discord change.
- It supports the current boundary: use level-quality replay to investigate level detection, not to loosen trader-facing posting policy by itself.

## Code Change From This Audit

The focused runtime suite found two real issues during the continuous audit.

Issue 1: clustered level-clear materiality.

The new ladder-step cooldown could suppress intermediate support/resistance clears even when the runtime considered the move major/material.

Fix:

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `shouldPostLevelClearUpdate` now passes `majorChange` as `practicalStructureMaterialChange` into `decideIntelligentAlertPost`.

Issue 2: wrong-side extension ladders.

EZGO produced a bad support-extension post with old higher levels listed as `Lower support levels` while price was near `0.20`.

Fix:

- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `buildLevelExtensionPayload` now filters extension zones against the active snapshot/reference price before building the Discord payload.
- Support extensions must sit below the active trade area; resistance extensions must sit above it.

Why this matters:

- Small clustered level-step chatter can still be suppressed.
- True multi-level clear/failure events are allowed through so Discord can follow the play when a fast ticker actually progresses.
- Extension ladder posts no longer tell a nonsensical story like "lower support" at prices far above the active trade area.

Verification:

- `manual-watchlist-runtime-manager.test.ts`, `alert-router.test.ts`, and `live-post-replay-simulator.test.ts`: passed 150/150.
- `npx tsc --noEmit --pretty false`: passed.

## Product Read

What looks healthy:

- The restarted runtime is alive and posting.
- Delivery failures are 0.
- Fresh post quality is clean by current graders.
- Thread health is clean for all active symbols.
- No current evidence of the earlier `range_compression` Discord leak.
- Quiet policy did not hide actionable moves in the fresh session proof.
- The ladder-step materiality bug found during the audit was fixed and covered by tests.

What remains watch/data-limited:

- EZGO thin ladder/no displayed resistance.
- ERNA and MASK weakly covered candle candidates.
- Broad historical why-no-post proof is still data-limited because older sessions lack overlapping candles.
- Startup cache is partial for every active symbol, so fresh refresh remains required before Discord snapshots.

Decision:

- Do not loosen global posting thresholds from this pass.
- Do not add more Discord verbosity from operator-only audit findings.
- Keep the current direction: fewer noisy posts, but allow true multi-level/material clears so the thread follows the play.

## Next Actions

1. Let the fresh runtime accumulate more rows, then rerun the same fresh-session audit stack.
2. Watch EZGO-style thin ladders for missing forward resistance.
3. Backfill or import missing historical candle coverage before drawing strong conclusions from old sessions involving `AMST`, `BURU`, `INTC`, `ITOC`, `PAPL`, `TDIC`, `AKAN`, `AUUD`, `AIXI`, `YCBD`, or `FFAI`.
4. Keep checking fresh sessions for any `range_compression` or `signalCategoryLiveEnabled: false` posts reaching Discord.
