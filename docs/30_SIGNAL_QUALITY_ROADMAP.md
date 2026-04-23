# Signal Quality Roadmap

## Purpose

This document is the living tracker for ideas, priorities, progress, and open questions related to making the app:

- more useful to the end user
- more trustworthy operationally
- better at describing support, resistance, breakouts, reclaims, and dip-buy style opportunities
- easier to improve over time without losing the thread of why changes were made

This should be updated whenever a meaningful signal-quality or trader-output improvement ships, or when a new important improvement idea is identified.

## Current Priorities

### 1. Trader-facing output quality

- Make Discord messages explain what happened in plain English.
- Use trader-friendly zone language such as `light support`, `heavy resistance`, and `major support`.
- Prefer actionable wording over internal implementation words like `inner`, `merged`, or `remap`.
- Tell the user what to watch next and what invalidates the setup.

### 2. Signal-to-noise quality

- Keep low-value alerts from crowding out useful ones.
- Separate operational review from event-diagnostic review.
- Track which alert families are useful versus noisy in live sessions.

### 3. Detection quality

- Keep support and resistance ranking grounded in structural evidence, not only proximity.
- Improve breakout and reclaim quality using live evidence, not only unit tests.
- Improve dip-buy style interpretation so strong support tests are highlighted more clearly than weak inner noise.

### 4. AI-assisted commentary

- Use AI as an explanation and summarization layer on top of deterministic signals.
- Do not use AI as the raw market-data source or sole execution engine.
- Feed AI structured event facts after the deterministic engine has already made the core call.

## Shipped Progress

### 2026-04-22

- Added structured runtime lifecycle logs.
- Added local Discord delivery audit files for long-run sessions.
- Split long-run review into operational and diagnostic surfaces.
- Added a live session summary for long-run testing.
- Added per-symbol session-summary tracking for lifecycle, delivery, diagnostics, failures, and opportunity updates.
- Added runtime-status visibility for the operator.
- Improved trader-facing alert payloads with severity, confidence, score, and trigger.
- Improved trader-facing alert wording so breakout, breakdown, reclaim, failed-move, and dip-buy style support tests are described in more useful language.
- Added trader-facing support/resistance strength wording:
  - `weak` -> `light`
  - `moderate` -> `moderate`
  - `strong` -> `heavy`
  - `major` -> `major`
