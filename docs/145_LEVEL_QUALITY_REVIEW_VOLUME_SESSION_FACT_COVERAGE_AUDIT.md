# Level Quality Review Volume Session Fact Coverage Audit

## Purpose

This gate audits the facts-only volume/session context now present in packaged level quality review output.

The goal is to understand current coverage and missing-fact patterns before using these facts for downstream journal delivery or future review work. This is audit-only and does not change support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced selection, extension generation, 15m LevelEngine eligibility, or volume/session influence on level selection.

## Evidence Source

Reviewed:

- `docs/144_LEVEL_QUALITY_REVIEW_POST_REFRESH_STABILITY_CHECK.md`
- `docs/143_LEVEL_QUALITY_REVIEW_BASELINE_REFRESH_CURRENT_CACHE.md`
- `docs/138_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_REVIEW_WIRING.md`
- `docs/137_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_BUILDER.md`
- `docs/136_LEVEL_QUALITY_CANDIDATE_INVENTORY_VOLUME_SESSION_CONTEXT_CONTRACT.md`
- `docs/79_JOURNAL_CONNECTOR_LEVEL_ANALYSIS_CONTRACT.md`
- refreshed active baseline:
  `docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json`
- post-refresh stability artifact:
  `docs/examples/level-analysis-snapshot/level-quality-review-post-refresh-stability-check/latest-level-quality-review-post-refresh-stability-check.json`

The packaged review was run once against the refreshed active baseline:

```text
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-volume-session-fact-coverage-audit/latest-review.json --out-text artifacts/level-quality-review-volume-session-fact-coverage-audit/latest-review.txt --generated-at 2026-06-06T15:00:00.000Z
```

The run produced `mismatchCount: 0`.

## Reviewed Symbols

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

Supplied 15m symbols stayed context-only:

- `DEVS`
- `ENVX`
- `DXYZ`
- `QUBT`
- `GME`

## Root Coverage Summary

The packaged review reported:

- candidate volume/session context present: `10/10`
- candidate volume/session context valid: `10/10`
- candidate volume/session context missing: `0/10`
- session facts present: `10/10`
- volume facts present: `10/10`
- volume shelf context present: `10/10`
- candidate volume/session missing-facts count: `0`
- prohibited-language hits: `0`

Existing baseline fields remained stable:

- nearest support/resistance parity: `10/10`
- bucket count parity: `10/10`
- extension count parity: `10/10`
- synthetic count and marking parity: `10/10`
- diagnostics and diagnostic semantics parity: `10/10`
- enrichment breakdown parity: `10/10`
- density metric present: `10/10`
- candidate inventory present and valid: `10/10`
- cache fingerprint counts stable: `35` total, `30` LevelEngine-input, `5` 15m context-only

## Row Coverage Summary

Across all reviewed symbols, the audit found `43` compact volume/session context rows:

| Stage | Count |
| --- | ---: |
| `surfaced` | `20` |
| `extension_selected` | `17` |
| `scored` | `6` |

| Side | Count |
| --- | ---: |
| `support` | `25` |
| `resistance` | `18` |

Every row carried volume facts and at least one compact session fact proximity row:

- rows with session facts: `43/43`
- session fact proximity rows: `48`
- rows with volume facts: `43/43`
- rows with shelf overlap: `15/43`
- shelf overlaps: `26`
- rows with no nearby volume shelf: `28/43`

## Session Fact Coverage

Session fact proximity counts:

| Fact | Count |
| --- | ---: |
| `previous_close` | `22` |
| `opening_range_high` | `6` |
| `vwap` | `5` |
| `opening_range_low` | `4` |
| `low_of_day` | `4` |
| `regular_session_open` | `2` |
| `high_of_day` | `2` |
| `premarket_high` | `2` |
| `premarket_low` | `1` |

Session relation counts:

| Relation | Count |
| --- | ---: |
| `outside_threshold` | `27` |
| `overlaps` | `13` |
| `near` | `8` |

Interpretation for future review:

- The context is present, but many session facts are outside the configured near/overlap thresholds.
- `AIM` had the cleanest nearby session/shelf coverage in this audit.
- `HCWB`, `YMAT`, and `PHOE` had no shelf-overlap rows in the compact context rows.

## Volume And Shelf Coverage

Volume facts were present for every compact context row.

Volume state by symbol:

- `elevated`: `DEVS`, `ENVX`
- `normal`: `DXYZ`, `YMAT`, `AAOI`, `PHOE`
- `low`: `QUBT`, `GME`, `AIM`, `HCWB`

Liquidity quality by symbol:

- `strong`: `ENVX`, `DXYZ`, `QUBT`, `GME`, `HCWB`, `YMAT`, `AAOI`
- `good`: `DEVS`, `AIM`
- `acceptable`: `PHOE`

