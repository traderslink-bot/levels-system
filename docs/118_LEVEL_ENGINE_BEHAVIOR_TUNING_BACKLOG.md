# LevelEngine Behavior Tuning Backlog

## Purpose

This document creates a constrained backlog for possible future LevelEngine behavior tuning. It does not approve tuning by itself and does not change support/resistance generation, scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alerts, monitoring, Discord behavior, or journal behavior.

The intent is to keep the next work evidence-led. The current baseline found no deterministic production bug, so any future behavior change must first prove why it is needed and then compare against the locked baseline.

## Baseline Dependency

Future behavior-changing gates must start from the baseline locked in:

- `docs/116_LEVEL_QUALITY_DECISION_BASELINE_LOCK.md`
- `docs/examples/level-analysis-snapshot/level-quality-baseline-lock/latest-level-quality-baseline-lock.json`
- `docs/117_LEVEL_QUALITY_FINAL_HANDOFF_SUMMARY.md`
- `docs/examples/level-analysis-snapshot/level-quality-final-handoff/latest-level-quality-final-handoff.json`

The locked 10-symbol review set is:

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

The supplied IBKR 15m context symbols are:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

The locked decision remains: defer LevelEngine generation behavior tuning for now.

## Backlog Rules

Every future behavior-changing gate must:

- change one behavior knob only
- name the exact expected output diff before implementation
- include deterministic fixture coverage
- include before/after compact artifacts
- rerun the 10-symbol real-cache review against the locked baseline
- compare nearest support/resistance
- compare bucket counts
- compare extension counts
- compare synthetic continuation-map count and marking
- compare diagnostics and `diagnosticSemantics`
- compare `enrichmentBreakdown`
- prove no prohibited language was introduced
- keep 15m context-only unless a separate approved gate changes that boundary
- commit no raw cache files

Investigation, packaging, audit-only, and documentation gates may proceed before behavior tuning when they preserve the same boundaries.

## Priority Order

1. `level_quality_review_process_packaging`
2. `level_quality_audit_density_metric_design`
3. `level_quality_nearest_gap_investigation`
4. `level_engine_extension_coverage_tuning_investigation`
5. `level_engine_cluster_density_tuning_investigation`
6. `synthetic_continuation_map_policy_review`
7. `levels_system_15m_future_use_backlog`

This ranking favors repeatability and audit-only improvements before any generation behavior change.

## Candidate Gates

### 1. `level_quality_review_process_packaging`

Purpose: package the real-cache quality review process into a repeatable command, script, or documented harness.

Risk: low.

Expected benefit: future reviews become less dependent on one-off inline harnesses and easier to compare against the locked baseline.

Behavior change: none.

Evidence required before gate: current review artifacts, the baseline lock, and existing 10-symbol review method.

Required tests/artifacts: deterministic parser or script tests if code is added; compact review output that avoids raw candles and full snapshots.

Recommendation: do first.

### 2. `level_quality_audit_density_metric_design`

Purpose: design an audit-only metric for dense but separated maps, especially review cases where many levels are present without `clustered_level_areas_present`.

Risk: low to medium.

Expected benefit: improves factual diagnostics without changing generated levels.

Behavior change: audit/reporting only if later implemented.

Evidence required before gate: `QUBT`, `AAOI`, and `PHOE` dense-map review cases, current cluster/density fixtures, and diagnostic semantics boundaries.

Required tests/artifacts: deterministic audit fixture coverage and compact before/after diagnostic artifacts if implementation follows.

Recommendation: safe second step after review-process packaging.

### 3. `level_quality_nearest_gap_investigation`

Purpose: investigate wide nearest-level gaps on `HCWB` and `PHOE`.

Risk: medium.

Expected benefit: clarifies whether wide gaps are only audit/reporting context or evidence of missed candidate coverage.

Behavior change: none in investigation phase.

Evidence required before gate: candidate inventory review, nearest support/resistance baseline comparison, and proof of any missed candidate before generation changes are proposed.

Required tests/artifacts: compact candidate-inventory summaries and deterministic fixtures only if a clear missed-candidate hypothesis appears.

Recommendation: investigate before any nearest-level generation change.

### 4. `level_engine_extension_coverage_tuning_investigation`

Purpose: investigate no-resistance and limited-downside extension coverage cases.

