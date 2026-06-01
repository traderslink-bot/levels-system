# Levels System 15m Cache Collection Operator Write

## Purpose

This gate performed the first operator-approved IBKR 15m validation-cache write
for a small target set and documented the resulting cache coverage.

This is an operational cache-collection gate. It does not change LevelEngine
behavior, support/resistance detection, runtime defaults, alerts, monitoring,
Discord behavior, or journal interpretation.

## Cache Mutation Note

This gate attempted a real local cache mutation under:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

Raw cache files were not committed. Only compact docs and summary artifacts are
committed.

## Provider And Target Symbols

Provider:

```text
ibkr
```

Target symbols:

```text
DEVS, ENVX, DXYZ, QUBT, GME
```

Collection settings:

| Setting | Value |
| --- | --- |
| Timeframe | `15m` |
| Lookback bars | `100` |
| End time | `2026-06-01T16:00:00Z` |
| Normalized end time | `1780329600000` |
| Overwrite | `false` |

## Pre-Write Inspection

Command:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at 2026-06-01T18:10:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-before-write.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-before-write.txt
```

Summary:

| Metric | Before |
| --- | ---: |
| Total JSON files | 2274 |
| Validation cache entries | 2274 |
| `15m` JSON files | 0 |
| Groups with any `15m` | 0 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 |
| Malformed JSON files | 0 |

Diagnostics:

```text
no_15m_cache_found
```

All five target output paths were absent before the write.

## Dry-Run Summary

Command:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --dry-run
```

Result:

| Result | Count |
| --- | ---: |
| Planned | 5 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 0 |

The dry run matched the expected paths from
`docs/102_LEVELS_SYSTEM_15M_IBKR_OPERATOR_WRITE_PLAN.md`.

## Write Readiness Check

Observed readiness signals before write:

- `ibgateway.exe` was running.
- Port `7497` was listening from the IB Gateway process.
- Target symbols were limited to `DEVS`, `ENVX`, `DXYZ`, `QUBT`, and `GME`.
- No `--overwrite` flag was used.
- The operator request approved this small local cache mutation if IBKR was
  ready.

## Write Command

Command attempted:

```powershell
$env:LEVEL_15M_CACHE_ENABLE_IBKR='true'; npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

The command did not exit within five minutes and was timed out by the operator
shell. The leftover `npm`/`tsx`/`node` processes for that exact write command
were stopped after confirming the target files existed.

## Write Result Per Symbol

The expected target files were present after the write attempt and parsed as
validation-cache entries:

| Symbol | Status | Candles | Completeness | First timestamp | Last timestamp |
| --- | --- | ---: | --- | ---: | ---: |
| `DEVS` | written | 96 | partial | 1780041600000 | 1780328700000 |
| `ENVX` | written | 96 | partial | 1780041600000 | 1780328700000 |
| `DXYZ` | written | 96 | partial | 1780041600000 | 1780328700000 |
| `QUBT` | written | 96 | partial | 1780041600000 | 1780328700000 |
| `GME` | written | 96 | partial | 1780041600000 | 1780328700000 |

No skipped files or symbol-level failed files were observed after inspection.

## Post-Write Inspection

Command:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at 2026-06-01T18:20:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-after-write.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-after-write.txt
```

Summary:

| Metric | Before | After |
| --- | ---: | ---: |
| Total JSON files | 2274 | 2279 |
| Validation cache entries | 2274 | 2279 |
| `15m` JSON files | 0 | 5 |
| Groups with any `15m` | 0 | 5 |
| Groups with `5m`/`15m`/`4h`/`daily` | 0 | 5 |
| Groups missing `15m` among complete `5m`/`4h`/`daily` groups | 355 | 350 |
| Malformed JSON files | 0 | 0 |

Symbols with 15m:

```text
ibkr/DEVS, ibkr/DXYZ, ibkr/ENVX, ibkr/GME, ibkr/QUBT
```

Diagnostics after write:

```text
none
```

## Cache Mutation Confirmation

The local real validation cache was mutated by this gate:

- five IBKR 15m JSON cache files were created;
- no broad unintended symbol expansion occurred;
- malformed JSON count remained `0`;
- validation cache entry count increased by `5`.

The raw cache files remain local and are intentionally not committed.

## Production Bug Assessment

A production lifecycle bug was found:

```text
The IBKR write command wrote the expected files but did not exit cleanly after the write.
```

Likely next investigation area: the 15m collection CLI constructs an IBKR
client for write mode but does not close the connection before process exit.

This did not corrupt cache output, but it should be addressed before broader
operator collection.

## Rollback And Cleanup Notes

No rollback was performed because all five expected target files were written
and post-write inspection passed.

If cleanup is later required, only these exact target files should be moved or
removed after resolving and confirming their paths:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/15m/100-1780329600000.json
```

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-before-write.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-before-write.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-after-write.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/cache-coverage-after-write.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/15m-ibkr-operator-write-result.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/15m-ibkr-operator-write-result.txt
```

Raw `.validation-cache/candles/**` files are not committed.

## Validation

Validation commands:

- `npm ci`
- pre-write cache inspection
- immediate IBKR dry run
- first IBKR write attempt
- post-write cache inspection
- `npx tsc --noEmit`
- `npm test`
- `git diff --check`

No tests were added because no code changes were made.

## Anti-Goals

This gate did not:

- broaden the symbol list;
- use Twelve Data;
- use `--overwrite`;
- commit raw cache files;
- change LevelEngine behavior;
- change support/resistance detection;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_cli_exit_cleanup
```

Reason: at least one target symbol was written successfully, but the live IBKR
collection command did not exit cleanly. Fixing the CLI connection cleanup is
the safest immediate step before expanding validation or collection. After that
cleanup, proceed to:

```text
levels_system_15m_facts_real_cache_validation_with_supplied_15m
```
