# Levels System 15m Live Provider Hookup Tool

## Purpose

This gate adds the structural live-provider hookup surface for the 15m
validation-cache collection tool.

The collection tool remains dry-run-first. Live provider use is available only
behind explicit write mode, clear provider configuration, and operator
execution. Tests remain fake-provider based and do not call live providers.

This gate does not collect real 15m cache data, change LevelEngine behavior,
change support/resistance detection, change runtime defaults, change alert,
monitoring, or Discord behavior, or add journal interpretation.

## Provider-Capability Separation

The implementation keeps the existing LevelEngine timeframe contract unchanged:

```ts
type CandleTimeframe = "daily" | "4h" | "5m";
type LevelEngineEligibleTimeframe = CandleTimeframe;
```

It adds a separate provider-capability lane:

```ts
type ProviderCandleTimeframe = "daily" | "4h" | "15m" | "5m";
type ValidationCacheCollectionTimeframe = ProviderCandleTimeframe;
```

Runtime helpers make the boundary testable:

```ts
isLevelEngineEligibleTimeframe("15m") === false
isProviderCandleTimeframe("15m") === true
```

The important rule is unchanged: provider fetch capability may include `15m`,
but LevelEngine support/resistance generation remains limited to `daily`,
`4h`, and `5m`.

## Fetch Planning

Provider-capability fetch planning now supports `15m`:

| Timeframe | Interval ms | IBKR bar size | Twelve Data interval |
| --- | ---: | --- | --- |
| `daily` | `86400000` | `1 day` | `1day` |
| `4h` | `14400000` | `4 hours` | `4h` |
| `15m` | `900000` | `15 mins` | `15min` |
| `5m` | `300000` | `5 mins` | `5min` |

The existing `buildHistoricalFetchPlan` path remains compatible with the
LevelEngine-eligible `CandleTimeframe` request shape. The new provider plan
path is available through `buildProviderHistoricalFetchPlan`.

## CLI Behavior

The operator command shape remains:

```text
npm run cache:collect:15m -- --cache-root <path> --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Required arguments remain:

- `--cache-root`
- `--provider`
- `--symbols`
- `--lookback-bars`
- `--end-time`

Safety arguments remain:

- `--dry-run`
- `--write`
- `--overwrite`

## Dry-Run Behavior

Dry-run behavior is unchanged:

- default mode is dry-run when `--write` is absent;
- no provider is constructed;
- no provider calls are made;
- no files are written;
- output paths are planned deterministically.

This allows dry-run planning without credentials or live provider availability.

## Write Behavior

Write mode remains explicit:

- no write occurs without `--write`;
- existing files are skipped unless `--overwrite` is supplied;
- the tool writes only 15m validation-cache wrapper files;
- each requested symbol is reported independently;
- any failed write causes non-zero CLI exit status.

Injected fake providers remain supported through the pure collection API and are
used by tests.

## Provider Config And Failure Behavior

### Stub

`stub` write mode remains deterministic and local.

### IBKR

IBKR live 15m collection requires:

```text
LEVEL_15M_CACHE_ENABLE_IBKR=true
```

Optional IBKR configuration:

```text
LEVEL_15M_CACHE_IBKR_HOST
LEVEL_15M_CACHE_IBKR_PORT
LEVEL_15M_CACHE_IBKR_CLIENT_ID
LEVEL_15M_CACHE_IBKR_CONNECTION_TIMEOUT_MS
LEVEL_VALIDATION_IBKR_TIMEOUT_MS
```

Without the explicit enable flag, IBKR write mode fails clearly and writes no
files. Dry-run mode does not require the flag.

### Twelve Data

Twelve Data live 15m collection requires:

```text
TWELVE_DATA_API_KEY
```

Without the API key, Twelve Data write mode fails clearly and writes no files.
Dry-run mode does not require the key.

## Cache Output Layout

The output layout is unchanged:

```text
.validation-cache/candles/<provider>/<SYMBOL>/15m/<lookbackBars>-<endTimeMs>.json
```

The wrapper remains schema version `1` and records:

- request symbol;
- request provider;
- request timeframe `15m`;
- request lookback bars;
- request end time;
- provider response candles and metadata;
- completeness fields used by inspection.

## Tests Added

Focused test file:

```text
src/tests/level-analysis-15m-live-provider-hookup-tool.test.ts
```

Coverage includes:

- provider timeframe capability includes `15m`;
- LevelEngine eligibility excludes `15m`;
- provider fetch planning maps `15m` to `15 mins` and `15min`;
- existing `5m`, `4h`, and `daily` planning remains stable;
- dry-run constructs no live provider and writes no files;
- fake-provider write mode produces inspection-compatible cache files;
- IBKR and Twelve Data missing-config failures write no files;
- source boundaries avoid LevelEngine, alerts, monitoring, Discord, and journal
  interpretation paths.

## Limitations

- No real IBKR or Twelve Data write was run in this gate.
- Real local cache still has no 15m provider files unless an operator runs a
  future write gate.
- IBKR live write mode intentionally requires an explicit enable flag to avoid
  accidental local connection attempts.
- Real-cache supplied-15m validation remains blocked until real 15m files are
  collected.

## Anti-Goals

This gate does not:

- run live provider calls in tests or CI;
- write real IBKR or Twelve Data cache files;
- add `15m` to LevelEngine support/resistance generation;
- tune support/resistance detection;
- change runtime mode defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring, or trade
  advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_live_dry_run
```

Reason: the hookup surface is now structurally present. The next safe step is
to run operator dry-run/preflight commands against the actual local provider
configuration while still writing no real cache files.
