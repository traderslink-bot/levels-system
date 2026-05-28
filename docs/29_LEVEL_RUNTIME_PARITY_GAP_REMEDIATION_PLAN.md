# Level Runtime Parity Gap Remediation Plan

Date: 2026-05-27
Branch context: `codex/runtime-compare-tooling`
Scope: documentation only

## Executive Summary

The old/new runtime parity scaffolding proves that the projected new runtime path is shape-compatible with `LevelEngineOutput`, but it is not behavior-compatible with the old runtime path yet.

The current gaps should be fixed or explicitly approved before any `enrichedAnalysis` work reaches journal, replay, monitoring, alert, or trader-context surfaces. The safest path is to keep `runtimeMode: "old"` as the default, preserve `FinalLevelZone` as the runtime transport type, and use the richer `rankLevels()` path additively only after tests prove that bucket coverage, nearest levels, special levels, and extension ladders are protected.

The largest gap is not that the new path cannot find levels. It is that the new projected runtime adapter surfaces a small curated selection from `selectSurfacedLevels()`, while the old path uses the legacy cluster/score/rank/surface process plus nearest-fill, gap-fill, high-confidence-fill, and extension-ladder logic. The new adapter currently maps only one deeper anchor per side into `extensionLevels`, so it does not recreate the old forward-planning ladder.

Recommendation: fix output parity gates before enrichment. If enrichment proceeds in parallel, it must be attached additively to old-path `FinalLevelZone` output in shadow/compare contexts only, with tests proving no bucket membership, nearest level, extension coverage, alert behavior, or storage shape changes.

## Current Parity Gaps

The current parity fixture in `src/tests/level-runtime-mode.test.ts` documents these approved scaffolding gaps around reference price `4.6136`:

| Area | Old path | New projected path | Current status |
| --- | ---: | ---: | --- |
| Major buckets | 12 | 1 | Gap, not default-safe |
| Intermediate buckets | 2 | 3 | Gap, needs mapping review |
| Intraday buckets | 1 | 1 | Count matches, identity still needs parity |
| Extension total | 5 | 2 | Gap, not default-safe |
| Extension support | 3 | 1 | Gap |
| Extension resistance | 2 | 1 | Gap |
| Nearest support | 4.5284 | 4.4799 | Gap |
| Nearest resistance | 4.6957 | 4.7474 | Gap |
| Special levels | Matched | Matched | Pass |

The observed old major bucket contains daily and mixed-timeframe legacy runtime zones, including strong non-extension support and resistance levels. The observed new major bucket contains only one daily resistance because the new surfaced-selection adapter emitted only one daily/mixed actionable level that mapped to the legacy `major` bucket.

These gaps are acceptable only as documented scaffolding differences. They are not approval to make `runtimeMode: "new"` default.

## Likely Root Causes

The 12-major-versus-1-major gap is primarily caused by surfaced selection and adapter projection, with secondary contributions from clustering, scoring scale, strength thresholds, and bucket mapping.

| Possible cause | Likely role | Notes |
| --- | --- | --- |
| Candidate generation | Low to medium | Both paths start from the same `LevelEngine` raw candidate collection. The adapter converts `RawLevelCandidate` into `LevelCandidate`, so candidate availability is probably not the main count gap. It still needs a diagnostic test because conversion may lose old precomputed evidence semantics. |
| Clustering | Medium | The old path clusters raw candidates through `clusterRawLevelCandidates()` before legacy scoring. The richer path clusters normalized `LevelCandidate` objects through `rankLevels()` and `clusterLevels()`. Different clustering can change representative price, confluence, and whether daily/4h/5m evidence becomes mixed. |
| Surfaced selection | High | The old path surfaces by owned timeframe buckets, then adds nearest/gap/high-confidence fillers. The new path uses `selectSurfacedLevels()` with structural/confidence floors, max 3 per side, near-price preference, same-band suppression, broken-state filtering, and one deeper anchor. This is the largest visible cause. |
| Bucket mapping | Medium | The old path uses `preferredBucketForZone()` and can place mixed-timeframe zones into daily/major ownership. The new adapter uses `bucketForSurfacedLevel()`, where daily or multi-timeframe means major, 4h means intermediate, and everything else means intraday. The rule is similar but applied after a much narrower selection. |
| Strength thresholds | Medium | Old `strengthScore` and `strengthLabel` are native to `scoreLevelZones()` and legacy thresholds. The adapter derives labels from surfaced-selection score and durability adjustments. These label taxonomies are not equivalent. |
| Adapter projection | High | `buildNewRuntimeCompatibleLevelOutput()` projects only surfaced supports/resistances into buckets and maps `deeperSupportAnchor` / `deeperResistanceAnchor` as extensions. It does not recreate old nearest-fill, gap-fill, high-confidence-fill, or full extension-engine behavior. |

