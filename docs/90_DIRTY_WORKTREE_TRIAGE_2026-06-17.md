# Dirty Worktree Triage - 2026-06-17

Purpose: inventory the long-running uncommitted worktree and identify a safe path to turn intentional work into final committed versions without accidentally committing generated artifacts or stale experiments.

## Current State

- Tracked modified/deleted files: 118
- Untracked files: 110
- Tracked diff size: about 18,141 insertions and 852 deletions
- Build status after current working tree changes: pass
- Focused watchlist narration tests after today's fix: pass

Commands run:

```powershell
git status --short
git diff --stat
git diff --numstat
git ls-files --others --exclude-standard
npx tsx --test src/tests/live-thread-post-policy.test.ts
npx tsx --test src/tests/live-post-replay-simulator.test.ts src/tests/manual-watchlist-runtime-manager.test.ts
npm run build
```

## Important Safety Note

Do not use `git add .` in this repository right now.

The working tree contains months of mixed work: source code, tests, docs, generated/warehouse data, scripts, and today's targeted watchlist narration fix. Some files contain both older uncommitted changes and the new changes from today. A final version should be assembled with intentional staging, probably by commit group and sometimes by hunk.

## Commit Groups

### Group 1 - Today's Watchlist Over-Narration Fix

Recommendation: ready to commit, but stage carefully because these files already had older uncommitted edits before today's changes.

Files:

- `src/lib/monitoring/live-thread-post-policy.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/review/live-post-replay-simulator.ts`
- `src/tests/live-thread-post-policy.test.ts`

What it does:

- Suppresses repeated same-area story posts unless price genuinely expands.
- Coalesces immediate follow-through posts after a triggering alert.
- Keeps optional recap/continuity/context posts quiet during dense critical bursts.
- Keeps the replay simulator aligned with live runtime policy.

Verification:

- `npx tsx --test src/tests/live-thread-post-policy.test.ts`
- `npx tsx --test src/tests/live-post-replay-simulator.test.ts src/tests/manual-watchlist-runtime-manager.test.ts`
- `npm run build`

Staging guidance:

- Best: `git add -p` for the exact hunks from today's narration fix.
- Acceptable only if older edits in these files are already intended: stage the four whole files.

### Group 2 - Formal / Stable Market Structure Runtime

Recommendation: likely intentional feature work; needs review as a coherent commit group.

Representative files:

- `src/lib/monitoring/live-stable-market-structure.ts`
- `src/lib/monitoring/live-formal-market-structure.ts` (untracked)
- `src/lib/monitoring/market-structure-story-memory.ts` (untracked)
- `src/lib/structure/index.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/tests/live-formal-market-structure.test.ts` (untracked)
- `src/tests/stable-structure-discord-alignment.test.ts`
- `src/tests/market-structure-story-memory.test.ts` (untracked)
- `src/tests/market-structure-language.test.ts`

Why it matters:

This appears to add or extend BOS/CHOCH, stable structure memory, and structure delivery controls. It is central runtime behavior, so it should not be bundled casually with unrelated candle warehouse or doc work.

Suggested validation before commit:

```powershell
npx tsx --test src/tests/live-formal-market-structure.test.ts src/tests/stable-structure-discord-alignment.test.ts src/tests/market-structure-story-memory.test.ts src/tests/market-structure-language.test.ts src/tests/watchlist-monitor.test.ts
```

### Group 3 - Discord / Alert Output Contract

Recommendation: likely intentional and tightly coupled to Group 2 and Group 1; review before committing.

Representative files:

- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/discord-audited-thread-gateway.ts`
- `src/lib/alerts/discord-rest-thread-gateway.ts`
- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/alerts/trader-message-language.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/discord-audited-thread-gateway.test.ts`
- `src/tests/discord-rest-thread-gateway.test.ts`

Why it matters:

This is user-facing Discord behavior and audit metadata. It likely carries the fields used by today's audit, including message kinds, market-structure visibility, delivery audit fields, and wording boundaries.

Suggested validation:

```powershell
npx tsx --test src/tests/alert-intelligence.test.ts src/tests/alert-router.test.ts src/tests/discord-audited-thread-gateway.test.ts src/tests/discord-rest-thread-gateway.test.ts
```

### Group 4 - Candle Warehouse / Market Data / Provider Cleanup

Recommendation: separate commit group; needs careful review because it includes provider deletion.

Representative files:

- `src/lib/candle-warehouse/backfill-executor.ts`
- `src/lib/candle-warehouse/bulk-backfill-planner.ts`
- `src/lib/candle-warehouse/durable-candle-warehouse.ts`
- `src/lib/candle-warehouse/index.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/market-data/provider-factory.ts`
- `src/lib/market-data/provider-priority.ts`
- `src/lib/market-data/providers/twelve-data-historical-candle-provider.ts` (deleted)
- `src/lib/market-data/candle-fetch-service.ts`
- `src/lib/market-data/candle-session-classifier.ts`
- `src/tests/durable-candle-warehouse.test.ts`
- `src/tests/ibkr-historical-candle-provider.test.ts`
- `src/tests/provider-factory.test.ts`

Why it matters:

This looks like a provider strategy change plus warehouse backfill improvements. The deletion of the Twelve Data provider is a high-signal change that should be explicitly accepted before finalizing.

Suggested validation:

```powershell
npx tsx --test src/tests/durable-candle-warehouse.test.ts src/tests/ibkr-historical-candle-provider.test.ts src/tests/candle-fetch-service.test.ts src/tests/provider-factory.test.ts
```

### Group 5 - Review / Audit Tooling Expansion

Recommendation: likely intentional; commit after tests and a quick report-output smoke check.

Representative tracked files:

- `src/lib/review/all-symbol-stress-report.ts`
- `src/lib/review/candle-import-readiness-report.ts`
- `src/lib/review/candle-intelligence-regression-pack.ts`
- `src/lib/review/candle-warehouse-backfill-report.ts`
- `src/lib/review/daily-trader-review.ts`
- `src/lib/review/end-of-day-symbol-verdict.ts`
- `src/lib/review/execution-relation-replay-report.ts`
- `src/lib/review/first-snapshot-trade-map-audit.ts`
- `src/lib/review/live-post-replay-simulator.ts`
- `src/lib/review/missed-meaningful-move-audit.ts`
- `src/lib/review/provider-comparison-readiness-report.ts`
- `src/lib/review/session-behavior-audit.ts`

Representative untracked files:

- `src/lib/review/advanced-candle-context-report.ts`
- `src/lib/review/candle-backfill-priority-report.ts`
- `src/lib/review/candle-backfill-stage-manifest.ts`
- `src/lib/review/candle-import-safety-report.ts`
- `src/lib/review/dynamic-reference-calibration-report.ts`
- `src/lib/review/ladder-gap-level-audit.ts`
- `src/lib/review/market-structure-calibration-report.ts`
- `src/lib/review/market-structure-delivery-audit.ts`
- `src/lib/review/market-structure-outcome-calibration.ts`
- `src/lib/review/startup-cache-readiness-report.ts`
- `src/lib/review/support-resistance-calibration-report.ts`
- `src/lib/review/trader-story-quality-review.ts`
- `src/lib/review/why-no-post-replay-proof.ts`

Why it matters:

This is a large expansion of the audit ecosystem. It is probably the source of many useful reports already used in this session, but it should be committed as tooling, not mixed into core runtime changes.

Suggested validation:

```powershell
npx tsx --test src/tests/*audit*.test.ts src/tests/*review*.test.ts src/tests/live-post-replay-simulator.test.ts
```

If glob behavior is awkward on PowerShell, run the specific audit test files listed in `git status`.

### Group 6 - Level Engine / Ranking / Forward Ladder

Recommendation: separate core-engine commit; validate with level tests.

Representative files:

- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-scorer.test.ts` (untracked)
- `src/tests/level-quality-clean-break-classifier.test.ts` (untracked)

Suggested validation:

```powershell
npx tsx --test src/tests/level-engine.test.ts src/tests/level-scorer.test.ts src/tests/level-quality-clean-break-classifier.test.ts
```

### Group 7 - Trader Context / Stock Context / AI Clean Read / Trade Plan Review

Recommendation: separate feature group, likely product-facing.

Representative files:

- `src/lib/trader-context/trader-context.ts`
- `src/lib/stock-context/finnhub-thread-preview.ts`
- `src/lib/ai/trader-commentary-service.ts`
- `src/runtime/ai-clean-read.ts` (untracked)
- `src/runtime/ai-clean-read-page.ts` (untracked)
- `src/runtime/trade-plan-review.ts` (untracked)
- `src/runtime/trade-plan-review-page.ts` (untracked)
- `src/tests/ai-clean-read.test.ts` (untracked)
- `src/tests/trade-plan-review.test.ts` (untracked)
- `src/tests/trader-context.test.ts`
- `src/tests/trader-commentary-service.test.ts`

Suggested validation:

```powershell
npx tsx --test src/tests/ai-clean-read.test.ts src/tests/trade-plan-review.test.ts src/tests/trader-context.test.ts src/tests/trader-commentary-service.test.ts
```

### Group 8 - Scripts / CLI Surface / Package Scripts

Recommendation: commit only after mapping scripts to corresponding feature groups.

Files:

- `package.json`
- `scripts/start-manual-watchlist-long-run.ps1`
- `scripts/cleanup-stale-test-runners.cjs` (untracked)
- Many `src/scripts/run-*.ts` files, including new scripts for candle safety, backfill, market-structure audits, universes, specific ticker replay, and why-no-post proof.

Why it matters:

`package.json` probably exposes the new audit/backfill commands. It should be committed with the tools it references, not separately.

### Group 9 - Documentation / Plans / Handoffs

Recommendation: optional but likely useful; can be one or more docs-only commits.

Representative files:

- `README.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/29_LONG_RUN_TESTING_WORKFLOW.md`
- `docs/30_SIGNAL_QUALITY_ROADMAP.md`
- `docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md`
- `docs/70_*` through `docs/89_*` untracked docs
- Universe docs such as `docs/nasdaq-under-100m-marketcap-watchlist.md`, `docs/nyse-marketcap-universe.md`, `docs/futures-universe.md`
- `handoff.md` (untracked)

Suggested handling:

- Commit stable operating docs and handoffs.
- Do not mix docs with runtime code unless the docs directly describe the code change.

### Group 10 - Data / Generated Universe Files

Recommendation: decide intentionally. These may be source data, generated snapshots, or both.

Files:

- `data/futures-universe/futures-current-universe.json`
- `data/nasdaq-universe/nasdaq-current-universe.json`
- `data/nyse-universe/nyse-current-universe.json`

Questions before commit:

- Are these intended as tracked deterministic universe snapshots?
- Are they generated by scripts and reproducible?
- Are they too large or too temporal for git?

## High-Risk Items To Review Before Any Commit

- Deleted provider: `src/lib/market-data/providers/twelve-data-historical-candle-provider.ts`
- Provider priority/factory changes: `src/lib/market-data/provider-factory.ts`, `src/lib/market-data/provider-priority.ts`
- Huge runtime manager diff: `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- Huge alert router diff: `src/lib/alerts/alert-router.ts`
- Huge test diff: `src/tests/manual-watchlist-runtime-manager.test.ts`, `src/tests/alert-router.test.ts`
- Generated-looking data under `data/`

## Recommended Finalization Order

1. Commit today's watchlist over-narration fix as a small, focused commit using hunk staging.
2. Commit the formal/stable market-structure runtime and its tests.
3. Commit alert/Discord output contract changes.
4. Commit candle warehouse/provider changes after explicit review of the provider deletion.
5. Commit audit/review tooling and scripts together with `package.json` script additions.
6. Commit docs and universe snapshots only after deciding what should be tracked.

## Current Confidence

- Local build passes.
- Focused policy/runtime/replay tests for today's fix pass.
- The complete dirty worktree is too large to declare final solely from this triage.

This repo is recoverable and can be finalized, but it needs intentional staged commits by subsystem.
