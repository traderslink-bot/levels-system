# Production Snapshot Runner Smoke Tests

## Purpose

This document defines the production-style smoke-test gate for the packaged `LevelAnalysisSnapshot` runner.

The smoke-test goal is to prove the packaged runner can generate a representative v1 artifact into an ignored production-shaped output path, then validate naming, schema identity, required sections, safety flags, and factual-language boundaries before downstream journal integration begins.

This gate does not change support/resistance detection, LevelEngine output behavior, runtime mode defaults, alert behavior, monitoring behavior, Discord behavior, trader-context behavior, synthetic extension behavior, journal grading, coaching, P/L, giveback analysis, behavior scoring, journal UI behavior, or recommendation behavior.

## What Is Being Smoke-Tested

The smoke test covers:

- package-script access to the runner
- local candle fixture loading
- deterministic snapshot generation
- production-style artifact path writing
- JSON parseability
- v1 schema identity
- required handoff sections
- no-lookahead and facts-only safety flags
- cleanup behavior for temporary test output
- factual output boundaries

The smoke test intentionally does not validate live data fetching, batch orchestration, manifests, checksums, downstream journal adapter code, or trade interpretation.

## Smoke-Test Input Fixtures

The smoke path uses the deterministic sample fixtures:

```text
docs/examples/level-analysis-snapshot/sample-5m-candles.json
docs/examples/level-analysis-snapshot/sample-15m-candles.json
docs/examples/level-analysis-snapshot/sample-4h-candles.json
docs/examples/level-analysis-snapshot/sample-daily-candles.json
```

Smoke input identity:

```text
symbol: SNAP
asOfTimestamp: 1777645200000
as-of ISO: 2026-05-01T10:20:00-04:00
referencePrice: 10.68
previousClose: 9.1
```

The fixtures are committed review fixtures, not live data.

## Output Path Convention

The production-style convention remains:

```text
artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

The local smoke package script writes to an ignored smoke-specific path:

```text
artifacts/level-analysis-snapshot-smoke/SNAP/1777645200000/level-analysis-snapshot-v1.json
```

`artifacts/` is ignored by git. Smoke outputs should not be committed.

The automated test writes to an operating-system temp directory using the same nested shape:

```text
<temp>/level-analysis-snapshot-smoke/SNAP/1777645200000/level-analysis-snapshot-v1.json
```

The test removes that temp output after validation.

## Commands Run

Focused smoke test:

```powershell
npx tsx --test --test-timeout=90000 src/tests/level-analysis-snapshot-runner-smoke.test.ts
```

Local ignored smoke artifact:

```powershell
npm run snapshot:level-analysis:smoke
```

Full validation:

```powershell
npx tsc --noEmit
npm test
```

The smoke test invokes the packaged generic runner command with explicit arguments:

```powershell
npm run snapshot:level-analysis -- --symbol SNAP --as-of 2026-05-01T10:20:00-04:00 --reference-price 10.68 --candles-5m docs/examples/level-analysis-snapshot/sample-5m-candles.json --candles-15m docs/examples/level-analysis-snapshot/sample-15m-candles.json --candles-4h docs/examples/level-analysis-snapshot/sample-4h-candles.json --candles-daily docs/examples/level-analysis-snapshot/sample-daily-candles.json --previous-close 9.1 --out <temp>/level-analysis-snapshot-smoke/SNAP/1777645200000/level-analysis-snapshot-v1.json
```

## Expected Artifact Fields

Smoke output must include:

- `schemaVersion: level-analysis-snapshot/v1`
- `producer: levels-system`
- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `inputSummary`
- `levelEngineOutput`
- `levelIntelligenceReport`
- `levelQualityAudit`
- `diagnostics`
- `safety`

The smoke test also verifies that `symbol`, `asOfTimestamp`, and `referencePrice` match the smoke input.

The smoke input includes optional `15m` candles. The expected output counts and filters them in `inputSummary`, while diagnostics mark `15m` as reserved for future fact generation. The `15m` fixture is not used for LevelEngine level generation.

## Schema And Safety Checks

Smoke output must satisfy:

- `schemaVersion` starts with `level-analysis-snapshot/v1`
- `producer` equals `levels-system`
- `safety.noLookaheadApplied` is true
- `safety.levelOutputUnchanged` is true
- `safety.factsOnlyVWAP` is true
- `safety.shelvesAreFactsOnly` is true
- `safety.syntheticExtensionsClearlyMarked` is true
- `safety.noRuntimeBehaviorChange` is true

The generated text fields must not contain downstream-owned journal behavior language such as recommendation, coaching, grading, P/L, giveback, behavior scoring, entry decision, exit decision, or trade advice.

## Failure Modes

Treat any of these as smoke-test failures:

- package script is missing
- runner command exits non-zero
- output file is missing
- output is not valid JSON
- schema identity is wrong
- required sections are missing
- safety flags are missing or false
- output path cannot be cleaned up
- generated text contains prohibited downstream behavior language

If a failure appears in LevelEngine output itself, stop and investigate before tuning behavior. This gate is not intended to change support/resistance detection.

## Limitations

The smoke test is intentionally narrow:

- one deterministic sample symbol
- local committed candle fixtures only
- JSON output only
- no live cache lookup
- no network calls
- no batch manifest or checksum
- no downstream adapter execution
- no journal interpretation

Broader production operations may still need manifest/checksum support if the runner is used for batches.

## Operational Recommendation

The runner is operationally usable for single-symbol deterministic artifact generation when the caller supplies local candle JSON, explicit `--as-of`, reference price, and an output path.

Recommended production practice:

1. Write artifacts under a symbol/as-of directory.
2. Preserve raw runner output unchanged.
3. Validate `schemaVersion`, `producer`, and safety flags before downstream use.
4. Keep generated artifacts out of git unless they are small review fixtures.
5. Use the compact connector fixture for journal adapter tests.

## Recommended Next Gate

Recommended next gate:

```text
downstream_journal_integration_start
```

Reason: the v1 contract is locked, handed off, fixture-backed, runner-packaged, and smoke-tested through a production-shaped artifact path. The next highest-value work is for TraderLink Intelligence / the journal app to implement its downstream adapter against the compact fixture and runner outputs.

If one more levels-system operational gate is desired before app-side integration, the next option is:

```text
production_snapshot_runner_batch_manifest
```

Reason: batch manifests and checksums are useful only if the runner will generate multi-symbol artifact sets inside `levels-system` before the journal app consumes them.
