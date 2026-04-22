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
- Added runtime-status visibility for the operator.
- Improved trader-facing alert payloads with severity, confidence, score, and trigger.
- Improved trader-facing alert wording so breakout, breakdown, reclaim, failed-move, and dip-buy style support tests are described in more useful language.
- Added trader-facing support/resistance strength wording:
  - `weak` -> `light`
  - `moderate` -> `moderate`
  - `strong` -> `heavy`
  - `major` -> `major`
- Improved level snapshot wording so support and resistance ladders now expose strength descriptors instead of only bare prices.

## Active Backlog

### End-user output improvements

- Add per-symbol thread summaries so a Discord thread tells a story instead of only isolated messages.
- Add end-of-session summaries for symbols that produced multiple alerts.
- Add explicit `why now` and `what changed` wording for higher-priority alerts.
- Improve low-priced-symbol phrasing so tiny decimal moves remain readable and not misleading.

### Detection and ranking improvements

- Add support durability scoring that distinguishes:
  - strong defended support
  - over-tested support that is getting fragile
  - reclaimed support after failed breakdown
- Add resistance durability scoring with the same idea on the bearish side.
- Add overhead-clearance awareness so dip-buy style support signals are downgraded when there is very little room to the next meaningful resistance.
- Add more explicit heavy/light support and resistance logic based on:
  - structural score
  - freshness
  - time-frame confluence
  - failed-break versus clean-break balance
  - current active pressure
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

- Track per-family post counts and suppression counts in session summaries.
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

## Next Recommended Implementation Steps

1. Add overhead-clearance scoring to the opportunity and alert layers so dip-buy style setups are penalized when upside room is cramped.
2. Add per-symbol session summaries that count alerts by family and identify the noisiest symbols and setups.
3. Add trader-facing thread summaries for active symbols.
4. Add an AI commentary layer on top of the cleaned deterministic signal stream.
