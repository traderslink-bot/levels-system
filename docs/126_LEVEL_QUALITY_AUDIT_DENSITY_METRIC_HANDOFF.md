# Level Quality Audit Density Metric Handoff

## Purpose

This handoff summarizes the audit-only density metric path so future sessions know what the metric does, where it is wired, what is locked, and what remains deferred.

This is a handoff documentation gate. It does not tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Current Density Metric Status

The density metric path is complete through handoff:

- density metric design/helper exists.
- density metric contract and fixtures exist.
- `densityMetric` is wired additively into `LevelQualityAuditReport`.
- `npm run review:level-quality` includes compact density metric output.
- the packaged 10-symbol real-cache rerun proved the metric is present and contract-valid.
- semantics review decided to keep density-specific semantics inside `densityMetric.diagnostics`.
- density metric baseline lock records the current 10-symbol values.

No report-level density diagnostics were added.
No density semantics were promoted to report-level `diagnosticSemantics`.

## What The Metric Measures

`LevelQualityDensityMetric` is audit-only map-shape context. It measures:

- rows inside the configured audit window around reference price;
- `sparse`, `balanced`, `dense_separated`, or `dense_clustered` classification;
- side bias: `none`, `support_heavy`, `resistance_heavy`, or `mixed`;
- support and resistance row counts;
- historical, extension, and synthetic row counts;
- LevelQualityAudit bucket counts;
- clustered, dense-but-separated, extension-heavy, and synthetic-present flags;
- density-specific diagnostics inside `densityMetric.diagnostics`;
- safety flags proving generation, ranking, clustering, surfaced levels, and extension generation are unchanged.

The metric does not create, remove, rank, cluster, surface, or score levels.

## Where It Is Wired

Core module:

```text
src/lib/levels/level-quality-density-metric.ts
```

Audit report wiring:

```text
src/lib/levels/level-quality-audit-runner.ts
```

`LevelQualityAuditReport` includes:

```text
densityMetric?: LevelQualityDensityMetric
```

Review output:

```text
src/scripts/run-level-quality-review.ts
```

The packaged review command includes compact density metric output and `densityMetricPresentCount`.

## Locked 10-Symbol Baseline

Reviewed symbols:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`
- `AIM`
- `HCWB`
- `YMAT`
- `AAOI`
- `PHOE`

Supplied 15m symbols:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

15m remains context-only and outside LevelEngine/support-resistance generation.

Locked baseline:

- densityMetric present: `10/10`
- contract-valid: `10/10`
- factual-only: `10/10`
- prohibited-language hits: `0`
- report-level density diagnostics added: `false`
- density semantics promoted to report-level `diagnosticSemantics`: `false`

## Classification Summary

Classification counts:

- `dense_clustered`: `5`
- `balanced`: `4`
- `sparse`: `1`
- `dense_separated`: `0`

Per-symbol classifications:

- `dense_clustered`: `DEVS`, `ENVX`, `GME`, `AIM`, `YMAT`
- `balanced`: `DXYZ`, `QUBT`, `AAOI`, `PHOE`
- `sparse`: `HCWB`
- `dense_separated`: none

## Side-Bias Summary

Side-bias counts:

- `mixed`: `6`
- `support_heavy`: `3`
- `resistance_heavy`: `1`
- `none`: `0`

Additional flags:

- `extensionHeavy`: `GME`, `YMAT`
- `syntheticPresent`: none

## Semantics Decision

Decision:

```text
keep_density_semantics_inside_densityMetric
```

Density-specific diagnostics remain inside `densityMetric.diagnostics`.

Deferred report-level promotion areas:

- `dense_clustered_level_map`
- `dense_separated_level_map`
- `support_heavy_density`
- `resistance_heavy_density`
- `extension_heavy_level_map`
- `synthetic_level_context_present`

Do not promote any of these into report-level `LevelQualityAuditReport.diagnostics` or `diagnosticSemantics` without a separate approved gate.

## What Is Intentionally Not Promoted

The following remain intentionally not promoted:

- no report-level `dense_clustered_level_map`;
- no report-level `dense_separated_level_map`;
- no report-level side-bias diagnostics;
- no report-level `extension_heavy_level_map`;
- no report-level `synthetic_level_context_present`;
- no density-specific `diagnosticSemantics` outside the density metric payload.

Reason: the locked rerun had no `dense_separated` cases, `dense_clustered` overlaps existing clustered-area diagnostics, and side-bias/extension-heavy semantics need more evidence before top-level promotion.

## Future Change Rules

Future density changes must compare:

- densityMetric presence;
- contract validation;
- classification counts;
- per-symbol classifications;
- side-bias counts;
- extension-heavy flags;
- synthetic-present flags;
- `densityMetric.diagnostics`;
- report-level diagnostics;
- report-level `diagnosticSemantics`;
- nearest support and resistance;
- bucket counts;
- extension counts;
- synthetic continuation-map count and markings;
- 15m context-only status;
- prohibited-language hits.

Future density semantics promotion must use a separate approved gate, include deterministic fixtures, add factual wording catalog entries before report-level semantics, and prove LevelEngine behavior remains unchanged.

## Artifact Map

Primary docs:

- `docs/120_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_DESIGN.md`
- `docs/121_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_CONTRACT.md`
- `docs/122_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_REPORT_WIRING.md`
- `docs/123_LEVEL_QUALITY_REVIEW_RERUN_AFTER_DENSITY_METRIC_WIRING.md`
- `docs/124_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_SEMANTICS_REVIEW.md`
- `docs/125_LEVEL_QUALITY_DENSITY_METRIC_BASELINE_LOCK.md`
- `docs/126_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_HANDOFF.md`

Primary artifacts:

- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-design.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-contract.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-report-wiring.json`
- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-semantics-review.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-baseline-lock.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-handoff.json`

## Recommended Next Gate

Recommended next gate:

```text
level_quality_nearest_gap_investigation
```

Reason: the audit-only density metric path is now designed, wired, verified, baseline-locked, and handed off. The next backlog item is nearest gap investigation, which should remain investigation-only before any generation behavior tuning.