Shelf overlap was uneven:

- rows with shelf overlap: `15/43`
- rows without nearby shelf: `28/43`
- no shelf-overlap rows: `HCWB`, `YMAT`, `PHOE`

This is useful downstream context, but it is not a generation issue by itself. Shelves remain fact-only and are not support/resistance levels.

## Diagnostics And Limitation Summary

Root diagnostic counts:

| Diagnostic | Symbol Count |
| --- | ---: |
| `no_nearby_volume_shelf` | `10` |
| `no_nearby_session_fact` | `9` |
| `no_nearby_session_volume_context` | `9` |
| `surfaced_session_volume_context_present` | `9` |
| `no_regular_session_candles` | `5` |
| `candidate_id_unavailable` | `5` |
| `surfaced_selection_reason_not_serialized` | `5` |
| `no_closed_session_candles` | `4` |
| `no_premarket_candles` | `4` |
| `vwap_unavailable` | `4` |
| `candidate_identifier_unavailable` | `4` |
| `surfaced_vwap_shelf_overlap_context_present` | `2` |

Comparison outcomes:

- `surfaced_has_more_session_volume_context`: `6`
- `candidate_identifier_unavailable`: `4`

The `candidate_identifier_unavailable` outcome occurred on:

- `QUBT`
- `HCWB`
- `AAOI`
- `PHOE`

The audit did not find a deterministic production bug. The main limitations are visibility and input-fact coverage:

- unsurfaced scored rows still lack stable candidate identifiers in some comparisons
- surfaced selection reasons are not serialized
- several symbols have no regular-session or premarket candle facts in the compact session context
- shelf overlap is absent for several compact row sets

## Per-Symbol Summary

| Symbol | Rows | Outcome | Shelf Overlap Rows | No Nearby Shelf Rows | Session Fact Rows | Volume State |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| `DEVS` | `3` | `surfaced_has_more_session_volume_context` | `2` | `1` | `3` | `elevated` |
| `ENVX` | `4` | `surfaced_has_more_session_volume_context` | `3` | `1` | `4` | `elevated` |
| `DXYZ` | `4` | `surfaced_has_more_session_volume_context` | `2` | `2` | `4` | `normal` |
| `QUBT` | `5` | `candidate_identifier_unavailable` | `1` | `4` | `5` | `low` |
| `GME` | `4` | `surfaced_has_more_session_volume_context` | `2` | `2` | `4` | `low` |
| `AIM` | `3` | `surfaced_has_more_session_volume_context` | `2` | `1` | `3` | `low` |
| `HCWB` | `4` | `candidate_identifier_unavailable` | `0` | `4` | `4` | `low` |
| `YMAT` | `5` | `surfaced_has_more_session_volume_context` | `0` | `5` | `5` | `normal` |
| `AAOI` | `6` | `candidate_identifier_unavailable` | `3` | `3` | `6` | `normal` |
| `PHOE` | `5` | `candidate_identifier_unavailable` | `0` | `5` | `5` | `normal` |

## Journal Integration Relevance

The audit confirms the levels-system side now has enough facts-only coverage to support a downstream journal delivery contract:

- stable support/resistance baseline
- stable cache fingerprints
- stable density metrics
- stable candidate inventory visibility
- volume/session context present and valid for all 10 reviewed symbols
- explicit missing/limited-fact diagnostics

The journal app should consume this as factual chart context. It should not depend on LevelEngine internals, mutate surfaced levels, or treat any diagnostic as user-specific execution interpretation.

## Safety Boundaries

This gate did not:

- refresh the active baseline
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
npm run review:level-quality -- --cache-root C:/Users/jerac/Documents/TraderLink/levels-system/.validation-cache/candles --provider ibkr --baseline docs/examples/level-analysis-snapshot/level-candidate-inventory-visibility/volume-session-context/latest-level-candidate-inventory-volume-session-context-review-wiring.json --out-json artifacts/level-quality-review-volume-session-fact-coverage-audit/latest-review.json --out-text artifacts/level-quality-review-volume-session-fact-coverage-audit/latest-review.txt --generated-at 2026-06-06T15:00:00.000Z
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-volume-session-fact-coverage-audit.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-candidate-volume-session-context-review-wiring.test.ts
npx tsx --test --test-timeout=90000 src/tests/level-quality-review-post-refresh-stability-check.test.ts
npx tsc --noEmit
npm test
git diff --check
```

## Recommended Next Gate

Recommended next gate:

```text
level_analysis_snapshot_journal_delivery_contract
```

Reason: the refreshed level-quality baseline is stable, and volume/session fact coverage is now audited. The next useful levels-system step is to define the exact factual delivery contract the TraderLink Intelligence journal should consume, without implementing the journal app or changing LevelEngine behavior.
