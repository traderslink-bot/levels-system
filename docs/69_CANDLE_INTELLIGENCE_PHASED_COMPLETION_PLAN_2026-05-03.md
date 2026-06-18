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
npm run candles:import-safety -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:import-safety -- --all-sessions
npm run candles:backfill-priority -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:backfill-priority -- --all-sessions
npm run candles:backfill-manifest -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --stage 1
npm run candles:backfill -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles
npm run candles:backfill -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS --max-tasks 8
npm run levels:calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run levels:calibrate -- --all-sessions
npm run candles:provider-compare -- --primary ibkr --comparison twelve_data
npm run candles:regression-pack -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:regression-gate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:dynamic-calibrate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:dynamic-calibrate -- --all-sessions
npm run stress:all-symbols
npm run scenario:smallcap
npm run saved-data:test -- --limit 8
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run structure:replay -- --max-files-per-symbol 2
npm run structure:discord-align -- --limit all
npm run structure:calibrate -- --max-files-per-symbol 2 --audit-limit all
npm run volume:replay -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run volume:warehouse -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:advanced-context -- --max-symbols 25
npm run audit:first-snapshots -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:execution-relations -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:missed-moves -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- --all-sessions
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

4. Add real regression examples. Status: regression-pack generator plus enforceable regression gate complete; still needs more problem-specific assertions as new findings are identified.
   - Use saved problem patterns such as CYCU-style overposting, PBM stale cache, FATN support drift, AKAN fast runner, CUE no-forward-level wording.
   - Turn concrete failures into tests.
   - Latest update: `npm run candles:regression-pack` turns weak first snapshots, volume may-help/hide cases, execution relation gaps, and missing-forward-resistance candidates into reusable saved-data cases.
   - Latest update: `npm run candles:regression-gate` evaluates that pack against explicit thresholds and can fail on major regressions such as weak first maps or missing forward resistance.

5. Document trust level. Status: first trust labels implemented in calibration report.
   - Mark each new shared fact as `trusted`, `watch`, or `experimental`.
   - Record what still requires live validation.

Done only when:

- reports show exact symbol/date examples
- findings are categorized as good / watch / broken
- bad examples become tests
- docs state which facts can be trusted and which remain experimental
- `npm run build` and focused tests pass

Latest Phase 2 additions:

- Focused support/resistance calibration and forward-ladder completeness work is now tracked in `docs/71_SUPPORT_RESISTANCE_CALIBRATION_AND_FORWARD_LADDER_PLAN_2026-05-03.md`. Use that file for the detailed plan around level usefulness, future candle reactions, suspicious forward gaps, and no-forward-level audit evidence.
- `npm run levels:calibrate` writes `support-resistance-calibration.json` / `.md`, rebuilds levels at saved post time, validates future 5-minute reactions, and audits forward-ladder completeness so level-engine quality can be reviewed directly instead of inferred only from Discord wording.
- `npm run levels:calibrate` now also writes `support-resistance-calibration-gate.json` / `.md`. The gate separates broken level logic from review-only evidence gaps and high unproven coverage.
- Support/resistance calibration now emits coverage gaps/backfill hints, ranking proof buckets, and 5m market-structure alignment.
- `candles:regression-pack` now promotes support/resistance watch, broken, and unproven-coverage cases into regression artifacts.
- `candles:backfill-priority` now boosts provider work for symbols where support/resistance calibration is unproven, broken, or missing forward ladder proof.
- Focused small-cap materiality and trader-output work is now tracked in `docs/70_SMALL_CAP_MATERIALITY_AND_TRADER_OUTPUT_COMPLETION_PLAN_2026-05-03.md`. Use that file for the detailed progress checklist around penny-level materiality, practical zones, first snapshot maps, and noise policy.
- `npm run candles:dynamic-calibrate` writes `dynamic-reference-calibration-report.json` / `.md` and proves whether saved candles support opening-range, VWAP, EMA9, and EMA20 facts near saved posts.
- `npm run candles:dynamic-calibrate` now also writes `dynamic-reference-calibration-report-gate.json` / `.md`. The trust gate classifies dynamic/reference evidence as `pass`, `review`, or `fail` and keeps VWAP/EMA/opening-range facts operator-only unless the configured trust threshold passes.
- Candle reaction context now records `rangePct`, `levelDistancePct`, and `materialityLabel`. The shared trader context passes the small-cap meaningful-move floor into reaction classification so one-cent probes can remain minor/indecisive until the candle evidence is large enough.
- Level-quality calibration now records first forward support/resistance gaps plus tight nearby cluster counts. `crowded_nearby_levels` is a structured context label for practical-zone handling; it does not remove individual levels from the full ladder.
- First snapshot support/resistance posts now identify clustered nearby levels as practical zones, keeping the trader map focused on reactions and accepted expansion instead of exact penny-by-penny prints.
- `npm run audit:eod-verdict` now folds in first-snapshot scoring, execution-relation replay, missed-move audit evidence, and warehouse volume evidence instead of only telling the operator to run those reports separately.
- `npm run audit:eod-verdict` now includes representative evidence examples from the supporting first-snapshot, execution-relation, missed-move, and volume reports so the verdict is harder to hand-wave.
- `npm run audit:why-no-post` writes `why-no-post-replay-proof.json` / `.md` and classifies each symbol as quiet-supported, quiet-preserved-meaningful-moves, quiet-may-hide-move, or unproven due to missing candles.
- `npm run audit:why-no-post` now accepts `--all-sessions` and, for single sessions, folds in balanced replay suppression evidence so quiet behavior can be checked against both candle moves and current suppression rules.

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
- `src/lib/review/candle-import-safety-report.ts`
- `src/scripts/run-candle-import-safety-report.ts`
- `npm run candles:import-safety`
- `src/lib/review/candle-backfill-priority-report.ts`
- `src/scripts/run-candle-backfill-priority-report.ts`
- `npm run candles:backfill-priority`
- `src/lib/review/candle-backfill-stage-manifest.ts`
- `src/scripts/run-candle-backfill-stage-manifest.ts`
- `npm run candles:backfill-manifest`
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

Provider protection belongs here, under `levels-system`, not in consumer apps. Consumer apps should request analysis context while this project decides cache reuse, missing ranges, provider limits, batch sizing, throttling, and freshness diagnostics.

`npm run candles:import-safety` is the provider-pressure view. It wraps import readiness and shows naive provider tasks, deduped provider tasks, avoided provider requests, missing tasks, provider batch sizes, largest task estimates, and a verdict of `safe_to_plan`, `provider_pressure_watch`, `warehouse_gap`, or `no_trade_rows`.

`npm run candles:backfill-priority` is the staged fetch order view. It joins import readiness, why-no-post proof, and all-symbol stress evidence so missing ranges most likely to affect trader-facing conclusions are fetched before ordinary gaps. Tasks are ranked as `fetch_first`, `fetch_next`, or `fetch_later`, then grouped into provider-safe stages with configurable task and estimated-candle limits.

`npm run candles:backfill-manifest` is the priority-to-provider handoff. It reads `candle-backfill-priority.json`, selects a priority stage, writes a stage manifest, and prints the exact safe dry-run command. The manifest also includes an explicit `--execute` command, but provider access still requires that flag.

`npm run candles:backfill -- --priority-report <priority-json> --priority-stage <n>` consumes a selected priority stage. The backfill executor rebuilds the current warehouse missing-range plan from the stage's symbol/session/timeframe keys, so ranges already filled since the priority report are skipped before any provider call. It remains dry-run unless `--execute` is passed.

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
   - Latest update: the bulk planner now records naive task count, avoided task count/percent, coalesced trade-request count per task, estimated candle count, and provider batches so import pressure can be reviewed before any provider fetch.

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

Status: structure replay, Discord alignment, and combined calibration reporting exist as of 2026-05-03.

Implemented:

- replay cases now include immaterial transition counts and ratios
- markdown includes immaterial transition evidence
- findings flag `small_cap_immaterial_structure_flips` when structure flips happen on tiny price movement
- findings also flag `small_cap_immaterial_structure_transition` when even a smaller transition is below small-cap materiality and should stay out of trader wording until more candle proof appears
- `npm run structure:calibrate` joins 5m replay evidence with saved Discord alignment evidence
- `market-structure-calibration.json`
- `market-structure-calibration.md`
- calibration verdicts: `trusted_for_suppression`, `watch_structure_chop`, `operator_only`, `insufficient_evidence`
- focused coverage in `src/tests/market-structure-replay-audit.test.ts`
- focused coverage in `src/tests/market-structure-calibration-report.test.ts`

