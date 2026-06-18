# Level Quality Detection Handoff - 2026-05-05

## Purpose

This note is for resuming the small-cap support/resistance level-quality work in a fresh chat.

The user paused the work after the expanded saved-candle QA cycle. Continue from here rather than restarting the investigation.

## User Intent

The user cares most about two things before anything else:

1. Coverage quality:
   - Traders should not run out of useful upside/downside levels in Discord stories.
   - Small caps can move 30%, 50%, or more quickly, so the system needs practical forward levels, not only the nearest one or two.
   - The full ladder and story-level output must keep enough useful targets ahead of price.

2. Actual level quality:
   - Strong/moderate/weak/major labels should match candle evidence.
   - Volume should be used for QA/operator scoring, but do not add volume to Discord posts yet.
   - Do not change trader-facing copy until offline reports prove the level logic is better.

## Hard Boundaries

- Do not use live API data for this paused QA work unless the user explicitly asks.
- Use saved warehouse candles only.
- Do not touch Discord wording/output while this level-quality calibration is still being measured.
- Do not add VWAP/EMA back into trader-facing support/resistance work.
- Do not make broad scoring threshold changes without first inspecting the remaining raw-candle cases.

## Current Files To Read First

- `docs/75_LEVEL_QUALITY_DETECTION_WORKPLAN_2026-05-04.md`
- `docs/76_LEVEL_QUALITY_DETECTION_QA_LOG_2026-05-04.md`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`
- `src/tests/level-scorer.test.ts`
- `src/tests/level-engine.test.ts`

## Latest Artifacts

Use these as the current baseline:

- `artifacts/level-quality-detection-300-expanded-classifier-aligned`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-2h`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-8h`

Earlier comparison artifacts:

- `artifacts/level-quality-detection-300-expanded-diagnostics`
- `artifacts/level-quality-detection-300-expanded-diagnostics-2h`
- `artifacts/level-quality-detection-300-expanded-diagnostics-8h`
- `artifacts/level-quality-detection-300-expanded-low-motion`
- `artifacts/level-quality-detection-300-expanded-low-motion-2h`
- `artifacts/level-quality-detection-300-expanded-low-motion-8h`

## What Was Completed

The report script now supports broader saved-candle QA:

```powershell
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned
```

Important report improvements:

- Added `--windows-per-day`.
- Added `--min-selection-score`.
- Expanded from fewer than 100 eligible windows to 300-case reports.
- Added `single_touch_higher_timeframe_reference`.
- Added `sparse_tape_clean_break_watch`.
- Aligned clean-break classification with sparse-tape diagnostics.

Verification passed before pause:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts src\tests\level-engine.test.ts src\tests\forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
git diff --check -- src\scripts\run-level-quality-detection-report.ts src\lib\validation\forward-reaction-diagnostics.ts src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts src\tests\level-engine.test.ts docs\76_LEVEL_QUALITY_DETECTION_QA_LOG_2026-05-04.md
```

Results:

- Focused tests passed: 61/61.
- TypeScript passed.
- Diff whitespace check passed.

## Latest Metrics

5-hour aligned report:

- Cases reviewed: 300
- Scored: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Needs-manual-review clean-break classifications: 1
- Remaining manual clean-break target:
  - `EFOI` 3.85 major 4h/5m resistance

2-hour aligned report:

- Cases reviewed: 300
- Scored: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Possible-overstated-strength clean-break classifications: 2
- Needs-manual-review clean-break classifications: 1
- Remaining clean-break targets:
  - `SKLZ` 3.42 major 5m/daily support
  - `HOWL` 0.73 major 5m/daily resistance
  - `EFOI` 3.85 major 4h/5m resistance

8-hour aligned report:

- Cases reviewed: 300
- Scored: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Needs-manual-review clean-break classifications: 2
- Remaining manual clean-break targets:
  - `SKLZ` 8.08 major daily/5m resistance
  - `SKYQ` 7.00 major daily/5m/4h resistance

## Next Best Step

Do a raw-candle inspection pass on the remaining targets before changing scoring:

1. `EFOI` 3.85
2. `SKLZ` 3.42
3. `SKLZ` 8.08
4. `HOWL` 0.73
5. `SKYQ` 7.00

For each case, decide:

- Was the level genuinely too strong for the evidence?
- Did price consume a real level with momentum?
- Is this just sparse/small-cap tape behavior?
- Did the report classify it poorly?
- Would a scoring change improve the broad report without hurting coverage?

