# Levels System Journal Trade Context 5m Day Cache IBKR Operator Write Plan

## Purpose

Gate `levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write_plan`
is the operator runbook for the first explicitly enabled IBKR journal
trade-context 5m day-cache write.

It defines the prerequisites, exact commands, target trade contexts, expected
output paths, post-write validation, rollback/cleanup, and artifact retention
rules that should be followed before any real cache mutation happens.

## Strict Warning

This planning gate does not execute the write.

Do not run the write command unless the operator is intentionally ready to
create real IBKR 5m validation-cache files.

This gate does not write real 5m cache files, fetch live IBKR candles, change
LevelEngine behavior, change support/resistance generation, change snapshot
generation, change runtime defaults, change alert/monitoring/Discord behavior,
modify the journal app, or add grading, coaching, P/L, giveback, behavior
scoring, recommendations, buy/sell/hold decisions, or trade advice.

## Provider Focus

The provider for the first real journal trade-context day-cache collection is
IBKR.

Twelve Data remains optional/future only and is not part of this operator write
plan.

## Target Set

Initial trade-context requests:

```text
DEVS@2026-06-01T09:42:00-04:00
DEVS@2026-06-01T14:30:00-04:00
ENVX@2026-06-01T10:15:00-04:00
DXYZ@2026-06-01T11:20:00-04:00
QUBT@2026-06-01T13:05:00-04:00
GME@2026-06-01T15:30:00-04:00
```

The two DEVS requests are intentionally same-symbol same-day requests. They
should dedupe into one reusable full extended-session 5m day-cache file.

Collection settings:

| Setting | Value |
| --- | --- |
| Provider | `ibkr` |
| Timeframe | `5m` |
| Exchange timezone | `America/New_York` |
| Session window | 04:00 to 20:00 |
| Lookback bars | `192` |
| Session end timestamp | `1780358400000` |
| Cache root | `C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles` |
| Source trade contexts | `6` |
| Unique day requests | `5` |

## Expected Output Paths

