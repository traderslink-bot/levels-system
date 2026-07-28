# Focused Trader Story Regression Audit 2026-05-07

Purpose: focused follow-up on the first regression queue names after the broad 20-session story-quality backtest.

Symbols reviewed:

- `PMAX`
- `SKK`
- `SMX`
- `SEGG`

Artifacts:

- `artifacts/story-quality-focused-regression-2026-05-07/`
- Prior aggregate: `artifacts/story-quality-backtest-2026-05-07-recent20/aggregate-findings.md`
- Queue doc: `docs/86_TRADER_STORY_REGRESSION_QUEUE_2026-05-07.md`

## Commands

```powershell
npm run audit:story-quality -- artifacts\long-run\2026-05-07_15-32-55 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-07_15-32-55
npm run audit:story-quality -- artifacts\long-run\2026-05-07_07-01-08 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-07_07-01-08
npm run audit:story-quality -- artifacts\long-run\2026-05-06_18-07-37 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-06_18-07-37
npm run audit:story-quality -- artifacts\long-run\2026-05-06_12-35-19 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-06_12-35-19
npm run audit:story-quality -- artifacts\long-run\2026-05-06_10-14-15 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-06_10-14-15
npm run audit:story-quality -- artifacts\long-run\2026-05-06_07-08-26 --warehouse data\candles --out-dir artifacts\story-quality-focused-regression-2026-05-07\2026-05-06_07-08-26
```

## Audit Definition Change

This pass tightened the audit definition:

- `stock_context` company/startup posts are excluded from trader-story post budgets.
- They also no longer appear as trader-story worst examples.
- This makes `daily-trader-review` judge the play-following posts, not the context opener.

Code/test:

- `src/lib/review/daily-trader-review.ts`
- `src/tests/daily-trader-review.test.ts`

## Focused Results

| Session | Verdict | Symbols | Trader-Story Posts | Story Risks | Ladder Findings | Major Ladder |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `2026-05-07_15-32-55` | clean | 9 | 71 | 0 | 0 | 0 |
| `2026-05-07_07-01-08` | needs_review | 13 | 225 | 3 | 6 | 3 |
| `2026-05-06_18-07-37` | needs_review | 10 | 31 | 0 | 2 | 1 |
| `2026-05-06_12-35-19` | needs_review | 17 | 179 | 1 | 6 | 5 |
| `2026-05-06_10-14-15` | needs_review | 17 | 103 | 3 | 1 | 0 |
| `2026-05-06_07-08-26` | needs_review | 14 | 89 | 2 | 2 | 2 |

## Symbol Verdicts

### PMAX

Coverage: older-session regression pressure; current clean session did not include PMAX.

Thread sequence read:

- `2026-05-06_07-08-26`: initial PMAX map near `3.10`; a nearby `3.11` support was omitted as wrong-side even though it was only 0.3% from price.
- `2026-05-06_10-14-15`: PMAX had 9 trader-story posts against an 8-post low-volume/chop budget; it was a watch case, not a major failure after excluding `stock_context`.
- `2026-05-06_18-07-37`: snapshot showed `4.97 -> 6.75` overhead path; warehouse candles suggested a practical `5.691-5.93` zone inside that gap.
- `2026-05-07_07-01-08`: PMAX overposted as an active runner, 34/25 trader-story posts.

Story verdict: `watch_story`.

What worked:

- Posts generally named the active event: breakout, breakdown, support loss, reclaim.
- The thread usually gave what needed to reclaim or hold.

What did not:

- Older runs could re-alert the same support-loss area repeatedly after shallow failed/faded follow-through.
- The `4.97 -> 6.75` overhead gap likely made the path look cleaner than the chart history suggested.

Decision:

- Do not change global posting policy from PMAX alone.
- Keep PMAX as a regression case for repeated support-loss/faded-follow-through chatter and hidden forward resistance zones.

Follow-up:

- If PMAX-style repeated same-support breakdowns reproduce in current live code, tune same-zone support-loss cooldown/story-memory rather than level detection.
- If hidden forward zones repeat across more symbols, tune ladder detection/extension.

### SKK

