# Project Change Log

## Purpose

This document tracks concrete implementation changes made to the `levels-system` project over time so the current state of the codebase is easy to review.

## Current Testing Context

- IBKR is the active provider being used to test the system end-to-end right now.
- The current IBKR integration should be treated as the testing/integration provider for this phase.
- Provider abstraction remains intentional because the data provider may be switched after testing.

## Format

- Use Eastern time where practical, matching the rest of the project notes.
- Add entries in reverse chronological order.
- Keep each entry focused on shipped code, verification, and follow-up risk.

---

## 2026-04-16 09:35 PM America/Toronto

### Summary

- Reworked the validation layer so it is more actionable for support/resistance tuning and less resistance-only / averaged.
- Expanded forward reaction validation to separate:
  - full respect
  - partial respect
  - clean break
  while staying deterministic and compact.
- Added explicit forward usefulness summaries by:
  - support vs resistance
  - surfaced vs extension
  - near vs intermediate vs far distance bands
- Strengthened persistence validation with loose-match diagnostics so high persistence can be distinguished from nearby remapping inside tolerance.
- Kept the pass focused on validation usefulness for structural tuning and did not expand Discord formatting or add any auto-tuning layer.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/lib/validation/level-persistence-validator.ts`
- `src/lib/validation/level-validation-batch.ts`
- `src/tests/forward-reaction-validator.test.ts`
- `src/tests/level-persistence-validator.test.ts`
- `src/tests/level-validation-batch.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Validation output can now tell us whether the real weakness is more likely to be:
  - support vs resistance selection
  - near vs intermediate vs far usefulness
  - surfaced vs extension usefulness
  - real stability vs loose remap-style persistence

---

## 2026-04-16 08:40 PM America/Toronto

### Summary

- Improved the validation workflow so repeated live runs do not have to pull the same candle windows from IBKR every time.
- Added a validation-only candle snapshot cache with modes for:
  - `read_write`
  - `replay`
  - `refresh`
  - `off`
- Wired the candle cache into:
  - live candle-health validation
  - persistence validation
  - forward reaction validation
  - batch validation
- Reduced the default live batch validation window count from `6` to `4` and added an IBKR warning when a live batch is larger than the recommended small-group size.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `src/lib/validation/validation-candle-cache.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/scripts/run-level-candle-health-check.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/scripts/shared/validation-candle-cache.ts`
- `src/tests/validation-candle-cache.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Validation runs can now fetch once and replay the same candle windows on later passes, which should materially reduce IBKR waiting during structural tuning and make before/after comparisons more reproducible.

---

## 2026-04-16 08:10 PM America/Toronto

### Summary

- Used the first live small-cap validation batch evidence to drive the next narrow structural truth pass instead of doing more snapshot/output cleanup.
- Confirmed the engine was already stable and that the next weak spot was usefulness separation: repeatedly recycled intraday levels with weak decision quality could still score too competitively just because they accumulated touches.
- Updated `src/lib/levels/level-scorer.ts` with a bounded recycled-intraday penalty so single-timeframe `5m` levels are discounted when they show:
  - heavy local reuse
  - weak rejection/follow-through
  - shallow displacement / reaction quality
- Added focused regression and scenario coverage proving that a stronger decisive nearby anchor now outranks recycled local resistance while farther meaningful structure still survives.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-validation-scenarios.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The engine now separates “repeatedly existing” intraday resistance from more actionable decision structure more honestly, which should reduce low-usefulness surfaced levels without reopening the broader level engine.

---

## 2026-04-16 07:05 PM America/Toronto

### Summary

- Added the next practical validation step: batch validation across multiple symbols.
- Added a batch summary layer that aggregates:
  - candle-source health
  - resistance persistence/churn
  - forward reaction usefulness
- Added a live batch runner that uses the active provider path, defaults to IBKR, keeps going when one symbol fails, and emits a single summary at the end.
- Kept the implementation focused on validation workflow rather than turning it into a new tuning or dashboard system.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/level-validation-batch.ts`
- `src/scripts/run-level-validation-batch.ts`
- `src/tests/level-validation-batch.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo can now validate a small symbol batch in one pass instead of relying only on one-off symbol checks, which makes regressions easier to spot across a wider sample.

---

## 2026-04-16 06:45 PM America/Toronto

### Summary

- Added the next validation layer: forward reaction validation for support/resistance usefulness.
- Added a first forward-reaction validator that evaluates whether surfaced and extension levels are:
  - touched
  - respected
  - broken
  using post-generation `5m` candles
- Added a live runner that uses the active candle provider path, defaults to IBKR, and checks candle-source health before evaluating what price did after generation.
- Kept the validator descriptive instead of turning it into an auto-tuning system.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/forward-reaction-validator.ts`
- `src/scripts/run-forward-reaction-validation.ts`
- `src/tests/forward-reaction-validator.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo can now validate not only level stability across refreshes, but also whether surfaced and extension levels produce useful future reactions after they are generated.

---

## 2026-04-16 06:25 PM America/Toronto

### Summary

- Continued the validation-first hardening phase by adding level persistence and churn validation instead of reopening broad level-engine feature work.
- Added a first persistence validator that compares rolling `LevelEngineOutput` snapshots and reports:
  - surfaced support/resistance persistence
  - extension support/resistance persistence
  - surfaced churn
  - average matched price drift
- Added a live runner that uses the active candle provider path, defaults to IBKR, and checks candle-source health before generating rolling validation windows.
- Tightened the live validation path so `.env` loading also applies to candle-source health checks and persistence runs.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
- `package.json`
- `src/lib/validation/level-persistence-validator.ts`
- `src/scripts/run-level-candle-health-check.ts`
- `src/scripts/run-level-persistence-validation.ts`
- `src/tests/level-persistence-validator.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo now has a runnable persistence/churn validation path that uses the same active candle-provider workflow as live testing.
- Provider-health failures can be separated from level-persistence weaknesses before structural tuning starts.

---

## 2026-04-16 05:45 PM America/Toronto

### Summary

- Shifted from broad structural feature building into validation-driven hardening of the support/resistance engine.
- Expanded targeted scenario coverage for held-gap continuation versus quickly filled gaps and used that validation to confirm one real remaining weakness.
- Corrected the weakness by making gap-driven continuation relevance depend more heavily on post-gap hold behavior instead of raw gap presence alone.
- Updated the directive to reflect that the next phase is evidence-driven hardening, not feature churn.

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The repo now has stronger scenario coverage around gap-driven continuation behavior.
- Held gaps and quickly filled gaps are separated more honestly in structural scoring.
- Build and test verification both pass after the validation-driven hardening pass.

---

## 2026-04-16 05:29 PM America/Toronto

### Summary

- Re-evaluated the remaining gap/thin-zone structural blind spots and found one real weakness: the engine recognized that a gap existed, but it still over-credited raw gap presence even when the gap filled quickly and did not remain valid continuation space.
- Added bounded `gapContinuationScore` evidence so gap-driven continuation only receives meaningful structural credit when the post-gap hold behavior supports it.
- Threaded that score through raw candidates, clustered zones, final scoring, and extension usefulness so real open continuation space is rewarded while quickly filled/artificial gaps are not overvalued.
- Kept the change deterministic and narrow instead of reopening broad monitoring or alert work.