Do not guess. Pull the raw 1m/5m/4h/daily candles from the saved warehouse and compare them to the generated level evidence.

## Raw-Candle Inspection Update - 2026-05-05

Status: completed against saved IBKR `5m` warehouse candles only. No live provider
calls and no backfill scripts were run.

Reviewed targets:

- `EFOI` 3.85 resistance, 2026-05-04: real premarket/opening reference. The
  07:45 touch rejected from 3.85 to 3.7207, then the open retested 3.85 on
  volume and pushed to 4.048 by 10:10. Treat as a real level consumed by opening
  momentum, with the 08:45 `needs_manual_review` row better classified as
  `momentum_consumed_level`.
- `SKLZ` 3.42 support, 2026-04-23: support failed cleanly first. It touched
  3.42/3.40 on rising volume, flushed to 3.25 by 11:30, then a separate
  momentum event ripped to 20.00. Keep this as a real calibration target:
  `possible_overstated_strength` is fair, but do not infer that the later rip
  validates the support reaction.
- `SKLZ` 8.08 resistance, 2026-05-01: not a clean bad level. The first 04:00
  premarket window traded through both sides, reached 8.44 at 04:20, then faded
  to 7.66/7.37 later. This is choppy premarket two-way tape around a valid
  reference, so classify as manual/operator context rather than broad scoring
  evidence.
- `HOWL` 0.73 resistance, 2026-05-01: sparse after-hours tape. The forward
  window had 31 bars, 29 zero-volume bars, and only 461 total shares. Keep
  `sparse_tape_clean_break_watch`; no scoring change.
- `SKYQ` 7.00 resistance, 2026-04-29: valid high-evidence active reference. It
  repeatedly tested 7.00 from 12:35 through 14:50, briefly pushed to 7.15, then
  sold off to 6.25 by 15:55. This should not remain a generic
  `needs_manual_review`; it is a respected/active level that was later consumed
  or resolved lower.

Recommended next code move:

- Do not change trader-facing Discord wording.
- Do not change broad strength thresholds from this five-case pass.
- Prefer classifier/reporting refinements:
  - promote late high-volume open drive cases like `EFOI` 08:45 from
    `needs_manual_review` to `momentum_consumed_level` when the broader
    resolution window already proves the consumption;
  - classify high-favorable, repeated-touch references like `SKYQ` 7.00 as
    active/respected-then-resolved instead of generic manual review;
  - keep sparse-tape detection dominant for `HOWL`-style after-hours windows;
  - keep `SKLZ` 3.42 as the main remaining scoring-calibration example.

## Classifier Refinement Update - 2026-05-05

Status: implemented in the level-quality report script only. This does not
change trader-facing Discord output, shared support/resistance scoring, or the
consumer app boundary.

Files changed:

- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/level-quality-clean-break-classifier.test.ts`

What changed:

- Added clean-break classification `active_reference_resolved` for repeated,
  high-evidence levels that produced a meaningful favorable move before later
  breaking. This covers the `SKYQ` 7.00 pattern from the raw-candle pass.
- Added late resolution-window volume-drive detection so a level can be
  classified as `momentum_consumed_level` even when the first touch itself was
  not labeled elevated/heavy. This covers the `EFOI` 3.85 opening-drive pattern.
- Kept soft, light-volume, no-reaction failures ahead of the volume-drive rule
  so `SKLZ` 3.42 remains a `possible_overstated_strength` calibration example.
- When a clean-break first-touch timestamp is not present in the saved 5m
  candles, the report now falls back to the resolution timestamp for the
  operator-only candle window.

Fresh report artifacts:

- `artifacts/level-quality-detection-300-expanded-classifier-refined`
- `artifacts/level-quality-detection-300-expanded-classifier-refined-2h`
- `artifacts/level-quality-detection-300-expanded-classifier-refined-8h`

Target outcomes after the refinement:

- `EFOI` 3.85: `momentum_consumed_level`
- `SKLZ` 3.42: `possible_overstated_strength`
- `SKLZ` 8.08: still `needs_manual_review`
- `HOWL` 0.73: sparse-tape handling remains present
- `SKYQ` 7.00: `active_reference_resolved`

Verification:

```powershell
npx tsx --test src\tests\level-quality-clean-break-classifier.test.ts src\tests\forward-reaction-diagnostics.test.ts
npx tsc --noEmit --pretty false
```

Result:

- Focused tests passed: 16/16.
- TypeScript passed.
- All three refined 300-case reports completed with 300 scored cases.

## Useful Commands

Run the latest 5-hour report:

```powershell
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned --compare-to artifacts\level-quality-detection-300-expanded-diagnostics\level-quality-scoreboard.json
```

Run the 2-hour stress report:

```powershell
npm run levels:quality-detect -- --max-cases 300 --hours 2 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned-2h --compare-to artifacts\level-quality-detection-300-expanded-diagnostics-2h\level-quality-scoreboard.json
```

Run the 8-hour stress report:

```powershell
npm run levels:quality-detect -- --max-cases 300 --hours 8 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned-8h --compare-to artifacts\level-quality-detection-300-expanded-diagnostics-8h\level-quality-scoreboard.json
```

Run focused verification:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts src\tests\level-engine.test.ts src\tests\forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
```

