# Level Surfaced Selection Adapter Plan

## Purpose

This document tracks the surfaced-selection bridge that sits between:

- the new structural ranking layer
- and the old trader-facing surfaced output behavior

The goal is not to replace the live runtime blindly.

The goal is to preserve the stronger structural truth of the new ranking layer while restoring the near-price trader usefulness that the old surfaced path often handled better.

## Why this adapter is needed

The side-by-side comparison work showed a clear gap:

- the old path often surfaced more actionable near-price levels
- the new path often preferred deeper structural levels

That does not mean the new structural layer is wrong.

It means the repo needed a surfaced-selection layer on top of that structural truth.

This adapter is that bridge.

## What this adapter does

The surfaced selector starts from `RankedLevelsOutput` produced by the new strength ranking layer.

It then selects trader-facing supports and resistances using a separate surfaced-selection model that balances:

- minimum structural credibility
- proximity to current price
- state quality
- ladder usefulness
- same-band suppression
- one optional deeper anchor level

This keeps surfaced output practical for:

- watchlist snapshots
- Discord-style output
- alert context

without throwing away:

- structural score
- confidence
- state
- explanation
- cluster metadata

## How it differs from raw structural ranking

Raw structural ranking asks:

- which levels are strongest overall

The surfaced adapter asks:

- which levels are strongest enough and also actionable right now

So the surfaced adapter can:

- surface a credible near-price level ahead of a deeper stronger level
- suppress a weak near-price level if a slightly farther level is much better
- remove redundant same-band clutter
- keep one deeper anchor for context without filling the ladder with distant structure

## How it differs from the old surfaced path

The old surfaced path:

- used bucket ownership by timeframe
- applied spacing-aware selection inside those buckets
- produced the current `LevelEngineOutput` contract

The new surfaced adapter:

- starts from the new ranked structural output instead of bucketed old zones
- does not mirror the old buckets
- keeps state, confidence, explanation, and structural metadata visible
- uses explicit surfaced-selection tuning instead of implicit bucket behavior

## Surfaced selection philosophy

A surfaced level should generally be:

- close enough to matter now
- structurally credible
- not redundant with a stronger nearby level
- in a usable state for trader-facing output

The selector generally penalizes or excludes:

- broken levels
- weakened levels unless they are still actionable enough
- far away levels unless they are used as anchors
- nearby duplicates already covered by a stronger surfaced level

## Migration implications

This adapter is the missing bridge needed before a safe runtime migration can be judged.

Recommended sequence:

1. Keep the old runtime surfaced contract live.
2. Run the new surfaced adapter side by side against the old surfaced output.
3. Compare:
   - nearest actionable support/resistance
   - duplicate suppression quality
   - ladder usefulness
   - whether the deeper anchor improves context without clutter
4. Only after that should the repo consider:
   - a feature-flagged runtime projection
   - or a replacement adapter into the old runtime contract

## Current implementation files

- `src/lib/levels/level-surfaced-selection-config.ts`
- `src/lib/levels/level-surfaced-selection.ts`
- `src/lib/levels/level-surfaced-selection-explainer.ts`
- `src/tests/level-surfaced-selection.test.ts`

## Current status

This adapter is ready for side-by-side evaluation against the old surfaced runtime path.

It is intentionally not the live default yet.
