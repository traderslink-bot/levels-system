# LevelEngine Quality Tuning Plan

## Purpose

This plan turns the multi-timeframe level quality review into a scoped, evidence-based tuning roadmap before any support/resistance behavior changes are made. The intent is to improve LevelEngine explainability, diagnostics, and eventually level quality while preserving the locked `LevelAnalysisSnapshot` v1 contract and keeping 15m facts outside LevelEngine generation.

This is a planning gate only. It does not tune clustering, scoring, ranking, extension generation, or support/resistance detection.

## Evidence Source

Primary evidence:

- `docs/106_LEVEL_ENGINE_MULTI_TIMEFRAME_LEVEL_QUALITY_REVIEW.md`
- `docs/examples/level-analysis-snapshot/level-quality-review/latest-level-quality-review.json`
- `docs/examples/level-analysis-snapshot/level-quality-review/latest-level-quality-review.txt`

Reviewed symbols:

- Supplied 15m context: `DEVS`, `ENVX`, `DXYZ`, `QUBT`, `GME`
- Comparison symbols without supplied 15m: `AIM`, `HCWB`, `YMAT`, `AAOI`, `PHOE`

Current code areas inspected for likely tuning boundaries:

- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-quality-audit-runner.ts`
- `src/lib/levels/level-runtime-output-adapter.ts`
- Level intelligence, explanation, snapshot, and runner artifacts related to review output

## Current Strengths

- Supplied IBKR 15m context populated `timeframeFacts["15m"]` cleanly for the five target symbols without entering LevelEngine support/resistance generation.
- LevelEngine output was stable with and without supplied 15m facts.
- Nearest support and nearest resistance were present for all ten reviewed symbols.
- Eight of ten reviewed symbols had balanced nearest-level coverage.
- LevelQualityAudit surfaced nearby gap warnings, extension coverage warnings, clustered areas, and enrichment gaps without changing output behavior.
- Synthetic continuation-map rows were clearly marked when present and remained forward-planning context only.
- No obvious production bug was found in the review.

## Current Weaknesses

- Clustered level areas appeared on seven of ten reviewed symbols, and dense level maps appeared on `QUBT`, `AAOI`, and `PHOE`.
- Extension coverage warnings appeared on five symbols, including no resistance extension coverage for `DEVS`, `AIM`, and `HCWB`.
- `HCWB` and `PHOE` had wide nearest support and resistance gaps.
- All reviewed outputs reported `unenriched_levels_present`, which limits explainability even when the underlying levels are otherwise usable.
- Extension spacing and depth may need review before adding broader real-cache symbol coverage.

## Proposed Tuning Areas

### A. Cluster Density And Near-Duplicate Levels

Review observation:

- Clustered areas were reported on `DEVS`, `ENVX`, `DXYZ`, `GME`, `AIM`, `HCWB`, and `YMAT`.
- Dense maps were reported on `QUBT`, `AAOI`, and `PHOE`.

Symptoms to measure:

- Cluster count by side and bucket.
- Representative prices within a small percentage band.
- Mixed support/resistance cluster spans.
- Possible clutter-level count from LevelQualityAudit.
- Number of surfaced levels inside the same narrow zone.
- Whether nearest support/resistance changes when near-duplicate candidates are removed in test-only experiments.

Likely code areas:

- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-ranking.ts`
- `src/lib/levels/level-zone-utils.ts`
- `src/lib/levels/level-quality-audit-runner.ts`

Possible safe test cases:

- Deterministic fixtures with multiple intraday candidates inside one narrow price zone.
- Fixtures where higher-timeframe confluence should preserve a clustered representative.
- Regression tests proving nearest support/resistance does not disappear when a cluster is merely diagnostic.
- Audit-only tests proving clustered areas are surfaced without changing LevelEngine output.

Risk:

- Over-filtering can remove valid confluence levels, hide intraday structure, or make sparse symbols look falsely clean. Cluster tuning should come after diagnostic and enrichment gates.

