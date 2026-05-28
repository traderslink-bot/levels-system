# Runtime Handoff - 2026-04-21

## Purpose

This note is for the next chat so runtime-testing context does not need to be rebuilt from scratch.

## What Was Just Changed

- Narrow compare-mode normalization fix shipped in:
  - `src/lib/levels/level-ranking-comparison.ts`
- Breakout / breakdown / reclaim quality was refined in:
  - `src/lib/monitoring/event-detector.ts`
- Opt-in filtered runtime diagnostics were added in:
  - `src/lib/monitoring/monitoring-event-diagnostic-logger.ts`
  - `src/lib/monitoring/watchlist-monitor.ts`
  - `src/runtime/manual-watchlist-server.ts`
- Current intended behavior now:
  - actionable levels still drive compare-mode `topSupport` / `topResistance`
  - deeper anchors remain separate structural context
  - weak fly-by breakout confirmations stay suppressed unless there was real prior interaction or the move is forceful
  - support reclaim requires a recent real break attempt
  - runtime diagnostics can explain emitted and suppressed decisions without spamming the log

## Why The Fix Was Made

Live compare testing produced misleading lines like:

- `ASBP`
  - old top resistance: `0.2386`
  - alternate/new top resistance: `23.98 (respected)`

That `23.98` reading was not a good trader-facing actionable resistance. It was a deeper anchor being interpreted as the primary resistance in compare output.

## Verification Already Completed

- `npm test -- --test src/tests/level-ranking-comparison.test.ts`
- `npm test -- --test src/tests/level-surfaced-selection.test.ts`
- `npm run build`
- `npm test`
- `npm run check`

All passed.

## Live Runtime Verification Already Completed

- A clean compare-mode restart was run against live IBKR runtime state.
- A fresh `level_runtime_compare` line for `ASBP` was captured.
- Result:
  - `23.98` no longer appeared as `alternateTopResistance`
  - the compare-mode anchor leak now looks resolved after restart

## Monitoring Diagnostics Workflow

To enable filtered monitoring-event diagnostics during the manual runtime:

```powershell
$env:LEVEL_MONITORING_EVENT_DIAGNOSTICS = '1'
npm run watchlist:manual
```

What now logs:

- emitted `breakout`, `breakdown`, `fake_breakout`, `fake_breakdown`, and `reclaim` decisions
- suppressed decisions only when they:
  - are near the decision boundary
  - carry meaningful state like prior interaction or a recent break attempt
  - change reason/state
  - recur after cooldown

What no longer floods the log:

- far-away idle suppressions on every tick for every zone

## Important Live Findings To Carry Forward

### 1. Activation latency is still a real issue

- Runtime is functionally working.
- Multiple symbols can activate.
- Initial activation is still slow in practice because IBKR historical seeding is the bottleneck.
- This remains a better next operational target than more level-scoring tweaks if UX is the priority.

### 2. Adaptive evidence is now saying something useful

Current live pattern from the pasted runtime diagnostics:

- `level_touch`
  - disabled for negative expectancy
- `reclaim`
  - disabled for negative expectancy
  - clearly the weakest event family right now
- `compression`
  - healthiest event family
  - repeatedly remains enabled
  - repeatedly tops live opportunity lists
- `breakdown`
  - looks acceptable
  - remains enabled

### 3. Breakout / reclaim quality was tightened, but now needs real runtime evidence

- The level-quality system is still farther along than the breakout-quality system.
- The newest breakout / reclaim gating pass is in place.
- The next question is no longer "what should we guess-tune?"
- The next question is "what do real emitted or near-emitted live decisions show?"

If runtime activation speed is not the next job, the strongest logic candidate remains:

- reclaim / breakout refinement
- not another broad level-strength rewrite

## First Check To Do In The Next Chat

Do this before new logic changes:

1. Leave filtered diagnostics on during a short live runtime session.
2. Capture the first real emitted or near-boundary diagnostic for:
   - `breakout`
   - `breakdown`
   - `reclaim`
3. Tune only from those live examples.

Good signals to look for:

- repeated `missing_prior_interaction_backfill`
- `no_recent_break_attempt`
- distance-threshold suppressions that are very close to firing
- any emitted reclaim that still feels trader-wrong in context

## Suggested Priority Order For The Next Chat

1. Capture one or two real live diagnostic edge cases with the filtered logger on.
2. If they reveal obvious threshold misses, make another narrow breakout / reclaim calibration pass.
3. Separately, keep activation-latency work on the table as the main operational improvement area.
4. Only return to compare-mode tracing if a fresh live compare regression appears again.
