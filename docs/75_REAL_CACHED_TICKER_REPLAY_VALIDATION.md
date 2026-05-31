# Real Cached Ticker Replay Validation

## Scope

This review validates `LevelAnalysisSnapshot` against actual cached candle data found in the local worktree. The goal is to test the snapshot contract on real cached candles without changing support/resistance detection, LevelEngine behavior, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, or adding journal grading/coaching/P&L/giveback behavior.

No network calls were made. The cached candle arrays were extracted into deterministic review fixtures so the generated snapshot artifacts can be inspected without depending on the live local cache.

## Cache Locations Inspected

| Location | Result |
| --- | --- |
| `C:\Users\jerac\Documents\TraderLink\levels-system-rescue-only\.validation-cache\` | Not present in clean validation checkout |
| `C:\Users\jerac\Documents\TraderLink\levels-system-rescue-only\artifacts\` | Not present in clean validation checkout |
| `C:\Users\jerac\Documents\TraderLink\levels-system-rescue-only\data\` | Not present in clean validation checkout |
| `C:\Users\jerac\Documents\TraderLink\levels-system-rescue-only\docs\examples\` | Present, but contains deterministic example fixtures rather than real cached ticker data |
| `C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\` | Present and usable offline |
| `C:\Users\jerac\Documents\TraderLink\levels-system\artifacts\` | Present, mostly validation/replay artifacts rather than direct candle runner inputs |
| `C:\Users\jerac\Documents\TraderLink\levels-system\data\` | Present, but not needed once `.validation-cache\candles` was found |

The cache implementation confirms the default validation cache path is:

```text
.validation-cache/candles
```

The usable cache found in the original workspace contained:

- Providers: `ibkr`, `stub`
- Candle cache JSON files: `2265`
- Provider/symbol groups: `356`
- Provider/symbol groups with `5m`, `4h`, and `daily` folders: `354`

## Selected Real-Cache Scenarios

The validation used five IBKR-backed symbols with `5m`, `4h`, and `daily` candle coverage:

| Scenario | Symbol | As Of | Reference | Previous Close | 5m Candles | 4h Candles | Daily Candles |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Low-price runner | `DEVS` | `2026-05-29T13:40:00.000Z` | `0.2592` | `0.127` | `68` | `114` raw, `113` after as-of filtering | `455` raw, `454` after as-of filtering |
| Clean technical mover | `ENVX` | `2026-05-22T15:25:00.000Z` | `6.73` | `6.26` | `89` | `118` raw, `117` after as-of filtering | `501` raw, `500` after as-of filtering |
| Choppy ticker | `AIM` | `2026-05-28T14:00:00.000Z` | `0.373` | `0.3815` | `72` | `114` raw, `113` after as-of filtering | `502` raw, `501` after as-of filtering |
| Thin-liquidity ticker | `PBM` | `2026-05-07T12:15:00.000Z` | `6.07` | `5.98` | `51` | `108` raw, `107` after as-of filtering | `501` raw, `500` after as-of filtering |
| Higher-priced stock | `DXYZ` | `2026-05-15T11:55:00.000Z` | `46.47` | `48.94` | `47` | `117` raw, `116` after as-of filtering | `501` raw, `500` after as-of filtering |

## Input Fixture Paths

The committed fixtures were extracted directly from the local validation candle cache:

- `docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/`
- `docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/`
- `docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/`
- `docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/`
- `docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/`

Each fixture folder includes:

- `metadata.json`
- `5m-candles.json`
- `4h-candles.json`
- `daily-candles.json`

## Commands Run

Cache inspection:

```powershell
rg --files .validation-cache
rg --files data
rg --files artifacts
```

Snapshot generation:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol DEVS --as-of 2026-05-29T13:40:00.000Z --reference-price 0.2592 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/low-price-runner-devs/daily-candles.json --previous-close 0.127 --out docs/examples/level-analysis-snapshot/real-cache-outputs/low-price-runner-devs-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol ENVX --as-of 2026-05-22T15:25:00.000Z --reference-price 6.73 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/clean-technical-envx/daily-candles.json --previous-close 6.26 --out docs/examples/level-analysis-snapshot/real-cache-outputs/clean-technical-envx-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol AIM --as-of 2026-05-28T14:00:00.000Z --reference-price 0.373 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/choppy-aim/daily-candles.json --previous-close 0.3815 --out docs/examples/level-analysis-snapshot/real-cache-outputs/choppy-aim-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol PBM --as-of 2026-05-07T12:15:00.000Z --reference-price 6.07 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/thin-liquidity-pbm/daily-candles.json --previous-close 5.98 --out docs/examples/level-analysis-snapshot/real-cache-outputs/thin-liquidity-pbm-snapshot.json
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol DXYZ --as-of 2026-05-15T11:55:00.000Z --reference-price 46.47 --candles-5m docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/real-cache-fixtures/higher-priced-dxyz/daily-candles.json --previous-close 48.94 --out docs/examples/level-analysis-snapshot/real-cache-outputs/higher-priced-dxyz-snapshot.json
```

Validation:

```powershell
npx tsc --noEmit
npm test
```

## Output Snapshot Paths

- `docs/examples/level-analysis-snapshot/real-cache-outputs/low-price-runner-devs-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/clean-technical-envx-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/choppy-aim-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/thin-liquidity-pbm-snapshot.json`
- `docs/examples/level-analysis-snapshot/real-cache-outputs/higher-priced-dxyz-snapshot.json`

## Cross-Symbol Findings

