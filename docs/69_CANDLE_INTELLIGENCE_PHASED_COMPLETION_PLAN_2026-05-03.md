# Candle Intelligence Phased Completion Plan

## What This File Is For

This is the working execution plan for completing the candle-data, support/resistance, market-structure, VWAP/EMA, volume, and trader-context side of `levels-system`.

It exists so future Codex work does not stop after a small foundation pass. Each phase below must be treated as a complete implementation target: code, tests, audits, docs, and verification. If a phase cannot be fully completed because it needs live market data, Codex should complete everything possible with saved data and clearly record the exact live validation still needed.

The current app has two product surfaces in one repo:

- the Discord/manual-watchlist app
- the shared candle intelligence engine for future TraderLink website tools and `trader-intelligence-v2`

The shared engine owns candle fetching, durable candle storage, normalization, support/resistance, VWAP/EMA, market structure, volume/activity, trader context, execution-level relation facts, and diagnostics.

Discord remains the live product/testing surface. Discord posts must stay trader-view only, long-biased, observational, and non-instructional.

## Global Rules

- Do not add standalone Discord post categories for new candle-derived context.
- Build structured market facts first.
- Audit the facts hard with saved data before making them trader-facing.
- Do not hide real support/resistance levels to reduce noise.
- Do not invent levels, gaps, structure, or dynamic levels when candle data does not support them.
- Respect `asOfTimestamp` everywhere to prevent future-candle leakage.
- Use current saved audit systems and saved candle data as much as possible while the market is closed.
- When live validation is needed, leave a clear checklist instead of guessing.

## Baseline Audit Commands

Use these throughout the phases:

