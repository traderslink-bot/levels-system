# Levels System 15m Cache Collection Plan

## Purpose

This document defines the safe collection and storage boundary for 15m candle
cache data used by `LevelAnalysisSnapshot` supplied-15m validation.

The immediate goal is operational readiness: make it clear how 15m candles
should be collected, stored, inspected, and later validated without changing
LevelEngine behavior or support/resistance detection.

This is a cache planning and inspection gate only. It does not implement live
fetching, change runtime defaults, change alert/monitoring/Discord behavior, or
add journal interpretation.

## Current Cache State

The current local validation cache was inspected with:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at 2026-06-01T00:00:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/15m-cache-coverage-current.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/15m-cache-coverage-current.txt
```

Current compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/15m-cache-coverage-current.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/15m-cache-coverage-current.txt
```

Summary:

| Metric | Count |
| --- | ---: |
| Cache JSON files | 2274 |
| Validation cache entries | 2274 |
| Providers | 2 (`ibkr`, `stub`) |
| Provider/symbol groups | 357 |
| Groups with `5m`/`4h`/`daily` | 355 |
| Groups with any `15m` | 0 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |
| Groups missing `15m` among complete `5m`/`4h`/`daily` groups | 355 |

The local real cache has no 15m candle data today.

## Why 15m Cache Is Needed

`LevelAnalysisSnapshot` can now include additive `timeframeFacts["15m"]` when
15m candles are supplied. Deterministic fixture coverage proves that the facts
builder is stable and does not change LevelEngine output.

Real-cache supplied-15m validation is still blocked because the local validation
cache does not contain 15m files. Collecting 15m cache data enables:

- supplied-15m real-cache snapshot validation;
- real symbol coverage for `FifteenMinuteFacts`;
- no-lookahead checks against real 15m windows;
- confirmation that 15m facts remain additive and outside LevelEngine;
- batch manifest coverage that distinguishes missing, limited, and available
  15m fact states.

## Existing Cache Format

The existing validation cache convention is:

```text
.validation-cache/candles/<provider>/<SYMBOL>/<timeframe>/<lookbackBars>-<endTimeMs>.json
```

For 15m IBKR cache files:

```text
.validation-cache/candles/ibkr/<SYMBOL>/15m/<lookbackBars>-<endTimeMs>.json
```

The cache entry shape is the existing `ValidationCachedCandleFetchService`
wrapper:

```ts
type ValidationCandleCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: "15m";
    lookbackBars: number;
    endTimeMs: number;
    provider: "ibkr" | "stub" | "twelve_data";
  };
  response: CandleProviderResponse;
};
```

The 15m collection path must reuse this wrapper and directory shape. It must
not create a second incompatible cache format.

## Required Provider And Timeframe Layout

Target provider for real validation:

```text
ibkr
```

Required snapshot validation timeframes:

- `5m`
- `15m`
- `4h`
- `daily`

Required per-symbol layout:

```text
.validation-cache/candles/ibkr/<SYMBOL>/5m/*.json
.validation-cache/candles/ibkr/<SYMBOL>/15m/*.json
.validation-cache/candles/ibkr/<SYMBOL>/4h/*.json
.validation-cache/candles/ibkr/<SYMBOL>/daily/*.json
```

The 15m files are optional for existing snapshot generation, but required for
the next supplied-15m real-cache validation gate.

## Target Symbol Set

Start with symbols already used in recent real-cache validation:

```text
DEVS, ENVX, DXYZ, QUBT, GME
```

Then expand to the previous broader real-cache validation set:

```text
DEVS, ENVX, AIM, PBM, DXYZ, YMAT, HCWB, MEHA, INM, EZGO, SOWG, CLPS, AAOI, FLEX, QUBT, GME, PHOE
```

After the focused set passes, collection can expand across the 355 current
provider/symbol groups with complete `5m`/`4h`/`daily` coverage.

## Target Lookback And Depth

The first supplied-15m validation pass should use a practical lookback that is
large enough for the deterministic 15m facts thresholds:

- minimum useful depth: at least 4 closed 15m candles;
- focused validation target: 100 15m candles;
- broader validation target: match the existing cache request style by using
  `<lookbackBars>-<endTimeMs>.json` filenames and preserving request metadata.

The exact lookback should be explicit in any future collection command. It
should not be hidden in code defaults.

## Fetch And Collection Strategy

Preferred next implementation:

```text
src/scripts/collect-15m-validation-cache.ts
```

The future collection tool should:

- require explicit `--symbols`;
- require explicit `--provider`;
- require explicit `--cache-root`;
- require explicit `--lookback-bars`;
- require explicit `--end-time`;
- support `--dry-run`;
- default to dry-run or require an explicit write flag;
- reuse `ValidationCachedCandleFetchService` cache writing conventions;
- avoid hardcoded local paths;
- avoid hardcoded credentials;
- avoid CI usage;
- write only validation-cache files, not snapshot artifacts.

This gate intentionally does not implement live fetching. The provider boundary
is left untouched until the collection tool gate.

## Validation Strategy

Before collection:

1. Run `inspect-15m-cache-coverage.ts` against the target cache root.
2. Confirm current 15m gaps by symbol.
3. Confirm `5m`/`4h`/`daily` coverage is present for target symbols.

After collection:

1. Re-run `inspect-15m-cache-coverage.ts`.
2. Confirm `groupsWithAny15m` increased.
3. Confirm target symbols now have `5m`/`15m`/`4h`/`daily`.
4. Run supplied-15m real-cache snapshot validation.
5. Confirm `timeframeFacts["15m"]` appears for supplied 15m symbols.
6. Confirm LevelEngine output remains unchanged versus no-15m snapshots.
7. Confirm safety flags and no-lookahead diagnostics remain factual.

## Storage Location

Default local storage should remain:

```text
.validation-cache/candles
```

Operators may override this with an explicit `--cache-root` when collecting or
inspecting cache coverage. The cache root is intentionally outside committed
source artifacts.

## Safety Rules

15m cache collection must:

- be explicit and operator-triggered;
- avoid network calls in tests;
- avoid provider calls in inspection scripts;
- avoid committing raw cache files;
- preserve existing validation cache wrapper shape;
- keep 15m outside LevelEngine support/resistance generation;
- keep runtime defaults unchanged;
- keep alert, monitoring, and Discord paths unchanged;
- avoid journal scoring, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## No-Lookahead Requirements

15m cache files may contain candles beyond a requested snapshot as-of boundary.
That is acceptable only because snapshot builders filter by candle close before
building facts.

Supplied-15m validation must confirm:

- future 15m candles are excluded;
- still-forming 15m candles are excluded;
- excluded 15m counts are reported in `inputSummary`;
- 15m fact diagnostics remain factual;
- appending future or partial 15m candles does not change as-of facts or
  LevelEngine output.

## Retry And Failure Handling

The future collection tool should report, not hide:

- provider failures;
- empty responses;
- incomplete candle windows;
- malformed cache writes;
- symbols skipped by operator choice;
- symbols with `5m`/`4h`/`daily` but missing `15m`;
- symbols with 15m responses below the useful fact threshold.

Retries should be explicit and bounded. A failed symbol should not block
inspection of other cached symbols.

## Artifact Retention Rules

Commit only compact summaries and planning artifacts, such as:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/*.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/*.txt
```

Do not commit raw `.validation-cache` candle files or bulky generated snapshots
from real-cache runs.

## How This Enables Supplied-15m Real-Cache Validation

Once target symbols have cached 15m files, the existing snapshot path can load
the latest 15m cache selection and pass it to:

```text
buildLevelAnalysisSnapshotFromCandles({ candles15m: ... })
```

Expected supplied-15m real-cache validation outcomes:

- `inputSummary.candleCounts["15m"]` is positive;
- `inputSummary.filteredCandleCounts["15m"]` is positive when closed candles
  exist;
- `timeframesPresent` includes `15m` when filtered 15m candles are present;
- `timeframeFacts["15m"]` exists;
- 15m facts validate against the additive contract;
- `levelEngineOutput` remains unchanged versus no-15m input;
- diagnostics remain factual.

## Inspection Helper Added

This gate adds:

```text
src/scripts/inspect-15m-cache-coverage.ts
```

The helper:

- accepts `--cache-root`;
- scans providers, symbols, and `5m`/`15m`/`4h`/`daily` directories;
- counts JSON files by timeframe;
- detects missing 15m coverage;
- counts malformed JSON without throwing;
- ignores non-JSON files;
- can write compact JSON and text summaries;
- makes no network or provider calls;
- mutates nothing except requested summary outputs.

Focused deterministic tests use temporary cache-shaped directories and do not
touch the real local cache.

## Anti-Goals

This gate does not:

- collect live 15m data;
- implement provider credentials or connection handling;
- alter LevelEngine input selection;
- tune support/resistance detection;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_tool
```

Reason: this gate adds a deterministic cache inspection helper and documents
the collection boundary, but it intentionally does not implement live fetching.
The next safe step is a dry-run-first collection tool that reuses the existing
validation cache writer and can populate 15m files for selected symbols.
