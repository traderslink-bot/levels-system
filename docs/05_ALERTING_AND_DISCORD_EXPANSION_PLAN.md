# Alerting and Discord Expansion Plan

## Current state

The project now has a working manual watchlist operations layer for Discord-oriented delivery.

This phase is intentionally narrow:
- manual symbol entry only
- Discord thread management only
- local/manual UI only
- no AI watchlist selection
- no website delivery system
- no Discord command bot yet

## What is implemented now

### Manual watchlist operations

The system now supports:
- manual symbol input
- optional note input
- activate/add flow from a small local page
- deactivate flow from the same page
- persisted watchlist state across restarts

### Discord thread handling

For each manually managed symbol:
- symbol is normalized
- stored Discord thread id is checked first
- if the stored thread is valid, it is reused
- if stored reuse fails, one recovery path is attempted by exact symbol thread name
- if recovery fails, a new thread is created
- thread name is the symbol only
- thread id is persisted for future reuse

This preserves thread history across deactivate/reactivate cycles.

### Level snapshot posting

Each symbol thread now also receives a separate deterministic level snapshot message:
- on every activation
- on reactivation of a previously used symbol
- after a live refresh trigger when price approaches the highest resistance from the last posted snapshot

Level snapshots are separate from interpretation alerts and include:
- symbol
- support levels
- resistance levels

Current refresh behavior:
- track the highest resistance from the last posted snapshot
- if live price moves within the configured threshold of that resistance, rebuild levels
- post a fresh level snapshot before price moves into the next resistance area
- suppress repeated reposts at the same boundary with stored refresh metadata

### Alert delivery boundary

The UI does not talk directly to Discord.

The current flow is:

manual UI
-> manual watchlist runtime manager
-> alert intelligence engine
-> alert router / Discord thread router
-> Discord thread gateway

That separation is intentional and remains in place now that the first real Discord REST adapter is available.

### Alert intelligence behavior

Trader-facing event alerts now run through the alert-intelligence layer before routing.

Current scoring and formatting preserve:
- canonical vs promoted-extension origin
- outermost vs inner ladder position
- fresh vs aging vs stale zone context
- remap and recent-refresh context when relevant
- data-quality degradation when relevant
- structural zone strength and confluence

Current filtering intentionally suppresses:
- weak low-confidence inner-ladder touches
- weak inner-ladder compression chatter
- low-severity alerts when data quality is degraded

Level snapshots and next-level extension posts remain separate message types and are not mixed into event-alert formatting.

### Posting policy and deduplication

The alert layer now also applies explicit delivery policy before posting an event alert:

- structural posting families are derived from the event type
- alerts are keyed by scope and state using canonical zone, side, ladder position, origin, freshness, remap state, refresh/promotion state, and data-quality state
- repeated alerts for the same structural situation are suppressed
- lower-value inner-ladder alerts are suppressed when a stronger recent alert already represents that same scope
- materially new state changes are preserved and can still post even inside a short interval

This keeps the Discord thread from filling with repeated versions of the same structural story while still allowing meaningful new information through.

## Files involved in the current implementation

### Alert layer

- `src/lib/alerts/alert-types.ts`
- `src/lib/alerts/alert-router.ts`
- `src/lib/alerts/local-discord-thread-gateway.ts`

### Watchlist and runtime orchestration

- `src/lib/monitoring/watchlist-store.ts`
- `src/lib/monitoring/watchlist-state-persistence.ts`
- `src/lib/monitoring/manual-watchlist-runtime-manager.ts`
- `src/lib/monitoring/watchlist-monitor.ts`
- `src/runtime/manual-watchlist-server.ts`

## Persistence behavior

Current watchlist persistence includes:
- symbol
- active state
- priority
- tags
- optional note
- stored Discord thread id

Current Discord thread persistence includes:
- thread id
- thread name
- local message history for manual/local testing

## Real Discord activation workflow

The manual watchlist runtime can now post into real Discord threads when these environment variables are set:

- `DISCORD_BOT_TOKEN`
- `DISCORD_WATCHLIST_CHANNEL_ID`
- `DISCORD_GUILD_ID` (recommended for thread recovery by exact symbol name)

Current runtime behavior:
- if Discord credentials are configured, `src/runtime/manual-watchlist-server.ts` uses the real Discord REST thread gateway
- if credentials are not configured, it falls back to the local persisted gateway for manual/local testing

The real gateway currently:
- posts a starter message in the watchlist channel
- creates the symbol-named thread from that starter message
- posts initial level snapshots, extension posts, and event alerts into that thread
- reuses stored thread ids when valid
- attempts exact-name recovery through active guild threads and archived public threads when configured to do so

## What this phase does not do

- real Discord API integration
- Discord slash commands
- website delivery
- multi-user watchlist permissions
- AI-driven symbol selection
- duplicate strategy layers outside the current monitor/runtime path

## Remaining Discord-facing work later

The next safe Discord-facing expansions later are:
- slash commands or bot-side manual activation
- richer thread starter formatting if needed
- permission and failure-mode hardening against the live Discord API
