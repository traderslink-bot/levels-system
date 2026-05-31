# Production Snapshot Runner Packaging

## Purpose

This document packages the `LevelAnalysisSnapshot` runner flow for clean, repeatable v1 snapshot artifact generation.

The runner packaging goal is operational readiness for TraderLink Intelligence / journal consumption. It does not change support/resistance detection, LevelEngine output behavior, runtime mode defaults, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, synthetic extension behavior, journal grading, coaching, P/L, giveback analysis, behavior scoring, journal UI behavior, or recommendation behavior.

## Current Runner State

The runner already exists at:

```text
src/scripts/run-level-analysis-snapshot.ts
```

It:

- reads candle JSON files
- accepts required symbol, as-of timestamp, reference price, and 5m candles
- accepts optional 4h candles, daily candles, and previous close
- delegates to the no-lookahead-safe from-candles snapshot builder
- writes deterministic JSON
- prints JSON to stdout when no output path is supplied
- writes JSON to `--out` when supplied
- does not fetch live data
- does not call network APIs
- does not call Discord, alerts, monitoring, or trader-context code

The runner is already covered by:

```text
src/tests/level-analysis-snapshot-runner.test.ts
```

## Intended Production Usage

Use the runner to generate `LevelAnalysisSnapshot` v1 artifacts from already-available candle JSON.

The intended flow is:

1. Upstream data job prepares closed candle JSON files.
2. Caller chooses `symbol`, `asOfTimestamp`, `referencePrice`, and optional `previousClose`.
3. Caller invokes the runner.
4. Runner builds a v1 snapshot with candle-close as-of safety applied.
5. Runner writes a JSON artifact.
6. TraderLink Intelligence / journal adapter loads, validates, preserves, and consumes the artifact as factual chart context.

The runner is not a journal adapter and does not implement downstream interpretation.

## Supported Inputs

Supported CLI inputs:

- `--symbol <ticker>`
- `--as-of <timestamp|ISO>`
- `--reference-price <number>`
- `--candles-5m <path>`
- `--candles-4h <path>`
- `--candles-daily <path>`
- `--previous-close <number>`
- `--out <path>`
- `--format json`

Candle JSON may be:

- an array of candle objects, or
- an object with a `candles` array.

Each candle must include:

- `timestamp`
- `open`
- `high`
- `low`
- `close`
- `volume`

Timestamps may be numeric millisecond timestamps or parseable ISO strings.

## Required Inputs

Required for every runner call:

- `--symbol`
- `--as-of`
- `--reference-price`
- `--candles-5m`

Recommended for journal-ready snapshots:

- `--candles-4h`
- `--candles-daily`
- `--previous-close`
- `--out`

If higher timeframes are omitted, the snapshot can still be generated, but the downstream consumer should treat the missing timeframe data as a completeness limitation.

## Output Artifact Shape

The output is a serialized `LevelAnalysisSnapshot` v1 JSON object.

Required v1 fields include:

- `schemaVersion`
- `producer`
- `symbol`
- `asOfTimestamp`
- `inputSummary`
- `nearestSupport`
- `nearestResistance`
- `levelEngineOutput`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

Journal-ready from-candles snapshots should also include:

- `referencePrice`
- `sessionFacts`
- `volumeFacts`
- `volumeShelves`
- `marketContext`
- `factsBundle`

The output is factual chart-analysis context only.

## Output Directory Conventions

Recommended local/review locations:

- deterministic sample output:
  - `docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json`
- multi-scenario review outputs:
  - `docs/examples/level-analysis-snapshot/outputs/`
- real-cache compact summaries:
  - `docs/examples/level-analysis-snapshot/real-cache-more-symbols/`

Recommended production-style convention:

```text
artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

Do not commit bulky production candle inputs or large production snapshot dumps unless a review gate explicitly asks for them. Keep committed artifacts small and contract-focused.

## CLI / Script Usage

Generic package script:

```powershell
npm run snapshot:level-analysis -- --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

Deterministic review script:

```powershell
npm run snapshot:level-analysis:review
```

Direct runner invocation remains supported:

```powershell
npx tsx src/scripts/run-level-analysis-snapshot.ts --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

## No-Lookahead Expectations

Every runner call must use an explicit `--as-of` value.

The from-candles builder applies candle-close as-of filtering before building:

- levels
- session facts
- volume facts
- volume shelves
- market context
- level intelligence report
- level quality audit

Downstream consumers should require:

- `safety.noLookaheadApplied: true`
- `diagnostics` containing candle-close as-of filtering evidence
- `inputSummary` with candle count and timeframe availability details

Do not use snapshots for replay/journal analysis if the as-of safety flag is missing or false.

## SchemaVersion And Producer Guarantees

Runner output must include:

```text
schemaVersion: level-analysis-snapshot/v1
producer: levels-system
```

The package test coverage verifies the package scripts and runner output shape. The schema lock and connector tests verify downstream contract expectations.

## Generate A Single-Symbol Snapshot

Example:

```powershell
npm run snapshot:level-analysis -- --symbol ABCD --as-of 2026-05-01T15:55:00-04:00 --reference-price 2.47 --candles-5m path/to/ABCD-5m.json --candles-4h path/to/ABCD-4h.json --candles-daily path/to/ABCD-daily.json --previous-close 2.1 --out artifacts/level-analysis-snapshot/ABCD/1777665300000/level-analysis-snapshot-v1.json
```

Use cached or prebuilt candle files only. The runner must not be used as a live data fetcher.

## Generate Replay / As-Of Snapshots

For replay snapshots:

1. Choose the replay timestamp.
2. Pass that timestamp through `--as-of`.
3. Include the full candle file if available.
4. Let the runner filter future and still-forming candles.
5. Store the output path with the symbol and as-of timestamp.

Appending future candles to the input file should not change a snapshot generated for the same `--as-of` timestamp.

## Generate Fixture / Review Snapshots

Use:

```powershell
npm run snapshot:level-analysis:review
```

This regenerates:

```text
docs/examples/level-analysis-snapshot/latest-level-analysis-snapshot.json
```

The review fixture is useful for quick manual inspection. The smaller downstream connector fixture remains:

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

Use the compact connector fixture for downstream adapter tests.

## Downstream Consumption

TraderLink Intelligence / journal systems should:

- validate `schemaVersion` and `producer`
- require `symbol` and `asOfTimestamp`
- require `safety.noLookaheadApplied` for replay/journal use
- preserve the raw snapshot unchanged
- derive a factual connector view
- treat `levelEngineOutput` as canonical chart context
- treat synthetic continuation-map rows as forward-planning chart map levels only
- treat `LevelQualityAudit` findings as diagnostics
- keep execution interpretation, grading, coaching, P/L, giveback, behavior scoring, and UI behavior downstream

## Limitations

Current runner limitations:

- JSON output only.
- Requires local candle JSON inputs.
- Does not fetch live/cached candles by symbol.
- Does not batch multiple symbols by itself.
- Does not package manifests or checksums yet.
- Does not write a production job summary.
- `15m` remains reserved in the snapshot schema but is not a hardened runner input yet.
- Large production artifacts should be kept out of git unless explicitly requested.

## Operational Safety Rules

- Always supply explicit `--as-of`.
- Use closed candle data.
- Treat missing optional timeframes as data limitations.
- Preserve raw outputs for auditability.
- Do not edit generated JSON by hand for production use.
- Do not use runner output as trade advice.
- Do not wire this runner into alerts, monitoring, Discord, or journal scoring in this gate.
- Keep secrets and provider credentials out of runner inputs and outputs.

## Recommended Next Gate

Recommended next gate if staying in `levels-system`:

```text
production_snapshot_runner_smoke_tests
```

Reason: the runner now has package aliases and documented output conventions. A smoke-test gate can generate a small set of production-style artifacts into a temporary or ignored path and verify artifact naming, schema, and safety without adding journal behavior.

Recommended next gate if moving to the consuming app:

```text
downstream_journal_integration_start
```

Reason: `LevelAnalysisSnapshot` v1 is locked, handed off, documented, fixture-backed, and now has packaged runner commands. The journal/intelligence app can begin adapter implementation against the compact fixture and runner outputs.
