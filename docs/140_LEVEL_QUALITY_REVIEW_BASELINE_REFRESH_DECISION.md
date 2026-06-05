# Level Quality Review Baseline Refresh Decision

## Purpose

This gate decides how to proceed after the `AIM` baseline/input drift investigation.

The decision is planning-only. It does not refresh the baseline, change support/resistance detection, change LevelEngine scoring, ranking, clustering, or surfaced selection, change extension generation, feed 15m into LevelEngine, or use volume/session facts to change level selection.

## Evidence Reviewed

Reviewed:

- `docs/139_LEVEL_QUALITY_REVIEW_BASELINE_INPUT_DRIFT_INVESTIGATION.md`
- `docs/examples/level-analysis-snapshot/level-quality-review-drift/latest-level-quality-review-baseline-input-drift-investigation.json`
- `docs/examples/level-analysis-snapshot/level-quality-review-drift/latest-level-quality-review-baseline-input-drift-investigation.txt`
- `docs/138_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_REVIEW_WIRING.md`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json`

## Drift Summary

Affected symbol:

```text
AIM
```

Affected fields:

- `bucketCounts`
- `enrichmentBreakdown`

Baseline artifact:

- total surfaced/extension level count: `17`
- `intermediateSupport`: `4`
- historical unenriched level ids: `14`
- baseline-only level id: `AIM-support-zone-2`

Current local IBKR cache rerun:

- total surfaced/extension level count: `16`
- `intermediateSupport`: `3`
- historical unenriched level ids: `13`
- mismatches: `bucketCounts`, `enrichmentBreakdown`

Drift classification:

```text
baseline_artifact_current_cache_input_mismatch
```

No deterministic production bug was found. Same-input current reruns were byte-identical. PR #131 and PR #135 code both reproduced the current-cache drift before PR #136 volume/session wiring.

## Decision Options

| Option | Benefit | Cost | Risk | Decision |
| --- | --- | --- | --- | --- |
| Refresh baseline to current local IBKR cache state | Restores expected review mismatch count to `0`, makes the current local cache the reproducible baseline, and unblocks volume/session context baseline lock | `AIM-support-zone-2` leaves the active baseline and the refresh must be documented as input-state refresh | Low to medium if fingerprints are added first; medium if refreshed without fingerprints | Approve after cache fingerprint contract |
| Preserve old baseline and treat current cache as distinct input set | Keeps the old artifact as historical reference | Current local review remains mismatch count `2`, volume/session baseline lock stays blocked or requires special handling, old baseline cannot be reproduced from current cache | Medium because future reviews keep inheriting known mismatch noise | Defer as primary path; preserve only as historical evidence |
| Create dual-baseline mode | Preserves both old and current cache artifacts and can distinguish historical/current inputs | Adds review complexity and comparison ambiguity | Medium to high unless old cache state is reconstructible | Reject for now |
| Add cache fingerprinting before refreshing | Proves exact cache wrapper inputs for future artifacts and prevents this drift class from being ambiguous again | Requires a small additive review-output contract before refresh | Low if compact and read-only | Approve as immediate next step |

## Recommended Decision

Recommended decision:

```text
Refresh to the current local IBKR cache state, but only after adding compact cache fingerprints to packaged review artifacts.
```

Preserve the old baseline artifact as historical evidence. Treat the refresh as an input-state baseline refresh, not as a LevelEngine behavior change.

Do not refresh the baseline in this decision gate.

## Rationale

The old baseline artifact is not reproducible from the current local cache contents, and it lacks cache hashes. Preserving it as the active baseline would keep a known `AIM` mismatch in every current local review and block clean volume/session baseline locking.

Refreshing immediately without fingerprints would remove the mismatch but leave the same reproducibility gap in place. The safest path is to add a compact cache fingerprint contract first, then refresh the baseline using the current local IBKR cache state with source-file hashes and candle counts recorded.

Dual-baseline mode is not justified now because the old cache contents cannot be proven or reconstructed from the committed artifact.

## Cache Fingerprint Policy

Future packaged review artifacts should include compact source-file fingerprints for each reviewed symbol and timeframe used by the runner.

Minimum fingerprint fields:

- relative source file path
- provider
- timeframe
- SHA-256 of the local cache wrapper file
- wrapper candle count
- request lookback bars when present
- request end timestamp when present
- actual bars returned when present
- validation issue count when present

Fingerprint boundaries:

- no raw candle arrays
- no raw cache wrapper payloads
- no full snapshots
- no provider calls
- no cache writes
- 15m fingerprints may be included as context input fingerprints, but 15m remains outside LevelEngine/support-resistance generation unless a separate approved gate changes that

## Baseline Refresh Requirements

Before refreshing the active baseline:

- add the compact cache fingerprint contract to `npm run review:level-quality`
- validate fingerprints for all 10 reviewed symbols
- rerun the packaged 10-symbol review against the current local IBKR cache
- confirm old behavior fields are stable against the current-cache expected output
- confirm candidate inventory remains present and valid for `10/10`
- confirm volume/session context remains present and valid for `10/10`
- confirm 15m remains context-only for `10/10`
- confirm prohibited-language hits remain `0`
- commit no raw cache files

The baseline refresh artifact should explicitly mark:

```text
refreshType: input_state_baseline_refresh
```

## Future Comparison Rules

After refresh, future review comparisons should include:

- cache fingerprint parity
- nearest support/resistance
- bucket counts
- extension counts
- synthetic continuation-map count and marking
- diagnostics and diagnosticSemantics
- enrichment breakdown
- densityMetric
- candidateInventoryVisibility
- candidateVolumeSessionContext
- 15m context-only status
- prohibited-language hits

If a future cache fingerprint differs, the review should report input drift separately from behavior mismatch.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_cache_fingerprint_contract
```

Reason: before refreshing the baseline, add a compact cache fingerprint contract to packaged review output so future artifacts record the exact cache wrapper hashes and counts that produced them.

Expected follow-up sequence:

1. `level_quality_review_cache_fingerprint_contract`
2. `level_quality_review_baseline_refresh_current_cache`
3. `level_quality_candidate_inventory_volume_session_context_baseline_lock`

## Hard Boundaries

This decision did not:

- change support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts to change scoring or surfaced selection
- collect cache data
- write cache files
- commit raw cache files
- change runtime defaults
- change alert, monitoring, or Discord behavior
- touch journal app files
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice
