# LevelAnalysisSnapshot Journal Delivery Handoff

## Purpose

This handoff tells future sessions and the TraderLink Intelligence journal app Codex exactly how to consume the current levels-system delivery package.

The handoff is documentation and fixture packaging only. It does not implement journal app ingestion, does not modify journal app files, and does not change support/resistance generation behavior.

## Current Status

The levels-system side is ready to hand off a facts-only chart context package to the journal app:

- `LevelAnalysisSnapshot` v1 is locked and still available as a compact parser fixture.
- The packaged review output is the current delivery package for professional chart-reading context.
- The current delivery package includes cache fingerprints, density metric, candidate inventory visibility, and candidate volume/session context.
- The latest volume/session fact coverage audit confirmed candidate volume/session context is present and valid for all ten reviewed symbols.
- Existing baseline mismatch count remains `0`.
- 15m facts remain context-only and outside LevelEngine generation.
- For future live journal trade-context candle requests, the producer-side 5m
  request policy is now day-scoped: fetch/cache the full extended-session 5m
  day for the symbol, then rely on snapshot candle-close filtering for the
  requested trade/as-of timestamp.
- The first producer-side collection wrapper for that policy is now available
  as `npm run cache:collect:journal-5m-day`.
- The first operator dry-run for that wrapper is complete. It planned five
  IBKR 5m day-cache files from six trade-context requests, deduped same-symbol
  same-day DEVS requests, and confirmed the real validation cache was not
  mutated.
- The IBKR write-disabled preflight is complete. `--write --provider ibkr`
  failed closed when `LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true` was absent,
  and the temp cache root remained uncreated.
- The IBKR operator write plan is complete. It documents the exact write
  command, target trade contexts, expected 5m day-cache paths, post-write
  wrapper checks, and rollback rules without running live write mode.
- Optional future 1m execution replay is documented separately as a narrow
  execution-window policy. It does not replace the 5m day cache and is not live
  provider-capable yet.

## Start Here For Journal App Codex

Primary artifact to consume:

```text
docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json
```

Use this as the initial fixture/source package for journal-side ingestion work.

Small parser fixture:

```text
docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json
```

Use this smaller fixture for base `LevelAnalysisSnapshot` v1 parser tests.

Delivery contract:

```text
docs/146_LEVEL_ANALYSIS_SNAPSHOT_JOURNAL_DELIVERY_CONTRACT.md
```

Use this to understand the current source package shape and the fields the journal connector should validate.

## Current Delivery Package

The current delivery package is the refreshed IBKR ten-symbol review artifact. It includes:

- `schemaVersion`
- `generatedAt`
- `provider`
- `reviewedSymbols`
- `supplied15mSymbols`
- `summary`
- `cacheFingerprintSet`
- `cacheFingerprintSummary`
- `entries`
- `prohibitedLanguageHits`
- `safety`

Each entry includes:

- identity fields
- source file paths
- nearest support/resistance context
- bucket counts
- extension coverage
- synthetic continuation-map summary
- quality audit and diagnostic semantics
- 15m context-only status
- density metric
- candidate inventory visibility
- candidate volume/session context
- parity and mismatch fields

## Stable Fields To Consume First

For first journal ingestion, prefer:

- `schemaVersion`
- `provider`
- `reviewedSymbols`
- `summary`
- `cacheFingerprintSummary`
- `cacheFingerprintSet`
- `entries[].symbol`
- `entries[].asOfTimestamp`
- `entries[].asOfIso`
- `entries[].referencePrice`
- `entries[].nearestLevels`
- `entries[].bucketCounts`
- `entries[].extensionCoverage`
- `entries[].syntheticContinuationMap`
- `entries[].qualityAudit`
- `entries[].diagnosticSemantics`
- `entries[].fifteenMinuteContext`
- `entries[].candidateInventoryVisibility`
- `entries[].candidateVolumeSessionContext`
- `entries[].safety`
- `entries[].mismatches`

Treat the old compact `LevelAnalysisSnapshot` fixture as a base-schema compatibility fixture, not as the full current delivery package.

## Future Trade-Context Candle Request Policy

Use this producer-side policy before adding any new live journal candle
collection wrapper:

```text
docs/148_LEVEL_ANALYSIS_JOURNAL_TRADE_CONTEXT_5M_DAY_POLICY.md
```

The policy defines `buildJournalTradeContextFiveMinuteDayPolicy(...)`, which
normalizes a journal trade-context request to one reusable 5m extended-session
day per symbol/date. This is an IBKR/cache efficiency policy only. Snapshot
generation must still filter the supplied candles by candle close as of the
specific trade timestamp.

Do not make the journal app consume later same-day candles just because they
exist in the cache.

