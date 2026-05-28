# Levels System Vs Journal Architecture Boundary Audit

Scope: documentation-only audit  
Levels-system branch inspected: `main` at `7c4338e`  
Journal repo inspected read-only: `traderslink-bot/traderslink-trader-improvement-system`

## Executive Summary

The trading journal app already has substantial execution, trade-analysis, support/resistance, market-structure, behavior-analysis, and coaching modules. It is not an empty consumer waiting for levels-system to invent the journal layer.

The journal also already consumes `levels-system-phase1` through a vendored file dependency:

- `package.json` depends on `levels-system-phase1: file:vendor/levels-system-phase1`
- `next.config.ts` marks `levels-system-phase1` as a server external package
- journal code imports `levels-system-phase1/support-resistance-engine`
- journal support/resistance code maps `FinalLevelZone` and shared engine output into journal-owned `StructuralLevel`, `ExecutionLevelRelation`, and `PatternInputSupportResistanceContext` contracts

That means the right boundary is not "levels-system owns the trading journal." The right boundary is:

- levels-system owns market data, candle-close/no-lookahead filtering, support/resistance levels, market structure facts, dynamic level facts, session facts, volume facts, and optional factual execution snapshots derived from already-supplied level output
- the journal app owns trade ingestion, execution timelines, pattern detection, behavior detection, scoring, coaching, summaries, UI, and journal-specific interpretation

`ExecutionMarketContextSnapshot` can remain in levels-system only if it is treated as a shared, factual, level-and-market-facts contract. It should not become the journal app's behavior-analysis or coaching layer inside levels-system.

Do not remove `src/lib/journal-context/execution-market-context.ts` immediately. It is currently non-integrated, tested, and aligned with the fact-only/no-lookahead rescue architecture. The safer next step is to decide whether to formalize it as a shared exported contract or move it to the journal repo with a replacement consumer boundary.

## Evidence Reviewed

Levels-system source reviewed:

- `package.json`
- `docs/35_TRADING_JOURNAL_EXECUTION_CONTEXT_PLAN.md`
- `src/lib/journal-context/execution-market-context.ts`
- `src/lib/journal-context/index.ts`
- `src/tests/execution-market-context.test.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/market-context/index.ts`
- `src/lib/session/index.ts`
- `src/lib/volume/index.ts`

Journal repo source reviewed:

- `package.json`
- `next.config.ts`
- `vendor/levels-system-phase1/package.json`
- `src/lib/trade-analysis-engine.ts`
- `src/lib/trade-analysis/run-trade-analysis.ts`
- `src/lib/trade-analysis/request/trade-analysis-request-contract.ts`
- `src/lib/trade-analysis/summary/build-trade-analysis-summary.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/levels-system-adapter.ts`
- `src/lib/support-resistance/levels-system-runtime-options.ts`
- `src/lib/raw-trade-timeline/builders/create-raw-trade-timeline.ts`
- `src/lib/raw-trade-timeline/builders/create-raw-trade-timeline-with-levels-system-candles.ts`
- `src/lib/raw-trade-timeline/types/raw-trade-timeline-build-result.ts`
- `src/lib/raw-trade-timeline/types/execution-context-window.ts`
- `src/lib/raw-trade-timeline/types/execution-level-relation.ts`
- `src/lib/raw-trade-timeline/types/structural-context-window.ts`
- `src/lib/raw-trade-timeline/types/structural-level.ts`
- `src/lib/execution-feedback/*`
- `src/lib/behavior-analysis/*`
- `src/lib/coaching/*`

## 1. Existing Journal Execution And Market Modules

Yes, the journal repo already has these modules.

Execution context and raw timeline:

- `src/lib/raw-trade-timeline/types/execution-context-window.ts`
- `src/lib/raw-trade-timeline/windows/build-execution-context-windows.ts`
- `src/lib/raw-trade-timeline/types/execution-level-relation.ts`
- `src/lib/raw-trade-timeline/derived/build-execution-derived-signals.ts`
- `src/lib/raw-trade-timeline/derived/build-execution-local-structure-signals.ts`
- `src/lib/raw-trade-timeline/builders/create-raw-trade-timeline.ts`
- `src/lib/raw-trade-timeline/builders/create-raw-trade-timeline-with-levels-system-candles.ts`

Execution analysis, behavior, and coaching:

