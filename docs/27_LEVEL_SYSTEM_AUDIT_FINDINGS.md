# Level System Run 1 Audit Findings

Date: 2026-05-27
Branch audited: `codex/runtime-compare-tooling`
Main baseline pulled: `origin/main` at `dc6b407`
Run scope: Run 1 from `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md`

## Scope Confirmation

- Pulled latest `origin/main` and merged it into the active branch before re-running the audit.
- Confirmed `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md` exists after the pull.
- Audited repository usage only. No production code was changed.
- This document intentionally reconciles the rescue plan with the current repo state and with the known risk areas: partial-candle leakage, VWAP trader-context influence, formal market-structure `asOfTimestamp` filtering, shared support/resistance context gaps, and runtime coverage mismatch.

## Executive Summary

The rescue plan's core architecture read is correct: the active runtime still centers on `LevelEngine.generateLevels()` returning `LevelEngineOutput` with bucketed `FinalLevelZone[]` arrays, while the richer `rankLevels()` path produces `RankedLevel` objects with touch analysis, state, confidence, score explanations, and final ranking metadata.

The main nuance is that the richer path is no longer only experimental test code. It is wired into `src/lib/levels/level-runtime-output-adapter.ts`, `src/lib/levels/level-ranking-comparison.ts`, surfaced validation modules, and surfaced-selection modules. However, the default runtime mode remains `old`, and runtime compatibility is achieved by projecting the richer path back into the legacy `LevelEngineOutput` contract.

The safest migration direction is still the plan's recommendation: do not create a third support/resistance engine and do not replace `FinalLevelZone` wholesale. Preserve the active runtime contract, enrich it additively, and use adapter boundaries until runtime coverage is equivalent.

## Rescue Plan Reconciliation

The rescue plan says there are two overlapping paths:

- Active path: `LevelEngine.generateLevels()` -> `LevelEngineOutput` -> `FinalLevelZone`.
- Richer path: `rankLevels()` -> `RankedLevel` -> surfaced selection, explanations, state, confidence, and richer scoring.

That is accurate with three clarifications:

1. `rankLevels()` is partially wired into runtime-compatible tooling through `buildNewRuntimeCompatibleLevelOutput()`, but the `LevelEngine` default still returns old-path output unless `runtimeMode` is changed.
2. The new path currently emits compatibility notes that acknowledge approximated strength labels and incomplete extension behavior, so it should not be treated as coverage-equivalent yet.
3. Several journal/trader-context risks must be handled before richer level data becomes user-facing truth in reviews or live posts.

The five named risk areas reconcile with the plan this way:

- Partial-candle leakage risk: the repo declares a closed-candles-only policy, but some historical review paths still compute execution-time context from all candles with `timestamp <= execution timestamp`. If timestamps represent candle starts, that can include the still-forming execution candle. This is a correctness gate before expanding enriched support/resistance output into journal/replay contracts.
- VWAP trader-context issue: VWAP is still used to label move extension and influence story memory/material changes. This violates the intended separation between market facts and trader interpretation if VWAP is supposed to be factual-only or de-emphasized in trader context.
- Formal structure `asOfTimestamp` filtering: the practical candle structure builder filters future candles with `asOfTimestamp`; the formal structure builder request type has no `asOfTimestamp` and sorts all usable candles. Formal structure should not be backfilled into historical/journal output without the same guardrail.
- Shared S/R context gaps: `buildSupportResistanceContextFromNormalizedCandles()` exposes practical 5m candle market structure only, while live monitoring already tracks stable and formal structure by timeframe. Shared context consumers can therefore see less structure than live runtime.
- Runtime coverage mismatch: the new adapter maps richer ranked/surfaced output into the old shape but explicitly approximates old fields and maps only deeper-anchor extensions. The old path still has separate extension behavior and practical coverage rules.

## Run 1 Checklist Answers

### 1. Files That Call `LevelEngine.generateLevels()`

Production/runtime:

- `src/runtime/main.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts` calls `generateLevelsWithCandleSeries()`

Scripts and operational tools:

- `src/scripts/scan-opportunity-recovery-windows.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/scripts/run-live-opportunity-validation.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/scripts/run-opportunity-validation-sample.ts`
- `src/scripts/run-level-quality-audit.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/scripts/run-alert-intelligence-sample.ts`

Tests:

- `src/tests/level-engine.test.ts`
- `src/tests/level-runtime-mode.test.ts`

### 2. Files That Consume `LevelEngineOutput`

Runtime-critical and shared context consumers:

- `src/lib/levels/level-types.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/execution-level-relations.ts`
- `src/lib/trader-context/trader-context.ts`

Validation, review, and reporting:

- `src/lib/validation/forward-reaction-validator.ts`
- `src/lib/validation/level-persistence-validator.ts`
- `src/lib/review/support-resistance-calibration-report.ts`
- `src/lib/review/offline-small-cap-scenario-simulator.ts`

