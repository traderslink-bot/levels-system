# LevelAnalysisSnapshot Multi-Timeframe Fixture Pack

## Purpose

This gate adds a compact deterministic fixture pack for the current `LevelAnalysisSnapshot` multi-timeframe contract.

The fixtures lock edge cases that matter before any future source-quality or behavior work:

- missing optional 15m input;
- supplied limited 15m facts;
- supplied available 15m facts;
- future and still-forming candle filtering for journal/replay as-of safety;
- sparse daily/4h higher-timeframe context.

This gate is fixture/test/documentation only. It does not change support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced level selection, extension generation, 15m LevelEngine eligibility, cache collection, alerting, monitoring, Discord behavior, or journal app code.

## Evidence Source

Reviewed:

- `docs/148_LEVELS_SYSTEM_MULTI_TIMEFRAME_SNAPSHOT_HARDENING.md`
- `docs/87_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_HARDENING.md`
- `docs/93_LEVELS_SYSTEM_15M_FACTS_CONTRACT.md`
- `docs/105_LEVELS_SYSTEM_15M_FACTS_REAL_CACHE_VALIDATION_WITH_SUPPLIED_15M.md`
- `src/lib/analysis/level-analysis-snapshot.ts`
- `src/lib/analysis/level-analysis-snapshot-from-candles.ts`
- `src/lib/analysis/level-analysis-timeframe-facts.ts`
- `src/lib/analysis/level-analysis-15m-facts-builder.ts`
- `src/tests/level-analysis-snapshot-multi-timeframe-hardening.test.ts`

## Fixture Shape

Each fixture is compact and expected-output focused. Fixtures do not include raw candles, raw cache wrappers, full snapshots, raw candidate arrays, provider responses, or journal app payloads.

Each fixture includes:

- `schemaVersion`
- `fixtureName`
- `purpose`
- `inputSummary`
- `expected`
- `safety`

The test suite rebuilds deterministic candle scenarios from inline test fixtures and verifies the expected compact summaries.

## Fixture List

| Fixture | Purpose |
| --- | --- |
| `snapshot-mtf-missing-15m.json` | Locks absent optional 15m behavior and stable reserved timeframe keys. |
| `snapshot-mtf-supplied-15m-limited.json` | Locks supplied limited 15m facts while proving LevelEngine parity with no-15m input. |
| `snapshot-mtf-supplied-15m-available.json` | Locks supplied available 15m facts while proving LevelEngine parity with no-15m input. |
| `snapshot-mtf-journal-replay-asof-filtering.json` | Locks future/partial candle filtering across 5m, 15m, 4h, and daily inputs. |
| `snapshot-mtf-sparse-higher-timeframes.json` | Locks sparse daily/4h diagnostics and LevelEngine metadata flags. |

## Current Locked Behavior

The fixture pack confirms:

- `LevelAnalysisSnapshot` remains `level-analysis-snapshot/v1`;
- input summary always reserves `5m`, `15m`, `4h`, and `daily`;
- supplied 15m input can populate `timeframeFacts["15m"]`;
- missing 15m does not create `timeframeFacts`;
- supplied 15m remains outside `levelEngineOutput.metadata.providerByTimeframe`;
- supplied 15m does not change LevelEngine output compared with equivalent no-15m input;
- future and still-forming candles are excluded before facts or LevelEngine output are built;
- sparse daily/4h inputs are reported as factual diagnostics, not inferred levels.

## Safety Boundaries

The fixture pack verifies:

- no support/resistance detection behavior changed;
- no LevelEngine scoring/ranking/clustering changed;
- no surfaced support/resistance levels changed;
- no extension generation changed;
- 15m was not fed into LevelEngine;
- no volume/session facts were used to change scoring or surfaced selection;
- no cache files were collected or written;
- no raw cache files were committed;
- no journal app files were changed;
- no restricted interpretation behavior was added.

## Limitations

This fixture pack is deterministic and local. It does not rerun the 10-symbol IBKR review and does not add new cache data. Real-cache parity remains owned by the existing packaged review and baseline artifacts.

## Recommended Next Gate

Recommended next gate:

```text
level_analysis_snapshot_multi_timeframe_fixture_pack_handoff
```

Reason: the fixture pack is now available as a compact proof surface. A short handoff should tell future levels-system sessions which fixtures exist, what each scenario proves, and what must be compared before future multi-timeframe changes.

## Hard Boundaries

This gate did not:

- tune support/resistance detection;
- change LevelEngine scoring, ranking, clustering, or surfaced selection;
- change extension generation;
- feed 15m into LevelEngine;
- collect or write cache files;
- commit raw cache files;
- modify journal app code;
- add journal-owned interpretation behavior.
