# Trade Story State And Replay Tooling

## What This File Is For

This file records the implementation pass for the seven practical trader-story improvements requested after support/resistance, market structure, volume, and quiet trader context were in place.

The goal is not to add more Discord posts. The goal is to make the app better at recognizing when a ticker is telling one evolving story instead of many tiny support/resistance stories.

## What Was Added

### 1. Trade State Machine

Implemented in:

- `src/lib/monitoring/trade-story-intelligence.ts`

The system now produces a `tradeStoryState` such as:

- `building`
- `testing_resistance`
- `breakout_attempt`
- `breakout_accepted`
- `breakout_failed`
- `pullback`
- `support_test`
- `support_lost`
- `reclaim_attempt`
- `reset`

These states are attached to monitoring event metadata and Discord audit rows. They are operator/scoring facts, not standalone Discord posts.

### 2. Range Box / Consolidation Detector

The new `rangeBox` context identifies when price is boxed between practical support and resistance. It includes:

- box low
- box high
- width percent
- count of recent posts inside the box
- trader-safe line explaining that small moves inside the box are lower-quality noise

Live policy now suppresses weak-probe/testing posts inside an already-posted active range box unless structure materially changes.

### 3. Acceptance Logic

The new `acceptance` context separates:

- clean accepted break
- weak probe
- testing
- rejected
- failed

This helps avoid treating a tiny wick or one-cent push above resistance as a real breakout story.

### 4. Support Importance Ranking

The new `supportImportance` context separates:

- `noise_support`
- `practical_support`
- `must_hold_structure`
- `deeper_failure_area`
- `unknown`

This is meant to stop the app from overreacting to tiny support flickers while still preserving important daily / 4h / clustered support areas.

### 5. Post Budget By Ticker Behavior

The new `behaviorBudget` context labels each symbol story as:

- `boring_range`
- `normal_trade`
- `active_runner`
- `extreme_runner`

The live policy now uses `boring_range` to clamp repeated weak range-box stories harder while still allowing accepted breaks and material structure changes.

### 6. End-Of-Thread Recap

Added:

- `src/lib/review/thread-end-recap.ts`
- `src/scripts/run-thread-end-recap.ts`
- npm script: `npm run audit:end-recap`

Usage:

```text
npm run audit:end-recap -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Outputs:

- `thread-end-recap-report.json`
- `thread-end-recap-report.md`

The report summarizes each symbol thread, top post families, range-box evidence, weak probes, mentioned levels, and the last visible story.

### 7. Visual Audit Replay

Added:

- `src/lib/review/visual-audit-replay.ts`
- `src/scripts/run-visual-audit-replay.ts`
- npm script: `npm run audit:visual-replay`

Usage:

```text
npm run audit:visual-replay -- artifacts\long-run\YYYY-MM-DD_HH-MM-SS
```

Outputs:

- `visual-audit-replay.json`
- `visual-audit-replay.html`

This gives a quick browser-friendly timeline of posts by symbol, with event type, acceptance label, range-box label, behavior-budget label, and approximate posted price when available.

## Live Discord Rule

These changes do not add standalone Discord post types.

They make existing alert policy smarter by letting weak range-box probes and boring repeated range stories stay out of Discord while accepted breaks and real structure changes remain eligible.

## Verification

Focused tests:

```text
npx tsx --test src/tests/trade-story-intelligence.test.ts src/tests/live-thread-post-policy.test.ts src/tests/thread-end-recap.test.ts src/tests/visual-audit-replay.test.ts
```

Full verification:

```text
npm run build
npm test
npm run replay:monday -- --skip-slow
```
