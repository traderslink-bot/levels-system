# Level Quality Review Post Refresh Stability Check

## Purpose

This gate proves the refreshed active level quality review baseline is stable and repeatable against the current local IBKR cache state.

The check is stability-only. It does not refresh the baseline again, tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced selection, extension generation, 15m LevelEngine eligibility, or use volume/session facts for level selection.

## Why This Follows Baseline Refresh

`docs/143_LEVEL_QUALITY_REVIEW_BASELINE_REFRESH_CURRENT_CACHE.md` refreshed the active review baseline to the current local IBKR cache state and added compact cache fingerprints to the active artifact.

This follow-up verifies that the refreshed baseline is repeatable before future gates use it as the comparison anchor.

## Refreshed Active Baseline

Refreshed active baseline:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json
```

Refreshed active text artifact:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.txt
```

The active baseline was generated at `2026-06-06T13:10:00.000Z` and self-compares with `mismatchCount: 0`.

## Review Commands Used

All review runs used the current local IBKR cache root:

```text
C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles
```

Run A:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-a.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-a.txt --generated-at 2026-06-06T14:00:00.000Z
```

Run B:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-b.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-b.txt --generated-at 2026-06-06T14:00:00.000Z
```

Run C:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-c.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-c.txt --generated-at 2026-06-06T14:00:00.000Z
```

Timestamp-variant run:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-timestamp-variant.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-timestamp-variant.txt --generated-at 2026-06-06T14:01:00.000Z
```

## Fixed Timestamp Determinism Policy

Runs A, B, and C used the same fixed timestamp:

```text
2026-06-06T14:00:00.000Z
```

The three fixed-timestamp JSON outputs were byte-identical:

```text
d97202ebc030a4250a668fd3302918da48c38b78503beb545c4ad6d510a4ff0a
```

The fixed-timestamp text outputs also matched the same rendered review state.

## Timestamp Variant Metadata Policy

The timestamp-variant run used:

```text
2026-06-06T14:01:00.000Z
```

After normalizing top-level `generatedAt`, `cacheFingerprintSet.generatedAt`, and the rendered generated timestamp in `content`, the timestamp-variant JSON matched Run A.

No level-quality, fingerprint, density, candidate inventory, or volume/session fields changed.

## Run Results

| Run | Generated At | Mismatch Count | Fixed Output SHA-256 |
| --- | --- | ---: | --- |
| A | `2026-06-06T14:00:00.000Z` | `0` | `d97202ebc030a4250a668fd3302918da48c38b78503beb545c4ad6d510a4ff0a` |
| B | `2026-06-06T14:00:00.000Z` | `0` | `d97202ebc030a4250a668fd3302918da48c38b78503beb545c4ad6d510a4ff0a` |
| C | `2026-06-06T14:00:00.000Z` | `0` | `d97202ebc030a4250a668fd3302918da48c38b78503beb545c4ad6d510a4ff0a` |
| Timestamp variant | `2026-06-06T14:01:00.000Z` | `0` | `65cbd4393a03110de923c34fc3cef559098b5bd750c32caba6632829efbb4b39` |

All runs reviewed the same 10 symbols:

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

## Fingerprint Summary Stability

Every run produced the same fingerprint summary:

- cache fingerprints: `35`
- fingerprinted symbols: `10`
- LevelEngine-input fingerprints: `30`
- context-only fingerprints: `5`
- 15m context-only fingerprints: `5`
- validation issue count: `45`
- wrapper candle count: `6662`
- actual bars returned: `6662`
- provider count: `ibkr: 35`
- timeframe counts: `5m: 10`, `4h: 10`, `daily: 10`, `15m: 5`

The `cacheFingerprintSet` was identical across fixed-timestamp runs. The timestamp-variant run changed only timestamp metadata.

## Mismatch Stability

All runs produced:

```text
mismatchCount: 0
```

All parity fields stayed at `10/10`:

- nearest support
- nearest resistance
- bucket counts
- extension counts
- synthetic continuation-map count and marking
- diagnostics
- diagnostic semantics
- enrichment breakdown
- extension warning-code sets
- cluster/density diagnostics
- 15m context-only status

Additive report fields stayed stable:

- density metric present: `10/10`
- candidate inventory present and valid: `10/10`
- candidate volume/session context present and valid: `10/10`
- session facts present: `10/10`
- volume facts present: `10/10`
- volume shelf context present: `10/10`

## 15m Context-Only Policy

The supplied 15m symbols remained:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

All 15m fingerprints remained context-only and outside LevelEngine:

- `contextOnly: true`
- `includedInLevelEngine: false`
- `safety.fifteenMinuteFedIntoLevelEngine: false`

15m was not fed into support/resistance generation.

## Safety Boundaries

This gate did not:

- refresh the active baseline again
- collect cache data
- write cache wrapper files
- commit raw cache files
- include raw candles in committed artifacts
- include raw cache wrapper payloads
- include full snapshots
- call providers
- change support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts to change scoring or surfaced selection
- change runtime defaults
- change alert, monitoring, or Discord behavior
- touch journal app files
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Validation Commands

Validation run:

```text
npm ci
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-cache-fingerprint-contract.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-cache-fingerprint-wiring.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-baseline-refresh-current-cache.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-post-refresh-stability-check.test.ts
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-a.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-a.txt --generated-at 2026-06-06T14:00:00.000Z
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-b.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-b.txt --generated-at 2026-06-06T14:00:00.000Z
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-c.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-c.txt --generated-at 2026-06-06T14:00:00.000Z
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-post-refresh-stability-check/run-timestamp-variant.json --out-text artifacts/level-quality-review-post-refresh-stability-check/run-timestamp-variant.txt --generated-at 2026-06-06T14:01:00.000Z
npx tsc --noEmit
npm test
git diff --check
```

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_volume_session_fact_coverage_audit
```

Reason: after the refreshed baseline is stable, the next safe step is an audit-only review of volume/session fact coverage and missing facts. This should remain facts-only and must not affect level scoring, surfaced selection, or LevelEngine behavior.
