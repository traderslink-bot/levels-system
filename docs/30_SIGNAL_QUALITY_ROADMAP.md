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

## Active Backlog

### End-user output improvements

- Add end-of-session summaries for symbols that produced multiple alerts.
- Add explicit `why now` and `what changed` wording for higher-priority alerts.
- Improve low-priced-symbol phrasing so tiny decimal moves remain readable and not misleading.

### Detection and ranking improvements

- Add overhead-clearance awareness so dip-buy style support signals are downgraded when there is very little room to the next meaningful resistance.
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

## Current Hypotheses To Test

- Strong-support `level_touch` events are more useful when framed as dip-buy tests rather than generic zone touches.
- Outermost and promoted-extension zones are usually more trader-useful than weak inner-zone touches.
- A signal becomes much more useful when the message says both:
  - what happened
  - what must happen next for the idea to remain valid
- Some false-positive dip-buy ideas are probably caused by poor overhead-clearance awareness rather than weak support ranking alone.
- Some false-positive heavy-support / heavy-resistance reads are probably caused by structurally strong but durability-fragile levels being described too aggressively.

## Next Recommended Implementation Steps

1. Add stronger clearance-aware message wording so tight-room setups are explained more bluntly to the trader.
2. Add a human review loop that records whether an alert was useful, noisy, late, or wrong.
3. Add end-of-session summaries for symbols that produced multiple alerts and materially changed state.
4. Add an AI commentary layer on top of the cleaned deterministic signal stream.
