# Level Quality Review Baseline Input Drift Investigation

## Purpose

This gate investigates the pre-existing `AIM` baseline/input drift found during candidate inventory volume/session context review wiring.

The investigation is read-only and documentation-only. It does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced selection, extension generation, 15m LevelEngine eligibility, runtime defaults, alert behavior, monitoring behavior, Discord behavior, or journal behavior.

## Evidence Reviewed

Reviewed files:

- `docs/138_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_REVIEW_WIRING.md`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.txt`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json`
- `src/scripts/run-level-quality-review.ts`

Additional read-only checks:

- current local AIM cache wrapper metadata and SHA-256 hashes
- two same-input reruns of `npm run review:level-quality`
- a detached PR #131 rerun against the same current local cache root
- prior PR #135 reproduction recorded in doc 138
- committed artifact history for the candidate-inventory review artifact

## Affected Symbol And Fields

Affected symbol:

```text
AIM
```

Affected fields:

- `bucketCounts`
- `enrichmentBreakdown`

Current local rerun:

- total surfaced/extension level count: `16`
- `intermediateSupport`: `3`
- historical unenriched level ids: `13`

Committed baseline artifact:

- total surfaced/extension level count: `17`
- `intermediateSupport`: `4`
- historical unenriched level ids: `14`

The missing baseline-only historical id is:

```text
AIM-support-zone-2
```

## Baseline And Current Artifacts

Baseline artifact:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json
```

Baseline generated at:

```text
2026-06-02T02:49:56.718Z
```

Current volume/session review artifact:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json
```

Current generated at:

```text
2026-06-03T01:45:00.000Z
```

Both artifacts reference the same AIM cache wrapper paths:

- `ibkr/AIM/5m/100-1779976500000.json`
- `ibkr/AIM/4h/180-1779969600000.json`
- `ibkr/AIM/daily/520-1779926400000.json`

## Current Local Cache Metadata

Current AIM cache wrapper fingerprints:

- 5m: `efd8feae4a28fe244ccab1aa344e2c7632f6f426a475183abd58aaadd35ee6bc`
- 4h: `8f5038c99165487cd44022f727b537c1ee9bd1a0f4fc2c910b1db28127063c5b`
- daily: `fd1db9eff455c8fda1c82dfe14da8c1471e508ca6f7a36cf21ac3b288e8576c2`

Current wrapper candle counts:

- 5m: `72`
- 4h: `114`
- daily: `502`

The committed baseline artifact records relative source paths, but it does not record cache content hashes. Because raw cache files are intentionally not committed, the exact cache contents that produced the old committed baseline cannot be proven from the artifact alone.

## Reproduction Method

Current branch rerun command:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/latest-level-candidate-inventory-review-wiring.json --out-json artifacts/drift/current-rerun-1.json --out-text artifacts/drift/current-rerun-1.txt --generated-at 2026-06-03T02:05:00.000Z
```

The same command was run twice with the same `generatedAt` value. The two JSON outputs were byte-identical:

```text
fef15d67ecca0813bbc7b3a03271be658076b60b9bea3ffdad98a85b90c1da5c
```

Detached PR #131 check:

```text
2a7937739bae32762e90fc59ab39f53513e74be1
```

Running PR #131 code against the same current local cache root reproduced the same `AIM` mismatches:

- `bucketCounts`
- `enrichmentBreakdown`

Doc 138 also records that PR #135 code reproduced the same drift before volume/session review wiring.

## Drift Classification

Classification:

```text
baseline_artifact_current_cache_input_mismatch
```

This is best described as stale baseline artifact or local-cache/input drift relative to the committed artifact.

What was ruled out:

- nondeterminism: two same-input reruns were byte-identical
- PR #136 volume/session wiring behavior: PR #135 reproduced the drift before the wiring
- code behavior change between PR #131 and PR #135: PR #131 code reproduced the drift against the current cache
- artifact shape mismatch: the runner-compatible review artifact contains the expected `entries` array; the baseline lock artifact is a lock summary and was correctly not used as a direct runner baseline

What remains unproven:

- whether the original baseline artifact was generated from different cache contents under the same relative paths
- whether the current local cache changed outside git before this investigation

The artifact cannot answer that because it does not include cache hashes or a committed raw-cache fixture.

## Root Cause

Root cause found:

```text
The committed baseline artifact is no longer reproducible from the current local IBKR cache contents, and the artifact lacks cache fingerprints needed to prove which cache contents produced it.
```

No deterministic production bug was found.

## Impact Assessment

Impact:

- isolated to `AIM`
- old baseline mismatch count remains `2`
- nearest support and resistance parity remains `10/10`
- extension counts remain `10/10`
- synthetic continuation-map count and marking remain `10/10`
- diagnostics and diagnostic semantics remain `10/10`
- extension warning-code sets remain `10/10`
- cluster/density diagnostics remain `10/10`
- densityMetric remains present for `10/10`
- candidate inventory remains present and valid for `10/10`
- volume/session context remains present and valid for `10/10`
- 15m remains context-only for `10/10`
- prohibited-language hits remain `0`

The drift affects baseline reproducibility, not current generation behavior in this gate.

## Recommendation

Recommended next gate:

```text
level_quality_review_baseline_refresh_decision
```

Reason: decide whether to refresh the review baseline to the current local IBKR cache state or preserve the old baseline and treat the current cache as a different input set.

Suggested decision points:

- whether future review artifacts should include compact cache fingerprints for runner source files
- whether the current local AIM cache should be accepted as the new review input state
- whether to require a one-symbol AIM refresh artifact before locking volume/session context baseline

## Hard Boundaries

This investigation did not:

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
