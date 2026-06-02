# Level Quality Candidate Inventory Review Wiring

## Purpose

This gate wires the already-tested candidate inventory review adapter additively into the packaged level quality review process.

The goal is to expose compact candidate inventory visibility in review output while proving existing locked baseline fields remain stable. This is not a behavior tuning gate.

This gate does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced levels, extension generation, runtime defaults, alert behavior, monitoring behavior, Discord behavior, journal behavior, or 15m LevelEngine eligibility.

## Wiring Summary

Updated script:

```text
src/scripts/run-level-quality-review.ts
```

Additive output field per review entry:

```text
candidateInventoryVisibility
```

The field uses the locked wrapper shape from:

```text
src/lib/levels/level-candidate-inventory-review-wiring.ts
```

The runner rebuilds candidate-pool diagnostics read-only from the same local cache wrapper inputs already used by the packaged review command. It uses only daily, 4h, and 5m candles for candidate visibility. Supplied 15m candles remain context-only and are not fed into LevelEngine or candidate inventory stages.

## Output Field Shape

When candidate inventory is available:

```text
{
  present: true,
  visibility: LevelCandidateInventoryVisibility,
  gapSummary: LevelCandidateInventoryGapSummary
}
```

When candidate inventory is unavailable:

```text
{
  present: false,
  limitations: ["raw_clustered_scored_inventory_not_available"],
  diagnostics: ["candidate_inventory_visibility_not_available"]
}
```

The JSON output remains compact. It does not include raw candles, full snapshots, raw candidate arrays, full zone arrays, provider responses, or cache writes.

## Packaged Command Used

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json --out-json docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json --out-text docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.txt --generated-at 2026-06-02T02:49:56.718Z
```

## Real-Cache Rerun Summary

Reviewed symbols:

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

Baseline source:

```text
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json
```

Results:

- Candidate inventory present: `10/10`
- Candidate inventory valid: `10/10`
- Candidate inventory missing: `0/10`
- Existing baseline mismatch count: `0`
- Prohibited-language hits: `0`
- 15m context-only count: `10/10`

## Candidate Inventory Summary

Candidate inventory classifications:

- Overall closer-unsurfaced: `5`
- Support-side closer-unsurfaced: `5`
- Resistance-side closer-unsurfaced: `1`
- Overall truthful market-context: `0`
- Support-side truthful market-context: `0`
- Resistance-side truthful market-context: `2`

The overall truthful-context count is `0` because the two resistance-side truthful cases also have support-side closer-unsurfaced visibility, so the conservative overall classification is `closer_unsurfaced_candidate`.

## HCWB And PHOE Visibility Summary

`HCWB`:

- support: `closer_unsurfaced_candidate`
- resistance: `truthful_market_context_gap`
- support closer scored candidate count: `1`

`PHOE`:

- support: `closer_unsurfaced_candidate`
- resistance: `truthful_market_context_gap`
- support closer scored candidate count: `1`

This confirms the previous nearest-gap investigation: support-side gaps are candidate-selection visibility issues, while resistance-side gaps remain visible as truthful sparse-structure context when raw, clustered, scored, and surfaced nearest resistance align.

## Baseline Compatibility Summary

Existing baseline parity fields remained unchanged:

- nearest support/resistance: `10/10`
- bucket counts: `10/10`
- extension counts: `10/10`
- synthetic continuation-map count: `10/10`
- synthetic continuation-map marking: `10/10`
- diagnostics: `10/10`
- diagnostic semantics: `10/10`
- enrichment breakdown: `10/10`
- extension warning-code sets: `10/10`
- cluster/density diagnostics: `10/10`
- densityMetric presence: `10/10`
- 15m context-only status: `10/10`

Candidate inventory is reported separately and is not included in old baseline mismatch counts in this gate.

## Limitations

The adapter preserves the current limitation:

```text
surfaced_selection_reason_not_serialized
```

Candidate inventory can show that a closer scored candidate did not surface, but current diagnostics do not serialize the exact surfaced-selection reason. Future instrumentation must be approved in a separate gate before reason-level comparisons can be locked.

Candidate inventory parity is not locked yet. It should be added to baseline comparison only after a dedicated candidate-inventory baseline lock.

## Tests Added

Added:

```text
src/tests/level-candidate-inventory-review-wiring.test.ts
```

Coverage includes:

- packaged review output includes `candidateInventoryVisibility`
- present wrappers validate
- missing wrappers validate
- existing parity fields remain unchanged
- candidate inventory is excluded from old mismatch counts
- candidate inventory summary counts are reported separately
- HCWB/PHOE-like closer-unsurfaced support visibility is represented
- output excludes raw candles, full snapshots, raw candidate arrays, and full zone arrays
- source isolation from provider, alert, monitoring, Discord, and journal paths
- prohibited-language guard

## Safety Boundaries

This gate is:

- read-only
- audit-only
- additive to review output
- local-cache only
- facts-only

It does not:

- change support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced levels
- change extension generation
- feed 15m into LevelEngine
- collect or write cache files
- change runtime defaults
- change alert, monitoring, or Discord behavior
- touch journal app files
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_review_rerun_baseline_lock
```

Reason: candidate inventory is now present in packaged review output and the 10-symbol rerun preserved existing baseline parity. The next safe step is to lock the candidate-inventory review baseline so future comparisons can include candidate inventory parity.
