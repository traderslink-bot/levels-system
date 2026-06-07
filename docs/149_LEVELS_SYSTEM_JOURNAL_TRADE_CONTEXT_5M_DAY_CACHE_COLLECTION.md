# Levels System Journal Trade Context 5m Day Cache Collection

## Purpose

Gate `levels_system_journal_trade_context_5m_day_cache_collection` implements
the producer-side cache collection wrapper for the day-scoped journal
trade-context 5m policy.

The wrapper lets operators or future orchestration request candles for one or
more journal trade contexts, dedupe those requests to one reusable
symbol/date 5m day cache file, and write the existing validation-cache wrapper
shape.

It preserves the key boundary from the policy gate: full-day 5m fetching is a
cache efficiency decision only. Snapshot generation must still filter by candle
close as of the specific trade timestamp.

## Added

- `src/scripts/collect-journal-trade-context-5m-day-cache.ts`
- `src/tests/collect-journal-trade-context-5m-day-cache.test.ts`
- npm script:
  `cache:collect:journal-5m-day`

## Command

Dry-run:

```text
npm run cache:collect:journal-5m-day -- --cache-root <path> --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00,DEVS@2026-06-01T14:30:00-04:00 --dry-run
```

Write with an injected/live provider:

```text
npm run cache:collect:journal-5m-day -- --cache-root <path> --provider ibkr --requests DEVS@2026-06-01T09:42:00-04:00 --write
```

The CLI defaults to dry-run unless `--write` is supplied.

## Cache Shape

Output path:

```text
<cacheRoot>/<provider>/<SYMBOL>/5m/<lookbackBars>-<endTimeMs>.json
```

For the default extended-session policy, this is normally:

```text
<cacheRoot>/<provider>/<SYMBOL>/5m/192-<exchangeLocal20:00EndTimeMs>.json
```

The JSON wrapper has:

- `schemaVersion: 1`
- `cachedAt`
- `request`
- `response`
- `journalTradeContextPolicy`

The `request`/`response` shape stays compatible with the existing validation
cache and real-cache batch reader.

## Deduping

Requests are parsed as:

```text
SYMBOL@timestamp
```

Multiple trade-context timestamps for the same symbol and exchange-local date
collapse to one day cache request. The wrapper records all source trade-context
timestamps under:

```text
journalTradeContextPolicy.sourceTradeContextTimestamps
```

## Live Provider Safety

Dry-run does not construct a live provider.

Write mode supports:

- `stub`
- `ibkr`
- `twelve_data`

IBKR write mode requires:

```text
LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true
```

Optional IBKR environment variables:

```text
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_HOST
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_PORT
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CLIENT_ID
LEVEL_JOURNAL_5M_DAY_CACHE_IBKR_CONNECTION_TIMEOUT_MS
LEVEL_VALIDATION_IBKR_TIMEOUT_MS
```

Twelve Data write mode requires:

```text
TWELVE_DATA_API_KEY
```

## As-Of Boundary

The collection wrapper writes full-day 5m data, but it does not build or alter
snapshots. The snapshot builder remains responsible for no-lookahead filtering.

Existing tests prove:

- full-day 5m input produces the same snapshot as closed-only 5m input for the
  requested trade/as-of timestamp
- later same-day candles are future exclusions
- a still-forming candle is a partial exclusion
- `safety.noLookaheadApplied` remains true

## Boundaries

This gate does not:

- change LevelEngine eligible timeframes
- feed 15m into LevelEngine
- change support/resistance generation
- change LevelEngine scoring, ranking, clustering, surfaced selection, or
  extension generation
- change journal app behavior
- change alert, monitoring, Discord, or runtime defaults
- add grading, coaching, P/L, giveback, behavior scoring, recommendations,
  buy/sell/hold decisions, or trade advice

## Verification

Focused:

```text
npx tsx --test src/tests/collect-journal-trade-context-5m-day-cache.test.ts src/tests/journal-trade-context-5m-day-policy.test.ts
npm run build
git diff --check
```

## Recommended Next Gate

Completed:

```text
levels_system_journal_trade_context_5m_day_cache_dry_run
```

Evidence:

```text
docs/151_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_DRY_RUN.md
```

Completed:

```text
levels_system_journal_trade_context_5m_day_cache_ibkr_write_disabled_preflight
levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write_plan
```

Evidence:

```text
docs/152_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_WRITE_DISABLED_PREFLIGHT.md
docs/153_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_OPERATOR_WRITE_PLAN.md
```

Current recommended next gate:

```text
levels_system_journal_trade_context_5m_day_cache_ibkr_operator_write
```

Reason: the collection wrapper is deterministic, fake-provider tested, and now
dry-run verified against the intended local validation-cache root. Write mode
also fails closed unless the explicit IBKR write-enable environment variable is
set. The exact operator write plan is documented; the next safe producer-side
step is the explicit operator write only when IBKR is ready.

Short priority detour completed:
`levels_system_journal_trade_context_1m_execution_window_policy` records the
optional future 1m execution-detail idea without changing this 5m dry-run
priority.
