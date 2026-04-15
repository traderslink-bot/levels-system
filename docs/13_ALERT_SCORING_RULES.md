# Alert Scoring Rules

## Base logic

Alert score should come from:
- event type importance
- underlying level strength
- timeframe confluence
- source of the zone
- whether the zone is strong, major, or weak

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
