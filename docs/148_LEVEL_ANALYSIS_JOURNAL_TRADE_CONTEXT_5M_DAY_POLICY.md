# LevelAnalysis Journal Trade Context 5m Day Policy

## Purpose

This gate extends `levels_system_multi_timeframe_snapshot_hardening` with a
journal trade-context 5m request policy.

When TraderLink Intelligence asks `levels-system` for trade-context candles for
a symbol on a trading day, the producer-side request should be day-scoped
instead of narrowly trade-window scoped.

The practical default is:

- fetch one full extended-session 5m day for the symbol
- cache/reuse that same symbol/date request for later journal trades on the
  same day
- still build snapshots with candle-close as-of filtering for the specific
  trade timestamp

This keeps IBKR usage more efficient without changing what the journal analysis
is allowed to consume.

## Added

- `src/lib/analysis/journal-trade-context-5m-day-policy.ts`
- `src/tests/journal-trade-context-5m-day-policy.test.ts`

## Policy

The helper:

```ts
buildJournalTradeContextFiveMinuteDayPolicy(...)
```

returns a normalized `HistoricalFetchRequest` for:

- `timeframe: "5m"`
- one symbol
- one exchange-local date
- default timezone `America/New_York`
- default extended-session window `04:00` through `20:00`
- `lookbackBars: 192`
- `endTimeMs` at the exchange-local extended-session close

The cache identity is scoped to:

```text
symbol | 5m | timezone | exchange-local date | session start/end
```

Therefore multiple journal trades in the same symbol on the same exchange-local
day can reuse the same 5m candle collection.

## Why Full-Day 5m Fetching Is Useful

The journal app often asks for context around a specific historical trade.
If several users or records ask for the same symbol on the same day at different
trade times, a narrow trade-window request can repeatedly hit IBKR for highly
overlapping 5m data.

A full extended-session 5m day is still a bounded request and should usually be
small enough to collect once:

- 16 hours
- 12 bars per hour
- 192 expected 5m bars

The resulting candle set can support multiple as-of snapshots for that same
symbol/day without another IBKR request.

## As-Of Safety

Full-day fetching does not mean full-day consumption.

`buildLevelAnalysisSnapshotFromCandles(...)` already filters all supplied 5m
candles by candle close as of `asOfTimestamp`.

The test coverage proves:

- a snapshot built from full-day 5m candles equals the same snapshot built from
  only the 5m candles closed by the trade timestamp
- still-forming 5m candles are counted as partial exclusions
- later same-day 5m candles are counted as future exclusions
- `safety.noLookaheadApplied` remains true

This is the key boundary: the cache may contain the full day, but the snapshot
uses only the facts available at the requested trade/as-of time.

## Boundaries

This gate does not:

- call IBKR directly
- write cache files
- change LevelEngine eligible timeframes
- feed 15m into LevelEngine
- change support/resistance generation
- change LevelEngine scoring, ranking, clustering, surfaced selection, or
  extension generation
- change journal app behavior
- add grading, coaching, P/L, giveback, behavior scoring, recommendations,
  buy/sell/hold decisions, or trade advice

## Verification

Focused:

```text
npx tsx --test src/tests/journal-trade-context-5m-day-policy.test.ts
npm run build
```

## Recommended Next Gate

`levels_system_journal_trade_context_5m_day_cache_collection`

Reason: the pure request/cache policy is now locked. The next producer-side
step, if needed, is a small collection wrapper that uses this policy to fetch
and store day-scoped 5m cache files while preserving the same as-of filtering
boundary in snapshot generation.

Status: completed by
`docs/149_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_COLLECTION.md`.
