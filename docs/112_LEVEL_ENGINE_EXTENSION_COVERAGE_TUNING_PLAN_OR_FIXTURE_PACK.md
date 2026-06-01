# LevelEngine Extension Coverage Tuning Plan Or Fixture Pack

## Purpose

This gate creates fixture-backed coverage for LevelEngine extension coverage and spacing before any extension generation behavior tuning.

It is a plan and fixture gate only. It does not tune extension generation, support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, runtime defaults, alerts, monitoring, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Source

Primary evidence:

```text
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

## Extension Coverage Categories

The rerun artifact classifies the ten-symbol set into factual extension coverage cases:

| Category | Symbols | Notes |
| --- | --- | --- |
| No resistance extension coverage | `DEVS`, `AIM`, `HCWB` | Audit reports `no_resistance_extension_coverage`; no resistance extension rows are fabricated by the audit path. |
| Limited downside extension coverage | `DEVS`, `ENVX`, `YMAT` | Audit reports `limited_downside_extension_coverage` when lowest support extension is inside the configured downside coverage threshold. |
| Adequate extension coverage by current audit threshold | `DXYZ`, `QUBT`, `GME`, `AAOI`, `PHOE` | No extension coverage warning in the compact rerun artifact. |
| Synthetic continuation-map rows present | `AAOI`, `PHOE` | Synthetic rows remain marked as forward-planning context, not historical support/resistance evidence. |

These categories are review inputs for future tuning. They are not grades, recommendations, or trade advice.

## Fixture Scenarios Added

Added:

```text
src/tests/level-engine-extension-coverage-fixtures.test.ts
```

The fixture pack locks current behavior across:

1. Balanced extension coverage.
   - Support and resistance extensions exist.
   - Audit reports no missing-side extension coverage warnings.
   - No synthetic continuation-map row is required.

2. No resistance extension coverage.
   - Support extension rows exist and resistance extension rows are absent.
   - Audit reports `no_resistance_extension_coverage`.
   - Audit does not fabricate resistance extension rows.

3. Limited downside extension coverage.
   - A support extension exists, but the downside coverage percentage is inside the configured threshold.
   - Audit reports `limited_downside_extension_coverage`.
   - The selected extension row remains factual historical-candidate context.

4. Synthetic continuation-map preservation.
   - Synthetic rows remain marked with `synthetic_continuation_map`.
   - Synthetic rows retain forward-planning wording and zero historical evidence fields.
   - Enrichment diagnostics separate synthetic rows from historical and real extension gaps.

5. Spacing guard.
   - Closely spaced extension candidates do not all need to surface under current selection behavior.
   - The skipped close candidate is diagnosed with `too_close_to_another_extension`.
   - Diagnostics remain marked as behavior-unchanged and diagnostic-only.

## Current Behavior Locked

This gate locks the current baseline:

- extension coverage warnings are audit diagnostics, not generated levels;
- missing extension coverage does not cause the audit runner to fabricate rows;
- synthetic continuation-map rows remain explicitly marked and separate from historical evidence;
- spacing diagnostics record close-candidate rejection without changing selection behavior;
- 15m facts remain outside LevelEngine support/resistance generation.

## Possible Future Tuning Knobs

Future behavior-tuning gates may evaluate:

- `extensionCoverageWarningPct` audit thresholds;
- extension `spacingPct`;
- `maxExtensionPerSide`;
- `searchWindowPct`;
- `forwardPlanningRangePct`;
- real candidate pool eligibility;
- synthetic continuation-map fallback limits;
- whether no-resistance coverage should stay audit-only or receive a stricter synthetic policy in selected modes.

Each knob can affect forward levels. Tuning must therefore prove no accidental fabrication, no overfitting to one symbol, and no regression in surfaced historical support/resistance levels.

## Risks Of Tuning

Extension behavior tuning is higher risk than wording or enrichment work because it can:

- add forward rows that were not present before;
- hide useful but closely spaced levels;
- overemphasize round-number synthetic context;
- change target-side coverage asymmetrically;
- make compact maps look cleaner while losing useful market structure.

Any behavior change should start with fixtures and a real-cache rerun before default behavior changes.

## No-Fabrication Boundary

Future extension work must keep a hard boundary between:

- historical support/resistance candidates backed by candle evidence;
- selected real extension rows;
- synthetic continuation-map rows used only as marked forward-planning context.

Synthetic rows must never be described as historical support/resistance evidence.

## Synthetic Continuation-Map Boundary

Synthetic continuation-map rows may be useful for forward map completeness, but they must remain:

- clearly marked;
- separated in enrichment breakdowns;
- excluded from historical evidence counts;
- documented as forward-planning context only.

## Recommended Implementation Order

Suggested future extension work sequence:

1. Keep this fixture pack as the behavior lock.
2. Add or rerun compact real-cache review artifacts before changing extension behavior.
3. Test one tuning knob at a time.
4. Compare nearest levels, bucket counts, extension counts, synthetic markings, and diagnostics before and after.
5. Only consider default changes after parity and no-fabrication checks are explicit.

## What Remains Intentionally Unchanged

This gate does not:

- tune extension generation behavior;
- change support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or bucket assignment;
- change surfaced support/resistance levels;
- feed 15m into LevelEngine;
- collect or write cache data;
- change runtime defaults;
- change alert, monitoring, or Discord behavior;
- modify the journal app;
- add journal grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.

## Recommended Next Gate

Recommended next gate:

```text
level_engine_cluster_density_tuning_plan_or_fixture_pack
```

Reason: this fixture pack did not find an obvious extension bug. Extension behavior tuning can fabricate or reshape forward levels, so the safer next quality area is cluster density fixture planning before behavior tuning.
