# Signal Quality Roadmap

## Purpose

This document is the living tracker for ideas, priorities, progress, and open questions related to making the app:

- more useful to the end user
- more trustworthy operationally
- better at describing support, resistance, breakouts, reclaims, and support-reaction opportunities
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
- Improve support-reaction interpretation so strong support tests are highlighted more clearly than weak inner noise.

### 4. AI-assisted commentary

- Use AI as an explanation and summarization layer on top of deterministic signals.
- Do not use AI as the raw market-data source or sole execution engine.
- Feed AI structured event facts after the deterministic engine has already made the core call.

### 5. Volume / activity context

- Treat volume as supporting context, not a standalone signal stream.
- Use recent 5-minute candle volume as the baseline when available.
- Trust live IBKR volume only while it behaves like monotonic cumulative daily volume.
- Omit trader-facing volume text when the read is missing, stale, non-monotonic, repeated too long, or too thinly sampled.
- Avoid certainty phrases such as `volume confirms`; activity can make a setup more meaningful, but it does not prove follow-through.

### 6. Modular signal category discipline

- Keep each signal family owned by an explicit category contract before adding trader-facing wording.
- Enforce the live/operator/internal surface matrix in code, not only in docs.
- Keep enrichment-only categories, such as market structure and volume/activity, inside existing useful posts instead of creating new standalone Discord streams.
- Keep audit metadata rich enough to prove which category produced a post and whether that category was allowed live.

## Shipped Progress

### 2026-05-03

