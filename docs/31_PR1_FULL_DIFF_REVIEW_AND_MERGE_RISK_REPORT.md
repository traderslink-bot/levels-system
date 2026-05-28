# PR #1 Full Diff Review And Merge Risk Report

Branch reviewed: `codex/runtime-compare-tooling`

Base reviewed: `main`

Date: 2026-05-27

Review scope: full `main...codex/runtime-compare-tooling` diff, not only the recent level-system rescue commits. Counts below exclude this uncommitted report file.

## Executive Summary

PR #1 should remain draft. The branch is too large and too runtime-critical to merge as one PR without a split or a deliberate integration plan.

The full diff is 339 changed files with roughly 105,013 insertions and 1,224 deletions. The recent level-system rescue work is a much smaller and more coherent slice: 20 unique files across rescue docs, no-lookahead support/resistance and market-structure safety, runtime parity tests, runtime projection adapter changes, and additive `enrichedAnalysis` metadata.

The rescue commits are separated in history, but not perfectly separable by file. Eleven rescue files were also touched by earlier runtime-compare work, so the rescue work can be extracted, but it will need careful cherry-picking or a rebuilt branch from `main` instead of a trivial file-only split.

Recommended merge path: do not merge PR #1 as-is. Split it into smaller PRs, with the level-system rescue/no-lookahead/parity work treated as the highest-priority reviewable slice.

## Commands Run

- `git status`
- `git diff main...codex/runtime-compare-tooling --stat`
- `git diff main...codex/runtime-compare-tooling --name-only`
- `git log --oneline main..codex/runtime-compare-tooling`

Additional read-only inventory commands were run to categorize files, identify rescue-phase commits, and measure overlap between pre-rescue and rescue file touches.

## Total Changed Files And Rough Categories

Full PR diff:

- Total changed files: 339
- Insertions: about 105,013
- Deletions: about 1,224

Rough category counts:

- Documentation and README: 57
- Tests: 86
- Level-system runtime and ranking: 20
- Alerts and Discord posting: 11
- Monitoring/runtime decisioning: 27
- Shared support/resistance: 14
- Formal/stable/candle market structure: 4
- Market data and providers: 9
- Review/report tooling: 31
- Scripts and operational launchers: 51
- Runtime UI/server: 5
- Trader context: 2
- Candle warehouse: 6
- Signal category code: 3
- Stock context: 5
- Validation utilities: 2
- Config/CI/package files: 5

These categories overlap conceptually, but the file counts above are path-based and useful for merge-risk sizing.

## Files Changed During Level-System Rescue Work

Rescue phase is treated as commits starting at `dc6b407 Add level system rescue and professional analysis plan` through `bc0b32f Add level system rescue PR readiness report`.

Unique rescue-phase files: 20

Documentation:

- `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md`
- `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md`
- `docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md`
- `docs/29_LEVEL_RUNTIME_PARITY_GAP_REMEDIATION_PLAN.md`
- `docs/30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`

Runtime level output and types:

- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-types.ts`

No-lookahead market data, structure, and shared support/resistance:

- `src/lib/market-data/candle-as-of-filter.ts`
- `src/lib/structure/candle-market-structure.ts`
- `src/lib/structure/formal-market-structure.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/support-resistance/single-timeframe-context.ts`
- `src/lib/support-resistance/symbol-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`

Rescue tests:

- `src/tests/candle-as-of-filter.test.ts`
- `src/tests/formal-market-structure.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

## Files Changed Before The Level-System Rescue Work

The pre-rescue branch work is the overwhelming majority of PR #1.

- Final PR files outside the rescue-phase file set: 319
- Unique files touched by pre-rescue commits: 330
- Rescue/pre-rescue overlap: 11 files

Major pre-rescue file groups include:

- Runtime compare and surfaced-selection tooling under `src/lib/levels/*`, including `level-runtime-mode.ts`, `level-runtime-output-adapter.ts`, `level-surfaced-selection.ts`, `level-surfaced-shadow-evaluation.ts`, `level-surfaced-validation.ts`, and `level-ranking-comparison.ts`.
- Manual watchlist runtime and server changes under `src/lib/monitoring/*` and `src/runtime/*`, especially `manual-watchlist-runtime-manager.ts`, `live-thread-post-policy.ts`, `event-detector.ts`, `watchlist-monitor.ts`, `manual-watchlist-page.ts`, and `manual-watchlist-server.ts`.
- Alert and Discord delivery changes under `src/lib/alerts/*`, especially `alert-router.ts`, `trader-message-language.ts`, `discord-rest-thread-gateway.ts`, and `discord-audited-thread-gateway.ts`.
- Trader-context and shared support/resistance expansion under `src/lib/trader-context/*` and `src/lib/support-resistance/*`.
- Candle warehouse, market data, stock context, signal-category, and validation changes.
- Large review/reporting and replay tooling surface under `src/lib/review/*` and `src/scripts/*`.
- A large documentation sequence from `docs/21_*` through `docs/69_*`, plus README and changelog updates.

