# Watchlist Monitoring Blueprint

## Current folder structure

```text
src/
  lib/
    alerts/
      alert-types.ts
      alert-router.ts
      local-discord-thread-gateway.ts

    monitoring/
      monitoring-types.ts
      watchlist-store.ts
      watchlist-state-persistence.ts
      manual-watchlist-runtime-manager.ts
      level-store.ts
      live-price-types.ts
      ibkr-live-price-provider.ts
      monitoring-config.ts
      interaction-state-machine.ts
      event-detector.ts
      watchlist-monitor.ts
      opportunity-runtime-controller.ts
      opportunity-interpretation.ts

  runtime/
    main.ts
    manual-watchlist-server.ts
```

## Current data flow

manual watchlist page
-> manual watchlist runtime manager
-> watchlist store / watchlist persistence
-> Discord thread router
-> level seeding for active symbols
-> watchlist monitor
-> live price provider
-> event detection
-> alert intelligence scoring / filtering / formatting
-> alert routing
-> opportunity runtime controller

## Manual activation flow

1. user enters a symbol and optional note
2. symbol is normalized
3. existing watchlist record is reused if present
4. stored Discord thread id is checked first
5. if stored thread reuse fails, one recovery path is attempted by exact symbol thread name
6. if no reusable thread exists, a new thread is created with the symbol as the thread name
7. thread id is stored
8. symbol is marked active
9. levels are seeded for the symbol
10. a deterministic level snapshot message is posted into the symbol thread
11. live monitoring is restarted using the shared watchlist monitor path

## Manual deactivation flow

1. symbol is marked inactive
2. stored Discord thread id is kept
3. live monitoring is restarted without that symbol
4. downstream alert routing stops because the symbol is no longer active

## Level snapshot refresh flow

1. active symbol keeps the last posted level snapshot metadata in memory
2. runtime tracks both:
   - highest currently surfaced resistance
   - lowest currently surfaced support
3. the surfaced ladder is now spacing-aware, so these boundaries are taken from stronger distinct zones instead of overcrowded nearby noise
4. surfaced zones also reflect crowding-aware structural scoring, so weaker nearby same-side levels are less likely to remain in the visible ladder
5. if live price approaches either outer boundary within the configured threshold:
6. runtime first checks for already available extension levels on that side
7. extension ladders are also spacing-aware, so near-duplicate next levels are not posted as if they were new ladder information
8. if extension levels exist, a deterministic next-level post is sent into the same thread and those extension zones are activated into the monitored level set
9. if extension levels are not available yet, levels are regenerated through the shared level engine and a refreshed deterministic snapshot is posted
10. the watchlist monitor reconciles itself against the updated level-store version so stale zone state does not continue against replaced or newly activated extension zones
11. refresh and extension metadata prevent repeated reposts at the same boundary

## Monitored zone identity model

The runtime now distinguishes between:

- canonical generated levels
- extension inventory levels that are not yet active monitoring targets
- promoted extension levels that have become active monitored zones
- refreshed monitored zones that preserve, merge, split, or replace prior monitored identities

The monitored set uses explicit monitored ids instead of treating canonical level ids as runtime identity. This keeps refresh behavior deterministic when:

- a refreshed canonical zone strongly overlaps an existing monitored zone
- multiple prior monitored zones collapse into one stronger regenerated zone
- one prior monitored zone splits into multiple refreshed zones
- a promoted extension zone is later replaced by a canonical regenerated zone
- a prior monitored zone disappears entirely

Each active monitored zone carries typed context for:

- canonical zone id
- origin
- remap status
- remapped-from lineage
- freshness
- data-quality degradation
- recent refresh state
- recent extension-promotion state
- ladder position

Monitoring events now propagate that same context forward so downstream alert scoring and routing do not need to infer it later.

## Alert intelligence in the live path

The runtime no longer routes generic monitoring payloads directly to the user-facing alert channel.

Current live alert flow is:

monitoring event
-> alert intelligence engine
-> score using zone freshness, origin, remap status, ladder position, structural strength, recent refresh state, extension-promotion state, and data-quality degradation
-> suppress low-value inner-ladder chatter
-> apply posting policy and deduplication against recent posted structural state
-> format compact deterministic trader-facing output
-> route alert payload to Discord or local runtime output

This keeps monitoring truth and trader-facing presentation separate while preserving the distinctions already computed upstream.

## Watchlist lifecycle state

Active watchlist records now carry lifecycle-oriented runtime state:

- `inactive`
- `activating`
- `active`
- `refresh_pending`
- `extension_pending`
- `stale`

This state stays inside the existing watchlist store/runtime manager path. The UI still only performs add/activate/deactivate actions.

## Design rules

- UI must not talk directly to Discord or IBKR
- Discord delivery belongs in the alert/router layer
- monitoring start/stop belongs in the monitoring/runtime layer
- watchlist state belongs in the watchlist store + watchlist persistence layer
- thread history must survive deactivate/reactivate cycles
- duplicate active records must not be created for the same symbol
- duplicate Discord threads must not be created unless reuse truly fails

## Current runtime entry points

- `src/runtime/main.ts`
  Existing runtime path for direct symbol-driven monitoring runs

- `src/runtime/manual-watchlist-server.ts`
  Local manual watchlist page and API for add/activate/deactivate operations

## Current local/manual persistence files

- `artifacts/manual-watchlist-state.json`
- `artifacts/discord-threads.json`
- `artifacts/adaptive-state.json`