- `src/lib/trade-analysis-engine.ts`
- `src/lib/trade-analysis/*`
- `src/lib/execution-feedback/*`
- `src/lib/behavior-analysis/*`
- `src/lib/coaching/*`

Support/resistance and market structure:

- `src/lib/support-resistance/*`
- `src/lib/support-resistance/levels-system-adapter.ts`
- `src/lib/support-resistance/market-structure-audit/*`
- `src/lib/raw-trade-timeline/types/structural-level.ts`
- `src/lib/raw-trade-timeline/types/structural-context-window.ts`

The local journal support/resistance builder is explicitly described as legacy comparison code. Its file header says app-facing analysis must get support/resistance, VWAP, EMA, and candle-structure context from levels-system.

## 2. Journal Imports From Levels-System

Yes. The journal imports `levels-system-phase1/support-resistance-engine` directly.

Observed consumers include:

- `src/lib/support-resistance/levels-system-adapter.ts`
- `src/lib/support-resistance/levels-system-runtime-options.ts`
- `src/lib/raw-trade-timeline/builders/create-raw-trade-timeline-with-levels-system-candles.ts`
- `src/lib/raw-trade-timeline/types/raw-trade-timeline-build-result.ts`
- `src/lib/trade-analysis/request/trade-analysis-request-contract.ts`
- `src/lib/support-resistance/market-structure-audit/build-experimental-market-structure-audit.ts`
- several integration tests and fixtures under `src/lib/support-resistance`, `src/lib/raw-trade-timeline`, and `src/lib/trader-analytics`

The journal also has:

- `package.json`: `levels-system-phase1` from `file:vendor/levels-system-phase1`
- `next.config.ts`: `serverExternalPackages: ["levels-system-phase1"]`
- `package.json` scripts such as `compare:levels-system` and `verify:levels-system`

The vendored journal package currently exposes only:

- `levels-system-phase1/support-resistance-engine`
- `levels-system-phase1/package.json`

It does not currently expose `journal-context`, `market-context`, `session`, `volume`, or `execution-market-context` subpaths.

## 3. Is Levels-System Intended As A Shared Package Or Service?

Yes, but the package boundary is only partially formalized.

The journal already treats levels-system as a shared package for support/resistance and candle-context work. The journal adapter calls shared levels-system functions and maps the result into journal-owned contracts.

However, the latest levels-system source package inspected here is still `private: true` and its source `package.json` does not currently define the same public `exports` contract seen in the journal vendored package. That is an architecture/package hygiene gap.

Current practical state:

- levels-system is intended to be the shared source of support/resistance, candle, market-structure, dynamic-level, and market-fact truth
- the journal consumes a vendored build of levels-system through `levels-system-phase1/support-resistance-engine`
- the new rescue-phase modules are not yet reflected as public journal-consumable subpath exports
- the journal should not import arbitrary levels-system internals unless a stable package export is created

## 4. Where Should ExecutionMarketContextSnapshot Live?

Recommendation: keep it in levels-system only if it is explicitly scoped as a shared factual snapshot contract over `LevelEngineOutput` and market facts. Do not let it become a journal behavior, scoring, grading, or coaching layer.

Why levels-system can own the factual contract:

- `ExecutionMarketContextSnapshot` directly depends on `LevelEngineOutput`, `FinalLevelZone`, `enrichedAnalysis`, `SessionMarketFacts`, `VolumeMarketFacts`, `VolumeShelf`, `MarketContextProfile`, and `MarketContextFactsBundle`
- those are levels-system-owned contracts
- the helper finds nearest supplied levels without calling LevelEngine or generating new levels
- the helper preserves VWAP and shelves as facts-only metadata
- the helper preserves no-lookahead safety flags from supplied facts
- the journal already consumes levels-system as the shared market context source

Why the journal should own later interpretation:

- the journal already owns execution timelines, pattern input, pattern detection, behavior analysis, execution feedback, scoring, coaching, and UI
- trade-specific labels such as "chased entry", "panic sold", "gave back profit", "good add", or "bad exit" are journal product concepts, not support/resistance engine concepts
- journal-specific summary contracts already separate market structure as observational and not used for scoring

The current file name `src/lib/journal-context/execution-market-context.ts` is boundary-blurry. A future cleanup may rename or export it as a neutral shared contract such as `execution-context` or `trade-review-context`, or move it into the journal repo if the journal needs to own the whole execution snapshot shape.

## 5. Should docs/35 Stay, Move, Or Be Removed?

