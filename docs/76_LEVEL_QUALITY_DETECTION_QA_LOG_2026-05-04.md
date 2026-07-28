# Level Quality Detection QA Log

Date started: 2026-05-04 America/Toronto

Purpose: running notes for support/resistance level-quality testing. This log tracks coverage quality, actual level quality, code changes, test evidence, and before/after results.

Related workplan:

- `docs/75_LEVEL_QUALITY_DETECTION_WORKPLAN_2026-05-04.md`

## 2026-05-04 - Initial Volume-Aware Validation Layer

Status: completed

Reason:

- Actual level quality should consider not only whether price touched/respected/broke a level, but also whether the touch happened on heavy, elevated, normal, or light volume.
- Volume should stay offline/operator-only for now and should not change Discord posts yet.

Code changed:

- `src/lib/validation/forward-reaction-validator.ts`
- `src/lib/validation/level-validation-batch.ts`
- `src/lib/review/support-resistance-calibration-report.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/tests/forward-reaction-validator.test.ts`
- `src/tests/level-validation-batch.test.ts`

What changed:

- Each touched forward level now gets volume context:
  - `heavy`
  - `elevated`
  - `normal`
  - `light`
  - `unknown`
- Volume context records:
  - reliability
  - touch volume
  - baseline average volume
  - relative volume ratio
  - baseline candle count
- Reports now summarize:
  - touched levels with reliable volume
  - high-volume touches
  - high-volume useful/respect/break rates
  - light-volume useful/respect/break rates

Tests run:

```powershell
npx tsx --test src/tests/support-resistance-calibration-report.test.ts src/tests/forward-reaction-validator.test.ts src/tests/level-validation-batch.test.ts
npx tsc --noEmit --pretty false
git diff --check -- src/lib/validation/forward-reaction-validator.ts src/lib/validation/level-validation-batch.ts src/lib/review/support-resistance-calibration-report.ts src/scripts/run-forward-reaction-validation.ts src/scripts/run-level-validation-batch.ts src/tests/forward-reaction-validator.test.ts src/tests/level-validation-batch.test.ts
```

Result:

- Focused tests passed.
- TypeScript passed.
- Diff whitespace check passed.

Smoke artifacts:

- `artifacts/support-resistance-calibration-volume-smoke/`
- `artifacts/support-resistance-calibration-volume-latest-smoke/`

Evidence note:

- The latest smoke showed volume fields in the generated markdown/JSON.
- The smoke had limited forward evidence, so it proves wiring, not level quality.

Next action:

- Build a broader warehouse-backed level-quality batch and scoreboard.

## 2026-05-04 - First Broad Level-Quality Detection Batch

Status: completed

Reason:

- Needed a repeatable offline batch to measure coverage quality and actual level quality across small-cap mover examples.

Command run:

```powershell
npx tsx src/scripts/run-level-quality-detection-report.ts --max-cases 60 --out artifacts\level-quality-detection
```

Artifacts:

- `artifacts/level-quality-detection/test-batch.json`
- `artifacts/level-quality-detection/test-batch.md`
- `artifacts/level-quality-detection/level-quality-scoreboard.json`
- `artifacts/level-quality-detection/level-quality-scoreboard.md`

Result:

- Cases reviewed: 60
- Scored cases: 60
- Unscored cases: 0
- Wide future move cases: 50
- High-volume touches: 438
- No forward resistance cases: 0

Ranked tuning targets:

1. Weak levels produced strong respect reactions
   - Evidence count: 27 symbols
   - Likely area: `src/lib/levels/level-ranker.ts`
   - Note: needs careful review before changing code because a one-off wick can make a weak level look better than it is.

2. Strong/major labels broke in the forward window
   - Evidence count: 20 symbols
   - Likely area: `src/lib/levels/raw-level-candidate-builder.ts` and `src/lib/levels/level-ranker.ts`
   - Note: a clean breakout through a strong level is not automatically a bad level.

3. High-volume touches broke levels instead of respecting them
   - Evidence count: 2 symbols
   - Likely area: `src/lib/levels/level-ranker.ts`
   - Note: this is smaller evidence but important because volume helps distinguish consumed levels.

Interpretation:

- Coverage quality looked materially better in this batch: the scoreboard found no no-forward-resistance cases.
- Actual level quality now has measurable issues to inspect, especially strength-label calibration.
- The next patch should be careful and probably improve calibration evidence/reporting before changing live level scoring.

Next action:

- Inspect the first target examples and decide whether the first code patch should tune `level-ranker.ts` or sharpen the scoreboard criteria for "underrated weak" evidence.

## 2026-05-04 - Patch 1: Decisive Single-Timeframe Moderate Floor

Status: completed

Reason:

- The first scoreboard target showed many daily/4h levels labeled weak that later produced strong respect reactions.
- Inspection showed many were not random weak levels; they were single-source daily/4h levels just below the moderate threshold with decisive historical follow-through/rejection evidence.

Code changed:

