# Levels System 15m IBKR Operator Write Plan

## Purpose

This document is the operator runbook for the first explicitly enabled IBKR
15m validation-cache write.

It defines the preflight checks, exact commands, target symbols, expected output
paths, post-write inspection, rollback/cleanup, and validation sequence that
should be followed before any real cache mutation happens.

## Strict Warning

This planning gate does not execute the write.

Do not run the write command unless the operator is intentionally ready to
create real 15m IBKR validation-cache files.

This gate does not write real 15m cache files, change LevelEngine behavior,
change support/resistance detection, change runtime defaults, change alert,
monitoring, or Discord behavior, modify the journal app, or add journal
interpretation.

## Provider Focus

The provider for the first real 15m collection is IBKR.

Twelve Data remains optional/future only and is not part of this operator write
plan.

## Target Set

Initial target symbols:

```text
DEVS,ENVX,DXYZ,QUBT,GME
```

Collection settings:

| Setting | Value |
| --- | --- |
| Provider | `ibkr` |
| Timeframe | `15m` |
| Lookback bars | `100` |
| End time | `2026-06-01T16:00:00Z` |
| Normalized end time | `1780329600000` |
| Cache root | `C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles` |

## Expected Output Paths

The first write should create only these files unless existing-file skip or a
per-symbol provider failure occurs:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/15m/100-1780329600000.json
```

No broad cache collection, all-symbol collection, overwrite, or non-IBKR
collection is part of the first operator write.

## Prerequisites

Before running write mode, confirm:

- IBKR TWS or IB Gateway is running.
- The IBKR session is logged in and connected.
- API access is enabled in TWS/Gateway.
- The configured host, port, and client id match the local IBKR session.
- Historical data permissions are available for the target symbols.
- The repo worktree is clean, or the operator accepts that local cache files
  will be created under `.validation-cache/candles`.
- The dry-run command has just been run and the planned paths match this doc.
- The write command is being run manually by the operator, not in CI.

## IBKR Session And Config Requirements

Required for real write mode:

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

If optional variables are not supplied, the tool uses the existing IBKR runtime
defaults. The operator should supply them when the local TWS/Gateway setup does
not match defaults.

## Dry-Run Command

Run this immediately before any write:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --dry-run
```

Expected dry-run result:

- `Mode: dry-run`
- `Provider: ibkr`
- `Timeframe: 15m`
- `Symbols: 5`
- `Planned: 5`
- `Written: 0`
- `Failed: 0`
- planned paths match the five expected output paths above.

Dry-run mode should not require an IBKR login and should not construct the live
provider fetcher.

## Write Command

PowerShell example:

```powershell
$env:LEVEL_15M_CACHE_ENABLE_IBKR="true"; npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Optional explicit IBKR config example:

```powershell
$env:LEVEL_15M_CACHE_ENABLE_IBKR="true"
$env:LEVEL_15M_CACHE_IBKR_HOST="127.0.0.1"
$env:LEVEL_15M_CACHE_IBKR_PORT="7497"
$env:LEVEL_15M_CACHE_IBKR_CLIENT_ID="101"
$env:LEVEL_15M_CACHE_IBKR_CONNECTION_TIMEOUT_MS="30000"
$env:LEVEL_VALIDATION_IBKR_TIMEOUT_MS="30000"
npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Do not include `--overwrite` in the first write. Existing files should be
skipped unless a later recovery run explicitly decides to replace them.

## Pre-Write Checklist

1. Confirm branch/worktree and local cache mutation intent.
2. Confirm TWS/Gateway is open, logged in, connected, and API-enabled.
3. Confirm the operator has set `LEVEL_15M_CACHE_ENABLE_IBKR=true`.
4. Confirm optional host, port, client id, and timeout env vars if defaults are
   not correct.
5. Run the dry-run command above.
6. Confirm the dry-run planned exactly the five target output paths.
7. Confirm the dry-run wrote zero files.
8. Confirm no target output path already exists unless skip behavior is
   intended.