- Added structured shared-engine `referenceLevels` so previous-day, premarket, opening-range, and current-session anchors are first-class facts instead of scattered special fields.
- Added initial `gapStructure` context for nearest open gaps, recent gaps, and fill status. This stays diagnostic/shared context until saved-data audits prove trader-facing wording is useful.
- Added dynamic level price context so shared consumers can see price versus VWAP, EMA9, and EMA20 without adding those lines to Discord by default.
- Added `buildExecutionLevelRelations(...)` for generic nearest-level, room, stacked-barrier, open-air, and reference-level relation facts.
- Added warehouse-backed shared context builders plus bulk candle backfill planning so website tools can reuse stored candles and avoid repeated provider fetches.
- Added `npm run engine:capabilities`, `npm run candles:audit`, `npm run candles:calibrate`, and `npm run candles:import-readiness` so the shared candle engine, durable warehouse, saved-session candle-intelligence facts, and future bulk-import coverage can be audited separately from Discord post quality.
- Expanded saved-session candle calibration to scan all long-run sessions, tag known problem symbols, and show inline reference/gap/relation evidence before those facts influence trader-facing output.
- Added `npm run candles:backfill` as a dry-run-first provider-safe path from missing-range plans to durable warehouse writes. Provider throttling and concurrency controls live in `levels-system` so consumer apps do not need IBKR-specific logic.
- Added `npm run candles:bulk-sim` so months-style imported trade pressure can be simulated without live provider calls. The planner now coalesces same-symbol/session/timeframe requests across different execution timestamps.
- Added `npm run audit:execution-relations` so saved Discord posts can be replayed against cached candle evidence for nearest levels, room, reference levels, VWAP/EMA distance, and market-structure state.
- Strengthened `npm run volume:warehouse` with interaction buckets such as expanding into resistance, activity pickup on reclaim, fading while retesting, thin activity chop, and stale/unreliable context.
- Added `npm run candles:provider-compare` so cached provider coverage and drift can be reviewed before switching away from IBKR or trusting another provider.
- Added `npm run candles:regression-pack` so weak first snapshots, volume-context examples, execution relation gaps, and missing-forward-level candidates become reusable saved-data cases.
- Added `npm run candles:regression-gate` so saved-data regression packs can be enforced as pass/review/fail with thresholds for major cases, weak first maps, missing forward resistance, and missing candle evidence. The gate now supports `--preset strict`, `--preset review`, and `--preset exploratory` so release gating and evidence gathering do not need the same tolerance.
- Added `stable_structure_repeat` in the live post policy so unchanged stable 5m structure can keep same-range flicker quieter without hiding accepted directional changes or real structure expansion.
- Added `practical_area_flip_chop` in the live post policy so repeated non-accepted breakout/reclaim/breakdown chatter inside the same practical trade box can stay out of Discord after the area has already been explained.
- Added small-cap materiality gating for fragile/high-risk wording so one-cent weak probes inside active range boxes do not sound like major trade failures.
- Added small-cap materiality gating inside candle reaction context itself. Support losses, reclaims, clean resistance clears, and failed breakouts now need enough candle evidence relative to the small-cap meaningful-move floor before they become material reactions.
- Added level-quality cluster evidence with first forward gaps and tight nearby cluster counts. Crowded nearby penny levels are now flagged as practical zones for trader context while the full support/resistance ladder remains intact.
- Updated first snapshot level context so clustered nearby levels are described as practical zones where reaction quality matters more than exact pennies.
- Added `npm run levels:calibrate` so support/resistance quality can be tested directly from saved data. It rebuilds levels at saved post time, validates future 5-minute reactions, flags no-forward, wide-gap, and crowded-ladder cases as level-engine evidence, writes a gate artifact, and now includes ranking proof, market-structure alignment, and coverage/backfill hints.
- Support/resistance calibration findings now feed both `candles:regression-pack` and `candles:backfill-priority`, so watch/broken/unproven level cases become regression evidence and provider work is prioritized by candle proof value.
- Added `npm run startup:cache-readiness` so restart acceleration can be audited from disk cache coverage while preserving the rule that Discord snapshots wait for fresh candles.
- Runtime provider health now exposes startup-cache warming/restored/blocked snapshot state, which makes cache acceleration auditable from the UI/API instead of hidden in logs.
- Added `npm run candles:dynamic-calibrate` so opening-range, VWAP, EMA9, and EMA20 evidence can be proven against cached candles around saved posts before becoming trader-facing.
- Added a generated dynamic/reference trust gate so VWAP/EMA/opening-range facts are classified as trusted, watch, unproven, or broken before trader-facing use is allowed.
- Added `npm run audit:why-no-post` so quieter behavior can be proved with candle-backed missed-move evidence instead of only comparing post counts.
- Upgraded `npm run audit:why-no-post` with balanced replay suppression evidence and all-session support, making quiet-period proof stronger across both one live session and the full saved-data root.
- Upgraded `npm run audit:why-no-post` again with concrete candle-backed move examples, nearest saved posts, and OHLC/range evidence so `quiet_may_hide_move` findings can be audited directly instead of described only as counts.
- Upgraded `npm run audit:eod-verdict` to include first-snapshot, execution-relation, missed-move, and volume evidence in one per-symbol verdict, including inline evidence examples.
- Strengthened bulk candle backfill planning with provider batches, estimated candle counts, coalesced trade-request counts, avoided task counts, and largest-task sizing so future imports protect IBKR or replacement providers.
- Added `npm run candles:import-safety` so provider-pressure risk is explicit before backfills or bulk trade imports run. Import readiness/safety reports now include symbol/session coverage so missing warehouse proof is visible before a saved-data conclusion is trusted.
- Added `npm run candles:backfill-priority` so missing candle ranges are ranked into `fetch_first`, `fetch_next`, and `fetch_later` stages using quiet-risk, post-noise, missing-candle proof, timeframe importance, and provider-safe stage limits before broad provider work begins.
- Added `npm run candles:backfill-manifest` and priority-stage filtering in `npm run candles:backfill`, so Stage 1 provider work can be handed off as an exact dry-run command and then recalculated against the current warehouse before any explicit `--execute` fetch.
- Expanded candle regression packs and gates with `quiet_may_hide_move` and `post_noise_budget_watch` cases so quiet-risk and remaining noisy-symbol pressure become enforceable audit categories.
- Wired the evidence reports into `npm run replay:monday` so closed-market review now includes why-no-post proof, candle regression gate, dynamic/reference calibration, and import safety by default.

### 2026-05-02

