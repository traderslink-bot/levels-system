# Support / Resistance Calibration And Forward Ladder Completion Plan

## What This File Is For

This is the focused execution plan for improving the core candle-intelligence engine that builds support/resistance levels. It is separate from Discord wording work.

The goal is to make the level engine more provable:

- levels should be backed by candle structure
- forward ladders should be complete enough for runners
- ranked levels should matter when price reaches them
- clustered levels should be treated as practical zones without deleting individual levels
- no-resistance/no-support situations should be audited before they are trusted

This file is for Codex to track support/resistance engine work from plan to implementation to tests and saved-data evidence.

## Product Standard

The support/resistance engine should answer:

- Where are the real support and resistance areas?
- Which levels are stronger versus weaker?
- Which levels are too close together and should be read as one practical zone?
- Is there a suspicious gap in the forward ladder?
- Did price actually react at generated levels later?
- Did the engine miss a level that the later candle path clearly respected?
- Is the issue bad level logic, missing candle coverage, or provider/cache gaps?

Discord may reveal bad output, but the fix should usually happen in the candle/level engine or its calibration reports.

## Current State

Implemented before and during this plan:

- multi-timeframe level engine using daily, `4h`, and `5m` candles
- surfaced support/resistance buckets
- extension ladders
- level scoring and ranking
- level quality audit
- forward reaction validator
- persistence validator
- shared support/resistance API
- durable candle warehouse foundation
- saved-data calibration reports
- first snapshot trade-map audit
- execution relation replay
- missing forward resistance cases in regression packs
- small-cap practical zone and materiality context
- `npm run levels:calibrate`
- `src/lib/review/support-resistance-calibration-report.ts`
- `src/scripts/run-support-resistance-calibration-report.ts`
- focused tests in `src/tests/support-resistance-calibration-report.test.ts`
- JSON/Markdown artifacts:
  - `support-resistance-calibration.json`
  - `support-resistance-calibration.md`

The new report now combines:

- generated levels at a saved post time
- future 5m candle reactions
- forward ladder completeness
- missing/wide/crowded forward level evidence
- per-symbol trust verdicts
- missing candle coverage separated from level-engine failure
- coverage gaps and backfill hints for unproven level proof
- ranking proof by source, distance, strength, and level family
- 5m market-structure linkage so ladder problems can be separated from range/chop behavior
- support/resistance calibration gate artifacts
- support/resistance findings feeding candle regression packs and backfill priority scoring

## Phase 1: Plan And Inventory

Goal: document the concrete work and reuse existing validation code instead of creating duplicate level logic.

Steps:

1. Create this plan.
2. Inventory existing validators:
   - `src/lib/validation/forward-reaction-validator.ts`
   - `src/lib/validation/level-persistence-validator.ts`
   - `src/lib/levels/level-quality-audit.ts`
   - `src/lib/review/execution-relation-replay-report.ts`
   - `src/lib/review/candle-intelligence-regression-pack.ts`
3. Decide what new report should add:
   - saved-session level generation
   - forward reaction summary
   - forward ladder completeness summary
   - evidence examples
   - JSON/Markdown output
4. Keep output operator-only.

Completion:

- this file exists
- `docs/69` points to this file
- implementation scope is clear

## Phase 2: Saved-Session Support/Resistance Calibration Report

Goal: build a report that proves whether generated levels were useful after the saved post time.

Implementation:

1. Add `src/lib/review/support-resistance-calibration-report.ts`.
2. Read saved Discord audit rows from a session folder or `.jsonl`.
3. Group posted rows by symbol.
4. Load cached daily, `4h`, and `5m` candles from `.validation-cache/candles`.
5. Build support/resistance context at the first saved post timestamp with `asOfTimestamp`.
6. Collect future `5m` candles after that timestamp.
7. Run `validateForwardReactions(...)`.
8. Produce per-symbol evidence:
   - candle counts
   - generated support/resistance counts
   - surfaced versus extension usefulness
   - touch/useful/respect/break rates
   - examples of respected/broken/untouched levels
   - missing candle proof
   - ranking proof buckets
   - market-structure alignment
   - coverage gaps and backfill hints
9. Write JSON and Markdown artifacts.

Acceptance:

- report runs on saved sessions
- missing candle data is separated from bad level logic
- future-candle leakage is avoided by generating levels at the saved timestamp
- output is operator-only

## Phase 3: Forward Ladder Completeness Audit

Goal: catch cases where the engine leaves suspicious gaps above or below price.

Implementation:

1. In the new report, add `forwardLadder` evidence per symbol.
2. Use the generated level output at the saved timestamp.
3. Identify:
   - nearest support below price
   - nearest resistance above price
   - next support after nearest support
   - next resistance after nearest resistance
   - first support gap percent
   - first resistance gap percent
   - no-forward-support
   - no-forward-resistance
   - wide support gap
   - wide resistance gap
   - crowded nearby support levels
   - crowded nearby resistance levels
