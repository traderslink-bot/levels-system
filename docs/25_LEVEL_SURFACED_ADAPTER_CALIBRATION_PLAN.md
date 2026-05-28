# Level Surfaced Adapter Calibration Plan

## Purpose

This pass calibrates the surfaced selection adapter where shadow-mode evidence showed real trader-facing weakness.

It does not replace runtime behavior.
It does not redesign the structural layer.
It tightens surfaced selection only.

## Calibration targets

1. Broken-level exclusion
- broken support or resistance should not survive as actionable surfaced output by default

2. First-interaction alignment
- the top actionable surfaced level should align more closely with the first meaningful interaction when a credible near-price level exists

3. Near-price actionable selection
- weak close-in clutter should not beat a structurally credible slightly farther level

4. Measurable clutter reduction
- same-band ownership should be tighter so one surfaced level can represent a practical trader-facing band

## What changed

### Surfaced selection config

- increased broken-state penalty
- increased weakened-state penalty
- added a practical interaction band per side
- added near-price credibility gates
- added stronger weak-near-clutter penalties
- widened same-band suppression / band-ownership rules

### Surfaced selection logic

- first actionable selection now prefers credible levels inside the practical interaction band
- weak near-price clutter can be bypassed by a materially stronger slightly farther level
- once a credible near actionable level is chosen, tighter band ownership suppresses redundant nearby clutter
- strong non-practical levels can be treated as anchors instead of displacing the actionable ladder

### Validation scoring

- actionable quality and first-interaction alignment now account for surfaced credibility, not just distance
- this makes broken or weak near-price levels less likely to look artificially good just because they are close

## Expected outcome

The surfaced adapter should:
- keep its structural sanity edge
- improve near-price usefulness scoring
- improve first-interaction alignment summaries
- begin showing measurable clutter-cleanliness wins

## Remaining caution

Broken-level handling can still require more tuning in edge cases where the old path keeps a very close level that the new adapter intentionally suppresses. That should be reviewed through the rerun evidence, not guessed from architecture alone.