- Added level-importance tiers so trader-facing maps and audit rows can separate major decision levels, active trade boundaries, useful references, minor noise, and extension context without deleting valid levels from the ladder.
- Added primary trade-area context so range-bound tickers can stay anchored to one support/resistance battlefield until price escapes with acceptance or material structure change.
- Added failed-level memory so tiny probes above resistance or below support remain `probe_only` / `testing` until price proves acceptance; this reduces overconfident cleared/lost wording.
- Updated the first snapshot trade map to split main support and main resistance into separate trader-readable lines and use `shift attention toward` wording for the next area.
- Added `npm run audit:thread-health` and `npm run audit:lifecycle` so post-noise and trade-story quality can be scored after a session without waiting for manual review.
- Added `npm run audit:usefulness` so saved Discord posts can be scored for trader usefulness, same-story noise, late delivery, missing next-level context, ticker personality, and ladder confidence.
- Added `npm run audit:daily-review` so saved sessions produce operator-only daily recaps, expected post budgets by ticker behavior, no-post evidence coverage, best/worst examples, and post-timing flags.
- Added a provider-health dashboard to the manual UI so price-feed age, Discord delivery health, historical seed backlog, and stuck seeding are visible without reading terminal output.
- Added first-snapshot `Level context` wording and active-row price/story/level freshness in the manual UI.
- Extended visual audit replay with a symbol index and issue flags for weak probes, locked-area posts, missing next-level context, and minor-level posts.
- Added a shared candle-based market-structure module that builds confirmed 5m swing highs/lows, higher-low and lower-high structure, active range context, pivot reclaim/loss events, trend intact/damaged state, confidence reasons, and a safe optional trader line.
- Threaded the new `marketStructure` output through the shared support/resistance APIs so this app and `trader-intelligence-v2` can consume the same structure facts without creating new Discord post noise.
- Added `npm run structure:replay` so cached IBKR 5m candles can be replayed through the new market-structure engine before any live Discord wording or post-policy rules depend on it.
- First structure replay scanned 56 cached files across 37 symbols and flagged high state-transition counts in names such as `AKAN`, `FATN`, `HCAI`, `PBM`, and `SAGT`, so the next product step is smoothing/materiality before live wording.
- Added stable market-structure smoothing and materiality scoring. The same replay now shows high raw-transition cases at `10`, high stable-transition cases at `0`, and average transition reduction at `60.1%`, which makes stable structure a safer candidate for later post-policy testing.
- Added `npm run structure:discord-align -- --limit all` to compare actual saved Discord posts against stable 5m structure near each post. The first all-artifacts pass scanned 10,472 posted rows, aligned 7,136 to cached 5m candles, and found 4,531 same-structure repeat posts plus 632 raw-chop candidates.
- Added the stable 5m structure metadata boundary to alert payloads, Discord audit rows, replay simulation, and live post policy. This does not add market-structure Discord posts; unchanged stable structure can reduce repeated level-flicker stories, while material structure transitions can still pass through.
- Added a live stable-structure runtime bridge. The monitor now buckets live ticks into 5-minute candles and supplies stable structure metadata to monitoring events after enough buckets exist, allowing the existing policy to use candle-backed materiality during live runs.
- Added guarded trader-facing stable 5m structure wording. Existing alerts can now include a short structure line only when the stable 5m candle story materially changes or the first stable read is safe enough; unchanged or low-confidence structure stays out of Discord wording.
- Hardened thread-story phase control so same-area phase cycling is treated as churn instead of a fresh story unless the move expands, structure materially changes, or the event is major. Broad saved-data replay now reports `5,075 -> 2,030` simulated posts, `60.0%` reduction, and `12` thread-story suppressions; the count is conservative for old rows that lack newer structure metadata.
- Strengthened the first support/resistance post so the `Trade map` now names current structure, upside path, support that matters, broader failure area, and short-term momentum support with distance-from-price context.
- Kept the opener observational and small-cap aware: nearby penny-level supports are treated as areas, and the wording avoids direct buy/sell advice or one-cent failure language.
- Tightened post-story compression for small caps: low-priced same-story buckets are wider, practical-zone drift alone no longer creates a fresh story, and repeated breakout/reclaim cycling inside the same practical area needs expansion or a real structure change.
- Added price-aware range/chop compression so low-priced repeated touch/break/reclaim/rejection chatter inside the same boxed area stays quieter unless the symbol expands, escalates, or changes structure.
- Added a noisy-symbol regression pack to the all-symbol stress report so future tuning starts from the worst saved symbols and sessions, not a small named sample.
- Added a broader saved-data replay pack to the all-symbol stress report so closed-market validation now covers tight chop, runners, missed-event candidates, language-boundary risk, and high-activity watch symbols without relying on a few named examples.
- Added a trader post quality grader and `npm run quality:posts` so saved Discord threads can be audited for system-shaped wording, direct-advice risk, over-certain phrasing, tiny small-cap risk language, missing-level claims, and repeated-story overlap without waiting for live-market data.
- Added quiet-profile totals to the all-symbol stress report so closed-market reviews can tell whether a symbol would still be too noisy even under the stricter profile.
- Tightened first snapshot trade-map wording: `Cleaner above` now names the condition needed before the next resistance area matters, and `Support that matters` can combine nearby penny-level supports into one practical area for commentary while preserving the full ladder below.
- Added symbol-style post budgets to the all-symbol stress report so low-priced chop, normal range-bound symbols, active runners, and extreme runners are reviewed against different expected post-count limits.
- Added operator-only `whyPosted`, `postBudgetSymbolType`, and `noLevelReason` audit fields so the system can explain post eligibility and missing next-level cases without putting debug/testing language into Discord.
- Added a `Monday Live Review` panel to the manual UI with recent critical/optional post counts, post-budget status, and checklist guidance for the next market-open run.
- Added per-symbol post-budget rows to the manual UI's Monday review panel, so live review can quickly show which symbols are calm, busy, or optional-heavy without reading raw JSON.
- Added `npm run replay:monday` as a one-command closed-market readiness checklist covering build, broad saved-data replay, small-cap scenario replay, saved-data regression, latest-session report regeneration, post-quality grading, post-reason audit, known-bad wording scan, and volume replay.
- Hardened the saved-data replay simulator so older Discord rows without current practical-zone metadata infer range-box, acceptance, and behavior-budget context from saved text. This makes legacy chop sessions test the same calmer story policy used by current runtime metadata.
- Latest broad saved-data replay after that hardening showed `5075 -> 1949` simulated posts, `61.6%` reduction, and still-noisy symbols down to `7`. Remaining all-session quiet-proof warnings are mostly candle-coverage work, because many older sessions still lack overlapping cached 5m candles.
- Added `npm run audit:post-reasons` plus `post-reason-audit.json` / `.md` so audits can explain `whyPosted`, post-budget style, missing post-reason rows, and no-next-level cases from saved audit data.
- Added `npm run audit:known-bad-posts` plus `known-bad-post-patterns.json` / `.md` so confusing historical trader-facing phrases are tracked as a regression pack instead of depending on memory.
- Strengthened first-post snapshot wording with a plain `Main decision` line that names the upside decision area and the support area that needs to keep holding.
- Added validation candle-cache runtime counters for exact hits, reusable hits, misses, and writes so restart / validation speedups can be measured instead of guessed.
- Added `--older-than-days` to the Discord test-thread cleanup script so stale testing threads can be archived or deleted without sweeping fresh trade threads.
- Added a quiet `traderContext` bundle to the shared support/resistance output. It now computes liquidity/tradability, catalyst/profile risk, session/gap anchors, candle reaction quality, move extension/exhaustion, and story-memory decisions without creating new standalone Discord posts.
- Added new quiet signal categories for `liquidity_tradability`, `catalyst_context`, `session_context`, `move_extension`, and `story_memory`; they are operator/internal by default and can support scoring or audits before any trader-facing wording is allowed.
- Added deterministic trader-context tests covering messy spreads, thin dollar volume, nano-cap / low-float profile risk, prior-day / premarket anchors, candle acceptance versus wick rejection, stretched moves, and same-story cooldown behavior.
- Re-ran the all-symbol saved-data stress audit after the tuning: `5075 -> 2035` simulated posts, `59.9%` reduction, and still-noisy symbols down from `14` to `9`.