Work to complete:

1. Replay market structure across all saved 5m data. Status: replay plus combined calibration report complete.
2. Review:
   - swing highs/lows
   - higher lows/lower highs
   - range high/low
   - pivot loss/reclaim
   - trend intact/damaged
   - confidence labels
3. Tune materiality for small caps. Status: first small-cap immaterial-transition evidence complete; tuning remains an ongoing saved/live-data calibration item.
   - One-cent wiggles must not count as structure changes.
   - Use closes and repeated evidence, not single prints.
4. Detect consolidation boxes and accepted escapes.
5. Compare structure state to actual Discord posts. Status: complete through `structure:discord-align` and `structure:calibrate`.
6. Use structure to improve suppression/materiality before expanding trader wording. Status: report identifies symbols trusted for suppression versus watch/operator-only.

Done only when:

- noisy chop is reduced without hiding real moves
- runner cases still show material transitions
- CYCU/PBM/FATN/AKAN/CUE-style cases are tested
- structure remains observational unless proven useful

## Phase 6: First Post Becomes A Real Trader Map

Goal: make the first support/resistance snapshot useful to a trader without becoming advice.

Status: offline first-post audit scoring and dedicated first-snapshot evidence checks complete as of 2026-05-03.

Implemented:

- session behavior audit now scores practical support context, resistance context, story framing, strength labels, and line-by-line formatting
- weak “no resistance surfaced” and unanchored “risk opens toward” wording are penalized
- `npm run audit:first-snapshots -- <session-folder-or-discord-delivery-audit.jsonl>`
- `first-snapshot-trade-map-audit.json`
- `first-snapshot-trade-map-audit.md`
- reusable `scoreFirstPostTradeMapText(...)`
- per-symbol map checks for current price, current read, closest levels, line-by-line levels, strength labels, practical support/resistance, room/range context, advisory language, penny-risk wording, and unsupported no-resistance language
- report totals for full trader-map snapshots, line-by-line snapshots, advisory risks, penny-risk wording risks, and unsupported no-resistance wording risks
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
6. Audit all saved first posts. Status: dedicated report complete and stricter map-check evidence added.

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
5. Add bulk trade import fixtures. Status: months-scale planner fixture added; more real import data can still be added as the website app matures.
6. Update the handoff doc. Status: complete.

Done only when:

- the other app can consume one shared package and avoid local candle fetching
- relation facts are generic market facts, not coaching advice
- tests prove no future candles leak into trade review

## Phase 8: Advanced Candle-Derived Context

Goal: add useful extra facts only after the core is calibrated.

Status: first operator-only advanced candle context report complete as of 2026-05-03.

Implemented:

- `npm run candles:advanced-context`
- `advanced-candle-context.json`
- `advanced-candle-context.md`
- per-symbol operator evidence for support/resistance counts, reference-level availability, nearest gap above/below, VWAP / EMA9 / EMA20 availability, market-structure state/confidence, session gap, candle reaction, move extension, opening range, halt awareness, level quality, data quality, trade idea, and first-post-plan lines
- focused coverage in `src/tests/advanced-candle-context-report.test.ts`

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

6. Regression gate.
   - Added `npm run candles:regression-gate`.
   - The generated regression pack can now be evaluated as pass/review/fail with explicit thresholds.

7. Dynamic/reference calibration.
   - Added `npm run candles:dynamic-calibrate`.
   - The report proves opening-range and VWAP/EMA evidence around saved Discord posts from cached candles.

8. Why-no-post proof.
   - Added `npm run audit:why-no-post`.
   - Quiet behavior is now reviewed against candle-backed missed-move evidence instead of relying on post count alone.

9. End-of-day verdict evidence.
   - `npm run audit:eod-verdict` now includes candle-evidence counts for first snapshot score, execution relation replay, missed moves, no-forward-resistance samples, and volume may-help/hide examples.

10. Stronger provider-protection planning.
   - Bulk backfill plans now include provider batches, estimated candles, and avoided provider work, making real imports safer for IBKR or any future data provider.

Verification expectation for this pass:

