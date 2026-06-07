# Levels System Journal Trade Context 1m Execution Window Policy

## Purpose

Gate `levels_system_journal_trade_context_1m_execution_window_policy` records
the optional 1m candle idea for future Trader Intelligence execution replay.

The policy keeps `5m` as the primary journal trade-context timeframe. It adds a
narrow, optional `1m` execution-window policy for cases where the journal later
needs finer replay detail around actual executions.

This gate does not add live 1m provider support, does not collect 1m candles,
and does not change snapshot generation or LevelEngine behavior.

## Added

- `src/lib/analysis/journal-trade-context-1m-execution-window-policy.ts`
- `src/tests/journal-trade-context-1m-execution-window-policy.test.ts`

## Timeframe Roles

Recommended journal context split:

- `5m`: primary trade-context candle layer
- `15m`: optional broader intraday structure/facts layer
- `1m`: optional execution replay detail only

`1m` should not replace the 5m day cache. It should be requested only when
there is a clear need for execution-level replay detail.

## Policy

The helper:

```ts
buildJournalTradeContextOneMinuteExecutionWindowPolicy(...)
```

builds an optional 1m replay request from:

- symbol
- first execution timestamp
- optional final execution timestamp
- optional pre-execution buffer
- optional post-execution buffer

Defaults:

- pre-execution buffer: `30` minutes
- post-execution buffer: `30` minutes

The request is window-scoped:

```text
firstExecutionTimestamp - preExecutionBufferMinutes
through
finalExecutionTimestamp + postExecutionBufferMinutes
```

The default is intentionally not full-day 1m. Full-day 1m should remain a later
decision only if real usage proves repeated same-symbol same-day 1m replay
requests are common enough to justify the extra data volume.

## Current Capability Boundary

`1m` is intentionally not provider-capable yet in the active fetch path:

- `PROVIDER_CANDLE_TIMEFRAMES` excludes `1m`
- `LEVEL_ENGINE_ELIGIBLE_TIMEFRAMES` excludes `1m`
- `isProviderCandleTimeframe("1m")` returns false
- `isLevelEngineEligibleTimeframe("1m")` returns false

The policy defines the future request shape and cache identity, but a later
gate must explicitly add provider planning/collection before any live 1m data
is fetched.

## Safety

The policy carries explicit safety flags:

- `optionalExecutionReplayOnly`
- `fiveMinuteDayContextRemainsPrimary`
- `notFullDayByDefault`
- `notLevelEngineEligible`
- `noLevelEngineBehaviorChange`
- `noTradeAdvice`

These flags are intentionally stronger than the current implementation needs so
future collection/UI work cannot accidentally promote 1m into the primary
trade-context or LevelEngine path.

## Boundaries

This gate does not:

- fetch 1m data
- write 1m cache files
- add `1m` to provider planning
- add `1m` to LevelEngine eligible timeframes
- change support/resistance generation
- change LevelEngine scoring, ranking, clustering, surfaced selection, or
  extension generation
- change snapshot generation
- change journal app behavior
- change alert, monitoring, Discord, or runtime defaults
- add grading, coaching, P/L, giveback, behavior scoring, recommendations,
  buy/sell/hold decisions, or trade advice

## Verification

Focused:

```text
npx tsx --test src/tests/journal-trade-context-1m-execution-window-policy.test.ts src/tests/journal-trade-context-5m-day-policy.test.ts
npm run build
git diff --check
```

## Recommended Next Gate

Return to:

```text
levels_system_journal_trade_context_5m_day_cache_dry_run
```

Reason: the optional 1m idea is now captured as a future execution-detail policy.
The near-term producer priority remains validating the 5m day-cache collection
flow with an operator dry-run before any real IBKR writes.