The extension gap is specifically caused by the adapter using the surfaced-selection anchors instead of the old `buildLevelExtensions()` behavior. Old runtime extension coverage starts from the full eligible support/resistance zone inventory and then applies spacing, search-window, practical coverage, low-price/active-trader depth rules, and synthetic resistance extension generation.

## Old Path Behaviors To Preserve

These old-path behaviors should be preserved exactly unless a future directive explicitly approves a difference:

1. `runtimeMode: "old"` remains the default and returns the existing old `LevelEngineOutput`.
2. `FinalLevelZone` remains the runtime transport type for monitoring, alerts, validation, review, shared support/resistance, and storage.
3. `specialLevels` remain identical across old/new/compare modes: premarket high/low and opening-range high/low must not be recomputed by the new path.
4. Existing old bucket membership must remain stable while `runtimeMode` is `old`.
5. Nearest actionable support and nearest actionable resistance around the reference price must remain protected before any new path can become default.
6. Legacy extension-ladder behavior must remain available for forward planning, especially after visible resistance inventory is exhausted.
7. Low-price and active-trader planning depth must be preserved: below `2`, the old path can plan wider and deeper; below `30`, it uses more active-trader gap-fill and extension capacity than ordinary large-price symbols.
8. Old synthetic resistance extension generation must remain protected when historical overhead inventory is too thin for practical continuation planning.
9. Existing storage and JSON serialization of `LevelEngineOutput` must remain compatible.
10. Compare mode must remain observational unless `compareActivePath` explicitly asks for the new output.

The old extension behavior matters because low-price runners often move through nearby historical levels quickly. The trader-facing map still needs practical overhead checkpoints instead of stopping after one deeper anchor. The old path provides continuity-aware near/far/middle resistance extension selection, practical resistance coverage, support extensions below the visible map, and synthetic rounded resistance levels when real historical inventory ends too soon.

## New Path Behaviors To Keep

The richer path has analysis behaviors that should be retained as additive analysis, not discarded:

1. Structural scoring from `rankLevels()`.
2. Touch analysis and reaction quality evidence.
3. Level state, including broken, weakened, respected, reclaimed, and flipped states.
4. Confidence and durability labels.
5. Explanations and score breakdowns.
6. Near-price actionable selection as an analysis view.
7. Suppression reasons for clutter, wrong-side levels, broken levels, and low-confidence levels.
8. Deterministic projected strength-label mapping while the adapter exists.

Some new-path differences may eventually be intentionally better:

1. Suppressing broken or low-confidence clutter in analysis-only views.
2. Explaining why a level was not trader-facing even when it remains structurally real.
3. Separating structural truth from actionable trader-facing surfacing.
4. Providing confidence and state metadata that the old transport does not have.

Those differences should not change old runtime output by default. They can be allowed inside optional enrichment or diagnostics after output parity gates pass.

## Extension Ladder Remediation Plan

The new adapter must not treat one deeper anchor per side as equivalent to the old extension ladder.

Required remediation:

1. Add tests that snapshot old extension behavior for the current parity fixture: `3` support extensions and `2` resistance extensions for reference price `4.6136`.
2. Add low-price runner fixtures below `2` proving the old path can provide expanded practical coverage and synthetic resistance levels when real overhead inventory is thin.
3. Add active-trader reference-price fixtures below `30` proving increased extension capacity and gap-fill coverage remain available.
4. Add tests for synthetic resistance increments by price band, including sub-dollar, `1-2`, `2-5`, and higher-price buckets.
5. Add tests proving extension levels remain outside the surfaced map, are spaced, and do not duplicate already-surfaced display prices.
6. Add tests proving resistance extension coverage reaches the configured practical range when historical inventory allows or synthetic levels are enabled.
7. Only after those tests exist, change the new projection to reuse the existing extension-ladder behavior rather than mapping only surfaced deeper anchors.

Preferred implementation direction:

1. Do not create a new extension engine.
2. Reuse `buildLevelExtensions()` or extract a shared extension-selection helper if needed.
3. Feed the extension helper an eligible runtime-compatible zone inventory that preserves old semantics.
4. Keep synthetic resistance extension generation behind the same old-path rules.
5. Preserve old default behavior while compare mode measures the projected new output.

Open design question for implementation: the cleanest source for the new projection's eligible extension inventory may be the old clustered/scored `FinalLevelZone` inventory rather than the narrow `SurfacedLevelSelection[]`. If so, the new path should reuse old transport zones for runtime coverage and attach richer analysis additively later, instead of trying to make the surfaced-selection result carry every runtime responsibility.

## Bucket Mapping And Strength Label Remediation Plan

The bucket gap should be remediated in two layers: inventory parity first, then label parity.

Bucket inventory plan:

1. Add diagnostics that count raw candidates, old clustered zones, ranked richer levels, surfaced levels, bucketed projected zones, and extensions in one fixture report.
2. Add tests proving each old bucketed zone has either a matching projected zone within price tolerance or an explicitly approved suppression reason.
3. Add tests for mixed daily/4h/5m zones proving they map to legacy `major` ownership when the old path would treat them as daily/mixed major zones.
4. Add tests for daily-only, 4h-only, and 5m-only zones proving expected major/intermediate/intraday bucket assignment.
5. Add tests proving old nearest-fill, gap-fill, and high-confidence-fill zones are not lost merely because they were not selected by the richer surfaced-selection pass.

Strength-label plan:

1. Keep the current deterministic adapter label test.
2. Add side-by-side tests that compare old `strengthLabel` and projected label for matched prices.
3. Decide whether projected runtime labels must exactly preserve old labels or whether richer labels should live only inside optional `enrichedAnalysis`.
4. Recommended: preserve legacy `strengthLabel` on `FinalLevelZone` for runtime transport and store richer label/state/confidence under future additive analysis.

The old score scale and new score scale are not equivalent. Trying to force the richer surfaced score into the old `strengthLabel` contract risks changing downstream behavior. Runtime labels should remain legacy-compatible until downstream alert and trader-context tests approve a different interpretation.

## Nearest Level Parity Plan

Nearest support/resistance parity is a separate gate from bucket count parity. A projected output could have similar counts and still point a trader at the wrong nearby level.

Required tests:

1. Add fixture assertions for nearest support and resistance at reference price `4.6136`.
2. Assert old nearest support `4.5284` and old nearest resistance `4.6957` remain the baseline until a deliberate change is approved.
3. Add tolerance-based matching for projected output, initially strict enough to fail the current `4.4799` support and `4.7474` resistance differences.
4. Add tests proving nearest-fill logic protects a nearby actionable level even when a higher-scoring level is farther away.
5. Add tests proving same-band suppression does not remove the only useful nearest support/resistance level from runtime transport.

Expected remediation direction:

1. Runtime transport should prioritize old nearest-level behavior.
2. Richer analysis may explain that a different nearby level is weakened, broken, or structurally stronger, but that explanation should not remove the old nearest runtime level until downstream behavior is approved.
3. Compare logs should keep reporting both nearest old and nearest projected levels until parity is closed.

## Tests Required Before Fixes

Add tests before changing production behavior:

1. Candidate inventory parity test: old and new projection start from the same raw candidate inventory, with counts by timeframe and side.
2. Candidate conversion test: `RawLevelCandidate` to `LevelCandidate` conversion preserves symbol, side, price, source timeframe, origin kind, and analysis candle basis.
3. Stage-by-stage parity report test: raw candidates -> old clusters -> old scored zones -> old surfaced buckets -> old extensions -> ranked richer levels -> surfaced richer levels -> projected buckets -> projected extensions.
4. Bucket mapping tests for daily, 4h, 5m, and mixed-timeframe zones.
5. Strength-label deterministic mapping test, plus matched-zone legacy-label preservation tests.
6. Extension ladder tests for current fixture, low-price runner, active-trader under-30 symbol, and synthetic resistance coverage.
7. Nearest support/resistance tests around reference price.
8. Special-level parity tests remain mandatory.
9. Compare-mode tests proving `compareActivePath: "old"` still returns old output and only logs comparison data.
10. Compare-mode tests proving `compareActivePath: "new"` returns a `LevelEngineOutput`-compatible shape without changing public output fields.
11. Serialization tests proving any optional future analysis field does not break `LevelStore` or JSON storage.
12. Alert/trader-context regression tests before any new path can influence default monitoring output.

Current approved parity-gap test names should be treated as temporary safety documentation, not as final passing parity.

## Implementation Order

1. Keep this plan as documentation only.
2. Add test-only parity diagnostics that expose counts and identities at each runtime stage.
3. Add failing or explicitly todo parity tests for bucket identity, nearest levels, and extension ladder coverage.
4. Decide whether the new projected runtime path should preserve old `FinalLevelZone` values and attach richer analysis later, or whether the richer surfaced-selection path must be expanded to reproduce old runtime coverage.
5. Prefer preserving old `FinalLevelZone` runtime values and adding richer analysis additively. This aligns with the rescue plan and avoids turning surfaced selection into a third engine.
6. Remediate extension projection by reusing the old extension helper or a shared extraction of it.
7. Remediate bucket inventory by ensuring old nearest-fill, gap-fill, high-confidence-fill, and mixed-timeframe major ownership are represented in projected runtime output.
8. Remediate strength labels by preserving legacy runtime labels on `FinalLevelZone` and moving richer state/confidence/durability into future optional analysis.
9. Rerun focused parity tests, TypeScript, and full `npm test`.
10. Only after parity is proven or differences are explicitly approved, add optional `enrichedAnalysis` in shadow/compare contexts.
11. Keep `runtimeMode: "old"` default until alert parity, trader-context parity, storage parity, no-lookahead safety, and performance gates all pass.

## Risks And Non Goals

Risks:

1. Treating `selectSurfacedLevels()` as the runtime surface selector could permanently remove old ladder coverage.
2. Mapping richer score labels into legacy `strengthLabel` could change alert thresholds or trader-facing wording.
3. Fixing extension count alone could hide nearest-level or bucket-identity regressions.
4. Adding enrichment before output parity could make journal/replay output look more authoritative while still losing old runtime context.
5. Allowing VWAP or dynamic facts to influence trader interpretation during this phase would mix unrelated policy work into runtime parity remediation.

Non goals:

1. No production code changes in this documentation task.
2. No `enrichedAnalysis` implementation in this task.
3. No runtime default change.
4. No new level engine.
5. No Discord REST snapshot fix.
6. No alert behavior, monitoring behavior, trader-context behavior, or output behavior changes.
7. No change to the no-lookahead candle-close gate except preserving it as a prerequisite for future journal/replay enrichment.

Approved differences for now:

1. Special levels already match and should not differ.
2. Richer analysis metadata may differ from old runtime scoring once it is additive and clearly names its source.
3. Current bucket, nearest-level, and extension differences are approved only as scaffolding gaps in tests, not as acceptable default runtime differences.

Safest path to enriched analysis:

1. Keep old runtime output as the source of truth.
2. Match richer `rankLevels()` analysis back onto old `FinalLevelZone` values by price, side, source evidence, and timeframe where possible.
3. Store richer state/confidence/explanations under optional nested analysis only.
4. Emit it first in compare/shadow contexts.
5. Prove old output serialization, alerts, monitoring, trader context, and journal/replay snapshots remain unchanged unless a test explicitly opts into the new analysis.
