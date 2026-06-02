# Level Quality Nearest Gap Investigation

## Purpose

This investigation reviews the wide nearest-level gaps on `HCWB` and `PHOE` without changing support/resistance generation behavior.

The goal is to determine whether the gaps are truthful market context, an audit/reporting threshold issue, candidate selection visibility, evidence of a missed-candidate bug, or inconclusive due to missing candidate inventory.

This gate is investigation-only. It does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Evidence Reviewed

Primary docs:

- `docs/116_LEVEL_QUALITY_DECISION_BASELINE_LOCK.md`
- `docs/117_LEVEL_QUALITY_FINAL_HANDOFF_SUMMARY.md`
- `docs/118_LEVEL_ENGINE_BEHAVIOR_TUNING_BACKLOG.md`
- `docs/123_LEVEL_QUALITY_REVIEW_RERUN_AFTER_DENSITY_METRIC_WIRING.md`

Primary artifact:

- `docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json`

Code areas reviewed:

- `src/scripts/run-level-quality-review.ts`
- `src/scripts/run-level-candidate-pool-diagnostics.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-candidate-pool-diagnostics.ts`
- `src/lib/analysis/level-analysis-snapshot-from-candles.ts`

## Symbols Investigated

Primary wide-gap symbols:

- `HCWB`
- `PHOE`

Comparison symbols:

- `DXYZ`
- `QUBT`

The investigation used the same local IBKR cache root used by the locked review:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

## Method

A temporary read-only TypeScript harness rebuilt the existing LevelEngine candidate stages from the compact review artifact source files:

1. load 5m, 4h, and daily local cache files from the locked review artifact;
2. run existing swing detection and raw candidate building;
3. run existing clustering, scoring, ranking, and extension selection;
4. build existing candidate-pool diagnostics;
5. compare nearest raw/scored/surfaced inventory around reference price.

No new cache data was collected. No cache files were written. No raw candles or full snapshots are committed.

The existing packaged review output is compact and does not expose raw, clustered, or scored candidate inventory. Candidate inventory was available for this investigation only through the temporary read-only harness and existing pure pipeline functions.

## Per-Symbol Findings

### HCWB

Reference price: `2.945`

Surfaced nearest levels from the locked review:

- nearest support: `1.91`, distance `35.1443%`, bucket `majorSupport`
- nearest resistance: `3.78`, distance `28.3531%`, bucket `majorResistance`

Candidate inventory findings:

- nearest raw support below reference: `2.77`, distance `5.9423%`
- nearest scored support below reference: `2.77`, distance `5.9423%`, daily swing-low zone
- surfaced support prices end at `1.91`; the closer scored support at `2.77` is not surfaced
- nearest raw resistance above reference: `3.78`, distance `28.3531%`
- nearest scored resistance above reference: `3.78`, distance `28.3531%`
- surfaced resistance includes `3.78`

Classification:

- support-side gap: `candidate_selection_visibility_issue`
- resistance-side gap: `truthful_market_context`
- overall: candidate inventory shows a closer support candidate exists but is not surfaced; overhead resistance gap matches the nearest available raw/scored/surfaced resistance

No deterministic production bug was proven. The evidence points to surfaced-selection/ranking visibility rather than missing raw candidate generation.

### PHOE

Reference price: `34.75`

Surfaced nearest levels from the locked review:

- nearest support: `29.85`, distance `14.1007%`, bucket `intradaySupport`
- nearest resistance: `40.98`, distance `17.9281%`, bucket `intermediateResistance`

Candidate inventory findings:

- nearest raw support below reference: `30.99`, distance `10.8201%`
- nearest scored support below reference: `30.99`, distance `10.8201%`, 5m swing-low zone
- surfaced support prices end at `29.85`; the closer scored support at `30.99` is not surfaced
- nearest raw resistance above reference: `40.98`, distance `17.9281%`
- nearest scored resistance above reference: `40.98`, distance `17.9281%`
- surfaced resistance includes `40.98`

Classification:

- support-side gap: `candidate_selection_visibility_issue`
- resistance-side gap: `truthful_market_context`
- overall: candidate inventory shows a closer support candidate exists but is not surfaced; overhead resistance gap matches the nearest available raw/scored/surfaced resistance

No deterministic production bug was proven. The evidence again points to surfaced-selection/ranking visibility rather than missing raw candidate generation.

## Comparison Symbols

`DXYZ` and `QUBT` were used as contrast cases with supplied 15m facts. Both retained 15m context-only behavior.

`DXYZ`:

- nearest support: `45.8`, distance `1.4418%`
- nearest resistance: `46.8`, distance `0.7101%`
- dense metric classification: `balanced`
- nearest scored support and resistance matched surfaced nearest levels

`QUBT`:

- nearest support: `12.42`, distance `2.9612%`
- nearest resistance: `12.9727`, distance `1.3571%`
- dense metric classification: `balanced`
- closer scored support candidates existed at `12.74` and `12.541`, but surfaced nearest remained the stronger `12.42` zone

The comparison set shows the current ranker can intentionally surface stronger zones over the closest scored zones. That behavior is not a proven bug by itself, but it makes nearest-gap explanations dependent on candidate inventory visibility.

## Candidate Inventory Availability

Available today:

- final compact review output;
- nearest surfaced support/resistance;
- bucket counts;
- extension counts and warnings;
- audit diagnostics and `diagnosticSemantics`;
- density metric classification and side bias;
- pure candidate-pool diagnostics helper that accepts prebuilt pipeline inputs.

Not available in the packaged review output:

- raw candidate inventory;
- clustered zone inventory;
- scored-but-unsurfaced zone inventory;
- explicit reason a closer scored candidate did not surface;
- per-zone surfaced selection explanation.

Investigation conclusion:

- raw and scored inventory can be reconstructed read-only with existing helpers;
- that visibility is not packaged for the real-cache quality review process yet;
- a future gate should expose a compact, read-only candidate inventory/debug view before any behavior tuning.

## Gap Classification Summary

| Symbol | Side | Classification | Evidence |
| --- | --- | --- | --- |
| `HCWB` | support | `candidate_selection_visibility_issue` | scored support at `2.77` is closer than surfaced support `1.91` |
| `HCWB` | resistance | `truthful_market_context` | nearest raw/scored/surfaced resistance is `3.78` |
| `PHOE` | support | `candidate_selection_visibility_issue` | scored support at `30.99` is closer than surfaced support `29.85` |
| `PHOE` | resistance | `truthful_market_context` | nearest raw/scored/surfaced resistance is `40.98` |

## Bug Assessment

No deterministic production bug was found.

The investigation did find evidence that the wide support gaps are not caused by absent raw candidates. Closer scored candidates exist but are not surfaced. That may be acceptable current ranking behavior, or it may justify a future one-knob surfaced-selection investigation. It should not be tuned before the candidate inventory/debug view is packaged and before the locked baseline comparison requirements are applied.

## Hard Boundaries

Unchanged:

- support/resistance detection behavior;
- LevelEngine scoring, ranking, clustering, and surfaced selection behavior;
- extension generation behavior;
- LevelEngine default output behavior;
- runtime mode defaults;
- 15m facts remain outside LevelEngine;
- alert, monitoring, and Discord behavior;
- journal app files and journal behavior;
- journal grading, coaching, P/L, giveback, and behavior scoring;
- recommendation or trade-advice behavior;
- local cache contents.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_visibility_design
```

Reason: before changing generation behavior, the system should package a safe read-only candidate inventory/debug view that explains raw, clustered, scored, surfaced, and extension-stage visibility for real-cache reviews.