### 2026-05-01

- Added a practical 5-minute market-structure state layer that derives range-bound, base-building, pressing-resistance, breakout-attempt, support-failing, clean-break, reclaim-attempt, and reclaim-holding context around existing levels.
- Threaded practical structure state through monitoring events, trader-facing market-structure wording, post-policy materiality, replay simulation, Discord audit metadata, and trading-day evidence reports.
- Same-level alert repeats can now be allowed when the practical structure truly changes, but suppressed when the ticker is still telling the same range/chop story.
- Added an offline small-cap scenario simulator for closed-market validation. `npm run scenario:smallcap` now tests range chop, base-to-breakout, fake breakout, support-area loss, and reclaim-after-flush paths through the real monitor, alert engine, formatter, and live post policy.
- Added broad all-symbol saved-data stress testing with `npm run stress:all-symbols`, which scans saved long-run Discord audit streams, dedupes identical files, aggregates all tickers, and ranks overposting, tight-range chop, runner cascades, missed-event candidates, and trader-language boundary hits.
- Tightened small-cap same-area post budgets and replay parsing; the broad saved-data scorecard now replays `5075 -> 2323` posts across 57 saved symbols, with still-noisy symbols down to `15`.
- Added thread story phase control so repeated same-area posts are suppressed when the ticker is still in the same practical phase. The latest broad saved-data scorecard now replays `5075 -> 2210` posts across 57 saved symbols, while CYCU in the latest high-activity saved session improves from `31 -> 7`.
- Added post-budget labels to the all-symbol stress report so future reviews separate `excessive_chop` from `runner_review` instead of treating every higher-count thread as the same problem.
- Reworked the first support/resistance post into a practical `Trade map` so traders see the range, breakout area, main support area, broader failure area, and short-term momentum support instead of only a raw ladder.
- Added small-cap zone-aware wording so nearby penny-level supports are treated as one area when appropriate; a one-cent move should not be narrated as if the whole trade changed.
- Tightened same-story alert suppression so repeated breakouts, breakdowns, and touches at the same level need a material trigger change, severity change, or score change before reaching Discord again.
- Replay evidence on the latest high-activity saved session improved from `530 -> 286` balanced simulated posts, with CYCU improving from `31 -> 11`.
- Added range-bound chop gating so repeated level-touch, support-loss, rejection, and compression stories inside the same tight price band are suppressed after the thread has already explained the area.
- Made fast support/resistance bridge posts participate in the same alert-memory rules as normal intelligent alerts.
- Tightened symbol recap posting so minor failed/stalled follow-through inside ordinary chop does not create extra recap posts.
- Extended replay reporting with `optional_minor_recap` evidence so old saved sessions show which recap posts current rules would suppress.
- Added explicit signal-category contracts and routing for current monitoring events and Discord message kinds.
- Enforced live-Discord category surfaces in the alert filter, so `range_compression` remains operator/internal by default unless explicitly enabled.
- Added signal-category metadata to alert payloads and Discord delivery audit rows, making category ownership auditable after a trading session.
- Added regression coverage for category contracts, event/message routing, and category-surface live suppression.

