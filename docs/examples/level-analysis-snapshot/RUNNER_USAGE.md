# LevelAnalysisSnapshot Runner Usage

## Purpose

Use the LevelAnalysisSnapshot runner to generate factual chart-analysis snapshot JSON from local candle files.

The runner is for snapshot generation only. It does not fetch live data, post alerts, post to Discord, grade trades, coach users, calculate P/L, calculate giveback, score behavior, or create journal UI behavior.

## Package Commands

Generic runner:

```powershell
npm run snapshot:level-analysis -- --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

Deterministic review fixture:

```powershell
npm run snapshot:level-analysis:review
```

Ignored production-style smoke artifact:

```powershell
npm run snapshot:level-analysis:smoke
```

Direct invocation:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

## Inputs

Required:

- `--symbol`
- `--as-of`
- `--reference-price`
- `--candles-5m`

Recommended:

- `--candles-4h`
- `--candles-daily`
- `--previous-close`
- `--out`

Candle JSON can be an array or an object with a `candles` array.

## Outputs

When `--out` is supplied, the runner writes the snapshot JSON to that path.

When `--out` is omitted, the runner prints JSON to stdout.

Recommended review output:

```text
docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

Recommended production-style output convention:

```text
artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

Smoke-test output:

```text
artifacts/level-analysis-snapshot-smoke/SNAP/1777645200000/level-analysis-snapshot-v1.json
```

`artifacts/` is ignored by git. Smoke outputs are local operational checks and should not be committed.

## Verify Output Shape

Generated output should include:

- `schemaVersion: level-analysis-snapshot/v1`
- `producer: levels-system`
- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

For replay/journal use, require:

- `safety.noLookaheadApplied: true`
- `safety.levelOutputUnchanged: true`
- `safety.factsOnlyVWAP: true`
- `safety.shelvesAreFactsOnly: true`
- `safety.syntheticExtensionsClearlyMarked: true`

## Downstream Adapter Fixture

Use this compact fixture for TraderLink Intelligence / journal connector tests:

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

The compact fixture is smaller than the full generated review snapshot and is intended for downstream contract tests.

## Avoid Stale Or Lookahead-Tainted Snapshots

- Always pass an explicit `--as-of`.
- Use candle files that include timestamps.
- Let the runner filter future and still-forming candles.
- Do not manually edit generated JSON for production usage.
- Keep the raw generated snapshot for auditability.
- Regenerate snapshots when candle inputs or as-of timestamps change.

## What Not To Infer

Runner outputs are factual chart-analysis context.

Do not infer:

- trade grading
- coaching
- P/L
- giveback
- behavior scoring
- buy/sell/hold decisions
- entry/exit decisions
- trade advice

TraderLink Intelligence / the journal owns downstream interpretation.