- `src/lib/levels/level-scorer.ts`
- `src/tests/level-scorer.test.ts`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/lib/review/support-resistance-calibration-report.ts`

What changed:

- Added a conservative moderate floor for daily/4h single-timeframe levels only when historical evidence is decisive.
- 5m-only levels do not get this floor.
- Low-quality single-timeframe levels stay weak.
- Forward reaction examples now include original zone score/evidence fields, so future tuning can inspect why a level was labeled weak/moderate/strong.

Tests run:

```powershell
npx tsx --test src/tests/level-scorer.test.ts src/tests/level-engine.test.ts src/tests/forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
```

Before/after command:

```powershell
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-after-decisive-floor
```

Before/after artifacts:

- `artifacts/level-quality-detection/before-after-decisive-single-timeframe-floor.json`
- `artifacts/level-quality-detection/before-after-decisive-single-timeframe-floor.md`

Result:

- Weak respected examples: 44 -> 20
- Weak-level-respected symbols: 27 -> 15
- No-forward-resistance cases: 0 -> 0
- Strong/major break examples: 28 -> 28
- High-volume break symbols: 2 -> 2

Interpretation:

- Patch improved the first target without hurting coverage.
- The next larger target is strong/major labels breaking in the forward window.
- High-volume breaks are still important but have smaller evidence count in this batch.

## 2026-05-05 - Patch 2: Over-Tested Decision Cap And Clean-Break Scoreboard

Status: completed

Reason:

- The next target was strong/major labels that broke in the forward window.
- Inspection showed the bucket mixed together two different cases:
  - clean breaks through strong/major levels
  - levels that partially respected first and then later broke
- Inspection also showed some `major` labels were inflated by many repeated touches even when the historical rejection/follow-through evidence was soft. Those levels may still be useful, but they should not always be labeled as the highest-confidence decision areas.

Code changed:

- `src/lib/levels/level-scorer.ts`
- `src/tests/level-scorer.test.ts`
- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added an over-tested decision cap in the scorer:
  - heavily reused levels with soft rejection/follow-through can no longer run away to `major` only because they have many touches
  - very exhausted two-source levels with weak rejection and weak follow-through can be capped below `strong`
  - repeated high-quality confluence levels can still remain `major`
- Updated the offline scoreboard to separate:
  - strong/major clean breaks
  - strong/major partial-respect-then-break examples
  - major clean breaks

Tests run:

```powershell
npx tsx --test src/tests/level-scorer.test.ts src/tests/level-engine.test.ts src/tests/forward-reaction-validator.test.ts
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-after-overtested-cap
```

Before/after baseline:

- Before: `artifacts/level-quality-detection-after-decisive-floor/level-quality-scoreboard.json`
- After: `artifacts/level-quality-detection-after-overtested-cap/level-quality-scoreboard.json`

Result:

- No-forward-resistance cases: 0 -> 0
- Strong/major break examples: 28 -> 25
- Strong/major clean break examples: 14 -> 12
- Major clean break examples: 6 -> 3
- Strong/major partial-then-break examples: 16 -> 15
- Weak respected examples: 20 -> 22
- High-volume touches: 440 -> 440
- High-volume break cases: 19 -> 19

Operator-only clean-break classification:

- Classified clean break examples: 12
- Momentum consumed a real level: 11
- Consumed or over-tested level: 1
- Possible overstated strength: 0
- Minor break/watch: 0 after recalculating full 12-candle adverse movement from candles
- Needs manual review: 0 after recalculating full 12-candle adverse movement from candles

Interpretation:

- The patch reduced the worst `major` clean-break cases without hurting ladder coverage.
- The total strong/major issue is now smaller, but still real.
- Weak respected examples rose by two, both from examples surfaced into the report after label/order changes; this should be watched before making another 5m-only promotion rule.
- The clean-break inspection did not mostly reveal bad levels. It mostly showed real levels that were consumed by large small-cap momentum moves.
- The next best target is not another broad strength downgrade. It is to add consumed/momentum diagnostics so future reports and later trader-facing logic can distinguish "bad level" from "real level that got blown through."

Next action:

- Keep the clean-break classification operator-only.
- Consider a future `consumed/overtested` diagnostic field for level review logic.
- Do not broadly lower strong/major labels from this evidence alone.

## 2026-05-05 - Patch 3: Operator Momentum/Consumed Diagnostics

Status: completed

Reason:

- Patch 2 showed that most clean strong/major breaks were not simple bad levels.
- They were usually real daily/4h or confluence levels that small-cap momentum drove through.
- We still need to find actual level-quality mistakes, but we should not downgrade good levels just because a stock ran through them in a high-momentum tape.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`
- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added an operator-only diagnostic classifier for forward level behavior:
  - `fresh`
  - `respected`
  - `testing`
  - `broken`
  - `consumed_by_momentum`
  - `over_tested`
- The quality report now prints state counts and priority examples.
- The classifier uses the full forward resolution window when supplied, so a level that breaks and then keeps running is labeled as momentum consumption instead of a generic break.
- No Discord/live trader-facing copy was changed.
- No support/resistance score label was changed in this patch.

Tests run:

```powershell
npx tsx --test src/tests/forward-reaction-diagnostics.test.ts src/tests/forward-reaction-validator.test.ts src/tests/level-scorer.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-after-momentum-diagnostics
```

Result:

- Cases reviewed: 60
- Scored cases: 60
- Unscored cases: 0
- No-forward-resistance cases: 0
- Consumed-by-momentum level diagnostics: 53
- Over-tested level diagnostics: 6
- Broken level diagnostics not explained yet: 2

Diagnostic state counts:

- Fresh / still ahead: 893
- Respected: 645
- Testing / unresolved: 6
- Broken: 2
- Consumed by momentum: 53
- Over-tested: 6

Interpretation:

- The remaining broad "levels broke" bucket is now much cleaner.
- Most break examples are momentum-consumed levels, not obvious bad support/resistance detection.
- Only two broken diagnostics were not explained by momentum or over-testing in this batch.
- The next true quality target is now narrower: inspect the unexplained breaks and the remaining weak-respected examples.

Next action:

- Review the two unexplained broken diagnostics first.
- Then inspect the weak-respected bucket for possible underrated shelf/pivot evidence.
- Keep consumed/overtested diagnostics out of Discord until the report proves the labels are stable across more batches.

## 2026-05-05 - Patch 4: Constructive Higher-Timeframe Swing Floor

Status: completed

Reason:

- The remaining weak-respected bucket had a clear pattern:
  - many examples were daily/4h single-timeframe swing levels
  - they were just under the moderate threshold
  - they had constructive historical follow-through plus usable rejection, displacement, or reaction-quality evidence
- These did not look like random 5m noise. They looked like higher-timeframe swing levels that should usually be at least `moderate`, even without multi-timeframe confluence.

Code changed:

- `src/lib/levels/level-scorer.ts`
- `src/tests/level-scorer.test.ts`
- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added a cautious `constructiveSingleTimeframeFloor` after the existing decisive floor:
  - daily/4h only
  - single-timeframe only
  - swing high/low only
  - adjusted score must already be near the moderate threshold
  - requires follow-through plus at least one of rejection, displacement, or reaction-quality evidence
  - does not apply to 5m-only levels
- Refined the report metric so partial-respect-then-break cases do not count as unexplained clean breaks.

Tests run:

```powershell
npx tsx --test src/tests/level-scorer.test.ts src/tests/forward-reaction-diagnostics.test.ts src/tests/forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-after-constructive-floor
```

Before/after baseline:

- Before: `artifacts/level-quality-detection-after-momentum-diagnostics/level-quality-scoreboard.json`
- After: `artifacts/level-quality-detection-after-constructive-floor/level-quality-scoreboard.json`

Result:

- No-forward-resistance cases: 0 -> 0
- Strong/major break examples: 25 -> 25
- Strong/major clean break examples: 12 -> 12
- Major clean break examples: 3 -> 3
- Strong/major partial-then-break examples: 15 -> 15
- Weak respected examples: 22 -> 10
- Consumed-by-momentum diagnostics: 53 -> 53
- Over-tested diagnostics: 6 -> 6
- Clean broken diagnostics not explained yet: 2 -> 1
- Clean strong/major broken diagnostics not explained yet: 0

Remaining weak-respected examples:

- Mostly 5m premarket/swing levels.
- Two higher-timeframe holdouts remain:
  - `PN` 4h resistance 5.90 stayed weak because it was below the new near-moderate floor.
  - `TELA` daily resistance 1.02 stayed weak because rejection/displacement evidence was too soft.

Interpretation:

- This patch improved actual label quality without hurting coverage or making strong/major break metrics worse.
- The remaining weak-respected bucket is now mostly intraday/premarket behavior, which should be handled separately and more carefully.
- The only unexplained clean broken diagnostic left is `LRHC` 5m-only moderate resistance 1.94; this is not a daily/4h strength-label problem.

Next action:

- Do not add a broad 5m promotion rule yet.
- Inspect the remaining 5m weak-respected examples separately for premarket-high and active intraday shelf behavior.
- Consider a separate `active_intraday_reference` diagnostic instead of upgrading those levels into trader-facing strong support/resistance.

## 2026-05-05 - Patch 5: Active Intraday Reference Diagnostic Tag

Status: completed

Reason:

- The remaining weak-respected examples were mostly 5m/premarket levels.
- These levels can be useful to traders as tactical intraday references, but they should not be promoted into strong support/resistance just because they reacted once.
- We need to measure this behavior without changing trader-facing strength labels.

Inspection result:

- Remaining weak-respected examples after Patch 4: 10
- Clear 5m/premarket-style active references:
  - `EFOI` 5m premarket high 5.55
  - `ELPW` 5m swing high 4.66
  - `ELPW` 5m premarket high 4.96
  - `UCAR` 5m premarket/swing low 1.22
  - `SGMO` 5m swing/premarket high 0.1714
  - `SAFX` 5m premarket high 0.5345
  - `RLYB` 5m premarket high 12.71
  - `FATN` 5m swing high 2.85