The first write should create only these files unless existing-file skip or a
per-symbol provider failure occurs:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/5m/192-1780358400000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/5m/192-1780358400000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/5m/192-1780358400000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/5m/192-1780358400000.json
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/5m/192-1780358400000.json
```

No broad cache collection, all-symbol collection, overwrite, or non-IBKR
collection is part of the first operator write.

## Completed Safety Evidence

Dry-run evidence:

```text
docs/151_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_DRY_RUN.md
```

Write-disabled preflight evidence:

```text
docs/152_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_WRITE_DISABLED_PREFLIGHT.md
```

Observed safety before this plan:

- dry-run planned five files from six trade-context requests;
- dry-run wrote zero files;
- planned real-cache paths remained absent after dry-run;
- `--write --provider ibkr` failed closed when
  `LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true` was absent;
- the blocked write-disabled preflight created no temp directories or files.

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
- The write-disabled preflight has already passed.
- The write command is being run manually by the operator, not in CI.

## IBKR Session And Config Requirements

Required for real write mode:

```text
LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true
```

Optional IBKR configuration:

```text
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_HOST
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_PORT
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CLIENT_ID
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CONNECTION_TIMEOUT_MS
LEVEL_VALIDATION_IBKR_TIMEOUT_MS
```

If optional variables are not supplied, the tool uses the existing IBKR runtime
defaults. The operator should supply them when the local TWS/Gateway setup does
not match defaults.

## Dry-Run Command

Run this immediately before any write:

```text
npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --dry-run
```

Expected dry-run result:

- `Mode: dry-run`
- `Provider: ibkr`
- `Timeframe: 5m`
- `Requested trade contexts: 6`
- `Unique day requests: 5`
- `Planned: 5`
- `Written: 0`
- `Failed: 0`
- planned paths match the five expected output paths above.

Dry-run mode should not require an IBKR login and should not construct the live
provider fetcher.

## Write Command

PowerShell example:

```powershell
$env:LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR="true"; npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --write
```

Optional explicit IBKR config example:

```powershell
$env:LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR="true"
$env:LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_HOST="127.0.0.1"
$env:LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_PORT="7497"
$env:LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CLIENT_ID="101"
$env:LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CONNECTION_TIMEOUT_MS="30000"
$env:LEVEL_VALIDATION_IBKR_TIMEOUT_MS="30000"
npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --write
```

Do not include `--overwrite` in the first write. Existing files should be
skipped unless a later recovery run explicitly decides to replace them.

## Pre-Write Checklist

1. Confirm branch/worktree and local cache mutation intent.
2. Confirm TWS/Gateway is open, logged in, connected, and API-enabled.
3. Confirm the operator has set
   `LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true`.
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
3. Confirm `Provider: ibkr` and `Timeframe: 5m`.
4. Confirm `Requested trade contexts: 6` and `Unique day requests: 5`.
5. Confirm each target symbol reports `written`, `skipped_existing`, or
   `failed`.
6. If any symbol fails, do not rerun with `--overwrite`.
7. If the command exits non-zero, preserve the output and move to failure
   handling.
8. If files are written, do not commit raw cache files unless a later gate
   explicitly chooses to commit them.

## Post-Write Inspection Checklist

After a successful or partially successful write, check the five target paths:

```powershell
$paths = @(
  "C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DEVS\5m\192-1780358400000.json",
  "C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DXYZ\5m\192-1780358400000.json",
  "C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\ENVX\5m\192-1780358400000.json",
  "C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\GME\5m\192-1780358400000.json",
  "C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\QUBT\5m\192-1780358400000.json"
)
$paths | ForEach-Object { [pscustomobject]@{ Path = $_; Exists = Test-Path -LiteralPath $_ } } | Format-Table -AutoSize
```

Validate any written wrapper files:

```powershell
@'
const fs = require("fs");
const paths = [
  "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DEVS/5m/192-1780358400000.json",
  "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/DXYZ/5m/192-1780358400000.json",
  "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/ENVX/5m/192-1780358400000.json",
  "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/GME/5m/192-1780358400000.json",
  "C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/QUBT/5m/192-1780358400000.json",
];
for (const path of paths) {
  if (!fs.existsSync(path)) continue;
  const wrapper = JSON.parse(fs.readFileSync(path, "utf8"));
  if (wrapper.schemaVersion !== 1) throw new Error(`${path}: schemaVersion`);
  if (wrapper.request.provider !== "ibkr") throw new Error(`${path}: provider`);
  if (wrapper.request.timeframe !== "5m") throw new Error(`${path}: timeframe`);
  if (wrapper.request.lookbackBars !== 192) throw new Error(`${path}: lookbackBars`);
  if (wrapper.request.endTimeMs !== 1780358400000) throw new Error(`${path}: endTimeMs`);
  if (!Array.isArray(wrapper.response?.candles) || wrapper.response.candles.length === 0) {
    throw new Error(`${path}: missing candles`);
  }
  if (wrapper.journalTradeContextPolicy?.safety?.snapshotStillFiltersAsOf !== true) {
    throw new Error(`${path}: safety`);
  }
}
console.log("journal 5m day cache wrappers ok");
'@ | node
```

Only the actual write gate should commit compact post-write summaries. Do not
commit raw provider cache files by default.

## Rollback And Cleanup Plan

If the first write creates wrong, incomplete, or unwanted files:

1. Stop; do not run additional writes.
2. Identify only the five target files listed in this document.
3. Verify each resolved file path is under:

   ```text
   C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles/ibkr/<SYMBOL>/5m/
   ```

4. Move the target files to a dated quarantine folder outside the committed
   docs tree, or delete them only after confirming the exact resolved paths.
5. Re-run the path and wrapper checks.
6. Confirm `5m` target counts reflect the cleanup.
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
- do not broaden the request list;
- do not add `--overwrite` without a documented reason;
- do not tune LevelEngine or support/resistance behavior;
- treat provider/data issues as cache-collection issues first.

## Validation Sequence After Write

After the first successful write gate:

1. Verify path existence for the five target files.
2. Verify wrapper JSON shape and candle counts for any written files.
3. Confirm DEVS includes both source trade-context timestamps in
   `journalTradeContextPolicy.sourceTradeContextTimestamps`.
4. Generate compact write evidence under:

   ```text
   docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-ibkr-operator-write/
   ```

5. Run focused 5m collection and policy tests.
6. Run `npm run build`.
7. Verify no raw `.validation-cache` candle files are staged unless explicitly
   intended.
8. Run the next gate:

   ```text
   levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write
   ```

## Artifact Retention Rules

Commit only compact summaries under:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-ibkr-operator-write/
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
- write real 5m cache files;
- use Twelve Data;
- add `5m` day-cache data directly to journal UI;
- expose raw provider payloads in UI;
- change snapshot as-of filtering;
- change LevelEngine behavior or eligible timeframes;
- tune support/resistance detection;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, buy/sell/hold decisions, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write
```

Reason: this operator plan defines the safe write sequence. The next gate can
perform the explicit IBKR write only when the operator is ready and IBKR is
connected, then verify wrapper shape and commit only compact summaries.
