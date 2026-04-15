# Watchlist Monitoring Blueprint

## Suggested folder structure

```text
src/
  lib/
    monitoring/
      monitoring-types.ts
      watchlist-store.ts
      level-store.ts
      live-price-types.ts
      live-price-provider.ts
      monitoring-config.ts
      zone-utils.ts
      interaction-state-machine.ts
      event-detector.ts
      watchlist-monitor.ts

    alerts/
      alert-types.ts
      alert-router.ts

  scripts/
    run-watchlist-monitor-sample.ts
```

## Data flow

watchlist
→ load stored levels
→ start live provider
→ receive price updates
→ update monitoring state
→ detect events
→ emit structured events
→ downstream alert layer later

## Immediate implementation target

Build a single-process monitor that can:
- monitor a small watchlist
- accept simulated or stub price updates
- detect events against stored zones
- print structured events

## Design rules

- monitoring logic must not rebuild levels
- keep live provider separate from event detection
- keep state transitions explicit
- alert formatting must stay downstream
