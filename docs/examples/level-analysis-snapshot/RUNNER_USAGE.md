# LevelAnalysisSnapshot Runner Usage

## Purpose

Use the LevelAnalysisSnapshot runner to generate factual chart-analysis snapshot JSON from local candle files.

The runner is for snapshot generation only. It does not fetch live data, post alerts, post to Discord, grade trades, coach users, calculate P/L, calculate giveback, score behavior, or create journal UI behavior.

## Package Commands

Generic runner:

```powershell
npm run snapshot:level-analysis -- --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-15m docs/examples/level-analysis-snapshot/sample-15m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

Deterministic review fixture:

```powershell
npm run snapshot:level-analysis:review
```

Ignored production-style smoke artifact:

```powershell
npm run snapshot:level-analysis:smoke
```

Deterministic review batch manifest:

```powershell
npm run manifest:level-analysis:snapshots:review
```

Generic batch manifest:

```powershell
npm run manifest:level-analysis:snapshots -- --input artifacts/level-analysis-snapshot --out artifacts/level-analysis-snapshot/<batchId>/level-analysis-snapshot-batch-manifest-v1.json --output-root artifacts/level-analysis-snapshot --batch-id <batchId>
```

Local real-cache batch runner:

```powershell
npm run snapshot:level-analysis:batch:real-cache -- --cache-root .validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --out-root artifacts/level-analysis-snapshot-real-cache-batch --batch-id real-cache-batch-2026-06-01 --generated-at 2026-06-01T00:00:00.000Z
```

Direct invocation:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-15m docs/examples/level-analysis-snapshot/sample-15m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

## Inputs

Required:

- `--symbol`
- `--as-of`
- `--reference-price`
- `--candles-5m`

Recommended:

- `--candles-15m`
- `--candles-4h`
- `--candles-daily`
- `--previous-close`
- `--out`

Candle JSON can be an array or an object with a `candles` array.

`--candles-15m` is optional. The runner counts and filters 15m candles in
`inputSummary` and, when supplied, can populate `timeframeFacts["15m"]` as
facts-only context. 15m candles are not used for LevelEngine level generation.

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

Recommended production-style manifest convention:

```text
artifacts/level-analysis-snapshot/<batchId>/level-analysis-snapshot-batch-manifest-v1.json
```

Recommended local real-cache batch convention:

```text
artifacts/level-analysis-snapshot-real-cache-batch/<batchId>/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
artifacts/level-analysis-snapshot-real-cache-batch/<batchId>/level-analysis-snapshot-batch-manifest-v1.json
```

Committed review manifest:

```text
docs/examples/level-analysis-snapshot/batch-manifest/latest-level-analysis-snapshot-batch-manifest.json
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

## Verify Batch Manifests

Generated manifests should include:

- `schemaVersion: level-analysis-snapshot-batch-manifest/v1`
- `producer: levels-system`
- `batchId`
- `generatedAt`
- `entries`
- `summary`
- `safety`

Each entry should include artifact path, validation status, timeframe coverage,
missing 15m tracking, safety flags, diagnostics, and checksum when artifact
content is readable.

## Generate A Local Real-Cache Batch

Use the real-cache batch runner when snapshot artifacts do not exist yet and
the local validation cache already has candle files.

Required cache layout:

```text
<cache-root>/<provider>/<SYMBOL>/<timeframe>/<lookbackBars>-<endTimeMs>.json
```

Required timeframes:

- `5m`
- `4h`
- `daily`

Optional:

- `15m`

The runner reads local files only. It does not fetch from providers or alter
LevelEngine behavior. If required timeframe cache is missing for a selected
symbol, the run fails with an explicit missing-cache message. If 15m is absent,
the generated manifest records the missing 15m condition.

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
