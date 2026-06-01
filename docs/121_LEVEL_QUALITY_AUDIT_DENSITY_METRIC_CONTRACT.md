# Level Quality Audit Density Metric Contract

## Purpose

This gate adds the additive audit-only contract and fixtures for `LevelQualityDensityMetric`. It locks the metric payload shape before any future wiring into `LevelQualityAuditReport`.

This does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Contract Shape

Contract module:

```text
src/lib/levels/level-quality-density-metric.ts
```

The metric contract is:

- `schemaVersion`: `level-quality-density-metric/v1`
- `classification`: `sparse`, `balanced`, `dense_separated`, or `dense_clustered`
- `sideBias`: `none`, `support_heavy`, `resistance_heavy`, or `mixed`
- `auditWindowPct`
- optional `referencePrice`
- `totalRows`
- `rowsInsideAuditWindow`
- `counts`: support, resistance, historical, extension, synthetic
- `bucketCounts`: LevelQualityAudit bucket counts
- `densityBuckets`: historical, extension, synthetic
- `flags`: clustered areas, dense-but-separated, extension-heavy, synthetic-present
- `thresholds`: the thresholds used to classify the metric
- `diagnostics`: density diagnostic strings
- `safety`: audit-only flags proving behavior paths are unchanged

Validation helpers added:

- `isLevelQualityDensityMetric(value)`
- `validateLevelQualityDensityMetric(value)`
- `assertLevelQualityDensityMetricFactsOnly(value)`

## Classification Rules

The contract preserves the design-gate classifications:

| Classification | Rule |
| --- | --- |
| `sparse` | Rows inside the audit window are below `sparseBelowCount`. |
| `balanced` | Rows inside the audit window are at least `sparseBelowCount` and below `denseAtOrAboveCount`. |
| `dense_separated` | Rows inside the audit window meet `denseAtOrAboveCount` and no clustered area is present. |
| `dense_clustered` | Rows inside the audit window meet `denseAtOrAboveCount` and a clustered area is present. |

The default thresholds remain:

- `auditWindowPct`: `30`
- `sparseBelowCount`: `6`
- `denseAtOrAboveCount`: `10`
- `sideHeavyShare`: `0.65`
- `extensionHeavyShare`: `0.35`

These are contract thresholds for audit fixtures and helpers. They are not LevelEngine behavior defaults.

## Side-Bias Rules

`sideBias` is computed from support and resistance rows inside the audit window:

- `none`: no support or resistance rows are inside the audit window.
- `support_heavy`: support share reaches `sideHeavyShare`.
- `resistance_heavy`: resistance share reaches `sideHeavyShare`.
- `mixed`: neither side reaches `sideHeavyShare`.

Side bias is factual density context only. It is not directional interpretation.

## Row Bucket Rules

The density metric separates rows into:

- `historical`
- `extension`
- `synthetic`

Synthetic continuation-map rows are counted separately from historical rows and non-synthetic extension rows. Synthetic rows remain marked forward-planning context, not historical support/resistance evidence.

## Safety Flags

Every valid metric must carry:

- `auditOnly: true`
- `generatedLevelsUnchanged: true`
- `rankingUnchanged: true`
- `clusteringUnchanged: true`
- `surfacedLevelsUnchanged: true`
- `extensionGenerationUnchanged: true`

The validator rejects metrics with missing or false safety flags.

## Fixture List

Fixtures live under:

```text
docs/examples/level-analysis-snapshot/level-quality-density-metric/contract-fixtures/
```

Fixture set:

- `density-metric-sparse.json`
- `density-metric-balanced.json`
- `density-metric-dense-separated.json`
- `density-metric-dense-clustered.json`
- `density-metric-support-heavy.json`
- `density-metric-resistance-heavy.json`
- `density-metric-extension-heavy.json`
- `density-metric-synthetic-present.json`

Each fixture includes:

- fixture schema version
- fixture name
- input summary
- generated metric
- expected classification
- expected side bias
- expected bucket counts
- safety flags through the metric payload
- factual-only status

Fixtures do not include raw snapshots, raw cache files, provider responses, credentials, or full candle arrays.

## Validation Rules

`validateLevelQualityDensityMetric(value)` checks:

- schema version
- known classification and side bias
- non-negative finite numeric fields
- required count records
- required bucket records
- required flags
- safety flags are true
- diagnostics are strings
- support plus resistance count equals rows inside the audit window
- historical plus extension plus synthetic count equals rows inside the audit window
- density bucket counts match the corresponding count fields
- synthetic, dense-separated, and extension-heavy flags match the metric values
- diagnostics include the metric classification and side-bias codes

`assertLevelQualityDensityMetricFactsOnly(value)` also rejects prohibited interpretive wording.

## Audit-Only Boundary

This contract is audit-only:

- no support/resistance generation changes
- no LevelEngine scoring, ranking, clustering, or bucket-assignment changes
- no surfaced level changes
- no extension generation changes
- no nearest-level changes
- no 15m LevelEngine input
- no cache collection or writes
- no provider calls
- no alert, monitoring, Discord, or journal imports

## Compatibility With Existing Diagnostics

The existing `clustered_level_areas_present` diagnostic remains the cluster-area signal.

The density metric uses cluster status as input:

- dense rows plus clustered areas -> `dense_clustered`
- dense rows without clustered areas -> `dense_separated`

No existing diagnostic codes are removed or renamed in this gate.

## Intentionally Not Wired Yet

This gate does not wire density metrics into:

- `LevelQualityAuditReport`
- `diagnosticSemantics`
- the packaged review command output
- LevelEngine runtime output
- alerting, monitoring, Discord, or journal flows

The next gate may add additive report wiring after these fixtures prove the contract shape.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_audit_density_metric_report_wiring
```

Reason: after the contract is fixture-backed, the next safe step is additive wiring into `LevelQualityAuditReport` without changing LevelEngine generation behavior.