## Caution

The git worktree is very dirty from broader project work. Do not revert unrelated files. Treat existing changes as user or prior-agent work.

When resuming, inspect only the files needed for the current task and keep patches tightly scoped.

## Fresh Expanded Calibration Pass - 2026-05-06

Status: completed against saved warehouse candles. No provider calls and no
scoring changes were made.

Fresh artifacts:

- `artifacts/level-quality-detection-300-expanded-fresh-2026-05-06`
- `artifacts/level-quality-detection-300-expanded-fresh-2026-05-06-2h`
- `artifacts/level-quality-detection-300-expanded-fresh-2026-05-06-8h`
- Summary:
  `artifacts/level-quality-detection-300-expanded-fresh-2026-05-06-summary.md`

Results:

- 5h report: `300/300` scored, `72` clean-break targets.
- 2h report: `300/300` scored, `67` clean-break targets.
- 8h report: `300/300` scored, `67` clean-break targets.

Classifier bucket counts:

| Classification | 5h | 2h | 8h |
|---|---:|---:|---:|
| `momentum_consumed_level` | 39 | 40 | 31 |
| `minor_break_watch` | 16 | 9 | 15 |
| `possible_overstated_strength` | 10 | 12 | 10 |
| `sparse_tape_clean_break_watch` | 3 | 3 | 3 |
| `consumed_or_overtested_level` | 2 | 0 | 3 |
| `thin_liquidity_break_watch` | 1 | 2 | 2 |
| `active_reference_resolved` | 1 | 1 | 2 |
| `needs_manual_review` | 0 | 0 | 1 |

Remaining manual case:

- `SKLZ` 2026-05-01 04:00, `8.08` resistance, strength score `57.37`.
  This is still the known choppy premarket two-way tape/operator-context case.

Interpretation:

- The quality detection pipeline is healthy after the Trader Intelligence
  provider/candle-basis work: all fresh reports scored every requested case.
- The classifier continues to separate momentum-consumed real levels from
  possible overstated-strength cases.
- Do not change broad support/resistance strength thresholds from this pass
  alone.

Next best QA pass:

- Inspect repeated `possible_overstated_strength` symbols before touching
  scoring: `MLSS`, `LBGJ`, `SLGB`, `SXTC`, plus the already-known `SKLZ` 3.42
  calibration case.

## Possible-Overstated Raw-Candle QA Pass - 2026-05-06

Status: completed as a report/artifact pass only. No scoring or trader-facing
wording changes were made.

Artifact:

- `artifacts/level-quality-possible-overstated-raw-candle-qa-2026-05-06.md`

What was inspected:

- All fresh `possible_overstated_strength` rows from the 5h, 2h, and 8h
  expanded reports.
- Rows were grouped by symbol/date/level/kind so repeated windows did not
  masquerade as separate scoring failures.
- Inspection used the saved first-touch and resolution-window 5m candles already
  embedded in the report output. No provider calls were made.

Grouped patterns:

| Pattern | Repeats | Read |
|---|---:|---|
| `SXTC` `1.88` support | 7 | Most repeated group; daily/4h support, light reliable volume, no favorable reaction, regular/after-hours failures. |
| `RYET` `1.12` support | 5 | Unknown/watch volume with many zero-volume bars; evidence-quality issue before scoring issue. |
| `LBGJ` `0.84` support | 4 | Premarket support, 4h/5m + premarket-low source, light volume, minimal favorable reaction. |
| `SLGB` `0.6615` resistance | 4 | 5m-only swing-high resistance, light volume, after-hours/late regular failures. |
| `APLM` `13.49` resistance | 3 | Daily/4h resistance but unknown/watch volume and many zero-volume bars. |
| `MLSS` `0.326` / `0.322` support | 6 total | Near-duplicate support cluster, after-hours, light volume, zero favorable reaction. |
| `HOWL` `0.73` resistance | 1 | Sparse after-hours tape; do not use alone for scoring changes. |
| `PBM` `6.02` support | 1 | Heavy premarket failure but isolated; likely event/momentum context. |
| `SKLZ` `3.42` support | 1 | Still the cleanest true possible-overstated major-support calibration case. |

Decision:

- Do not change broad support/resistance strength thresholds from this pass.
- The repeated rows collapse into a small number of patterns, not a broad
  systemic level-scoring failure.
- The next code work, if any, should be narrow and operator-diagnostic oriented:
  - near-duplicate local levels that fail together (`MLSS`);
  - premarket/after-hours light-volume failures (`LBGJ`, `SLGB`, `HOWL`);
  - unknown/watch volume clean breaks (`RYET`, `APLM`);
  - source-specific checks for 5m-only swing levels that receive strong labels
    (`SLGB`).
- Keep `SKLZ` `3.42` as the primary real scoring-calibration example.
- Keep trader-facing Discord wording unchanged until a narrow diagnostic proves
  stable across another expanded report.

## Narrow Clean-Break Diagnostic Buckets - 2026-05-06

Status: implemented in the level-quality report script only. No
support/resistance scoring thresholds and no trader-facing Discord wording were
changed.

Reason:

- The raw-candle QA pass showed that many `possible_overstated_strength` rows
  were not true scoring failures.
- They were mostly evidence/session/source-shape problems that should stay in
  operator diagnostics:
  - unknown/watch volume clean breaks;
  - off-hours light-volume breaks;
  - off-hours heavy-volume event-context breaks;
  - single-timeframe 5m swing breaks;
  - local/near-duplicate swing-level clusters.

New clean-break classification buckets:

- `unknown_volume_clean_break_watch`
- `off_hours_light_volume_break_watch`
- `off_hours_event_context_break_watch`
- `single_timeframe_5m_swing_break_watch`
- `local_level_cluster_break_watch`

Files changed:

- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/level-quality-clean-break-classifier.test.ts`

Fresh diagnostic-bucket artifacts:

- `artifacts/level-quality-detection-300-expanded-diagnostic-buckets-2026-05-06-v2`
- `artifacts/level-quality-detection-300-expanded-diagnostic-buckets-2026-05-06-2h-v2`
- `artifacts/level-quality-detection-300-expanded-diagnostic-buckets-2026-05-06-8h-v2`

Results:

- 5h report: `300/300` scored, `72` clean-break targets.
- 2h report: `300/300` scored, `67` clean-break targets.
- 8h report: `300/300` scored, `67` clean-break targets.

Final classifier bucket counts:

| Classification | 5h | 2h | 8h |
|---|---:|---:|---:|
| `momentum_consumed_level` | 23 | 24 | 19 |
| `minor_break_watch` | 16 | 9 | 15 |
| `unknown_volume_clean_break_watch` | 15 | 15 | 11 |
| `off_hours_light_volume_break_watch` | 8 | 7 | 7 |
| `sparse_tape_clean_break_watch` | 3 | 3 | 3 |
| `single_timeframe_5m_swing_break_watch` | 2 | 1 | 1 |
| `off_hours_event_context_break_watch` | 2 | 2 | 3 |
| `thin_liquidity_break_watch` | 1 | 2 | 2 |
| `active_reference_resolved` | 1 | 1 | 2 |
| `consumed_or_overtested_level` | 1 | 0 | 2 |
| `local_level_cluster_break_watch` | 0 | 2 | 1 |
| `possible_overstated_strength` | 0 | 1 | 0 |
| `needs_manual_review` | 0 | 0 | 1 |

Remaining calibration targets:

- `SKLZ` 2026-04-23 10:30, `3.42` support remains the only
  `possible_overstated_strength` row across the final 5h/2h/8h pass.
- `SKLZ` 2026-05-01 04:00, `8.08` resistance remains the only
  `needs_manual_review` row; it is still the known choppy premarket
  operator-context case.

Verification:

- `npx tsx --test src\tests\level-quality-clean-break-classifier.test.ts src\tests\forward-reaction-diagnostics.test.ts`
  passed: `21/21`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.

Interpretation:

- The expanded level-quality pipeline remains healthy after the new buckets.
- The new buckets reduce noisy possible-overstated rows without weakening the
  level scorer.
- Do not change broad strength thresholds from this pass. Any future scoring
  work should start from `SKLZ` `3.42`, not the off-hours/source-quality watch
  buckets.

## Event-Regime Classification Update - 2026-05-06

Status: implemented in the level-quality report script only. No broad
support/resistance scoring thresholds and no trader-facing Discord wording were
changed.

Reason:

- User clarified the `SKLZ` 2026-04-23 move was a halt-up/gap-up style runner
  that kept expanding toward about `$20`, then later sold back through the
  gaps.
- Saved IBKR 5m candles confirm that 2026-04-23 was not an ordinary support
  calibration day:
  - first saved bar: `09:00`, close `3.69`;
  - first-touch window low: `3.25` at `11:30`;
  - high: `20.00` at `13:20`;
  - saved-session low-to-high range: `515.4%`;
  - the `13:25` bar opened at `14.00` after a prior close of `17.88`.
- Treating this as ordinary `possible_overstated_strength` would push the
  scorer to learn from a regime-change event instead of normal level behavior.

New clean-break classification bucket:

- `event_regime_change_watch`

Files changed:

- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/level-quality-clean-break-classifier.test.ts`