Coverage: older-session regression pressure; current clean session did not include SKK.

Thread sequence read:

- `2026-05-06_07-08-26`: SKK went from `6.35` through `6.20`, `6.00-6.07`, reclaim/fake breakdown, then back to repeated support tests. After excluding `stock_context`, this is a watch case at 11/8 rather than the earlier 12/8 major.
- `2026-05-06_10-14-15`: SKK still produced a major low-volume/chop budget failure at 12/8, with breakdown/reclaim/resistance-test posts close together.
- `2026-05-06_12-35-19`: a `5.55` resistance was omitted as wrong-side only 0.4% from price.

Story verdict: `watch_story`.

What worked:

- The sequence generally followed the active line: support loss, reclaim, resistance test, later loss.

What did not:

- SKK is a good example of chop producing too many trader-story posts around nearby levels.
- The near-price wrong-side resistance omission is the exact role-flip class fixed later in `manual-watchlist-runtime-manager.ts`.

Decision:

- The wrong-side omission is likely already fixed by the current role-flip/important-at-price logic.
- The remaining risk is post cadence in low-volume chop; do not tighten until a clean current session reproduces it.

Follow-up:

- Keep SKK in regression reruns after same-zone cooldown or weak-probe suppression changes.

### SMX

Coverage: repeated hidden-ladder candidate across three older/current-day sessions.

Thread sequence read:

- SMX repeatedly showed an overhead gap from roughly `1.91/1.95` to `2.23`.
- Warehouse evidence repeatedly suggested a practical `2.08-2.14` zone inside the posted gap.
- Thread story itself was not mainly noisy; the issue is the map making the overhead path look too open.

Story verdict: `fix_watchlist_candidate`.

What worked:

- Breakdown/reclaim/support-loss posts generally described the active play.
- The sequence did not fail mainly because of post count.

What did not:

- The same candidate hidden zone repeated across multiple sessions.
- This is the strongest evidence from this focused pass for a future ladder-detection improvement.

Decision:

- Do not patch immediately from SMX alone, but SMX should be the first candidate if adding a tested OHLC reaction-zone promotion rule.

Follow-up:

- Build a small fixture around `SMX 2.08-2.14` if we decide to promote repeated daily/4h OHLC clusters inside wide posted gaps.

### SEGG

Coverage: older issue plus current clean proof.

Thread sequence read:

- Older `2026-05-06_12-35-19`: `1.29` strong resistance omitted as wrong-side at the active price. This matches the role-flip class.
- Older `2026-05-07_07-01-08`: SEGG overposted in low-volume/chop and also showed a hidden `1.90-1.978` candidate inside `1.79 -> 2.03`.
- Current `2026-05-07_15-32-55`: SEGG is clean after the DXYZ/SEGG level fixes: 8/8 budget, 0 story risks, 0 ladder findings.

Story verdict: `healthy_current_watch_old_regression`.

What worked:

- Current SEGG session has a clean story and clean ladder audit.
- The newer ladder showed the practical `1.96` area instead of jumping straight from `1.79` to `2.03`.

What did not:

- Older sessions overposted repeated support-loss / support-loss-faded style updates in chop.
- Older ladder detection missed the practical overhead zone.

Decision:

- Treat SEGG as evidence that current fixes helped.
- Keep older SEGG as a regression case, not an active bug.

Follow-up:

- After future ladder changes, rerun both:
  - current clean `2026-05-07_15-32-55`
  - older pressure `2026-05-07_07-01-08`

## Overall Decision

No broad live-posting policy change from this focused pass.

The current clean live session is the controlling evidence for today's code. Older sessions remain useful regression pressure, especially:

- SMX repeated hidden `2.08-2.14` overhead zone.
- PMAX repeated/faded same-support chatter in active-runner conditions.
- SKK low-volume/chop post cadence.
- SEGG older hidden-gap and wrong-side issues, now apparently improved.

Next best code candidate, if we continue closed-market improvements:

- Add a narrow, tested ladder-detection promotion for compact daily/4h OHLC reaction clusters inside wide posted forward gaps.
- Use SMX first, then PMAX/SEGG/AKAN as validation.
