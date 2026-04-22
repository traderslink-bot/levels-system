# Runtime Handoff - 2026-04-21

## Purpose

This note is for the next chat so runtime-testing context does not need to be rebuilt from scratch.

## What Was Just Changed

- Narrow compare-mode normalization fix shipped in:
  - `src/lib/levels/level-ranking-comparison.ts`
- The compare normalizer no longer mixes:
  - actionable surfaced levels
  - deeper anchor context levels
- Intended behavior now:
  - actionable levels still drive comparable `topSupport` / `topResistance`
  - deeper anchors remain separate structural context
  - runtime extension behavior remains handled through:
    - `src/lib/levels/level-runtime-output-adapter.ts`
    - legacy `extensionLevels`

## Why The Fix Was Made

Live compare testing produced misleading lines like:

- `ASBP`
  - old top resistance: `0.2386`
  - alternate/new top resistance: `23.98 (respected)`

That `23.98` reading was not a good trader-facing actionable resistance. It was a deeper anchor being interpreted as the primary resistance in compare output.

## Verification Already Completed

- `npm test -- --test src/tests/level-ranking-comparison.test.ts`
- `npm test -- --test src/tests/level-surfaced-selection.test.ts`

Both passed.

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

### 3. Breakout / reclaim quality still looks like the next logic weakness

The level-quality system is much farther along than the breakout-quality system.

If runtime activation speed is not the next job, the strongest logic candidate is:

- reclaim / breakout refinement
- not another broad level-strength rewrite

## First Check To Do In The Next Chat

Do this before more analysis:

1. Restart the runtime.
2. Run compare mode again:

```powershell
$env:LEVEL_RUNTIME_MODE = 'compare'
$env:LEVEL_RUNTIME_COMPARE_ACTIVE_PATH = 'old'
npm run watchlist:manual
```

3. Capture one fresh `level_runtime_compare` line for `ASBP`.

Expected result after the fix:

- `23.98` should no longer appear as `alternateTopResistance` if it is only a deeper anchor.

If `23.98` still appears after a clean restart:

- trace the remaining path from:
  - `src/lib/levels/level-runtime-output-adapter.ts`
  - `src/lib/levels/level-runtime-comparison-logger.ts`
  - any path feeding `ComparablePathOutput` for compare mode

## Suggested Priority Order For The Next Chat

1. Verify the fresh post-restart `ASBP` compare line.
2. If fixed, move to reclaim / breakout-quality refinement.
3. If not fixed, continue tracing compare-output construction until the anchor leak is fully removed.
4. Separately, keep activation-latency work on the table as the main operational improvement area.