### B. Extension Coverage And Spacing

Review observation:

- `DEVS`, `AIM`, and `HCWB` reported no resistance extension coverage.
- `DEVS`, `ENVX`, and `YMAT` reported limited downside extension coverage.
- Extension support/resistance depth varied sharply across symbols.

Symptoms to measure:

- Selected extension count by side.
- Candidate inventory before and after extension selection.
- Rejection reason counts from extension diagnostics.
- Selected extension coverage percentage above and below reference price.
- Distance between surfaced levels and selected extensions.
- Whether synthetic continuation-map rows are used only when clearly marked and supported by policy.

Likely code areas:

- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-quality-audit-runner.ts`

Possible safe test cases:

- One-sided candidate inventory with no above-price resistance candidates.
- Closely spaced extension candidates that should not all surface.
- Sparse symbols where extension coverage should produce a diagnostic rather than fabricate a level.
- Synthetic continuation-map fixtures that prove synthetic rows remain marked and outside historical support/resistance.

Risk:

- Extension tuning can accidentally fabricate levels, overstate forward coverage, or make synthetic rows look historical. Any behavior change needs explicit before/after artifacts.

### C. Nearest-Level Gap Thresholds

Review observation:

- `HCWB` had nearest support 35.1443% below reference and nearest resistance 28.3531% above reference.
- `PHOE` had nearest support 14.1007% below reference and nearest resistance 17.9281% above reference.
- Both symbols already surfaced wide-gap diagnostics.

Decision point:

- The first question is whether audit wording and thresholds are clear enough. If the audit is already correct, generation behavior may not need to change.

Likely code areas:

- `src/lib/levels/level-quality-audit-runner.ts`
- Snapshot review/reporting artifacts

Possible safe test cases:

- Fixtures just below and above the nearby threshold.
- Tests separating "no nearby level" diagnostics from "bad level quality" conclusions.
- Tests proving wide-gap diagnostics do not create new levels or change nearest-level selection.

Risk:

- Treating wide gaps as generation defects too early could push LevelEngine toward excessive or fabricated levels. This area should begin as audit wording hardening unless a deterministic bug appears.

### D. Enrichment Mapping Coverage

Review observation:

- Every reviewed symbol reported `unenriched_levels_present`.
- The runtime output adapter has explicit enrichment diagnostics and unmatched runtime zone IDs, making this likely a mapping or metadata coverage issue rather than a support/resistance generation problem.

Likely code areas:

- `src/lib/levels/level-runtime-output-adapter.ts`
- `src/lib/levels/level-intelligence-profile.ts`
- `src/lib/levels/level-intelligence-report.ts`
- `src/lib/levels/level-context-explainer.ts`
- `src/lib/levels/level-quality-audit-runner.ts`

Possible safe test cases:

- Runtime zones that should map to ranked/enriched levels by ID.
- Runtime zones that should map by price and source metadata when IDs diverge.
- Extension levels that should remain factual even when enrichment is unavailable.
- Parity tests proving enrichment improvements do not change bucket selection, ranking, or level prices.

Risk:

- Enrichment hardening can accidentally imply higher confidence if labels are too strong. The first implementation should focus on mapping coverage and diagnostics, not score changes.

Recommended priority:

- This is the safest first implementation target because it can improve explainability and audit quality without changing support/resistance generation behavior.

### E. Forward Resistance Coverage

Review observation:

- Several symbols had limited or absent resistance extension coverage even when nearest resistance existed.
- The review did not prove whether this belongs in extension generation, synthetic continuation-map policy, or audit wording.

Likely code areas:

- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-quality-audit-runner.ts`
- Synthetic continuation-map documentation and fixtures

Possible safe test cases:

- Symbols with support-heavy candidate inventory.
- Symbols with above-price candidates rejected for spacing or practical range.
- Synthetic continuation-map cases where future planning context is present but historical resistance is absent.

Risk:

