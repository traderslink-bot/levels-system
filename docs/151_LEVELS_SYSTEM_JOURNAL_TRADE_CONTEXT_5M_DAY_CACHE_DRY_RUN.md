# Levels System Journal Trade Context 5m Day Cache Dry Run

## Purpose

Gate `levels_system_journal_trade_context_5m_day_cache_dry_run` documents a
safe operator dry-run of the journal trade-context 5m day-cache collection
wrapper against the intended local validation-cache root.

The goal is to prove the tool plans explicit IBKR 5m day-cache paths, dedupes
same-symbol same-day trade-context requests, and writes no real cache files in
dry-run mode.

This is an operational dry-run and reporting gate only. It does not fetch live
IBKR candles, write provider cache files, change LevelEngine behavior, change
support/resistance generation, change snapshot generation, change journal app
behavior, change alerts/monitoring/Discord/runtime defaults, or add grading,
coaching, P/L, giveback, behavior scoring, recommendations, buy/sell/hold
decisions, or trade advice.

## Dry-Run Command

Command:

```text
npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --dry-run --generated-at 2026-06-07T12:00:00.000-04:00
```

Provider:

```text
ibkr
```

Cache root:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

Target trade-context requests:

| Symbol | Trade Context Time |
| --- | --- |
| DEVS | 2026-06-01T09:42:00-04:00 |
| DEVS | 2026-06-01T14:30:00-04:00 |
| ENVX | 2026-06-01T10:15:00-04:00 |
| DXYZ | 2026-06-01T11:20:00-04:00 |
| QUBT | 2026-06-01T13:05:00-04:00 |
| GME | 2026-06-01T15:30:00-04:00 |

The two DEVS requests intentionally target the same exchange-local day so the
dry run proves symbol/date dedupe.

## Dry-Run Result Summary

| Result | Count |
| --- | ---: |
| Requested trade contexts | 6 |
| Unique day requests | 5 |
| Planned | 5 |
| Written | 0 |
| Skipped existing | 0 |
| Failed | 0 |

Dry-run guarantees observed:

- no IBKR connection was required;
- no provider fetcher was constructed;
- no files were written;
- same-symbol same-day requests deduped from 2 DEVS trade contexts into 1
  DEVS day request;
- every planned file used the existing validation-cache path layout;
- every planned request used `5m` with `192` bars ending at the
  exchange-local 20:00 extended-session boundary.

## Planned Output Paths

The dry run planned these real-cache paths:

```text
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DEVS\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\DXYZ\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\ENVX\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\GME\5m\192-1780358400000.json
C:\Users\jerac\Documents\TraderLink\levels-system\.validation-cache\candles\ibkr\QUBT\5m\192-1780358400000.json
```

All five paths use `192-1780358400000.json`, where `1780358400000` is
2026-06-01 20:00:00 America/New_York.

## Real Cache Mutation Confirmation

Each planned real-cache path was checked after the dry-run command. All five
paths remained absent:

| Symbol | Planned File Existed After Dry Run |
| --- | --- |
| DEVS | false |
| DXYZ | false |
| ENVX | false |
| GME | false |
| QUBT | false |

That confirms the dry run did not mutate the real validation cache.

## Artifacts

Committed compact artifacts:

```text
docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-dry-run/journal-5m-day-cache-dry-run.json
docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-dry-run/journal-5m-day-cache-dry-run.txt
```

No raw provider cache files are committed.

## Validation Result

Validation commands passed:

- `npm run cache:collect:journal-5m-day -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00,ENVX@2026-06-01T10:15:00-04:00,DXYZ@2026-06-01T11:20:00-04:00,QUBT@2026-06-01T13:05:00-04:00,GME@2026-06-01T15:30:00-04:00 --dry-run --generated-at 2026-06-07T12:00:00.000-04:00`
- planned real-cache path existence check
- `node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('docs/examples/level-analysis-snapshot/timeframe-facts/journal-5m-day-cache-dry-run/journal-5m-day-cache-dry-run.json','utf8')); console.log('json ok');"`
- `npx tsx --test src/tests/collect-journal-trade-context-5m-day-cache.test.ts src/tests/journal-trade-context-5m-day-policy.test.ts`
- `npm run build`
- `git diff --check`

No code changes were needed for this report-only gate. Existing deterministic
tests continue to cover dry-run behavior, fake-provider writes, skip behavior,
provider failures, parser errors, and summary formatting.

## Production Bug Assessment

No production bug was found.

The collection wrapper planned the expected day-scoped IBKR paths, deduped
same-symbol same-day requests, avoided provider access in dry-run mode, and
left the real validation cache unchanged.

## Recommended Next Gate

Completed follow-up gate:

```text
levels_system_journal_trade_context_5m_day_cache_ibkr_write_disabled_preflight
```

Evidence:

```text
docs/152_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_WRITE_DISABLED_PREFLIGHT.md
```

Current recommended next gate:

```text
levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write_plan
```

Reason: the dry-run and write-disabled preflight are clean. The next safe step
before any real IBKR write is to document the exact operator write plan.