Largest pre-rescue or full-branch diff contributors by inserted lines:

- `src/tests/manual-watchlist-runtime-manager.test.ts`: about 6,027 insertions
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`: about 5,458 insertions
- `docs/15_PROJECT_CHANGE_LOG.md`: about 3,972 insertions
- `scripts/start-manual-watchlist-long-run.ps1`: about 2,499 insertions
- `src/lib/support-resistance/trade-analysis-context.ts`: about 2,156 insertions
- `docs/52_TRADER_INTELLIGENCE_V2_SHARED_ENGINE_HANDOFF_2026-05-02.md`: about 1,992 insertions
- `src/lib/monitoring/live-thread-post-policy.ts`: about 1,943 insertions
- `src/lib/review/live-post-replay-simulator.ts`: about 1,807 insertions
- `src/tests/level-runtime-mode.test.ts`: about 1,608 insertions
- `src/tests/support-resistance-shared-api.test.ts`: about 1,549 insertions
- `src/lib/alerts/alert-router.ts`: about 1,489 insertions
- `src/lib/alerts/trader-message-language.ts`: about 1,410 insertions
- `src/lib/trader-context/trader-context.ts`: about 1,406 insertions

## Rescue Separation Assessment

The rescue commits are cleanly separated in commit history, but not cleanly separated at the file level.

Files touched by both pre-rescue and rescue commits:

- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/structure/candle-market-structure.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/support-resistance/single-timeframe-context.ts`
- `src/lib/support-resistance/symbol-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

Conclusion: the rescue work can be separated from earlier runtime-compare commits, but not by simply taking the rescue files wholesale. A clean extraction should start from `main`, then cherry-pick or manually replay the rescue commits while bringing only the required prerequisite runtime-compare adapter pieces.

## Runtime-Critical Files Changed

Level runtime, scoring, ranking, and surfaced-selection:

- `src/lib/levels/level-cached-surfaced-replay.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-quality-audit.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-ranking-comparison.ts`
- `src/lib/levels/level-ranking.ts`
- `src/lib/levels/level-runtime-compare-review.ts`
- `src/lib/levels/level-runtime-comparison-logger.ts`
- `src/lib/levels/level-runtime-mode.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-score-explainer.ts`
- `src/lib/levels/level-structural-scoring.ts`
- `src/lib/levels/level-surfaced-selection-config.ts`
- `src/lib/levels/level-surfaced-selection-explainer.ts`
- `src/lib/levels/level-surfaced-selection.ts`
- `src/lib/levels/level-surfaced-shadow-evaluation.ts`
- `src/lib/levels/level-surfaced-validation.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/swing-detector.ts`
- `src/lib/levels/zone-tactical-read.ts`

Market data, structure, and support/resistance:

- `src/lib/market-data/candle-as-of-filter.ts`
- `src/lib/market-data/candle-fetch-service.ts`
- `src/lib/market-data/candle-session-classifier.ts`
- `src/lib/market-data/candle-types.ts`
- `src/lib/market-data/candle-validation.ts`
- `src/lib/market-data/fetch-planning.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/market-data/provider-types.ts`
- `src/lib/market-data/providers/twelve-data-historical-candle-provider.ts`
- `src/lib/structure/candle-market-structure.ts`
- `src/lib/structure/formal-market-structure.ts`
- `src/lib/structure/index.ts`
- `src/lib/structure/stable-market-structure.ts`
- `src/lib/support-resistance/adapters/shared-support-resistance-adapter.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/execution-level-relations.ts`
- `src/lib/support-resistance/gap-structure.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/support-resistance/indicators/dynamic-levels.ts`
- `src/lib/support-resistance/indicators/ema.ts`
- `src/lib/support-resistance/indicators/index.ts`
- `src/lib/support-resistance/indicators/vwap.ts`
- `src/lib/support-resistance/reference-levels.ts`
- `src/lib/support-resistance/single-timeframe-context.ts`
- `src/lib/support-resistance/symbol-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`
- `src/lib/support-resistance/warehouse-context.ts`

Runtime entry points and operational surface:

- `src/runtime/main.ts`
- `src/runtime/manual-watchlist-discord.ts`
- `src/runtime/manual-watchlist-http.ts`
- `src/runtime/manual-watchlist-page.ts`
- `src/runtime/manual-watchlist-server.ts`
- `scripts/start-manual-watchlist-long-run.ps1`
- `package.json`
- `tsconfig.json`

## Monitoring, Alert, And Trader-Context Files Changed

Alert and Discord files:

- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-filter.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/discord-audited-thread-gateway.ts`
- `src/lib/alerts/discord-rest-thread-gateway.ts`
- `src/lib/alerts/discord-thread-cleanup.ts`
- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/alerts/trader-message-language.ts`

Monitoring files:

- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/failed-level-memory.ts`
- `src/lib/monitoring/interaction-state-machine.ts`
- `src/lib/monitoring/intraday-price-structure.ts`
- `src/lib/monitoring/level-importance.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/live-stable-market-structure.ts`
- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/lib/monitoring/manual-watchlist-runtime-events.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/monitoring-config.ts`
- `src/lib/monitoring/monitoring-event-diagnostic-logger.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/opportunity-diagnostics.ts`
- `src/lib/monitoring/opportunity-engine.ts`
- `src/lib/monitoring/opportunity-evaluator.ts`
- `src/lib/monitoring/opportunity-interpretation.ts`
- `src/lib/monitoring/opportunity-runtime-controller.ts`
- `src/lib/monitoring/practical-trade-structure.ts`
- `src/lib/monitoring/primary-trade-area.ts`
- `src/lib/monitoring/symbol-state.ts`
- `src/lib/monitoring/trade-story-intelligence.ts`
- `src/lib/monitoring/volume-activity.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/lib/monitoring/watchlist-store.ts`

Trader-context files:

- `src/lib/trader-context/index.ts`
- `src/lib/trader-context/trader-context.ts`

## Docs-Only Files

Documentation and README account for 57 changed files. The docs set includes:

- `README.md`
- `docs/00_DOC_INDEX.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `docs/21_LEVEL_RANKING_COMPARISON_AND_MIGRATION_PLAN.md`
- `docs/22_LEVEL_SURFACED_SELECTION_ADAPTER_PLAN.md`
- `docs/23_LEVEL_SURFACED_VALIDATION_SHOWDOWN_PLAN.md`
- `docs/24_LEVEL_SURFACED_SHADOW_EVALUATION_PLAN.md`
- `docs/25_LEVEL_SURFACED_ADAPTER_CALIBRATION_PLAN.md`
- `docs/26_LEVEL_RUNTIME_FLAG_EXPLORATION_PLAN.md`
- `docs/26_LEVEL_SYSTEM_RESCUE_AND_PROFESSIONAL_ANALYSIS_PLAN.md`
- `docs/27_LEVEL_RUNTIME_COMPARE_REVIEW_PLAN.md`
- `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md`
- `docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md`
- `docs/28_RUNTIME_HANDOFF_2026-04-21.md`
- `docs/29_LEVEL_RUNTIME_PARITY_GAP_REMEDIATION_PLAN.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- `docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md`
- `docs/32_AI_COMMENTARY_WORKFLOW.md`
- `docs/33_CODEX_RUNTIME_AND_SIGNAL_REVIEW_2026-04-23.md`
- `docs/34_CODEX_EXECUTION_BRIEF_2026-04-23.md`
- `docs/35_PROJECT_LEVEL_SUGGESTIONS_2026-04-23.md`
- `docs/36_RUNTIME_HANDOFF_2026-04-25.md`
- `docs/37_DISCORD_THREAD_POSTING_SUGGESTIONS_2026-04-25.md`
- `docs/38_CODEX_PROJECT_IMPROVEMENT_PLAN_2026-04-28.md`
- `docs/39_TRADER_LANGUAGE_BOUNDARY_AND_DISCORD_RULES_2026-04-29.md`
- `docs/40_FINAL_DISCORD_WORDING_CLEANUP_2026-04-29.md`
- `docs/41_MODULAR_SIGNAL_CATEGORIES_PLAN_2026-04-29.md`
- `docs/42_SIGNAL_CATEGORY_TIMEFRAME_AND_NOISE_CONTROL_PLAN_2026-04-29.md`
- `docs/43_CODEX_NEXT_STEPS_SIGNAL_CATEGORY_WORK_NOTE_2026-04-29.md`
- `docs/44_TRADING_DAY_DISCORD_OUTPUT_AUDIT_2026-04-29.md`
- `docs/45_TRADING_DAY_AUDIT_PLAYBOOK.md`
- `docs/46_TRADING_DAY_AUDIT_ADDENDUM_2026-04-29.md`
- `docs/47_COMPLETE_TRADING_DAY_AUDIT_2026-04-29.md`
- `docs/48_VOLUME_ACTIVITY_CATEGORY_IMPLEMENTATION_PLAN_2026-05-01.md`
- `docs/49_AUDIT_PROCESS_HARDENING_INSTRUCTIONS_2026-05-01.md`
- `docs/50_PRACTICAL_5M_MARKET_STRUCTURE_LAYER_2026-05-01.md`
- `docs/51_SHARED_SUPPORT_RESISTANCE_ENGINE_BOUNDARY_2026-05-02.md`
- `docs/52_TRADER_INTELLIGENCE_V2_SHARED_ENGINE_HANDOFF_2026-05-02.md`
- `docs/53_CANDLE_MARKET_STRUCTURE_ENGINE_PLAN_2026-05-02.md`
- `docs/54_CLOSED_MARKET_POST_QUALITY_AND_MONDAY_CHECKLIST_2026-05-02.md`
- `docs/55_TRADER_CONTEXT_LAYERS_IMPLEMENTATION_2026-05-02.md`
- `docs/56_TRADE_IDEA_DATA_QUALITY_AND_SMALL_CAP_CONTEXT_2026-05-02.md`
- `docs/57_TRADE_STORY_STATE_AND_REPLAY_TOOLING_2026-05-02.md`
- `docs/58_NEXT_TRADER_EXPERIENCE_IMPROVEMENT_PLAN_2026-05-02.md`
- `docs/59_TRADER_USEFULNESS_REPLAY_AND_PROVIDER_HEALTH_2026-05-02.md`
- `docs/60_DAILY_TRADER_REVIEW_AND_UI_FRESHNESS_2026-05-02.md`
- `docs/61_MISSED_MEANINGFUL_MOVE_AUDIT_2026-05-02.md`
- `docs/62_SESSION_BEHAVIOR_AND_READINESS_AUDIT_2026-05-02.md`
- `docs/63_CLOSED_MARKET_NEXT_IMPROVEMENTS_EXECUTION_PLAN_2026-05-02.md`
- `docs/64_OPERATIONAL_RELIABILITY_PREFLIGHT_AND_RESTART_READINESS_2026-05-02.md`
- `docs/65_DURABLE_CANDLE_WAREHOUSE_AND_STARTUP_CACHE_PLAN_2026-05-02.md`
- `docs/66_WEBSITE_SHARED_CANDLE_ENGINE_EXECUTION_PLAN_2026-05-03.md`
- `docs/68_CANDLE_INTELLIGENCE_COMPLETION_IMPLEMENTATION_2026-05-03.md`
- `docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md`

## Tests Added Or Changed

Changed test files: 86

Rescue-critical tests:

- `src/tests/candle-as-of-filter.test.ts`
- `src/tests/formal-market-structure.test.ts`
- `src/tests/level-runtime-mode.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`

Other major test areas:

- Alert and Discord tests: `alert-intelligence.test.ts`, `alert-router.test.ts`, `discord-audit-reports.test.ts`, `discord-audited-thread-gateway.test.ts`, `discord-rest-thread-gateway.test.ts`, `discord-thread-cleanup.test.ts`
- Level-system tests: `level-engine.test.ts`, `level-ranking-comparison.test.ts`, `level-runtime-compare-review.test.ts`, `level-store.test.ts`, `level-strength-ranking.test.ts`, `level-surfaced-selection.test.ts`, `level-surfaced-shadow-evaluation.test.ts`, `level-surfaced-validation.test.ts`
- Monitoring/runtime tests: `manual-watchlist-runtime-manager.test.ts`, `manual-watchlist-server.test.ts`, `live-thread-post-policy.test.ts`, `watchlist-monitor.test.ts`, `watchlist-state-persistence.test.ts`, `monitoring-events.test.ts`
- Support/structure/candle tests: `candle-market-structure.test.ts`, `candle-fetch-service.test.ts`, `support-resistance-indicators.test.ts`, `shared-candle-intelligence-foundation.test.ts`, `stable-market-structure.test.ts`, `live-stable-market-structure.test.ts`
- Review/report/replay tests: daily review, replay simulation, missed move audit, provider comparison, session behavior, warehouse volume, trader usefulness, and related reports.

## Biggest Merge Risks

1. PR size and reviewability: 339 files and about 105k insertions is beyond a practical single review unit.
2. Runtime behavior surface: alerts, monitoring, manual watchlist runtime, level selection, support/resistance, market structure, trader context, and Discord posting all change in one branch.
3. Manual watchlist runtime blast radius: `manual-watchlist-runtime-manager.ts` and its test file are among the largest diffs in the PR.
4. Alert and Discord output risk: `alert-router.ts`, `trader-message-language.ts`, and Discord gateway tests changed heavily, while broad `npm test` has known Discord REST snapshot failures documented in `docs/30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`.
5. Level-system dependency coupling: the rescue work depends partly on earlier runtime compare adapter/scoring work, making extraction possible but not automatic.
6. Provider and market-data risk: IBKR, candle fetch/session classification, and the Twelve Data provider file are touched in the same PR.
7. Documentation volume: the docs are useful, but the large narrative/doc sequence can hide runtime changes in review.
8. Dirty local worktree: `git status` shows many unstaged and untracked local files. They are not staged, but the local workspace is noisy and should not be used for accidental follow-up commits without careful staging.

## Should The PR Remain Draft?

Yes. PR #1 should remain draft until it is split or until reviewers explicitly agree to review it as an integration branch rather than a normal merge candidate.

The level-system rescue slice itself is much closer to merge-ready than the whole PR, but the full branch contains many earlier runtime, monitoring, alert, replay, provider, and documentation changes that deserve independent review.

## Should The PR Be Split?

Yes. The recommended split is:

1. Level-system rescue/no-lookahead/parity PR: docs 26-30, candle as-of filtering, formal structure `asOfTimestamp`, support/resistance as-of safety, runtime parity tests, extension/bucket parity remediation, and additive shadow metadata.
2. Runtime compare/surfaced-selection tooling PR: runtime mode plumbing, surfaced selection, ranking comparison, shadow evaluation, validation, and compare review tooling.
3. Alert/Discord/trader-language PR: alert router, language cleanup, Discord gateway and cleanup behavior, thread posting changes, and related tests.
4. Monitoring/manual watchlist PR: manual watchlist runtime manager, live post policy, event detector, watchlist state, runtime UI/server, and monitoring tests.
5. Review/replay/reporting tools PR: audit reports, replay simulators, report scripts, candle warehouse reports, and operational scripts.
6. Documentation-only PRs where possible: changelog, handoffs, roadmap, and workflow docs.

## Can The Rescue Commits Be Cleanly Separated?

Partially.

Clean in history: yes. The rescue commits are identifiable and sequential.

Clean by file: no. Eleven rescue files overlap with pre-rescue work. The riskiest overlaps are `level-engine.ts`, `level-runtime-output-adapter.ts`, `level-types.ts`, `trade-analysis-context.ts`, and the large shared tests.

Practical extraction path: create a new branch from `main`, cherry-pick the rescue commits in order, and resolve only the prerequisite pieces needed for compile/test. If conflicts are too broad, manually replay the no-lookahead helper and tests first, then add runtime parity/enrichment only after the runtime compare adapter prerequisites are isolated.

## Recommended Merge Path

Do not merge PR #1 directly into `main` in its current shape.

Recommended path:

1. Keep PR #1 as a draft integration branch.
2. Create a new branch from `main` for the level-system rescue slice.
3. Cherry-pick or replay the rescue commits starting with `dc6b407`, keeping `runtimeMode old` as default and preserving the no-lookahead and parity gates.
4. Run the focused rescue validations from `docs/30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`.
5. Separately decide whether to update or quarantine the known Discord REST snapshot failures before any full runtime PR merge.
6. Split the earlier runtime compare, monitoring, alert, trader-context, and review tooling changes into smaller PRs with focused reviewers and focused validation.
7. Treat PR #1 as an audit/reference branch until all split PRs land or are intentionally abandoned.

## Final Review Position

The rescue work is coherent and reviewable. The full PR is not yet merge-ready as one unit.

PR #1 should remain draft, should be split, and should not be merged until runtime-critical changes are isolated into smaller reviewable PRs with passing or explicitly quarantined validation.
