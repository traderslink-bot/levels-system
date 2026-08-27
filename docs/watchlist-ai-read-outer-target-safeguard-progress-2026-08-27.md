# Watchlist AI Read Outer Target Safeguard Progress

**Status:** Implemented locally; release pending

**Controlling record:** [Watchlist AI and Provider Corrections Progress](watchlist-ai-provider-corrections-progress-2026-08-26.md)

## Scope

After an AI Read draft passes the existing tactical-map validator, append one
factual outer target only when its furthest upside target is less than 30%
above the visible breakout-continuation price.

The candidate comes only from the exact current Potential Path presentation's
resistance evidence. It must be a finite, materially spaced strong/major daily
structure or daily-confluence resistance between 30% and 50% above breakout
continuation, and it must sit above every returned AI target.

The added target is labeled `Daily resistance`; its displayed condition carries
the exact current Potential Path level label, including the factual distance,
strength, and daily structure/confluence source. Existing AI targets are
preserved in their original order. If breakout continuation is unavailable or
no candidate qualifies, the AI output is unchanged: no estimate, invented
price, retry, or provider request.

## Selection and validation

- Choose the farthest qualifying price.
- For equal prices, prefer major over strong, daily confluence over daily
  structure, then greater source-evidence count and confluence count.
- Re-run the existing tactical-map validator after insertion, including its
  normal spacing check.
- The normal published AI boundary includes all targets, so the added factual
  outer target becomes the existing automatic-refresh boundary without a
  separate lifecycle change.

## Local checkpoint

- [x] Reused `buildLiveWatchlistPotentialPathPresentation(snapshot)` rather
  than duplicating Potential Path mapping or LevelEngine calculations.
- [x] Confirmed the presentation helper has no import path back into the AI
  service before importing it.
- [x] Kept the model packet's no-ladder rule unchanged; this is deterministic
  post-validation insertion from the contemporaneous factual snapshot only.
- [ ] Coordinator release and post-release AI Read review.

## Verification boundary

Only focused source review and `git diff --check` are permitted for this
checkpoint. No tests, build, server, provider or OpenAI request, runtime
action, configuration change, deployment, restart, or migration is part of
this work.
