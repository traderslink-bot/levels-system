# Small-Cap Materiality And Trader Output Completion Plan

## What This File Is For

This is the focused progress tracker for the small-cap trader-output work that sits inside the bigger candle-intelligence roadmap.

The big plan in `docs/69_CANDLE_INTELLIGENCE_PHASED_COMPLETION_PLAN_2026-05-03.md` tracks the whole candle engine. This file tracks one specific product problem: small-cap stocks can wiggle by pennies, rotate between nearby support/resistance areas, and create too many Discord posts if the system treats every small print as a meaningful market event.

Use this file when working on:

- small-cap materiality thresholds
- candle reaction quality
- clustered support/resistance zones
- first snapshot trade maps
- live post noise policy
- saved-data audits that prove the app is quieter without hiding real moves

## Product Standard

The app should help long-biased small-cap traders understand the ticker story without sounding like a trade signal machine.

Good output:

- identifies the practical support/resistance area
- separates minor probes from meaningful reactions
- explains accepted expansion, clean support loss, reclaim, and failed breakout in trader language
- keeps all levels in the full ladder
- avoids direct buy/sell/entry/exit advice
- avoids pretending one-cent movement in a small cap is automatically major risk

Bad output:

- posts every touch/cross/reclaim inside the same tight box
- treats tiny penny wiggles as clean breaks
- says risk opens toward a level one cent away
- hides support/resistance levels to reduce noise
- says no resistance exists when the system only lacks enough forward candle proof
- creates standalone commentary streams for every derived context

## Current Implemented State

Status as of 2026-05-03:

- First snapshot posts include a `Trade map`.
- First snapshot posts include `Main trade area`.
- Close penny levels are grouped into practical support/resistance zones for the trader map.
- Full support/resistance ladders still show every retained level.
- Support-only or resistance-only maps use fresh-check wording instead of implying no higher/lower level exists.
- Live policy already uses practical area, range-box, stable 5m structure, acceptance, failed-level memory, and behavior budget evidence to reduce repeated same-area chatter.
- Candle reaction context now records:
  - `rangePct`
  - `levelDistancePct`
  - `materialityLabel`
- Candle reaction classification now receives the small-cap meaningful-move floor from volatility context.
- Level-quality calibration now records:
  - nearest support/resistance distance
  - first forward support/resistance gaps
  - tight nearby support/resistance cluster counts
  - `crowded_nearby_levels`
- Snapshot level context now flags clustered nearby levels as practical zones.

Latest verification:

```powershell
npx tsx --test src/tests/trader-context.test.ts
npx tsx --test src/tests/alert-router.test.ts
npx tsx --test src/tests/live-thread-post-policy.test.ts
npx tsx --test src/tests/advanced-candle-context-report.test.ts src/tests/first-snapshot-trade-map-audit.test.ts src/tests/market-structure-calibration-report.test.ts
npm run build
npm test
git diff --check
```

Latest saved-data smoke checks:

```powershell
npm run audit:first-snapshots -- artifacts\long-run\2026-05-01_10-48-03
npm run candles:advanced-context -- --max-symbols 25
npm run structure:calibrate -- --max-files-per-symbol 2 --audit-limit 500
```

Observed result:

- first snapshots: 18 symbols, 18 strong, average 94.6/100
- advanced context: 25 symbols, 25 ready, 16 weak-data watch cases
- market-structure calibration: 64 symbols, 10 trusted, 27 watch, repeat pressure still visible in older saved posts

## Phase 1: Materiality Threshold Calibration

Goal: stop penny-level wiggles from becoming major structure events.

Implemented:

- `CandleReactionContext.materialityLabel`
- `rangePct`
- `levelDistancePct`
- small-cap volatility floor passed into candle reaction classification
- tests proving tiny support slips stay `indecision` while material support losses still classify as `support_loss`

Next work:

1. Run broad saved-data calibration after more warehouse gaps are backfilled.
2. Compare materiality labels against saved posts that felt too dramatic.
3. Add regression cases for known tiny-probe mistakes.
4. Tune the material floor if saved data shows it is too strict or too loose.
5. Add audit report columns for `materialityLabel`, body/range/level-distance evidence, and whether the post reached Discord.

Acceptance:

- one-cent or two-cent churn in low-priced names does not create support-loss/breakout language unless the candle move is material
- material fast moves still pass through
- saved-data audits show examples for both suppression and allowed events

## Phase 2: Practical Zone And Cluster Quality

Goal: keep full ladders complete while presenting crowded nearby levels as practical trader zones.

Implemented:

- compact snapshot display entries
- practical support/resistance area grouping
- `crowded_nearby_levels`
- tight support/resistance cluster counts
- first forward support/resistance gap evidence
- clustered-zone wording in first snapshot context

Next work:

1. Add all-symbol saved-data report for crowded zone frequency.
2. Compare clustered zones against raw full ladders to prove no levels are hidden.
3. Add cases where tight clusters should stay one practical zone.
4. Add cases where levels are close but should remain separate because the zone is too wide or the strength differs materially.
5. Add audit evidence for first forward gap after the cluster.

Acceptance:

- trader map uses practical zones
- full ladder remains complete
- no fake levels are invented
- no real levels are deleted for noise reduction

## Phase 3: First Snapshot Trade Map Upgrade

Goal: make the first post look like a real trader map, not a raw data dump.

Implemented:

