# Production Snapshot Runner Batch Manifest

## Purpose

This document defines the production-style batch manifest contract for
`LevelAnalysisSnapshot` runner outputs.

The manifest lets multi-symbol snapshot runs be audited, validated, and handed
to downstream systems without changing snapshot generation, LevelEngine output,
alerts, monitoring, Discord behavior, runtime defaults, or journal behavior.

## Why Batch Manifests Are Needed

Single snapshot artifacts are useful by themselves, but production and replay
batches need a compact audit surface that answers:

- which symbols were attempted;
- where each snapshot artifact was written;
- whether each artifact parsed and passed contract checks;
- which timeframe inputs were present;
- whether 15m input was missing, supplied, or still reserved;
- whether no-lookahead and synthetic-labeling safety flags were preserved;
- which diagnostics and validation errors appeared across the batch.

The manifest is not a replacement for raw snapshot preservation. It is a factual
index for generated artifacts.

## Manifest Schema

Manifest schema version:

```text
level-analysis-snapshot-batch-manifest/v1
```

Producer:

```text
levels-system
```

Top-level fields:

- `schemaVersion`
- `producer`
- `batchId`
- `generatedAt`
- `outputRoot`
- `runConfig`
- `entries`
- `summary`
- `diagnostics`
- `safety`

## Per-Symbol Artifact Schema

Each `entries[]` item records:

- `symbol`
- `asOfTimestamp`
- `referencePrice`
- `artifactPath`
- `artifactExists`
- `fileSizeBytes`
- `checksumSha256`
- `snapshotSchemaVersion`
- `snapshotProducer`
- `status`
- `validationErrors`
- `diagnostics`
- `timeframeCoverage`
- `has15mInput`
- `missing15mInput`
- `noLookaheadApplied`
- `syntheticExtensionsClearlyMarked`
- `safety`

Supported statuses:

- `accepted`
- `failed`
- `skipped`
- `quarantined`

Accepted entries represent parseable v1 snapshots with valid producer identity
and required safety flags. Quarantined entries preserve factual error reasons
without treating the artifact as downstream-ready.

## Batch Identity Fields

`batchId` should be stable for a replay or production run. Good examples:

- `level-analysis-snapshot-review-batch`
- `real-cache-2026-06-01-open`
- `daily-journal-snapshot-2026-06-01`

`generatedAt` is an ISO timestamp for manifest creation time. It is separate
from each snapshot `asOfTimestamp`.

## Output Path Conventions

Recommended production snapshot artifact path:

```text
artifacts/level-analysis-snapshot/<symbol>/<asOfTimestamp>/level-analysis-snapshot-v1.json
```

Recommended manifest path:

```text
artifacts/level-analysis-snapshot/<batchId>/level-analysis-snapshot-batch-manifest-v1.json
```

Committed deterministic review manifest:

```text
docs/examples/level-analysis-snapshot/batch-manifest/latest-level-analysis-snapshot-batch-manifest.json
```

## Validation Status Fields

Manifest validation checks:

- manifest schema version;
- producer;
- batch id;
- generated timestamp;
- entries array;
- per-entry artifact path;
- per-entry status;
- per-entry timeframe coverage keys.

Entry validation checks:

- snapshot schema starts with `level-analysis-snapshot/v1`;
- snapshot producer equals `levels-system`;
- symbol and as-of timestamp exist;
- safety flags confirm no-lookahead and synthetic labeling;
- validation errors are recorded when an accepted entry fails checks.

An accepted entry with validation errors becomes `quarantined`.

## Timeframe Coverage Fields

Each entry records `timeframeCoverage` for the locked keys:

- `5m`
- `15m`
- `4h`
- `daily`

For each timeframe:

- `provided`
- `candleCount`
- `filteredCandleCount`
- `excludedFutureCandleCount`
- `excludedPartialCandleCount`

The manifest summary also records how many entries had positive filtered count
for each timeframe.

## Missing 15m Tracking

Each entry records:

- `has15mInput`
- `missing15mInput`

Current behavior:

- 15m may be supplied to the runner.
- 15m is counted and filtered in `inputSummary`.
- 15m remains reserved for future fact generation.
- 15m is not used for LevelEngine support/resistance generation.

The batch summary records:

