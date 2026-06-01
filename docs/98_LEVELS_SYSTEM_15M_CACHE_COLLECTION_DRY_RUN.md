# Levels System 15m Cache Collection Dry Run

## Purpose

This gate documents a safe dry run of the 15m validation-cache collection tool
against the target real-cache symbols.

The goal is to prove the tool can plan explicit 15m cache output paths and
report current missing-15m coverage without calling live providers or writing
real provider cache files.

This is an operational dry-run and reporting gate only. It does not add live
provider fetching, change LevelEngine behavior, change support/resistance
detection, change runtime defaults, change alert/monitoring/Discord behavior,
or add journal interpretation.

## Current Cache Inspection

Command:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --generated-at 2026-06-01T00:00:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/current-cache-inspection.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/current-cache-inspection.txt
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

Diagnostics:

```text
no_15m_cache_found
```

The real cache still has no 15m candle files.

## Dry-Run Command

Command:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --dry-run
```

Target symbols:

```text
DEVS, ENVX, DXYZ, QUBT, GME
```

Provider:

```text
ibkr
```

Lookback:

```text
100 15m candles
```

End time:

```text
2026-06-01T16:00:00Z
```

Normalized end time:

```text
1780329600000
```

## Planned Output Paths

The dry run planned these real-cache paths:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/15m/100-1780329600000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/15m/100-1780329600000.json
```

## Dry-Run Result Summary

| Result | Count |
| --- | ---: |
| Planned | 5 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 0 |

Dry-run guarantees observed:

- no provider calls were required;
- no files were written;
- no real cache paths existed after the dry run;
- target symbols were normalized and preserved;
- output paths used the existing validation cache layout.

## Real Cache Mutation Confirmation

The planned real-cache paths were checked after the dry run. All five remained
absent.

That confirms the dry run did not mutate the real validation cache.

## Stub Temp Write Verification

An optional deterministic stub write was run against a temp cache root only:

```text
npm run cache:collect:15m -- --cache-root C:/Users/jerac/AppData/Local/Temp/levels-system-15m-stub-write-dry-run-20260601 --provider stub --symbols TESTA,TESTB --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Result:

| Result | Count |
| --- | ---: |
| Written | 2 |
| Failed | 0 |

Temp inspection command:

```text
npx tsx src/scripts/inspect-15m-cache-coverage.ts --cache-root C:/Users/jerac/AppData/Local/Temp/levels-system-15m-stub-write-dry-run-20260601 --generated-at 2026-06-01T00:00:00.000Z --out-json docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-stub-write-temp-inspection.json --out-text docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-stub-write-temp-inspection.txt
```

Temp inspection summary:

| Metric | Count |
| --- | ---: |
| Provider/symbol groups | 2 |
| Total cache JSON files | 2 |
| Validation cache entries | 2 |
| 15m JSON files | 2 |
| Groups with any `15m` | 2 |

Symbols with 15m:

```text
stub/TESTA, stub/TESTB
```

The temp write confirms the tool's write wrapper is compatible with the
coverage inspector without touching real provider cache files.

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/current-cache-inspection.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/current-cache-inspection.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-cache-collection-dry-run.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-cache-collection-dry-run.txt
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-stub-write-temp-inspection.json
docs/examples/level-analysis-snapshot/timeframe-facts/15m-cache-collection-dry-run/15m-stub-write-temp-inspection.txt
```

No raw real-cache files or temp cache candle files are committed.

## Validation Result

Validation commands passed:

- `npm ci`
- `npx tsx --test --test-timeout=90000 src/tests/collect-15m-validation-cache.test.ts`
- `npx tsc --noEmit`
- `npm test`

Existing deterministic tests already cover dry-run, stub write, existing-file
skip behavior, failure handling, malformed symbol rejection, and inspection
compatibility. No new tests were needed for this report-only gate.

## Limitations

- The local real cache still has no 15m candle files.
- Live `ibkr` and `twelve_data` write mode remains intentionally unwired.
- Supplied-15m real-cache validation remains blocked until live provider
  hookup safely writes real 15m cache files.

## Production Bug Assessment

No production bug was found.

The collection tool planned the correct real-cache paths, avoided writes in
dry-run mode, and produced inspection-compatible temp stub cache files.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_live_provider_hookup_design
```

Reason: the collection tool can plan and stub-write safely, but live
`ibkr`/`twelve_data` writes intentionally fail until the 15m provider hookup is
designed safely.