- Higher-timeframe holdouts were not tagged:
  - `PN` 4h resistance 5.90 was too soft/low-score for the constructive floor.
  - `TELA` daily resistance 1.02 had too-soft rejection/displacement evidence.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`
- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added operator-only diagnostic tag:
  - `active_intraday_reference`
- The tag applies to weak 5m-only swing/premarket/opening-range levels that produced a meaningful tactical reaction.
- The tag does not change:
  - `strengthLabel`
  - support/resistance scoring
  - Discord/live trader-facing posts
- The report now includes:
  - diagnostic tag counts
  - an operator-only tagged-level table
  - case findings for active intraday references

Tests run:

```powershell
npx tsx --test src/tests/forward-reaction-diagnostics.test.ts src/tests/forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-after-active-intraday-reference
```

Result:

- Cases reviewed: 60
- Scored cases: 60
- Active intraday reference tags: 20
- Weak respected examples stayed: 10
- No-forward-resistance cases stayed: 0
- Clean strong/major broken diagnostics not explained: 0

Interpretation:

- This confirms the remaining 5m weak-respected bucket should be tracked as tactical intraday reference behavior, not promoted into higher-confidence support/resistance.
- The next decision is whether this tag should stay operator-only or eventually help Discord wording in a restrained way, such as "premarket reference reacted" rather than "strong resistance."

## 2026-05-05 - Patch 6: Larger-Batch Reporting Upgrade And Comparison

Status: completed

Reason:

- Before running a larger batch, the report needed cleaner explanations:
  - how many weak-respected examples are explained by `active_intraday_reference`
  - how many weak-respected examples remain untagged
  - whether active intraday references held, broke, or were consumed
  - a reusable comparison artifact instead of manual markdown scanning

Code changed:

- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added weak-respected explanation metrics:
  - total weak-respected examples
  - explained by active intraday reference
  - still untagged
  - untagged weak-respected table
- Added active-reference risk buckets:
  - `reacted_and_held`
  - `reacted_then_broke`
  - `reacted_then_consumed`
- Added optional comparison output:
  - `--compare-to <level-quality-scoreboard.json>`
  - writes `level-quality-comparison.json`
  - writes `level-quality-comparison.md`
- Added `--allow-repeat-symbols` so larger warehouse scans can include multiple qualifying sessions from the same symbol.

Commands run:

```powershell
npm run levels:quality-detect -- --max-cases 60 --out artifacts\level-quality-detection-60-reporting-upgrade
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-repeat-active-intraday-reference --compare-to artifacts\level-quality-detection-60-reporting-upgrade\level-quality-scoreboard.json
```

Important note:

- The request was for a 150-case batch.
- The warehouse currently produced 89 qualifying cases under the report's data-quality filters, even with repeat-symbol sessions allowed.
- This means more candle sessions need to be warehoused before this specific report can reach 150 qualifying cases.

Artifacts:

- `artifacts/level-quality-detection-60-reporting-upgrade/level-quality-scoreboard.md`
- `artifacts/level-quality-detection-150-repeat-active-intraday-reference/level-quality-scoreboard.md`
- `artifacts/level-quality-detection-150-repeat-active-intraday-reference/level-quality-comparison.md`

60-case refreshed baseline:

- Cases reviewed: 60
- No-forward-resistance cases: 0
- Weak-respected examples: 10
- Weak-respected explained by active intraday reference: 8
- Weak-respected still untagged: 2
- Active intraday reference tags: 20
- Active reference risk:
  - reacted and held: 2
  - reacted then broke: 1
  - reacted then consumed: 17
- Clean strong/major unexplained breaks: 0

Larger warehouse batch:

- Cases reviewed: 89
- No-forward-resistance cases: 0
- Weak-respected examples: 15
- Weak-respected explained by active intraday reference: 12
- Weak-respected still untagged: 3
- Active intraday reference tags: 18
- Active reference risk:
  - reacted and held: 4
  - reacted then broke: 5
  - reacted then consumed: 9
- Clean strong/major unexplained breaks: 5

Remaining untagged weak-respected examples in the larger batch:

- `TELA` daily resistance 1.02, 2 examples
- `REED` 4h resistance 3.74, 1 example

Clean strong/major unexplained breaks in the larger batch:

- `CERS` resistance 2.65 major
- `GNLX` resistance 2.76 major
- `YAAS` resistance 1.28 strong
- `RNXT` resistance 0.8477 strong
- `AKAN` support 3.4398 major

Interpretation:

- Coverage quality stayed good: no-forward-resistance remained 0.
- Active intraday reference is useful as an explanation layer: 12 of 15 weak-respected examples in the larger batch were explained by it.
- The active-reference risk buckets show why this should stay operator-only for now: many references react first and are later broken or consumed.
- The next true scoring-quality target is not weak 5m references. It is the five clean strong/major unexplained breaks from the larger batch.

## 2026-05-05 - Patch 7: Small Clean Break Watch Diagnostics

Status: completed

Reason:

- The 89-case report showed five clean strong/major breaks that were not explained by momentum or over-testing.
- Four of the five were small through-moves under 4% with no useful reaction and no elevated/heavy volume.
- For small-cap testing, these should stay visible as watch items, but they should not automatically count as strength-label misses.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`

What changed:

- Added operator-only diagnostic tag `small_clean_break_watch`.
- The tag applies only when:
  - the level cleanly broke
  - the level did not break after partial respect
  - favorable reaction stayed under 1%
  - adverse travel through the level was at least 1% but under 4%
  - touch volume was not elevated/heavy
- The report now excludes this tag from "unexplained clean break" counts.
- The report still shows these levels in diagnostic-tag tables so they remain reviewable.

Commands run:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\forward-reaction-validator.test.ts src\tests\level-scorer.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-small-break-watch --compare-to artifacts\level-quality-detection-60-reporting-upgrade\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 24/24.
- TypeScript passed.
- Report completed: 89 cases reviewed, 89 scored, 0 unscored.

Result:

- No-forward-resistance cases stayed: 0
- Clean broken level diagnostics not explained yet: 11 -> 6
- Clean strong/major broken diagnostics not explained yet: 5 -> 1
- Small clean break watch tags: 5

Small clean break watch examples:

- `WKHS` resistance 3.36 moderate, broke 2.1%, normal reliable volume
- `CERS` resistance 2.65 major, broke 2.6%, light reliable volume
- `GNLX` resistance 2.76 major, broke 2.4%, unknown/watch volume
- `YAAS` resistance 1.28 strong, broke 1.6%, light reliable volume
- `RNXT` resistance 0.8477 strong, broke 3.5%, unknown/watch volume

Remaining true unexplained strong/major clean break:

- `AKAN` support 3.4398 major, broke 4.1%, unknown/watch volume, sources 5m/daily/4h, source types swing low/opening range low/premarket low.

Interpretation:

- This keeps the QA process honest: small through-moves are tracked, but they no longer muddy the core strength-label-miss bucket.
- The next actual tuning target is `AKAN` and similar confluence support failures where a daily/4h/5m confluence level breaks cleanly by more than the small-break threshold without usable volume context.

