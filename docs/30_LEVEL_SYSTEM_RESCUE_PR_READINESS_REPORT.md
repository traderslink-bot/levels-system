# Level System Rescue PR Readiness Report

Branch: `codex/runtime-compare-tooling`

Date: 2026-05-27

## Summary

The rescue branch is ready for PR review with the level-system rescue gates completed and validated. The broad suite is still red only on the known unrelated Discord REST snapshot expectations listed below.

`runtimeMode` remains `old` by default. Old/default runtime output behavior is preserved. `enrichedAnalysis` is shadow metadata only: it is additive, optional, and does not affect bucket membership, nearest levels, extension levels, special levels, alerts, monitoring, trader-context behavior, `strengthScore`, or `strengthLabel`.

## Completed Gates

1. Run 1 audit: `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md` reconciles the rescue plan with repository findings, including partial-candle leakage, VWAP trader-context boundaries, formal structure `asOfTimestamp` filtering, shared support/resistance gaps, and runtime coverage mismatch.
2. Run 2 directive: `docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md` defines the consolidation path, keeps `FinalLevelZone` as runtime transport, preserves old/new/compare runtime modes, requires no-lookahead gates before journal/replay enrichment, and avoids a third engine.
3. No-lookahead gate: candle-close/as-of filtering is shared and tested for 5m, 4h, and daily candles. Journal/replay-facing support/resistance context and formal market structure now exclude future or still-forming candles as of the requested timestamp.
4. Runtime parity scaffolding and diagnostics: old, new, and compare modes expose `LevelEngineOutput`-compatible shapes, compare active paths are tested, and old/new gaps were made visible before remediation.
5. Extension ladder parity: projected new runtime output reuses the restored legacy extension ladder behavior. The current fixture has 5 total extensions: 3 support and 2 resistance.
6. Bucket and nearest-level parity: projected runtime transport preserves old bucket membership and nearest levels while richer selection remains analysis metadata. The current fixture remains major/intermediate/intraday = 12/2/1 with nearest support 4.5284 and nearest resistance 4.6957 around reference price 4.6136.
7. Additive enriched analysis: safely matched runtime zones receive optional richer scoring metadata. Synthetic extension zones without safe ranked matches remain valid and unenriched.

## Files Changed By Category

Documentation:
- `docs/27_LEVEL_SYSTEM_AUDIT_FINDINGS.md`
- `docs/28_LEVEL_SYSTEM_PIPELINE_CONSOLIDATION_DIRECTIVE.md`
- `docs/29_LEVEL_RUNTIME_PARITY_GAP_REMEDIATION_PLAN.md`
- `docs/30_LEVEL_SYSTEM_RESCUE_PR_READINESS_REPORT.md`

No-lookahead runtime, support/resistance, and structure:
- `src/lib/market-data/candle-as-of-filter.ts`
- `src/lib/structure/candle-market-structure.ts`
- `src/lib/structure/formal-market-structure.ts`
- `src/lib/support-resistance/build-support-resistance-context.ts`
- `src/lib/support-resistance/index.ts`
- `src/lib/support-resistance/single-timeframe-context.ts`
- `src/lib/support-resistance/symbol-context.ts`
- `src/lib/support-resistance/trade-analysis-context.ts`

Runtime compare, parity, and additive enrichment:
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-types.ts`

Tests:
- `src/tests/candle-as-of-filter.test.ts`
- `src/tests/formal-market-structure.test.ts`
- `src/tests/support-resistance-shared-api.test.ts`
- `src/tests/level-runtime-mode.test.ts`

## Validation Commands And Results

- `npx tsc --noEmit`: passed.
- `npx tsx --test --test-timeout=90000 src/tests/level-runtime-mode.test.ts`: passed, 25/25 tests.
- `npx tsx --test --test-timeout=90000 src/tests/candle-as-of-filter.test.ts src/tests/formal-market-structure.test.ts src/tests/candle-market-structure.test.ts src/tests/support-resistance-shared-api.test.ts`: passed, 47/47 tests.
- `npm test`: failed only on the known unrelated Discord REST snapshot tests. Overall result was 865/867 tests passing.

## Known Unrelated npm Test Failures

The remaining broad-suite failures are snapshot expectation drift in Discord REST posting tests, unrelated to the level-system rescue gates:

- `DiscordRestThreadGateway posts deterministic level snapshots into the target thread`
- `DiscordRestThreadGateway keeps VWAP and EMA out of crowded level snapshots before posting`

## Merge Readiness Checks

- No-lookahead candle-close safety is implemented and tested.
- Formal market structure `asOfTimestamp` filtering is implemented and tested.
- Runtime old/new/compare modes still work and remain shape-compatible.
- `runtimeMode` `old` remains the default.
- Extension parity is restored for the current fixture.
- Bucket and nearest-level parity is restored for the current fixture.
- Special-level parity is preserved.
- Legacy `strengthScore` and `strengthLabel` are preserved.
- `enrichedAnalysis` is additive only and absent from old/default outputs.
- Synthetic extension zones safely remain unenriched when no ranked match exists.
- `LevelStore` and JSON output compatibility are covered.
- Unrelated dirty files remain unstaged.
- Known Discord REST snapshot failures are documented as unrelated.

## Remaining Risks

- The broad `npm test` command remains red until the unrelated Discord REST snapshots are intentionally updated or the underlying output change is separately addressed.
- The projected new path is still intentionally opt-in/observational. It should not become default until downstream alert, monitoring, trader-context, persistence, and performance gates pass.
- `enrichedAnalysis` coverage is intentionally partial where safe matching is unavailable. This is correct for now, but future phases should keep unmatched-zone diagnostics visible.
- Shared support/resistance context still needs future additive exposure of practical, stable, and formal multi-timeframe structure beyond the current no-lookahead safety gate.
- VWAP should remain market facts unless a later explicit opt-in allows it to influence trader interpretation.

## Recommended Next Phase

After merge, keep `runtimeMode` `old` as default and proceed with downstream shadow verification. The next phase should add alert, monitoring, trader-context, and replay parity gates that consume the same old/default runtime transport while observing enriched metadata. Only after those gates pass should the team consider any default-path change.
