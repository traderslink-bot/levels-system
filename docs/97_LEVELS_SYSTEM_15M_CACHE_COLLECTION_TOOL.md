# Levels System 15m Cache Collection Tool

## Purpose

This gate adds a safe, explicit, dry-run-first tool for planning and writing
15m validation-cache files.

The tool exists so supplied-15m real-cache validation can be prepared without
changing LevelEngine behavior, support/resistance detection, runtime defaults,
alerts, monitoring, Discord behavior, or journal interpretation.

## Tool

Script:

```text
src/scripts/collect-15m-validation-cache.ts
```

Package script:

```text
npm run cache:collect:15m -- <args>
```

The command plans or writes only `15m` validation cache files.

## Required Arguments

```text
--cache-root <path>
--symbols <comma-separated>
--provider <provider>
--lookback-bars <number>
--end-time <timestamp|ISO>
```

Supported provider names:

- `ibkr`
- `stub`
- `twelve_data`

The command requires explicit symbols, lookback bars, and end time. It never
collects all symbols by default.

## Safety Arguments

```text
--dry-run
--write
--overwrite
```

Default behavior is dry-run when `--write` is not supplied.

`--dry-run` and `--write` are mutually exclusive. Existing files are skipped by
default in write mode. `--overwrite` is required to replace an existing cache
file.

## Dry-Run Usage

Example:

```text
npm run cache:collect:15m -- --cache-root .validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --dry-run
```

Dry-run mode:

- normalizes symbols;
- normalizes end time to a 15m boundary;
- prints planned output paths;
- performs no provider calls;
- writes no files.

## Write Usage

Example with deterministic stub data:

```text
npm run cache:collect:15m -- --cache-root .validation-cache/candles --provider stub --symbols TEST --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Write mode:

- writes only `15m` validation-cache files;
- uses the existing validation cache wrapper shape;
- skips existing files unless `--overwrite` is supplied;
- records per-symbol failures instead of stopping the whole batch.

Live `ibkr` and `twelve_data` 15m provider hookup is intentionally not wired in
this gate because the existing historical provider abstraction is still typed
around the LevelEngine timeframes. For those providers, write mode fails with
an actionable message. Dry-run mode remains available for planning live cache
paths.

## Cache Output Layout

The tool uses the existing validation cache layout:

```text
.validation-cache/candles/<provider>/<SYMBOL>/15m/<lookbackBars>-<endTimeMs>.json
```

Example:

```text
.validation-cache/candles/ibkr/DEVS/15m/100-1780329600000.json
```

## Wrapper Format

The written wrapper shape is:

```ts
type FifteenMinuteValidationCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: "15m";
    lookbackBars: number;
    endTimeMs: number;
    provider: "ibkr" | "stub" | "twelve_data";
  };
  response: {
    provider: "ibkr" | "stub" | "twelve_data";
    symbol: string;
    timeframe: "15m";
    requestedLookbackBars: number;
    candles: Candle[];
    fetchStartTimestamp: number;
    fetchEndTimestamp: number;
    requestedStartTimestamp: number;
    requestedEndTimestamp: number;
    sessionMetadataAvailable: boolean;
    actualBarsReturned: number;
    completenessStatus: "complete" | "partial" | "empty";
    stale: boolean;
    validationIssues: unknown[];
    sessionSummary: null;
  };
};
```

This matches the existing validation-cache wrapper contract while reserving the
`15m` timeframe for snapshot facts.

## Provider Requirements

Live provider hookup should be added only when the 15m request path can reuse
the existing connection/config conventions safely.

The future live hookup should:

- use explicit operator-provided symbols;
- use explicit operator-provided lookback and end time;
- use explicit cache root;
- avoid hardcoded credentials;
- fail clearly when provider credentials or connections are unavailable;
- keep tests fully fake-provider based.

## Failure Handling

The tool records each symbol independently.

Failure cases include:

- provider unavailable;
- provider throws;
- provider returns zero candles;
- existing file skipped without `--overwrite`;
- malformed CLI symbols;
- unsupported provider names;
- conflicting `--dry-run` and `--write` flags.

Failures are printed in the compact summary. In CLI write mode, any failed
symbol exits with a non-zero process code.

## Validation Workflow After Collection

After any real 15m collection run:

1. Run `inspect-15m-cache-coverage.ts` against the cache root.
2. Confirm target symbols have `15m` files.
3. Confirm target symbols also have `5m`, `4h`, and `daily`.
4. Run supplied-15m real-cache snapshot validation.
5. Confirm `timeframeFacts["15m"]` exists.
6. Confirm `levelEngineOutput` remains unchanged versus the same snapshots
   without 15m input.
7. Confirm no-lookahead and diagnostics remain factual.

## Inspection Compatibility

The collection tests verify that files written by
`collect-15m-validation-cache.ts` are detected by:

```text
src/scripts/inspect-15m-cache-coverage.ts
```

This gives the next gate a direct before/after coverage check.

## Safety Rules

The tool must not:

- call providers in dry-run mode;
- write anything unless `--write` is supplied;
- collect all symbols by default;
- commit raw cache files;
- run automatically in CI;
- change LevelEngine inputs;
- change support/resistance detection;
- change alert, monitoring, or Discord behavior;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Artifact Retention

Do not commit raw `.validation-cache` outputs.

Commit only compact summaries or docs under:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection/
```

## Anti-Goals

This gate does not:

- collect live IBKR 15m data;
- alter the historical provider abstraction;
- tune LevelEngine or support/resistance behavior;
- run supplied-15m real-cache validation;
- modify the journal app;
- add trading interpretation.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_dry_run
```

Reason: the tool is dry-run-first and tested, but it has not been used against
a live provider. The next safe operational step is a dry-run with the target
symbols and cache root, then a separate provider-hookup/write decision.
