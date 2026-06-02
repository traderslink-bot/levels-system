# Level Quality Candidate Inventory Review Baseline Lock

## Purpose

This gate locks the candidate-inventory review baseline after candidate inventory visibility was wired additively into the packaged level quality review output.

The locked baseline confirms that candidate inventory is present and valid for the reviewed 10-symbol IBKR set, while all existing baseline comparison fields remain stable. This is a documentation and baseline-lock gate, not a LevelEngine behavior tuning gate.

## Evidence Chain Being Locked

- `docs/128_LEVEL_QUALITY_CANDIDATE_INVENTORY_VISIBILITY_DESIGN.md`
- `docs/129_LEVEL_QUALITY_CANDIDATE_INVENTORY_VISIBILITY_CONTRACT.md`
- `docs/130_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_WIRING_DESIGN.md`
- `docs/131_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_WIRING_CONTRACT.md`
- `docs/132_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_ADAPTER.md`
- `docs/133_LEVEL_QUALITY_CANDIDATE_INVENTORY_REVIEW_WIRING.md`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.txt`

Merged baseline commit:

```text
2a7937739bae32762e90fc59ab39f53513e74be1
```

## Reviewed Symbol Set

Locked reviewed symbols:

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

The packaged review remained IBKR-focused. Supplied 15m candles remained context-only and were not fed into LevelEngine or candidate inventory stages.

## Baseline Source

Candidate inventory review wiring artifact:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json
```

Original old-field baseline used by the wiring rerun:

```text
docs/examples/level-analysis-snapshot/level-quality-review-rerun-after-density-metric/latest-level-quality-review-rerun-after-density-metric.json
```

Packaged review command source:

```text
src/scripts/run-level-quality-review.ts
```

Candidate inventory adapter and contracts:

```text
src/lib/levels/level-candidate-inventory-review-adapter.ts
src/lib/levels/level-candidate-inventory-review-wiring.ts
src/lib/levels/level-candidate-inventory-visibility.ts
```

## Candidate Inventory Presence And Validation Summary

Locked values from the 10-symbol rerun:

- Candidate inventory present: `10/10`
- Candidate inventory valid: `10/10`
- Candidate inventory missing: `0/10`
- Existing baseline mismatch count: `0`
- Support-side closer-unsurfaced count: `5`
- Resistance-side closer-unsurfaced count: `1`
- Overall closer-unsurfaced count: `5`
- Resistance-side truthful market-context count: `2`
- 15m context-only count: `10/10`
- Prohibited-language hits: `0`

## Gap Classification Summary

- `DEVS`: no gap
- `ENVX`: no gap
- `DXYZ`: no gap
- `QUBT`: closer-unsurfaced candidate; support closer count `2`
- `GME`: no gap
- `AIM`: no gap
- `HCWB`: support closer-unsurfaced; resistance truthful market-context
- `YMAT`: closer-unsurfaced candidate; support closer count `1`
- `AAOI`: closer-unsurfaced candidate; support closer count `1`; resistance closer count `1`
- `PHOE`: support closer-unsurfaced; resistance truthful market-context

The overall closer-unsurfaced count is `5` because `QUBT`, `HCWB`, `YMAT`, `AAOI`, and `PHOE` each have an overall `closer_unsurfaced_candidate` classification. The resistance-side truthful market-context count is `2` for `HCWB` and `PHOE`; their overall classification remains closer-unsurfaced because support-side visibility takes precedence.

## HCWB And PHOE Visibility Summary

`HCWB`:

- support classification: `closer_unsurfaced_candidate`
- resistance classification: `truthful_market_context_gap`
- support closer scored candidate count: `1`
- resistance closer scored candidate count: `0`

`PHOE`:

- support classification: `closer_unsurfaced_candidate`
- resistance classification: `truthful_market_context_gap`
- support closer scored candidate count: `1`
- resistance closer scored candidate count: `0`

This preserves the nearest-gap investigation conclusion: the support side has candidate-selection visibility, while resistance remains truthful sparse-market context when raw, clustered, scored, and surfaced nearest resistance align.

## Old Baseline Compatibility Summary

The candidate inventory wiring rerun preserved old baseline parity:

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
- mismatch count: `0`

Candidate inventory was excluded from old baseline mismatch counts in the first wiring gate. This baseline lock changes the comparison expectation for future reviews: candidate inventory should now be compared deliberately.

## Future Candidate Inventory Comparison Requirements

Future review comparisons must include candidate inventory parity for:

- `candidateInventoryVisibility` presence
- wrapper validation status
- gap classification by side and overall
- support and resistance closer-unsurfaced counts
- `stageCounts` by side and total
- nearest raw, clustered, scored, and surfaced levels by side
- extension candidate counts and selected extension counts
- limitations
- diagnostics
- facts-only and prohibited-language status

Future review comparisons must also continue to include old baseline fields:

- nearest support/resistance
- bucket counts
- extension counts
- synthetic continuation-map count and marking
- diagnostics and diagnosticSemantics
- enrichment breakdown
- densityMetric
- 15m context-only status

## Limitations

The current candidate inventory visibility can show that a closer scored candidate did not surface. It does not serialize the exact surfaced-selection reason. The known limitation remains:

```text
surfaced_selection_reason_not_serialized
```

Reason-level surfaced selection instrumentation would require a separate approved gate.

## Hard Boundaries

This baseline lock does not:

- tune support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced levels
- change extension generation
- feed 15m into LevelEngine
- collect or write cache files
- change runtime defaults
- change alert, monitoring, Discord, or journal behavior
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Recommended Next Gate

Recommended next gate:

```text
level_quality_candidate_inventory_volume_session_context_design
```

Reason: candidate inventory visibility is now wired and baseline-locked. The next professional chart-reading upgrade should connect candidate and surfaced levels to existing session and volume facts while staying facts-only and avoiding generation behavior changes.
