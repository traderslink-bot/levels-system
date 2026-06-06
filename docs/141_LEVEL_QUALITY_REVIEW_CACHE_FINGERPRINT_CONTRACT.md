# Level Quality Review Cache Fingerprint Contract

## Purpose

This gate adds a compact, facts-only cache fingerprint contract for packaged level quality review artifacts.

The contract exists so future review outputs can prove which local IBKR cache wrapper files produced them before the active review baseline is refreshed to the current local cache state.

This gate does not refresh the baseline, wire fingerprints into `npm run review:level-quality`, change support/resistance generation, change LevelEngine scoring, ranking, clustering, surfaced selection, or extension generation, feed 15m into LevelEngine, or use volume/session facts for level selection.

## Why Fingerprints Are Needed

The `AIM` drift investigation found that the committed baseline artifact is no longer reproducible from the current local IBKR cache contents, while the old artifact did not record cache hashes. That made it impossible to prove whether the drift came from local cache input change, stale artifact state, or another input mismatch.

Cache fingerprints close that gap by recording only source identity and summary counts:

- which wrapper file was used
- which provider, symbol, and timeframe it represented
- the wrapper file SHA-256
- wrapper candle count and provider-return count
- request lookback/end timestamp
- validation issue count
- optional first/last candle timestamps and as-of timestamp

The contract intentionally excludes raw candles, raw cache wrapper payloads, full snapshots, provider calls, and cache writes.

## Contract Shape

Module:

```text
src/lib/analysis/level-quality-review-cache-fingerprint.ts
```

Primary types:

- `LevelQualityReviewCacheFingerprint`
- `LevelQualityReviewCacheFingerprintSet`
- `LevelQualityReviewCacheFingerprintTimeframe`
- `LevelQualityReviewCacheFingerprintProvider`
- `LevelQualityReviewCacheFingerprintSummary`

Helpers:

- `validateLevelQualityReviewCacheFingerprint`
- `validateLevelQualityReviewCacheFingerprintSet`
- `assertLevelQualityReviewCacheFingerprintFactsOnly`
- `summarizeLevelQualityReviewCacheFingerprints`
- `isLevelQualityReviewCacheFingerprint`
- `isLevelQualityReviewCacheFingerprintSet`

Fingerprint schema:

```text
level-quality-review-cache-fingerprint/v1
```

Fingerprint set schema:

```text
level-quality-review-cache-fingerprint-set/v1
```

## Required Fields

Each fingerprint requires:

- `relativePath`
- `provider`
- `symbol`
- `timeframe`
- `sha256`
- `wrapperCandleCount`
- `requestLookbackBars`
- `requestEndTimestamp`
- `actualBarsReturned`
- `validationIssueCount`
- `safety`

Safety requires:

- `rawCandlesIncluded: false`
- `rawCacheWrapperPayloadsIncluded: false`
- `fullSnapshotsIncluded: false`
- `providerCallsMade: false`
- `cacheFilesWritten: false`
- `fifteenMinuteFedIntoLevelEngine: false`

## Optional Fields

The contract allows:

- `firstCandleTimestamp`
- `lastCandleTimestamp`
- `asOfTimestamp`
- `includedInLevelEngine`
- `contextOnly`

Missing optional fields remain valid. The summary helper only reports timestamp bounds when they are present.

## 15m Policy

15m fingerprints are allowed only as context-only source fingerprints.

For `timeframe: "15m"`:

- `contextOnly` must be `true`
- `includedInLevelEngine` must be `false`
- `safety.fifteenMinuteFedIntoLevelEngine` must be `false`

This preserves the current boundary: 15m facts may be reviewed as context, but 15m remains outside LevelEngine/support-resistance generation unless a separate approved gate changes that.

## Validation Rules

Validation checks:

- schema version
- portable relative path using forward slashes
- provider values: `ibkr`, `stub`, `twelve_data`
- timeframe values: `5m`, `15m`, `4h`, `daily`
- lowercase 64-character SHA-256
- non-negative integer counts and timestamps
- positive request lookback
- wrapper candle count equals actual bars returned
- optional first timestamp is not after optional last timestamp
- unknown fields are rejected
- raw candle arrays, raw cache wrapper payloads, and full snapshot payload keys are rejected
- 15m cannot be marked as LevelEngine input
- facts-only assertion rejects trade-advice, coaching, grading, P/L, giveback, behavior-score, and similar wording

## Fixture List

Fixture path:

```text
docs/examples/level-analysis-snapshot/level-quality-review-cache-fingerprint/contract-fixtures/
```

Fixtures:

- `cache-fingerprint-single-timeframe.json`
- `cache-fingerprint-multi-timeframe-symbol.json`
- `cache-fingerprint-with-15m-context-only.json`
- `cache-fingerprint-validation-issues.json`
- `cache-fingerprint-missing-optional-fields.json`

The fixtures cover single-source fingerprints, multi-timeframe sets, 15m context-only policy, validation issue counts, and missing optional fields.

## Safety Boundaries

This contract is pure and lightweight.

It does not:

- call providers
- read or write cache files
- collect cache data
- include raw candles
- include raw cache wrappers
- include full snapshots
- import alert, monitoring, Discord, or journal paths
- modify support/resistance generation
- modify LevelEngine scoring, ranking, clustering, or surfaced selection
- modify extension generation
- change runtime defaults
- use volume/session facts for level selection

## Intentionally Not Wired Yet

Fingerprints are not yet included in packaged review output.

The active review baseline was not refreshed in this gate. The old baseline remains historical evidence until a separate refresh gate creates a current-cache baseline with fingerprints.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_cache_fingerprint_wiring
```

Reason: after the contract and fixtures are locked, wire compact cache fingerprints additively into `npm run review:level-quality` without changing existing baseline mismatch counts.