### Files updated

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Real held gaps now contribute to continuation relevance more honestly than gaps that fill quickly.
- The engine no longer treats simple gap existence as sufficient evidence of open continuation space.
- Build and test verification both pass after the gap-continuation refinement.

---

## 2026-04-16 05:07 PM America/Toronto

### Summary

- Continued the support/resistance truth pass by improving thin-zone and open-space continuation relevance instead of reopening broad monitoring or alert work.
- Added deterministic path-clearance scoring in the level engine so zones with a cleaner breakout path to the next same-side structure gain credit over cramped zones boxed in by nearby continuation blockers.
- Rebuilt extension selection so the engine can choose the strongest structurally useful frontier level inside the next continuation window instead of always accepting the closest leftover by position alone.
- Kept the change bounded to level truth, surfaced ranking, and extension usefulness.

### Files updated

- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Zones with cleaner breakout continuation space now score more honestly than otherwise similar zones that are immediately cramped by nearby same-side structure.
- Extension ladders can now prefer a stronger frontier level over a trivial closer leftover when that produces a more useful next ladder for small-cap continuation behavior.
- Build and test verification both pass after the path-clearance and frontier-selection refinement.

---

## 2026-04-16 04:43 PM America/Toronto

### Summary

- Continued the level-engine truth pass by explicitly separating breakout-useful follow-through structure from incidental local reaction structure.
- Added deterministic `followThroughScore` evidence on raw candidates and final zones, derived from displacement, recency, session significance, gap structure, rejection quality, and overused local-reaction penalty.
- Rebuilt scoring so follow-through usefulness now materially influences final structural strength instead of being implicitly buried inside other evidence.
- Rebuilt extension selection so nearby next-level candidates compete locally on structural usefulness, which prevents weaker first leftovers from consuming extension ladder space when a stronger nearby follow-through zone exists.

### Files updated

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Stronger continuation-relevant zones now surface and score more honestly than incidental local reactions with weak forward usefulness.
- Extension ladders are more actionable because a stronger nearby continuation level can now beat a weaker first leftover in the same local band.
- Build and test verification both pass after the follow-through usefulness refinement.

---

## 2026-04-16 03:34 PM America/Toronto

### Summary

- Continued the structural truth pass by improving support/resistance output usefulness instead of reopening alert work.
- Added crowding-aware zone scoring so weaker nearby same-side levels are penalized when a stronger structural zone already owns the area.
- Rebuilt surfaced ladder selection to enforce deterministic spacing by timeframe bucket, which reduces overcrowded nearby intraday levels in the final visible ladder.
- Rebuilt extension ladder selection to skip near-duplicate leftovers that do not add meaningful next-level information for small-cap follow-through.

### Files updated

- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Surfaced ladders now prefer stronger distinct structural zones over tightly packed nearby noise.
- Extension ladders are cleaner because near-duplicate next levels are filtered before they reach watchlist posting or monitoring activation.
- Build and test verification both pass after the crowding-aware scoring and spacing-aware ladder-selection refinement.

---

## 2026-04-16 04:12 PM America/Toronto

### Summary

- Continued the level-engine truth pass by strengthening multi-timeframe confluence treatment instead of broadening alert or monitoring work.
- Rebuilt confluence scoring so mixed higher-timeframe structure gets materially more credit than incidental single-timeframe 5m reaction zones with similar raw touches.
- Rebuilt surfaced ladder ownership so a mixed zone now surfaces once in its highest structural bucket instead of competing across multiple buckets.
- Kept the pass deterministic and focused on final ladder usefulness for small-cap support/resistance output.

### Files updated

- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Mixed daily/4h structure now outranks similar incidental 5m-only reaction structure more honestly.
- Surfaced ladders no longer duplicate the same mixed structural area across multiple timeframe buckets.
- Build and test verification both pass after the confluence-weighting and surfaced-bucket ownership refinement.

---

## 2026-04-16 03:08 PM America/Toronto

### Summary

- Returned to the structural truth layer and improved support/resistance output usefulness instead of doing more alert churn.
- Added nearby-crowding discrimination in level scoring so weak/incidental zones lose strength when they sit too close to structurally stronger neighbors.
- Rebuilt surfaced level selection to be spacing-aware per timeframe bucket, so output ladders prefer stronger distinct zones over overcrowded nearby 5m noise.
- Rebuilt extension ladder selection to skip near-duplicate leftovers and preserve a cleaner next-level ladder beyond the surfaced zones.

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/tests/level-engine.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Surfaced resistance/support ladders now contain fewer overcrowded nearby levels and reflect stronger structural separation.
- Extension ladders are more useful for small-cap follow-through because they no longer surface near-duplicate next levels just beyond the visible ladder.
- Build and test verification both pass after the crowding-aware scoring and spacing-aware ladder refinement.

## 2026-04-16 02:41 PM America/Toronto

### Summary

- Completed the alert delivery-discipline pass on top of the rebuilt intelligence layer.
- Added explicit posting-policy and dedup semantics so the system now decides whether to post based on structural context, not just score and simple suppression:
  - explicit posting families
  - explicit scope and state keys
  - duplicate-context suppression
  - lower-value-than-recent suppression
  - materially-new-state preservation
- Preserved materially important alerts for:
  - outermost ladder interactions
  - promoted-extension interactions
  - remap/replacement state changes
  - strong fresh structural zones
- Kept routing separation intact:
  - event alerts still route separately from level snapshots and next-level extension posts
  - runtime paths now use the stronger delivery policy consistently through the alert-intelligence engine

### Files added

- `src/lib/alerts/alert-deduplication.ts`
- `src/lib/alerts/posting-policy.ts`

### Files updated

- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/12_ALERT_INTELLIGENCE_BLUEPRINT.md`
- `docs/13_ALERT_SCORING_RULES.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/alerts/alert-types.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Repeated monitoring passes for the same structural situation no longer produce repeated trader-facing alert posts.
- Materially new state transitions such as remap/replacement still survive delivery policy and post correctly.
- Manual watchlist runtime continues to route snapshots, next-ladder posts, and event alerts through separate paths while using the stronger alert delivery rules.

## 2026-04-16 02:03 PM America/Toronto

### Summary

- Completed the next alert-intelligence pass so trader-facing alerts now preserve monitoring truth instead of flattening it into generic zone text.
- Rebuilt alert scoring to explicitly use:
  - zone freshness
  - canonical vs promoted-extension origin
  - remap status
  - ladder position
  - structural zone strength and confluence
  - recent refresh state
  - recent extension-promotion state
  - data-quality degradation
- Tightened alert filtering to suppress weak inner-ladder chatter more honestly while preserving meaningful promoted-extension and outermost-ladder behavior.
- Rebuilt alert formatting into compact deterministic trader-facing output that now surfaces:
  - outermost vs inner vs promoted-extension significance
  - fresh vs aging context
  - remap/recent-refresh state when relevant
  - data-quality degradation when relevant
