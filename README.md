# Levels System

Candle-based support/resistance, watchlist monitoring, and alert-intelligence tooling for TraderLink.

## Quickstart

1. Install dependencies with `npm ci`.
2. Create a local `.env` only when you want real integrations such as Discord or provider credentials.
3. Ensure IBKR/TWS or IB Gateway is running before using live/manual runtime paths.
4. Run `npm run check` to verify the repo.

## Runtime notes

- `npm run watchlist:manual` starts the manual watchlist server on `127.0.0.1:3010` by default.
- The manual UI now binds immediately, even while IBKR connection and persisted-symbol restore are still booting in the background, so the browser should show the app instead of `ERR_CONNECTION_REFUSED` during long startup restores.
- `/api/runtime/status` and `/api/watchlist` now expose `startupState` and `startupError`, and activate/deactivate requests return `503` until runtime startup is actually ready.
- Manual activation seeding is now bounded by a timeout, so a symbol that hangs during level generation should fail explicitly instead of sitting in `refresh_pending` forever.
- Set `LEVEL_MONITORING_EVENT_DIAGNOSTICS=1` before `npm run watchlist:manual` to emit filtered `monitoring_event_diagnostic` JSON lines for breakout / breakdown / fakeout / reclaim decisions.
- Diagnostic logging is intentionally filtered:
  - emitted decisions always log
  - suppressed decisions only log when they are near the threshold, carry meaningful state, change reason, or recur after cooldown
- For multi-hour manual testing on Windows, use `scripts/start-manual-watchlist-long-run.ps1` so each session gets a timestamped full log plus a smaller filtered review log under `artifacts/long-run/`.
- Long-run sessions now also emit structured `manual_watchlist_lifecycle` JSON lines and a local `discord-delivery-audit.jsonl` file so activation/deactivation, snapshot posting, alert posting, and downstream Discord delivery can be reviewed after the fact.
- Long-run sessions now split review surfaces:
  - `manual-watchlist-operational.log` for lifecycle, failures, compare output, and Discord delivery
  - `manual-watchlist-diagnostics.log` for `monitoring_event_diagnostic` reasoning
  - `session-summary.json` for a quick session-level and per-symbol rollup
  - `thread-summaries.json` for a compact trader-facing story per active symbol
  - `thread-clutter-report.json` for deterministic thread-clutter analysis, post-category counts, and context-density risk
  - `session-review.md` for the fastest human-readable verdict on whether the run looked useful, noisy, or in need of attention
  - `trader-thread-recaps.md` for short end-of-session symbol recaps that are easier to skim than JSON
- Long-run sessions now also post in-thread continuity updates and symbol recaps, so active symbols can explain what changed during the session instead of only relying on isolated setup alerts.
- Long-run review now explicitly classifies output into:
  - trader-critical live posts
  - trader-helpful but optional live posts
  - operator-only artifacts and diagnostics
- Long-run sessions can also collect human review feedback in `human-review-feedback.jsonl` via `scripts/add-long-run-review-feedback.ps1`, and the live session summaries will fold that feedback into the review artifacts.
- Optional AI commentary can be enabled with `LEVEL_AI_COMMENTARY=1` plus `OPENAI_API_KEY`; the runtime will then enhance eligible in-session recaps and `npm run longrun:ai:summary -- <session-folder>` can generate post-run `session-ai-review.md` and `thread-ai-recaps.md` artifacts.
- The in-app runtime status panel shows the active provider, diagnostics mode, active symbol count, session folder, and which logs to review.
- Trader-facing Discord alerts now include:
  - trader-friendly level wording such as `light support`, `heavy resistance`, and `major support`
  - a `why now` line so the user sees why the setup matters at this moment instead of only getting the label
  - a `movement` line so the user sees how far price has already pushed through or back into the zone when the alert fires
  - a `pressure` line so the user sees whether buyers or sellers still have strong, workable, or tentative control behind the move
  - a `target` line so the user sees the first directional objective explicitly when the next barrier is known
  - a `trigger quality` line so the user can tell whether the setup looks `clean`, `workable`, `crowded`, or `late`
  - a `dip-buy quality` line on support-test alerts so the user can tell whether a bounce looks actionable, watch-only, or tactically poor
  - a `path quality` line so the user can tell whether the move has a cleaner route or is likely to chop through layered nearby barriers
  - a `support/resistance exhaustion` line so the user can tell when a level still matters structurally but is getting worn out tactically
  - a `setup state` line so the user can tell whether the idea is still building, confirming, continuing, weakening, or already failed
  - a `failure risk` line so the user can see whether the setup still looks contained or is already carrying elevated failure risk from tight room, weak control, tired structure, or degraded context
  - a `trade map` line so the user sees rough room-to-next-barrier versus risk-to-invalidation before acting
  - a tactical read of `firm` versus `tired` structure when the zone evidence clearly supports that distinction
  - directional tactical scoring so tired support is penalized for support-hold ideas while tired resistance can help a real breakout case
  - a compact severity / confidence / score line plus trigger price
  - a `watch` / invalidation line
  - nearby barrier context when the next support or resistance is known, including whether room is `tight`, `limited`, or `open`
  - nearby pathing context when overhead or downside gets `stacked` or `dense` beyond the first barrier
