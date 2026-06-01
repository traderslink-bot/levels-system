# Levels System 15m Cache Collection Live Dry Run

## Purpose

This gate documents an IBKR-focused live-provider dry-run and write-disabled
preflight for 15m validation-cache collection.

The goal is to prove the packaged 15m collection tool can plan IBKR 15m cache
artifacts against the real validation-cache layout, fail closed when write mode
is requested without the explicit IBKR enable flag, and leave real cache files
unchanged.

This is an operational preflight and documentation gate only. It does not write
real IBKR 15m cache files, change LevelEngine behavior, change
support/resistance detection, change runtime defaults, change alert,
monitoring, or Discord behavior, modify the journal app, or add journal
interpretation.

## Provider Focus

The active provider lane for this gate is IBKR.

Twelve Data remains a future optional provider capability only. It was not used
or prioritized in this dry-run gate.

## Current Cache Inspection

Command:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at 2026-06-01T00:00:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/current-cache-inspection.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/current-cache-inspection.txt
```

Summary:

| Metric | Count |
| --- | ---: |
| Cache JSON files | 2274 |
| Validation cache entries | 2274 |
| Providers | 2 (`ibkr`, `stub`) |
| Provider/symbol groups | 357 |
| `5m` JSON files | 1219 |
| `15m` JSON files | 0 |
| `4h` JSON files | 584 |
| `daily` JSON files | 471 |
| Groups with `5m`/`4h`/`daily` | 355 |
| Groups with any `15m` | 0 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |
| Groups missing `15m` among complete `5m`/`4h`/`daily` groups | 355 |

Diagnostics:

```text
no_15m_cache_found
```

The real cache root still has no 15m validation-cache files.

## IBKR Dry-Run Command

Command:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --dry-run --generated-at 2026-06-01T17:30:00.000Z
```

Target symbols:

```text
DEVS, ENVX, DXYZ, QUBT, GME
```

Provider:

```text
ibkr
```

Normalized end time:

```text
1780329600000
```

## IBKR Dry-Run Result

| Result | Count |
| --- | ---: |
| Planned | 5 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 0 |

The dry run planned these real-cache paths:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/15m/100-1780329600000.json
```

Observed safety behavior:

- no files were written;
- the planned files remained absent after the dry run;
- dry-run mode did not require an IBKR login;
- dry-run mode did not require `LEVEL_15M_CACHE_ENABLE_IBKR=true`;
- dry-run mode does not construct the live provider fetcher.

## IBKR Write-Mode Disabled Preflight

Command:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/AppData/Local/Temp/levels-system-15m-ibkr-write-disabled-preflight-20260601 --provider ibkr --symbols TEST --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write --generated-at 2026-06-01T17:31:00.000Z
```

Environment:

```text
LEVEL_15M_CACHE_ENABLE_IBKR unset
```

Result:

| Result | Count |
| --- | ---: |
| Planned | 0 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 1 |
| Exit code | 1 |

Failure reason:

```text
IBKR live 15m collection requires LEVEL_15M_CACHE_ENABLE_IBKR=true. Dry-run remains available without IBKR config.
```

The temporary planned output file did not exist after the preflight, and the
temporary cache root was not created.

## Real Cache Mutation Confirmation

Real cache root checked:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

The five dry-run planned IBKR 15m cache paths were checked after the dry run.
All five remained absent.

The write-disabled preflight used a temp cache root and also wrote no files.

No real IBKR 15m validation-cache files were written in this gate.

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/current-cache-inspection.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/current-cache-inspection.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/ibkr-15m-live-dry-run.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/ibkr-15m-live-dry-run.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/ibkr-write-disabled-preflight.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-live-provider-dry-run/ibkr-write-disabled-preflight.txt
```

No raw real-cache files or temp cache candle files are committed.

## Validation Result

Validation commands:

- `npm ci`
- IBKR dry-run command above
- IBKR write-mode disabled preflight command above
- current cache inspection command above
- `npx tsc --noEmit`
- `npm test`

No new tests were added for this report-only gate. Existing deterministic tests
already cover dry-run behavior, fake-provider writes, missing-config live
provider failures, and cache inspection compatibility.

## Limitations

- No real IBKR write was run.
- No IBKR API login was required for this gate.
- The real cache still has zero 15m validation-cache files.
- Real-cache supplied-15m validation remains blocked until an operator runs an
  explicit IBKR write gate.

## Production Bug Assessment

No production bug was found.

The dry-run planned the expected IBKR 15m cache paths and wrote no files. The
write-disabled preflight failed closed before any cache write. The current cache
inspection confirmed the real cache has not yet collected 15m files.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_ibkr_operator_write_plan
```

Reason: the dry-run and write-disabled preflight are clean. The next safe step
is a written operator plan for the first explicitly enabled IBKR write run,
including login/session expectations, target symbols, overwrite rules, rollback
checks, and post-write inspection before any real-cache mutation occurs.