- Wired the live runtime paths onto the alert-intelligence engine:
  - `manual-watchlist-runtime-manager` now routes scored/formatted alerts instead of generic event payloads
  - `runtime/main.ts` now prints formatted intelligence output instead of raw generic monitoring alerts

### Files updated

- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/12_ALERT_INTELLIGENCE_BLUEPRINT.md`
- `docs/13_ALERT_SCORING_RULES.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-config.ts`
- `src/lib/alerts/alert-filter.ts`
- `src/lib/alerts/alert-formatter.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/runtime/main.ts`
- `src/scripts/run-alert-intelligence-sample.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The alert layer now preserves the richer monitoring distinctions that were added during the identity/remap/context passes instead of discarding them at posting time.
- Manual Discord routing and runtime console output now both reflect context-aware alert intelligence rather than generic zone text.
- Build and test verification both pass after the alert-threshold, scoring, formatting, and routing upgrade.

## 2026-04-16 01:14 PM America/Toronto

### Summary

- Completed the monitored-zone identity and remap-semantics pass so refreshed level sets no longer drift against prior active monitoring state:
  - active monitored zones now keep explicit identity separate from canonical generated zone ids
  - canonical refresh now distinguishes `new`, `preserved`, `merged`, `split`, and `replaced` remap outcomes
  - promoted extension zones can be replaced by regenerated canonical zones without duplicating the monitored representation
- Threaded richer monitored-zone context into event generation and scoring:
  - every monitoring event now carries explicit event context for canonical id, origin, freshness, remap status, ladder position, recent refresh state, and data-quality degradation
  - monitoring scoring/filtering now uses that context to reduce weak inner-zone noise while preserving meaningful outer-ladder and promoted-extension interactions
- Strengthened refresh reconciliation in the live monitor:
  - interaction history is preserved or remapped deterministically when refreshed levels overlap prior monitored zones
  - recent event memory is remapped onto refreshed monitored identities instead of silently dropping structurally related history
- Updated alert intelligence lookup so downstream alert processing can resolve canonical levels correctly even when monitoring uses explicit monitored-zone ids.

### Files added

- `src/tests/level-store.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/alerts/alert-intelligence-engine.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/scripts/run-alert-intelligence-sample.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/level-store.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/opportunity-decision-integrity.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-monitor.test.ts`

## 2026-04-16 11:46 AM America/Toronto

### Summary

- Deepened the level-engine truth layer instead of only polishing output:
  - richer swing-to-candidate evidence now incorporates wick rejection, respect retests, local gap structure, and recency-aware session weighting
  - clustered zones now carry explicit `rejectionScore` and per-zone `freshness`
  - scoring now rewards rejection quality and freshness while penalizing overcrowded weak single-timeframe clusters
- Extended monitoring so it reconciles against refreshed level outputs and activated extension zones:
  - `LevelStore` now tracks active monitored zones separately from extension inventory
  - posted extension ladders can be activated into the monitored zone set
  - `WatchlistMonitor` now re-syncs zone state when the active level-store version changes, preventing stale interaction state from leaking across level refreshes
- Threaded stronger level context into monitoring scoring by using zone freshness, extension status, and current data-quality flags.

### Files added

- `src/tests/watchlist-monitor.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/monitoring-event-scoring.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/level-engine.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The support/resistance engine now encodes more real structural evidence before a level reaches downstream monitoring.
- Monitoring can switch cleanly onto refreshed levels and posted extension ladders without continuing to evaluate stale zone state.
- Build and test verification both pass after the deeper Phase 2 truth-layer and monitoring-reconciliation pass.

## 2026-04-16 11:20 AM America/Toronto

### Summary

- Upgraded the support and resistance engine beyond the earlier candle-foundation pass:
  - richer swing evidence
  - raw candidate quality metadata
  - stronger scoring inputs
  - level freshness/origin metadata
  - structured extension ladder output
- Fixed same-kind swing separation so nearby noisy highs or lows cannot bypass displacement/separation filtering just because an opposite-kind swing sits between them.
- Extended the manual watchlist workflow with explicit lifecycle metadata and deterministic outer-ladder handling:
  - watchlist entries now track lifecycle state, level-post timestamps, extension-post timestamps, and refresh-pending state
  - activation and restart flows keep using the same runtime manager and now preserve cleaner lifecycle state
  - outermost resistance and support proximity can now trigger distinct next-level extension posts
- Added a deterministic refresh policy helper for active level sets so the runtime can decide when existing levels need regeneration because they are missing, aging, stale, or from a prior trading session.

### Files added

- `src/lib/levels/level-candidate-quality.ts`
- `src/lib/levels/level-extension-engine.ts`
- `src/lib/levels/level-refresh-policy.ts`
- `src/tests/level-engine.test.ts`

### Files updated

- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/levels/level-clusterer.ts`
- `src/lib/levels/level-config.ts`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/level-ranker.ts`
- `src/lib/levels/level-scorer.ts`
- `src/lib/levels/level-types.ts`
- `src/lib/levels/raw-level-candidate-builder.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/levels/swing-detector.ts`
- `src/lib/monitoring/level-store.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/lib/monitoring/watchlist-store.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/structure-detection.test.ts`
- `src/tests/symbol-state.test.ts`
- `src/tests/watchlist-state-persistence.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Level outputs now carry materially stronger evidence and can expose extension ladders explicitly instead of only the currently surfaced zones.
- The manual watchlist runtime can now distinguish ordinary level snapshots from next-ladder extension posts and can post the next support/resistance set before price exhausts the visible ladder.
- Build and test verification both pass after the combined Phase 2 and watchlist-lifecycle upgrade.

## 2026-04-15 10:51 PM America/Toronto

### Summary

- Rebuilt the candle data foundation into a provider-aware, validation-aware, session-aware contract instead of the previous thin candle array response shape.
- Replaced IBKR broad duration guessing with deliberate timeframe-aware fetch planning that derives provider request windows from timeframe and requested lookback depth.
- Added structured candle validation, staleness detection, completeness status, session summaries, and diagnostics formatting for runtime and manual review.
- Added an explicit provider factory and a non-IBKR provider path in code (`twelve_data`) while preserving IBKR and stub support.
- Made the level engine reject clearly invalid candle inputs before level generation and rebuilt special intraday levels around classified session windows instead of arbitrary recent bars.

### Files added