Recommendation: keep `docs/35_TRADING_JOURNAL_EXECUTION_CONTEXT_PLAN.md` in levels-system for now, but treat this audit as a boundary correction.

Reason:

- the doc records the rationale for the first execution-context phase
- it correctly emphasizes no-lookahead, fact-only inputs, no grading, no coaching, no P/L, and no LevelEngine calls inside the builder
- it is now useful as shared-contract planning history

But it should not be the only plan used for journal implementation. If the next phase is journal behavior or coaching, that next plan belongs in the journal repo. If the next phase is a package export for factual execution snapshots, that plan can stay in levels-system.

Do not remove `docs/35` now. Removing it would erase useful architectural intent before a replacement boundary decision exists.

## 6. Should src/lib/journal-context/execution-market-context.ts Stay, Move, Or Be Removed?

Recommendation: do not remove it now.

Near-term status:

- keep it in levels-system as non-integrated, factual shared-contract code
- do not wire it into LevelEngine default output
- do not wire it into alerts, monitoring, trader-context, Discord, or journal behavior
- do not add trade grading or coaching there

Next decision:

- if levels-system is formalized as the shared package, expose this through a stable public subpath and let the journal import it deliberately
- if the journal should own the exact snapshot contract, move the module and tests into the journal repo in a separate migration PR, then remove it from levels-system only after the journal replacement exists

The file should not be deleted as a cleanup shortcut while there is no replacement contract and no migration plan.

## 7. Risks Of Removing It Now

Removing `src/lib/journal-context/execution-market-context.ts` now would create avoidable risk:

- it would delete tested nearest-level and factual execution snapshot helpers that are aligned with the rescue-phase no-lookahead/facts-only architecture
- it would invalidate `src/tests/execution-market-context.test.ts`
- it would make `docs/35` partially stale without replacing the boundary plan
- it would remove a potential shared contract before the journal repo has an equivalent
- it could cause churn if the journal soon needs a typed bridge from `LevelEngineOutput` to execution-time snapshots
- it could hide the real packaging issue, which is that the journal currently consumes only the `support-resistance-engine` export

The main risk is not that the module changes current runtime behavior. It does not appear to be integrated into current runtime output. The risk is deleting a contract candidate before deciding where the contract belongs.

## 8. Safest Next Step

Safest next step: keep the current module and docs untouched, then make an explicit boundary decision before any removal or integration.

Recommended sequence:

1. Confirm whether levels-system should continue as a vendored shared package or become a cleaner package/service boundary.
2. Decide whether factual execution snapshots are part of the shared levels-system contract.
3. If yes, add a public package export for the factual snapshot helper and update journal integration tests to import it through that export.
4. If no, copy/move the execution snapshot module and tests into the journal repo, adapt imports to journal-owned contracts, then remove the levels-system copy in a separate cleanup PR.
5. Keep journal behavior analysis, scoring, coaching, P/L, giveback, and UI in the journal repo either way.
6. Do not merge a remove-only cleanup until the journal has a replacement path or the team explicitly decides the snapshot work is not needed.

There is a remote branch named `cleanup/remove-journal-context-from-levels-system` pointing at the same inspected main commit during this audit. Before taking any cleanup action, inspect the intended cleanup branch/PR contents and make sure it is not only removing the contract without addressing the journal boundary.

## Recommended Boundary

Levels-system should own:

- candle-fetching and candle-close filtering
- `asOfTimestamp` safety
- support/resistance generation and runtime transport
- market structure facts
- dynamic level facts such as VWAP and EMAs as facts
- session facts
- volume facts
- volume shelves as facts
- optional factual execution snapshot helpers that operate on already-built `LevelEngineOutput`

The journal should own:

- broker/import ingestion
- raw execution timeline construction
- trade lifecycle state
- PatternInput construction
- pattern detection and normalization
- execution feedback
- behavior analysis
- scoring and grading
- coaching output
- journal summaries
- UI and API routes

The shared interface should be explicit. The journal should consume levels-system through stable package exports, not copied internals or unexported source paths.

## Final Recommendation

Do not remove `docs/35` or `src/lib/journal-context/execution-market-context.ts` in this moment.

The safest merge path is:

- leave the existing factual helper in levels-system as an unused shared-contract candidate
- create a follow-up architecture task to either export it as part of levels-system or migrate it into the journal repo
- keep all behavior, scoring, coaching, and product interpretation in the journal repo
- avoid any cleanup PR that removes the module before the package boundary is settled
