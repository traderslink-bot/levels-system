# Level Quality Density Metric Baseline Lock

## Purpose

This gate locks the current audit-only density metric reporting baseline now that `densityMetric` is present in real-cache review output and density semantic promotion has been deferred.

This is a baseline-lock documentation gate. It does not tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Chain Being Locked

The density metric path is now locked across these sources:

- `docs/120_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_DESIGN.md`
- `docs/121_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_CONTRACT.md`
- `docs/122_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_REPORT_WIRING.md`
- `docs/123_LEVEL_QUALITY_REVIEW_RERUN_AFTER_DENSITY_METRIC_WIRING.md`
- `docs/124_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_SEMANTICS_REVIEW.md`
- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json`
- `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-semantics-review.json`

Relevant code modules:

- `src/lib/levels/level-quality-density-metric.ts`
- `src/lib/levels/level-quality-audit-runner.ts`
- `src/scripts/run-level-quality-review.ts`

## Current Density Metric Status

Current status:

- `LevelQualityDensityMetric` design and helper exist.
- Contract fixtures and validation helpers exist.
- `densityMetric` is wired additively into `LevelQualityAuditReport`.
- `npm run review:level-quality` includes compact density metric output.
- the packaged 10-symbol real-cache rerun proved the metric is present and contract-valid.
- density-specific semantics remain inside `densityMetric.diagnostics`.
- no report-level density diagnostics were added.
- no density semantics were promoted to report-level `diagnosticSemantics`.

## Reviewed Symbols

Locked real-cache review symbols:

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

## Locked Density Baseline

The locked 10-symbol density baseline is:

- densityMetric present: `10/10`
- contract-valid: `10/10`
- factual-only: `10/10`
- prohibited-language hits: `0`
- report-level density diagnostics added: `false`
- density semantics promoted to report-level `diagnosticSemantics`: `false`

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

Side-bias counts:

- `mixed`: `6`
- `support_heavy`: `3`
- `resistance_heavy`: `1`
- `none`: `0`

Additional flags:

- `extensionHeavy`: `GME`, `YMAT`
- `syntheticPresent`: none

## Semantics Decision

The semantics decision is locked as:

```text
keep_density_semantics_inside_densityMetric
```

Density-specific diagnostics remain inside `densityMetric.diagnostics`.

Deferred promotion areas:

- `dense_clustered_level_map`
- `dense_separated_level_map`
- `support_heavy_density`
- `resistance_heavy_density`
- `extension_heavy_level_map`
- `synthetic_level_context_present`

No density diagnostic should be promoted to report-level `LevelQualityAuditReport.diagnostics` or `diagnosticSemantics` without a separate approved gate.

## Baseline Comparison Requirements For Future Density Changes

Any future density metric change must compare against this locked baseline:

- densityMetric presence
- densityMetric contract validation
- classification counts
- per-symbol classification
- side-bias counts
- extension-heavy flags
- synthetic-present flags
- `densityMetric.diagnostics`
- report-level diagnostics
- report-level `diagnosticSemantics`
- nearest support and resistance
- bucket counts
- extension counts
- synthetic continuation-map count and markings
- 15m context-only status
- prohibited-language hits

The comparison must include a compact before/after artifact and should use the packaged review process unless a more repeatable replacement has been explicitly approved.

## Future Density Semantics Promotion Rules

Future density semantics promotion must require:

- a separate gate with an explicit promotion target;
- repeated real-cache evidence, especially before promoting `dense_separated_level_map`;
- deterministic fixtures for each promoted diagnostic;
- factual labels and descriptions in `level-quality-audit-wording.ts`;
- intentional report-level diagnostic and `diagnosticSemantics` parity updates;
- proof that support/resistance generation behavior is unchanged;
- proof that LevelEngine scoring, ranking, clustering, surfaced levels, and extension generation are unchanged;
- proof that nearest levels, bucket counts, extension counts, and synthetic markings remain stable unless an explicitly separate behavior gate changes them;
- prohibited-language guard coverage;
- confirmation that 15m remains context-only unless a separate approved gate changes that.

## Audit-Only Boundary

The density metric remains audit-only:

- no support/resistance detection changes;
- no LevelEngine scoring, ranking, clustering, or bucket-assignment changes;
- no surfaced support/resistance level changes;
- no extension generation changes;
- no 15m LevelEngine input;
- no cache collection or cache writes;
- no alert, monitoring, Discord, or journal behavior changes.

## Artifact Map

Baseline artifacts:

- density design artifact: `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-design.json`
- density contract artifact: `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-contract.json`
- density report wiring artifact: `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-report-wiring.json`
- density rerun artifact: `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json`
- density semantics review artifact: `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-semantics-review.json`
- density baseline lock artifact: `docs/examples/level-analysis-snapshot/level-quality-density-metric/latest-level-quality-density-metric-baseline-lock.json`

## Recommended Next Gate

Recommended next gate:

```text
level_quality_audit_density_metric_handoff
```

Reason: the density metric design, contract, report wiring, real-cache rerun, semantics decision, and baseline are now locked. A short handoff should summarize the density metric path and point future sessions to the correct artifacts.
