# Levels System Journal Trade Context 5m Day Cache IBKR Operator Write

## Purpose

Gate `levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write`
documents the first explicitly enabled live IBKR journal trade-context 5m
day-cache write.

The goal was to create the small, documented 5m day-cache set for the selected
journal trade contexts, verify the validation-cache wrapper shape, and commit
only compact evidence/docs.

This gate does not change LevelEngine behavior, support/resistance generation,
snapshot schema, journal app behavior, runtime defaults, alert/monitoring/
Discord behavior, grading, coaching, P/L, giveback, behavior scoring,
recommendations, buy/sell/hold decisions, or trade advice.

## Operator Readiness

The live write was run only after the operator confirmed IBKR was logged in and
explicitly confirmed the run could proceed.

Required enablement used:

```text
LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true
```

The write command did not include `--overwrite`.

## Pre-Write Dry Run

Immediately before live write mode, the dry-run command was rerun:

```text
npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --dry-run
```

Dry-run result:

| Result | Count |
| --- | ---: |
| Requested trade contexts | 6 |
| Unique day requests | 5 |
| Planned | 5 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 0 |

All five expected output paths remained absent before the live write.

## Write Command

Command:

```text
$env:LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR="true"; npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --write
```

Write result:

| Result | Count |
| --- | ---: |
| Requested trade contexts | 6 |
| Unique day requests | 5 |
| Planned | 0 |
| Written | 5 |
| Skipped existing | 0 |
| Failed | 0 |

Each written item reported `candles=308`.

## Written Files

The expected files existed after the write:

```text
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DEVS\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DXYZ\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\ENVX\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\GME\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\QUBT\5m\192-1780358400000.json
```

## Wrapper Validation

All five written wrappers were parsed successfully.

Validated for each wrapper:

- `schemaVersion` is `1`;
- `request.provider` is `ibkr`;
- `request.timeframe` is `5m`;
- `request.lookbackBars` is `192`;
- `request.endTimeMs` is `1780358400000`;
- `response.candles` is non-empty;
- `journalTradeContextPolicy.safety.snapshotStillFiltersAsOf` is `true`.

DEVS preserved both source trade-context timestamps as epoch milliseconds:

| Source Trade Context | Stored Timestamp |
| --- | ---: |
| `2026-06-01T09:42:00-04:00` | `1780321320000` |
| `2026-06-01T14:30:00-04:00` | `1780338600000` |

## Compact Artifacts

Committed compact evidence:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-ibkr-operator-write/operator-write.json
docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-ibkr-operator-write/operator-write.txt
```

No raw `.validation-cache` candle files are committed.

## Validation Result

Validation commands passed:

- pre-write dry-run command above
- expected path existence check
- wrapper JSON validation script over the five expected files
- `npx tsx --test src/tests/collect-journal-trade-context-5m-day-cache.test.ts src/tests/journal-trade-context-5m-day-policy.test.ts`
- `npm run build`
- `git diff --check`

## Production Bug Assessment

No production bug was found.

The live IBKR write created exactly the five expected wrapper files, preserved
the same-symbol same-day DEVS source timestamps, and kept the no-lookahead
snapshot safety flag intact.

## Recommended Next Gate

Current recommended next gate:

```text
journal_level_analysis_delivery_ingestion
```

Reason: the producer-side dry-run, write-disabled preflight, operator plan, and
explicit IBKR write are complete. The next useful work returns to the journal
app ingestion gate described in the delivery handoff.
