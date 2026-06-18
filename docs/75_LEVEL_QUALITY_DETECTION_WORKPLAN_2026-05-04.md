# Level Quality And Detection Workplan

Date: 2026-05-04 America/Toronto

Owner: Codex working in `levels-system`

Primary goal: improve support/resistance level quality for small-cap / under-$100M tickers by using warehouse candle data, deterministic forward-reaction testing, and volume-aware evidence before changing trader-facing Discord wording.

Important boundary: this plan is for offline quality testing and level-engine tuning. Do not add volume wording to Discord posts yet. Do not make trader-facing coaching changes until the offline evidence proves the level quality is better.

## Current Direction

The system should first become excellent at two things:

1. Coverage quality
   - Traders should not run out of useful levels in the story or full ladder when a small-cap name moves quickly.
   - The system should identify when the displayed map is too short, too thin, or leaves no practical next resistance/support.

2. Actual level quality
   - The levels themselves should be defensible against raw candle data.
   - Strength labels should be checked against how price reacts later.
   - A level marked strong/moderate/weak should be tested against touches, rejections, breaks, retests, and volume at the touch.

## Step 1 - Build A Larger Level-Quality Test Batch

Status: completed for first broad pass

Purpose: create a repeatable group of tickers/sessions from the under-$100M list that has enough warehouse candle data to test real level behavior.

Inputs:

- `docs/nasdaq-under-100m-checklist-with-previous-tickers.md`
- `data/candles/ibkr`
- existing story replay queue artifacts, when useful:
  - `artifacts/support-resistance-story-test-queue/support-resistance-story-test-queue.json`
  - `artifacts/support-resistance-story-test-queue/support-resistance-story-test-cases.json`

Selection rules:

- Prefer tickers with daily, 4h, and 5m candles in the warehouse.
- Prefer tickers with meaningful intraday range so future candles actually touch levels.
- Include examples from different price buckets:
  - sub-$1
  - $1-$2
  - $2-$5
  - $5-$10
  - $10+
- Include known problem tickers from prior testing:
  - AKAN
  - ATER
  - ATXI
  - EFOI
  - HCAI
  - AIOS
  - XTLB
  - CCM
- Include newer warehouse-covered under-$100M symbols so we are not overfitting to the same few examples.

Output artifacts:

- `artifacts/level-quality-detection/test-batch.json`
- `artifacts/level-quality-detection/test-batch.md`

Acceptance criteria:

- At least 50 candidate symbol/session windows for the first broad pass.
- At least 10 high-range movers.
- Each selected case records:
  - symbol
  - test timestamp or session anchor
  - available candle counts by timeframe
  - price bucket
  - intraday range evidence
  - reason it was selected

First broad result:

- Generated 60 seeded warehouse-backed cases.
- Scored 60/60 cases.
- Output written to `artifacts/level-quality-detection/`.

## Step 2 - Run Offline Calibration Batches

Status: completed for first broad pass

Purpose: use the existing calibration and forward-reaction validators to test levels against future candles.

Commands:

```powershell
npm run levels:calibrate -- <audit-folder-or-jsonl> --warehouse data\candles --output artifacts\support-resistance-calibration-<batch-name>
```

When audit rows are not enough, use warehouse-based generated windows from Step 1 and create a dedicated quality report rather than depending only on Discord audit rows.

Metrics to capture:

- surfaced support/resistance touch rate
- extension support/resistance touch rate
- useful when touched rate
- respect rate
- partial respect rate
- break rate
- nearest/next ladder gaps
- no-forward-level cases
- wide internal ladder gap cases
- future high/low after first post or test timestamp
- volume at touched levels
- high-volume useful/respect/break rates

Output artifacts:

- calibration reports under `artifacts/support-resistance-calibration-*`
- quality batch output under `artifacts/level-quality-detection/`

Acceptance criteria:

- At least one broad batch runs without TypeScript/runtime errors.
- The report separates missing candle coverage from level quality problems.
- Volume-aware fields are present in JSON and markdown.

First broad result:

- `artifacts/level-quality-detection/level-quality-scoreboard.json`
- `artifacts/level-quality-detection/level-quality-scoreboard.md`
- Volume fields are present and populated.

## Step 3 - Create A Level-Quality Scoreboard

Status: completed for first broad pass

Purpose: turn raw calibration output into a readable scoreboard that shows where the level engine is good, where it is weak, and which tuning target should come next.

Scoreboard dimensions:

- side:
  - support
  - resistance
- source:
  - daily
  - 4h
  - 5m/intraday
  - extension
  - synthetic/continuation extension, if present
- strength label:
  - weak
  - moderate
  - strong
  - major
- distance band:
  - near
  - intermediate
  - far
- price bucket:
  - sub-$1
  - $1-$2
  - $2-$5
  - $5-$10
  - $10+
- volume label at touch:
  - heavy
  - elevated
  - normal
  - light
  - unknown/unavailable

Scoreboard should identify:

- strong/major levels that broke too easily
- weak/light levels that acted stronger than expected
- high-volume resistance rejections
- high-volume resistance breaks
- low-volume touches that should not be over-trusted
- extension levels that were useful
- extension levels that were noise
- ladders that ran out too early
- gaps where the raw candle history suggests an intermediate level may be missing

Output artifacts:

- `artifacts/level-quality-detection/level-quality-scoreboard.json`
- `artifacts/level-quality-detection/level-quality-scoreboard.md`

Acceptance criteria:

- The scoreboard lists top good examples and top bad examples.
- The scoreboard gives ranked tuning targets, not just raw stats.
- The scoreboard is useful enough to decide the next code change.

First broad result:

- Scoreboard generated.
- Ranked targets found:
  - weak levels produced strong respect reactions
  - strong/major labels broke in the forward window
  - high-volume touches broke levels instead of respecting them

## Step 4 - Identify Real Tuning Targets

Status: in progress

Purpose: choose code changes based on repeated evidence, not single-chart guesses.

Examples of valid tuning targets:

- Daily/4h levels are under-detected in a price zone where several later rejections occurred.
- Strong resistance labels are breaking too often on high volume.
- Weak resistance labels are repeatedly causing large rejection moves.
- Synthetic extension levels are too far away or too dense.
- Story map has only one practical next target even though full ladder has several useful nearby targets.
- Full ladder misses shelves visible in historical daily highs/lows.
- 5m/intraday levels are crowding the map but not proving useful.

Examples of invalid tuning targets:

- One ticker had one weird candle.
- One level broke during a news-driven move.
- A level was not touched, so it cannot prove quality either way.
- Candle coverage was missing or stale.

Output artifact:

- Add a section to `artifacts/level-quality-detection/level-quality-scoreboard.md` named `Ranked Tuning Targets`.

First broad result:

- Ranked tuning targets were added to the scoreboard.
- The first candidate target is weak/moderate/strong calibration, but it needs evidence review before blindly changing level scoring.

Acceptance criteria:

- Each tuning target has:
  - evidence count
  - affected symbols
  - likely code area
  - risk of overfitting
  - expected improvement

## Step 5 - Patch One Tuning Target At A Time

Status: completed for first target

Purpose: make small, testable changes to the level engine instead of broad refactors.

Patch rules:

- Patch only one tuning target per pass.
- Keep changes close to existing level-engine patterns.
- Avoid Discord wording changes.
- Avoid loosening notification gates unless the replay evidence proves real important events are suppressed.
- Add focused tests for each behavior change.
- Keep synthetic/extension logic clearly marked as lower-confidence planning context.

Likely code areas:

- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-quality-audit.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/alerts/alert-router.ts`
- `src/scripts/run-support-resistance-story-replay.ts`
- validation/report scripts under `src/lib/validation` and `src/lib/review`

Acceptance criteria:

- Focused tests pass.
- TypeScript passes.
- Replay/calibration before/after shows improvement on the target metric.
- No unrelated behavior churn.

First target result:

- Patched decisive daily/4h single-timeframe scoring in `src/lib/levels/level-scorer.ts`.
- Added focused tests in `src/tests/level-scorer.test.ts`.
- Weak respected examples improved from 44 to 20 on the same 60-case batch.
- Weak-level-respected symbols improved from 27 to 15.
- No-forward-resistance cases stayed at 0.

## Step 6 - Re-Run The Same Batch After Each Patch

Status: completed for first target

Purpose: prove changes improve the same examples that exposed the issue.

Before/after comparison should include:

- coverage map top/bottom percentage
- number of visible forward levels
- number of useful levels touched
- high-volume respect/break rates
- false strong/major rate
- underrated weak/light examples
- no-forward-level count
- wide-gap count

Output artifacts:

- `artifacts/level-quality-detection/before-after-<target>.json`
- `artifacts/level-quality-detection/before-after-<target>.md`

Acceptance criteria:

- Each patch has a before/after result.
- If a patch fails to improve the target, revert only that patch or revise it.
- Do not stack multiple speculative patches without measurement.

First target result:

- Before/after artifacts:
  - `artifacts/level-quality-detection/before-after-decisive-single-timeframe-floor.json`
  - `artifacts/level-quality-detection/before-after-decisive-single-timeframe-floor.md`

## Step 7 - Keep A Running QA Document

Status: active / current

Purpose: maintain a human-readable record so future tuning does not repeat the same uncertainty.

Running QA document:

- `docs/76_LEVEL_QUALITY_DETECTION_QA_LOG_2026-05-04.md`

Each entry should include:

- date/time
- batch name
- symbols tested
- issue found
- code changed
- tests run
- before/after result
- remaining concerns
- next recommended action

Acceptance criteria:

- Every material tuning pass gets a QA log entry.
- The log states when evidence is weak or unavailable.
- The log distinguishes coverage problems from actual level-quality problems.

## Step 8 - Stop Before Discord Wording Changes

Status: active / current

Purpose: prevent Discord from becoming noisy or unstable while the underlying level logic is still being measured.

Rules:

- Do not add volume lines to Discord posts yet.
- Do not add new trader-facing claims based on unproven scoring.
- Do not change live post frequency unless replay evidence shows important events are being missed.
- Keep volume and quality scoring operator-only until confidence is high.

When Discord changes become appropriate:

- The level-quality scoreboard shows repeated improvement.
- Strong/moderate/weak labels are better calibrated.
- Coverage maps stop running out in high-range examples.
- The system has a clear rule for when to refresh story levels after price approaches or passes the last practical level.

Acceptance criteria:

- Offline reports are stable first.
- Any future Discord change has a specific measured reason.

## Immediate Execution Checklist

- [x] Create this workplan.
- [x] Create the QA log file.
- [x] Build or update a level-quality batch generator.
- [x] Generate the first broad warehouse-backed test batch.
- [x] Run the first broad level-quality calibration/report.
- [x] Produce the first scoreboard.
- [x] Pick the first ranked tuning target.
- [x] Patch one target.
- [x] Re-run the same batch and record before/after.
- [x] Expand saved-candle QA to 300-case 5h/2h/8h reports.
- [x] Add operator-only sparse-tape diagnostics.
- [x] Pause before Discord wording/output changes.

## Current Pause Point - 2026-05-05

The level-quality work is paused after Patch 15 in `docs/76_LEVEL_QUALITY_DETECTION_QA_LOG_2026-05-04.md`.

Do not use live API data when resuming this work unless the user explicitly asks. The latest cycle used saved warehouse candles only.

Resume from these artifacts:

- `artifacts/level-quality-detection-300-expanded-classifier-aligned`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-2h`
- `artifacts/level-quality-detection-300-expanded-classifier-aligned-8h`

Next recommended action:

- Manually inspect raw candles for `EFOI`, `SKLZ`, `HOWL`, and `SKYQ`.
- Decide whether each remaining case is:
  - a real level-strength scoring miss
  - a report/diagnostic classification gap
  - an acceptable small-cap tape behavior that should stay operator-only
- Do not change strength thresholds again until those specific candles are reviewed.