- `src/lib/market-data/candle-quality.ts`
- `src/lib/market-data/candle-session-classifier.ts`
- `src/lib/market-data/candle-validation.ts`
- `src/lib/market-data/fetch-planning.ts`
- `src/lib/market-data/provider-factory.ts`
- `src/lib/market-data/provider-priority.ts`
- `src/lib/market-data/provider-types.ts`
- `src/lib/market-data/providers/twelve-data-historical-candle-provider.ts`
- `src/tests/provider-factory.test.ts`

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `src/lib/levels/level-engine.ts`
- `src/lib/levels/special-level-builder.ts`
- `src/lib/market-data/candle-fetch-service.ts`
- `src/lib/market-data/candle-normalizer.ts`
- `src/lib/market-data/candle-types.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/runtime/main.ts`
- `src/scripts/run-manual-level-test.ts`
- `src/tests/candle-fetch-service.test.ts`
- `src/tests/ibkr-historical-candle-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Candle fetches now return provider name, requested lookback, actual bar count, fetch timing, completeness, stale status, validation issues, and session summary metadata.
- Runtime and manual testing paths can now print candle diagnostics before levels are trusted.
- Session-specific intraday level extraction now uses classified premarket and opening-range candles instead of unlabeled recent-bar slices.
- Automated coverage increased to 92 passing tests.

## 2026-04-15 07:44 PM America/Toronto

### Summary

- Extended manual watchlist behavior with deterministic level snapshot posting on activation and live level refresh posting near the highest posted resistance.
- Updated the watchlist and Discord planning docs to reflect the shipped manual watchlist operations layer.
- Added a manual watchlist operations layer for Discord-thread-managed small UI control without changing evaluator, adaptive scoring, adaptive stability, or interpretation logic.
- Extended the existing watchlist state path to persist manual symbols, notes, active status, and stored Discord thread ids across restarts.
- Added deterministic Discord thread reuse, single recovery-by-symbol-name, and create-thread behavior through the alert router layer.
- Added a minimal local manual watchlist page and server that orchestrates activation/deactivation through the shared monitoring/runtime stack instead of calling Discord or IBKR directly from the UI.
- Added per-active-symbol anti-spam snapshot metadata so level refresh reposts do not repeatedly fire at the same boundary.

### Files added

- `src/lib/alerts/local-discord-thread-gateway.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/runtime/manual-watchlist-server.ts`
- `src/tests/alert-router.test.ts`
- `src/tests/manual-watchlist-runtime-manager.test.ts`
- `src/tests/watchlist-state-persistence.test.ts`

### Files updated

- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md`
- `docs/08_WATCHLIST_MONITORING_MASTER_PLAN.md`
- `docs/09_WATCHLIST_MONITORING_BLUEPRINT.md`
- `package.json`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/alert-types.ts`
- `src/lib/monitoring/monitoring-types.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/lib/monitoring/watchlist-store.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Manual add/reactivate flow now normalizes symbols, preserves a single active record per symbol, reuses stored Discord thread ids when valid, and only creates a new thread when reuse truly fails.
- Deactivation now preserves thread identity while removing the symbol from the active monitoring set and stopping downstream alert routing through the shared runtime path.
- A minimal local manual watchlist page is now available through `npm run watchlist:manual`.
- Every activation now posts a separate deterministic level snapshot message into the symbol thread, including support and resistance levels.
- Active symbols now rebuild and repost level snapshots when live price approaches the highest resistance from the last posted snapshot, with anti-spam protection to avoid repeated reposts at the same boundary.
- Automated coverage increased to 85 passing tests.

## 2026-04-15 03:35 PM America/Toronto

### Summary

- Tightened the opportunity interpretation layer for exact-message determinism and fixed-format safety.
- Removed remaining interpretation wording variability by locking each interpretation type to one approved template.
- Strengthened interpretation and runtime-facing tests around exact strings, deterministic repeats, and supported-type coverage.
- Aligned the interpretation plan document with the accepted deterministic implementation and removed stale encoding noise.

### Files updated

- `docs/OPPORTUNITY-OUTPUT-LAYER-PLAN.md`
- `src/lib/monitoring/opportunity-interpretation.ts`
- `src/tests/opportunity-interpretation.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Interpretation now uses a single deterministic message template per type with stable ASCII punctuation.
- Level formatting remains deterministic for identical numeric inputs.
- Tests now verify exact message text, exact console formatting, byte-identical repeat output, and approved-path coverage for all supported interpretation types.
- Automated coverage increased to 76 passing tests.

## 2026-04-15 03:10 PM America/Toronto

### Summary

- Added the opportunity interpretation/output layer as a presentation-only runtime boundary.
- Kept the layer isolated from evaluator, scoring, stability, persistence, and diagnostics behavior.
- Added interpretation tests covering progression, weakening, duplicate suppression, and console formatting.

### Files added

- `src/lib/monitoring/opportunity-interpretation.ts`
- `src/tests/opportunity-interpretation.test.ts`

### Files updated

- `src/lib/monitoring/opportunity-runtime-controller.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Runtime now emits trader-readable context messages after adaptive scoring without affecting any core decision layer.
- Interpretation output follows the staged progression model and suppression rules for local console testing.
- Automated coverage increased to 71 passing tests.

## 2026-04-15 01:45 PM America/Toronto

### Summary

- Wired the opportunity decision stack into the runtime through a dedicated controller layer.
- Kept the staged adaptive boundary intact so runtime now consumes stabilized applied state instead of raw target multipliers.
- Added dedicated evaluator, adaptive scoring, adaptive stability, and runtime integration tests.
- Updated the adaptive stability phase plan to reflect completed implementation progress and current remaining runtime follow-up.

### Files added

- `src/lib/monitoring/adaptive-stability.ts`
- `src/lib/monitoring/opportunity-diagnostics.ts`
- `src/lib/monitoring/opportunity-runtime-controller.ts`
- `src/scripts/run-opportunity-validation-sample.ts`
- `src/scripts/run-live-opportunity-validation.ts`
- `src/scripts/scan-opportunity-recovery-windows.ts`
- `src/scripts/summarize-opportunity-validations.ts`
- `src/tests/opportunity-evaluator.test.ts`
- `src/tests/adaptive-scoring.test.ts`
- `src/tests/adaptive-stability.test.ts`
- `src/tests/opportunity-diagnostics.test.ts`
- `src/tests/opportunity-runtime-integration.test.ts`

### Files updated

- `package.json`
- `src/lib/monitoring/adaptive-scoring.ts`
- `src/lib/monitoring/opportunity-engine.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/runtime/main.ts`
- `docs/adaptive-stability-layer-v1-plan.md`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Runtime now has one explicit integration point for:
  - recent opportunity buffering
  - stabilized adaptive rescoring
  - evaluator tracking
  - evaluation completion updates
- Live flow no longer needs to bypass the adaptive stability layer to get adaptive ranking behavior.
- Runtime snapshots now include structured adaptive diagnostics for:
  - target vs applied global multiplier
  - target vs applied event-type multiplier
  - confidence used
  - weak streak
  - disable state
  - drift dampening state
- Added a replay validation runner that can emit and optionally save structured diagnostics for longer-session review.
- Added an aggregation script for combining multiple replay validation `.ndjson` files into one cross-run report.
- Multi-symbol replay validation now shows:
  - `NVDA` exercised weak-streak growth and disable intent without actually disabling
  - `TSLA` exercised drift dampening activation
  - no replay run triggered an actual disable yet
- Small-cap replay validation now shows much stronger adaptive stress behavior:
  - `BIRD` and `ALBT` triggered `disableIntent`
  - `ALBT` reached `maxWeakStreak = 11`
  - `ALBT` also exercised heavy drift activation
  - target/applied gaps widened materially versus the large-cap batch
  - no initial small-cap replay run triggered a hard disable yet