```powershell
npm run build
npm test
npm run engine:capabilities
npm run candles:audit -- data/candles
npm run candles:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:calibrate -- --all-sessions
npm run candles:bulk-sim
npm run candles:import-readiness -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:backfill -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS --max-tasks 8
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data
npm run candles:regression-pack -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run stress:all-symbols
npm run scenario:smallcap
npm run saved-data:test -- --limit 8
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run structure:replay -- --max-files-per-symbol 2
npm run structure:discord-align -- --limit all
npm run volume:replay -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run volume:warehouse -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:first-snapshots -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:execution-relations -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:missed-moves -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:session-behavior -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:eod-verdict -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

When no latest session folder exists, use commands that scan all saved data by default, such as `stress:all-symbols`, `structure:discord-align -- --limit all`, and `engine:capabilities`.

## Phase 1: Shared Engine Baseline

Status: mostly complete as of 2026-05-03.

Goal: make the shared candle/level engine visible, testable, and safely consumable.

Completed foundation:

- shared public package boundary
- capability report
- warehouse audit command
- durable JSONL candle warehouse foundation
- reference levels
- gap structure
- dynamic VWAP/EMA price context
- execution-level relation helper
- warehouse-backed context builders
- bulk backfill planner
- full test suite passing after the first pass

Completion gate:

- `npm run build` passes
- `npm test` passes
- `npm run engine:capabilities` writes a report
- `npm run candles:audit -- data/candles` runs without failure
- docs `51`, `52`, `68`, and this file explain current shared-engine state

## Phase 2: Calibration And Evidence

Status: partially complete as of 2026-05-03.

Implemented:

- `npm run candles:calibrate -- <session-folder-or-discord-delivery-audit.jsonl>`
- `src/lib/review/candle-intelligence-calibration.ts`
- `src/scripts/run-candle-intelligence-calibration.ts`
- focused tests in `src/tests/candle-intelligence-calibration.test.ts`
- all-sessions mode with `npm run candles:calibrate -- --all-sessions`
- known problem symbol evidence for `CYCU`, `PBM`, `FATN`, `AKAN`, and `CUE`

The report writes:

```text
candle-intelligence-calibration.json
candle-intelligence-calibration.md
```

It currently reviews saved Discord posts against cached daily / `4h` / `5m` candle evidence and reports per-symbol trust for:

- `referenceLevels`
- `gapStructure`
- `executionRelations`

Latest single-session saved-data run:

```powershell
npm run candles:calibrate -- --max-symbols 12
```

Result on `artifacts\long-run\2026-05-01_10-48-03`:

- symbols reviewed: 12
- trusted reference levels: 6
- watch reference levels: 6
- broken reference levels: 0
- experimental gap structures: 12
- relation warnings: 2
- relation broken: 0
- missing candle symbols: 0

Interpretation:

- `referenceLevels` are usable when previous-day, premarket, opening-range, and current-session evidence exists.
- gap facts remain experimental and operator-only until more saved-data calibration proves wording value.
- execution relations are useful but should be watched when nearest resistance is missing or the price is in open-air context.

Latest all-sessions saved-data run:

```powershell
npm run candles:calibrate -- --all-sessions
```

Result across `artifacts\long-run`:

- audit files reviewed: 74
- symbols reviewed: 57
- trusted reference levels: 12
- watch reference levels: 18
- broken reference levels: 27
- experimental gap structures: 30
- broken gap structures: 27
- trusted execution relations: 23
- relation warnings: 7
- relation broken: 27
- missing candle symbols: 27
- known problem symbols reviewed: 5

The large number of broken items is mostly not a calculation failure; it shows that many older saved Discord sessions do not have matching cached daily / `4h` / `5m` candle evidence under `.validation-cache/candles`. The audit now makes that visible instead of letting old posts masquerade as fully candle-backed evidence.

Goal: prove the new shared facts are actually right on saved data.

Work to complete:

1. Add a reference-level calibration audit. Status: first operator report complete.
   - Compare `referenceLevels` against saved 5m/daily candle sessions.
   - Check previous-day high/low/close.
   - Check premarket high/low/base.
   - Check opening-range high/low.
   - Flag missing or stale evidence separately from wrong calculations.

2. Add a gap-structure calibration audit. Status: first operator report complete, still experimental.
   - Scan saved daily candles.
   - Report meaningful open gaps above/below price.
   - Report filled gaps and fill timestamps.
   - Flag questionable gaps caused by suspicious provider data.
   - Keep output operator-only.

3. Add execution-level relation audit. Status: first operator report complete.
   - Replay saved post prices and trade-window prices where available.
   - Check nearest support, resistance, room, stacked barriers, and nearest references.
   - Highlight confusing cases where the relation facts would have improved a post.
   - Latest update: `npm run audit:execution-relations` now rebuilds support/resistance context from cached candles for saved Discord posts and records nearest levels, room, references, VWAP/EMA distance, and market-structure state.

4. Add real regression examples. Status: first regression-pack generator complete; still needs more problem-specific assertions as new findings are identified.
   - Use saved problem patterns such as CYCU-style overposting, PBM stale cache, FATN support drift, AKAN fast runner, CUE no-forward-level wording.
   - Turn concrete failures into tests.
   - Latest update: `npm run candles:regression-pack` turns weak first snapshots, volume may-help/hide cases, execution relation gaps, and missing-forward-resistance candidates into reusable saved-data cases.

5. Document trust level. Status: first trust labels implemented in calibration report.
   - Mark each new shared fact as `trusted`, `watch`, or `experimental`.
   - Record what still requires live validation.

Done only when:

- reports show exact symbol/date examples
- findings are categorized as good / watch / broken
- bad examples become tests
- docs state which facts can be trusted and which remain experimental
- `npm run build` and focused tests pass

## Phase 3: Warehouse Becomes Practical

Status: partially complete as of 2026-05-03.

Implemented:

- `planWarehouseMissingCandleBackfill(...)`
- public export through `levels-system-phase1/support-resistance-engine`
- focused test coverage in `src/tests/durable-candle-warehouse.test.ts`
- `npm run candles:import-readiness -- <session-folder-or-discord-delivery-audit.jsonl>`
- `npm run candles:backfill -- <session-folder-or-discord-delivery-audit.jsonl>`
- `src/lib/review/candle-import-readiness-report.ts`
- `src/scripts/run-candle-import-readiness-report.ts`
- `src/lib/candle-warehouse/backfill-executor.ts`
- `src/lib/review/candle-warehouse-backfill-report.ts`
- `src/scripts/run-candle-warehouse-backfill.ts`
- backfill task readiness labels: `safe_to_fetch`, `refreshed`, and `provider_risk`
- `buildDefaultSupportResistanceContextForSymbol(...)`
- `buildDefaultTradeAnalysisCandleContext(...)`
- `assessCandleWarehouseStoragePolicy(...)`
- focused tests in `src/tests/candle-import-readiness-report.test.ts`

The new planner takes the bulk import plan and the durable warehouse, then reports only the missing provider/symbol/session/timeframe ranges that still need fetching. This is the practical bridge for future months-of-trades imports: repeated symbol/session requests can be deduped and already-stored candles can be reused instead of fetched again.

The backfill executor is dry-run first. It only writes candles when `--execute` or `--mode execute` is explicitly passed. It supports:

- `--max-tasks`
- `--concurrency`
- `--throttle-ms`
- `--timeframes daily,4h,5m,1m`

Provider protection belongs here, under `levels-system`, not in consumer apps. Consumer apps should request analysis context while this project decides cache reuse, missing ranges, provider limits, and freshness diagnostics.

Latest import-readiness run:

```powershell
npm run candles:import-readiness -- --max-trades 20 --timeframes daily,4h,5m,1m
```

Result on the latest saved long-run session:

- trade proxies reviewed: 18
- planned tasks: 72
- fully covered tasks: 0
- missing tasks: 72
- estimated missing candles: 24,552

Interpretation: the durable warehouse path is wired, but `data/candles` is not populated for the latest saved session yet. The next warehouse phase is actual backfill execution and reuse, not more planning.

Latest safe dry-run:

```powershell
npm run candles:backfill -- --max-tasks 8 --timeframes 5m
```

This generates `candle-warehouse-backfill.json` / `.md` without provider writes. Use `--execute` only when provider access is intended. The report now includes provider-readiness proof so bulk import planning can tell the difference between already-covered ranges, safe missing ranges, refreshed ranges, and provider-risk failures.

Goal: make durable candle storage genuinely useful for restarts, bulk imports, and other TraderLink tools.

Work to complete:

1. Make warehouse-backed builders the preferred shared-engine path where safe. Status: complete for the public shared API.
   - Keep direct candle-array builders for tests and advanced callers.
   - Keep Discord startup snapshots guarded from stale cache.

2. Add missing-range backfill execution. Status: dry-run-first executor complete; live/provider execution needs intentional operator use.
   - Use `planBulkCandleBackfill(...)` as the planner.
   - Fetch missing ranges once.
   - Write provider responses into the warehouse.
   - Avoid repeated provider fetches for the same symbol/date/timeframe.

3. Add freshness and coverage diagnostics to shared responses. Status: initial `freshnessStatus` field added to symbol and trade-window fetch summaries.
   - Show whether each timeframe is fresh, usable, stale, partial, or missing.
   - Include provider, newest candle timestamp, and validation issues.

4. Add multi-symbol/months-of-trades tests. Status: focused repeated-import reuse tests added; broader months-scale fixtures still needed.
   - Simulate repeated imports for many trades.
   - Prove candle requests dedupe.
   - Prove stored candles are reused.
   - Latest update: `npm run candles:bulk-sim` simulates months-style imports and shows naive provider calls versus deduped symbol/session/timeframe tasks. The planner now coalesces same-symbol/session requests across different execution timestamps.

5. Define JSONL-to-database threshold. Status: first coded policy complete.
   - Document when JSONL is still fine.
   - Document when SQLite or a service-backed warehouse becomes necessary.

Implementation note:

- JSONL remains the default for local testing, Discord validation, and early single-operator use.
- SQLite becomes recommended around 5M stored rows, 10K+ monthly imported trades, or large repeated symbol/session scans.
- A service-backed warehouse becomes recommended around 25M+ rows or multi-user/concurrent website usage.
- The coded policy lives in `src/lib/candle-warehouse/warehouse-storage-policy.ts`.

Done only when:

- repeated symbol/date requests reuse stored candles
- missing ranges are fetched once and stored
- stale/missing candle data is surfaced clearly
- no Discord post can be based on stale cache as if it were fresh

## Phase 4: Volume From Candle Warehouse

Goal: make volume/activity more reliable than live-only runtime guesses.

Status: shared/operator context plus warehouse replay audit complete as of 2026-05-03.

Implemented:

- `buildVolumeActivityContextFromWarehouseCandles(...)`
- `buildWarehouseVolumeActivityContext(...)`
- public exports through `levels-system-phase1/support-resistance-engine`
- `npm run volume:warehouse -- <session-folder-or-discord-delivery-audit.jsonl>`
- `warehouse-volume-activity-report.json`
- `warehouse-volume-activity-report.md`
- focused tests in `src/tests/warehouse-volume-context.test.ts`
- replay report tests in `src/tests/warehouse-volume-activity-report.test.ts`

The first version reads stored 5m candles, builds a historical baseline, classifies the latest activity by session bucket, adds dollar-volume/liquidity context, and records whether price is close to support/resistance. It is structured/operator evidence only and must not create standalone Discord posts.

The replay report separates examples where volume context may help an existing alert from examples that must stay hidden/operator-only because the volume read is unreliable, too normal, thin, or stale versus the alert timestamp.

Work to complete:

1. Build 5m historical volume baselines from warehouse candles. Status: complete.
2. Classify relative volume by session bucket. Status: complete.
   - premarket
   - open
   - midday
   - afternoon
   - after-hours
3. Add dollar-volume and liquidity context from stored candles. Status: complete.
4. Add volume-at-level evidence. Status: initial nearest-level evidence complete; reclaim/support-test-specific evidence remains future calibration.
   - expanding into resistance
   - fading while retesting
   - activity pickup on reclaim
   - thin activity during chop
   - Latest update: the warehouse volume replay report now has explicit interaction buckets for these cases plus `normal_or_unhelpful` and `stale_or_unreliable`, so calibration can prove when volume would help versus add noise.
5. Keep Discord live wording off by default. Status: complete.
6. Add volume calibration and replay reports. Status: first warehouse replay report complete.

Done only when:

- unreliable volume is omitted
- saved-data replay shows reliable, unreliable, shown, and suppressed examples
- tests cover thin / normal / expanding / strong / fading
- no wording says volume confirms or guarantees anything

## Phase 5: Market Structure Calibration

Goal: make 5m structure trustworthy across small-cap behavior.

Status: structure replay exists; small-cap materiality evidence strengthened as of 2026-05-03.

Implemented:

- replay cases now include immaterial transition counts and ratios
- markdown includes immaterial transition evidence
- findings flag `small_cap_immaterial_structure_flips` when structure flips happen on tiny price movement
- findings also flag `small_cap_immaterial_structure_transition` when even a smaller transition is below small-cap materiality and should stay out of trader wording until more candle proof appears
- focused coverage in `src/tests/market-structure-replay-audit.test.ts`

Work to complete:

1. Replay market structure across all saved 5m data.
2. Review:
   - swing highs/lows
   - higher lows/lower highs
   - range high/low
   - pivot loss/reclaim
   - trend intact/damaged
   - confidence labels
3. Tune materiality for small caps.
   - One-cent wiggles must not count as structure changes.
   - Use closes and repeated evidence, not single prints.
4. Detect consolidation boxes and accepted escapes.
5. Compare structure state to actual Discord posts.
6. Use structure to improve suppression/materiality before expanding trader wording.

Done only when:

- noisy chop is reduced without hiding real moves
- runner cases still show material transitions
- CYCU/PBM/FATN/AKAN/CUE-style cases are tested
- structure remains observational unless proven useful

## Phase 6: First Post Becomes A Real Trader Map

Goal: make the first support/resistance snapshot useful to a trader without becoming advice.

Status: offline first-post audit scoring and dedicated first-snapshot audit complete as of 2026-05-03.

Implemented:

- session behavior audit now scores practical support context, resistance context, story framing, strength labels, and line-by-line formatting
- weak “no resistance surfaced” and unanchored “risk opens toward” wording are penalized
- `npm run audit:first-snapshots -- <session-folder-or-discord-delivery-audit.jsonl>`
- `first-snapshot-trade-map-audit.json`
- `first-snapshot-trade-map-audit.md`
- reusable `scoreFirstPostTradeMapText(...)`
- focused coverage in `src/tests/session-behavior-audit.test.ts`
- dedicated coverage in `src/tests/first-snapshot-trade-map-audit.test.ts`

Work to complete:

1. Keep the full ladder.
2. Lead with a concise trade map:
   - current price
   - main support
   - main resistance
   - cleaner-above area
   - room above / below
   - range/chop/runner context
   - level quality
3. Include strength labels naturally:
   - light support
   - moderate support
   - heavy resistance
   - major resistance
4. Add dynamic context only if it is safe and useful.
5. Avoid penny-risk nonsense.
6. Audit all saved first posts. Status: dedicated report complete.

Done only when:

- first-post quality audit improves
- full ladder remains present and complete
- no direct buy/sell/entry/exit/wait advice appears
- trader can understand the map before reading the ladder

## Phase 7: Execution / Trade Review Package

Goal: make the shared engine strong enough for `trader-intelligence-v2`.

Status: per-execution relation facts are now included in trade-analysis context as of 2026-05-03.

Implemented:

- `buildTradeAnalysisCandleContext(...)` returns `executionRelations[]`
- each execution relation includes support/resistance relation facts
- each execution relation includes price versus VWAP/EMA9/EMA20 relation facts
- each execution relation includes market-structure state/confidence
- future executions after `asOfTimestamp` are returned with diagnostics and no relation facts
- exported public types:
  - `TradeAnalysisExecutionRelationFact`
  - `TradeAnalysisExecutionDynamicRelations`
  - `TradeAnalysisExecutionRelationDiagnostic`
  - `TradeAnalysisExecutionRelationDiagnosticCode`

Work to complete:

1. Integrate `buildExecutionLevelRelations(...)` into trade-analysis context. Status: complete.
2. Return relation facts for each execution. Status: complete.
3. Include: Status: complete for generic market facts.
   - price vs support/resistance
   - price vs VWAP/EMA
   - market structure
   - reference levels
   - room and stacked barriers
4. Preserve no-lookahead behavior with `asOfTimestamp`. Status: tested.
5. Add bulk trade import fixtures. Status: still needs larger months-scale fixtures.
6. Update the handoff doc. Status: complete.

Done only when:

- the other app can consume one shared package and avoid local candle fetching
- relation facts are generic market facts, not coaching advice
- tests prove no future candles leak into trade review

## Phase 8: Advanced Candle-Derived Context

Goal: add useful extra facts only after the core is calibrated.

Candidates:

- gap continuation / fade
- opening-range reclaim / loss
- candle reaction patterns
- pullback depth
- move extension / exhaustion
- halt / reopen behavior
- simple operator-only candle pattern recognition

Rules:

- each feature gets tests
- each feature gets audit evidence
- nothing becomes Discord-visible by default
- weak/experimental reads are marked as such
- avoid textbook pattern spam

## Latest Closed-Market Completion Pass - 2026-05-03

Completed in this pass:

1. Months-scale bulk import simulation.
   - Added `npm run candles:bulk-sim`.
   - Added tests proving same-symbol/session/timeframe trade imports collapse into one widened provider task.

2. Execution relation replay.
   - Added `npm run audit:execution-relations`.
   - Saved Discord posts can now be checked for available nearest support/resistance, room, reference-level, VWAP/EMA, and market-structure evidence.

3. Deeper warehouse volume calibration.
   - Added interaction buckets to `volume:warehouse` so volume reads are classified by useful context versus noise.

4. Provider comparison readiness.
   - Added `npm run candles:provider-compare`.
   - The first report compares cached provider coverage and drift without changing runtime provider behavior.

5. Regression pack generation.
   - Added `npm run candles:regression-pack`.
   - Weak first snapshots, volume cases, relation gaps, and no-forward-level candidates can now be carried into future audits as concrete cases.

Verification expectation for this pass:

```powershell
npx tsx --test src/tests/bulk-candle-import-simulation.test.ts src/tests/execution-relation-replay-report.test.ts src/tests/warehouse-volume-activity-report.test.ts src/tests/provider-comparison-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts src/tests/shared-candle-intelligence-foundation.test.ts
npm run build
npm test
```

Latest verification result:

- targeted new report suite: 16 passing
- full `npm test`: 608 passing
- bulk simulation smoke: 320 trade rows, 640 naive provider tasks, 160 deduped tasks, 480 avoided provider tasks
- execution relation replay smoke: 1,150 saved posts reviewed, 187 valid relation samples, 34 useful-context candidates, 963 missing-evidence cases
- provider comparison smoke: no common cached `ibkr` / `twelve_data` provider overlap in the local sample, which is expected until a second provider cache exists
- regression pack smoke: 25 reusable cases generated across all saved sessions

## Phase 9: Provider Readiness

Goal: make switching away from IBKR safe later.

Status: first provider/backfill readiness evidence exists as of 2026-05-03.

Implemented:

- backfill task readiness labels in `executeCandleWarehouseBackfill(...)`
- provider-readiness explanation in `candle-warehouse-backfill.md`
- tests in `src/tests/candle-warehouse-backfill-report.test.ts` and `src/tests/durable-candle-warehouse.test.ts`
- `npm run candles:provider-compare` now produces a cached provider comparison skeleton for coverage, latest-close drift, VWAP/EMA drift, and basic support/resistance count drift before a future provider switch.

Work to complete:

1. Add provider comparison reports.
2. Compare candle coverage.
3. Compare support/resistance drift.
4. Compare VWAP/EMA drift.
5. Compare market-structure drift.
6. Compare volume baseline drift.
7. Record provider-specific missing-data behavior.

Done only when:

- provider differences are visible with examples
- a provider switch can be tested before live posts trust it
- consumer APIs do not change
- provider details stay below the shared API

## Phase Execution Rule For Codex

When asked to continue this work, do not vaguely “make improvements.”

Use this instruction pattern:

```text
Complete Phase N fully. Work continuously. Do not stop at partial foundations. Add code, tests, audits, docs, run build/test, and clearly say what remains.
```

If a phase is too large for one response, complete a meaningful subphase and state exactly:

- what was completed
- what was tested
- what saved data was used
- what remains in the same phase
- whether live market validation is required
