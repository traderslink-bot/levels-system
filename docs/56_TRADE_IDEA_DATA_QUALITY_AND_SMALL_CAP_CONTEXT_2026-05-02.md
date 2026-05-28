# Trade Idea, Data Quality, And Small-Cap Context Layers

## What This File Is For

This file records the second quiet trader-context pass. It is for `levels-system` maintainers and the `trader-intelligence-v2` handoff thread, because these layers are shared market facts that consumer apps can use without copying candle logic.

The goal is to make the system read small-cap price action more like a real trader: not every one-cent wiggle is a new story, thin data should soften the read, and the first support/resistance post should explain the useful trade map without giving buy/sell instructions.

## New Layers Added

### 1. Trade Idea Summary

Implemented in `src/lib/trader-context/trader-context.ts`.

Returns labels such as:

- `range_trade`
- `breakout_watch`
- `support_reaction`
- `support_reclaim`
- `extended_runner`
- `noisy_chop`
- `needs_data`

This is deterministic and observational. It is meant to summarize the current setup as a read, not as execution advice.

### 2. Data Quality Gate

Combines liquidity, candle reaction, move extension, volatility, level ladder quality, halt awareness, and level-engine data flags into:

- `trusted`
- `watch`
- `degraded`
- `unusable`

The app can use this to soften or suppress commentary when the underlying data is not strong enough.

### 3. Small-Cap Volatility Normalizer

Reads recent 5-minute candle ranges, one-cent move size, spread, and price bucket.

It returns:

- `quiet`
- `normal`
- `volatile`
- `wild`
- `unknown`

This prevents low-priced names from treating one- or two-cent movement as a major structural change when that movement is ordinary for the price bucket.

### 4. Opening Range Context

Reads the 9:30-10:00 ET 5-minute candles and classifies whether price is:

- above the opening range
- below the opening range
- inside the opening range
- testing the opening high
- testing the opening low
- unavailable

This gives morning runners a real intraday anchor without creating standalone Discord posts.

### 5. Halt / Pause Awareness

Detects stale 5-minute candle gaps after fast moves. This is operator/audit context first. It helps prevent stale deterministic reads from sounding current when a symbol may be halted, paused, or not updating normally.

### 6. Level Quality Calibration

Reads the generated support/resistance ladder and classifies:

- `healthy`
- `thin_ladder`
- `wide_first_gap`
- `no_forward_levels`
- `unknown`

It does not invent missing levels. It only tells the app when the ladder is thin or the first forward level is unusually far away.

### 7. No-Post Explainer

Produces operator-only reasons for suppressing low-value repeated posts, such as:

- same story still inside cooldown
- normal small-cap wiggle
- unusable data quality
- no material candle change

This keeps “why nothing posted?” visible in artifacts without leaking test language into Discord.

### 8. First-Post Trade-Plan Formatter

`LevelSnapshotPayload` can now carry an optional `tradePlan` block. The formatter will include it above the existing `Trade map` when provided.

The wording is intentionally observational:

- `Primary read: ...`
- `Quality check: ...`
- `Volatility: ...`
- `Opening range: ...`
- `Level quality: ...`

It must not contain direct execution advice such as `buy`, `sell`, `best entry`, or `exit`.

## Signal Category Posture

New categories are quiet by default:

- `volatility_context`
- `opening_range`
- `halt_awareness`
- `level_calibration`
- `data_quality`
- `trade_idea_summary`
- `no_post_explainer`

Default behavior:

- live Discord: disabled
- operator artifacts: enabled
- internal scoring: enabled

`halt_awareness`, `data_quality`, and `no_post_explainer` are operator-only. `trade_idea_summary` is enrichment-only.

## Product Rules

- Long-biased trader framing only.
- No short-trade framing.
- No direct buy/sell/entry/exit instructions.
- Do not create standalone posts from these layers in v1.
- Do not hide real support/resistance levels to reduce noise.
- Do use the small-cap volatility floor to suppress low-value repeated stories.

## Verification

Focused tests should include:

```text
npx tsx --test src/tests/trader-context.test.ts src/tests/support-resistance-shared-api.test.ts src/tests/signal-category-config.test.ts src/tests/signal-category-routing.test.ts src/tests/alert-router.test.ts
```

Full verification should include:

```text
npm run build
npm test
npm run replay:monday -- --skip-slow
```