- Focused longer-window replay validation on `BIRD` and `ALBT` now shows:
  - `BIRD` finally triggered an actual hard disable on `level_touch`
  - the disable happened after a three-step weak streak with `disableReason = negative_expectancy`
  - `BIRD` still avoided abrupt multiplier collapse, with the disabled event type ending near `0.9892`
  - `ALBT` remained in a stressed but protected state with `disableIntent`, heavy drift activation, and no hard disable in the longer replay
- Added a replay-window recovery scanner for recent real `5m` candle history.
- Recovery-focused replay scanning now shows:
  - `ALBT` has multiple windows with weak-phase recovery in `level_touch` and `reclaim`
  - `BIRD` has multiple windows with weak-phase recovery in `level_touch` and `reclaim`
  - these windows do not show snap-back behavior or abrupt multiplier jumps
- Added a fixed-duration live validation runner that captures runtime diagnostics to file for real-session confirmation.
- Initial live small-cap validation (`BIRD`, `HUBC`, `IMMP`, `ALBT`) shows:
  - adaptive diagnostics were produced for `ALBT`
  - live `opportunity_snapshot` and `evaluation_update` sequencing stayed consistent
  - `maxTargetAppliedGap = 0.0326`
  - no eager weak-streak, disable-intent, drift, or hard-disable behavior appeared in this mild live session
- Automated coverage increased to 64 passing tests.

## 2026-04-15 12:55 PM America/Toronto

### Summary

- Added reconnect-state management to the shared IBKR runtime helper.
- Added runtime reconnect and disconnect callback registration.
- Integrated reconnect-aware market-data resubscription into the IBKR live price provider.
- Added tests covering `1101` re-request behavior and `1102` no-duplicate behavior.

### Files updated

- `src/scripts/shared/ibkr-runtime.ts`
- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Shared runtime now tracks:
  `isConnected` and `reconnecting`
- Shared runtime now emits callback-based reconnect/disconnect notifications.
- Live provider now re-requests market data after `1101` and avoids duplicate requests after `1102`.
- Automated coverage increased to 16 passing tests.

## 2026-04-15 12:35 PM America/Toronto

### Summary

- Centralized repeated IBKR script configuration into a shared runtime helper.
- Added restart-safety test coverage for the live provider.
- Kept the manual historical fetch path working after the script refactor.

### Files added

- `src/scripts/shared/ibkr-runtime.ts`

### Files updated

- `src/scripts/run-manual-level-test.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run manual:test -- AAPL`

### Observed outcome

- The script entrypoints no longer duplicate the default IBKR host/port/clientId setup.
- Live provider lifecycle coverage now includes stop/start reset behavior.
- Automated coverage increased to 14 passing tests.

## 2026-04-15 12:20 PM America/Toronto

### Summary

- Unified IBKR client ownership in the live alerts sample so historical seeding and live monitoring can share one `IBApi` connection.
- Updated the live provider to support injected `IBApi` clients in addition to self-owned host/port/clientId construction.
- Added tests covering injected-client behavior for the live provider.

### Files updated

- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run watchlist:alerts:test -- AAPL` (validated live output before timeout cutoff)

### Observed outcome

- The live provider now works in both modes:
  self-managed connection and injected shared client.
- The integrated live alerts sample emitted trader-facing output while using the shared client path.
- Test coverage increased to 13 passing tests.

## 2026-04-15 12:05 PM America/Toronto

### Summary

- Added mocked tests for both IBKR providers.
- Reduced monitoring noise further by making resistance rejection detection episodic in tests and logic.
- Kept the replay monitoring sample compact and validated after the detector change.

### Files added

- `src/tests/ibkr-historical-candle-provider.test.ts`
- `src/tests/ibkr-live-price-provider.test.ts`

### Files updated

- `src/lib/monitoring/event-detector.ts`
- `src/tests/monitoring-events.test.ts`

### Verification completed

- `npm test`
- `npm run watchlist:test -- AAPL`

### Observed outcome

- Automated coverage increased from 6 tests to 12 tests.
- IBKR historical provider behavior is now covered for:
  request mapping, response mapping, empty response handling, and request-scoped error handling.
- IBKR live provider behavior is now covered for:
  subscription setup, normalized updates, ignored invalid ticks, and cleanup.
- Replay monitoring sample for `AAPL` now reports only 4 emitted events in the current run.

## 2026-04-15 11:40 AM America/Toronto

### Summary

- Added an ongoing change-log document and linked it from the docs index.
- Initialized the project as a local Git repository on branch `main`.
- Added a repository `README.md`.
- Added `.gitattributes` for cleaner Git line-ending behavior.
- Created a short GitHub setup doc covering the remaining remote-push steps.
- Created the initial repository commit.

### Files added

- `README.md`
- `.gitattributes`
- `docs/15_PROJECT_CHANGE_LOG.md`
- `docs/16_GITHUB_REPO_SETUP.md`

### Files updated

- `.gitignore`
- `docs/00_DOC_INDEX.md`

### Git state

- Local repository initialized with `git init -b main`
- Initial commit created:
  `Initial project import and IBKR integration progress`

### Remaining GitHub step

- Create a remote repository on GitHub and push `main`
- See `docs/16_GITHUB_REPO_SETUP.md`

## 2026-04-15 11:25 AM America/Toronto

### Summary

- Added a lightweight automated test suite and test script.
- Reduced monitoring noise by making compression alerts episodic instead of per-tick.
- Centralized script-level IBKR connection waiting logic.
- Hardened the real IBKR live price provider lifecycle.
- Fixed missing alert intelligence types and IBKR historical provider typing issues.
- Converted key runtime flows to real IBKR-backed historical data and validated them.

### Files added

- `src/tests/candle-fetch-service.test.ts`
- `src/tests/monitoring-events.test.ts`
- `src/tests/alert-intelligence.test.ts`
- `src/scripts/shared/ibkr-connection.ts`

### Files updated

- `package.json`
- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/alert-scorer.ts`
- `src/lib/market-data/ibkr-historical-candle-provider.ts`
- `src/lib/monitoring/event-detector.ts`
- `src/lib/monitoring/ibkr-live-price-provider.ts`
- `src/scripts/run-manual-level-test.ts`
- `src/scripts/run-watchlist-monitor-sample.ts`
- `src/scripts/run-watchlist-alerts-sample.ts`

### Verification completed

- `npm run build`
- `npm test`
- `npm run alert:test`
- `npm run manual:test -- AAPL`
- `npm run watchlist:test -- AAPL`
- `npm run watchlist:alerts:test -- AAPL`

### Observed outcome

- The project compiles cleanly.
- The new automated tests pass.
- Historical fetch, replay monitoring, and live watchlist alert flows all ran successfully in this environment.
- Replay monitoring noise improved materially:
  `AAPL` replay sample dropped from `189` emitted events to `39`, with compression events dropping from `152` to `3`.

### Remaining follow-up ideas

- Reduce rejection-event noise further.
- Add mocked tests around the IBKR historical and live providers.
- Unify ownership of `IBApi` clients across scripts and runtime flows.

## 2026-04-15 11:20 AM America/Toronto

### Symbol memory and context layer