- `with15mInputCount`
- `missing15mInputCount`

This makes the missing local real-cache 15m gap visible without inventing data.

## Safety Flag Summary

Each entry carries snapshot safety flags. The manifest summary and safety block
highlight:

- accepted entries with `noLookaheadApplied`;
- accepted entries with `syntheticExtensionsClearlyMarked`;
- `noRuntimeBehaviorChange: true`.

If accepted entries are not no-lookahead safe, the manifest should not be used
for replay or downstream journal handoff.

## Diagnostics Summary

The manifest summary includes:

- `uniqueDiagnostics`
- `uniqueValidationErrors`

Diagnostics are factual operational context only. They are not trade
instructions, scoring inputs, coaching, or recommendations.

## Checksum Strategy

When artifact content is supplied, the manifest records:

```text
checksumSha256
```

The checksum is computed over the exact artifact text content. This supports
auditability and downstream preservation checks without embedding raw snapshots
inside the manifest.

## Batch Manifest Script

The script is:

```text
src/scripts/run-level-analysis-snapshot-batch-manifest.ts
```

It accepts:

- `--input <path>`: snapshot artifact path, JSON list file, or directory
- `--out <path>`: manifest output path
- `--output-root <path>`
- `--batch-id <id>`
- `--generated-at <ISO>`

If `--input` is a directory, the script scans recursively for files named:

```text
level-analysis-snapshot-v1.json
```

If `--input` is a JSON file containing an array or `{ "artifacts": [...] }`, the
listed paths are used. Otherwise the input file itself is treated as one snapshot
artifact.

Package commands:

```powershell
npm run manifest:level-analysis:snapshots -- --input artifacts/level-analysis-snapshot --out artifacts/level-analysis-snapshot/<batchId>/level-analysis-snapshot-batch-manifest-v1.json --output-root artifacts/level-analysis-snapshot --batch-id <batchId>
npm run manifest:level-analysis:snapshots:review
```

## Real-Cache Batch Packaging Script

The packaged local-cache batch runner is:

```text
src/scripts/run-level-analysis-snapshot-real-cache-batch.ts
```

Package command:

```powershell
npm run snapshot:level-analysis:batch:real-cache -- --cache-root .validation-cache/candles --provider ibkr --symbols DEVS,ENVX,DXYZ,QUBT,GME --out-root artifacts/level-analysis-snapshot-real-cache-batch --batch-id real-cache-batch-2026-06-01 --generated-at 2026-06-01T00:00:00.000Z
```

The script:

- reads existing local validation-cache candle files only;
- requires `5m`, `4h`, and `daily` cache for every selected symbol;
- includes `15m` cache when present;
- writes full snapshot artifacts under `<out-root>/<batch-id>/<symbol>/<asOfTimestamp>/`;
- writes `level-analysis-snapshot-batch-manifest-v1.json` under `<out-root>/<batch-id>/`;
- prints a compact factual summary;
- does not fetch data, post alerts, change monitoring, or change LevelEngine
  output behavior.

## Downstream Consumption

Downstream systems should:

1. validate manifest `schemaVersion` and `producer`;
2. inspect `summary` and `safety`;
3. load only `accepted` entries;
4. quarantine `failed`, `skipped`, and `quarantined` entries;
5. use `artifactPath` to load and preserve raw snapshots separately;
6. use `checksumSha256` and `fileSizeBytes` for artifact integrity checks;
7. treat diagnostics and quality fields as factual context only.

The manifest does not expose trade grades, coaching, P/L, giveback, behavior
scores, recommendations, or trade advice.

## Limitations

- JSON manifest only.
- Local file scanning only.
- The script does not generate snapshots; it indexes already-generated
  artifacts.
- Directory scanning intentionally targets `level-analysis-snapshot-v1.json`
  files only.
- The manifest stores metadata and checksums, not raw snapshot payloads.
- This gate does not add live data fetching, scheduling, monitoring, Discord,
  alerting, or journal behavior.

## Recommended Next Gate

Recommended next gate:

```text
production_snapshot_runner_batch_manifest_packaging
```

Reason: the manifest contract and real-cache dry run are now defined. The next
operational step should package the cache-to-snapshot-to-manifest workflow into
a repeatable operator path.
