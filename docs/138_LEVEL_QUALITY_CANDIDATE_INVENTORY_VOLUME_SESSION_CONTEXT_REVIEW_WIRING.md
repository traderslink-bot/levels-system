# Level Quality Candidate Inventory Volume Session Context Review Wiring

## Purpose

This gate wires the pure candidate volume/session context builder additively into the packaged level quality review process.

The new review output gives candidate and surfaced rows facts-only session, volume, and volume-shelf context. This is not a behavior tuning gate. It does not change support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced selection, extension generation, 15m LevelEngine eligibility, alerts, monitoring, Discord behavior, or journal behavior.

## Wiring Summary

Updated script:

```text
src/scripts/run-level-quality-review.ts
```

Additive output field per review entry:

```text
candidateVolumeSessionContext
```

The field uses the locked contract:

```text
LevelCandidateVolumeSessionContext
```

The runner builds compact context rows from existing candidate inventory visibility and existing snapshot facts. It includes:

- surfaced nearest support/resistance rows
- closer unsurfaced scored candidates when candidate inventory reports them
- selected extension nearest rows when available

The row set is intentionally small and deterministic. It does not include raw candles, full snapshots, raw candidate arrays, full zone arrays, provider responses, or cache writes.

## Output Field Shape

Each entry now includes:

```text
candidateVolumeSessionContext: LevelCandidateVolumeSessionContext
```

The context contains:

- compact `contexts` rows
- per-row nearby session facts
- per-row volume state facts
- per-row volume shelf overlap or no-nearby-shelf diagnostics
- a comparison summary
- facts-only diagnostics
- safety flags confirming no generation, ranking, surfaced-selection, extension, provider, or cache-write behavior changed

If candidate inventory is unavailable, the runner emits a valid context with no rows and factual diagnostics such as `candidate_inventory_visibility_not_available` and `candidate_volume_session_rows_unavailable`.

## Fact Derivation Summary

The packaged review already builds `LevelAnalysisSnapshot` from local cache wrapper files. This wiring reuses:

- `snapshot.sessionFacts`
- `snapshot.volumeFacts`
- `snapshot.volumeShelves`
- `snapshot.candidateInventoryVisibility`

The facts come from the same closed/as-of filtered local candles already used by the review command. The wiring does not call providers, collect cache data, write cache files, or feed 15m candles into LevelEngine.

Volume/session facts are context only. They are not used to change support/resistance detection, scoring, ranking, clustering, surfaced selection, or extension generation.

## Packaged Command Used

The candidate-inventory baseline lock artifact is a lock summary and does not contain a runner `entries` array. Per the gate instruction, the rerun used the latest runner-compatible review artifact referenced by that lock:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json
```

Command:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json --out-json docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-text docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.txt --generated-at 2026-06-03T01:45:00.000Z
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

Results:

- Candidate volume/session context present: `10/10`
- Candidate volume/session context valid: `10/10`
- Candidate volume/session context missing: `0/10`
- Session facts present: `10/10`
- Volume facts present: `10/10`
- Volume shelf context present: `10/10`
- Candidate volume/session missing-facts count: `0`
- Prohibited-language hits: `0`
- 15m context-only count: `10/10`

Comparison outcomes:

- `surfaced_has_more_session_volume_context`: `6`
- `candidate_identifier_unavailable`: `4`

The `candidate_identifier_unavailable` cases are expected with current candidate inventory visibility because unsurfaced scored candidates do not serialize stable candidate ids yet.

## HCWB And PHOE Context Summary

`HCWB`:

- candidate inventory: support closer-unsurfaced; resistance truthful market context
- volume/session context outcome: `candidate_identifier_unavailable`
- support comparison includes the closer unsurfaced scored support row and surfaced support/extension rows
- resistance side has no nearby session/volume context in the compact row set

`PHOE`:

- candidate inventory: support closer-unsurfaced; resistance truthful market context
- volume/session context outcome: `candidate_identifier_unavailable`
- support comparison includes the closer unsurfaced scored support row and surfaced support/extension rows
- resistance side has no nearby session/volume context in the compact row set

This preserves the candidate-inventory nearest-gap visibility while adding facts-only session/volume context. It does not infer a better level or change surfaced selection.

## Baseline Compatibility Summary

Candidate inventory stayed stable:

- Candidate inventory present: `10/10`
- Candidate inventory valid: `10/10`
- Candidate inventory missing: `0/10`
- Support-side closer-unsurfaced count: `5`
- Resistance-side closer-unsurfaced count: `1`
- Resistance-side truthful market-context count: `2`

Stable old baseline fields:

- nearest support/resistance: `10/10`
- extension counts: `10/10`
- synthetic continuation-map count: `10/10`
- synthetic continuation-map marking: `10/10`
- diagnostics: `10/10`
- diagnostic semantics: `10/10`
- extension warning-code sets: `10/10`
- cluster/density diagnostics: `10/10`
- densityMetric presence: `10/10`
- 15m context-only status: `10/10`

Current old-field mismatch count: `2`.

The two mismatches are isolated to `AIM`:

- `bucketCounts`
- `enrichmentBreakdown`

Detached sanity check:

- Running the PR #135 merge commit `519326c079217c2c02d21f22e0dd1b55fdaf4322` directly against the same local cache root produced the same two `AIM` mismatches before this gate's wiring changes.
- The mismatch is therefore not caused by `candidateVolumeSessionContext` wiring.
- Current local rerun output has `AIM` total level count `16`; the committed baseline artifact has `17`, with one historical `AIM-support-zone-2` no longer present in the rerun.

This should be treated as a baseline/input drift investigation item before locking the new volume/session context baseline.

## Limitations

The context can compare surfaced rows with closer unsurfaced scored rows, but current candidate inventory visibility still has the limitation:

```text
surfaced_selection_reason_not_serialized
```

Unsurfaced scored candidates currently do not carry stable candidate ids in the compact review output, so some comparisons report:

```text
candidate_identifier_unavailable
```

## Tests Added

Added:

```text
src/tests/level-candidate-volume-session-context-review-wiring.test.ts
```

Coverage includes:

- packaged review output includes `candidateVolumeSessionContext`
- context validates for present cases
- safe unavailable row context remains valid
- old baseline mismatch counts exclude volume/session context
- candidate inventory parity remains separately summarized
- output excludes raw candles, full snapshots, raw candidate arrays, and full zone arrays
- source isolation from provider, alert, monitoring, Discord, and journal paths
- prohibited-language guard
- 15m remains context-only

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
- use volume/session facts to change scoring or surfaced selection
- collect or write cache files
- change runtime defaults
- change alert, monitoring, or Discord behavior
- touch journal app files
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_baseline_input_drift_investigation
```

Reason: the volume/session context wiring is additive and valid, but the current local real-cache rerun shows a pre-existing `AIM` old-field drift at PR #135. Resolve or explicitly accept that drift before locking a new candidate volume/session context baseline.

After that drift is explained, the intended next gate remains:

```text
level_quality_candidate_inventory_volume_session_context_baseline_lock
```