The implemented collection wrapper is documented here:

```text
docs/149_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_COLLECTION.md
```

Use it first in dry-run mode. Write mode requires explicit provider
configuration, and IBKR writes require
`LEVEL_JOURNAL_5M_DAY_CACHE_ENABLE_IBKR=true`.

Completed dry-run evidence:

```text
docs/151_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_DRY_RUN.md
```

Completed write-disabled preflight evidence:

```text
docs/152_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_WRITE_DISABLED_PREFLIGHT.md
```

Completed IBKR operator write plan:

```text
docs/153_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_5M_DAY_CACHE_IBKR_OPERATOR_WRITE_PLAN.md
```

Optional future 1m execution replay policy:

```text
docs/150_LEVELS_SYSTEM_JOURNAL_TRADE_CONTEXT_1M_EXECUTION_WINDOW_POLICY.md
```

Treat `1m` as optional execution detail only. Do not use it as the primary
trade-context timeframe and do not add live 1m fetching without a separate
collection gate.

## Validation Checklist For Journal App Codex

The journal-side ingestion should validate:

- JSON parses successfully.
- `provider` is `ibkr`.
- all ten reviewed symbols are present.
- `summary.mismatchCount` is `0`.
- cache fingerprint set validates.
- 15m cache fingerprints are context-only.
- per-symbol `fifteenMinuteContext.stillContextOnly` is true.
- density metric is present and valid.
- candidate inventory wrapper is present and valid.
- candidate volume/session context is present and valid.
- safety flags confirm no provider calls or cache writes are part of review output.
- prohibited-language hit count is `0`.
- raw candles, full snapshots, raw cache wrapper payloads, and provider responses are not required by the journal connector.

## Limitations To Surface

The journal app should surface, log, or preserve these limitations:

- candidate identifiers are unavailable for some unsurfaced scored comparison rows
- surfaced selection reasons are not serialized
- some compact context row sets have no nearby volume shelf
- some symbols have limited regular-session or premarket candle facts in compact context
- cache fingerprint validation issues are source-integrity facts, not generation changes

Do not hide these limitations. They are useful context for a professional chart-reading system.

## Ownership Boundary

Levels-system owns:

- source artifact generation
- support/resistance map output
- density metric output
- candidate inventory visibility output
- candidate volume/session context output
- cache fingerprint output
- facts-only safety flags

Journal app owns:

- loading artifacts from storage or API routes
- persistence
- UI presentation
- linking chart context to journal records
- source-artifact preservation
- quarantine handling for malformed payloads
- user workflow and product-specific interpretation

The journal app should integrate through the delivery artifact and contract, not through private LevelEngine internals.

## Hard Boundaries

Do not use this handoff to:

- tune support/resistance detection
- change LevelEngine scoring, ranking, clustering, or surfaced selection
- change extension generation
- feed 15m into LevelEngine
- use volume/session facts to change scoring or surfaced selection
- collect new cache data
- write new cache files
- change runtime defaults
- change alert, monitoring, or Discord behavior
- modify journal app files from the levels-system repo
- add journal-owned interpretation behavior to levels-system

## Suggested Journal-Side First Step

The first journal-side implementation should be an ingestion contract gate:

```text
journal_level_analysis_delivery_ingestion
```

Suggested scope:

- copy or reference the current delivery artifact as a test fixture in the journal app
- define a journal-side validator for the delivery package
- preserve the raw source payload
- derive a compact chart-context view
- surface limitations
- quarantine malformed payloads
- keep user/product interpretation outside the levels-system connector boundary

## Artifact Map

Handoff artifacts:

- `docs/examples/level-analysis-snapshot/journal-delivery-handoff/latest-level-analysis-snapshot-journal-delivery-handoff.json`
- `docs/examples/level-analysis-snapshot/journal-delivery-handoff/latest-level-analysis-snapshot-journal-delivery-handoff.txt`

Source artifacts:

- `docs/examples/level-analysis-snapshot/journal-delivery-contract/latest-level-analysis-snapshot-journal-delivery-contract.json`
- `docs/examples/level-analysis-snapshot/journal-connector-contract/journal-connector-level-analysis-snapshot-v1.json`
- `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- `docs/examples/level-analysis-snapshot/level-quality-review-volume-session-fact-coverage-audit/latest-level-quality-review-volume-session-fact-coverage-audit.json`

## Recommended Next Step

Recommended next step:

```text
journal_level_analysis_delivery_ingestion
```

Reason: the levels-system delivery contract and handoff are now defined. The next work should happen in the TraderLink Intelligence journal app: build the ingestion validator and source-preserving adapter against this facts-only delivery package.
