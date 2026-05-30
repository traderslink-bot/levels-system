# LevelAnalysisSnapshot Schema Stabilization Review

## Scope

This gate stabilizes the `LevelAnalysisSnapshot` contract for TraderLink Intelligence / journal consumption. The changes are limited to snapshot schema fields, derived nearest-level convenience fields, tests, and regenerated review artifacts.

This gate does not change support/resistance detection, LevelEngine output, runtime mode defaults, alerts, monitoring, Discord behavior, trader-context behavior, or journal grading/coaching/P/L/giveback behavior.

## Fields Added

New top-level fields:

- `schemaVersion`: fixed value `level-analysis-snapshot/v1`
- `producer`: fixed value `levels-system`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`

`inputSummary` includes:

- `timeframesPresent`
- `candleCounts`
- `filteredCandleCounts`
- `excludedFutureCandleCounts`
- `excludedPartialCandleCounts`
- `timeframes`
- `previousCloseProvided`

Per-timeframe summary fields:

- `provided`
- `candleCount`
- `filteredCandleCount`
- `excludedFutureCandleCount`
- `excludedPartialCandleCount`

Supported timeframe keys:

- `5m`
- `15m`
- `4h`
- `daily`

The `15m` slot is included as an explicit absent/zero slot for future compatibility.

## Generated Sample Summary

Updated artifact:

- `docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json`

Sample values:

- `schemaVersion`: `level-analysis-snapshot/v1`
- `producer`: `levels-system`
- `timeframesPresent`: `5m`, `4h`, `daily`
- `candleCounts.5m`: `15`
- `candleCounts.4h`: `7`
- `candleCounts.daily`: `6`
- `previousCloseProvided`: `true`
- `nearestSupport`: `SNAP-support-zone-3` at `9.98`
- `nearestResistance`: `null`

## Safety For TraderLink Intelligence / Journal Use

The added fields are safe for downstream use because they are contract metadata or deterministic derivations:

- `schemaVersion` and `producer` are static identifiers.
- `inputSummary` is derived from supplied candle inputs after as-of filtering.
- `nearestSupport` and `nearestResistance` are derived only from the existing `LevelEngineOutput` and `referencePrice`.
- No new levels are created.
- `LevelEngineOutput` is cloned and preserved unchanged.
- No support/resistance detection, scoring, clustering, selection, extension generation, or alert behavior is touched.

## Nearest Level Derivation

`nearestSupport`:

- Looks at existing support-kind levels in `LevelEngineOutput`.
- Selects the closest support at or below `referencePrice`.
- Returns `null` when no support exists on the correct side.

`nearestResistance`:

- Looks at existing resistance-kind levels in `LevelEngineOutput`.
- Selects the closest resistance at or above `referencePrice`.
- Returns `null` when no resistance exists on the correct side.

Both fields include:

- `levelId`
- `kind`
- `bucket`
- `representativePrice`
- `zoneLow`
- `zoneHigh`
- `strengthScore`
- `strengthLabel`
- `distanceFromReferencePct`
- `isExtension`
- `extensionSource` when present

## Replay / As-Of Compatibility

The input summary is intentionally based on the as-of-admitted candle set. Future and still-forming candles are filtered before the public contract summary is built.

This preserves replay stability:

- Appending future candles after the same `asOfTimestamp` does not change the snapshot.
- Partial/still-forming candles are excluded from the analytical snapshot.
- The prior replay/as-of safety tests continue to pass against the full snapshot object.

The excluded-count fields remain present in the schema, but they do not leak future-array size into historical snapshots. The builder still emits `candle_close_as_of_filter_applied` diagnostics to show that as-of filtering ran.

## Compatibility Notes

Backward compatibility impact:

- This is an additive schema change.
- Existing fields remain present.
- Existing `levelEngineOutput` shape remains unchanged.
- Existing facts, intelligence report, quality audit, diagnostics, and safety fields remain present.

Downstream consumers should:

- Treat `schemaVersion` as the contract discriminator.
- Prefer `nearestSupport` / `nearestResistance` for convenience when present.
- Continue reading the full level buckets for complete support/resistance context.
- Treat `nearestResistance: null` or `nearestSupport: null` as an explicit absence, not an error.

## What Remains Missing

Still useful for future journal-readiness gates:

- Explicit `contractGeneratedAt` or artifact generation metadata if needed outside replay-safe snapshots.
- Explicit source fixture/file metadata for review artifacts.
- A richer `sourceDataCompleteness` object separate from `inputSummary`.
- A dedicated journal view model if TraderLink needs a smaller consumption shape.
- Real ticker replay validation using cached historical candles.
- Multi-sample fixture coverage with resistance, major, intermediate, intraday, historical extension, and synthetic extension examples in one pack.

## Validation

Required validation commands for this gate:

```powershell
npx tsc --noEmit
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-from-candles.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-replay-safety.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-runner.test.ts
npm test
```

## Recommended Next Gate

Recommended next gate: `real_ticker_replay_validation`.

Rationale: the schema is now versioned and journal-friendly enough to validate against real cached ticker/replay data before adding more contract fields or a separate journal connector view model.
