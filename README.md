# Levels System

Candle-based support/resistance, watchlist monitoring, and alert-intelligence tooling for TraderLink.

## Quickstart

1. Install dependencies with `npm ci`.
2. Create a local `.env` only when you want real integrations such as Discord or provider credentials.
3. Ensure IBKR/TWS or IB Gateway is running before using live/manual runtime paths.
4. Run `npm run check` to verify the repo.

## Runtime notes

- `npm run watchlist:manual` starts the manual watchlist server on `127.0.0.1:3010` by default.
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
  - `session-review.md` for the fastest human-readable verdict on whether the run looked useful, noisy, or in need of attention
  - `trader-thread-recaps.md` for short end-of-session symbol recaps that are easier to skim than JSON
- Long-run sessions now also post in-thread continuity updates and symbol recaps, so active symbols can explain what changed during the session instead of only relying on isolated setup alerts.
- Long-run sessions can also collect human review feedback in `human-review-feedback.jsonl` via `scripts/add-long-run-review-feedback.ps1`, and the live session summaries will fold that feedback into the review artifacts.
- Optional AI commentary can be enabled with `LEVEL_AI_COMMENTARY=1` plus `OPENAI_API_KEY`; the runtime will then enhance eligible in-session recaps and `npm run longrun:ai:summary -- <session-folder>` can generate a post-run `session-ai-review.md`.
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
- In-flight evaluations can now also post live follow-through state changes such as `improving`, `stalling`, or `degrading` before the final evaluation window closes.
- Discord level snapshots now include a nearest support/resistance map line plus signed distance-from-price context beside each ladder level, and that map line now classifies the room as `bullish`, `bearish`, or `balanced` when possible.
- Support and resistance ranking is now durability-aware, so levels that are structurally important but getting tired can be described more conservatively than freshly defended levels.
- Monitoring events and opportunity ranking now carry barrier-clearance context, so cramped upside or downside room can reduce setup quality before the message layer ever formats it.
- Monitoring events and opportunity ranking now also carry multi-barrier `path quality` plus explicit zone `exhaustion` context, so layered pathing and over-tested zones can reduce setup quality before they reach Discord.
- Long-run session summaries now track alert-posting families and suppression reasons, so noisy symbols and repetitive low-value alert patterns are easier to spot after a live run.
- Long-run review now tracks evaluated follow-through and downweights pure diagnostic chatter when a symbol is otherwise acting normally, so a session like `AKAN` is less likely to look noisier than it really was.
- Long-run review now also tracks evaluated follow-through by alert event type, so `session-summary.json`, `thread-summaries.json`, and `session-review.md` can show which alert families are holding up cleanly versus leaning negative.
- Long-run review now also classifies the latest evaluated follow-through as `strong`, `working`, `stalled`, or `failed`, so session artifacts can say whether a posted setup actually kept moving the right way instead of only showing raw return percentages.
- Long-run review now also tracks live continuity posts, live follow-through state updates, and recap posts per symbol, so a thread can be judged as an evolving story instead of just a stack of alerts.
- Long-run review now also flags the most dynamic symbols and calls out when repeated activate/deactivate churn or negative follow-through makes a symbol thread look less trustworthy than its raw alert count.
- Alert payload metadata and Discord delivery audit rows now also carry explicit first-target context, so long-run review can compare whether alerts with clear nearby objectives are behaving better than vague ones.
- Alert payload metadata and Discord delivery audit rows now also carry pressure labels and raw pressure score, so long-run review can compare whether strong-control alerts are behaving better than tentative ones.
- Alert payload metadata and Discord delivery audit rows now also carry trigger-quality labels, so long-run review can compare whether `clean` entries actually outperform `crowded` or `late` ones.
- Alert payload metadata and Discord delivery audit rows now also carry setup-state labels, so long-run review can compare whether building, confirmation, continuation, weakening, or failed setups are being posted at the right times.
- Alert payload metadata and Discord delivery audit rows now also carry failure-risk labels, so long-run review can compare whether contained setups behave better than elevated-risk ones.
- Alert payload metadata and Discord delivery audit rows now also carry barrier-clutter, path-quality, exhaustion, dip-buy-quality, continuity, recap, AI-origin, and follow-through metadata, so long-run review can compare clean paths versus crowded ones, fresh zones versus worn ones, human-written recaps versus AI-enhanced recaps, and initial alerts versus what happened afterward.
- Directional alert scoring is now more conservative when a setup is `crowded` or `late`, when pressure is only tentative, or when an inner breakout also carries degraded data quality.
- Validation candle cache lives under `.validation-cache/` locally and is ignored by git.
- Runtime compare and surfaced-adapter evaluation docs start in [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
- Signal-quality ideas, priorities, and progress are tracked in [docs/30_SIGNAL_QUALITY_ROADMAP.md](docs/30_SIGNAL_QUALITY_ROADMAP.md).
- The human alert-feedback workflow is documented in [docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md](docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md).
- The optional AI commentary workflow is documented in [docs/32_AI_COMMENTARY_WORKFLOW.md](docs/32_AI_COMMENTARY_WORKFLOW.md).

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
