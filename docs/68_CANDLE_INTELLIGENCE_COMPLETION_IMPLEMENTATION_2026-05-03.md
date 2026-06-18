# Candle Intelligence Completion Implementation

## Purpose

This file records the first implementation pass from the big-picture candle intelligence plan. It is meant to keep the work grounded in what actually shipped, what remains calibration work, and which parts are shared-engine facts versus Discord presentation policy.

## Implemented In This Pass

### Latest Evidence-Gate Additions

Added after the first implementation pass:

- `npm run candles:regression-gate`
- `npm run candles:dynamic-calibrate`
- `npm run audit:why-no-post`

The regression gate turns generated saved-data cases into a pass/review/fail result. The dynamic calibration report proves opening-range and VWAP/EMA evidence from cached candles around saved posts. The why-no-post proof checks quieter behavior against candle-backed missed-move evidence so suppression can be judged without relying only on post counts.

`npm run audit:eod-verdict` now also folds in first-snapshot, execution-relation, volume, and missed-move evidence. Bulk backfill plans now include provider batches, estimated candles, coalesced trade-request counts, avoided task counts, and largest-task sizing.

### Shared Engine Capability Report

Added:

- `src/lib/review/shared-engine-capability-report.ts`
- `src/scripts/run-shared-engine-capability-report.ts`
- `npm run engine:capabilities`

The command writes:

```text
artifacts/shared-engine-capabilities/shared-engine-capabilities.json
artifacts/shared-engine-capabilities/shared-engine-capabilities.md
```

It inventories the public shared boundary, package subpath, scripts, data dependencies, implemented capabilities, partial capabilities, and planned capabilities.

### Reference Levels

Added:

- `src/lib/support-resistance/reference-levels.ts`
- `context.referenceLevels`

The shared support/resistance context now exposes a stable object for:

- previous day high / low / close
- premarket high / low
- premarket base, defined as the premarket range midpoint
- opening range high / low
- current regular-session high / low
- diagnostics for missing daily, intraday, premarket, opening-range, or current-session data

These are structured market facts. They do not create Discord posts by themselves.

### Gap Structure

Added:

- `src/lib/support-resistance/gap-structure.ts`
- `context.gapStructure`

The first version detects meaningful candle gaps and reports:

- nearest open gap above
- nearest open gap below
- recent gap zones
- filled / unfilled state
- fill timestamp when known
- diagnostics when candles are missing or no meaningful gap is present

This is intentionally diagnostic/shared context first. It should not be used for trader-facing wording until saved-data audits prove the reads are useful.

### Dynamic Level Price Context

`buildDynamicLevelsFromCandles(...)` now can accept `currentPrice` and return optional `priceContext`:

- price versus VWAP
- price versus EMA9 / EMA20
- above/below booleans
- nearest dynamic support candidate
- nearest dynamic resistance candidate

VWAP/EMA remain shared structured facts and are not automatically added to Discord posts.

### Execution / Level Relations

Added:

- `src/lib/support-resistance/execution-level-relations.ts`
- `buildExecutionLevelRelations(...)`

The helper maps a price to support/resistance context and returns:

- nearest support below
- nearest resistance above
- nearest resistance below
- nearest support above
- room above / below
- near support / resistance booleans
- cleared nearest resistance below
- below-nearest-support context
- open-air context
- stacked support / resistance counts
- nearest reference-level match

This is the generic structure math that consumer apps such as `trader-intelligence-v2` should not need to reimplement.

### Warehouse-Backed Shared Builders

Added:

- `src/lib/support-resistance/warehouse-context.ts`
- `buildWarehouseBackedSupportResistanceContextForSymbol(...)`
- `buildWarehouseBackedTradeAnalysisCandleContext(...)`

These use `DurableCandleWarehouseFetchService` so shared consumers can read/write the durable candle warehouse while keeping provider details below the public API.

### Bulk Backfill Planning

Added:

- `src/lib/candle-warehouse/bulk-backfill-planner.ts`
- `planBulkCandleBackfill(...)`
- `planWarehouseMissingCandleBackfill(...)`

The planner dedupes repeated symbol / session / timeframe candle requests for bulk trade imports. It supports `1m`, `5m`, `4h`, and `daily`.

`planWarehouseMissingCandleBackfill(...)` compares that deduped plan against the durable warehouse and returns only missing ranges, coverage evidence, fully covered task counts, missing task counts, and an estimated missing candle count. This is the shared-engine path for future bulk trade imports where repeated symbols should reuse stored candles instead of repeatedly hitting the provider.

