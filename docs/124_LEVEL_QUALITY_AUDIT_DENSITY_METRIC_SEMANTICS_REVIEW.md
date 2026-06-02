# Level Quality Audit Density Metric Semantics Review

## Purpose

This gate reviews whether density-related semantics should stay inside `densityMetric.diagnostics` or be promoted later into report-level `LevelQualityAuditReport.diagnostics` and `diagnosticSemantics`.

This is a review and decision gate only. It does not add report-level density diagnostics, tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Reviewed

Primary source:

```text
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json
```

Supporting sources:

- `docs/122_LEVEL_QUALITY_AUDIT_DENSITY_METRIC_REPORT_WIRING.md`
- `docs/123_LEVEL_QUALITY_REVIEW_RERUN_AFTER_DENSITY_METRIC_WIRING.md`
- `src/lib/levels/level-quality-density-metric.ts`
- `src/lib/levels/level-quality-audit-wording.ts`
- `src/lib/levels/level-quality-audit-runner.ts`
- `src/scripts/run-level-quality-review.ts`

The rerun used the locked 10-symbol real-cache review set:

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

## Density Metric Summary

The rerun confirmed:

- density metric present count: `10/10`
- contract-valid count: `10/10`
- factual-only count: `10/10`
- mismatch count: `0`
- prohibited-language hits: `0`

Classification counts:

- `dense_clustered`: `5`
- `balanced`: `4`
- `sparse`: `1`
- `dense_separated`: `0`

Side-bias counts:

- `mixed`: `6`
- `support_heavy`: `3`
- `resistance_heavy`: `1`
- `none`: `0`

Classification symbols:

- `dense_clustered`: `DEVS`, `ENVX`, `GME`, `AIM`, `YMAT`
- `balanced`: `DXYZ`, `QUBT`, `AAOI`, `PHOE`
- `sparse`: `HCWB`
- `dense_separated`: none

Additional density flags:

- `extensionHeavy`: `GME`, `YMAT`
- `syntheticPresent`: none

## Semantic Candidate Matrix

| Candidate | Current Evidence | Existing Diagnostic Overlap | Top-Level Visibility Value | Misinterpretation Risk | Decision |
| --- | --- | --- | --- | --- | --- |
| `dense_clustered_level_map` | 5 symbols: `DEVS`, `ENVX`, `GME`, `AIM`, `YMAT` | High. Overlaps `clustered_level_areas_present`. | Medium. The metric already exposes classification and clustered flags. | Medium. Could sound like a generation-quality conclusion if promoted too early. | Keep inside `densityMetric` for now. |
| `dense_separated_level_map` | 0 symbols in the locked rerun. Covered by deterministic fixtures only. | Low. This is the clearest new concept from the metric. | High if it appears repeatedly in real-cache reviews. | Medium. Needs repeated evidence before becoming a report-level semantic. | Promote later only after repeated real-cache evidence. |
| `support_heavy_density` | 3 symbols: `ENVX`, `AAOI`, `PHOE` | Low. Existing diagnostics do not summarize side bias. | Medium. Useful as map-shape context. | Medium. Could be mistaken for directional commentary if promoted without careful wording. | Keep inside `densityMetric` for now. |
| `resistance_heavy_density` | 1 symbol: `HCWB` | Low. Existing diagnostics do not summarize side bias. | Low to medium. Current evidence is narrow. | Medium. Could be mistaken for directional commentary if promoted without careful wording. | Keep inside `densityMetric` for now. |
| `extension_heavy_level_map` | 2 symbols: `GME`, `YMAT` | Medium. Related to extension coverage diagnostics, but not identical. | Medium. Useful for review of extension-heavy maps. | Medium. Could imply excessive extensions if promoted without baseline rules. | Keep inside `densityMetric` for now; reconsider after density baseline lock. |
| `synthetic_level_context_present` | 0 symbols in this rerun. Synthetic rows remain fixture-covered and separately guarded. | Medium. Existing synthetic diagnostics already protect the forward-context boundary. | Low in this real-cache rerun. | Medium. Could blur synthetic rows with historical evidence if promoted casually. | Keep inside `densityMetric`; no promotion now. |

## Decision Outcome

Keep density-specific semantics inside `densityMetric` for now.

Do not promote any density metric diagnostics to report-level `LevelQualityAuditReport.diagnostics` or `diagnosticSemantics` in this gate.

## Rationale

The current evidence supports restraint:

- `dense_separated` did not appear in the locked 10-symbol rerun.
- `dense_clustered` overlaps the existing report-level `clustered_level_areas_present` diagnostic.
- side-bias diagnostics are useful, but could be misread as directional commentary if promoted before wording and threshold baselines are locked.
- `extension_heavy_level_map` appeared on only two symbols and should be interpreted alongside extension coverage diagnostics.
- `syntheticPresent` did not appear in the real-cache rerun, and synthetic rows already have explicit forward-context safeguards.
- report-level diagnostics stayed stable in the density rerun, which is useful for baseline comparison.

## Deferred Promotion Rules

Future promotion of density semantics should require:

- a separate approved gate;
- repeated real-cache evidence, especially for `dense_separated`;
- deterministic fixtures for any promoted code;
- factual labels and descriptions in `level-quality-audit-wording.ts`;
- report-level diagnostic parity expectations updated intentionally;
- proof that nearest levels, bucket counts, extension counts, synthetic markings, diagnostics not related to the new additive code, and diagnostic semantics remain stable;
- prohibited-language guard coverage;
- confirmation that 15m remains context-only unless a separate approved gate changes that.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_density_metric_baseline_lock
```

Reason: the density metric now appears in the real-cache review output and the semantics decision is to keep density-specific diagnostics inside the metric. Lock that behavior before moving to another backlog area.