Risk: medium to high.

Expected benefit: may identify whether extension coverage warnings represent acceptable factual scarcity or a specific tuning opportunity.

Behavior change: none in investigation phase.

Evidence required before gate: extension candidate inventory, no-fabrication rules, the extension fixture pack, and a before/after plan for any proposed knob.

Required tests/artifacts: deterministic extension fixtures, compact real-cache comparison plan, and explicit synthetic continuation-map boundary checks.

Recommendation: investigate only after lower-risk packaging and audit-only work.

### 5. `level_engine_cluster_density_tuning_investigation`

Purpose: investigate clustered and dense maps without changing clustering, ranking, or surfaced levels.

Risk: medium to high.

Expected benefit: may clarify whether density is a display/audit issue, a candidate issue, or a generation tuning issue.

Behavior change: none in investigation phase.

Evidence required before gate: cluster/density fixture pack, nearest-level preservation checks, and proof that any proposed tuning would not over-filter useful levels.

Required tests/artifacts: representative cluster fixtures, nearest-level parity checks, and compact 10-symbol before/after plan before behavior implementation.

Recommendation: keep behind audit-only density design.

### 6. `synthetic_continuation_map_policy_review`

Purpose: review synthetic continuation-map limits and wording.

Risk: medium.

Expected benefit: keeps synthetic rows clearly separated from historical support/resistance evidence.

Behavior change: none in review phase.

Evidence required before gate: `AAOI` and `PHOE` synthetic continuation-map rows, current synthetic diagnostics, and wording boundary checks.

Required tests/artifacts: compact policy summary and fixtures proving synthetic rows remain marked forward-planning context, not historical evidence.

Recommendation: review only; do not change policy without a later dedicated gate.

### 7. `levels_system_15m_future_use_backlog`

Purpose: define what evidence would be required before 15m facts could influence LevelEngine behavior.

Risk: high if behavior-changing.

Expected benefit: makes the future 15m decision explicit while preserving the current context-only boundary.

Behavior change: none in backlog/design phase.

Evidence required before gate: supplied IBKR 15m facts validation, no-lookahead proof, and a separate approved decision gate before any LevelEngine input change.

Required tests/artifacts: future-use decision artifact, no-lookahead comparisons, and before/after 10-symbol review plan if behavior use is ever proposed.

Recommendation: keep 15m context-only for now.

## Evidence Summary

The current evidence chain supports a constrained backlog rather than immediate behavior tuning:

- The post-fixture 10-symbol rerun found no obvious production bug.
- LevelEngine parity held for nearest levels, bucket counts, extension counts, synthetic marking, diagnostics, diagnostic semantics, enrichment breakdown, extension warning-code sets, and cluster/density diagnostics.
- Extension and cluster/density fixture packs documented current behavior and found no obvious behavior bug.
- Remaining weaknesses are review candidates: clustered areas on seven symbols, dense maps on `QUBT`, `AAOI`, and `PHOE`, extension warnings on `DEVS`, `ENVX`, `AIM`, `HCWB`, and `YMAT`, and wide nearest-level gaps on `HCWB` and `PHOE`.

## Required Tests And Artifacts

Any future backlog gate that adds code should include focused deterministic tests. Any gate that changes behavior must also include:

- before/after compact artifacts
- a 10-symbol real-cache review rerun
- explicit nearest support/resistance comparison
- explicit bucket and extension count comparison
- synthetic continuation-map comparison
- diagnostic and `diagnosticSemantics` comparison
- no-prohibited-language proof
- confirmation that no raw cache files were committed

Docs-only gates may omit tests when no deterministic helper is added, but they must still validate JSON artifacts and run full project checks.

## Anti-Goals

This backlog does not:

- approve support/resistance detection tuning
- approve LevelEngine scoring, ranking, clustering, or bucket assignment changes
- approve surfaced level changes
- approve extension generation changes
- approve feeding 15m into LevelEngine
- approve synthetic continuation-map policy changes
- change runtime defaults
- change alert, monitoring, or Discord behavior
- modify the journal app
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Recommended Next Gate

Recommended next gate: `level_quality_review_process_packaging`.

Reason: before any additional behavior work, package the real-cache quality review process so future reviews are repeatable and less dependent on one-off inline harnesses.