### Candle Warehouse Audit

Added:

- `src/lib/review/candle-warehouse-audit.ts`
- `src/scripts/run-candle-warehouse-audit.ts`
- `npm run candles:audit`

The audit reports provider/symbol/timeframe groups, file counts, row counts, duplicate timestamps, invalid OHLC rows, zero-volume rows, and group health.

### Candle Intelligence Calibration

Added:

- `src/lib/review/candle-intelligence-calibration.ts`
- `src/scripts/run-candle-intelligence-calibration.ts`
- `npm run candles:calibrate`

The report reads a saved long-run `discord-delivery-audit.jsonl`, loads matching cached daily / `4h` / `5m` candles from `.validation-cache/candles`, and writes:

```text
candle-intelligence-calibration.json
candle-intelligence-calibration.md
```

It gives each reviewed symbol:

- post count and example saved Discord excerpts
- cached candle counts by timeframe
- `referenceLevels` trust and reasons
- `gapStructure` trust and reasons
- `executionRelations` trust and nearest support/resistance evidence
- inline reference, gap, and relation evidence summaries
- known problem symbol evidence for `CYCU`, `PBM`, `FATN`, `AKAN`, and `CUE`

This is operator-only. It does not add Discord wording.

The command can run one session:

```powershell
npm run candles:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Or all saved long-run sessions:

```powershell
npm run candles:calibrate -- --all-sessions
```

### Candle Import Readiness

Added:

- `src/lib/review/candle-import-readiness-report.ts`
- `src/scripts/run-candle-import-readiness-report.ts`
- `npm run candles:import-readiness`

The report builds trade proxies from saved Discord audit rows, asks the durable warehouse which symbol/session/timeframe ranges are already covered, and writes:

```text
candle-import-readiness.json
candle-import-readiness.md
```

This is the first operator report for the future website/bulk-import workflow. It does not fetch provider data by itself; it shows what would need to be fetched and what the warehouse can already reuse.

### Dry-Run-First Warehouse Backfill

Added:

- `src/lib/candle-warehouse/backfill-executor.ts`
- `src/lib/review/candle-warehouse-backfill-report.ts`
- `src/scripts/run-candle-warehouse-backfill.ts`
- `npm run candles:backfill`

The executor takes the missing-range plan and can either:

- dry-run the tasks without touching the provider
- explicitly execute provider fetches and write returned candles into the durable warehouse

Safety controls:

- dry-run is the default
- `--execute` or `--mode execute` is required to fetch and write
- `--max-tasks` limits execution scope
- `--concurrency` controls parallel provider requests
- `--throttle-ms` spaces out provider calls

This provider-protection layer belongs in `levels-system`, not in consumer apps.

### Shared Freshness Diagnostics

Added `freshnessStatus` to shared fetch summaries:

- symbol context `fetches[]`
- trade-analysis `tradeWindow.fetch`

Allowed values:

- `fresh`
- `usable`
- `partial`
- `stale`
- `missing`

This lets `trader-intelligence-v2` or any future website tool show analysis readiness without learning provider-specific validation flags.

### Warehouse-First Shared Builders

Added:

- `buildDefaultSupportResistanceContextForSymbol(...)`
- `buildDefaultTradeAnalysisCandleContext(...)`

These use `data/candles` and warehouse `read_write` mode by default. Direct candle-array builders remain available for tests, fixtures, and advanced callers. Consumer apps should prefer the default or warehouse-backed path unless they intentionally provide their own normalized candles.

### Warehouse Volume Context

Added:

- `src/lib/candle-warehouse/warehouse-volume-context.ts`
- `buildVolumeActivityContextFromWarehouseCandles(...)`
- `buildWarehouseVolumeActivityContext(...)`

The first version reads stored `5m` candles, builds a historical baseline, classifies relative volume by session bucket, adds dollar-volume/liquidity context, and records whether price is close to support/resistance. It is structured/operator evidence first and must not create standalone Discord posts.

### Storage Policy Threshold

Added `assessCandleWarehouseStoragePolicy(...)` so the JSONL-to-database threshold is explicit in code:

- JSONL is fine for local testing and early single-operator use.
- SQLite is recommended around 5M rows, 10K+ monthly imported trades, or repeated large symbol/session scans.
- A service-backed warehouse is recommended around 25M+ rows or multi-user/concurrent website usage.

### Structure And First-Post Audit Tightening

The market-structure replay audit now reports immaterial transition counts and flags `small_cap_immaterial_structure_flips` when small price movement causes noisy structure changes. The session behavior audit also scores first-post trader maps more strictly, including practical support/resistance context and penalties for unproven “no resistance” wording or unanchored penny-risk language.

### Follow-Up Completion Pass - 2026-05-03

Added:

- `src/lib/review/warehouse-volume-activity-report.ts`
- `src/scripts/run-warehouse-volume-activity-report.ts`
- `npm run volume:warehouse`
- `src/lib/review/first-snapshot-trade-map-audit.ts`
- `src/scripts/run-first-snapshot-trade-map-audit.ts`
- `npm run audit:first-snapshots`

The new warehouse volume replay report reads saved Discord alert rows and cached `5m` candles, then separates volume reads that may help an already-posted alert from reads that should stay operator-only because they are stale, unreliable, normal, or too thin. It does not create standalone Discord volume posts.

The new first-snapshot trade-map audit scores the first snapshot per symbol independently from broader session behavior. It flags missing practical support/resistance context, weak first-post structure, unanchored tiny-risk wording, and advisory language that should not be trader-facing.

`buildTradeAnalysisCandleContext(...)` now also returns `executionRelations[]`. Each execution relation includes generic market facts for nearest support/resistance relation, room above/below, stacked barriers, nearest reference-level match, price versus VWAP/EMA9/EMA20, market-structure state/confidence, and no-lookahead diagnostics when an execution is after `asOfTimestamp`.

Backfill reports now include provider-readiness labels so bulk import planning can distinguish safe dry-run fetch candidates, refreshed ranges, and provider-risk failures.

### Second Follow-Up Completion Pass - 2026-05-03

Added:

- `src/lib/review/bulk-candle-import-simulation.ts`
- `src/scripts/run-bulk-candle-import-simulation.ts`
- `npm run candles:bulk-sim`
- `src/lib/review/execution-relation-replay-report.ts`
- `src/scripts/run-execution-relation-replay-report.ts`
- `npm run audit:execution-relations`
- `src/lib/review/provider-comparison-readiness-report.ts`
- `src/scripts/run-provider-comparison-readiness-report.ts`
- `npm run candles:provider-compare`
- `src/lib/review/candle-intelligence-regression-pack.ts`
- `src/scripts/run-candle-intelligence-regression-pack.ts`
- `npm run candles:regression-pack`

The bulk import simulation creates a synthetic months-style trade import and compares naive provider calls with deduped symbol/session/timeframe backfill tasks. The bulk planner now coalesces same-symbol/session/timeframe requests across different execution timestamps, widening the requested range instead of creating several provider tasks for the same stock and day.

The execution relation replay report reads saved Discord posts, loads cached daily / `4h` / `5m` candles, rebuilds support/resistance context as of the saved post timestamp, and reports whether nearest support/resistance, room, reference-level, VWAP/EMA, and market-structure facts were available. This helps audit cases where a post lacked next-level context or where the audit cannot prove the relation because cached candles are missing.

The warehouse volume replay report now includes interaction buckets: `expanding_into_resistance`, `activity_pickup_on_reclaim`, `fading_while_retesting`, `thin_activity_chop`, `normal_or_unhelpful`, and `stale_or_unreliable`. This makes volume calibration more evidence-driven while keeping volume out of Discord unless it is reliable, non-thin, attached to an existing alert, and materially changes the interpretation.

The provider comparison readiness report compares cached provider data before a future provider switch. It reports coverage, latest-close drift, VWAP/EMA drift, and basic support/resistance count drift where both providers have enough daily and `4h` candles.

The regression pack generator turns weak first snapshots, useful/hidden volume cases, execution relation gaps, and missing-forward-resistance candidates into reusable audit cases. These are not live Discord outputs; they are the saved-data cases future post-policy and candle-engine work should keep checking.

## Public Boundary Updates

New exports from:

```ts
levels-system-phase1/support-resistance-engine
```

include:

```ts
buildReferenceLevels
buildGapStructure
buildExecutionLevelRelations
buildDefaultSupportResistanceContextForSymbol
buildDefaultTradeAnalysisCandleContext
buildWarehouseBackedSupportResistanceContextForSymbol
buildWarehouseBackedTradeAnalysisCandleContext
buildWarehouseVolumeActivityContext
buildVolumeActivityContextFromWarehouseCandles
assessCandleWarehouseStoragePolicy
planBulkCandleBackfill
planWarehouseMissingCandleBackfill
buildSharedEngineCapabilityReport
TradeAnalysisExecutionRelationFact
TradeAnalysisExecutionDynamicRelations
```

`SupportResistanceContext` now includes:

```ts
referenceLevels
gapStructure
dynamicLevels.priceContext
```

New operator/report commands now include:

```powershell
npm run candles:bulk-sim
npm run audit:execution-relations -- <session-folder-or-discord-delivery-audit.jsonl>
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data
npm run candles:regression-pack -- <session-folder-or-discord-delivery-audit.jsonl>
```

## Verification

Focused checks passed:

```powershell
npx tsx --test src/tests/shared-candle-intelligence-foundation.test.ts src/tests/support-resistance-shared-api.test.ts src/tests/support-resistance-indicators.test.ts src/tests/durable-candle-warehouse.test.ts
npm run build
npm run engine:capabilities
npm run candles:audit -- data/candles
npm run candles:calibrate -- --max-symbols 12
npm run candles:calibrate -- --all-sessions
npm run candles:import-readiness -- --max-trades 20 --timeframes daily,4h,5m,1m
npm run candles:backfill -- --max-tasks 8 --timeframes 5m
npx tsx --test src/tests/bulk-candle-import-simulation.test.ts src/tests/execution-relation-replay-report.test.ts src/tests/warehouse-volume-activity-report.test.ts src/tests/provider-comparison-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts src/tests/shared-candle-intelligence-foundation.test.ts
npm test
npm run candles:bulk-sim -- --symbols 8 --sessions 10 --trades-per-symbol-session 4 --timeframes 5m,1m --out-dir artifacts\bulk-candle-import-simulation-smoke
npm run audit:execution-relations -- --all-sessions --max-symbols 8 --out-dir artifacts\execution-relation-replay-smoke
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data --max-symbols 8 --out-dir artifacts\provider-comparison-readiness-smoke
npm run candles:regression-pack -- --all-sessions --max-cases-per-type 5 --out-dir artifacts\candle-intelligence-regression-pack-smoke
```

`npm run candles:audit -- data/candles` currently reports zero groups when no durable warehouse rows exist yet. That is expected for a fresh local warehouse.

`npm run candles:calibrate -- --max-symbols 12` ran against the latest saved long-run session and reviewed 12 symbols: 6 trusted reference sets, 6 watch reference sets, 0 broken reference sets, 12 experimental gap structures, 2 relation warnings, and 0 missing candle symbols.

`npm run candles:calibrate -- --all-sessions` reviewed 57 symbols across 74 saved audit files: 12 trusted reference sets, 18 watch reference sets, 27 broken reference sets, 30 experimental gap structures, 27 broken gap structures, 23 trusted relation sets, 7 relation warnings, 27 broken relation sets, 27 missing candle symbols, and all 5 known problem symbols tagged.

`npm run candles:import-readiness -- --max-trades 20 --timeframes daily,4h,5m,1m` reviewed 18 latest-session trade proxies: 72 planned tasks, 0 fully covered tasks, 72 missing tasks, and 24,552 estimated missing candles. This confirms the report works and that `data/candles` needs actual backfill population before bulk imports can reuse it.

The second follow-up verification added:

- targeted new report suite: 16 passing, 0 failing
- full `npm test`: 608 passing, 0 failing
- bulk simulation smoke: 320 trade rows, 640 naive tasks, 160 deduped tasks, 480 avoided provider tasks
- execution relation replay smoke: 1,150 saved posts reviewed, 187 valid relation samples, 34 useful-context candidates, 963 needs-evidence cases
- provider comparison smoke: 8 symbols reviewed, no common `ibkr` / `twelve_data` cached coverage found in this local cache sample
- regression pack smoke: 25 cases generated from all saved sessions with 5 weak snapshots, 5 volume-hidden examples, and 5 execution-missing-evidence examples

## Still Remaining From The Big Plan

- Expand `referenceLevels`, `gapStructure`, and `executionRelations` calibration into broader all-symbol saved-data reports and regression packs.
- Add provider comparison reports before switching away from IBKR.
- Promote warehouse-backed builders into the default website-tooling path after live/provider validation.
- Keep volume/activity quiet in Discord until warehouse-backed volume baselines are proven with broader real data.
- Keep market-structure trader wording guarded until saved-data calibration shows it improves posts.
- Add anchored VWAP only after a clear anchor policy exists.
- Add candle pattern recognition only as operator-only evidence first.