- Completed opportunity evaluations now post live thread follow-through updates, so the trader can see whether a setup stayed `strong`, kept `working`, `stalled`, or `failed` after the original alert.
- In-flight evaluations can now also post smarter live follow-through state changes such as `improving`, `stalling`, or `degrading` before the final evaluation window closes, with higher thresholds and cooldowns to avoid low-value chatter.
- Continuity and recap posting are now tighter too: setup-forming chatter is suppressed more aggressively, confirmation/weakening recaps are preferred over generic narration, and optional live context is pushed harder toward operator artifacts when the thread is not genuinely evolving.
- Optional live context is now also category-aware and thread-density-aware: recap, continuity, and follow-through-state posts look at recent critical-vs-optional post mix, treat recap more strictly than continuity, and are less willing to add non-directional narration when the symbol thread is already context-heavy.
- Optional live context now also backs off faster once it starts materially outnumbering trader-critical thread beats, so context-heavy symbols like `BURU` are less likely to keep stacking continuity and recap posts after the main story has already been told.
- Optional live context is now also event-family-aware: `level_touch` and `compression` threads only get a much narrower continuity / recap / live-state path than breakout-style threads, so support-test symbols like `AUUD` do not narrate themselves as freely as cleaner directional setups.
- Optional live context is now even more selective by family: `rejection`, `fake_breakout`, and `fake_breakdown` threads also keep a tighter continuity / live-state budget than cleaner breakout / breakdown / reclaim threads.
- Optional narration now also has a short burst guard across continuity, live-state, recap, and follow-through updates, so one symbol is less likely to stack a same-minute cascade of trader-facing thread posts.
- Reactive same-event narration is now tighter too: once a `level_touch` or `compression` setup has already used one optional narration beat in the current burst window, the runtime is much less willing to post a second optional restatement for that same event immediately afterward.
- Reactive same-event narration now also checks in-flight optional posts before the first route resolves, so `level_touch` / `compression` threads are less likely to slip out both a continuity update and a live-state update during the same short race window.
- Continuity is now tighter around fresh critical beats too: setup-forming narration yields to newly posted alerts and same-label continuity transitions are collapsed before the first post even finishes routing, so symbols like `AIXI` and `AUUD` are less likely to over-explain the same move.
- Continuity now also yields more aggressively to same-window live follow-through-state posts, so a `stalling` / `improving` state update is less likely to be followed by a weaker setup-forming or weakening restatement that tells the trader almost the same thing.
- Optional continuity and live-state posts now also use a short runtime-only settle window before routing, so a fresh trader-critical alert can claim the thread story first instead of letting weaker optional narration slip out a moment earlier.
- Monitoring-event continuity now only posts when the interpretation matches the triggering event side and level closely enough, so a resistance alert is less likely to be followed by accidental support wording when multiple same-symbol opportunities coexist.
- When a price-update snapshot already carries a completed evaluation for the same symbol and event type, the completed follow-through post now owns that story and the runtime skips weaker progress-driven continuity / live-state narration for that same event.
- Optional live narration now also backs off briefly after recent Discord delivery failures for that symbol, so a thread is less likely to feed more optional context into a short 429/rate-limit spiral.
- Discord level snapshots now include a nearest support/resistance map line plus signed distance-from-price context beside each ladder level, and that map line now classifies the room as `bullish`, `bearish`, or `balanced` when possible.
- Support and resistance ranking is now durability-aware, so levels that are structurally important but getting tired can be described more conservatively than freshly defended levels.
- Monitoring events and opportunity ranking now carry barrier-clearance context, so cramped upside or downside room can reduce setup quality before the message layer ever formats it.
- Monitoring events and opportunity ranking now also carry multi-barrier `path quality` plus explicit zone `exhaustion` context, so layered pathing and over-tested zones can reduce setup quality before they reach Discord.
- Long-run session summaries now track alert-posting families and suppression reasons, so noisy symbols and repetitive low-value alert patterns are easier to spot after a live run.
- Long-run review now tracks evaluated follow-through and downweights pure diagnostic chatter when a symbol is otherwise acting normally, so a session like `AKAN` is less likely to look noisier than it really was.
- Long-run review now also tracks evaluated follow-through by alert event type, so `session-summary.json`, `thread-summaries.json`, and `session-review.md` can show which alert families are holding up cleanly versus leaning negative.
- Long-run review now also classifies the latest evaluated follow-through as `strong`, `working`, `stalled`, or `failed`, so session artifacts can say whether a posted setup actually kept moving the right way instead of only showing raw return percentages.
- Long-run review now also tracks live continuity posts, live follow-through state updates, and recap posts per symbol, so a thread can be judged as an evolving story instead of just a stack of alerts.
- In-session recap posts now include a deterministic `What matters next` line, so long-lived symbols can summarize the current state and the next requirement for continuation instead of forcing the trader to infer it from scattered alerts.
- Long-run review now also flags the most dynamic symbols and calls out when repeated activate/deactivate churn or negative follow-through makes a symbol thread look less trustworthy than its raw alert count.
- Thread-clutter review now treats truly low-context live threads as low clutter even when the underlying symbol was suppression-heavy internally, so quiet symbols like `AIXI` do not get mislabeled as context-heavy just because the detector kept rejecting setups.
- Long-run thread review now also distinguishes `activating` and clearly `observational` symbols from genuinely noisy ones, so symbols like `AKAN` and `AIXI` read more honestly in review artifacts when they simply have not produced meaningful live trader output yet.
- Long-run review now also treats startup-pending no-output threads more neutrally, so symbols that are still seeding or waiting for the first visible snapshot are less likely to be mislabeled as `noisy` just because runtime startup has not finished telling its story yet.
- Long-run review now also treats `refresh_pending` no-output threads as pending work instead of noise, so symbols that are still waiting on a delayed refresh/seed read more honestly in the review artifacts.
- Startup-pending threads now also get a neutral quality floor in review scoring, so an `activating` symbol with no visible output and no failures is less likely to contradict itself by showing `activating` in the headline but `noisy` in the verdict.
- Long-run review now also recognizes controlled reactive watch-mode threads, so snapshot-led `level_touch` / `compression` monitoring is less likely to be mislabeled as clutter when it stayed gated and never turned into live alert spam.
- Support-test tradeability is now stricter too: repeated testing plus layered or limited overhead push support touches toward `watch_only` or `tactically poor` more aggressively, and that tighter judgment also feeds opportunity ranking instead of living only in the wording layer.
- Duplicate extension posting is now guarded more tightly too, so overlapping refresh paths are less likely to repost the same `NEXT LEVELS` payload in a burst.
- Long-run review now distinguishes delivery-choked threads from structurally poor threads more clearly when Discord failures are the main thing making a symbol look messy.
- Alert payload metadata and Discord delivery audit rows now also carry explicit first-target context, so long-run review can compare whether alerts with clear nearby objectives are behaving better than vague ones.
- Alert payload metadata and Discord delivery audit rows now also carry pressure labels and raw pressure score, so long-run review can compare whether strong-control alerts are behaving better than tentative ones.
- Alert payload metadata and Discord delivery audit rows now also carry trigger-quality labels, so long-run review can compare whether `clean` entries actually outperform `crowded` or `late` ones.
- Alert payload metadata and Discord delivery audit rows now also carry setup-state labels, so long-run review can compare whether building, confirmation, continuation, weakening, or failed setups are being posted at the right times.
- Alert payload metadata and Discord delivery audit rows now also carry failure-risk labels, so long-run review can compare whether contained setups behave better than elevated-risk ones.
- Alert payload metadata and Discord delivery audit rows now also carry barrier-clutter, path-quality, path-constraint, path-window, exhaustion, dip-buy-quality, continuity, recap, AI-origin, and follow-through metadata, so long-run review can compare clean paths versus crowded ones, fresh zones versus worn ones, tighter first-path windows versus cleaner continuation space, human-written recaps versus AI-enhanced recaps, and initial alerts versus what happened afterward.
- Trader-facing wording is now slightly more disciplined too: default `contained` failure-risk lines, default `workable` trigger-quality lines, and fully clean one-barrier path-quality lines are suppressed when they are only restating the same benign idea.
- Directional alert scoring is now more conservative when a setup is `crowded` or `late`, when pressure is only tentative, or when an inner breakout also carries degraded data quality.
- Validation candle cache lives under `.validation-cache/` locally and is ignored by git.
- Runtime compare and surfaced-adapter evaluation docs start in [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
- Signal-quality ideas, priorities, and progress are tracked in [docs/30_SIGNAL_QUALITY_ROADMAP.md](docs/30_SIGNAL_QUALITY_ROADMAP.md).
- The human alert-feedback workflow is documented in [docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md](docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md).
- The optional AI commentary workflow is documented in [docs/32_AI_COMMENTARY_WORKFLOW.md](docs/32_AI_COMMENTARY_WORKFLOW.md).
- The tightening-pass review notes are in [docs/33_CODEX_RUNTIME_AND_SIGNAL_REVIEW_2026-04-23.md](docs/33_CODEX_RUNTIME_AND_SIGNAL_REVIEW_2026-04-23.md) and [docs/34_CODEX_EXECUTION_BRIEF_2026-04-23.md](docs/34_CODEX_EXECUTION_BRIEF_2026-04-23.md).

## Current capabilities

- Historical candle fetching through an injectable provider abstraction
- IBKR-backed historical candle provider
- Level generation across `daily`, `4h`, and `5m` timeframes
- Watchlist monitoring with event detection
- Alert intelligence scoring and filtering
- Sample runners for manual fetch, replay monitoring, and live monitoring

## Scripts

- `npm run check`
- `npm run build`
- `npm test`
- `npm run manual:test -- AAPL`
- `npm run watchlist:test -- AAPL`
- `npm run alert:test`
- `npm run watchlist:alerts:test -- AAPL`
- `npm run watchlist:manual`
- `npm run longrun:ai:summary -- <session-folder>`

## Docs

Start with [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