4. Use future `5m` candles only as evidence for whether a suspicious missing/wide area mattered later.
5. Do not invent levels.

Acceptance:

- report can say `trusted`, `watch`, `broken`, or `unproven`
- wide/no-forward ladders become explicit review items
- crowded ladders become practical-zone evidence, not hidden levels

## Phase 4: Tests

Goal: make the report reliable and hard to hand-wave.

Tests:

1. Report builds a level context from cached candles and produces forward reaction evidence.
2. Report flags missing cached candles as `unproven` or `broken` without crashing.
3. Report flags a no-forward-resistance or wide-forward-gap condition.
4. Markdown includes:
   - totals
   - symbol rows
   - forward reaction evidence
   - forward ladder evidence
5. Writer creates JSON and Markdown files.

Acceptance:

- focused tests pass
- full `npm test` passes

## Phase 5: Script And Docs

Goal: make the report easy to run after a trading day.

Implementation:

1. Add `src/scripts/run-support-resistance-calibration-report.ts`.
2. Add package script:
   - `levels:calibrate`
3. Update docs:
   - `README.md`
   - `docs/15_PROJECT_CHANGE_LOG.md`
   - `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
   - `docs/30_SIGNAL_QUALITY_ROADMAP.md`
   - `docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md`
4. Add the command to the closed-market checklist.

Command:

```powershell
npm run levels:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run levels:calibrate -- --all-sessions
```

Expected artifacts:

```text
support-resistance-calibration.json
support-resistance-calibration.md
support-resistance-calibration-gate.json
support-resistance-calibration-gate.md
```

Acceptance:

- command runs on a saved session
- command supports broad saved-data scan
- docs explain how to use it
- gate artifacts make pass/review/fail standards explicit

## Phase 6: Saved-Data Smoke Run

Goal: prove the report runs on the latest saved data.

Steps:

1. Run the report on the latest session when cached candles exist.
2. Run a bounded broad scan if practical.
3. Record counts in the final summary.
4. If the report shows missing candle coverage, treat that as warehouse/backfill work, not a level-engine failure.

Acceptance:

- output artifacts are generated
- results distinguish trusted/watch/broken/unproven

Latest smoke results from this implementation pass:

```powershell
npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03
```

Result:

- symbols reviewed: 18
- trusted: 0
- watch: 0
- broken: 0
- unproven: 18
- no forward resistance flags: 2
- wide forward gap flags: 0
- coverage gap tasks: 22
- gate: review

Interpretation:

- This latest single-session run is not proof that the level engine failed.
- Every symbol lacked enough future `5m` candles after the first saved post for forward reaction proof.
- One symbol also lacked cached candles entirely.
- This is useful evidence for the warehouse/backfill plan: saved sessions need better post-alert candle coverage before they can prove or disprove level quality.

Bounded broad scan:

```powershell
npm run levels:calibrate -- --all-sessions --max-symbols 25
```

Result:

- symbols reviewed: 25
- trusted: 9
- watch: 3
- broken: 0
- unproven: 13
- no forward resistance flags: 12
- wide forward gap flags: 0
- coverage gap tasks: 36
- gate: review

Interpretation:

- Broad saved data can already prove a useful subset of level reactions.
- The watch cases were evidence-based, not invented from chart preference; for example, crowded nearby support clusters are flagged separately from outright broken ladders.
- The remaining unproven cases are mostly candle coverage problems, so the next major engine step remains warehouse/backfill coverage and provider fetch planning.

## Phase 7: Next Calibration Work After This Pass

Completed during the follow-up implementation pass:

1. Support/resistance calibration findings now feed `candles:regression-pack`.
2. `levels:calibrate` now writes a support/resistance calibration gate.
3. Ranking proof now compares level usefulness by:
   - surfaced support/resistance
   - extension support/resistance
   - daily / `4h` / `5m` buckets when forward reactions exist
   - strength label
   - distance band
4. Market-structure linkage now explains whether 5m structure supports the ladder, questions it, or lacks enough evidence.
5. Backfill priority now includes support/resistance calibration findings in its task scoring.

Remaining next-phase work:

1. Compare level reaction quality by timeframe source across a larger backfilled dataset:
   - daily
   - `4h`
   - `5m`
   - extension
2. Add provider comparison for level reaction outcomes.
3. Calibrate ranking weights if repeated saved-data evidence shows weak levels outperforming major levels.
4. Turn repeated support/resistance watch cases into named fixtures for regression replay.
5. Add a hard release preset after more warehouse coverage exists.

## Definition Of Done For This Pass

This pass is done when:

- this plan exists and is linked from `docs/69`
- `levels:calibrate` exists
- saved-session support/resistance calibration report exists
- forward-ladder completeness audit exists inside that report
- focused tests exist
- calibration gate exists
- coverage/backfill hints exist
- ranking proof exists
- market-structure linkage exists
- regression pack and backfill priority consume calibration findings
- docs are updated
- focused tests pass
- `npm run build` passes
- `npm test` passes