### 2026-04-22

- Added structured runtime lifecycle logs.
- Added local Discord delivery audit files for long-run sessions.
- Split long-run review into operational and diagnostic surfaces.
- Added a live session summary for long-run testing.
- Added per-symbol session-summary tracking for lifecycle, delivery, diagnostics, failures, and opportunity updates.
- Added runtime-status visibility for the operator.
- Improved trader-facing alert payloads with severity, confidence, score, and trigger.
- Improved trader-facing alert wording so breakout, breakdown, reclaim, failed-move, and support-reaction tests are described in more useful language.
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
- Made tactical `firm` / `tired` reads directional in scoring so worn-out support is downgraded for support-reaction ideas while tired resistance can act as a breakout tailwind.
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
- Added deterministic support-reaction-quality wording so support-test alerts can now say whether the bounce looks actionable, watch-only, or tactically poor.
- Added `trader-thread-recaps.md` so long-run sessions now produce a short readable recap artifact per symbol in addition to JSON summaries.
- Added thread continuity posts so active symbol threads can now describe the lifecycle as `setup forming`, `confirmation`, `continuation`, `weakening`, or `failed` instead of relying only on isolated setup alerts.
- Added in-session symbol recap posts so longer-lived symbols can periodically summarize the current state in one useful trader sentence.
- Tightened live follow-through state-change posting so `improving`, `stalling`, and `degrading` updates now require more meaningful change and use longer cooldowns before reposting weaker states.
- Deepened multi-barrier path scoring so the app now considers barrier density, barrier strength, and compressed gaps across the first path window instead of treating path quality as only a first-barrier problem.
- Added explicit path-constraint and path-window metadata so review can compare technically open paths against routes that are still cramped or step-heavy early.
- Tightened exhaustion wording so `tested`, `worn`, and `spent` levels are described more explicitly as structurally important but tactically less trustworthy.
- Tightened support-reaction-quality wording so support-test alerts are more willing to downgrade layered / worn support into watch-only or tactically poor cases.
- Tightened continuity posting so runtime continuity messages now prefer real lifecycle transitions over repeated low-value restatements.
- Added deterministic `What matters next` recap guidance so in-session symbol recaps can tell the trader what continuation still requires.
- Expanded the optional AI commentary layer so `npm run longrun:ai:summary` can now generate both `session-ai-review.md` and `thread-ai-recaps.md`, plus an AI noisy-family review.
- Added deterministic `thread-clutter-report.json` output so long-run sessions now measure total live posts, optional-context density, and clutter-risk heuristics per symbol instead of guessing from thread feel.
- Added explicit live-versus-operator output classification so thread summaries and session review can separate trader-critical posts from trader-helpful optional posts and operator-only artifacts.
- Tightened recap posting so generic setup-forming narration is less likely to post live unless the thread is meaningfully evolving.
- Consolidated trader-facing wording slightly by suppressing low-signal default lines when they are only restating the same benign idea.
- Made optional live-post gating category-aware and thread-density-aware, so recap, continuity, and follow-through-state posts now react differently to recent critical-post mix, event family, and context load instead of sharing one generic optional-context rule.
- Added event-type context to trader continuity interpretations so live-post discipline can stay aware of directional versus non-directional story updates without flattening the interpretation layer.
- Tightened optional live-post throttling again so context-heavy threads back off faster once optional narration starts outnumbering trader-critical beats.
- Corrected the clutter-review heuristic so low-context threads are no longer penalized just because the symbol was suppression-heavy internally.
- Added event-family-aware live-post discipline so `level_touch` and `compression` threads now get a narrower optional-narration path than breakout-style threads.
- Fixed continuity gating so event-family-aware optional-post rules now apply to meaningful label transitions too instead of only duplicate-state repost attempts.
- Refined long-run review language so low-output or still-activating threads are more likely to read as `observational` / `activating` than falsely `noisy`.
- Refined startup-pending review honesty further so symbols with no visible output yet now stay closer to neutral/activating instead of being pulled into `noisy` simply because the runtime has not finished producing its first visible trader-facing post.
- Added a neutral score floor for startup-pending threads so the verdict no longer fights the `activating` status when there is no visible output and no sign of actual clutter or failure.
- Added stricter family-aware live-post discipline so `rejection`, `fake_breakout`, and `fake_breakdown` do not get the same optional continuity budget as cleaner breakout / breakdown / reclaim threads.
- Tightened support-test tradeability so repeated testing plus layered or limited overhead push support touches toward `watch_only` or `poor` more aggressively in both alert scoring and opportunity ranking.
- Refined clutter review again so controlled `level_touch` / `compression` watch-mode threads can read as intentionally reactive rather than just context-heavy.
- Added short per-symbol narration burst control so continuity / recap / follow-through updates are less likely to pile up in the same window when one setup changes state rapidly.
- Tightened extension dedupe so overlapping refresh paths are less likely to repost identical `NEXT LEVELS` payloads.
- Refined review wording so delivery-choked threads can read as downstream-pressure problems instead of automatically looking like low-signal threads.
- Tightened continuity again so setup-forming narration yields to fresh critical beats and same-label continuity updates collapse before in-flight routing can duplicate the story.
- Tightened continuity overlap again so same-window `follow_through_state` posts now suppress weaker setup-forming / confirmation / weakening continuity more aggressively.
- Matched monitoring-event continuity more strictly to the triggering event side and level, which prevents mixed same-symbol opportunity stacks from narrating support right after a resistance-side alert.
- Tightened reactive same-event narration again so `level_touch` / `compression` setups now spend optional continuity / live-state beats more sparingly inside a short burst window.
- Tightened reactive same-event narration one step further so in-flight optional posts are now considered before the first route resolves, closing the race that could still let both continuity and live-state escape together.
- Tightened price-update ownership so completed follow-through now owns same-snapshot narration for the same symbol and event type, which suppresses weaker progress-driven continuity / live-state duplicates.
- Added short optional-post backoff after recent Discord delivery failures, so delivery pressure is less likely to turn into a second wave of continuity / live-state / recap chatter on the same symbol.
- Added a short runtime-only settle window for optional continuity / live-state posts so a fresh trader-critical alert can preempt weaker narration when both are about to hit the same symbol thread in the same moment.
- Added a bounded seed timeout for manual activation so a hung level-generation request now fails explicitly instead of leaving a symbol parked in `refresh_pending` forever.
- Extended long-run review honesty so `refresh_pending` no-output threads are treated as pending work rather than falsely noisy.
- Fixed the long-run launcher so review artifacts now keep refreshing from `discord-delivery-audit.jsonl` even when runtime stdout goes quiet, which keeps post-market and slow-session summaries aligned with what actually reached Discord.
- Added a separate Finnhub stock-context prototype path so the planned first thread post can be tested in the terminal first without tangling that experiment into the live runtime yet, with the initial scope narrowed to ticker-specific quote/profile data instead of news.
- Wired the Finnhub stock-context card into the live runtime so newly created threads now get a labeled ticker-specific opener before levels finish seeding when `FINNHUB_API_KEY` is present.
- Tightened the Finnhub opener so it now stays focused on ticker-specific fields, removes redundant title/ticker lines, keeps the website clickable, and suppresses Discord embeds so the opener behaves like a compact stock card instead of a preview dump.
- Removed Finnhub quote/price fields from the first-thread opener, so premarket/live price context continues to come from the trading data path rather than stale Finnhub free-tier quote data.
- Tightened identical extension dedupe so the same `NEXT LEVELS` payload now stays suppressed until the extension ladder actually changes, instead of reappearing once a short cooldown expires.
- Lengthened same-scope trader alert repost windows and raised the required score delta for reposts, so structurally unchanged zone stories now need a more meaningful change before Discord gets another alert.
- Extended manual-runtime activation tolerance and IBKR historical timeout handling so slow first activations are less likely to vanish from the active list just because thread creation finished before historical seeding did.
- Added operator-only snapshot audit metadata to Discord delivery audit rows, making it easier to diagnose whether missing-looking levels were compacted, crossed, outside the forward range, or absent from generated candidates.
- Extracted the first live thread post policy helper so follow-through and AI commentary duplicate rules can be tested outside the manual runtime manager.
- Moved optional continuity, recap, and live follow-through-state gating into the same policy helper so post-burst and same-event chatter rules can be tested directly.
- Tightened completed follow-through posting with same-story keys, material-change checks, and a longer same-outcome window so repeated `working` / `failed` updates on the same active move do not keep crowding runner threads.
- Tightened live AI read posting with same-story and in-flight gating so AI commentary only follows higher-value deterministic alerts and does not repeat the same symbol story while a previous AI read is already being generated.
- Added `thread-post-policy-report.json` / `.md` and `snapshot-audit-report.json` / `.md` generation from `discord-delivery-audit.jsonl`, giving post-run review a faster way to find repeated same-story clusters, post bursts, optional-density pressure, and level-ladder omission reasons without scanning raw JSONL rows.
- Added `long-run-tuning-suggestions.json` / `.md`, which turns the policy and snapshot audit reports into ranked action/watch/info items after a session.
- Added a manual-runtime `Review Artifacts` panel so generated session reports can be previewed from the UI while testing.
- Added `npm run validation:levels:quality -- <SYMBOL> [output-json-path]` for suspicious forward-ladder cases such as missing-looking overhead resistance or unusually wide first gaps.
- Added a critical live-post burst governor plus stricter completed follow-through transition rules, so runner threads like ATER / BIYA should repeat fewer same-level `working` / `failed` messages.
- Improved follow-through Discord wording with a `Level to watch closely` section, natural move-state lines, and metadata-only material-repeat context.
- Tightened the trader-view-only Discord boundary so live posts avoid dashboard-shaped labels like `Status`, `Signal`, `Decision area`, `setup update`, `state recap`, and `setup move`.
- Removed live Discord severity/confidence lines and softened snapshot / extension headers so labels like `LEVEL SNAPSHOT`, `CURRENT READ`, `KEY LEVELS`, `FULL LADDER`, `NEXT LEVELS`, `SIDE`, and `LEVELS` stay out of trader-visible posts.
- Tightened AI commentary validation so live AI reads stay observational and reject borderline instruction-like phrasing such as `longs should...`, `wait for...`, `best entry`, `can buy`, `should trim`, and `should exit`.
- Added `npm run longrun:simulate:posts -- <session-folder>` and `live-post-replay-simulation.json` / `.md`, so saved sessions can be replayed through the current post-policy rules before the next live market test.
- Routed live AI reads through optional-post and narration-burst discipline before the OpenAI call, keeping reactive AI reads out of already-busy threads and reducing unnecessary API usage.
- Added `WATCHLIST_POSTING_PROFILE=quiet|balanced|active` so live Discord post volume can be adjusted from `.env` without editing code.
- Added `live-post-profile-comparison.json` / `.md` so saved sessions can compare quiet, balanced, and active profiles before changing the runtime setting.
- Added `runner-story-report.json` / `.md` so runner reviews can start from rough price path, key events, post quality labels, noisy-repeat samples, candidate missed level clears/losses, and post mix instead of raw Discord/audit rows.
- Tightened live posting around the current philosophy: critical level changes still post, but minor continuity, tiny follow-through, same-zone chop, and low-value AI commentary stay out of Discord by default.
- Added Yahoo enrichment to the initial stock-context opener so newly created Discord threads can show source-labeled Yahoo quote, volume, float, short-interest, financial, previous-day range, 52-week range, and company-description context beside Finnhub profile fields.
- Added `trading-day-evidence-report.json` / `.md` so post-session audits now include proof sections for trader-critical delivery failures, role-flip candidates, cluster-cross candidates, and representative trader-language excerpts instead of relying only on summary reports.
- Strengthened level-quality audit markdown so healthy, wide-gap, and thin-ladder findings include their supporting evidence inline.
- Added one automatic retry for trader-critical Discord alert posts and audit proof fields (`retryAttempt`, `retryOf`, `retryReason`) so failed downstream delivery is no longer only a post-run observation.
- Added cluster-cross metadata and grouped fast level-clear wording, so tight nearby levels can be narrated as one crossed zone while still preserving each candle-backed level for audit review.

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
- Use the new smarter live follow-through state posts to decide which setups deserve mid-flight continuity updates versus only final outcome posts.
- Use the deeper path-quality, path-window, and exhaustion metadata to learn whether worn levels with layered early pathing should be suppressed more aggressively before they reach Discord.
- Use the new clutter artifact to decide which optional live post classes are earning their place and which should stay richer only in operator artifacts.
- Use the new category-aware live-post gating to compare whether directional continuity deserves looser thresholds than non-directional narration in real sessions.
- Keep validating live sessions like `BURU` and `AIXI` so optional-post throttling and clutter review stay grounded in what actually hit Discord rather than what only happened inside diagnostics.
- Keep validating live sessions like `AUUD` so support-test families can be tightened without accidentally flattening useful breakout/reclaim thread progression.
- Keep validating live sessions so quiet low-output symbols are described honestly in review artifacts instead of being punished for simply not producing a setup yet.
- Keep validating live sessions so reactive watch-mode threads only stay rich when they genuinely graduate into cleaner directional setups.
- Keep validating live sessions like `AKAN` and `BURU` so delivery-choked or bursty threads can be separated from genuinely weak signal-quality threads.
- Keep validating live sessions so same-snapshot progress/evaluation arbitration does not flatten useful trader-critical follow-through while still removing low-value duplicate narration.
- Keep validating first activations so slow-but-valid symbols remain visible as `activating`, post the Finnhub opener first, and either finish seeding or fail clearly instead of silently rolling back.
- Use `thread-post-policy-report.json` after each live test to identify which symbols still repeat the same story too often, especially runner symbols that trigger several follow-through outcomes in a short window.
- Use `snapshot-audit-report.json` after runner sessions to separate true missing-level detection issues from trader-facing compaction or forward-range filtering.
- Use `long-run-tuning-suggestions.md` as the first triage pass after a session so the next code change is driven by the most visible repeated-story, burst, optional-density, delivery, or level-audit issue.
- Use `npm run validation:levels:quality -- <SYMBOL>` before changing level detection because a live snapshot appears to have skipped older support/resistance.
- After the next runner session, compare ATER / BIYA-style threads against the new burst governor and repeated-outcome wording to verify fewer same-story posts reach Discord without hiding genuinely new level clears or failures.
- Use the replay simulator after every noisy session to estimate whether policy changes would have helped before changing live thresholds again.
- Use `trading-day-evidence-report.md` after each trading day to verify critical Discord failures, role flips, cluster-cross narration, and trader-language boundaries with saved post excerpts.
- When the evidence report shows cluster-cross candidates after this change, treat them as unresolved only if the saved posts lack grouped `crossedLevels` proof or still over-explain the same tight move.
- Use `missed-meaningful-move-audit.md` after post-noise changes to verify that quieter posting did not hide candle-backed upside breaks, downside support losses, or large 5-minute expansions.
- Use `session-behavior-audit.md` after closed-market tuning to review candle readiness, first-post quality, current-session behavior profile, thread balance, and runtime marker coverage before trusting a live-session conclusion.

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
- Keep refining the line between trader-critical posts and trader-helpful optional posts without gutting useful thread continuity too early.
- Continue extracting live-post policy from the manual runtime manager so suppression decisions can be unit-tested and reviewed as policy instead of being buried inside orchestration.