| Symbol | Nearest Support | Nearest Resistance | Extensions | Real | Synthetic | Extension Coverage | Shelves | Audit Warning |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| `DEVS` | `0.2264` | `0.2624` | `3` | `3` | `0` | Support only, `49.8457%` downside | `5` | `no_resistance_extension_coverage` |
| `ENVX` | `6.68` | `6.8` | `4` | `4` | `0` | `46.5082%` upside, `16.9391%` downside | `5` | `limited_downside_extension_coverage` |
| `AIM` | `0.35` | `0.375` | `3` | `3` | `0` | Support only, `24.1555%` downside | `4` | `no_resistance_extension_coverage` |
| `PBM` | `5.91` | `6.09` | `3` | `3` | `0` | Support only, `66.8863%` downside | `2` | `no_resistance_extension_coverage` |
| `DXYZ` | `45.8` | `46.8` | `4` | `4` | `0` | `45.6639%` upside, `48.3538%` downside | `2` | None |

All five snapshots include:

- `schemaVersion: level-analysis-snapshot/v1`
- `producer: levels-system`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `safety.noLookaheadApplied: true`
- `safety.levelOutputUnchanged: true`
- `safety.factsOnlyVWAP: true`
- `safety.shelvesAreFactsOnly: true`
- `safety.noRuntimeBehaviorChange: true`

## Per-Symbol Review

### DEVS

- Scenario: low-price runner.
- Nearest support/resistance are both present.
- Major/intermediate/intraday level arrays are populated, with heavier support than resistance.
- Extension levels are real historical/candidate extensions only.
- No resistance extension coverage was present in this snapshot.
- Session facts, volume facts, shelves, market context, intelligence report, and quality audit are all present.
- Useful for TraderLink Intelligence / journal consumption, but forward resistance planning remains weak for this real-cache runner example.

### ENVX

- Scenario: clean technical mover.
- Nearest support/resistance are both close to reference price.
- Major/intermediate levels are available; intraday levels are absent after candidate selection.
- Extension coverage is two-sided, but downside coverage is shallow at `16.9391%`.
- Session facts, volume facts, shelves, market context, intelligence report, and quality audit are all present.
- Useful for downstream consumption, with a clear quality-audit flag for limited downside extension coverage.

### AIM

- Scenario: choppy ticker.
- Nearest support/resistance are both present.
- Major/intermediate/intraday levels are available.
- Extension levels are support-only real candidate extensions.
- No resistance extension coverage was present.
- Session facts, volume facts, shelves, market context, intelligence report, and quality audit are all present.
- Useful for range/context inspection, but extension planning remains one-sided.

### PBM

- Scenario: thin-liquidity ticker.
- Nearest support/resistance are both present.
- Major/intermediate and one intraday resistance level are available.
- Extension levels are support-only real candidate extensions.
- No resistance extension coverage was present.
- Session facts, volume facts, shelves, market context, intelligence report, and quality audit are all present.
- Useful for thin-liquidity chart context, with the expected caveat that extension coverage can remain sparse.

### DXYZ

- Scenario: higher-priced stock.
- Nearest support/resistance are both present.
- Major/intermediate/intraday support and major/intermediate resistance are available.
- Extension coverage is healthy on both sides.
- Session facts, volume facts, shelves, market context, intelligence report, and quality audit are all present.
- This is the cleanest real-cache validation case in this batch.

## No-Lookahead / As-Of Observations

The runner used explicit `asOfTimestamp` values derived from the latest cached 5m candle close time. The snapshot builder applied candle-close/as-of filtering before building the LevelEngine output and facts.

Observed output:

- `safety.noLookaheadApplied` is `true` for all five snapshots.
- `diagnostics` includes `candle_close_as_of_filter_applied` for all five snapshots.
- 5m future/partial excluded counts are `0` because the selected as-of values were set after the latest cached 5m candle close.
- Some latest 4h/daily candles were excluded by close-time semantics, which is expected for no-lookahead replay safety.

## Synthetic Extension Labeling

The snapshots preserve `safety.syntheticExtensionsClearlyMarked: true`, but this selected real-cache batch did not produce synthetic continuation-map extension rows.

That means this validation confirms the contract can carry the synthetic labeling safety flag, but it does not visually validate synthetic rows on these real cached symbols. More importantly, `DEVS`, `AIM`, and `PBM` still showed no resistance extension coverage. That should be reviewed before locking the snapshot as final `v1`.

## Problems Found

- The clean validation checkout did not contain `.validation-cache`, `artifacts`, or `data`; the real cache was only available in the original local workspace.
- Three of five real-cache snapshots had no resistance extension coverage.
- One snapshot had limited downside extension coverage.
- No synthetic continuation-map extension rows appeared in this real-cache batch, even where resistance extension coverage was absent.
- The snapshot remains useful as a contract, but extension behavior should be reviewed against real-cache examples before `schemaVersion` is considered locked beyond `v1 candidate`.

## TraderLink Intelligence / Journal Usefulness

The real-cache snapshots are useful for TraderLink Intelligence / journal consumption as factual chart-analysis payloads.

Downstream consumers can directly use:

- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- major/intermediate/intraday levels
- extension levels
- session facts
- volume facts
- volume shelves
- market context
- level intelligence report
- level quality audit
- no-lookahead safety flags

They should not infer trade grades, coaching, P/L, giveback, or behavioral scoring from this payload.

## Recommended Next Gate

Recommended next gate: `real_cache_extension_coverage_review`.

Rationale: real cached candle replay proves the snapshot contract works offline on actual cached IBKR candle data, but it also surfaces recurring one-sided extension coverage and no synthetic continuation-map rows in the selected real-cache batch. Review extension fallback behavior on these actual cached snapshots before locking the snapshot schema as final `v1`.
