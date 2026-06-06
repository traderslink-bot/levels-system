# Level Quality Review Cache Fingerprint Wiring

## Purpose

This gate wires compact cache fingerprints additively into `npm run review:level-quality`.

The goal is source provenance only: future review artifacts can prove which local cache wrapper files produced them before the active baseline is refreshed to the current local IBKR cache state.

This gate does not refresh the active baseline, tune support/resistance detection, change LevelEngine scoring, ranking, clustering, surfaced selection, or extension generation, feed 15m into LevelEngine, or use volume/session facts for scoring or surfaced selection.

## What Was Wired

Added a read-only fingerprint builder:

```text
src/lib/analysis/level-quality-review-cache-fingerprint-builder.ts
```

Updated the packaged review runner:

```text
src/scripts/run-level-quality-review.ts
```

The runner now emits:

- top-level `cacheFingerprintSet`
- top-level `cacheFingerprintSummary`
- summary counters for fingerprint count, symbol count, LevelEngine-input count, context-only count, 15m context-only count, and validation issue count
- text output lines for the same compact counters

Existing review entries, parity fields, mismatch calculation, candidate inventory output, and volume/session context output remain behavior-compatible.

## Packaged Output Shape

New top-level JSON fields:

```text
cacheFingerprintSet
cacheFingerprintSummary
```

New summary fields:

```text
cacheFingerprintCount
cacheFingerprintSymbolCount
cacheFingerprintLevelEngineInputCount
cacheFingerprintContextOnlyCount
cacheFingerprintFifteenMinuteContextOnlyCount
cacheFingerprintValidationIssueCount
```

The fingerprint set uses the contract from:

```text
docs/141_LEVEL_QUALITY_REVIEW_CACHE_FINGERPRINT_CONTRACT.md
```

## How Fingerprints Are Produced

The runner reads the same local cache wrapper files already used by the review command. It now keeps the raw wrapper text and parsed wrapper metadata long enough to build a compact fingerprint, while the existing candle parsing continues to feed the existing review path.

Each fingerprint includes:

- relative source path
- provider
- symbol
- timeframe
- SHA-256 of the wrapper file text
- wrapper candle count
- request lookback bars
- request end timestamp
- actual bars returned
- validation issue count
- optional first/last candle timestamp
- optional as-of timestamp
- LevelEngine/context-only flags
- safety flags

The fingerprint output does not include raw candle arrays, raw cache wrapper payloads, full snapshots, provider responses, or raw candidate/zone arrays.

## SHA-256 And Source Provenance Policy

The SHA-256 digest is calculated from the local cache wrapper file text that the review runner actually read.

Future baseline refresh artifacts should use these fingerprints to distinguish:

- input drift: cache fingerprints changed
- behavior drift: cache fingerprints match, but level-quality comparison fields changed

This gate does not compare fingerprints against historical baselines yet. It only emits them and validates the compact shape.

## 15m Context-Only Policy

15m cache wrappers may be fingerprinted as source context.

Every 15m fingerprint must have:

```text
contextOnly: true
includedInLevelEngine: false
safety.fifteenMinuteFedIntoLevelEngine: false
```

The review runner still does not feed 15m into LevelEngine/support-resistance generation.

## Baseline Comparison Policy

Fingerprint fields are additive source provenance.

Current mismatch counts continue to compare the existing level-quality fields only:

- nearest support/resistance
- bucket counts
- extension counts
- synthetic continuation-map count and marking
- diagnostics and diagnostic semantics
- enrichment breakdown
- extension coverage warnings
- clustered/density diagnostics
- 15m context-only status

Fingerprint-only differences are not counted as level-quality drift in this gate.

## Real Review Run

The packaged review command was run against the current local IBKR cache root using the latest committed volume/session review artifact as the baseline input:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-cache-fingerprint-wiring/latest-level-quality-review-cache-fingerprint-wiring.json --out-text artifacts/level-quality-review-cache-fingerprint-wiring/latest-level-quality-review-cache-fingerprint-wiring.txt --generated-at 2026-06-06T12:00:00.000Z
```

Observed result:

- reviewed symbols: `10`
- cache fingerprints: `35`
- fingerprinted symbols: `10`
- LevelEngine-input fingerprints: `30`
- context-only fingerprints: `5`
- 15m context-only fingerprints: `5`
- cache fingerprint validation issue count: `45`
- prohibited-language hits: `0`

The run reported `mismatchCount: 4` against the historical volume/session review artifact:

- `DEVS`: `enrichmentBreakdown`
- `AIM`: `bucketCounts`, `enrichmentBreakdown`
- `YMAT`: `enrichmentBreakdown`

This was not treated as a fingerprint wiring bug. The active baseline is intentionally not refreshed in this gate, and current-cache drift is the reason the next refresh gate must create a fingerprinted current-cache baseline.

## Safety Boundaries

This gate did not:

- refresh the active baseline
- collect cache data
- write cache files
- commit raw cache files
- include raw candles in committed artifacts
- include raw cache wrappers in committed artifacts
- include full snapshots in committed artifacts
- call providers
- change support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts for scoring or surfaced selection
- change runtime defaults
- change alert, monitoring, or Discord behavior
- touch journal app files
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice

## Validation Commands

Required validation run:

```text
npm ci
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-cache-fingerprint-contract.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-cache-fingerprint-wiring.test.ts
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-cache-fingerprint-wiring/latest-level-quality-review-cache-fingerprint-wiring.json --out-text artifacts/level-quality-review-cache-fingerprint-wiring/latest-level-quality-review-cache-fingerprint-wiring.txt --generated-at 2026-06-06T12:00:00.000Z
npx tsc --noEmit
npm test
git diff --check
```

## Intentionally Not Refreshed Yet

The active review baseline was not refreshed.

The old baseline remains historical evidence. The current-cache baseline should be refreshed only in a separate gate after fingerprint wiring is merged.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_baseline_refresh_current_cache
```

Reason: this is the refresh gate name already established in `docs/140_LEVEL_QUALITY_REVIEW_BASELINE_REFRESH_DECISION.md`. The prompt phrasing `level_quality_review_cache_fingerprint_baseline_refresh` describes the same intended step, but the locked docs already named the next refresh gate `level_quality_review_baseline_refresh_current_cache`.