- `Trade map`
- `Main trade area`
- `Cleaner above`
- `Support that matters`
- `Broader support`
- short-term momentum support
- level context line
- fresh higher/lower level check wording when forward levels are missing

Next work:

1. Add direct first-post score categories for:
   - main area present
   - important support present
   - cleaner-above condition present
   - first forward gap present when available
   - clustered-zone clarity present when levels are crowded
   - small-cap penny-risk wording absent
2. Add snapshot tests for runner, range, support-only, resistance-only, and crowded-zone maps.
3. Add saved-data examples from the strongest and weakest first snapshots.
4. Ensure the map does not over-emphasize tiny support differences.
5. Keep the post compact enough for Discord readability.

Acceptance:

- first snapshot audit stays strong on recent sessions
- weak first snapshots become regression cases
- wording remains observational and non-advisory

## Phase 4: Structure-Aware Noise Policy

Goal: treat each ticker thread as one evolving trade story instead of posting every micro touch.

Implemented:

- same-story cooldown
- same-story materiality check
- practical-area lock
- range-box chop suppression
- boring-range behavior budget
- stable 5m structure repeat suppression
- practical area flip-chop suppression
- accepted directional changes still pass through

Next work:

1. Thread candle reaction `materialityLabel` into operator audit rows and replay records where useful.
2. Add replay checks that compare suppressed posts against material candle moves.
3. Add policy tests for repeated tiny materiality-minor crosses inside one box.
4. Add policy tests for accepted material expansion that must still post.
5. Add daily post-budget verdicts by symbol behavior:
   - low-priced chop
   - range-bound small cap
   - active runner
   - extreme runner

Acceptance:

- repeated tight-box churn is quiet
- real accepted breakouts/reclaims/support losses still post
- every quiet decision can be audited with candle evidence or flagged as unproven

## Phase 5: Candle Reaction Quality

Goal: distinguish clean reactions from messy candles.

Current reaction labels:

- `strong_close_through`
- `wick_rejection`
- `support_defense`
- `support_loss`
- `failed_breakout`
- `reclaim`
- `indecision`
- `unknown`

Next work:

1. Add reaction quality buckets:
   - `clean`
   - `mixed`
   - `weak`
   - `unknown`
2. Track evidence:
   - close location
   - body percent
   - wick percent
   - level distance
   - range percent
   - volume/activity context when reliable
3. Add replay examples for clean breakout candles, failed breakout wicks, support-defense wicks, and indecision.
4. Use reaction quality in post suppression and first snapshot context only after saved-data calibration.

Acceptance:

- candle reaction facts help explain why a post did or did not fire
- Discord wording stays minimal and trader-readable
- weak reaction quality does not become its own Discord category

## Phase 6: Saved-Data And Regression Gates

Goal: make this work measurable.

Use these commands:

```powershell
npm run stress:all-symbols
npm run scenario:smallcap
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:first-snapshots -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- --all-sessions
npm run candles:regression-pack -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:regression-gate -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:advanced-context -- --max-symbols 50
npm run structure:calibrate -- --max-files-per-symbol 2 --audit-limit all
```

Next work:

1. Add materiality-specific cases to `candles:regression-pack`.
2. Add cluster-zone-specific cases to `candles:regression-pack`.
3. Add first-snapshot practical-zone checks to regression gate.
4. Add why-no-post proof rows for materiality-minor suppressed events.
5. Record saved examples in docs when a live user-visible issue is found.

Acceptance:

- broad saved-data replay catches regressions
- materiality and clustered-zone failures become enforceable cases
- audits explain both overposting and potential missed moves

## Phase 7: Live Validation Checklist

Goal: validate the system during the next market session without changing rules blindly.

During live testing, watch for:

- ticker posts over 20 times without a runner-level reason
- repeated touch/cross/reclaim loops inside one support/resistance box
- support loss posts where price only slipped a penny or two
- resistance cleared posts where price barely tapped above and fell back
- missing next resistance after a runner clears the top surfaced level
- first snapshot maps that do not identify main support/resistance
- posts that sound advisory or too certain

After live testing, run:

```powershell
npm run audit:eod-verdict -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:why-no-post -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run quality:posts -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run audit:first-snapshots -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
npm run candles:advanced-context -- --max-symbols 50
npm run stress:all-symbols
```

Acceptance:

- live issues become regression cases
- no tuning is accepted based only on vibes
- Discord remains trader-view only

## Progress Tracker

| Area | Status | Next Action |
| --- | --- | --- |
| Small-cap materiality floor | Implemented initial pass | Calibrate on saved/backfilled data |
| Candle reaction evidence | Implemented initial pass | Add reaction quality buckets |
| Practical level clusters | Implemented initial pass | Add broad cluster audit/regression cases |
| First snapshot trade map | Strong recent audit | Expand first-post checklist and regression gates |
| Noise policy | Strong foundation | Thread materiality evidence into replay/audit rows |
| Why-no-post proof | Implemented | Add materiality-minor suppression examples |
| Live validation | Pending market session | Run checklist after next live test |

## Definition Of Done

This focused work is done when:

- current code can distinguish minor small-cap wiggles from material candle reactions
- first snapshots consistently explain practical support/resistance areas
- clustered levels are grouped for readability but preserved in the full ladder
- repeated same-area churn is suppressed without hiding accepted expansion
- saved-data regression gates include materiality and clustered-zone cases
- live validation confirms the behavior on fresh tickers
- all changes pass `npm run build`, `npm test`, and saved-data audits