## 2026-05-05 - Patch 8: Historical Replay Freshness Uses Candle Timeline

Status: completed

Reason:

- While drilling into the remaining `AKAN` unexplained break, the replay showed the `AKAN` 3.4398 support level as `freshness=stale`.
- That was wrong for a historical replay: the level's last timestamp was available as of the replay morning.
- The cause was wall-clock `Date.now()` freshness/recency logic inside the level engine path.

Code changed:

- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-engine.ts`
- `src/tests/level-engine.test.ts`

What changed:

- `LevelEngine` now derives a reference timestamp from each provider response's `requestedEndTimestamp`.
- Metadata freshness now compares freshest candle timestamp to that reference timestamp.
- Clustered zone freshness now accepts the same replay reference timestamp.
- Scoring recency now accepts the same replay reference timestamp.
- Added a regression test proving clustered zone freshness is based on the replay reference timestamp.

Commands run:

```powershell
npx tsx --test src\tests\level-engine.test.ts src\tests\level-scorer.test.ts src\tests\forward-reaction-diagnostics.test.ts src\tests\forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-historical-recency --compare-to artifacts\level-quality-detection-150-small-break-watch\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 52/52.
- TypeScript passed.
- Report completed: 89 cases reviewed, 89 scored, 0 unscored.

Result:

- No-forward-resistance cases stayed: 0
- Clean broken level diagnostics not explained yet stayed: 6
- Clean strong/major broken diagnostics not explained yet stayed: 1
- Small clean break watch tags stayed: 5
- Weak respected examples dropped: 15 -> 9
- Active intraday reference tags dropped: 18 -> 10

Interpretation:

- Historical scoring is now deterministic against the replay candle timeline instead of the current wall clock.
- The change made some old weak levels score higher, which reduced false weak-respected findings.
- It did not hide the remaining true unresolved issue: `AKAN` support 3.4398 remains the only unexplained strong/major clean break.

## 2026-05-05 - Patch 9: Thin Liquidity Break Watch And Evidence-Rich QA Tables

Status: completed

Reason:

- `AKAN` support 3.4398 looked like the only remaining strong/major clean break in the 5-hour report.
- Drilling into the raw 5m candles showed a sparse tape:
  - many flat candles
  - many zero-volume bars
  - unknown/watch volume reliability
  - 4.1% adverse move, just under the momentum-consumed threshold
- That should stay visible to the operator, but should not automatically tune support/resistance scoring.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`

What changed:

- Added operator-only diagnostic tag `thin_liquidity_break_watch`.
- Added evidence columns to the level diagnostics report:
  - score
  - touch/source evidence/confluence counts
  - rejection/follow-through
  - zero-volume bars in the resolution window
  - total resolution-window volume
- Excluded `thin_liquidity_break_watch` from unexplained clean-break counts.
- Added thin-liquidity clean-break classification in the operator-only clean-break section.

Commands run:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\forward-reaction-validator.test.ts src\tests\level-engine.test.ts src\tests\level-scorer.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-thin-liquidity --compare-to artifacts\level-quality-detection-150-historical-recency\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 2 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-thin-liquidity-2h --compare-to artifacts\level-quality-detection-150-thin-liquidity\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 8 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-thin-liquidity-8h --compare-to artifacts\level-quality-detection-150-thin-liquidity\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 54/54.
- TypeScript passed.

5-hour result:

- Cases reviewed: 89
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 1 -> 0
- Thin liquidity break watch tags: 1
- `AKAN` support 3.4398 became `thin_liquidity_break_watch`

2-hour result:

- Cases reviewed: 73
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Thin liquidity break watch tags: 1

8-hour result:

- Cases reviewed: 93
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 1
- New remaining target: `AEHR` support 95.11 major

Interpretation:

- Coverage quality stayed strong across 2h, 5h, and 8h windows: no-forward-resistance remained 0.
- `AKAN` was not a good scoring-tuning candidate; it was a sparse-tape/unknown-volume break.
- The next real scoring target was `AEHR` in the longer 8h replay.

## 2026-05-05 - Patch 10: Cap Soft 5m/4h Session Anchors Below Strong

Status: completed

Reason:

- The 8-hour report found `AEHR` support 95.11 as the only unexplained strong/major clean break.
- The level was a 5m/4h session-anchor support:
  - sources: premarket low + swing low
  - no daily source
  - touch count was high
  - follow-through was soft
  - rejection was not strong
- That pattern can be useful, but it should not be promoted into strong/major just because lower-timeframe touches pile up.

Code changed:

- `src/lib/levels/level-scorer.ts`
- `src/tests/level-scorer.test.ts`

What changed:

- Added `lowerTimeframeSoftConfluenceCapScore`.
- It caps a level below strong only when all of these are true:
  - no daily source
  - has both 5m and 4h sources
  - includes a premarket/opening-range anchor
  - follow-through is below 0.5
  - rejection is below 0.45
  - confluence is no more than 2
  - source evidence is no more than 3
  - touch count is at least 12
- Added a focused scorer test for this AEHR-style pattern.

Commands run:

```powershell
npx tsx --test src\tests\level-scorer.test.ts src\tests\level-engine.test.ts src\tests\forward-reaction-diagnostics.test.ts src\tests\forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-soft-lower-timeframe-cap --compare-to artifacts\level-quality-detection-150-thin-liquidity\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 8 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-soft-lower-timeframe-cap-8h --compare-to artifacts\level-quality-detection-150-thin-liquidity-8h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 2 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-soft-lower-timeframe-cap-2h --compare-to artifacts\level-quality-detection-150-thin-liquidity-2h\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 55/55.
- TypeScript passed.

