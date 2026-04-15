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
→ enrich with zone context
→ score alert importance
→ assign confidence
→ suppress weak alerts
→ format human-readable output
→ downstream Discord or UI later

## Design rules

- alert intelligence must not replace event detection
- event detection stays in Phase 2
- alert intelligence interprets events for humans
- formatting stays separate from scoring
- filtering thresholds must be configurable
