# Levels System Multi-Timeframe Snapshot Hardening

## Purpose

This gate resumes `levels-system` source-quality work after the journal-side `LevelAnalysisSnapshot` consumer path stabilized.

The goal is to confirm the smallest safe levels-system next step before any new behavior work: keep `LevelAnalysisSnapshot` v1 stable, keep 15m facts context-only, preserve no-lookahead snapshot semantics, and document the current multi-timeframe resume point.

This gate does not change support/resistance detection, LevelEngine scoring, ranking, clustering, surfaced level selection, extension generation, 15m LevelEngine eligibility, cache collection, alerting, monitoring, Discord behavior, or journal app code.

## Evidence Reviewed

Reviewed current levels-system evidence:

- `docs/84_LEVEL_ANALYSIS_SNAPSHOT_V1_HANDOFF_COMPLETE.md`
- `docs/87_LEVEL_ANALYSIS_SNAPSHOT_MULTI_TIMEFRAME_HARDENING.md`
- `docs/92_LEVELS_SYSTEM_15M_FACT_GENERATION_DESIGN.md`
- `docs/93_LEVELS_SYSTEM_15M_FACTS_CONTRACT.md`
- `docs/105_LEVELS_SYSTEM_15M_FACTS_REAL_CACHE_VALIDATION_WITH_SUPPLIED_15M.md`
- `docs/145_LEVEL_QUALITY_REVIEW_VOLUME_SESSION_FACT_COVERAGE_AUDIT.md`
- `docs/146_LEVEL_ANALYSIS_SNAPSHOT_JOURNAL_DELIVERY_CONTRACT.md`
- `docs/147_LEVEL_ANALYSIS_SNAPSHOT_JOURNAL_DELIVERY_HANDOFF.md`
- `src/lib/analysis/level-analysis-snapshot.ts`
- `src/lib/analysis/level-analysis-snapshot-from-candles.ts`
- `src/lib/analysis/level-analysis-timeframe-facts.ts`
- `src/lib/analysis/level-analysis-15m-facts-builder.ts`
- `src/scripts/run-level-analysis-snapshot.ts`
- current 15m and multi-timeframe snapshot tests

Verified external journal resume state:

- TraderLink Intelligence journal PR #54 is merged.
- PR #54 title: `Harden level analysis trade detail CI`.
- Merge commit: `94bc2184a47ac6f8065daf4cd61a2167df52e585`.

Also inspected the existing unmerged levels-system branch:

```text
codex/levels-system-multi-timeframe-snapshot-hardening-v2
```

That branch has no open PR and primarily contains journal trade-context 5m day cache collection/operator-write planning and tooling. It is not imported by this gate because the current task is to resume the existing `LevelAnalysisSnapshot` multi-timeframe source-quality path without expanding cache collection or changing runtime behavior.

## Current Multi-Timeframe Snapshot Status

`LevelAnalysisSnapshot` v1 already reserves and exposes these input summary timeframes:

- `5m`
- `15m`
- `4h`
- `daily`

The current from-candles builder:

- accepts optional `candles15m`;
- filters all supplied candles with candle-close as-of rules;
- includes 15m counts in `inputSummary`;
- builds facts-only `timeframeFacts["15m"]` when 15m input is supplied;
- excludes 15m from `levelEngineSeries`;
- builds LevelEngine support/resistance from daily, 4h, and 5m only;
- keeps 15m outside candidate generation, clustering, scoring, ranking, surfaced selection, and extension generation.

## Current Locked Evidence

The supplied real IBKR 15m validation remains the key 15m source-quality evidence:

- selected symbols: `DEVS`, `ENVX`, `DXYZ`, `QUBT`, `GME`;
- 15m facts valid: `5/5`;
- LevelEngine parity with and without supplied 15m: `5/5`;
- nearest support parity: `5/5`;
- nearest resistance parity: `5/5`;
- quality audit parity: `5/5`;
- provider metadata did not include `15m` as a LevelEngine timeframe.

The latest journal delivery evidence remains stable:

- reviewed symbols: `10`;
- baseline mismatch count: `0`;
- density metric present and valid: `10/10`;
- candidate inventory present and valid: `10/10`;
- candidate volume/session context present and valid: `10/10`;
- session facts present: `10/10`;
- volume facts present: `10/10`;
- volume shelf context present: `10/10`;
- restricted-language hits: `0`.

## Smallest Safe Hardening Gate

The smallest safe gate is docs/artifact/test-only:

1. Lock the post-journal resume point.
2. Record that the unmerged 5m day-cache branch was inspected but not adopted.
3. Add a regression test that verifies:
   - the hardening artifact is valid;
   - 15m remains outside LevelEngine input in source code;
   - the runner remains local/offline and does not import provider, alert, monitoring, Discord, or journal paths;
   - the current delivery evidence still records zero baseline mismatches and context-only 15m fingerprints.

No runtime code changes are justified in this gate because the existing code and tests already enforce the core 15m boundary.

## Why Not Import The Existing V2 Branch

The existing `codex/levels-system-multi-timeframe-snapshot-hardening-v2` branch appears to be useful future work for journal trade-context 5m day cache coverage. It is not the right immediate change for this gate because it:

- adds new cache collection tooling;
- includes operator-write planning;
- changes `package.json`;
- targets 5m trade-context day-cache collection rather than the locked `LevelAnalysisSnapshot` multi-timeframe contract;
- would expand scope before the current resume point is locked.

Future work may reuse that branch after a dedicated design/contract gate reviews its fit against the now-stable journal consumer path.

## Future Hardening Rules

Future multi-timeframe snapshot changes must:

- preserve `LevelAnalysisSnapshot` v1 unless an explicit versioning gate approves a new schema;
- preserve no-lookahead filtering for all timeframes;
- keep 15m context-only unless a separate approved gate changes that;
- prove LevelEngine parity when 15m is present but not eligible;
- include deterministic fixtures before any behavior change;
- include before/after artifacts for real-cache review changes;
- avoid raw candle, raw cache wrapper, full snapshot, provider response, alert, Discord, monitoring, and journal app changes unless explicitly approved.

## Recommended Next Gate

Recommended next gate:

```text
level_analysis_snapshot_multi_timeframe_fixture_pack
```

Reason: before any new behavior work, add a compact deterministic fixture pack for multi-timeframe snapshot edge cases: missing 15m, supplied 15m, future/partial candle filtering, sparse daily/4h, and journal/replay as-of safety. That gives future changes a stable proof surface without touching LevelEngine generation behavior.

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
- add journal-owned interpretation behavior.