Level system adapters and analysis:

- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-ranking-comparison.ts`
- `src/lib/levels/level-surfaced-validation.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-quality-audit.ts`
- `src/lib/levels/level-refresh-policy.ts`

Scripts:

- `src/scripts/scan-opportunity-recovery-windows.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-opportunity-validation-sample.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/scripts/run-level-persistence-validation.ts`

Tests:

- `src/tests/watchlist-monitor.test.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/level-ranking-comparison.test.ts`
- `src/tests/level-quality-audit.test.ts`
- `src/tests/level-persistence-validator.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/forward-reaction-validator.test.ts`

### 3. Files That Consume `FinalLevelZone`

Runtime-critical monitoring and alerting:

- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/practical-trade-structure.ts`
- `src/lib/monitoring/trade-story-intelligence.ts`
- `src/lib/monitoring/symbol-state.ts`
- `src/lib/monitoring/zone-utils.ts`
- `src/lib/monitoring/level-importance.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/alerts/trader-message-language.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`

Shared support/resistance and trader context:

- `src/lib/support-resistance/execution-level-relations.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/trader-context/trader-context.ts`

Validation, review, and replay:

- `src/lib/validation/forward-reaction-validator.ts`
- `src/lib/validation/level-persistence-validator.ts`
- `src/lib/review/support-resistance-calibration-report.ts`
- `src/lib/review/offline-small-cap-scenario-simulator.ts`
- `src/lib/review/execution-relation-replay-report.ts`

Level engine internals and adapters:

- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-quality-audit.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-ranking-comparison.ts`

Scripts and tests also consume `FinalLevelZone`, including replay scripts and many test fixtures around monitoring, scoring, quality audit, engine output, manual runtime, and alert behavior.

### 4. Files That Call `rankLevels()`

- `src/lib/levels/level-ranking.ts` defines `rankLevels()`.
- `src/lib/levels/level-runtime-output-adapter.ts` calls `rankLevels()` to project the richer path into `LevelEngineOutput`.
- `src/lib/levels/level-surfaced-validation.ts` calls `rankLevels()` for surfaced validation.
- `src/lib/levels/level-ranking-comparison.ts` calls `rankLevels()` for old/new comparison.
- `src/tests/level-strength-ranking.test.ts` calls `rankLevels()` directly.

### 5. Files That Consume `RankedLevel`

Core richer-ranking modules:

- `src/lib/levels/level-types.ts`
- `src/lib/levels/level-ranking.ts`
- `src/lib/levels/level-clustering.ts`
- `src/lib/levels/level-structural-scoring.ts`
- `src/lib/levels/level-active-scoring.ts`
- `src/lib/levels/level-state-engine.ts`
- `src/lib/levels/level-score-explainer.ts`

Surfaced-selection and comparison modules:

- `src/lib/levels/level-surfaced-selection.ts`
- `src/lib/levels/level-surfaced-selection-explainer.ts`
- `src/lib/levels/level-ranking-comparison.ts`

Tests:

- `src/tests/level-surfaced-selection.test.ts`
- `src/tests/level-strength-ranking.test.ts`

### 6. Tests Covering The Original Runtime Path

Direct old-path and bucketed-output coverage:

- `src/tests/level-engine.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/level-ranker.test.ts`
- `src/tests/level-scorer.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/level-quality-audit.test.ts`

Downstream runtime behavior:

- `src/tests/watchlist-monitor.test.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/forward-reaction-validator.test.ts`
- `src/tests/level-persistence-validator.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

### 7. Tests Covering The Richer Ranking Path

- `src/tests/level-strength-ranking.test.ts`
- `src/tests/level-ranking-comparison.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/level-surfaced-selection.test.ts`
- `src/tests/level-surfaced-validation.test.ts`
- `src/tests/level-surfaced-shadow-evaluation.test.ts`
- `src/tests/level-cached-surfaced-replay.test.ts`

This is meaningful coverage, but it is not equivalent to the old runtime path coverage. The richer path still needs parity tests for extension behavior, strength-label mapping, downstream alert consumption, and shared context output before it can safely become default.

### 8. `RankedLevel` Fields Missing From `FinalLevelZone`

`RankedLevel` adds these fields or richer equivalents not present on `FinalLevelZone`:

- `type`
- `price`
- `sourceTimeframes`
- `originKinds`
- `touches`
- `meaningfulTouchCount`
- `rejectionCount`
- `failedBreakCount`
- `cleanBreakCount`
- `reclaimCount`
- `roleFlipCount`
- `strongestReactionMovePct`
- `averageReactionMovePct`
- `bestVolumeRatio`
- `averageVolumeRatio`
- `cleanlinessStdDevPct`
- `ageInBars`
- `barsSinceLastReaction`
- `structuralStrengthScore`
- `activeRelevanceScore`
- `finalLevelScore`
- `score`
- `rank`
- `confidence`
- `state`
- `durabilityLabel`
- `isClusterRepresentative`
- `clusterId`
- `explanation`
- `scoreBreakdown`

Conceptual overlaps exist but names/contracts differ: `type` vs `kind`, `price` vs `representativePrice`, `sourceTimeframes` vs `timeframeSources`, `originKinds` vs `sourceTypes`, and `score/finalLevelScore` vs `strengthScore`.

### 9. `FinalLevelZone` Fields Missing From `RankedLevel`

`FinalLevelZone` includes these fields or old-path contracts not present on `RankedLevel`:

- `kind`
- `timeframeBias`
- `representativePrice`
- `strengthScore`
- `strengthLabel`
- `confluenceCount`
- `sourceTypes`
- `timeframeSources`
- `reactionQualityScore`
- `rejectionScore`
- `displacementScore`
- `sessionSignificanceScore`
- `followThroughScore`
- `gapContinuationScore`
- `sourceEvidenceCount`
- `firstTimestamp`
- `lastTimestamp`
- `sessionDate`
- `isExtension`
- `freshness`
- `notes`

Shared fields are `id`, `symbol`, `zoneLow`, `zoneHigh`, and `touchCount`.

### 10. Safe Adapters Versus Runtime-Critical Modules

Runtime-critical modules:

- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/swing-detector.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/interaction-state-machine.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/alerts/*`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/execution-level-relations.ts`
- `src/lib/trader-context/trader-context.ts`

Safe adapters and review surfaces:

- `src/lib/levels/level-runtime-output-adapter.ts`, provided it remains behind runtime-mode controls.
- `src/lib/levels/level-ranking-comparison.ts`
- `src/lib/levels/level-surfaced-validation.ts`
- `src/lib/levels/level-surfaced-shadow-evaluation.ts`
- `src/lib/levels/level-cached-surfaced-replay.ts`
- `src/lib/review/*` reports and audit modules.
- `src/scripts/run-*` review, validation, sample, and replay scripts.

Richer-ranking core modules are valuable but should be treated as analysis engines until the adapter parity is proven:

- `src/lib/levels/level-ranking.ts`
- `src/lib/levels/level-touch-analysis.ts`
- `src/lib/levels/level-structural-scoring.ts`
- `src/lib/levels/level-active-scoring.ts`
- `src/lib/levels/level-state-engine.ts`
- `src/lib/levels/level-score-explainer.ts`
- `src/lib/levels/level-score-config.ts`
- `src/lib/levels/level-clustering.ts`
- `src/lib/levels/level-surfaced-selection.ts`

## Risk Findings To Carry Forward

### P1: Historical Context Can Include Partial Execution Candles

Evidence:

- `src/lib/support-resistance/trade-analysis-context.ts:523` defines higher-timeframe cutoffs.
- `src/lib/support-resistance/trade-analysis-context.ts:531` uses `timestamp - FOUR_HOUR_MS` for 4h, while `:532` uses the execution timestamp directly for 5m.
- `src/lib/support-resistance/trade-analysis-context.ts:1817`-`:1820` declares a closed-candles-only policy and says partial candles require lower-granularity source.
- `src/lib/support-resistance/trade-analysis-context.ts:1937` filters execution candles with `candle.timestamp <= timestamp`.

Why it matters:

If candle timestamps are candle starts, `<= execution timestamp` includes the still-forming execution candle. That leaks information into journal/replay context and can make levels, dynamic levels, and trader context look cleaner than they were live.

Recommended follow-up:

Normalize every historical/replay context filter to explicit candle-close semantics: `candleEnd <= asOfTimestamp`, with timeframe-aware close calculation and tests proving execution candles are excluded unless sourced from lower granularity.

### P1: VWAP Still Influences Trader Context

Evidence:

- `src/lib/trader-context/trader-context.ts:718` computes `percentFromVwap`.
- `src/lib/trader-context/trader-context.ts:729`-`:736` uses VWAP distance to mark moves stretched or extended.
- `src/lib/trader-context/trader-context.ts:1213`-`:1219` maps stretched moves into `extended_runner`.
- `src/lib/trader-context/trader-context.ts:1499`-`:1503` treats stretched moves as material story changes.

Why it matters:

VWAP is not just displayed as a dynamic reference; it influences interpretation, labels, confidence, and memory behavior. If the target contract is factual-only VWAP or no VWAP-driven trader interpretation, this is a mismatch.

Recommended follow-up:

Decide whether VWAP belongs in trader-context decisions. If not, keep VWAP in raw market facts/dynamic levels and remove it from move-extension labels, story memory, and post/no-post decisioning.

### P1: Formal Market Structure Lacks `asOfTimestamp` Filtering

Evidence:

- `src/lib/structure/formal-market-structure.ts:103`-`:108` defines `BuildFormalMarketStructureRequest` with `symbol`, `candles`, `timeframe`, and `options`, but no `asOfTimestamp`.
- `src/lib/structure/formal-market-structure.ts:168`-`:182` sorts all usable candles and does not filter future candles.
- By contrast, `src/lib/structure/candle-market-structure.ts:200`-`:220` filters by `asOfTimestamp`.
- `src/lib/structure/candle-market-structure.ts:697`-`:710` emits a diagnostic when future candles are excluded.

Why it matters:

Formal BOS/CHOCH context can become lookahead-contaminated in replay/journal paths if callers pass a full candle set. Practical structure has the guardrail; formal structure does not.

Recommended follow-up:

Add `asOfTimestamp` support and future-candle diagnostics to formal structure before using it in shared replay/journal contracts.

### P2: Shared Support/Resistance Context Does Not Surface The Same Structure As Live Runtime

Evidence:

- `src/lib/support-resistance/build-support-resistance-context.ts:74`-`:82` exposes one `marketStructure: CandleMarketStructureContext`.
- `src/lib/support-resistance/build-support-resistance-context.ts:137`-`:142` builds only practical candle structure from 5m candles.
- `src/lib/monitoring/watchlist-monitor.ts:313`-`:317` seeds formal structure into runtime snapshots.
- `src/lib/monitoring/watchlist-monitor.ts:703`-`:733` updates stable and formal 5m/4h structure in live runtime.
- `src/lib/support-resistance/index.ts:114`-`:148` exports formal and stable builders, so the public boundary has the pieces but the shared context does not yet include them.

Why it matters:

Consumers of shared support/resistance context can see a weaker or different structure story than live monitoring. That makes audit/replay output diverge from what a live trader saw.

Recommended follow-up:

Extend the shared context additively with a multi-timeframe structure object, including practical/stable/formal where available, rather than replacing the existing `marketStructure` field.

### P2: New Runtime-Compatible Path Is Not Coverage-Equivalent

Evidence:

- `src/lib/levels/level-engine.ts:288` defaults runtime mode to `"old"`.
- `src/lib/levels/level-engine.ts:294`-`:320` builds a new projection only for `new` or `compare` mode.
- `src/lib/levels/level-runtime-output-adapter.ts:369`-`:372` states that strength labels are approximated and extensions only map surfaced deeper anchors.
- `src/lib/levels/level-ranker.ts:634`-`:648` old-path ranking still calls `buildLevelExtensions()` with forward-planning and low-price coverage behavior.

Why it matters:

The richer ranking path has better analytical fields, but its projected output is not yet a behavioral replacement for the old path. Promoting it directly risks losing extension ladders, old strength semantics, and downstream alert assumptions.

Recommended follow-up:

Keep `runtimeMode: "old"` as default. Use compare/shadow runs to define parity gates for bucket counts, extension availability, strength labels, alert triggers, and downstream trader-context outputs.

## Recommended Migration Direction

1. Keep `FinalLevelZone` as the runtime transport type for now.
2. Add enriched ranking data additively, preferably as a nested optional object such as `enrichedAnalysis`, instead of renaming or replacing existing fields.
3. Reuse the existing richer modules: `rankLevels()`, touch analysis, structural scoring, active scoring, state engine, and explainer.
4. Strengthen adapter tests before enabling richer data by default in live runtime.
5. Fix no-lookahead handling for partial candles and formal structure before exposing enriched context to journal/replay surfaces.
6. Resolve the VWAP trader-context policy before treating trader-context output as a clean market-facts contract.
7. Extend shared support/resistance context additively to include stable/formal multi-timeframe structure without breaking current consumers.

## Run 1 Acceptance Status

- Production code changed: no.
- Active runtime path identified: yes, `LevelEngine.generateLevels()` defaulting to old `LevelEngineOutput` / `FinalLevelZone`.
- Richer unused/partially used path identified: yes, `rankLevels()` and surfaced selection are partially wired through adapters, comparison, validation, and tests.
- Known consumers listed: yes, grouped above.
- Safe migration direction recommended: yes, additive enrichment over replacement, no third engine.

## Verification

Commands run during this audit:

- `git fetch origin main`
- `git merge --no-edit origin/main`
- `Test-Path docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md`
- `rg` usage scans for `generateLevels`, `LevelEngineOutput`, `FinalLevelZone`, `rankLevels`, and `RankedLevel`
- Type and evidence reads for the level types, runtime adapter, runtime mode, support/resistance context, trader context, formal structure, candle structure, and trade-analysis context

No build or test command is required for this documentation-only audit. A TypeScript compile can be run in the next implementation run after production changes are made.
