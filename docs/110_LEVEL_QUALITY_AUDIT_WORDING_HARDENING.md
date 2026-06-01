# Level Quality Audit Wording Hardening

## Purpose

This gate hardens `LevelQualityAudit` diagnostic wording so audit output is clearer, factual, and easier to consume before any support/resistance behavior tuning.

It is an audit wording and diagnostics gate only. It does not change support/resistance generation, LevelEngine scoring, ranking, clustering, bucket assignment, surfaced levels, extension generation, runtime defaults, alerts, monitoring, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Wording And Semantic Problem

The multi-timeframe review rerun confirmed that enrichment diagnostics are now more specific, but several audit codes still need normalized human-readable meaning:

- wide nearest support/resistance gaps;
- extension coverage gaps;
- clustered or dense level areas;
- broad and category-specific enrichment diagnostics;
- synthetic continuation-map rows;
- missing context or reference facts.

The risk is not the code values themselves. The risk is downstream display or operator review using vague wording that sounds like a grade, instruction, or trading conclusion.

## Diagnostic Categories

The new wording catalog classifies audit diagnostics into factual categories:

| Category | Meaning |
| --- | --- |
| `coverage` | Level map coverage, nearest-level gaps, and extension ladder coverage. |
| `density` | Clustered level areas inside audit distance thresholds. |
| `enrichment` | Missing or partial `enrichedAnalysis` metadata. |
| `synthetic` | Marked synthetic continuation-map diagnostics. |
| `freshness` | Reserved for freshness diagnostics. |
| `context` | Missing reference, session, volume, shelf, or intelligence context. |
| `safety` | Reserved for safety or replay-readiness diagnostics. |

Severity remains review-oriented only:

- `info`
- `watch`
- `review`

These severities are audit priority labels, not trade scores.

## Labels And Descriptions Added

Added:

```text
src/lib/levels/level-quality-audit-wording.ts
```

Exports include:

- `LEVEL_QUALITY_AUDIT_DIAGNOSTIC_LABELS`
- `describeLevelQualityDiagnostic(code)`
- `classifyLevelQualityDiagnostic(code)`
- `isLevelQualityDiagnosticFactualOnly(code)`
- `LevelQualityDiagnosticCategory`
- `LevelQualityDiagnosticSeverity`

The catalog covers current audit diagnostics for:

- wide nearest support/resistance gaps;
- missing or limited extension coverage;
- clustered level areas;
- context gaps;
- broad enrichment coverage;
- historical/extension/synthetic enrichment gaps;
- profile-level missing session/volume/enrichment/shelf context.

## Compatibility Behavior

`unenriched_levels_present` remains supported as a broad compatibility diagnostic.

Specific diagnostics remain separate:

- `unenriched_historical_levels_present`
- `unenriched_extension_levels_present`
- `unenriched_synthetic_levels_present`

`LevelQualityAuditReport` now includes additive `diagnosticSemantics` entries derived from the existing `diagnostics` list. Existing diagnostic codes are not removed or renamed.

## Safe Wording Examples

Safe wording:

- "Wide nearest support gap"
- "No resistance extension coverage"
- "Clustered level areas present"
- "General enrichment coverage gap present"
- "Synthetic continuation-map enrichment gap present"

Synthetic continuation-map wording remains explicit: these rows are marked forward-planning context, not historical evidence.

## Prohibited Wording Boundaries

Audit wording must not imply:

- buy/sell/hold;
- recommendations or trade advice;
- good trade or bad trade;
- grades, grading, or coaching;
- P/L, giveback, or behavior scoring;
- mistakes or discipline labels;
- execution entry or exit decisions.

## Tests Added

Added:

```text
src/tests/level-quality-audit-wording-hardening.test.ts
```

Coverage includes:

- factual labels/descriptions for key diagnostics;
- compatibility behavior for `unenriched_levels_present`;
- sharper category-specific enrichment diagnostics;
- synthetic continuation-map wording boundaries;
- additive `diagnosticSemantics` on audit reports;
- no mutation of supplied `LevelEngineOutput`;
- no prohibited wording;
- no LevelEngine, alert, monitoring, Discord, or journal imports.

## Compact Artifact

Added compact wording artifact:

```text
docs/examples/level-analysis-snapshot/level-quality-audit-wording/latest-audit-wording-hardening.json
docs/examples/level-analysis-snapshot/level-quality-audit-wording/latest-audit-wording-hardening.txt
```

The artifact lists diagnostic code, category, severity, label, description, and factual-only status. It contains no raw candle arrays, no snapshots, and no cache data.

## What Remains Intentionally Unchanged

This gate does not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or bucket assignment;
- change surfaced support/resistance levels;
- change extension generation;
- feed 15m into LevelEngine;
- collect or write cache files;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_engine_multi_timeframe_quality_review_rerun_after_wording
```

Reason: this gate adds additive audit report labels/descriptions. The safest next step is rerunning the same quality review to verify wording surfaces as intended while LevelEngine parity still holds.