New artifacts:

- `artifacts/level-quality-sklz-event-regime-timeline-2026-05-06.md`
- `artifacts/level-quality-event-regime-classification-summary-2026-05-06.md`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-2h`
- `artifacts/level-quality-detection-300-expanded-event-regime-2026-05-06-8h`

Results:

- 5h report: `300/300` scored, `72` clean-break targets.
- 2h report: `300/300` scored, `67` clean-break targets.
- 8h report: `300/300` scored, `67` clean-break targets.

Final classifier bucket counts:

| Classification | 5h | 2h | 8h |
|---|---:|---:|---:|
| `momentum_consumed_level` | 23 | 24 | 19 |
| `minor_break_watch` | 16 | 9 | 15 |
| `unknown_volume_clean_break_watch` | 13 | 12 | 9 |
| `off_hours_light_volume_break_watch` | 8 | 7 | 7 |
| `sparse_tape_clean_break_watch` | 3 | 3 | 3 |
| `event_regime_change_watch` | 2 | 4 | 2 |
| `single_timeframe_5m_swing_break_watch` | 2 | 1 | 1 |
| `off_hours_event_context_break_watch` | 2 | 2 | 3 |
| `thin_liquidity_break_watch` | 1 | 2 | 2 |
| `consumed_or_overtested_level` | 1 | 0 | 2 |
| `active_reference_resolved` | 1 | 1 | 2 |
| `local_level_cluster_break_watch` | 0 | 2 | 1 |
| `needs_manual_review` | 0 | 0 | 1 |
| `possible_overstated_strength` | 0 | 0 | 0 |

Event-regime examples:

- `SKLZ` 2026-04-23 10:30, `3.42` support moved from
  `possible_overstated_strength` into `event_regime_change_watch`.
- `SKYQ` 2026-04-02 produced repeated event-regime watch rows around `2.64`
  resistance.
- `HCAI` 2026-04-30 produced event-regime watch rows around `5.5381`
  resistance.

Remaining manual row:

- `SKLZ` 2026-05-01 04:00, `8.08` resistance remains the only
  `needs_manual_review` row across the 5h/2h/8h final pass. This is still a
  choppy/two-way premarket operator-context case, not the same extreme
  2026-04-23 halt-runner regime.

Verification:

- `npx tsx --test src\tests\level-quality-clean-break-classifier.test.ts src\tests\forward-reaction-diagnostics.test.ts`
  passed: `22/22`.
- `npx tsc --noEmit --pretty false` passed.
- `npm run build` passed.

Decision:

- Keep event-regime cases out of ordinary support/resistance strength
  calibration.
- Do not lower broad support/resistance strength thresholds from this pass.
- Use `event_regime_change_watch` as an operator/report diagnostic only until a
  larger calibration set proves it should affect user-facing language.