- Forward resistance tuning can easily become advice-like if wording is careless. Diagnostics must remain factual: "no resistance extension coverage" is acceptable; target or advice language is not.

## What Should Not Change Yet

- Do not change LevelEngine scoring, ranking, clustering, or bucket assignment in this planning gate.
- Do not feed 15m candles or 15m facts into LevelEngine support/resistance generation.
- Do not change `runtimeMode` defaults.
- Do not change alert, monitoring, or Discord behavior.
- Do not change journal app behavior.
- Do not add grading, coaching, P/L, giveback analysis, behavior scoring, recommendations, or trade advice.
- Do not commit raw candle cache files or bulky full snapshots as tuning evidence.

## Testing Strategy

Use focused deterministic tests for each implementation gate:

- Enrichment mapping hardening: assert improved mapping coverage and unchanged LevelEngine output buckets/prices.
- Audit wording hardening: assert diagnostics are factual and threshold-based without changing level generation.
- Extension coverage tuning: assert before/after extension candidate selection with compact fixtures and explicit no-fabrication checks.
- Cluster density tuning: assert cluster diagnostics and representative preservation before changing surfaced selection behavior.

For any behavior-changing gate, add:

- Current-output parity fixtures before the change.
- Explicit expected diffs after the change.
- Boundary guards against recommendation, advice, grading, coaching, P/L, giveback, and behavior-scoring language.
- No-lookahead checks where snapshots are involved.

## Validation Strategy

Every implementation gate should run:

- Focused deterministic tests for the changed area.
- `npx tsc --noEmit`
- `npm test`
- `git diff --check`

Before changing level behavior, rerun the compact multi-timeframe quality review against the same ten symbols and compare:

- nearest support/resistance
- bucket counts
- extension counts
- clustered areas
- enrichment counts
- audit diagnostics
- synthetic continuation-map markings
- 15m facts context parity

## Risk Controls

- Change one tuning category per gate.
- Prefer audit/enrichment improvements before level-generation tuning.
- Preserve default runtime behavior until an implementation gate explicitly states otherwise.
- Keep 15m as context only until a separate design and validation gate decides otherwise.
- Commit compact summaries only; do not commit raw cache files.
- Treat synthetic continuation-map rows as marked forward-planning context, not historical support/resistance.
- Require before/after artifacts for any generation behavior change.

## Rollout Phases

1. `level_quality_enrichment_mapping_hardening`
   - Improve enrichment mapping diagnostics and coverage without changing level generation.
2. `level_quality_audit_wording_hardening`
   - Tighten factual audit wording for nearest gaps, extension gaps, and clutter diagnostics.
3. `level_engine_extension_coverage_tuning_plan_or_fixture_pack`
   - Add deterministic extension coverage fixtures and decide whether tuning is warranted.
4. `level_engine_extension_coverage_tuning`
   - Tune extension selection only if fixture evidence supports it.
5. `level_engine_cluster_density_tuning_plan_or_fixture_pack`
   - Add deterministic clustered-level fixtures and decide whether surfaced density behavior should change.
6. `level_engine_multi_timeframe_quality_review_rerun`
   - Re-run the ten-symbol review and compare against the baseline artifacts.

## Recommended First Implementation Gate

Recommended next gate:

`level_quality_enrichment_mapping_hardening`

Reason:

All reviewed symbols reported unenriched levels. Improving mapping coverage can make LevelQualityAudit and LevelIntelligenceReport more useful without changing support/resistance generation, scoring, ranking, clustering, 15m handling, alerts, monitoring, Discord, or journal behavior.

## Anti-Goals

- No support/resistance tuning in this planning gate.
- No LevelEngine scoring, ranking, clustering, or extension-generation changes in this planning gate.
- No use of 15m as LevelEngine input.
- No recommendations, trade advice, buy/sell/hold language, grading, coaching, P/L, giveback analysis, or behavior scoring.
- No journal app changes.
- No Discord, alert, monitoring, or runtime default changes.