- Added `src/lib/monitoring/symbol-state.ts` to track per-symbol recent event memory, derived bias, and pressure score.
- Extended monitoring events with `bias` and `pressureScore` so downstream alerting receives symbol context with every emitted signal.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to incorporate recent behavior into signal scoring:
  repeated tests increase breakout odds, failed breakouts strengthen rejection context, and conflicting bias penalizes signals.
- Wired `src/lib/monitoring/event-detector.ts` and `src/lib/monitoring/watchlist-monitor.ts` into the new symbol-state flow so emitted events update memory instead of staying stateless.
- Patched alert fixtures in `src/tests/alert-intelligence.test.ts` and `src/scripts/run-alert-intelligence-sample.ts` to match the richer event shape.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The event pipeline now preserves short-term symbol context without breaking the existing monitor or alert engine interfaces.
- Build and test verification both pass after the symbol-memory upgrade.

## 2026-04-15 11:55 AM America/Toronto

### Time-decay weighting for symbol memory

- Updated `src/lib/monitoring/symbol-state.ts` to decay symbol memory over time instead of treating all recent events equally.
- Recent events now carry an internal `memoryWeight` based on exponential decay, with deterministic pruning of stale events older than the configured memory window.
- Bias and pressure calculations now use weighted event memory, so newer interactions influence context more than older ones.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to score signals against decayed symbol context using the event timestamp as the reference point.
- Added `src/tests/symbol-state.test.ts` to verify stale-event pruning and recency-weighted bias behavior.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Symbol-level context is now more responsive to fresh behavior while still retaining short-lived memory of recent tests and failures.
- Build and test verification both pass after the decay-weighting update.

## 2026-04-15 12:20 PM America/Toronto

### Pressure structure detection layer

- Extended `src/lib/monitoring/symbol-state.ts` with deterministic structure detection built on top of weighted symbol memory.
- Symbol context now identifies:
  - `compression`
  - `breakout_setup`
  - `rejection_setup`
- Structure detection uses explicit thresholds based on weighted repeated tests, accelerating test intervals, recent bias, and failed breakout memory.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` so breakout-oriented events are boosted during `breakout_setup` and rejection-oriented events are boosted during `rejection_setup`.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The scoring layer now responds to higher-order setup patterns instead of only raw event counts.
- Build and test verification both pass after the structure-layer upgrade.

## 2026-04-15 12:40 PM America/Toronto

### Range compression and structure resolution

- Refined `src/lib/monitoring/symbol-state.ts` so compression structure now combines:
  - repeated tests
  - tightening test intervals
  - shrinking trigger-price range
- Added `rangeCompressionScore` to symbol context and incorporated it into compression and breakout-setup detection.
- Switched structure strength to non-linear scaling using `1 - exp(-pressureScore + bonus)` style behavior for smoother saturation under high pressure.
- Added structure resolution behavior: when a zone resolves with breakout, breakdown, rejection, or reclaim, compression-related memory for that zone is cleared so stale setup pressure does not linger.
- Updated `src/lib/monitoring/monitoring-event-scoring.ts` to amplify rejection-oriented signals when high pressure and failed-breakout memory stack together.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Compression setups now require both repeated interaction and visibly tightening structure.
- Resolved zones reset their local setup memory, which keeps future scoring cleaner and less sticky.
## 2026-04-16 11:40 AM America/Toronto

### Trader-facing Discord snapshot zone compression

- Updated Discord level snapshot output to render compact display zones instead of only dense nearby discrete prices.
- Snapshot payloads now carry price-relative `supportZones` and `resistanceZones`, where each displayed zone includes:
  - `representativePrice`
  - optional `lowPrice`
  - optional `highPrice`
- Final display zones are formed after the existing price-relative filtering, duplicate removal, and near-level compaction pass.
- Nearby displayed levels are now merged into deterministic trader-facing zones using a bounded display-layer tolerance.
- Representative selection within a displayed zone uses existing metadata in deterministic order:
  - `strengthScore`
  - `confluenceCount`
  - `sourceEvidenceCount`
  - timeframe bias
  - freshness
  - then actionable distance to current price
- Snapshot formatting now shows:
  - representative price always
  - range only when it adds real meaning
  - nearest support zones first going downward
  - nearest resistance zones first going upward

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live Discord snapshots are now materially more readable and trader-usable because tightly packed neighboring prices are presented as compact zones instead of dense numeric staircases.

## 2026-04-16 11:10 AM America/Toronto

### Price-anchored Discord level snapshots

- Updated manual watchlist snapshot posting so trader-facing support and resistance are now partitioned relative to the snapshot reference price instead of the original structural support/resistance origin buckets.
- Added `referencePrice` to level output metadata, sourced from the freshest available runtime candle path with preference order:
  - `5m` last close
  - `4h` last close
  - `daily` last close
- Updated snapshot formatting to include the current reference price explicitly in the Discord level snapshot message.
- Added deterministic near-price tolerance handling so levels extremely close to the snapshot price are excluded from both displayed support and displayed resistance instead of being misclassified by tiny drift.
- Added targeted tests covering:
  - snapshot price inclusion
  - price-relative support/resistance partitioning
  - deterministic near-price tolerance behavior

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live level snapshots now read like trader-facing ladders anchored to the actual snapshot price, which avoids showing "resistance" below market or "support" above market.

## 2026-04-16 10:20 AM America/Toronto

### Real Discord manual activation path

- Added `src/lib/alerts/discord-rest-thread-gateway.ts` to support real Discord thread reuse, recovery, creation, and message posting through the existing alert-router boundary.
- Updated `src/runtime/manual-watchlist-server.ts` so the manual watchlist activation flow now uses the real Discord REST gateway when `DISCORD_BOT_TOKEN` and `DISCORD_WATCHLIST_CHANNEL_ID` are configured, while preserving the existing local gateway fallback for manual/local testing.
- Added `src/tests/discord-rest-thread-gateway.test.ts` to verify:
  - thread creation under the configured watchlist channel
  - exact-name recovery
  - deterministic level snapshot posting into the target thread
- Added `.env` loading for the manual runtime via `dotenv/config`, plus startup diagnostics that show whether Discord env values are present or missing and whether the runtime is using the real Discord gateway or local fallback.
- Added `.env.example` with the Discord/manual runtime variables needed for the first live watchlist test.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The existing manual activation workflow is now wired to a real Discord posting path without changing the watchlist/runtime architecture.
- Ticker entry can now drive real thread creation/reuse and initial level posting when Discord credentials are present.

## 2026-04-16 11:05 AM America/Toronto

### Discord snapshot ladder coverage and zone display hardening

- Updated the manual watchlist snapshot display path in `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so resistance snapshots now honor the product's forward planning window and can surface meaningful resistance zones out to 50 percent above the snapshot price when valid levels exist.
- Kept support and resistance display price-relative while preserving the existing duplicate removal, near-level compaction, representative selection, and deterministic ordering behavior.
- Added a minimum meaningful zone-width rule so very narrow grouped zones now collapse to a single representative level instead of rendering as visually noisy low-to-high ranges.
- Updated `src/tests/manual-watchlist-runtime-manager.test.ts` to cover:
  - forward resistance ladder coverage through the 50 percent planning range
  - narrow grouped zone collapse to a single level
  - preservation of wider grouped zone range formatting
  - deterministic compact snapshot behavior

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Live Discord level snapshots now carry farther forward-looking resistance coverage without reverting to dense micro-level output, and narrow reaction clusters no longer present fake-looking trader-facing zones.

