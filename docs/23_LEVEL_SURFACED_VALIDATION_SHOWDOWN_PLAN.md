# Level Surfaced Validation Showdown Plan

## Purpose

This phase exists to answer a practical question:

Is the new surfaced selection adapter actually better than the old surfaced runtime output when judged on forward trader usefulness?

This is not another scoring architecture pass.

This is an evidence pass.

## What is being compared

The showdown compares two systems on the same snapshot and the same forward candle window:

1. Old surfaced runtime output
   - the current live bucketed surfaced path
   - generated from the existing level engine scorer/ranker flow

2. New surfaced adapter output
   - the new structural ranking layer
   - plus the surfaced selection adapter built on top of it

## Why this phase is needed

Earlier comparison work showed:

- the raw structural ranking layer alone was richer but often too deep
- the old surfaced path was still better at near-price trader usefulness

The new surfaced adapter was built to close that gap.

This validation pass measures whether it actually does.

## Surfaced usefulness metrics

Each system is scored on:

1. Actionable quality
   - nearest actionable support/resistance exists
   - those levels are inside a practical distance band

2. Ladder cleanliness
   - surfaced level counts stay readable
   - redundant nearby same-band levels are penalized
   - spacing stays useful

3. Forward interaction relevance
   - surfaced levels matter on the forward window
   - a hold, rejection, or clean break can all count as relevance

4. First interaction alignment
   - the nearest surfaced levels should align with the first meaningful forward interaction

5. Structural sanity
   - broken or low-credibility surfaced levels should not look good just because they are close

6. Anchor usefulness
   - deeper anchors are evaluated separately from near-price actionable levels
   - anchors should add context, not clutter

## How forward validation works

For each case:

1. Freeze a snapshot price.
2. Generate old surfaced output.
3. Generate new surfaced adapter output.
4. Evaluate both on the same forward candles.
5. Score both systems on surfaced usefulness instead of just internal level scores.

Important rule:

A clean break can still count as a useful surfaced level if price clearly interacted with it.

## Migration interpretation

The showdown is meant to support these decisions:

- keep calibrating
- run shadow mode
- eventually allow an optional runtime flag

Recommended reading order:

1. `21_LEVEL_RANKING_COMPARISON_AND_MIGRATION_PLAN.md`
2. `22_LEVEL_SURFACED_SELECTION_ADAPTER_PLAN.md`
3. this showdown document

## Current implementation files

- `src/lib/levels/level-surfaced-validation.ts`
- `src/scripts/run-level-surfaced-validation.ts`
- `src/tests/level-surfaced-validation.test.ts`

## Initial evidence snapshot

First deterministic showdown run:

- total cases: `6`
- old wins: `1`
- new wins: `4`
- mixed: `1`
- inconclusive: `0`
- average validation score old: `66.96`
- average validation score new: `73.58`
- migration readiness: `ready_for_shadow_mode`

Important caveat:

One old-path win remains, so this is not yet evidence for blind replacement.

The current recommendation is:

- yes to shadow-mode evaluation
- not yet to live default replacement
