# Level Quality Decision Baseline Lock

## Purpose

This baseline lock freezes the current evidence-backed LevelEngine quality baseline after the behavior tuning decision gate. It gives future behavior-tuning work a concrete comparison target before any support/resistance generation behavior changes are allowed.

This is a documentation and baseline-lock gate only. It does not tune support/resistance detection, change LevelEngine scoring, ranking, clustering, bucket assignment, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Chain Being Locked

This baseline locks the evidence chain from:

- `docs/107_LEVEL_ENGINE_QUALITY_TUNING_PLAN.md`
- `docs/108_LEVEL_QUALITY_ENRICHMENT_MAPPING_HARDENING.md`
- `docs/109_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN.md`
- `docs/110_LEVEL_QUALITY_AUDIT_WORDING_HARDENING.md`
- `docs/111_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_WORDING.md`
- `docs/112_LEVEL_ENGINE_EXTENSION_COVERAGE_TUNING_PLAN_OR_FIXTURE_PACK.md`
- `docs/113_LEVEL_ENGINE_CLUSTER_DENSITY_TUNING_PLAN_OR_FIXTURE_PACK.md`
- `docs/114_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_FIXTURE_PACKS.md`
- `docs/115_LEVEL_QUALITY_BEHAVIOR_TUNING_DECISION_GATE.md`

Primary compact artifacts:

- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json`
- `docs/examples/level-analysis-snapshot/level-quality-decision-gate/latest-level-quality-behavior-tuning-decision.json`
- `docs/examples/level-analysis-snapshot/level-extension-coverage/latest-extension-coverage-fixture-pack.json`
- `docs/examples/level-analysis-snapshot/level-cluster-density/latest-cluster-density-fixture-pack.json`

The locked baseline starts from `main` after PR #113:

```text
e4a2ce4ac3648d62e1b432507352799bc99f5738
```

## Reviewed Symbol Set

The baseline symbol set is:

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

Supplied IBKR 15m context is present for:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

The remaining symbols use 5m, 4h, and daily cache context only.

## Current Behavior Status

The locked post-fixture baseline confirms:

- nearest support parity held for `10/10` symbols;
- nearest resistance parity held for `10/10` symbols;
- bucket-count parity held for `10/10` symbols;
- extension-count parity held for `10/10` symbols;
- synthetic continuation-map count parity held for `10/10` symbols;
- synthetic continuation-map marking parity held for `10/10` symbols;
- diagnostics parity held for `10/10` symbols;
- diagnostic semantics parity held for `10/10` symbols;
- enrichment breakdown parity held for `10/10` symbols;
- extension coverage warning-code parity held for `10/10` symbols;
- cluster/density diagnostic parity held for `10/10` symbols;
- 15m remained context-only for `10/10` symbols;
- possible production bug count was `0`;
- prohibited-language hit count was `0`.

Current behavior remains unchanged:

- support/resistance detection behavior is unchanged;
- LevelEngine scoring, ranking, clustering, and bucket assignment are unchanged;
- surfaced support/resistance levels are unchanged;
- extension generation behavior is unchanged;
- 15m facts are not fed into LevelEngine;
- synthetic continuation-map rows remain clearly marked forward-planning context.

## Current Known Weaknesses

This baseline intentionally preserves the current review weaknesses because no deterministic production bug has been proven:

- clustered level areas remain present on `DEVS`, `ENVX`, `DXYZ`, `GME`, `AIM`, `HCWB`, and `YMAT`;
- dense map review cases remain on `QUBT`, `AAOI`, and `PHOE`;
- no resistance extension coverage remains on `DEVS`, `AIM`, and `HCWB`;
- limited downside extension coverage remains on `DEVS`, `ENVX`, and `YMAT`;
- wide nearest-level gaps remain on `HCWB` and `PHOE`;
- synthetic continuation-map rows remain present on `AAOI` and `PHOE`.

These are locked as factual review candidates, not grades, instructions, recommendations, or trade advice.

## Explicit Deferred Tuning Areas

Deferred until a future gate proves stronger evidence:

- extension generation tuning;
- clustering, ranking, or surfaced-level tuning;
- nearest-level generation changes;
- 15m LevelEngine input;
- synthetic continuation-map policy changes that add or remove generated rows.

## Baseline Comparison Requirements For Future Behavior Changes

Any future behavior-tuning gate must compare against this locked baseline and report:

- nearest support price and distance before/after;
- nearest resistance price and distance before/after;
- major, intermediate, intraday, and extension bucket counts before/after;
- extension support/resistance counts before/after;
- synthetic continuation-map count and marking before/after;
- `LevelQualityAudit.diagnostics` before/after;
- `diagnosticSemantics` before/after;
- `enrichmentBreakdown` before/after;
- extension warning-code sets before/after;
- cluster/density diagnostics before/after;
- 15m context-only status before/after;
- prohibited-language guard results.

Compact before/after artifacts are required. Raw candle arrays, bulky full snapshots, and raw cache files should not be committed.

## Future Behavior Tuning Entry Requirements

Before any future LevelEngine behavior change, a gate must provide:

- one behavior knob only;
- exact expected output diff before implementation;
- deterministic fixture coverage;
- before/after compact artifacts;
- ten-symbol real-cache rerun against this baseline;
- nearest support/resistance comparison;
- bucket count comparison;
- extension count comparison;
- synthetic marking comparison;
- diagnostic and `diagnosticSemantics` comparison;
- confirmation that 15m is still context-only unless a separate approved gate changes that boundary;
- no raw cache commits;
- no recommendation, coaching, grading, P/L, giveback, behavior scoring, buy/sell/hold, or trade-advice language.

## Prohibited Changes Without A New Gate

Do not make any of the following without a separate explicit gate:

- support/resistance detection tuning;
- LevelEngine scoring, ranking, clustering, or bucket assignment changes;
- surfaced support/resistance level changes;
- extension generation changes;
- 15m LevelEngine input;
- synthetic continuation-map policy changes;
- runtime default changes;
- alert, monitoring, or Discord behavior changes;
- journal app changes;
- journal grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.

## Artifact Map

Baseline lock artifacts:

```text
docs/examples/level-analysis-snapshot/level-quality-baseline-lock/latest-level-quality-baseline-lock.json
docs/examples/level-analysis-snapshot/level-quality-baseline-lock/latest-level-quality-baseline-lock.txt
```

Source artifacts:

```text
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-fixture-packs/latest-level-quality-review-rerun-after-fixture-packs.json
docs/examples/level-analysis-snapshot/level-quality-decision-gate/latest-level-quality-behavior-tuning-decision.json
docs/examples/level-analysis-snapshot/level-extension-coverage/latest-extension-coverage-fixture-pack.json
docs/examples/level-analysis-snapshot/level-cluster-density/latest-cluster-density-fixture-pack.json
```

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
level_quality_final_handoff_summary
```

Reason: the evidence-backed baseline is now locked. A final handoff summary should tell future sessions exactly where the levels-system stands, what is locked, what is deferred, and what must happen before behavior tuning.
