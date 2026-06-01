# Levels System 15m Live Provider Hookup Design

## Purpose

This document designs the safe live-provider hookup for the 15m validation
cache collection tool.

The goal is to make the next implementation gate straightforward: `15m`
candles can be fetched only when an operator explicitly runs the cache
collection tool in write mode, while `15m` remains outside LevelEngine
support/resistance generation.

This is a design and contract gate only. It does not implement live provider
fetching, write real 15m cache files, change LevelEngine behavior, change
support/resistance detection, change runtime defaults, change alert,
monitoring, or Discord behavior, or add journal interpretation.

## Current Provider State

The current market-data split is:

- `CandleTimeframe` in `src/lib/market-data/candle-types.ts` is
  `daily | 4h | 5m`.
- `CandleFetchTimeframe` already includes `15m` and `1m`, but the historical
  provider request path still uses `CandleTimeframe`.
- `HistoricalFetchRequest`, `HistoricalFetchPlan`, `BaseCandleProviderResponse`,
  and `CandleProviderResponse` are still typed around `CandleTimeframe`.
- `buildHistoricalFetchPlan` maps only `daily`, `4h`, and `5m` to interval,
  IBKR bar-size, and Twelve Data interval strings.
- `IbkrHistoricalCandleProvider` and `TwelveDataHistoricalCandleProvider`
  can only receive the current `HistoricalFetchRequest` type, so their public
  fetch path does not yet accept `15m`.
- `ValidationCachedCandleFetchService` also keys the general validation cache
  by `CandleTimeframe`, which preserves LevelEngine-focused cache behavior.
- `collect-15m-validation-cache.ts` intentionally owns a narrow `"15m"` request
  and wrapper type for the collection tool.

The 15m collection tool therefore has a safe dry-run path and a deterministic
stub write path, but live `ibkr` and `twelve_data` write mode intentionally
fails with an actionable message.

## Current Blocker

The blocker is not the cache writer layout. The writer can already create:

```text
.validation-cache/candles/<provider>/<SYMBOL>/15m/<lookbackBars>-<endTimeMs>.json
```

The blocker is the provider abstraction:

- live providers do not yet expose a `15m` fetch request type;
- fetch planning does not yet produce `15 mins` / `15min` provider request
  metadata;
- provider responses cannot currently type their `timeframe` as `15m`;
- widening the wrong shared type could accidentally make LevelEngine paths
  consider `15m` eligible for support/resistance generation.

## Design Decision

Do not add `15m` to the existing `CandleTimeframe` type.

`CandleTimeframe` should remain the LevelEngine-eligible candle timeframe
contract for now:

```ts
type CandleTimeframe = "daily" | "4h" | "5m";
```

The next implementation gate should introduce, or promote from existing
`CandleFetchTimeframe`, a separate provider/validation-cache fetch timeframe
lane:

```ts
type ProviderCandleTimeframe = "daily" | "4h" | "15m" | "5m";
type LevelEngineEligibleTimeframe = "daily" | "4h" | "5m";
type ValidationCacheCollectionTimeframe = ProviderCandleTimeframe;
```

The important split is:

- provider fetch capability may include `15m`;
- validation cache collection may write `15m`;
- LevelAnalysisSnapshot may summarize supplied `15m` facts;
- LevelEngine eligibility must still exclude `15m`.

This keeps 15m support additive and factual without widening support/resistance
generation inputs.

## Desired 15m Live Collection Flow

The future live collection command remains:

```text
npm run cache:collect:15m -- --cache-root <path> --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --lookback-bars 100 --end-time 2026-06-01T16:00:00Z --write
```

Expected flow:

1. Parse explicit operator arguments.
2. Normalize symbols and `endTimeMs` to a 15m boundary.
3. Derive one planned cache path per symbol.
4. Skip existing files unless `--overwrite` is supplied.
5. In dry-run mode, stop here without provider construction or provider calls.
6. In write mode, construct only the requested live provider.
7. Fetch `15m` candles for each explicit symbol.
8. Normalize provider response metadata into the existing validation-cache
   wrapper shape.