- Improved level snapshot wording so support and resistance ladders now expose strength descriptors instead of only bare prices.
- Added event-context barrier-clearance tracking so monitoring events know the next meaningful opposing barrier and whether room is `tight`, `limited`, or `open`.
- Added opportunity-ranking penalties and bonuses based on barrier clearance so cramped setups are downgraded before they reach the trader.
- Added durability-aware level scoring so the ranking layer now distinguishes more clearly between reinforced / durable levels and fragile over-retested ones.
- Threaded durability through level confidence, explanations, surfaced-selection wording, compare output metadata, and the runtime compatibility adapter.
- Adjusted runtime-facing strength labels so fragile levels are less likely to be overstated as `heavy` or `major` support / resistance.
- Added structured alert-posting family and suppression tracking to long-run session summaries.
- Added `thread-summaries.json` so each symbol now gets a compact narrative of what the trader-facing thread actually did during a session.
- Added session-level and per-symbol usefulness / noise heuristics so long-run review can now classify runs as `high_signal`, `useful`, `mixed`, `noisy`, or `needs_attention`.
- Added `session-review.md` so long-run runs now produce a fast human-readable review instead of forcing every review through raw JSON artifacts.
- Improved trader-facing clearance wording so alerts now say when overhead or downside room is `tight`, `limited`, or `open` instead of only listing the next barrier numerically.
- Added a human review loop backed by `human-review-feedback.jsonl` plus `scripts/add-long-run-review-feedback.ps1`, and surfaced that feedback in the long-run summary artifacts.
- Added deterministic end-of-session thread summaries so each symbol now gets a clearer plain-English wrap-up instead of only raw counts.
- Added tactical `firm` / `tired` zone reads to trader-facing alerts and long-run review summaries so structurally important but fading zones are described more honestly.
- Made tactical `firm` / `tired` reads directional in scoring so worn-out support is downgraded for dip-buy style ideas while tired resistance can act as a breakout tailwind.
- Added deterministic `why now` trader wording and evaluation-aware long-run review so live sessions are judged more by useful outcomes than by raw diagnostic volume.
- Added evaluation-by-event-type tracking to long-run summaries so each session can now show which alert families are validating cleanly versus leaning negative.
- Added alert/evaluation alignment summaries to thread review so a symbol's latest posted setup can be compared against how that same setup family has actually been performing.
- Added dynamic-symbol and outcome-disagreement review so long-run sessions can flag symbols whose repeated state changes or weak follow-through make the thread less trustworthy than its raw alert count.
- Added movement-aware trader wording and audit metadata so alerts now say how far price has already pushed through or back into the zone when they fire.
- Added explicit first-target wording and audit metadata so directional alerts now name the first support or resistance objective when the next barrier is known.
- Added explicit pressure wording and audit metadata so trader alerts now say whether buyers or sellers still have strong, workable, tentative, or balanced control behind the move.
- Added deterministic trigger-quality wording and audit metadata so trader alerts now say whether the setup still looks clean, workable, crowded, or late.
- Added deterministic setup-state wording and audit metadata so trader alerts now say whether the idea is still building, confirming, continuing, weakening, or already failed.
- Added deterministic failure-risk wording and audit metadata so trader alerts now say whether the setup still looks contained or is already carrying elevated failure risk from tight room, weak control, tired structure, or degraded context.
- Tightened directional alert scoring so crowded, late, tentative-pressure, and degraded-data breakouts are less likely to be overstated after live review.
- Added trade-map wording and audit metadata so alerts now quantify room-to-next-barrier versus risk-to-invalidation for directional setups.
- Added distance-aware snapshot formatting so support and resistance ladders now show signed distance from current price instead of only bare levels.
- Added nearest-support / nearest-resistance snapshot map summaries so the snapshot immediately shows which side is tighter before the trader scans the full ladder.
- Added snapshot room classification so the map line now describes the nearby balance as `bullish room`, `bearish room`, or `balanced room` when possible.
- Added deterministic follow-through grading to long-run session artifacts so completed evaluations are now labeled `strong`, `working`, `stalled`, or `failed` instead of living only as raw win/loss counts and return percentages.
- Added live follow-through thread updates so completed setups can now post `strong`, `working`, `stalled`, or `failed` back into the trader-facing thread instead of only showing up in post-run artifacts.
- Added live follow-through state-change updates so active setups can now post `improving`, `stalling`, or `degrading` before the final evaluation window closes.
- Added barrier-clutter context so event scoring, opportunity ranking, alert wording, and audit metadata can now distinguish cleaner paths from `stacked` or `dense` pathing beyond the first barrier.
- Added multi-barrier `path quality` scoring so setups can now distinguish cleaner routes from layered or choppy pathing beyond the first barrier.
- Added explicit zone `exhaustion` tracking so alerts can now say when a support or resistance level still matters structurally but is getting tactically worn out.
- Added deterministic dip-buy-quality wording so support-test alerts can now say whether the bounce looks actionable, watch-only, or tactically poor.
- Added `trader-thread-recaps.md` so long-run sessions now produce a short readable recap artifact per symbol in addition to JSON summaries.
- Added thread continuity posts so active symbol threads can now describe the lifecycle as `setup forming`, `confirmation`, `continuation`, `weakening`, or `failed` instead of relying only on isolated setup alerts.
- Added in-session symbol recap posts so longer-lived symbols can periodically summarize the current state in one useful trader sentence.
- Added an optional AI commentary layer for recap enhancement and post-run session summaries through `LEVEL_AI_COMMENTARY`, `OPENAI_API_KEY`, and `npm run longrun:ai:summary`.

## Active Backlog

### End-user output improvements

- Add explicit `why now` and `what changed` wording for higher-priority alerts.
- Improve low-priced-symbol phrasing so tiny decimal moves remain readable and not misleading.
- Use the new target metadata to learn whether alerts with clear nearby objectives are materially more trader-useful than alerts without a confirmed first barrier.
- Use the new pressure metadata to learn whether strong-control alerts materially outperform tentative-control alerts and whether weak-pressure setups should be downgraded more aggressively.
- Use the new trigger-quality metadata to learn whether `clean` entries materially outperform `crowded` or `late` ones and whether posting thresholds should tighten around stretched moves.
- Use the new setup-state metadata to learn whether Discord is seeing enough true confirmation and continuation updates versus too many weakening or failed states.
- Use the new failure-risk metadata to learn whether elevated-risk setups should be downgraded or suppressed more aggressively before they reach Discord.
- Keep using live long-run examples like `YCBD` to verify that severity and confidence stay aligned with the trader-facing wording when structure and activity disagree.
- Use the new follow-through grades to decide whether certain alert families are failing late versus stalling harmlessly, and tighten the most trader-costly cases first.
- Use the new live follow-through state posts to decide which setups deserve mid-flight continuity updates versus only final outcome posts.
- Use the new path-quality and exhaustion metadata to learn whether worn levels with layered pathing should be suppressed more aggressively before they reach Discord.

### Detection and ranking improvements

- Add more explicit heavy/light support and resistance logic based on:
  - structural score
  - freshness
  - time-frame confluence
  - failed-break versus clean-break balance
  - current active pressure
- Add stronger separation between:
  - fresh but lightly evidenced levels
  - durable defended levels
  - structurally strong but now fragile levels
- Improve breakout quality by checking whether the move is:
  - fresh
  - accepted
  - forceful
  - clear of nearby overhead clutter
- Improve reclaim quality by separating:
  - shallow reclaim
  - decisive reclaim
  - reclaim into immediate overhead resistance
- Add explicit volume-and-activity storying later:
  - prefer trader-facing wording around `volume` and `activity`, not `participation`
  - explain when activity is building, confirming, thin, fading across retests, or spiking into crowding
  - treat volume/activity as both scoring input and trader-facing context once the current continuity/path-quality work settles

### Noise-control improvements

- Add a usefulness review loop for alerts:
  - useful
  - noisy
  - late
  - false positive
  - strong
- Add stronger cooldown rules for repetitive context-only alerts.

### AI ideas worth building later

- AI-generated plain-English commentary for top deterministic alerts.
- AI-generated session summaries from lifecycle, alert, and evaluation logs.
- AI-assisted review of noisy symbols and noisy alert families.
- AI comparison between deterministic alert output and eventual trade outcome summaries.
- AI-assisted recap enhancement that stays faithful to the deterministic facts and avoids inventing execution advice.

## Current Hypotheses To Test

- Strong-support `level_touch` events are more useful when framed as dip-buy tests rather than generic zone touches.
- Outermost and promoted-extension zones are usually more trader-useful than weak inner-zone touches.
- A signal becomes much more useful when the message says both:
  - what happened
  - what must happen next for the idea to remain valid
- Some false-positive dip-buy ideas are probably caused by poor overhead-clearance awareness rather than weak support ranking alone.
- Some false-positive heavy-support / heavy-resistance reads are probably caused by structurally strong but durability-fragile levels being described too aggressively.

## Next Recommended Implementation Steps

1. Use human review feedback to tune heavy/light and firm/tired wording against real alert outcomes.
2. Use the new follow-through state updates, continuity posts, and recap posts to decide which alert families deserve more mid-flight lifecycle guidance versus less thread clutter.
3. Use human review feedback to tune when tired zones should still be treated as real break tailwinds versus just noisy damage.
4. Use the new path-quality and exhaustion metadata to identify support/resistance cases that still matter structurally but should be downgraded tactically.
5. Use the new event-type evaluation buckets to identify families that need tighter posting thresholds or better wording before expanding the AI commentary layer.
6. Use the new dynamic-symbol and disagreement summaries to decide whether activation churn, reactivation behavior, or symbol-specific noise suppression needs more tuning.
7. Use the new movement labels to learn whether early alerts outperform stretched alerts before tightening posting rules further.
8. Use the new trade-map labels to learn whether favorable-skew alerts actually outperform tight-skew alerts before tightening posting rules further.
9. Use the new target metadata to learn whether traders respond better when a first objective is available and whether unclear-objective setups should be downgraded more aggressively.
10. Use the new pressure metadata to learn whether strong-control alerts materially outperform tentative ones before tightening posting rules further.
11. Use the new trigger-quality metadata to learn whether crowded or late entries should be suppressed more aggressively before they reach Discord.
12. Use the distance-aware snapshot ladder to decide whether the default number of displayed support/resistance zones is still optimal for traders.
13. Use the new snapshot room classification to decide whether the thresholds for `bullish`, `bearish`, and `balanced` room need tuning against real trading usefulness.
14. Expand the AI commentary layer carefully, starting with recap enhancement and session summaries, before considering top-alert commentary.
