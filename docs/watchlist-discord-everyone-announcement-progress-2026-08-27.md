# Watchlist Discord Everyone and Premium Members Announcement Progress

**Status:** Implemented locally; release pending

**Controlling plan:** [Alerting and Discord Expansion Plan](05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md)

## Scope

Send actual `@everyone` and Premium Members role mentions only when a newly
created Watchlist ticker finishes its initial non-same-day activation. This is the existing
`threadRouting.created && !reuseExistingSameDayContext` boundary.

The change is limited to the real Discord REST gateway's
`announceTickerAdded` sender. It preserves the existing Watchlist link message,
then appends a blank line, literal `@everyone`, and the server-only configured
Premium Members role marker at the bottom. It permits only those mentions
through Discord `allowed_mentions`.

## Exclusions

No mention is added to thread creation, AI reads, price or level updates,
refreshes, removals/deactivations, clear operations, failures, local fallback
messages, generic Discord senders, or any Platform service.

## Pre-release prerequisite

The Watchlist bot must have Discord `MENTION_EVERYONE` permission in the
target Watchlist channel, with no channel override denying it. The controlled
release must also provide a valid server-only Premium role setting. This
checkpoint does not read or change Discord configuration or send a Discord
message. Missing or malformed role configuration fails closed; it never sends
an `@everyone`-only partial announcement.

## Local checkpoint

- [x] Mapped the real activation -> router -> audited/publishing gateway ->
  Discord REST announcement path.
- [x] Added an announcement-only REST payload with literal `@everyone`, the
  configured Premium Members role marker, and narrow `allowed_mentions`.
- [x] Validate the server-only Premium role setting as a Discord snowflake
  before it can be used; do not log, return, or expose its value.
- [x] Preserved the existing activation boundary and all generic/other message
  paths.
- [ ] Coordinator release and post-release permission/behavior verification.

## Verification boundary

Only focused source review and `git diff --check` are permitted for this
checkpoint. No test suite, build, server, runtime action, Discord/provider
call, deployment, restart, or configuration mutation is part of this work.