9. Write only `15m` validation-cache files.
10. Print per-symbol status.
11. Exit non-zero when any requested write fails.

No runtime monitor, alert router, Discord gateway, or LevelEngine path should
be constructed by this tool.

## Provider Abstraction Changes Needed

Recommended next implementation:

1. Add a provider-capability timeframe type that includes `15m`.
2. Add a provider-fetch request/plan/response type that can carry `15m`.
3. Keep `CandleTimeframe` unchanged for existing LevelEngine and runtime code.
4. Update fetch planning to support `15m` only in the provider-capability lane:
   - interval: `15 * 60 * 1000`
   - IBKR bar size: `15 mins`
   - Twelve Data interval: `15min`
   - planned bar count: at least `lookbackBars`, with the same over-fetch style
     used by other intraday requests.
5. Allow live historical providers to accept the provider-capability request
   type.
6. Keep `CandleFetchService` behavior unchanged unless a focused overload or
   helper is needed for validation-cache collection.

Safe implementation options:

- Add a narrow `fetchProviderCandles` helper for collection tooling.
- Or widen `HistoricalFetchRequest` to a provider-capability timeframe while
  introducing a separate `LevelEngineEligibleTimeframe` alias and tests.

The narrower helper is lower risk because it avoids broad churn in runtime and
LevelEngine code.

## Cache Writer Changes Needed

No broad cache writer redesign is needed.

The collection tool already writes a validation-cache-compatible wrapper:

```ts
type FifteenMinuteValidationCacheEntry = {
  schemaVersion: 1;
  cachedAt: number;
  request: {
    symbol: string;
    timeframe: "15m";
    lookbackBars: number;
    endTimeMs: number;
    provider: "ibkr" | "stub" | "twelve_data";
  };
  response: {
    provider: "ibkr" | "stub" | "twelve_data";
    symbol: string;
    timeframe: "15m";
    requestedLookbackBars: number;
    candles: Candle[];
    fetchStartTimestamp: number;
    fetchEndTimestamp: number;
    requestedStartTimestamp: number;
    requestedEndTimestamp: number;
    sessionMetadataAvailable: boolean;
    actualBarsReturned: number;
    completenessStatus: "complete" | "partial" | "empty";
    stale: boolean;
    validationIssues: unknown[];
    sessionSummary: null;
  };
};
```

The next implementation gate should preserve that wrapper and avoid changing
existing `ValidationCachedCandleFetchService` behavior unless a small shared
normalizer reduces duplication.

## CLI And Tool Changes Needed

The tool already supports the desired CLI shape:

- `--cache-root`
- `--provider`
- `--symbols`
- `--lookback-bars`
- `--end-time`
- `--dry-run`
- `--write`
- `--overwrite`

The next implementation should replace the live-provider failure stub in
`defaultFetcherForProvider` with an explicit provider construction path for
`ibkr` and, if config is available, `twelve_data`.

Dry-run behavior must remain unchanged:

- no provider construction;
- no provider calls;
- no file writes;
- planned paths only.

Write behavior should remain explicit:

- no write without `--write`;
- skip existing by default;
- require `--overwrite` to replace;
- per-symbol failures continue to be captured.

## IBKR Behavior

Future IBKR write mode should:

- require explicit provider selection: `--provider ibkr`;
- require an explicit connected or connectable IBKR configuration;
- fail clearly when IBKR config/session is unavailable;
- avoid default background connection attempts in dry-run mode;
- use operator-triggered command execution only;
- avoid CI usage;
- use historical data only;
- issue one bounded historical request per symbol through existing pacing;
- request `15 mins` bars;
- keep `useRTH` and historical-data settings explicit and documented;
- produce per-symbol failures instead of hiding provider errors;
- never route anything into alerts, monitoring, or Discord.

The provider should remain a data source, not a runtime trigger.

## Twelve Data Behavior

