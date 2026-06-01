# Level Quality Behavior Tuning Decision Gate

## Purpose

This decision gate reviews the evidence chain after enrichment mapping hardening, audit wording hardening, extension coverage fixtures, cluster/density fixtures, and the post-fixture ten-symbol quality rerun. The goal is to decide whether LevelEngine behavior tuning is justified now, or whether generation behavior should remain unchanged while the current evidence-backed baseline is locked.

This is a decision and planning gate only. It does not tune support/resistance detection, change LevelEngine scoring, ranking, clustering, bucket assignment, surfaced levels, extension generation, runtime defaults, alerts, monitoring, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Reviewed

Primary docs reviewed:

- `docs/107_LEVEL_ENGINE_QUALITY_TUNING_PLAN.md`
- `docs/108_LEVEL_QUALITY_ENRICHMENT_MAPPING_HARDENING.md`
- `docs/109_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN.md`
- `docs/110_LEVEL_QUALITY_AUDIT_WORDING_HARDENING.md`
- `docs/111_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_WORDING.md`
- `docs/112_LEVEL_ENGINE_EXTENSION_COVERAGE_TUNING_PLAN_OR_FIXTURE_PACK.md`
- `docs/113_LEVEL_ENGINE_CLUSTER_DENSITY_TUNING_PLAN_OR_FIXTURE_PACK.md`
- `docs/114_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_FIXTURE_PACKS.md`

Primary compact artifacts reviewed:

- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json`
- `docs/examples/level-analysis-snapshot/level-extension-coverage/latest-extension-coverage-fixture-pack.json`
- `docs/examples/level-analysis-snapshot/level-cluster-density/latest-cluster-density-fixture-pack.json`

Reviewed symbols:

- Supplied 15m context present: `DEVS`, `ENVX`, `DXYZ`, `QUBT`, `GME`
- 5m/4h/daily comparison set without supplied 15m: `AIM`, `HCWB`, `YMAT`, `AAOI`, `PHOE`

## Current Evidence Summary

The post-fixture rerun confirmed:

- nearest support parity held for `10/10` symbols;
- nearest resistance parity held for `10/10` symbols;
- bucket-count parity held for `10/10` symbols;
- extension-count parity held for `10/10` symbols;
- synthetic continuation-map count and marking parity held for `10/10` symbols;
- diagnostics, diagnostic semantics, enrichment breakdown, extension warning-code sets, and cluster/density diagnostics all matched the previous baseline;
- 15m remained context-only for all ten symbols;
- prohibited-language hits were `0`;
- possible production bug count was `0`.

Remaining review weaknesses are factual quality-review candidates, not proven defects:

- clustered level areas remain on `DEVS`, `ENVX`, `DXYZ`, `GME`, `AIM`, `HCWB`, and `YMAT`;
- dense map review cases remain on `QUBT`, `AAOI`, and `PHOE` without audit cluster diagnostics;
- extension coverage warnings remain on `DEVS`, `ENVX`, `AIM`, `HCWB`, and `YMAT`;
- wide nearest-level gaps remain on `HCWB` and `PHOE`.

## Decision Rules

Behavior tuning should proceed only if at least one of these conditions is true:

- a deterministic production bug is found;
- current behavior materially harms level usefulness across multiple real-cache symbols and the expected fix is narrow;
- fixture coverage exists for the affected behavior;
- before/after changes can be proven safely with compact artifacts;
- the tuning gate changes one knob only and clearly states the expected output diff.

If no bug exists and the behavior change can alter generated or surfaced levels, tuning should be deferred. Audit, wording, enrichment, review, and baseline-lock work should remain preferred until stronger evidence exists.

## Decision Matrix

| Area | Current evidence | Bug found | Risk | Potential benefit | What would change | Test readiness | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Extension coverage tuning | `DEVS`, `AIM`, and `HCWB` have no resistance extension coverage; `DEVS`, `ENVX`, and `YMAT` have limited downside extension coverage. Fixture scenarios now lock current no-fabrication, spacing, and synthetic behavior. | No | High | May improve forward map coverage when real candidates exist. | Extension rows, extension counts, coverage warnings, and possibly synthetic continuation-map policy. | Fixture-backed, but no proven output defect. | Defer generation tuning. Keep audit diagnostics and require one-knob future gate if stronger evidence appears. |
| Cluster/density tuning | Seven symbols report clustered areas; `QUBT`, `AAOI`, and `PHOE` are dense review cases without audit cluster diagnostics. Fixtures now lock sparse, support-only, resistance-only, mixed, dense, separated, and nearest-preservation behavior. | No | High | May reduce near-duplicate clutter and make maps easier to inspect. | Clustering, ranking, surfaced rows, nearest support/resistance identity, and bucket counts. | Fixture-backed, but no proven output defect. | Defer clustering or surfaced-level tuning. Consider separate audit density metric before behavior changes. |
| Nearest-level gap handling | `HCWB` and `PHOE` still have wide nearest support/resistance gaps. Audit semantics already describe these as factual coverage gaps. | No | Medium to high | Could improve nearby map coverage if real candidates are being missed. | Candidate eligibility, threshold handling, or synthetic policy if treated as generation issue. | Audit wording is ready; behavior fixtures are not specific enough for a generation change. | Defer generation tuning. Preserve factual gap diagnostics and create a targeted bug gate only if a missed-candidate defect is proven. |
| Enrichment and audit improvements | Enrichment mapping and diagnostic wording hardening are already merged. Reruns show diagnostic semantics and enrichment breakdown are present and factual-only. | No | Low | Improves explainability without changing level generation. | Additive metadata and wording only. | Complete for current scope. | No further immediate behavior work. Keep as current safe path model. |
| 15m facts future use | Supplied IBKR 15m facts validate cleanly and remain outside LevelEngine provider metadata and support/resistance generation. | No | High | May eventually add context for quality/explanation or future multi-timeframe behavior. | Would alter LevelEngine input eligibility if used for generation. | Fact validation exists; behavior fixtures do not justify generation use. | Defer 15m LevelEngine input. Keep 15m context-only until a separate design gate approves otherwise. |
| Synthetic continuation-map policy | Synthetic rows appear on `AAOI` and `PHOE`, remain marked, and are separated from historical evidence and synthetic enrichment gaps. | No | Medium | May improve forward-planning completeness if policy is tuned carefully. | Synthetic row counts, marking, audit diagnostics, and possibly extension coverage expectations. | Fixture-backed for preservation, not tuning. | Defer policy changes. Preserve no-historical-evidence boundary. |

## Decision Outcome

Decision:

```text
defer_level_generation_behavior_tuning
```

No actual LevelEngine behavior tuning is justified in the next gate. The current evidence shows stable output, fixture-documented review weaknesses, and no production bug. Extension and cluster/density behavior changes are both high-risk because they can alter surfaced rows, nearest levels, extension ladders, and downstream expectations.

The safest next step is to lock the current evidence-backed baseline so future behavior work must explicitly justify a narrow change.

## Areas Approved And Deferred

Approved now:

- baseline locking;
- compact decision artifacts;
- future review/reporting handoff;
- audit or documentation clarifications that do not change generated levels.

Deferred:

- extension generation tuning;
- clusterer/ranker/surfaced-level tuning;
- nearest-level gap generation changes;
- use of 15m facts as LevelEngine input;
- synthetic continuation-map policy changes that add or remove generated rows.

## Risk Assessment

Extension tuning risk is high because it can fabricate or remove forward rows and change extension counts.

Cluster/density tuning risk is high because it can hide valid confluence, change nearest levels, or over-filter low-priced symbols.

Nearest-level gap tuning risk is medium to high because wide gaps may be truthful market context rather than a generation defect.

15m LevelEngine input risk is high because 15m facts are validated as context, not yet as support/resistance generation evidence.

Synthetic continuation-map policy risk is medium because rows can be useful context but must remain clearly separated from historical support/resistance evidence.

## Future Tuning Rules

Any future behavior-tuning gate must:

- change one knob only;
- name the exact expected output diff before implementation;
- preserve or explicitly document nearest support/resistance changes;
- compare bucket counts, extension counts, synthetic markings, diagnostics, and diagnostic semantics before and after;
- keep 15m outside LevelEngine unless a separate design gate changes that boundary;
- include deterministic fixtures and a compact real-cache rerun;
- avoid recommendation, coaching, grading, P/L, giveback, behavior scoring, buy/sell/hold, and trade-advice language;
- avoid raw cache commits and bulky full snapshots.

## Compact Artifact

Added compact decision artifacts:

```text
docs/examples/level-analysis-snapshot/level-quality-decision-gate/latest-level-quality-behavior-tuning-decision.json
docs/examples/level-analysis-snapshot/level-quality-decision-gate/latest-level-quality-behavior-tuning-decision.txt
```

The artifacts include the evidence reviewed, decision matrix, approved/deferred areas, risk assessment, and recommended next gate. They do not include raw candle arrays, full snapshots, or cache files.

## Anti-Goals

This gate does not:

- tune support/resistance detection behavior;
- change LevelEngine scoring, ranking, clustering, or bucket assignment;
- change surfaced support/resistance levels;
- change extension generation behavior;
- feed 15m into LevelEngine;
- collect or write cache data;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_decision_baseline_lock
```

Reason: the post-fixture evidence does not justify generation behavior tuning. Lock the current baseline and decision rules first, so any future behavior gate must prove a narrow, expected, fixture-backed output change before touching LevelEngine generation behavior.