5-hour result:

- Cases reviewed: 89
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- No metric regressions versus the thin-liquidity 5h baseline.

2-hour result:

- Cases reviewed: 73
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- No metric regressions versus the thin-liquidity 2h baseline.

8-hour result:

- Cases reviewed: 93
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 1 -> 0
- Strong/major clean break examples: 26 -> 25
- Major clean break examples: 16 -> 15
- The `AEHR` unexplained strong/major break was removed by lowering that level out of strong/major.

Interpretation:

- The level engine now handles the two latest hard cases differently:
  - `AKAN`: real-looking level, but sparse-tape break, operator watch only.
  - `AEHR`: level strength was overstated by lower-timeframe/session-anchor touch inflation, so scoring was tuned.
- Across the current saved-candle batches, the report now shows zero unexplained strong/major clean breaks for the main 5h window and the 8h stress window.

## 2026-05-05 - Patch 11: Lift Repeated Higher-Timeframe Swing Levels To Moderate

Status: completed

Reason:

- The next remaining label-quality issue was not a missing ladder/coverage problem.
- `TELA` daily resistance 1.02 repeatedly acted like a practical resistance area but scored just below the `moderate` threshold as `weak`.
- This was a narrow calibration miss: repeated higher-timeframe swing levels with constructive follow-through should not stay weak just because they have only one timeframe source.

Code changed:

- `src/lib/levels/level-scorer.ts`
- `src/tests/level-scorer.test.ts`

What changed:

- Added `repeatedHigherTimeframeSwingFloorScore`.
- It only lifts a level to `moderate` when all of these are true:
  - single-timeframe higher-timeframe source (`daily` or `4h`)
  - swing high/low source
  - score is already near moderate
  - at least 2 touches
  - at least 1 source-evidence item
  - follow-through is at least 0.55
  - reaction quality is at least 0.18
- It does not lift 5m-only levels.
- It does not lift one-touch higher-timeframe swing levels.

Commands run:

```powershell
npx tsx --test src\tests\level-scorer.test.ts src\tests\level-engine.test.ts src\tests\forward-reaction-diagnostics.test.ts src\tests\forward-reaction-validator.test.ts
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-repeated-htf-swing-floor --compare-to artifacts\level-quality-detection-150-soft-lower-timeframe-cap\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 2 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-repeated-htf-swing-floor-2h --compare-to artifacts\level-quality-detection-150-soft-lower-timeframe-cap-2h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 150 --hours 8 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-repeated-htf-swing-floor-8h --compare-to artifacts\level-quality-detection-150-soft-lower-timeframe-cap-8h\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 57/57.
- All three reports used saved candle warehouse data only; no live IBKR/API data was used.

5-hour result:

- Cases reviewed: 89
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Weak respected examples: 9 -> 7
- Weak-respected still untagged: 3 -> 1
- Remaining untagged weak-respected example: `REED` 4h resistance 3.74.

2-hour result:

- Cases reviewed: 73
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Weak respected examples: 14 -> 13
- Weak-respected still untagged: 4 -> 3

8-hour result:

- Cases reviewed: 93
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Weak respected examples: 15 -> 13
- Weak-respected still untagged: 4 -> 2

Interpretation:

- The patch fixed the repeated `TELA` daily-level label miss without changing coverage quality.
- The remaining weak-respected cases are mostly one-touch higher-timeframe levels or sparse/unknown-volume cases, so they are not good candidates for a broad strength lift yet.

## 2026-05-05 - Patch 12: Explain Single-Touch Higher-Timeframe Weak References

Status: completed

Reason:

- The next drill-down target was the remaining weak-respected untagged examples:
  - `REED` 4h resistance 3.74
  - `ADVB` daily support 7.80
  - `UK` 4h resistance around 3.73
- These levels reacted in the forward window, but the evidence was too thin to promote them:
  - single higher-timeframe source
  - single swing high/low touch
  - weak strength label
  - meaningful reaction from the level
  - often unknown or sparse volume context
- The right action was an operator diagnostic tag, not a score lift.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`

What changed:

- Added diagnostic tag `single_touch_higher_timeframe_reference`.
- It applies only when all of these are true:
  - single `daily` or `4h` timeframe source
  - swing high/low source
  - touch count is no more than 1
  - source evidence count is no more than 1
  - weak strength label
  - respected or partial-respected without later break
  - favorable reaction is at least 2.5%
  - follow-through score is at least 0.55
- The level score is unchanged.
- The tag explains weak-respected examples so the report stops treating these as unclassified misses.