If Twelve Data remains supported for this tool, future write mode should:

- require explicit provider selection: `--provider twelve_data`;
- require an explicit API key/config source;
- fail clearly when the key is missing;
- use interval `15min`;
- avoid CI usage;
- avoid default network calls outside operator-triggered write mode;
- preserve per-symbol failure reporting.

If Twelve Data config expectations are not currently stable, the first live
hookup may implement IBKR only and leave Twelve Data with the current explicit
failure message.

## Credential And Config Expectations

Provider credentials/config must be explicit at command runtime.

Acceptable future sources:

- environment variables already used by provider factory code;
- explicit CLI flags if the repo standardizes them;
- an injected provider in tests.

Required safety behavior:

- missing IBKR session/config fails before writing any file for that symbol;
- missing Twelve Data API key fails before any request;
- dry-run does not require credentials;
- tests use fake providers only;
- no credentials are committed or written to artifacts.

## No-Lookahead Boundaries

The collection tool writes provider-returned 15m candles by request end time.
It does not decide snapshot as-of eligibility.

No-lookahead enforcement remains in snapshot/facts building:

- future 15m candles are excluded by candle-close semantics;
- still-forming 15m candles are excluded;
- `inputSummary.filteredCandleCounts["15m"]` reports usable closed candles;
- `inputSummary.excludedFutureCandleCounts["15m"]` reports future exclusions;
- `inputSummary.excludedPartialCandleCounts["15m"]` reports partial exclusions;
- `timeframeFacts["15m"]` stays additive and factual;
- `levelEngineOutput` remains unchanged with or without supplied 15m candles.

## LevelEngine Separation Strategy

The next implementation should prove the following in tests:

- `CandleTimeframe` or `LevelEngineEligibleTimeframe` excludes `15m`;
- raw candidate building remains limited to `daily`, `4h`, and `5m`;
- LevelEngine metadata `providerByTimeframe` remains limited to LevelEngine
  timeframes;
- supplied 15m cache data can populate `timeframeFacts["15m"]`;
- adding 15m cache data does not change LevelEngine output versus the same
  snapshot without 15m;
- provider hookup modules do not import alert, monitoring, Discord, or journal
  paths.

This is the core safety rule: provider fetch capability is not LevelEngine
eligibility.

## Testing Strategy

Next implementation tests should avoid live providers.

Recommended focused tests:

- provider fetch planning maps `15m` to `15 mins` for IBKR;
- provider fetch planning maps `15m` to `15min` for Twelve Data, if enabled;
- collection tool write mode uses an injected fake live provider for `15m`;
- dry-run still performs no provider construction or provider calls;
- write mode skips existing files unless `--overwrite` is supplied;
- per-symbol failures produce non-zero CLI write exit behavior;
- LevelEngine eligible timeframes still exclude `15m`;
- supplied 15m snapshot output preserves LevelEngine parity;
- source scans confirm no alert/monitoring/Discord imports.

Operator-only smoke tests can be added after fake-provider tests pass.

## Rollout Phases

1. Design gate: this document.
2. Hookup tool gate: implement live provider construction behind explicit
   `--write`, with fake-provider tests and no real cache writes.
3. Live dry-run gate: verify the command still plans target paths without
   credentials or writes.
4. Operator live write gate: run against a small explicit symbol set and commit
   only compact inspection artifacts.
5. Real-cache validation gate: build snapshots from 5m/15m/4h/daily cached
   inputs and prove 15m facts are additive.
6. Broader cache expansion gate: expand target symbols only after the focused
   write and validation path is stable.

## Anti-Goals

This design does not:

- implement live provider fetching;
- write real 15m cache files;
- add `15m` to LevelEngine support/resistance generation;
- change LevelEngine defaults;
- change runtime mode defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback, behavior scoring,
  recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
levels_system_15m_live_provider_hookup_tool
```

Reason: the design is clear enough to implement the actual provider hookup
behind explicit write mode, fake-provider tests, and the existing dry-run-first
collection tool boundary.
