# Alert Intelligence Blueprint

## Suggested folder structure

```text
src/
  lib/
    alerts/
      alert-types.ts
      alert-config.ts
      alert-scorer.ts
      alert-filter.ts
      alert-formatter.ts
      alert-intelligence-engine.ts

  scripts/
    run-alert-intelligence-sample.ts
```

## Data flow

monitoring event
-> use explicit monitoring event context
-> score alert importance
-> assign confidence and severity
-> suppress weak low-value alerts
-> apply posting policy and deduplication
-> format compact deterministic trader-facing output
-> downstream Discord or runtime output

## Design rules

- alert intelligence must not replace event detection
- event detection stays in Phase 2
- alert intelligence interprets events for humans
- formatting stays separate from scoring
- filtering thresholds must be configurable
- delivery policy should stay separate from scoring and formatting
- scoring should preserve:
  - freshness
  - origin
  - remap status
  - ladder position
  - recent refresh state
  - extension-promotion state
  - data-quality degradation
- output should stay compact and deterministic rather than verbose
- posting policy should preserve materially new state such as:
  - remap/replacement transitions
  - promoted-extension activation
  - outermost-ladder significance
  - freshness or data-quality state changes