Commands run:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts
npm run levels:quality-detect -- --max-cases 150 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-150-single-touch-htf-reference --compare-to artifacts\level-quality-detection-150-repeated-htf-swing-floor\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-single-touch-htf-reference --compare-to artifacts\level-quality-detection-150-single-touch-htf-reference\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 2 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-single-touch-htf-reference-2h --compare-to artifacts\level-quality-detection-150-repeated-htf-swing-floor-2h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 8 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-single-touch-htf-reference-8h --compare-to artifacts\level-quality-detection-150-repeated-htf-swing-floor-8h\level-quality-scoreboard.json
```

Verification:

- Focused tests passed: 21/21.
- All report runs used saved warehouse candles only; no live IBKR/API data was used.
- The `--max-cases 300` runs still found only the currently eligible saved-candle cases:
  - 5h: 89 cases
  - 2h: 73 cases
  - 8h: 93 cases

150-case isolate result:

- Cases reviewed: 89
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Single-touch higher-timeframe reference tags: 0 -> 4
- Weak-respected explained by single-touch higher-timeframe reference: 0 -> 1
- Weak-respected still untagged: 1 -> 0

2-hour stress result:

- Cases reviewed: 73
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Single-touch higher-timeframe reference tags: 0 -> 6
- Weak-respected explained by single-touch higher-timeframe reference: 0 -> 3
- Weak-respected still untagged: 3 -> 0

8-hour stress result:

- Cases reviewed: 93
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 0
- Single-touch higher-timeframe reference tags: 0 -> 5
- Weak-respected explained by single-touch higher-timeframe reference: 0 -> 2
- Weak-respected still untagged: 2 -> 0

Interpretation:

- The remaining weak-respected bucket is now fully explained across the current saved-candle windows.
- This did not change scoring, level coverage, strong/major clean-break counts, or diagnostic states.
- The next limiter is data breadth: the report cannot actually reach 300 cases until the warehouse/test-case selection has more eligible saved candle windows.

## 2026-05-05 - Patch 13: Expand Saved-Candle Test Case Selection

Status: completed

Reason:

- The quality detector was asked for 300 cases, but the saved-candle selector only found:
  - 5h: 89 cases
  - 2h: 73 cases
  - 8h: 93 cases
- The warehouse had many more symbol folders available, but the script selected only one best window per symbol/day and required a fairly high movement score.
- That meant the report was too narrow to keep tuning level quality across quieter but still useful small-cap windows.

Code changed:

- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added `--windows-per-day`.
- Added `--min-selection-score`.
- Replaced one-window-per-day selection with ranked, non-overlapping windows per day.
- Kept the old behavior by default:
  - `--windows-per-day` defaults to `1`
  - `--min-selection-score` defaults to the existing selection floor
- Added selection tags so expanded cases are easy to audit:
  - `expanded_low_motion`
  - `standard_motion`
  - `day_window_N`

Commands run:

```powershell
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-low-motion --compare-to artifacts\level-quality-detection-300-single-touch-htf-reference\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 2 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-low-motion-2h --compare-to artifacts\level-quality-detection-300-single-touch-htf-reference-2h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 8 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-low-motion-8h --compare-to artifacts\level-quality-detection-300-single-touch-htf-reference-8h\level-quality-scoreboard.json
```

Expanded 5-hour result:

- Cases reviewed: 300
- Scored: 300
- Expanded low-motion cases: 106
- Price buckets:
  - sub $1: 105
  - $1-$2: 63
  - $2-$5: 67
  - $5-$10: 44
  - $10+: 21
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 4
- Broken diagnostics not explained yet: 18
- Weak-respected still untagged: 4

Expanded 2-hour result:

- Cases reviewed: 300
- Scored: 300
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 6
- Broken diagnostics not explained yet: 15
- Weak-respected still untagged: 1

Expanded 8-hour result:

- Cases reviewed: 300
- Scored: 300
- No-forward-resistance cases: 0
- Clean strong/major broken diagnostics not explained yet: 5
- Broken diagnostics not explained yet: 19
- Weak-respected still untagged: 5

Interpretation:

- The selector expansion worked: the report can now stress 300 saved-candle windows without live API data.
- Coverage stayed healthy: no-forward-resistance remained 0 across 5h, 2h, and 8h windows.
- The broader sample surfaced a new diagnostic problem: several clean breaks happened on sparse or light-volume windows and were being treated as unexplained scoring failures.

## 2026-05-05 - Patch 14: Add Sparse-Tape Clean-Break Diagnostics

Status: completed

Reason:

- The expanded 300-case report surfaced broken strong/major examples where the break was real, but the tape quality was thin:
  - low or light volume context
  - many zero-volume candles in the validation window
  - modest adverse move after the break
- Those are not automatically "bad levels"; on thin small-cap tape, a clean pass-through can happen without enough liquidity evidence to treat the original level as proven wrong.
- The right response was to explain those as watch diagnostics, not hide them and not promote/demote the level score blindly.

Code changed:

- `src/lib/validation/forward-reaction-diagnostics.ts`
- `src/scripts/run-level-quality-detection-report.ts`
- `src/tests/forward-reaction-diagnostics.test.ts`

What changed:

- Added diagnostic tag `sparse_tape_clean_break_watch`.
- It applies only when:
  - the level broke cleanly
  - it did not first get a partial respect
  - the touch was not high volume
  - the validation window has enough candles to judge
  - at least 40% of the validation candles had zero volume
  - adverse move is meaningful but not a full collapse through the level
- Lowered the single-touch higher-timeframe reference reaction threshold from 2.5% to 2.0% so small but meaningful HTF reactions are explained consistently.
- Added report totals for sparse-tape clean breaks.

Commands run:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-diagnostics --compare-to artifacts\level-quality-detection-300-expanded-low-motion\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 2 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-diagnostics-2h --compare-to artifacts\level-quality-detection-300-expanded-low-motion-2h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 8 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-diagnostics-8h --compare-to artifacts\level-quality-detection-300-expanded-low-motion-8h\level-quality-scoreboard.json
```

5-hour expanded diagnostic result:

- Cases reviewed: 300
- No-forward-resistance cases: 0 -> 0
- Clean strong/major broken diagnostics not explained yet: 4 -> 1
- Broken diagnostics not explained yet: 18 -> 11
- Weak-respected still untagged: 4 -> 3
- Single-touch higher-timeframe reference tags: 8 -> 9
- Sparse-tape clean-break watch tags: 0 -> 20
- Remaining clean strong/major target:
  - `EFOI` 3.85 major 4h/5m, favorable 1.3%, adverse 3.9%, light/reliable volume, zero-volume ratio 25%.

