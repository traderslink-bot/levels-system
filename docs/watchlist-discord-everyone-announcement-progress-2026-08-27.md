# Watchlist Discord Everyone Announcement Progress

**Status:** Implemented locally; release pending

**Controlling plan:** [Alerting and Discord Expansion Plan](05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md)

## Scope

Send one actual `@everyone` mention only when a newly created Watchlist ticker
finishes its initial non-same-day activation. This is the existing
`threadRouting.created && !reuseExistingSameDayContext` boundary.

The change is limited to the real Discord REST gateway's
`announceTickerAdded` sender. It prepends literal `@everyone` to the existing
Watchlist link message and uses Discord `allowed_mentions` with only
`parse: ["everyone"]`.

## Exclusions

No mention is added to thread creation, AI reads, price or level updates,
refreshes, removals/deactivations, clear operations, failures, local fallback
messages, generic Discord senders, or any Platform service.

## Pre-release prerequisite

The Watchlist bot must have Discord `MENTION_EVERYONE` permission in the
target Watchlist channel, with no channel override denying it. This is an
external Discord permission prerequisite only; this checkpoint does not read
or change Discord configuration or send a Discord message.

## Local checkpoint

- [x] Mapped the real activation -> router -> audited/publishing gateway ->
  Discord REST announcement path.
- [x] Added an announcement-only REST payload with literal `@everyone` and
  `allowed_mentions: { parse: ["everyone"] }`.
- [x] Preserved the existing activation boundary and all generic/other message
  paths.
- [ ] Coordinator release and post-release permission/behavior verification.

## Verification boundary

Only focused source review and `git diff --check` are permitted for this
checkpoint. No test suite, build, server, runtime action, Discord/provider
call, deployment, restart, or configuration mutation is part of this work.
