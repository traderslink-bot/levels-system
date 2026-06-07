# LevelAnalysisSnapshot Multi-Timeframe Fixture Pack Handoff

## Purpose

This gate hands off the compact deterministic fixture pack added for the `LevelAnalysisSnapshot` multi-timeframe contract.

The handoff tells future `levels-system` and journal-side work what is covered, what is locked, and what remains intentionally outside `LevelEngine` generation. It is docs/artifacts only and does not tune support/resistance behavior.

## Current Locked State

- `LevelAnalysisSnapshot` remains locked at `level-analysis-snapshot/v1`.
- The source snapshot contract reserves `5m`, `15m`, `4h`, and `daily` in `inputSummary`.
- Optional `candles15m` input remains supported.
- Supplied 15m input may build `timeframeFacts["15m"]`.
- Missing 15m input does not build a 15m `timeframeFacts` payload.
- Candle-close as-of filtering remains required before facts or level output are built.
- `LevelEngine` input remains daily, 4h, and 5m only.
- 15m remains facts-only and outside support/resistance generation.
- Volume/session context remains facts-only and outside scoring or surfaced level selection.

## Evidence Reviewed

- `docs/148_LEVELS_SYSTEM_MULTI_TIMEFRAME_SNAPSHOT_HARDENING.md`
- `docs/149_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_FIXTURE_PACK.md`
- `docs/examples/level-analysis-snapshot/multi-timeframe-snapshot-hardening/latest-levels-system-multi-timeframe-snapshot-hardening.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/latest-level-analysis-snapshot-multi-timeframe-fixture-pack.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/snapshot-mtf-missing-15m.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/snapshot-mtf-supplied-15m-limited.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/snapshot-mtf-supplied-15m-available.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/snapshot-mtf-journal-replay-asof-filtering.json`
- `docs/examples/level-analysis-snapshot/multi-timeframe-fixture-pack/fixtures/snapshot-mtf-sparse-higher-timeframes.json`
- `src/tests/levels-system-multi-timeframe-snapshot-hardening.test.ts`
- `src/tests/level-analysis-snapshot-multi-timeframe-fixture-pack.test.ts`

## Fixture Scenarios Covered

| Fixture | Coverage |
| --- | --- |
| `snapshot-mtf-missing-15m` | Optional 15m absent; reserved timeframe behavior remains stable; no 15m facts payload is created. |
| `snapshot-mtf-supplied-15m-limited` | Supplied but limited 15m facts are built; LevelEngine output and nearest levels match the missing-15m scenario. |
| `snapshot-mtf-supplied-15m-available` | Supplied available 15m range, trend, volume, and structure facts are built; LevelEngine output and nearest levels match the missing-15m scenario. |
| `snapshot-mtf-journal-replay-asof-filtering` | Future and still-forming candles are filtered across 5m, 15m, 4h, and daily before facts or LevelEngine output are produced. |
| `snapshot-mtf-sparse-higher-timeframes` | Missing daily/4h inputs are reported as factual diagnostics while 5m context remains available. |

## What The Fixtures Prove

- The fixture pack has five compact deterministic scenarios.
- The fixtures include expected summaries only, not raw candles, raw cache wrappers, provider responses, full snapshots, or journal payloads.
- 15m can be present in `inputSummary` and 15m facts without appearing in `levelEngineOutput.metadata.providerByTimeframe`.
- Supplied 15m input preserves LevelEngine parity against the equivalent missing-15m input.
- Supplied 15m input preserves nearest support and nearest resistance parity against the equivalent missing-15m input.
- Replay/as-of filtering removes future and still-forming candles before facts or LevelEngine generation.
- Sparse higher-timeframe data produces factual diagnostics and metadata flags rather than inferred higher-timeframe levels.

## Journal And Replay Safety Summary

The fixture pack gives journal-side consumers a stable replay proof surface:

- snapshot as-of semantics are candle-close based;
- future candles are excluded;
- still-forming candles are excluded;
- fixture artifacts are compact and replayable from deterministic test inputs;
- no journal app files or journal-owned interpretation behavior changed.

This protects downstream ingestion, persistence, and display work from accidentally relying on lookahead data or raw provider payloads.

## 15m Facts-Only Boundary

15m remains a context-only timeframe:

- it is optional input;
- it can populate 15m facts when supplied;
- it can report availability, range, trend, volume, structure, and diagnostics;
- it is excluded from LevelEngine candidate generation;
- it is excluded from clustering, scoring, ranking, surfaced support/resistance selection, and extension generation;
- it must not be promoted into generation without a separate approved gate.

## LevelEngine Boundary

The fixture pack does not approve LevelEngine behavior changes.

Future work must not use this handoff as approval to change:

- support/resistance detection;
- raw candidate generation;
- clustering;
- scoring;
- ranking;
- surfaced support/resistance selection;
- extension generation;
- runtime defaults;
- alert, monitoring, or Discord behavior.

Any proposed LevelEngine generation change needs its own decision gate with before/after evidence.

## Known Limitations

- The fixture pack is deterministic and local.
- It does not rerun the 10-symbol IBKR review.
- It does not collect or write cache data.
- It does not add raw candle, cache, provider, or full snapshot artifacts.
- It does not validate journal app rendering directly.
- It does not decide whether old level-quality review baselines should be refreshed.

## Future Use Rules

Future multi-timeframe snapshot work should:

- compare against this fixture pack before changing snapshot assembly;
- preserve `LevelAnalysisSnapshot` v1 unless a versioning gate approves a schema change;
- preserve candle-close no-lookahead filtering for all timeframes;
- keep 15m facts-only unless a separate approved gate changes eligibility;
- prove LevelEngine parity whenever 15m is supplied but not eligible;
- keep volume/session facts outside scoring and surfaced level selection;
- avoid raw candles, cache files, provider responses, full snapshots, alert payloads, Discord payloads, and journal app changes unless explicitly approved.

## Recommended Next Gate

Recommended next gate:

```text
level_quality_review_baseline_refresh_decision
```

Reason: a prior review found AIM baseline/input drift before the volume-session baseline lock. After this multi-timeframe fixture handoff, the next useful `levels-system` gate is deciding whether to refresh the review baseline to the current local IBKR cache state or preserve the old baseline as a different input set.

## Hard Boundaries

This gate did not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or surfaced selection;
- change surfaced support/resistance levels;
- change extension generation;
- feed 15m into LevelEngine;
- use volume/session facts to change scoring or surfaced selection;
- collect cache data;
- write cache files;
- commit raw cache files;
- change runtime defaults;
- change alert, monitoring, Discord, or journal app behavior;
- add journal grading, coaching, P/L, giveback, behavior scoring, recommendations, or trade advice.