2-hour expanded diagnostic result:

- Cases reviewed: 300
- No-forward-resistance cases: 0 -> 0
- Clean strong/major broken diagnostics not explained yet: 6 -> 3
- Broken diagnostics not explained yet: 15 -> 9
- Weak-respected still untagged: 1 -> 1
- Sparse-tape clean-break watch tags: 0 -> 15
- Remaining clean strong/major targets:
  - `SKLZ` 3.42 major 5m/daily, favorable 0.88%, adverse 4.97%
  - `HOWL` 0.73 major 5m/daily, favorable 0%, adverse 4.66%
  - `EFOI` 3.85 major 4h/5m, favorable 1.3%, adverse 3.9%

8-hour expanded diagnostic result:

- Cases reviewed: 300
- No-forward-resistance cases: 0 -> 0
- Clean strong/major broken diagnostics not explained yet: 5 -> 2
- Broken diagnostics not explained yet: 19 -> 12
- Weak-respected still untagged: 5 -> 5
- Sparse-tape clean-break watch tags: 0 -> 23
- Remaining clean strong/major targets:
  - `SKLZ` 8.08 major daily/5m, favorable 2.35%, adverse 4.46%
  - `SKYQ` 7.00 major daily/5m/4h, favorable 5.29%, adverse 2.14%

Interpretation:

- The sparse-tape diagnostic materially improved the signal quality report without changing level output.
- The system still keeps traders covered: no-forward-resistance remains 0 across the expanded 300-case reports.
- Remaining unexplained strong/major breaks are now a small, useful manual drill list instead of a noisy bucket.
- Next tuning should inspect `EFOI`, `SKLZ`, `HOWL`, and `SKYQ` raw candles before changing scoring rules again.

## 2026-05-05 - Patch 15: Align Clean-Break Classification With Sparse-Tape Diagnostics

Status: completed

Reason:

- The operator diagnostic totals correctly explained sparse low-volume clean breaks.
- The older clean-break classification table could still label some of those same sparse-tape examples as `needs_manual_review`.
- That made the report look more confusing than the actual tuning state.

Code changed:

- `src/scripts/run-level-quality-detection-report.ts`

What changed:

- Added clean-break classification `sparse_tape_clean_break_watch`.
- The classification table now mirrors the operator diagnostic behavior:
  - enough resolution candles to judge
  - at least 40% zero-volume candles
  - not high-volume
  - adverse move between 1% and 5%
- This does not change level scoring or trader-facing output.
- This only improves the QA report's explanation buckets.

Commands run:

```powershell
npm run levels:quality-detect -- --max-cases 300 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned --compare-to artifacts\level-quality-detection-300-expanded-diagnostics\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 2 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned-2h --compare-to artifacts\level-quality-detection-300-expanded-diagnostics-2h\level-quality-scoreboard.json
npm run levels:quality-detect -- --max-cases 300 --hours 8 --windows-per-day 3 --min-selection-score 6 --rescan-warehouse --allow-repeat-symbols --out artifacts\level-quality-detection-300-expanded-classifier-aligned-8h --compare-to artifacts\level-quality-detection-300-expanded-diagnostics-8h\level-quality-scoreboard.json
```

5-hour result:

- Cases reviewed: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Needs-manual-review clean-break classifications: 1
- Remaining manual clean-break target:
  - `EFOI` 3.85 major 4h/5m resistance.

2-hour result:

- Cases reviewed: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Possible-overstated-strength clean-break classifications: 2
- Needs-manual-review clean-break classifications: 1
- Remaining clean-break targets:
  - `SKLZ` 3.42 major 5m/daily support
  - `HOWL` 0.73 major 5m/daily resistance
  - `EFOI` 3.85 major 4h/5m resistance

8-hour result:

- Cases reviewed: 300
- No-forward-resistance cases: 0
- Sparse-tape clean-break classifications: 3
- Needs-manual-review clean-break classifications: 2
- Remaining manual clean-break targets:
  - `SKLZ` 8.08 major daily/5m resistance
  - `SKYQ` 7.00 major daily/5m/4h resistance

Interpretation:

- The report now has cleaner operator buckets.
- This patch does not reduce the actual unexplained diagnostic totals; it makes the classification table agree with the diagnostics.
- The next real tuning work should inspect the remaining symbols directly before touching score thresholds.

## 2026-05-05 - Pause Note

Status: paused by user

Current state:

- Level-quality detection work is paused after Patch 15.
- All work in this QA cycle used saved warehouse candles only.
- No live API data was used.
- No Discord wording/output changes were made as part of this quality cycle.

Latest verification:

```powershell
npx tsx --test src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts src\tests\level-engine.test.ts src\tests\forward-reaction-validator.test.ts
npx tsc --noEmit --pretty false
git diff --check -- src\scripts\run-level-quality-detection-report.ts src\lib\validation\forward-reaction-diagnostics.ts src\tests\forward-reaction-diagnostics.test.ts src\tests\level-scorer.test.ts src\tests\level-engine.test.ts docs\76_LEVEL_QUALITY_DETECTION_QA_LOG_2026-05-04.md
```

Verification result:

- Focused tests passed: 61/61.
- TypeScript passed.
- Diff whitespace check passed.

Resume from:

- `docs/78_LEVEL_QUALITY_DETECTION_HANDOFF_2026-05-05.md`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-2h`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-8h`