## 2026-04-16 11:40 AM America/Toronto

### Resistance snapshot selection validation hardening

- Validated the live resistance snapshot path against a real chart-review concern where a meaningful isolated intermediate wick-high could be skipped inside the forward ladder window.
- Confirmed the weakness was in the final capped trader-facing resistance selection, not a broad failure of raw level generation.
- Updated `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so capped resistance snapshot zones now preserve:
  - nearest resistance context
  - farthest forward-planning context
  - the strongest representative inside each middle coverage segment
- This keeps the Discord ladder compact while allowing a structurally meaningful intermediate wick-high zone to survive final display selection when it is genuinely stronger than nearby leftovers.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Trader-facing resistance snapshots remain compact, but they are less likely to skip a useful intermediate wick-high level inside the forward planning range.

## 2026-04-16 12:20 PM America/Toronto

### Structural truth audit: resistance extension ladder

- Audited the candle-data-to-level pipeline across:
  - swing detection
  - raw candidate generation
  - candidate evidence quality
  - clustering
  - scoring
  - surfaced selection
  - extension ladder generation
- Confirmed isolated meaningful wick highs are still detected as raw resistance candidates from candle data.
- Identified the first materially weak stage as extension ladder generation: nearby micro-structure could consume forward extension slots and crowd out a stronger isolated higher-timeframe wick-high farther ahead.
- Updated `src/lib/levels/level-extension-engine.ts` with a bounded pruning step that removes a weaker nearby forward candidate when a materially stronger forward structural candidate exists in the same local band.
- This keeps the ladder compact while making forward resistance planning less dependent on stair-step local leftovers.

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The structural pipeline now preserves meaningful isolated forward wick-high resistance more reliably without reopening the broader level engine or reverting to cluttered ladders.

## 2026-04-16 12:45 PM America/Toronto

### Forward resistance ladder continuity refinement

- Refined `src/lib/levels/level-extension-engine.ts` so forward resistance extension selection now preserves:
  - near resistance context
  - at least one meaningful intermediate structural step when available
  - far-forward planning reach
- Kept the 50 percent forward-range behavior intact while preventing the far-forward slot from effectively wiping out all intermediate ladder continuity.
- Added/updated tests in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
- New coverage confirms:
  - raw isolated wick-high resistance is still detected
  - nearby micro-structure does not crowd out a stronger forward wick-high
  - compact runtime snapshots preserve near, intermediate, and far resistance continuity without regressing into clutter

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Forward resistance ladders now remain compact while carrying a more usable stepwise path for traders instead of jumping too directly from nearby levels to the far bound.

## 2026-04-16 04:40 PM America/Toronto

### Cluster representative truth and temporary discrete snapshot output

- Refined `src/lib/levels/level-clusterer.ts` so clustered zones now keep a trader-meaningful representative price instead of averaging nearby candidates into a midpoint.
- Representative selection now prefers stronger existing candle evidence:
  - higher timeframe
  - stronger rejection
  - stronger follow-through
  - stronger reaction quality / displacement / touch evidence
- This preserves real wick-led prices inside merged zones more honestly, especially for nearby resistance and support areas that should remain anchored to an actual chart price.
- Updated `src/lib/monitoring/manual-watchlist-runtime-manager.ts` so live snapshots temporarily output discrete representative levels only and no longer collapse nearby levels into bracketed display ranges.
- Updated snapshot formatting tests in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/manual-watchlist-runtime-manager.test.ts`
  - `src/tests/alert-router.test.ts`
  - `src/tests/discord-rest-thread-gateway.test.ts`

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- The structural pipeline now preserves actual wick/decision prices more faithfully, and live Discord snapshots show discrete levels directly while structural tuning continues.

## 2026-04-16 05:15 PM America/Toronto

### Surfaced ladder same-band dominance refinement

- Refined `src/lib/levels/level-ranker.ts` so surfaced selection is less likely to preserve every nearby resistance/support step inside the same local band when one nearby level is already materially stronger.
- This change does not add a new scoring system. It strengthens the existing surfaced-selection dominance rule by:
  - using a slightly wider same-band radius suitable for volatile small-cap names
  - still requiring the nearby incumbent level to be materially stronger before suppressing a challenger
- Added focused regression coverage in `src/tests/level-engine.test.ts` to confirm:
  - weaker nearby band clutter is reduced
  - stronger near-anchor levels still survive
  - farther meaningful structure still survives

### Verification completed

- `npm run build`
- `npm test`

### Observed outcome

- Dense nearby resistance bands are now less likely to surface as a staircase of equally important-looking levels when one nearby anchor level is clearly stronger.

## 2026-04-16 05:45 PM America/Toronto

### Level validation system plan added

- Added `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`.
- This plan formalizes the next high-value build direction:
  - synthetic scenario validation
  - level persistence and churn validation
  - forward reaction validation
- The goal is to give future support/resistance tuning a stronger evidence base than ad hoc live chart review alone.

## 2026-04-16 06:05 PM America/Toronto

### Validation workflow kickoff and live candle-source health checks

- Added `src/tests/level-validation-scenarios.test.ts` as the first dedicated scenario-validation file for the support/resistance engine.
- Added `src/tests/helpers/level-validation-fixtures.ts` to keep structural scenario setup reusable and deterministic.
- Added `src/lib/validation/candle-source-health.ts` to classify live candle-provider behavior as:
  - `healthy`
  - `degraded`
  - `unavailable`
- Added `src/tests/candle-source-health.test.ts` to verify:
  - healthy provider responses
  - empty provider responses
  - thrown provider failures
- Added `src/scripts/run-level-candle-health-check.ts` and package script:
  - `npm run validation:levels:live -- <SYMBOL>`
- The live validator uses the active provider path and is intended to run against IBKR now, while still supporting future provider switching through environment/config.
- Updated `src/runtime/manual-watchlist-server.ts` to log the active candle provider path at startup so live validation can distinguish provider-path issues from level-logic issues.
- Added reminder notes in:
  - `docs/17_REPO_REVIEW_IMPLEMENTATION_DIRECTIVE.md`
  - `docs/18_LEVEL_VALIDATION_SYSTEM_PLAN.md`
  so future tuning stays validation-first.

## 2026-04-16 08:35 PM America/Toronto

### Evidence-led extension selection refinement

- Used the improved validation stack in small live IBKR passes on `GXAI` and `PBM` instead of making another guess-driven structural change.
- Confirmed:
  - persistence is still honest and strong
  - `near` usefulness can work
  - `intermediate` / `far` usefulness remains weaker
  - extension usefulness remains the weakest consistent area
