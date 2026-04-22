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
- Long-run sessions can also collect human review feedback in `human-review-feedback.jsonl` via `scripts/add-long-run-review-feedback.ps1`, and the live session summaries will fold that feedback into the review artifacts.
- The in-app runtime status panel shows the active provider, diagnostics mode, active symbol count, session folder, and which logs to review.
- Trader-facing Discord alerts now include:
  - trader-friendly level wording such as `light support`, `heavy resistance`, and `major support`
  - a tactical read of `firm` versus `tired` structure when the zone evidence clearly supports that distinction
  - directional tactical scoring so tired support is penalized for support-hold ideas while tired resistance can help a real breakout case
  - a compact severity / confidence / score line plus trigger price
  - a `watch` / invalidation line
  - nearby barrier context when the next support or resistance is known, including whether room is `tight`, `limited`, or `open`
- Support and resistance ranking is now durability-aware, so levels that are structurally important but getting tired can be described more conservatively than freshly defended levels.
- Monitoring events and opportunity ranking now carry barrier-clearance context, so cramped upside or downside room can reduce setup quality before the message layer ever formats it.
- Long-run session summaries now track alert-posting families and suppression reasons, so noisy symbols and repetitive low-value alert patterns are easier to spot after a live run.
- Validation candle cache lives under `.validation-cache/` locally and is ignored by git.
- Runtime compare and surfaced-adapter evaluation docs start in [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
- Signal-quality ideas, priorities, and progress are tracked in [docs/30_SIGNAL_QUALITY_ROADMAP.md](docs/30_SIGNAL_QUALITY_ROADMAP.md).
- The human alert-feedback workflow is documented in [docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md](docs/31_ALERT_REVIEW_LOOP_WORKFLOW.md).

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

## Docs

Start with [docs/00_DOC_INDEX.md](docs/00_DOC_INDEX.md).