9. Confirm no `--overwrite` flag is present.
10. Confirm the operator is prepared to stop after this small target set.

## Write Execution Checklist

1. Run the write command once.
2. Capture terminal output.
3. Confirm `Provider: ibkr` and `Timeframe: 15m`.
4. Confirm each target symbol reports `written`, `skipped_existing`, or
   `failed`.
5. If any symbol fails, do not rerun with `--overwrite`.
6. If the command exits non-zero, preserve the output and move to failure
   handling.
7. If files are written, do not commit raw cache files unless a later gate
   explicitly chooses to commit them.

## Post-Write Inspection Checklist

After a successful or partially successful write, run:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at <ISO> --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/15m-cache-coverage-after-write.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/15m-cache-coverage-after-write.txt
```

Only the actual write gate should commit these post-write inspection artifacts.

Expected inspection checks:

- cache root exists;
- `timeframeJsonFileCounts["15m"]` increases from `0`;
- the target symbols have `15m` files;
- malformed JSON count remains `0`;
- validation cache entries include the new 15m files;
- no broad unintended provider/symbol expansion occurred.

## Rollback And Cleanup Plan

If the first write creates wrong, incomplete, or unwanted files:

1. Stop; do not run additional writes.
2. Identify only the target files listed in this document.
3. Verify each resolved file path is under:

   ```text
   C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/<SYMBOL>/15m/
   ```

4. Move the target files to a dated quarantine folder outside the committed
   docs tree, or delete them only after confirming the exact resolved paths.
5. Re-run cache inspection.
6. Confirm `15m` counts reflect the cleanup.
7. Document the failure and cleanup in the actual operator write gate.

Do not run recursive cleanup commands against a computed path unless the final
resolved target paths have been checked.

## Failure Handling

Common failure cases:

- IBKR is not running or not logged in.
- API access is disabled.
- Host, port, or client id do not match the local TWS/Gateway session.
- Historical data request times out.
- IBKR returns zero candles for a symbol.
- A symbol-level provider error occurs.
- Existing files are skipped because `--overwrite` is absent.

If a failure occurs:

- keep the exact command output;
- inspect whether any target files were written before the failure;
- do not broaden the symbol list;
- do not add `--overwrite` without a documented reason;
- do not tune LevelEngine or support/resistance behavior;
- treat provider/data issues as cache-collection issues first.

## Validation Sequence After Write

After the first successful write gate:

1. Run cache inspection.
2. Verify `DEVS`, `ENVX`, `DXYZ`, `QUBT`, and `GME` have 15m files when their
   writes succeeded.
3. Run the next gate:

   ```text
   levels_system_15m_facts_real_cache_validation_with_supplied_15m
   ```

4. Verify `timeframeFacts["15m"]` exists for supplied-15m snapshots.
5. Verify `validateFifteenMinuteFacts` passes.
6. Verify LevelEngine output is unchanged with and without supplied 15m
   candles.
7. Verify no-lookahead filtering excludes future/still-forming 15m candles.
8. Verify diagnostics remain factual.
9. Verify no raw cache files are committed unless explicitly intended.

## Artifact Retention Rules

Commit only compact summaries under:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-ibkr-operator-write/
```

Do not commit:

- raw `.validation-cache` candle files by default;
- credentials;
- IBKR account/session details;
- broad real-cache dumps;
- temporary quarantine files.

## Anti-Goals

This plan does not:

- run real IBKR write mode;
- write real 15m cache files;
- use Twelve Data;
- add `15m` to LevelEngine support/resistance generation;
- change LevelEngine defaults;
- tune support/resistance detection;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_cache_collection_operator_write
```

Reason: this operator plan defines the safe write sequence. The next gate can
perform the explicit IBKR write only when the operator is ready and IBKR is
connected, then inspect cache coverage and commit only compact summaries.
