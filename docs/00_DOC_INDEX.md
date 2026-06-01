# Levels System Documentation Index

## Purpose

This folder contains the full plan for the candle-based levels system, including the first manual-testing phase and the later expansion into watchlist monitoring, alerts, and future trader-improvement-system reuse.

## Recommended implementation order

1. `01_MASTER_PLAN.md`
2. `02_SYSTEM_BLUEPRINT.md`
3. `03_IMPLEMENTATION_ROADMAP.md`
4. `01_SUPPORT_RESISTANCE_MASTER_PLAN.md`
5. `02_SUPPORT_RESISTANCE_IMPLEMENTATION_BLUEPRINT.md`
6. `03_MANUAL_TESTING_PLAN.md`

## Later-phase docs

7. `04_WATCHLIST_AND_MONITORING_SYSTEM_PLAN.md`
8. `05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
9. `06_DATA_PROVIDER_AND_CACHING_STRATEGY.md`
10. `07_TRADER_IMPROVEMENT_SYSTEM_INTEGRATION_PLAN.md`
11. `08_WATCHLIST_MONITORING_MASTER_PLAN.md`
12. `09_WATCHLIST_MONITORING_BLUEPRINT.md`
13. `10_EVENT_DETECTION_RULES.md`
14. `11_ALERT_INTELLIGENCE_MASTER_PLAN.md`
15. `12_ALERT_INTELLIGENCE_BLUEPRINT.md`
16. `13_ALERT_SCORING_RULES.md`
17. `14_ALERT_MONITOR_INTEGRATION_PLAN.md`

## Ongoing project log

18. `15_PROJECT_CHANGE_LOG.md`
19. `16_GITHUB_REPO_SETUP.md`
20. `20_LEVEL_STRENGTH_SCORING_IMPLEMENTATION_PLAN.md`

## Recent architecture and optional analysis layers

21. `30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`
22. `31_PR1_FULL_DIFF_REVIEW_AND_MERGE_RISK_REPORT.md`
23. `32_MARKET_CONTEXT_CLASSIFIER_PLAN.md`
24. `33_MARKET_CONTEXT_CLASSIFIER_INTEGRATION_PLAN.md`
25. `34_SESSION_AND_VOLUME_INTELLIGENCE_PLAN.md`
26. `35_TRADING_JOURNAL_EXECUTION_CONTEXT_PLAN.md`
27. `36_LEVELS_SYSTEM_VS_JOURNAL_ARCHITECTURE_BOUNDARY_AUDIT.md`
28. `37_EXECUTION_CONTEXT_SHARED_CONTRACT_ADR.md`
29. `38_LEVEL_INTELLIGENCE_AND_VOLUME_ENRICHMENT_PLAN.md`

## Completed facts-only support/resistance explanation work

- PR #16 added `src/lib/levels/level-context-explainer.ts` and `src/tests/level-context-explainer.test.ts`.
  - This is a pure helper for explaining existing `FinalLevelZone` levels using already-supplied session facts, volume facts, volume shelves, market context, facts bundles, and `enrichedAnalysis` metadata.
  - It is optional and does not change LevelEngine runtime behavior, level selection, scoring, alerts, monitoring, Discord output, trader-context behavior, or default output.
- PR #17 added `src/lib/levels/level-context-report.ts` and `src/tests/level-context-report.test.ts`.
  - This is a pure optional report builder for every existing `LevelEngineOutput` support/resistance bucket: major, intermediate, intraday, and extension support/resistance.
  - It delegates each existing level to `explainLevelContext(...)`, then adds report counts and explicit safety flags.
  - It is not wired into runtime paths yet.
- Boundary note:
  - levels-system owns facts-only support/resistance explanation outputs and shared market/level facts.
  - the trading journal remains separate and owns journal-specific grading, coaching, behavior scoring, P/L, giveback analysis, product workflows, and trader interpretation.
  - VWAP remains facts-only.
  - volume shelves remain facts-only and are not support/resistance levels.

## LevelAnalysisSnapshot v1 handoff

- `docs/79_JOURNAL_CONNECTOR_LEVEL_ANALYSIS_CONTRACT.md`
- `docs/81_LEVEL_ANALYSIS_SNAPSHOT_SCHEMA_V1_LOCK.md`
- `docs/82_LEVEL_ANALYSIS_SNAPSHOT_V1_RELEASE_NOTES.md`
- `docs/83_DOWNSTREAM_CONNECTOR_ADAPTER_BLUEPRINT.md`
- `docs/84_LEVEL_ANALYSIS_SNAPSHOT_V1_HANDOFF_COMPLETE.md`
- `docs/85_PRODUCTION_SNAPSHOT_RUNNER_PACKAGING.md`
- `docs/86_PRODUCTION_SNAPSHOT_RUNNER_SMOKE_TESTS.md`
- `docs/87_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_HARDENING.md`
- `docs/88_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_REAL_CACHE_VALIDATION.md`
- `docs/89_PRODUCTION_SNAPSHOT_RUNNER_BATCH_MANIFEST.md`
- Compact connector fixture: `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- Connector test pack: `src/tests/level-analysis-snapshot-downstream-adapter-test-pack.test.ts`
