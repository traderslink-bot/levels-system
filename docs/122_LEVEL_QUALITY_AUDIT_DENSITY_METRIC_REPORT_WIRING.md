# Level Quality Audit Density Metric Report Wiring

## Purpose

This gate wires the audit-only `LevelQualityDensityMetric` into `LevelQualityAuditReport` as an additive field. The goal is to expose dense-but-separated and dense-clustered map context in audit output without changing generated support/resistance levels.

This does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Additive Report Field

`LevelQualityAuditReport` now includes:

```text
densityMetric?: LevelQualityDensityMetric
```

The field is computed from the same `LevelQualityAuditItem[]` already used by `LevelQualityAuditReport`. It uses:

- audited level rows;
- the report reference price;
- existing diagnostics;
- existing clustered-area count.

The metric remains audit-only and carries safety flags:

- `auditOnly`
- `generatedLevelsUnchanged`
- `rankingUnchanged`
- `clusteringUnchanged`
- `surfacedLevelsUnchanged`
- `extensionGenerationUnchanged`

## Diagnostics And Semantics

This gate intentionally does not add new `LevelQualityAuditReport.diagnostics` codes.

Existing diagnostics and `diagnosticSemantics` remain compatibility-stable. Density-specific codes produced inside `densityMetric.diagnostics`, such as `density_classification:dense_separated`, remain inside the density metric payload only.

Reason: the contract is newly wired into the report. Keeping report-level diagnostics unchanged lets the next real-cache review prove the additive field appears without disturbing the locked baseline diagnostic comparisons.

## Review Process Output

The packaged review command now includes compact density metric output:

```text
npm run review:level-quality
```

The compact review entry includes `qualityAudit.densityMetric` with:

- `present`
- `classification`
- `sideBias`
- `totalRows`
- `rowsInsideAuditWindow`
- `counts`
- `densityBuckets`
- `flags`
- `diagnostics`
- `safety`

The review summary also includes:

```text
densityMetricPresentCount
```

Text output includes density metric presence and per-symbol density classification. Existing parity fields remain unchanged.

## Fixture And Test Coverage

Focused test:

```text
src/tests/level-quality-density-metric-report-wiring.test.ts
```

Coverage includes:

- additive `densityMetric` field on audit reports;
- unchanged report-level diagnostics and diagnostic semantics;
- sparse, dense-separated, dense-clustered, side-heavy, extension-heavy, and synthetic-present cases;
- immutable LevelEngine output input;
- unchanged surfaced and extension level arrays;
- compact packaged review output;
- prohibited-language guard;
- source isolation from provider writes, alert, monitoring, Discord, and journal paths.

Existing focused tests also remain relevant:

- `src/tests/level-quality-density-metric-contract.test.ts`
- `src/tests/level-quality-audit-runner.test.ts`
- `src/tests/level-quality-review-process-packaging.test.ts`

## Compatibility Behavior

The report addition is additive:

- no existing fields are removed or renamed;
- no existing diagnostics are removed or renamed;
- `diagnosticSemantics` still maps existing report diagnostics;
- the density metric is deterministic from existing audit rows;
- snapshots remain replay-stable because the metric uses already-filtered audit data.

## Audit-Only Boundary

This gate does not:

- change support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or bucket assignment;
- change surfaced support/resistance levels;
- change extension generation;
- feed 15m into LevelEngine;
- collect or write cache files;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_rerun_after_density_metric_wiring
```

Reason: after adding `densityMetric` to audit output, rerun the packaged 10-symbol review to confirm the new field appears and all existing baseline fields remain stable.