### AI ideas worth building later

- AI-generated plain-English commentary for top deterministic alerts.
- AI-generated session summaries from lifecycle, alert, and evaluation logs.
- AI-generated per-symbol thread recaps from deterministic thread summaries.
- AI-assisted review of noisy symbols and noisy alert families.
- AI comparison between deterministic alert output and eventual trade outcome summaries.
- AI-assisted recap enhancement that stays faithful to the deterministic facts and avoids inventing execution advice.

## Current Hypotheses To Test

- Strong-support `level_touch` events are more useful when framed as support-reaction tests rather than generic zone touches.
- Outermost and promoted-extension zones are usually more trader-useful than weak inner-zone touches.
- A signal becomes much more useful when the message says both:
  - what happened
  - what must happen next for the idea to remain valid
- Some false-positive support-reaction ideas are probably caused by poor overhead-clearance awareness rather than weak support ranking alone.
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
14. Use the new thread-clutter artifact and live/output classification to decide which optional post classes should tighten further before changing trader-critical posts.
15. Use the new category-aware gating to compare whether recap, continuity, and follow-through-state thresholds should diverge further by event family instead of tightening globally.
16. Use real-session thread clutter outcomes to decide whether context-heavy symbols should start auto-preferring artifact review over optional live narration even earlier.
17. Keep splitting optional-post thresholds further by event family where real sessions show that support tests, compression, and directional breakouts need different narration budgets.
18. Use the new per-thread AI recap and noisy-family review outputs to judge whether the AI layer is staying faithful to the deterministic artifacts before expanding it further.
19. Expand the AI commentary layer carefully, starting with recap enhancement, per-thread summaries, and session summaries, before considering top-alert commentary.
20. Use real support-test sessions to decide whether `watch_only` support should still get live continuity at all or whether more of that story belongs only in review artifacts until tradeability improves.
21. Validate the current first-activation flow in live use and decide whether the next improvement should be stronger activation-failure visibility in the UI rather than more tolerance or more startup complexity.
22. Validate the new quiet trader-context stack against saved and live sessions: small-cap volatility normalization should reduce penny-noise stories, data-quality gates should soften weak reads, and first-post trade-plan lines should improve the initial support/resistance post without creating new standalone Discord traffic.
23. Validate the new trade-story state fields against saved sessions: weak probes inside active range boxes should decline, accepted breaks should still post, and end-of-thread recap plus visual replay reports should make noisy threads easier to diagnose without reading every Discord message manually.
24. Pair every post-noise tightening pass with the missed meaningful move audit so the roadmap optimizes for fewer useless posts without suppressing trader-critical changes.
25. Pair every session-level conclusion with candle-readiness and runtime-marker proof so old/stale data does not look like a current-code signal-quality finding.
