# Level Quality Review Baseline Refresh Current Cache

## Purpose

This gate refreshes the active packaged level quality review baseline to the current local IBKR cache state after compact cache fingerprints were wired into `npm run review:level-quality`.

The refresh is an input-state baseline refresh only. It does not tune support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced selection, extension generation, 15m LevelEngine eligibility, or volume/session influence on level selection.

## Why Refresh Was Allowed

The baseline refresh decision in `docs/140_LEVEL_QUALITY_REVIEW_BASELINE_REFRESH_DECISION.md` approved refreshing the baseline after cache fingerprints were added.

The prior drift investigation found that the committed active baseline was no longer reproducible from the current local IBKR cache contents and did not contain cache hashes. The fingerprint wiring gate then added compact source provenance so future artifacts can distinguish input drift from behavior drift.

## Old Active Baseline Historical Status

Previous active baseline path:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json
```

Before this refresh, that artifact:

- was generated at `2026-06-03T01:45:00.000Z`
- did not contain `cacheFingerprintSet`
- did not contain `cacheFingerprintSummary`
- represented historical evidence only after this gate
- should not remain the active comparison target after this gate

Compact historical summary:

```text
docs/examples/level-analysis-snapshot/level-quality-review-baseline-refresh-current-cache/pre-refresh-active-baseline-historical-summary.json
docs/examples/level-analysis-snapshot/level-quality-review-baseline-refresh-current-cache/pre-refresh-active-baseline-historical-summary.txt
```

The old artifact remains recoverable through git history. No raw cache files, raw candles, raw wrapper payloads, or full snapshots were copied into the historical summary.

## New Active Baseline

Refreshed active baseline path:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.txt
```

Generated at:

```text
2026-06-06T13:10:00.000Z
```

The refreshed baseline now includes:

- `cacheFingerprintSet`
- `cacheFingerprintSummary`
- candidate inventory review output
- candidate volume/session context review output
- density metric output
- existing parity fields
- current local IBKR cache output

## Packaged Command

Before-refresh comparison command:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-baseline-refresh-current-cache/before-refresh.json --out-text artifacts/level-quality-review-baseline-refresh-current-cache/before-refresh.txt --generated-at 2026-06-06T13:00:00.000Z
```

Refresh command:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-text docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.txt --generated-at 2026-06-06T13:10:00.000Z
```

The refresh command was run twice. The first run wrote current-cache entries and fingerprints while still comparing to the old artifact. The second run compared against the newly written artifact and left the active baseline self-consistent with `mismatchCount: 0`.

After-refresh verification command:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-baseline-refresh-current-cache/after-refresh.json --out-text artifacts/level-quality-review-baseline-refresh-current-cache/after-refresh.txt --generated-at 2026-06-06T13:10:00.000Z
```

## Fingerprint Summary

The refreshed active baseline records:

- cache fingerprints: `35`
- fingerprinted symbols: `10`
- LevelEngine-input fingerprints: `30`
- context-only fingerprints: `5`
- 15m context-only fingerprints: `5`
- validation issue count: `45`
- provider count: `ibkr: 35`
- timeframe counts: `5m: 10`, `4h: 10`, `daily: 10`, `15m: 5`
- wrapper candle count: `6662`
- actual bars returned: `6662`

The validation issue count is source metadata from the cache wrappers. It is recorded as input provenance and did not block the facts-only review artifact.

## Mismatch Before And After Refresh

Before refresh, the current local IBKR cache produced `mismatchCount: 4` against the old historical baseline:

| Symbol | Mismatches |
| --- | --- |
| `DEVS` | `enrichmentBreakdown` |
| `AIM` | `bucketCounts`, `enrichmentBreakdown` |
| `YMAT` | `enrichmentBreakdown` |

After refresh, the current local IBKR cache produced `mismatchCount: 0` against the refreshed active baseline.

All existing parity fields self-compare at `10/10` after refresh:

- nearest support/resistance
- bucket counts
- extension counts
- synthetic continuation-map count and marking
- diagnostics and diagnostic semantics
- enrichment breakdown
- extension warning-code sets
- cluster/density diagnostics
- densityMetric
- candidateInventoryVisibility
- candidateVolumeSessionContext
- 15m context-only status

## Current-Cache Drift Explanation

This gate treats the old mismatches as baseline artifact/current-cache input drift, not as a production behavior bug.

The old artifact did not include source hashes, and the exact old local cache contents cannot be proven from the committed artifact alone. The refreshed baseline is now tied to the current local IBKR cache files through compact fingerprints, which gives future reviews a source-provenance anchor.

## 15m Policy

The refreshed baseline includes 15m fingerprints for the supplied 15m symbols:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

All 15m fingerprints remain context-only:

- `contextOnly: true`
- `includedInLevelEngine: false`
- `safety.fifteenMinuteFedIntoLevelEngine: false`

15m was not fed into LevelEngine/support-resistance generation.

## Safety

This gate did not:

- collect cache data
- write cache wrapper files
- commit raw cache files
- include raw candles
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
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-baseline-refresh-current-cache/before-refresh.json --out-text artifacts/level-quality-review-baseline-refresh-current-cache/before-refresh.txt --generated-at 2026-06-06T13:00:00.000Z
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-baseline-refresh-current-cache/after-refresh.json --out-text artifacts/level-quality-review-baseline-refresh-current-cache/after-refresh.txt --generated-at 2026-06-06T13:10:00.000Z
npx tsc --noEmit
npm test
git diff --check
```

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_post_refresh_stability_check
```

Reason: after refreshing the active baseline to the current fingerprinted cache state, rerun the packaged review once more against the refreshed baseline in a separate stability gate before locking any follow-on volume/session baseline decisions.