- Narrowly refined `src/lib/levels/level-extension-engine.ts` so forward resistance selection now:
  - rewards decision quality more explicitly
  - penalizes weak `5m` continuation leftovers more directly
  - preserves an actionable near continuation step instead of pruning it too early
- Added focused tests proving:
  - a decisive forward resistance can outrank a weak intraday leftover
  - near / intermediate / far continuity still survives when the near step is genuinely actionable

## 2026-04-17 09:40 AM America/Toronto

### Practical forward-bound extension refinement

- Used live IBKR validation and live snapshot inspection on small-cap symbols including:
  - `GXAI`
  - `PMNT`
  - `PBM`
  - `RMSG`
  - `FJET`
- Confirmed the next real weakness was not churn:
  - persistence remained strong
  - loose remapping stayed near zero
  - far / extension usefulness remained the weak area
- Found the narrower structural issue:
  - very far surfaced resistance could push the extension frontier too far forward
  - resistance extension selection could still choose the absolute farthest candidate instead of the practical forward frontier
- Refined `src/lib/levels/level-extension-engine.ts` so resistance extensions now:
  - use the practical surfaced frontier relative to live `referencePrice`
  - cap resistance extension candidates to the trader-facing forward planning range when `referencePrice` is available
  - preserve actionable near / intermediate continuity while avoiding unusably far extension jumps
- Passed the practical live spot check:
  - `GXAI` extension resistance moved into `1.74 / 1.82 / 1.97`
  - `PMNT` extension resistance moved into `0.4945 / 0.5200 / 0.5600`

## 2026-04-17 10:05 AM America/Toronto

### Surfaced resistance capped to practical forward range

- Ran a live market-hours evidence pass on:
  - `GXAI`
  - `PMNT`
- Confirmed the post-extension-refinement pattern:
  - surfaced usefulness remained positive
  - extension usefulness still lagged
  - the next narrow weakness was the surfaced/extension boundary, not general stability
- Found that surfaced resistance could still include levels beyond the trader-facing `50%` forward planning range before extension selection even began.
- Refined `src/lib/levels/level-ranker.ts` so surfaced resistance selection now:
  - uses the live `referencePrice` when available
  - excludes surfaced resistance zones beyond the practical forward planning range
  - leaves support behavior unchanged
- Added a focused test in `src/tests/level-ranker.test.ts` proving resistance beyond the practical forward range does not surface when `referencePrice` is known.
- Live snapshot improvement after the ranker change:
  - `GXAI` no longer surfaced `2.65`; snapshot tightened to `1.36 / 1.40 / 1.53 / 1.64 / 1.67 / 1.85`
  - `PMNT` no longer surfaced `0.80`; snapshot tightened to `0.3823 / 0.4699 / 0.5200`

## 2026-04-17 10:10 AM America/Toronto

### Forward validation now ignores non-actionable wrong-side levels

- During the next live market-hours evidence pass on:
  - `PBM`
  - `RMSG`
- Found that the forward reaction validator was still grading raw surfaced zones even when:
  - a `support` was already above the live reference price
  - or a `resistance` was already below the live reference price
- That meant the validation layer could understate real support/resistance usefulness compared with the trader-facing snapshot, which already filters levels relative to the current price.
- Refined `src/lib/validation/forward-reaction-validator.ts` so forward validation now evaluates only actionable levels:
  - supports below the live reference price
  - resistances above the live reference price
- Added focused coverage in `src/tests/forward-reaction-validator.test.ts`.
- Live effect after the validation fix, without touching the level engine:
  - `PBM/RMSG` combined surfaced resistance usefulness improved from `0.0500` to `0.1250`
  - combined `far` usefulness improved from `0.0000` to `0.0384`
- This clarified that part of the earlier weak resistance / far reading was a validation mismatch, not only a structural chart-reading failure.

## 2026-04-17 10:35 AM America/Toronto

### Surfaced bucket ownership now respects the live side of price

- After correcting the forward validator, used a fresh live market-hours pass on:
  - `GXAI`
  - `PMNT`
- Found the next structural weakness more clearly:
  - raw surfaced support / resistance buckets could still retain zones on the wrong side of the live reference price
  - those wrong-side surfaced zones were being filtered out later by the snapshot path, but they could still distort surfaced ownership and extension handoff inside the engine
- Refined `src/lib/levels/level-ranker.ts` so surfaced bucket selection now only keeps actionable zones when `referencePrice` is available:
  - supports below live price
  - resistances above live price and within the practical forward planning range
- Added focused coverage in `src/tests/level-ranker.test.ts`.
- Live post-fix evidence:
  - raw surfaced resistance no longer kept obvious below-price leftovers on `GXAI` / `PMNT`
  - `PMNT` regained a real extension resistance ladder: `0.5600 / 0.5800 / 0.5877`
  - `GXAI/PMNT` batch rerun improved combined surfaced resistance usefulness to `0.3333`
  - combined `far` usefulness improved to `0.0667`
- Fresh trader-facing snapshots after the fix:
  - `GXAI` -> `1.36 / 1.40 / 1.53 / 1.64 / 1.67 / 1.85 / 1.97`
  - `PMNT` -> `0.4183 / 0.4500 / 0.4699 / 0.5100 / 0.5200 / 0.5600 / 0.5877`

## 2026-04-17 11:30 AM America/Toronto

### Timeframe role-split plan added

- Added `docs/19_TIMEFRAME_ROLE_SPLIT_PLAN.md`.
- Captured the current design recommendation from live small-cap work:
  - `daily` should remain the major structural backbone
  - `4h` should remain the intermediate structural layer
  - `15m` is the best candidate for future intraday structural context
  - `5m` should be treated more like micro-context than a major support/resistance authority
- Also documented the related higher-timeframe lookback problem:
  - some small-cap runners likely need deeper `daily` / `4h` history to expose real overhead resistance
- This is a design-direction document, not a rushed timeframe implementation.

## 2026-04-17 12:05 PM America/Toronto

### Structural reads now tolerate missing `5m`

- Implemented the first concrete step from the timeframe role-split plan:
  - weak or missing `5m` should not make the whole symbol unreadable when `daily` and `4h` are still usable
- Refined `src/lib/levels/level-engine.ts` so:
  - `daily` and `4h` remain mandatory structural inputs
  - `5m` is now optional for structural generation
  - when `5m` is unavailable, the engine falls back to higher-timeframe structure instead of failing the full symbol
  - `referencePrice` falls back from `5m` to `4h` to `daily`
  - output metadata now records `5m:unavailable`
- Refined `src/lib/validation/level-validation-batch.ts` and `src/scripts/run-level-validation-batch.ts` so:
  - a symbol is only fully `unavailable` when `daily` or `4h` are unavailable
  - `5m`-only failures are treated as `degraded`
  - batch validation can still produce persistence and partial structural evidence when forward `5m` validation is unavailable
- Added focused coverage in:
  - `src/tests/level-engine.test.ts`
  - `src/tests/level-validation-batch.test.ts`
- Live effect on a weak-intraday name:
  - `FAMI` no longer collapses into an unusable symbol just because `5m` is poor
  - validation can still surface a higher-timeframe structural read and show that the real weak area is extension usefulness, not total unreadability
