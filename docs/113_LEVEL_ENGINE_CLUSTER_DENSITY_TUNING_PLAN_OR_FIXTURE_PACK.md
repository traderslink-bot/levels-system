# LevelEngine Cluster Density Tuning Plan Or Fixture Pack

## Purpose

This gate creates fixture-backed coverage for clustered and dense level areas before any clustering, ranking, or surfaced-level behavior tuning.

It is a plan and fixture gate only. It does not tune clustering, support/resistance detection, LevelEngine scoring or ranking, surfaced support/resistance levels, extension generation, runtime defaults, alerts, monitoring, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Source

Primary evidence:

```text
docs/106_LEVEL_ENGINE_MULTI_TIMEFRAME_LEVEL_QUALITY_REVIEW.md
docs/111_LEVEL_ENGINE_MULTI_TIMEFRAME_QUALITY_REVIEW_RERUN_AFTER_WORDING.md
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-wording/latest-level-quality-review-rerun-after-wording.json
```

The review covered:

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

## Cluster And Density Categories

The rerun-after-wording artifact confirms seven symbols with `clustered_level_areas_present`:

- `DEVS`
- `ENVX`
- `DXYZ`
- `GME`
- `AIM`
- `HCWB`
- `YMAT`

The original quality review also labeled three symbols as dense maps without the audit cluster diagnostic:

- `QUBT`
- `AAOI`
- `PHOE`

That distinction matters. Current audit behavior detects nearby level clusters when prices sit inside the configured cluster threshold. A map can still look dense by total level count without triggering `clustered_level_areas_present` when levels are separated enough.

## Fixture Scenarios Added

Added:

```text
src/tests/level-engine-cluster-density-fixtures.test.ts
```

The fixture pack locks current behavior across:

1. Sparse map.
   - Levels are far enough apart.
   - Audit reports no clustered areas.
   - No density diagnostic is emitted.

2. Support-only cluster.
   - Support rows sit within the audit cluster threshold.
   - Audit reports a support cluster.
   - Surfaced level arrays remain unchanged.

3. Resistance-only cluster.
   - Resistance rows sit within the audit cluster threshold.
   - Audit reports a resistance cluster.
   - Surfaced level arrays remain unchanged.

4. Mixed cluster.
   - A support row and resistance row sit near one another.
   - Audit reports a mixed cluster.
   - Support and resistance sides remain intact, and nearest support/resistance remain typed correctly.

5. Dense clustered map.
   - Multiple rows sit inside the configured cluster threshold.
   - Audit emits `clustered_level_areas_present`.
   - `diagnosticSemantics` classify the diagnostic as `density`.
   - The current anchor-based cluster run captures five rows in the fixture.

6. Large separated map.
   - Many rows are present.
   - Prices are separated enough that the current audit threshold does not report a cluster.
   - This documents the review distinction between dense maps and audit clusters.

7. Nearest-level preservation.
   - Nearby clusters are audited only.
   - Nearest support/resistance identities remain unchanged.
   - The supplied `LevelEngineOutput` is not mutated.

## Current Behavior Locked

This gate locks the current baseline:

- `LevelQualityAudit` clustering is diagnostic-only;
- `clustered_level_areas_present` is emitted only when audited rows sit within the configured threshold;
- support-only, resistance-only, and mixed clusters are distinguished factually;
- possible clutter rows are derived from cluster membership;
- large separated maps can remain dense review cases without a cluster diagnostic;
- nearest support/resistance identities are preserved;
- supplied `LevelEngineOutput` objects are not mutated.

## Possible Future Tuning Knobs

Future behavior-tuning gates may evaluate:

- `clusterThresholdPct` audit threshold;
- raw candidate cluster tolerance by timeframe;
- cluster representative selection;
- bucket-level maximum output counts;
- near-duplicate suppression distance;
- ranking penalties for crowded price bands;
- surfaced-map display caps;
- whether dense-but-separated maps need a separate audit metric.

Each knob can remove or reprioritize levels. Tuning must therefore prove no over-filtering, no loss of useful nearest levels, and no accidental support/resistance side reclassification.

## Risks Of Tuning

Cluster and density tuning can:

- hide useful nearby support/resistance structure;
- keep a weaker representative while filtering a stronger one;
- alter nearest support/resistance;
- reduce map detail too aggressively in low-priced symbols;
- make a map look cleaner while losing factual market structure;
- blur the line between audit diagnostics and runtime behavior.

Any behavior change should be tested against deterministic fixtures and rerun against the same real-cache review symbols.

## Nearest-Level Preservation Boundary

Future tuning must explicitly preserve or intentionally document any change to:

- nearest support identity;
- nearest resistance identity;
- nearest support distance;
- nearest resistance distance;
- side classification for levels inside mixed clusters.

No tuning gate should change nearest levels accidentally.

## No-Overfiltering Boundary

Future cluster changes must not remove levels solely because a map looks visually dense. Filtering should be tied to deterministic evidence such as:

- price proximity;
- strength/reaction quality;
- timeframe coverage;
- candidate lineage;
- source overlap;
- repeated near-duplicate behavior.

Dense maps should remain factual context unless a tuning gate proves that specific rows are redundant.

## Recommended Implementation Order

Suggested future density work sequence:

1. Keep this fixture pack as the behavior lock.
2. Rerun the compact real-cache quality review after both extension and density fixture packs.
3. If the rerun still points at density as the next priority, plan one tuning knob at a time.
4. Compare nearest levels, bucket counts, cluster counts, possible clutter counts, diagnostics, and extension counts before and after.
5. Only consider behavior tuning after a fixture-backed implementation plan exists.

## What Remains Intentionally Unchanged

This gate does not:

- tune clustering behavior;
- change support/resistance detection;
- change LevelEngine scoring or ranking;
- change surfaced support/resistance levels;
- change extension generation;
- feed 15m into LevelEngine;
- collect or write cache data;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_engine_multi_timeframe_quality_review_rerun_after_fixture_packs
```

Reason: this fixture pack did not find an obvious cluster/density bug. Both extension and density behavior are now fixture-documented, so the safest next step is another real-cache quality review baseline before any behavior tuning.
