# Alert Scoring Rules

## Base logic

Alert score should come from:
- event type importance
- underlying level strength
- timeframe confluence
- source of the zone
- whether the zone is strong, major, or weak
- freshness of the zone
- ladder position
- remap / replacement context
- recent refresh state
- promoted-extension state
- data-quality degradation penalty

## Event type importance

Suggested order:
- fake breakout / fake breakdown: very important
- breakout / breakdown: important
- reclaim / rejection: meaningful
- compression: lower importance unless level is strong

## Confidence examples

High confidence:
- breakout on major mixed timeframe resistance
- fake breakout on major resistance
- reclaim through strong support after failure

Medium confidence:
- breakout on strong 4h zone
- rejection on mixed zone
- compression near major zone

Low confidence:
- signal from weak 5m-only zone
- compression near weak level
- isolated event without strong context

## Filtering principle

Weak alerts should be suppressed before formatting whenever they do not add practical value.

Current suppression emphasis:
- weak inner-ladder touches should usually not survive unless stronger context supports them
- inner-ladder compression chatter should usually be suppressed unless the event is materially stronger
- promoted-extension and outermost-ladder interactions should survive more often when structurally strong
- low-severity alerts under degraded data quality should generally be suppressed

## Posting policy and deduplication

After scoring/filtering, delivery policy should:
- suppress duplicate alerts for the same structural situation
- suppress lower-value alerts when a stronger recent alert already covers that same scope
- preserve materially new state changes even inside a short interval

Materially new examples:
- remap status changes such as `replaced` or `merged`
- promoted-extension context
- outermost ladder transitions
- freshness changes
- data-quality degradation changes