```powershell
npx tsx --test src/tests/bulk-candle-import-simulation.test.ts src/tests/execution-relation-replay-report.test.ts src/tests/warehouse-volume-activity-report.test.ts src/tests/provider-comparison-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts src/tests/dynamic-reference-calibration-report.test.ts src/tests/why-no-post-replay-proof.test.ts src/tests/shared-candle-intelligence-foundation.test.ts src/tests/end-of-day-symbol-verdict.test.ts
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

## Latest Phase 5-9 Expansion Pass - 2026-05-03

Completed in this pass:

1. Market-structure calibration report.
   - Added `npm run structure:calibrate`.
   - Joins 5m structure replay with saved Discord alignment evidence.
   - Classifies symbols as trusted for suppression, structure-chop watch, operator-only, or insufficient evidence.

2. Stricter first-snapshot trader-map evidence.
   - First snapshots now report explicit map checks instead of only a score.
   - The score now penalizes missing current-read and room/range context, which catches ladder-only posts that technically contain levels but do not guide the trader through the setup.

3. Months-scale bulk import fixture.
   - Added a larger planner test that simulates many symbols and 45 sessions.
   - Proves duplicate trade requests collapse into symbol/session/timeframe tasks and provider batches.

4. Advanced candle-context operator report.
   - Added `npm run candles:advanced-context`.
   - Reports gaps, dynamic levels, market structure, candle reaction, opening range, halt awareness, data quality, and first-post-plan lines from cached candles.

5. Stronger provider comparison readiness.
   - Provider comparison now includes average-volume drift and 5m market-structure drift alongside close, VWAP/EMA, and support/resistance drift.

Verification for this pass:

```powershell
npx tsx --test src/tests/provider-comparison-readiness-report.test.ts src/tests/first-snapshot-trade-map-audit.test.ts src/tests/market-structure-calibration-report.test.ts src/tests/advanced-candle-context-report.test.ts src/tests/shared-candle-intelligence-foundation.test.ts
```

Result:

- targeted suite: 17 passing, 0 failing
- `npm run build`: passed
- full `npm test`: 623 passing, 0 failing
- `npm run structure:calibrate -- --max-files-per-symbol 1 --audit-limit 3 --output artifacts\market-structure-calibration-smoke`: symbols 41, trusted 10, watch 27, repeats 2,930
- `npm run candles:advanced-context -- --max-symbols 3 --out-dir artifacts\advanced-candle-context-smoke`: symbols 3, ready 3, VWAP 3, gaps 3, weak data 3

## Latest Phase 5-9 Checklist Integration Pass - 2026-05-03

Completed in this pass:

1. Replay checklist integration.
   - `npm run replay:monday` now includes first-snapshot audit, end-of-day verdict, market-structure calibration, advanced candle context, and provider comparison readiness.
   - The regression-gate checklist call now passes explicit thresholds for map failures, structure-watch cases, advanced-context gaps, and provider-readiness warnings.

2. End-of-day verdict evidence expansion.
   - End-of-day symbol verdicts now include first-snapshot full-map checks, map failure reasons, market-structure calibration verdicts, same-structure repeat counts, advanced-context status/missing facts, and provider-readiness warnings.
   - Verdict action items now call out first-map weakness, structure chop watch, missing advanced context, and provider readiness warnings.

3. Regression pack / gate expansion.
   - Regression packs now include:
     - `first_snapshot_map_failure`
     - `market_structure_chop_watch`
     - `advanced_context_missing`
     - `provider_readiness_watch`
   - The regression gate can now enforce thresholds for those new case types.

4. Provider missing-data behavior reporting.
   - Provider comparison now reports missing/stale provider behavior per timeframe, latest timestamp drift, missing volume baselines, and missing latest candle data.
   - Totals now include `providerMissingBehaviorCount`.

5. Broad saved-data audit run.
   - `npm run candles:regression-gate -- --all-sessions ... --no-fail`: pass with 39 major candidates, 20 weak first snapshots, 20 map failures, 20 structure-watch cases, 20 advanced-context-missing cases, 20 provider-readiness cases, 19 missing-forward-resistance cases.
   - `npm run structure:calibrate -- --max-files-per-symbol 1 --audit-limit all`: 64 symbols, 10 trusted for suppression, 27 watch-structure-chop, 4,531 same-structure repeats.
   - `npm run candles:advanced-context -- --max-symbols 25`: 25 symbols, 25 ready, 25 VWAP available, 25 gaps detected, 16 weak-data-quality reads.
   - `npm run candles:provider-compare -- --primary ibkr --comparison twelve_data`: 37 symbols, 0 both-available timeframe comparisons, 185 provider missing/stale behavior findings. This confirms the local cache does not yet contain usable second-provider overlap.

Verification for this pass:

```powershell
npx tsx --test src/tests/provider-comparison-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts src/tests/end-of-day-symbol-verdict.test.ts
npm run build
npm run replay:monday -- --skip-slow --limit 1 --output artifacts\monday-replay-checklist-smoke
```

Result:

- focused suite: 7 passing, 0 failing
- `npm run build`: passed
- full `npm test`: 623 passing, 0 failing
- replay checklist smoke: pass on latest session `2026-05-01_10-48-03`

## Latest Noise / Snapshot / Cache Readiness Pass - 2026-05-03

Completed in this pass:

1. Stable-structure repeat suppression.
   - The live thread post policy now has a `stable_structure_repeat` decision reason.
   - When saved 5m structure says the ticker is still in the same stable range/base/pullback area, non-accepted repeated flicker inside that same practical zone can be suppressed.
   - Accepted directional changes, critical changes, score/severity escalation, and real structure expansion are still allowed through.

2. First snapshot trader map improvement.
   - Initial support/resistance snapshots now include a `Main trade area` line before the current structure read.
   - The line makes the practical support/resistance box easier to scan without adding advice or price targets.

3. Stricter regression gate presets.
   - `npm run candles:regression-gate` now supports `--preset strict`, `--preset review`, and `--preset exploratory`.
   - `strict` is the default and uses zero-tolerance thresholds.
   - `review` allows bounded operator-watch cases.
   - `exploratory` is for broad evidence gathering without treating every known saved-data issue as a failing gate.
   - `npm run replay:monday` now runs both an exploratory evidence gate and a non-required strict gate.

4. Startup cache readiness proof.
   - Added `npm run startup:cache-readiness`.
   - The report checks active watchlist symbols against cached daily, 4h, and 5m candle counts/freshness.
   - It explicitly records that cache can warm level restore, while Discord snapshots still wait for fresh candle refresh.

5. Advanced candle context weak-data proof.
   - `npm run candles:advanced-context` now reports data-quality score, reasons, primary cause, and missing facts per symbol.
   - Weak data quality can now be separated into candle/context, level-ladder, liquidity-context, halt/stale, mixed, or unknown causes.

Verification for this pass:

```powershell
npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/alert-router.test.ts src/tests/advanced-candle-context-report.test.ts src/tests/startup-cache-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts
npm run build
npm test
npm run startup:cache-readiness -- --out-dir artifacts\startup-cache-readiness-smoke
npm run candles:regression-gate -- --preset exploratory --max-cases-per-type 2 --no-fail --out-dir artifacts\candle-regression-gate-preset-smoke
```

Result:

- focused suite: 74 passing, 0 failing
- `npm run build`: passed
- full `npm test`: 627 passing, 0 failing
- startup cache smoke: 5 active symbols checked, 5 partial cache, 0 blocked
- exploratory regression-gate preset smoke: pass

## Latest Runtime Practicality Pass - 2026-05-03

Completed in this pass:

1. Cache-backed startup acceleration.
   - Runtime health now exposes `startupCache` evidence with warming symbols, restored symbols, blocked cached snapshots, and the explicit `fresh_candles_required` Discord snapshot policy.
   - Restored cache levels can make the UI useful faster, but cached-only startup snapshots remain blocked until fresh candle refresh succeeds.
   - Fresh refresh failures are surfaced in provider health so a restart does not look healthy just because cached levels were restored.

2. First snapshot trader map.
   - First support/resistance snapshots now add a `Main trade area` line before the current-structure read.
   - If support is known but no higher resistance is available in the current snapshot, the trader map now says higher resistance needs a fresh level check before treating the path as open.
   - This avoids the old impression that no resistance exists just because the surfaced ladder ran out.

3. Story-state noise control.
   - Added `practical_area_flip_chop` suppression for repeated, non-accepted touch/cross/reclaim chatter inside the same practical support/resistance box.
   - Existing `stable_structure_repeat` suppression remains in place for unchanged stable 5m range/base/pullback structure.
   - Accepted directional changes, critical changes, score/severity escalation, and real expansion out of the box still pass through.

4. Forward-level completeness guard.
   - When price clears the highest surfaced resistance and no extension level is available, the runtime can force a fresh level reseed and try the extension post again.
   - The UI status shows `refreshing candles for higher resistance` while that check is happening.
   - This is meant for CUE/AKAN-style runner cases where the ladder may need a fresh higher-resistance check after the top level is cleared.

5. Market-structure materiality tuning.
   - High-risk/fragile wording is now withheld for tiny low-priced weak probes inside an active range box or boring-range state.
   - The system can still describe truly fragile setups, but a one-cent small-cap wiggle should not be framed like a major failure by default.

6. Advanced context trust promotion.
   - End-of-day verdicts now summarize advanced-context trust alongside first-map, post-volume, missed-move, level-completeness, wording, and cache/provider questions.
   - Weak advanced context can downgrade a symbol into candle-audit work instead of silently being treated as usable trader context.

7. End-of-day verdict hardening.
   - `audit:eod-verdict` now includes explicit `reviewQuestions` per symbol.
   - Markdown output now prints practical answers for the exact trader/operator questions: did the first post map the trade, was it too noisy, did it miss a meaningful move, were levels complete, was wording clear, does cache/provider work remain, and is advanced context trusted.

Verification for this pass:

```powershell
npx tsx --test src/tests/live-thread-post-policy.test.ts src/tests/alert-router.test.ts src/tests/manual-watchlist-runtime-manager.test.ts src/tests/end-of-day-symbol-verdict.test.ts
```

Result:

- focused suite: 149 passing, 0 failing

## Latest Saved-Data Replay Validation Pass - 2026-05-03

Completed in this pass:

1. Legacy replay context inference.
   - Older saved Discord rows often predate `practicalZoneKey`, `rangeBoxLabel`, `acceptanceLabel`, and `behaviorBudgetLabel` audit metadata.
   - The replay simulator now infers a conservative practical zone and range/chop context from saved title/body text and mentioned prices when those fields are missing.
   - This is operator-only replay behavior; it does not change live Discord formatting or invent support/resistance levels.

2. Saved-data noise proof rerun.
   - `npm run stress:all-symbols` now reports `5075 -> 1949` simulated posts.
   - Reduction improved to `61.6%`.
   - Still-noisy symbols dropped to `7`.
   - Quiet-profile simulated rows are now `1866`.
   - Tight-range chop symbols remain `35`, so the broad evidence set still contains many old sessions worth reviewing before making live thresholds tighter.

3. Current-code versus historical-post separation.
   - Latest-session post-quality findings still include old saved wording such as no-forward-level language from historical Discord posts.
   - Current runtime formatting already uses fresher-level-check wording for missing higher resistance instead of saying no resistance exists.
   - The audit process should keep treating saved language findings as historical until current formatter tests or fresh live posts reproduce them.

4. Quiet-period proof limitation identified.
   - `npm run audit:why-no-post -- --all-sessions` still reports `quiet_may_hide_move` and `unproven_missing_candles` cases.
   - The main blocker is candle-proof coverage: many old sessions lack overlapping cached 5m candles in `.validation-cache/candles`, and all-session replay suppression evidence is intentionally conservative.
   - The next useful work is warehouse/backfill coverage and targeted single-session audits, not blindly tightening live Discord rules.

5. Closed-market checklist rerun.
   - `npm run replay:monday -- --skip-slow` returned `watch`.
   - First snapshot trade maps remained strong: 18 symbols, 18 strong, average `94.6/100`.
   - Latest-session missed meaningful move audit found 0 candidates and 0 missed moves, but also noted cached candles outside the audited Discord window for 17 symbols.
   - Strict candle gate remains a non-required review failure because saved-data coverage still has provider/forward-level/advanced-context watch cases.

Verification for this pass:

```powershell
npx tsx --test src/tests/live-post-replay-simulator.test.ts src/tests/live-thread-post-policy.test.ts
npm run build
npm run stress:all-symbols
npm run audit:why-no-post -- --all-sessions
npm run replay:monday -- --skip-slow
```

Result:

- focused replay/policy suite: 51 passing, 0 failing
- `npm run build`: passed
- full `npm test`: 630 passing, 0 failing
- all-symbol stress: 57 symbols, `5075 -> 1949`, `61.6%` reduction, 7 still-noisy symbols
- all-session why-no-post proof: 57 symbols, 3 quiet-supported, 7 quiet-preserved, 19 may-hide, 28 unproven
- replay checklist verdict: `watch`

## Latest Candle Coverage / Quiet-Risk Gate Pass - 2026-05-03

Completed in this pass:

1. Candle coverage proof made concrete.
   - `npm run candles:import-readiness` and `npm run candles:import-safety` now include `Symbol / Session Coverage`.
   - The coverage rows show whether each saved symbol/session is `covered`, `partial`, or `missing`, plus covered/missing timeframes, stored candle counts, and estimated missing candles.
   - This turns the old broad "warehouse gap" finding into a backfill checklist the operator can act on.

2. Why-no-post proof made concrete.
   - `npm run audit:why-no-post` now emits `Concrete Move Examples`.
   - Each example includes candle timestamp, move type, coverage/severity, close move, range move, candle OHLC, nearest saved posts, and the reason the move mattered.
   - This is the evidence needed before changing live Discord policy: a `may_hide` verdict now points at exact candle behavior instead of only a count.

3. Remaining noisy symbols promoted into regression evidence.
   - `npm run candles:regression-pack` now creates `post_noise_budget_watch` cases from all-symbol stress.
   - The case evidence includes symbol behavior type, budget status, balanced/quiet simulated counts, and a sample session.
   - This keeps future noise work broad instead of drifting back to a few named examples.

4. Quiet-risk promoted into regression gates.
   - `npm run candles:regression-pack` now creates `quiet_may_hide_move` cases from why-no-post proof.
   - `npm run candles:regression-gate` now has thresholds for `maxQuietMayHideMoveCases` and `maxPostNoiseBudgetWatchCases`.
   - The CLI exposes `--max-quiet-may-hide-moves` and `--max-post-noise-budget-watch`, and presets set those thresholds intentionally.

5. Broad saved-data artifacts regenerated.
   - `npm run candles:import-safety -- --all-sessions`: `warehouse_gap`; 105 trade proxies, 420 planned/missing tasks, 0 fully covered tasks, 143,220 estimated missing candles, 9 provider batches.
   - `npm run audit:why-no-post -- --all-sessions`: 57 symbols, 3 quiet-supported, 7 quiet-preserved, 19 may-hide, 28 unproven.
   - `npm run candles:regression-gate -- --all-sessions --preset exploratory --no-fail`: pass; 245 cases, 65 major candidates, 19 quiet-may-hide cases, 15 post-noise budget watch cases.
   - `npm run candles:regression-pack -- --all-sessions --max-cases-per-type 10`: wrote 110 reusable cases including 10 quiet-may-hide and 10 post-noise budget watch examples.
   - `npm run stress:all-symbols`: 57 symbols, `5075 -> 1949`, `61.6%` reduction, 7 still-noisy symbols.

Verification for this pass:

```powershell
npx tsx --test src/tests/why-no-post-replay-proof.test.ts src/tests/candle-import-readiness-report.test.ts src/tests/candle-import-safety-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts
npm run candles:import-safety -- --all-sessions
npm run audit:why-no-post -- --all-sessions
npm run candles:regression-gate -- --all-sessions --preset exploratory --no-fail
npm run candles:regression-pack -- --all-sessions --max-cases-per-type 10
npm run stress:all-symbols
npm run build
npm test
```

Result:

- focused tests: 10 passing, 0 failing
- `npm run build`: passed
- full `npm test`: 631 passing, 0 failing
- broad reports now have enough inline evidence to support the next warehouse/backfill pass
- no live Discord post behavior changed in this pass

## Latest Backfill Priority Planning Pass - 2026-05-03

Completed in this pass:

1. Priority planner added.
   - `npm run candles:backfill-priority` now generates a staged provider fetch plan from saved audit evidence.
   - It combines import-readiness missing ranges, why-no-post proof, and all-symbol stress/noise evidence.
   - Missing tasks are ranked as `fetch_first`, `fetch_next`, or `fetch_later` rather than treated as one flat provider queue.

2. Provider-safe staging added.
   - The planner respects `--max-tasks-per-stage` and `--max-candles-per-stage`.
   - Stages do not mix priority classes, so urgent quiet-risk tasks are not buried behind ordinary missing coverage.
   - The report keeps provider execution separate from planning; it does not fetch candles by itself.

3. Markdown/JSON proof added.
   - The report writes `candle-backfill-priority.json` and `candle-backfill-priority.md`.
   - The Markdown report includes totals, priority stages, fetch-first symbol/session gaps, top ranked missing tasks, and backfill guidance.
   - Each task carries reasons such as quiet may-hide evidence, post-noise budget pressure, unproven missing candles, timeframe priority, partial warehouse coverage, and estimated missing candles.

4. All-session priority pass completed.
   - `npm run candles:backfill-priority -- --all-sessions --max-tasks-per-stage 20 --max-candles-per-stage 8000`
   - Result: 420 missing tasks, 212 `fetch_first`, 177 `fetch_next`, 31 `fetch_later`, 143,220 estimated missing candles, and 23 provider-safe stages.
   - Top fetch-first coverage included symbols/sessions with quiet-risk or high-activity proof instead of ordinary missing ranges.

Verification for this pass:

```powershell
npx tsx --test src/tests/candle-backfill-priority-report.test.ts
npm run candles:backfill-priority -- --all-sessions --max-tasks-per-stage 20 --max-candles-per-stage 8000
```

Result:

- focused priority tests: 3 passing, 0 failing
- all-session report generated under `artifacts/candle-backfill-priority`
- no provider fetches and no live Discord post behavior changed in this pass

## Latest Priority Stage Handoff / Cache Safety Pass - 2026-05-03

Completed in this pass:

1. Priority-to-backfill handoff added.
   - `npm run candles:backfill-manifest` reads `candle-backfill-priority.json` and writes `candle-backfill-stage-manifest.json` / `.md`.
   - The manifest selects a provider stage, lists the exact tasks, and prints the safe dry-run command.
   - It also prints a clearly separated execute command with `--execute --concurrency 1 --throttle-ms 250`; this is intentionally not the default.

2. Priority-stage dry-run support added.
   - `npm run candles:backfill` now accepts `--priority-report`, `--priority-stage`, and `--priority`.
   - When a priority report is provided, the backfill executor uses the selected symbol/session/timeframe keys and recalculates current warehouse gaps before planning work.
   - This prevents stale priority reports from forcing provider calls for ranges already filled later.

3. Warehouse reuse proof strengthened.
   - Tests now prove the default shared symbol builder stores fetched candles into the durable warehouse for future reuse.
   - Existing execute/reuse backfill tests still prove a second execute pass does not refetch a fully covered range.

4. Startup cache safety made explicit.
   - Startup cache readiness JSON/Markdown now includes `freshRefreshRequiredBeforeDiscordSnapshot: true`.
   - Cached candle levels may warm the UI, but Discord startup snapshots still require fresh candle refresh.

Latest generated artifacts:

```powershell
npm run candles:backfill-manifest -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --stage 1 --warehouse data\candles --backfill-out-dir artifacts\candle-warehouse-backfill-priority-stage-1
npm run candles:backfill -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles --out-dir artifacts\candle-warehouse-backfill-priority-stage-1
```

Result:

- Stage 1 manifest: 20 `fetch_first` tasks, 6,300 estimated candles.
- Stage 1 dry-run: 20 planned tasks, 0 attempted, 0 fetched, 0 failed.
- No provider calls were made.

Verification for this pass:

```powershell
npx tsx --test src/tests/candle-backfill-priority-report.test.ts src/tests/durable-candle-warehouse.test.ts src/tests/startup-cache-readiness-report.test.ts
```

Result:

- focused tests: 16 passing, 0 failing

## Latest Staged Backfill / Level Calibration Pass - 2026-05-03

Completed in this pass:

1. Latest-session priority stage selected.
   - `npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10`
   - Result: 72 missing tasks, 72 `fetch_first`, 0 `fetch_next`, 0 `fetch_later`, 8 provider-safe stages.
   - `npm run candles:backfill-manifest -- --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --stage 1 --backfill-out-dir artifacts\long-run\2026-05-01_10-48-03`
   - Result: Stage 1 selected 20 `fetch_first` tasks with 6,300 estimated candles.

2. Stage 1 dry-run completed.
   - `npm run candles:backfill -- artifacts\long-run\2026-05-01_10-48-03 --priority-report artifacts\candle-backfill-priority\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles`
   - Result: 20 planned tasks, 0 attempted, 0 fetched, 0 failed.

3. Execute-mode provider safety tightened.
   - `npm run candles:backfill -- ... --provider ibkr --execute --ibkr-timeout-ms 5000` now requires a live IBKR validation client and fails safely if IBKR is unavailable.
   - The attempted run failed before any backfill execution with `ECONNREFUSED 127.0.0.1:7497`.
   - This is intentional: `--execute --provider ibkr` should not silently fall back to stub candles and write fake provider data into `data/candles`.

4. Support/resistance calibration rerun.
   - Latest session: `npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03`
   - Result: 18 symbols, 0 trusted, 0 watch, 0 broken, 18 unproven, 2 no-forward-resistance cases, 22 coverage gaps, gate `review`.
   - Broad bounded scan: `npm run levels:calibrate -- --all-sessions --max-symbols 25`
   - Result: 25 symbols, 9 trusted, 3 watch, 0 broken, 13 unproven, 12 no-forward-resistance cases, 36 coverage gaps, gate `review`.

5. No-forward-resistance and watch cases inspected.
   - Latest-session no-forward cases were `AIOS` and `STAK`.
   - `AIOS` had daily / 4h / 5m candles, but no future 5m candles after the saved post, so it is unproven rather than a proven level-engine failure.
   - `STAK` had no usable cached candle groups, so it is a coverage gap.
   - Broad no-forward cases in the bounded scan were all missing cached candle groups, which makes them backfill targets, not proof that resistance logic skipped levels.
   - Broad watch cases were `ABTS`, `DRCT`, and `ISPC`: `ABTS` / `ISPC` are crowded practical-zone review cases; `DRCT` is a ranking watch case where touched daily support / major buckets had weak or broken forward reactions.

Current interpretation:

- The next blocker is real candle coverage, not a confirmed support/resistance algorithm defect.
- Stage 1 is ready for a real IBKR-backed execute run when IBKR Gateway/TWS is listening on the configured socket.
- Until real backfill succeeds, no-forward-level findings should stay classified as unproven coverage gaps unless current code reproduces them with fresh candle data.

## Latest IBKR-Backed Backfill Execution Pass - 2026-05-03

Completed in this pass:

1. Real IBKR execute mode ran against the previously generated all-session Stage 1.
   - Command used the staged priority report and `--provider ibkr --execute --concurrency 1 --throttle-ms 250`.
   - Result: 20 planned tasks, 20 attempted, 20 fetched, 0 failed.
   - Stored 5,889 IBKR candles in `data/candles`.
   - Filled useful high-priority coverage for symbols including `ABTS`, `CUE`, `SST`, and `XTLB`.

2. Backfill script lifecycle fixed.
   - The first successful execute wrote the report but stayed open until the shell timeout because the validation IBKR client remained connected.
   - `run-candle-warehouse-backfill.ts` now disconnects the validation IBKR client in a `finally` block so provider-backed backfill commands exit cleanly after writing artifacts.

3. Historical request timeout propagation fixed.
   - `CandleFetchService` now passes `ibkrTimeoutMs` into the provider factory.
   - Focused tests prove the timeout reaches `IbkrHistoricalCandleProvider`.
   - This matters because retrying a provider-risk task with `--ibkr-timeout-ms 60000` should actually give the historical request 60 seconds, not the old 30-second default.

4. Support/resistance calibration can now read the durable warehouse.
   - `levels:calibrate --warehouse data\candles` merges `.validation-cache/candles` and `data/candles`.
   - The report now records the warehouse path and can use newly stored IBKR candles instead of only older validation-cache files.
   - `candles:backfill-priority` now passes its warehouse path into support/resistance calibration so priority scoring and level evidence use the same candle source.

5. Latest-session IBKR Stage 1 was attempted separately.
   - Latest-session Stage 1 initially planned 10 high-priority tasks.
   - Result: 10 attempted, 0 fetched, 10 failed with provider-risk timeouts.
   - A smaller retry with `--ibkr-timeout-ms 60000 --max-tasks 2` still timed out for `AIOS` and `AKAN`.
   - Current interpretation: those latest-session tasks are provider-risk cases right now, not support/resistance engine failures.

Post-backfill calibration notes:

- The warehouse-aware latest-session support/resistance calibration still reports all 18 symbols as unproven, but the reason changed from pure missing candles to missing after-post 5m proof.
- Several symbols now have enough daily/4h/5m candles for ladder construction (`CUE`, `SST`, `ISPC`, `PBM`, `OSRH`, etc.), but the forward reaction audit remains unproven when there are 0 future 5m candles after the first saved post.
- Remaining no-forward-resistance evidence is still not a confirmed skipped-level bug:
  - `AIOS` has generated levels but no after-post 5m proof.
  - `STAK` still lacks usable cached/warehouse candle groups.

Verification for this pass:

```powershell
npx tsx --test src/tests/candle-fetch-service.test.ts src/tests/support-resistance-calibration-report.test.ts src/tests/candle-warehouse-backfill-report.test.ts src/tests/candle-backfill-priority-report.test.ts
npm run build
```

Result:

- focused tests: 13 passing, 0 failing
- `npm run build`: passed

## Latest IBKR Timeout Diagnosis Pass - 2026-05-03

Completed in this pass:

1. Added one-symbol IBKR historical diagnostics.
   - New command: `npm run candles:ibkr-diagnose`.
   - The command logs the exact symbol, timeframe, lookback, end timestamp, IBKR duration, bar size, RTH setting, client id, contract, raw error events, first/last bars, and completion/timeout status.
   - It is intended for diagnosing provider behavior, not for normal bulk backfills.

2. Diagnosed the apparent latest-session timeouts.
   - With the default validation client id, `AIOS` 5m and `CUE` 5m connected to IBKR but received no bars, no end event, and no error before timeout.
   - With a separate client id (`202`), the same style of requests returned bars quickly:
     - `CUE` returned 269 5m bars.
     - `AIOS` returned 259 5m bars.
   - Conclusion: the earlier timeout behavior was primarily an IBKR client-id/session collision or stale client-session issue, not oversized 5m requests.

3. Made backfill use a safer default client id.
   - `run-candle-warehouse-backfill.ts` now defaults provider-backed IBKR backfill to client id `202`.
   - Operators can override it with `LEVEL_BACKFILL_IBKR_CLIENT_ID`.
   - Existing validation env vars still work, but the backfill path no longer defaults to the app's normal validation/client id.

4. Re-ran latest-session Stage 1 with the separate client id.
   - Command used `LEVEL_VALIDATION_IBKR_CLIENT_ID=202`, `--provider ibkr`, `--execute`, `--ibkr-timeout-ms 60000`, `--concurrency 1`, and `--throttle-ms 500`.
   - Result: 10 planned, 10 attempted, 10 fetched, 0 failed.

5. Re-ran latest-session support/resistance calibration after the successful latest-stage fill.
   - Result: 18 symbols, 0 trusted, 0 watch, 0 broken, 18 unproven, 0 no-forward-resistance, 0 wide gaps, 20 coverage gaps, gate `review`.
   - The important improvement is `noForwardR: 2 -> 0`.
   - Remaining unproven status is now mostly forward-reaction proof / after-post coverage, not missing forward resistance.

Current rule:

- Backfill and diagnostics should use a dedicated IBKR client id that is separate from the running app.
- Prefer `LEVEL_BACKFILL_IBKR_CLIENT_ID=202` or another unused id for long backfill work.
- Do not solve client-session collisions by blindly increasing timeout to hours; first prove the client id and contract path are receiving bars.

## Latest Warehouse-Backed Forward-Proof Pass - 2026-05-03

Completed in this pass:

1. Fixed staged backfill range selection.
   - The import/backfill planner was keeping the first saved post timestamp for each symbol/session because it compared numeric `asOfTimestamp` values with `Date.parse(String(number))`.
   - That produced provider tasks ending at the first snapshot, so successful 5m backfills still left forward-reaction proof unavailable.
   - The planner now compares numeric, `Date`, and string timestamps safely and keeps the latest saved post timestamp.
   - Focused tests now prove a symbol/session with multiple saved posts keeps the latest timestamp.

2. Re-ran corrected IBKR backfill stages with dedicated client id `202`.
   - Corrected Stage 1 fetched 10/10 tasks and filled true after-post 5m windows.
   - Expanded Stage 1 fetched another 10/10 tasks for remaining high-priority 5m / daily / 4h proof gaps.
   - A final bounded Stage 1 fetched another 10/10 tasks, including PBM/CUE 5m and 1m plus higher-timeframe proof.
   - All provider-backed runs used `--execute`, `--provider ibkr`, `--concurrency 1`, `--throttle-ms 750`, and `--ibkr-timeout-ms 90000`.

3. Improved support/resistance calibration evidence.
   - Before corrected forward backfill: `0 trusted / 0 watch / 18 unproven`, then `7 trusted / 3 watch / 8 unproven`.
   - After expanded forward backfill: `12 trusted / 4 watch / 0 broken / 2 unproven`.
   - `noForwardR` stayed at `0`, so the current evidence still points away from a skipped-resistance engine bug.
   - Remaining gate status is `review` because some fetch-first proof gaps remain, especially FATN/NOK forward 5m and LABT higher-timeframe coverage.

4. Wired quiet/no-post proof into the durable warehouse.
   - `missed-meaningful-move` now reads both `.validation-cache/candles` and `data/candles`.
   - `why-no-post` now accepts `--warehouse` and records the warehouse path in JSON/Markdown.
   - `candles:backfill-priority` now passes the warehouse path into why-no-post proof so priority scoring uses disk-backed saved candles.
   - Initial why-no-post proof using the warehouse: 18 symbols, 6 quiet-supported, 8 quiet-preserved-meaningful-moves, 4 quiet-may-hide watch cases, 0 unproven.

5. Current watch items from this pass.
   - Initial watch set: `AKAN`, `CUE`, `PBM`, and `SOBR` had watch-level quiet-may-hide candidates, but no major missed candidates.
   - Several examples are weakly covered by nearby posts; the operator should inspect whether the audit threshold is too broad before changing live policy.
   - PBM has one watch-level missed downside-loss candidate around 2026-05-01T20:40:00Z; this should be reviewed against the trader story before changing suppression rules.
   - Remaining candle priority tasks are now evidence-completion work, not emergency level-engine fixes.

Verification for this pass:

```powershell
npx tsx --test src/tests/missed-meaningful-move-audit.test.ts src/tests/why-no-post-replay-proof.test.ts src/tests/candle-backfill-priority-report.test.ts src/tests/candle-import-readiness-report.test.ts src/tests/candle-warehouse-backfill-report.test.ts
```

Result:

- focused tests: 17 passing, 0 failing

## Latest Missed-Move Audit Materiality Pass - 2026-05-03

Completed in this pass:

1. Tightened the missed-move audit so it no longer overstates support/resistance breaks.
   - Directional 5m candles are now separated from true rolling support/resistance breaks.
   - If a candle moves strongly but does not actually close through the rolling level, the report says that directly, for example `without closing above recent resistance`.
   - If a candle only nicks a rolling level by a small amount, the audit does not automatically call it a missed support/resistance event.

2. Added small-cap-aware rolling-break materiality.
   - Rolling break-only candidates now need a larger close-through distance before becoming `upside_break` or `downside_loss`.
   - This removed the PBM-style false watch item where a normal small-cap move from about `6.26` to `6.13` was being treated as a missed support loss.
   - Material rolling breaks are still preserved, so the audit can still catch real support losses and breakouts.

3. Kept live Discord policy unchanged.
   - The watch evidence did not prove a live post-policy bug.
   - `SOBR` still has real watch-level missed candle evidence, but diagnostics around the key candle window point more toward live/feed/app silence than explicit policy suppression.
   - `AKAN` remains a watch-level large-candle context item, not a confirmed missed resistance break.

4. Regenerated latest-session warehouse-backed reports.
   - `npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles`: 18 symbols, 8 quiet-supported, 8 quiet-preserved-meaningful-moves, 2 quiet-may-hide watch cases, 0 unproven.
   - `npm run audit:missed-moves -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles`: 131 candidates, 3 missed, 0 major.
   - `npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles`: 18 symbols, 12 trusted, 4 watch, 0 broken, 2 unproven, 0 no-forward-resistance, 6 coverage gaps.
   - `npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000`: 72 missing tasks, 21 fetch-first, 33 fetch-next, 9 provider-safe stages.

Verification for this pass:

```powershell
npx tsx --test src/tests/missed-meaningful-move-audit.test.ts src/tests/why-no-post-replay-proof.test.ts
npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:missed-moves -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000
```

Result:

- focused tests: 10 passing, 0 failing
- quiet-risk watch cases reduced from 4 to 2 without weakening real candle-backed missed-move detection

## Latest Quiet-Risk Root-Cause Pass - 2026-05-03

Completed in this pass:

1. Added root-cause classification to `npm run audit:why-no-post`.
   - Candidate examples now include a `quietRiskCause` and `quietRiskReason`.
   - Causes separate `policy_suppressed`, `nearby_non_matching_activity`, `runtime_or_feed_silence`, `candle_context_watch`, and `weakly_covered`.
   - The report now distinguishes real post-policy risk from feed/runtime silence and candle-only context review.

2. Followed up the remaining `SOBR` and `AKAN` watch cases.
   - `SOBR` had a real candle-backed downside support-loss candidate around `2026-05-01T17:30:00Z`, but no saved runtime diagnostics or Discord activity appeared near that candle window.
   - That makes SOBR `unproven_runtime_silence`, not proven post-policy suppression.
   - `AKAN` had a post-market large 5m candle around `2026-05-01T21:00:00Z`, but it did not close above the nearby rolling resistance. It is now classified as `candle_context_watch`, not a missed breakout/resistance clear.

3. Updated priority planning to understand runtime silence.
   - `candles:backfill-priority` now counts `runtimeSilenceSymbols`.
   - Runtime/feed silence still increases proof priority, but it is no longer mixed with `quiet_may_hide_move`.

4. Regenerated latest-session artifacts and fixed the regression CLI warehouse path.
   - `npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles`: 18 symbols, 8 quiet-supported, 9 quiet-preserved-meaningful-moves, 0 quiet-may-hide, 1 runtime/feed-silence, 0 missing-candle unproven.
   - Candidate totals: 3 missed candidates, 0 actionable missed candidates, 1 runtime/feed-silence candidate, 2 candle-context watch candidates, 0 policy-suppressed candidates, 0 major missed candidates.
   - `npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000`: 72 missing tasks, 16 fetch-first, 35 fetch-next, 9 provider-safe stages.
   - `npm run candles:regression-pack -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --max-cases-per-type 10`: 80 cases, 0 weak snapshots, 10 volume-hide cases, 0 quiet-may-hide, 1 runtime/feed-silence, 10 execution-missing cases.
   - `npm run candles:regression-gate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --preset exploratory --no-fail`: pass; 0 major cases, 0 quiet-may-hide, 1 runtime/feed-silence, 6 post-noise watch cases, 4 support/resistance watch cases, 2 support/resistance unproven-coverage cases.
   - The regression-pack and regression-gate CLIs now treat `--warehouse data\candles` as the durable JSONL warehouse path and keep `--cache` as the validation-cache path. This matters because those two stores use different file formats.

Current conclusion:

- There is no current warehouse-backed proof that the quiet post policy hid a meaningful move in the latest May 1 session.
- The remaining SOBR item is a runtime/feed silence investigation item.
- The remaining AKAN item is candle context, not a trader-facing missed level event.
- Do not loosen Discord posting from this evidence alone.

Verification for this pass:

```powershell
npx tsx --test src/tests/candle-backfill-priority-report.test.ts src/tests/why-no-post-replay-proof.test.ts
npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000
npm run candles:regression-pack -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --max-cases-per-type 10
npm run candles:regression-gate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --preset exploratory --no-fail
```

Result:

- focused tests: 19 passing, 0 failing
- `npm run build`: passing
- `npm test`: 649 passing, 0 failing
- `git diff --check`: clean

## Latest Full Candle-Intelligence Calibration Pass - 2026-05-03

Completed in this pass:

1. Regenerated the full latest-session saved-data bundle from `artifacts\long-run\2026-05-01_10-48-03` using `data\candles`.
   - Support/resistance calibration: 18 symbols, 12 trusted, 4 watch, 0 broken, 2 unproven, 0 no-forward-resistance, 6 coverage gaps.
   - Why-no-post proof: 18 symbols, 8 quiet-supported, 9 quiet-preserved-meaningful-moves, 0 quiet-may-hide, 1 runtime/feed-silence, 0 missing-candle unproven.
   - Missed-move audit: 131 candidates, 3 missed, 0 major.
   - Volume replay: 511 alert rows, 511 matched, 94 may-help, 417 operator-only/hide.
   - End-of-day verdict: 18 symbols, 2 watch, 12 needs work, 4 needs candle audit.

2. Fixed durable warehouse reader gaps in calibration/audit reports.
   - `volume:warehouse`, `candles:dynamic-calibrate`, `structure:calibrate`, `candles:advanced-context`, `audit:execution-relations`, provider comparison, regression pack/gate, and session-behavior audit now understand durable JSONL candle files where applicable.
   - `structure:calibrate` now accepts a session folder as the positional argument and `--warehouse data\candles` directly, instead of requiring a separate `--audit-root` and provider-subdirectory path.
   - `candles:advanced-context` now accepts a positional output folder and `--warehouse data\candles`.
   - `audit:session-behavior` now accepts `--warehouse data\candles`.

3. Recalibrated dynamic/reference trust.
   - Opening range is no longer required on every single saved post, because early, premarket, and after-hours posts may legitimately lack opening-range context.
   - Current dynamic/reference result after the fix: 18 symbols, 530 dynamic VWAP/EMA samples, 307 opening-range samples, 211 stretched-from-VWAP samples, trust 8 trusted / 10 watch / 0 unproven / 0 broken.
   - Remaining watch cases are mostly missing daily/previous-day reference evidence for symbols where 5m dynamic context exists.

4. Recalibrated market-structure trust.
   - High immaterial-transition ratios are no longer treated as defects when the stable market-structure layer is clearly reducing raw noisy flips and same-structure repeats.
   - Current market-structure result after the fix: 20 symbols, 17 trusted-for-suppression, 3 watch-structure-chop, 296 same-structure repeats.
   - Remaining watch cases are `WTO`, `ABTS`, and `XTLB`, mostly due to low-confidence replay cases.

5. Ran one provider-backed priority backfill stage.
   - Command: `npm run candles:backfill -- artifacts\long-run\2026-05-01_10-48-03 --priority-report artifacts\long-run\2026-05-01_10-48-03\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03\backfill-stage-1-calibration-pass --execute --timeout-ms 120000 --throttle-ms 1000`
   - Result: 10 planned, 10 attempted, 10 fetched, 0 failed, 2,910 candles stored.
   - Support/resistance and priority totals did not materially change after this pass because some remaining "missing" ranges are off-hours/no-bar gaps rather than simple provider failures. Do not fake those ranges as covered.

6. Regenerated the regression pack/gate after the warehouse-reader fixes.
   - Regression pack: 64 cases, 0 weak snapshots, 10 volume-hide cases, 0 quiet-may-hide, 1 runtime/feed-silence, 10 execution-missing cases.
   - Exploratory regression gate: pass; 0 major cases, 0 quiet-may-hide, 1 runtime/feed-silence, 6 post-noise watch, 4 support/resistance watch, 2 support/resistance unproven-coverage.

Current conclusion:

- The candle engine is in a stronger place than the older reports suggested. Several earlier "unproven" or "watch" results were audit-reader file-format issues, not candle-engine failures.
- The best remaining candle-engine work is not random tuning. It is:
  - complete daily/4h coverage for missing symbols such as `AIOS`, `AKAN`, `BYND`, `CYCU`, `FATN`, `HCAI`, `NOK`, `OSRH`, `SOBR`, and `WTO`
  - review `WTO`, `ABTS`, and `XTLB` low-confidence market-structure replay cases
  - separate true missing candle ranges from legitimate no-bar/off-hours ranges in the backfill priority planner
  - keep volume enrichment operator/audit-first until the 94 may-help examples are manually reviewed for trader value

Verification for this pass:

```powershell
npx tsx --test src/tests/warehouse-volume-activity-report.test.ts src/tests/dynamic-reference-calibration-report.test.ts src/tests/market-structure-calibration-report.test.ts src/tests/stable-structure-discord-alignment.test.ts src/tests/execution-relation-replay-report.test.ts src/tests/advanced-candle-context-report.test.ts src/tests/provider-comparison-readiness-report.test.ts src/tests/candle-intelligence-regression-pack.test.ts
npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run structure:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run candles:dynamic-calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run volume:warehouse -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run candles:advanced-context -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:execution-relations -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:missed-moves -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:eod-verdict -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:session-behavior -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run candles:regression-pack -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --max-cases-per-type 10
npm run candles:regression-gate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --preset exploratory --no-fail
```

Focused result so far:

- targeted calibration tests: 18 passing, 0 failing
- `npm run build`: passing
- `npm test`: 649 passing, 0 failing

## Latest Warehouse Backfill Refinement - 2026-05-03

Completed after the full calibration pass:

1. Fixed the missing-candle model for sparse small-cap data.
   - The warehouse backfill planner no longer treats every missing `1m` / `5m` timestamp as a provider failure.
   - Intraday gaps outside the 04:00-20:00 ET extended session are now classified as likely no-bar/off-hours gaps.
   - Intraday gaps inside an already-covered candle span are now treated as likely sparse/no-trade gaps instead of endlessly refetching IBKR.
   - Daily gaps before available candle history and weekend daily slots are now classified as likely no-bar/history-unavailable gaps.
   - `4h` gaps outside likely trading windows and older gaps before available `4h` history are now no-bar/history-unavailable, not urgent provider work.

2. Added report evidence for those classifications.
   - `candle-backfill-priority.json` now includes `likelyNoBarMissingCandleCountEstimate` on ranked tasks.
   - `candle-backfill-priority.md` now prints likely no-bar/off-hours gap counts and explains that they are not ranked as provider backfill work.
   - The planner still keeps tail gaps actionable when the warehouse has candles earlier in the requested range but nothing near the requested as-of time.

3. Tuned market-structure calibration trust.
   - Stable market structure can now be trusted for suppression when one low-confidence replay case is outweighed by clear same-structure repeat or raw-chop suppression evidence.
   - Current May 1 market-structure result: 20 symbols, 18 trusted-for-suppression, 2 watch-structure-chop (`ABTS`, `XTLB`), 0 operator-only, 0 insufficient-evidence.

4. Ran two bounded IBKR-backed backfill stages after the planner fix.
   - `backfill-stage-1-final-coverage`: 2 planned, 2 attempted, 2 fetched, 0 failed, 636 candles stored.
   - `backfill-stage-fetch-next-coverage`: 10 planned, 10 attempted, 10 fetched, 0 failed.
   - After those runs, `candles:backfill-priority` dropped to 24 missing tasks, 0 fetch-first, 6 fetch-next, 18 fetch-later.
   - Remaining fetch-next tasks are mostly optional `1m` trade-window coverage; remaining fetch-later tasks are broad historical daily/4h/1m coverage for lower-priority symbols.

5. Current May 1 audit status after the refinement.
   - Support/resistance calibration remains 18 symbols, 12 trusted, 4 watch, 0 broken, 2 unproven, 0 no-forward-resistance, 6 coverage gaps.
   - Why-no-post proof remains healthy: 18 symbols, 8 quiet-supported, 0 quiet-may-hide, 1 runtime/feed-silence, 0 missing-candle unproven.
   - Backfill priority now separates 9,800 likely no-bar/history-unavailable candles from the remaining 8,470 actionable/optional missing candles.

Current conclusion:

- The warehouse is now much safer for small caps: it does not keep asking IBKR for overnight, weekend, pre-history, or sparse no-trade gaps.
- There are no remaining fetch-first candle gaps for the May 1 audit.
- The next useful data work is optional broader `1m` trade-window coverage and lower-priority historical coverage, not urgent provider troubleshooting.

Verification for this refinement:

```powershell
npx tsx --test src/tests/durable-candle-warehouse.test.ts src/tests/candle-backfill-priority-report.test.ts src/tests/candle-warehouse-backfill-report.test.ts
npm run candles:backfill-priority -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03 --max-tasks-per-stage 10 --max-candles-per-stage 5000
npm run levels:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run structure:calibrate -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run audit:why-no-post -- artifacts\long-run\2026-05-01_10-48-03 --warehouse data\candles
npm run build
npm test
git diff --check
```

Final verification result:

- targeted warehouse/backfill/structure tests: 22 passing, 0 failing
- `npm run build`: passing
- `npm test`: 653 passing, 0 failing
- `git diff --check`: clean

## Resource Pause / New-Chat Handoff - 2026-05-03

The latest run was paused because the local machine appeared resource-constrained during broad all-session scans. Heavy all-session commands should not be repeated immediately in the same chat/session without first narrowing scope or optimizing the report path.

Completed just before the pause:

1. Finished the remaining May 1 `fetch_next` candle coverage.
   - Command used: `npm run candles:backfill -- artifacts\long-run\2026-05-01_10-48-03 --priority-report artifacts\long-run\2026-05-01_10-48-03\candle-backfill-priority.json --priority-stage 1 --warehouse data\candles --out-dir artifacts\long-run\2026-05-01_10-48-03\backfill-fetch-next-1m-trade-window --execute --timeout-ms 180000 --throttle-ms 1200`
   - Result: 6 planned, 6 attempted, 6 fetched, 0 failed.

2. Regenerated May 1 priority and core audits after that fetch.
   - Backfill priority: 18 missing tasks, 0 fetch-first, 0 fetch-next, 18 fetch-later.
   - Estimated actionable/optional missing candles: 5,612.
   - Likely no-bar/history-unavailable candles separated: 9,972.
   - Support/resistance calibration: 18 symbols, 12 trusted, 4 watch, 0 broken, 2 unproven, 0 no-forward-resistance, 6 coverage gaps.
   - Market-structure calibration: 20 symbols, 18 trusted-for-suppression, 2 watch, 296 repeats.
   - Why-no-post proof: 18 symbols, 8 quiet-supported, 0 quiet-may-hide, 1 runtime/feed-silence, 0 missing-candle unproven.

3. Reviewed remaining May 1 support/resistance watch/unproven cases.
   - `FATN`: unproven mostly because there was no after-post 5m reaction proof; ladder itself has nearby support/resistance but crowded weak 5m levels.
   - `NOK`: unproven because levels were not touched enough after the first post; forward ladder exists and no no-resistance bug is present.
   - `ISPC`: watch due crowded nearby support cluster; support evidence is trusted, resistance was mostly untested.
   - `LABT`: watch due sparse daily/4h history and weak support reaction evidence.
   - `PBM`: watch due crowded nearby resistance cluster and one broken near-distance bucket; structure supports treating it as a practical zone.
   - `WTO`: watch due crowded nearby resistance cluster and limited after-post proof; resistance evidence itself is mostly trusted.

4. Reviewed remaining market-structure watch cases.
   - `ABTS`: watch because raw flips were mostly immaterial small-cap wiggles and one replay case was low-confidence.
   - `XTLB`: watch because one case had insufficient candles and both replay cases were low-confidence.
   - Current conclusion: both should remain operator/suppression-only until broader saved/live evidence improves confidence.

5. Started broad all-session calibration with the new no-bar logic.
   - Completed support/resistance all-session report: 57 symbols, 18 trusted, 8 watch, 2 broken, 29 unproven, 29 no-forward-resistance, 81 coverage gaps, gate fail.
   - Completed market-structure all-session report: 57 symbols, 19 trusted, 1 watch, 917 repeats.
   - Heavy broad all-session backfill-priority timed out after roughly 15 minutes.
   - Heavy broad all-session import-readiness timed out after roughly 5 minutes.
   - Heavy broad all-session why-no-post proof timed out after roughly 15 minutes.

New handoff file:

- `docs/72_CANDLE_INTELLIGENCE_HANDOFF_FOR_NEW_CHAT_2026-05-03.md`

Recommended next chat sequence:

1. Do not rerun the heavy all-session backfill-priority / import-readiness / why-no-post commands immediately.
2. First optimize or bound those broad reports by date/session count/symbol count.
3. Then continue with the planned step 5: support/resistance quality calibration and forward-ladder improvement.
4. Treat May 1 as clean enough for next engineering work: no fetch-first or fetch-next candle gaps remain for that session.

Follow-up completed after this handoff:

- Added bounded all-session report support with `--max-sessions`.
- `levels:calibrate`, `candles:import-readiness`, `audit:why-no-post`, and `candles:backfill-priority` can now cap the resolved saved-session audit files before loading rows, replaying posts, or reading candle evidence.
- The composed backfill-priority path now passes that cap into import readiness, why-no-post proof, all-symbol stress, and support/resistance calibration, avoiding the previous hidden all-session scan inside the aggregate report.
- Bounded smoke commands completed:
  - `npm run levels:calibrate -- --all-sessions --max-sessions 1 --max-symbols 5 --warehouse data\candles --output artifacts\support-resistance-calibration-smoke-max-sessions`
  - `npm run candles:import-readiness -- --all-sessions --max-sessions 1 --max-trades 5 --warehouse data\candles --out-dir artifacts\candle-import-readiness-smoke-max-sessions`
  - `npm run audit:why-no-post -- --all-sessions --max-sessions 1 --warehouse data\candles --out-dir artifacts\why-no-post-smoke-max-sessions`
  - `npm run candles:backfill-priority -- --all-sessions --max-sessions 1 --max-trades 5 --warehouse data\candles --out-dir artifacts\candle-backfill-priority-smoke-max-sessions --max-tasks-per-stage 5 --max-candles-per-stage 1000`
- Verification for the bounded-report pass:
  - focused report tests: 24 passing, 0 failing
  - accidental full `npm test`: 656 passing, 0 failing
  - `npm run build`: passing
  - `git diff --check`: clean

## Phase 9: Provider Readiness

Goal: make switching away from IBKR safe later.

Status: provider/backfill readiness now includes price, dynamic, structure, volume, and level drift evidence as of 2026-05-03.

Implemented:

- backfill task readiness labels in `executeCandleWarehouseBackfill(...)`
- provider-readiness explanation in `candle-warehouse-backfill.md`
- tests in `src/tests/candle-warehouse-backfill-report.test.ts` and `src/tests/durable-candle-warehouse.test.ts`
- `npm run candles:provider-compare` now compares cached provider coverage, latest-close drift, average-volume drift, VWAP/EMA drift, 5m market-structure drift, and basic support/resistance count drift before a future provider switch is trusted.

Work to complete:

1. Add provider comparison reports. Status: complete.
2. Compare candle coverage. Status: complete.
3. Compare support/resistance drift. Status: complete for count/forward-resistance drift.
4. Compare VWAP/EMA drift. Status: complete for cached 5m candles.
5. Compare market-structure drift. Status: complete for cached 5m state/confidence drift.
6. Compare volume baseline drift. Status: complete for average cached volume drift.
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
