# Levels System 15m Cache Collection CLI Exit Cleanup

## Purpose

This gate fixes the 15m validation-cache collection lifecycle so live IBKR write
mode can exit cleanly after the requested symbols finish.

The fix is narrow and collection-tool scoped. It does not collect more real 15m
cache files, broaden the target symbol list, use Twelve Data, change
LevelEngine behavior, change support/resistance detection, change runtime
defaults, change alert/monitoring/Discord behavior, modify the journal app, or
add journal interpretation.

## Bug Summary

The first operator-approved IBKR 15m write created the five expected local
cache files, but the command did not exit cleanly and required leftover
`npm`/`tsx`/`node` processes to be stopped.

The written files were valid, but the command lifecycle was unsafe for broader
operator collection.

## Root Cause

The 15m live-provider collection path created an IBKR client for write mode but
did not disconnect that client after the symbol loop completed.

The open IBKR connection could keep the Node process alive after cache files had
already been written.

## Fix Summary

The collection tool now supports a collection-specific fetcher bundle:

```ts
type FifteenMinuteValidationCacheFetcherBundle = {
  fetcher: FifteenMinuteValidationCacheFetcher;
  cleanup?: () => Promise<void> | void;
};
```

The default IBKR bundle owns the IBKR client and exposes cleanup that calls
`disconnect()`. The collection loop calls cleanup once in a `finally` block
after all requested symbols finish.

If IBKR connection initialization fails, the client is also disconnected before
the error is rethrown.

The existing public `createDefaultFifteenMinuteValidationCacheFetcher` helper is
preserved as a compatibility wrapper around the new bundle helper.

## Cleanup Behavior

Expected behavior after this gate:

- successful write: cleanup runs once after all symbols finish;
- partial provider failure: cleanup still runs once;
- zero-candle provider failure: cleanup still runs once;
- dry-run: no provider is constructed and cleanup is not called;
- all-existing skip-only write: no provider is constructed and cleanup is not
  called;
- provider initialization failure: IBKR client disconnect is attempted before
  the failure propagates.

## Skip-Before-Fetch Behavior

The collector already checked for existing target files before resolving the
provider fetcher. This gate locks that behavior with tests.

That matters because the five operator-written target files now exist locally.
A safe verification command can run with `--write` and the IBKR enable flag set,
but because all target files already exist and `--overwrite` is absent, the
command should skip all five files without opening an IBKR provider connection.

## Safe CLI Verification Plan

Command:

```powershell
$env:LEVEL_15M_CACHE_ENABLE_IBKR="true"; npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Expected result:

- `Skipped existing: 5`;
- `Written: 0`;
- `Failed: 0`;
- no provider call needed;
- no new real cache files written;
- command exits cleanly.

Do not use `--overwrite`.

## Tests Added

Focused test file:

```text
src/tests/collect-15m-validation-cache-cleanup.test.ts
```

Coverage:

- cleanup called once after successful write;
- cleanup called once after partial provider failure;
- cleanup called once after zero-candle provider failure;
- dry-run does not construct provider or call cleanup;
- all-existing write skips before fetcher construction and cleanup;
- skip-only behavior preserves existing files;
- source boundary guard keeps collection cleanup out of LevelEngine, alerts,
  monitoring, Discord, and journal interpretation paths.

## Limitations

- This gate does not perform another real IBKR write.
- This gate does not delete or overwrite the five existing local 15m cache
  files.
- This gate does not validate supplied-15m facts from the newly written cache
  files.

## Anti-Goals

This gate does not:

- collect more real 15m cache files;
- broaden the symbol list;
- use Twelve Data;
- add `15m` to LevelEngine support/resistance generation;
- tune support/resistance detection;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_facts_real_cache_validation_with_supplied_15m
```

Reason: the CLI lifecycle cleanup and skip-only verification are now safe.
The next levels-system step is to validate that the newly available IBKR 15m
cache files populate `timeframeFacts["15m"]` while preserving LevelEngine
support/resistance output parity.
