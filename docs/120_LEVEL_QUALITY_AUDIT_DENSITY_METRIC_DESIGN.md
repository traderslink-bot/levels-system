# Level Quality Audit Density Metric Design

## Purpose

This gate designs an audit-only density metric for dense-but-separated level maps. The goal is to describe map density more precisely before any clustering, ranking, surfaced-level, or extension-generation behavior tuning.

This gate adds a lightweight pure helper contract, but does not wire density metrics into `LevelQualityAuditReport` yet. It does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Source

Primary evidence:

- `docs/113_LEVEL_ENGINE_CLUSTER_DENSITY_TUNING_PLAN_OR_FIXTURE_PACK.md`
- `docs/114_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_FIXTURE_PACKS.md`
- `docs/118_LEVEL_ENGINE_BEHAVIOR_TUNING_BACKLOG.md`
- `docs/119_LEVEL_QUALITY_REVIEW_PROCESS_PACKAGING.md`
- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json`

The locked 10-symbol review preserved:

- clustered areas on `DEVS`, `ENVX`, `DXYZ`, `GME`, `AIM`, `HCWB`, and `YMAT`;
- dense-but-separated review cases on `QUBT`, `AAOI`, and `PHOE`;
- no behavior bug;
- LevelEngine parity for nearest levels, bucket counts, extension counts, synthetic marking, diagnostics, diagnostic semantics, and enrichment breakdown.

## Current Problem

The existing audit diagnostic `clustered_level_areas_present` correctly identifies levels inside the configured cluster threshold. It does not describe maps with many separated levels inside the audit range.

That means two factual states need separate vocabulary:

- true clustered areas, where levels sit inside a proximity threshold;
- dense-but-separated maps, where many levels exist in the audit range but do not trip the cluster threshold.

The distinction matters because clustered areas may imply near-duplicate review, while dense-but-separated maps may simply reflect broad map detail.

## Proposed Metric

Added helper:

```text
src/lib/levels/level-quality-density-metric.ts
```

Focused tests:

```text
src/tests/level-quality-density-metric-design.test.ts
```

The helper exports:

- `LevelQualityDensityMetric`
- `LevelQualityDensityBucket`
- `LevelQualityDensityClassification`
- `LevelQualityDensitySideBias`
- `LevelQualityDensityRow`
- `LevelQualityDensityMetricInput`
- `LevelQualityDensityMetricThresholds`
- `classifyLevelMapDensity(input)`
- `describeLevelQualityDensityMetric(metric)`

The helper analyzes supplied audit rows only. It does not call providers, read cache files, run LevelEngine, alter outputs, or mutate inputs.

## Proposed Classifications

Map-level classifications:

| Classification | Meaning |
| --- | --- |
| `sparse` | Fewer rows than the sparse threshold inside the audit window. |
| `balanced` | Row count is inside the proposed normal range. |
| `dense_separated` | Row count reaches the dense threshold, but no cluster diagnostic or clustered area is present. |
| `dense_clustered` | Row count reaches the dense threshold and clustered areas are present. |

Side density:

| Side bias | Meaning |
| --- | --- |
| `none` | No rows inside the audit window. |
| `support_heavy` | Support rows reach the side-heavy share threshold. |
| `resistance_heavy` | Resistance rows reach the side-heavy share threshold. |
| `mixed` | Neither side reaches the side-heavy share threshold. |

Row buckets:

- `historical`
- `extension`
- `synthetic`

Synthetic rows are counted separately from historical and non-synthetic extension rows.

## Proposed Thresholds

The helper includes proposed defaults for fixture and contract work:

| Threshold | Default | Purpose |
| --- | ---: | --- |
| `auditWindowPct` | `30` | Count rows within 30 percent of reference price. |
| `sparseBelowCount` | `6` | Classify maps below this row count as sparse. |
| `denseAtOrAboveCount` | `10` | Classify maps at or above this row count as dense. |
| `sideHeavyShare` | `0.65` | Mark support-heavy or resistance-heavy density. |
| `extensionHeavyShare` | `0.35` | Mark extension-heavy maps. |

These thresholds are contract defaults for the helper. They are not behavior-changing LevelEngine defaults and are not yet wired into audit output.

## Audit-Only Boundary

The density metric is audit-only:

- no support/resistance generation changes;
- no LevelEngine scoring, ranking, clustering, or bucket-assignment changes;
- no surfaced level changes;
- no extension generation changes;
- no nearest-level changes;
- no 15m LevelEngine input;
- no cache collection or writes;
- no alert, monitoring, Discord, or journal imports.

The helper returns safety flags that explicitly mark generation, ranking, clustering, surfaced levels, and extension generation as unchanged.

## Interaction With Existing Cluster Diagnostics

`clustered_level_areas_present` remains the existing factual cluster diagnostic.

The new helper treats cluster status as one input to density classification:

- dense rows plus clustered areas -> `dense_clustered`;
- dense rows without clustered areas -> `dense_separated`;
- lower row counts -> `sparse` or `balanced`.

This preserves existing cluster semantics while giving dense-but-separated maps their own audit vocabulary.

## Interaction With Diagnostic Semantics

This gate does not add new `LevelQualityAuditReport.diagnostics` codes yet.

Future contract work may add additive semantics such as:

- `dense_separated_level_map`
- `support_heavy_density`
- `resistance_heavy_density`
- `extension_heavy_level_map`

Those should be factual `density` or `context` diagnostics only. They must not imply grading, coaching, recommendations, or instructions.

## Risks

Risks if this metric is later wired into audit output:

- thresholds could overstate density on low-priced symbols;
- support-heavy or resistance-heavy labels could be misread as directional interpretation;
- extension-heavy summaries could be confused with a generation problem;
- dense-but-separated maps could be mistaken for near-duplicate clusters.

Mitigation:

- keep labels factual;
- report counts and thresholds with the classification;
- keep synthetic rows separate;
- avoid behavior changes unless a later gate proves a deterministic need.

## Implementation Options

This gate chose the lightweight helper contract because it is deterministic and safe:

1. Design-only docs.
2. Pure helper and type contract. This gate used this option.
3. Additive audit output wiring. Deferred to a future gate.
4. Behavior tuning. Explicitly deferred by the locked baseline.

## Tests Added

Focused tests cover:

- sparse map classification;
- dense-separated classification;
- dense-clustered classification;
- support-heavy and resistance-heavy side density;
- extension and synthetic row separation;
- audit-window filtering;
- input immutability;
- factual descriptions and prohibited-language guard;
- source isolation from LevelEngine behavior, provider, alert, monitoring, Discord, and journal paths.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_audit_density_metric_contract
```

Reason: after the design helper, add an additive audit-only contract and fixtures before wiring density metrics into `LevelQualityAuditReport`.
