# Watchlist Daily Recaps Admin Review Progress

**Status:** Product plan owner-approved; runtime implementation not authorized

**Controlling alert plan:** [Alerting and Discord Expansion Plan](05_ALERTING_AND_DISCORD_EXPANSION_PLAN.md)

**Platform plan:** TraderLink Platform record
`docs/migration/watchlist-daily-recaps-plan.md`

## Owner-approved outcome

The future Admin Watchlist workflow generates ticker recaps only when the
owner requests them, preserves each ticker as a separate review item, builds a
selected final post, and sends it to Discord only after an explicit final
owner action.

The Discord body contains only the trade and what happened after the
Watchlist post. It contains no warning, tracking, deletion, cutoff, data
coverage, boundary, diagnostic or system language and never claims that a
member captured a move.

## Read-only runtime mapping

- [x] Watchlist activation owns the factual activation timestamp.
- [x] The initial Website snapshot carries the factual activation price and
  the Potential Path presentation.
- [x] Published AI Read cards carry immutable generation ids, publication
  timestamps, pullback plans and relevant levels.
- [x] Live ticker data is published to Platform at a bounded cadence while the
  entry is active.
- [x] Deactivation publishes one final Website snapshot, then stops monitoring
  and clears the runtime's in-memory per-symbol recap state.
- [x] The canonical runtime is the sole Discord publisher.
- [x] The existing `DailyWatchlistRecapService` polls a Platform source during
  a fixed 3:55 PM ET window, selects at most three tickers above a 5% gain, and
  posts automatically through the configured recap webhook.

## Planned runtime boundary

The future runtime portion is deliberately narrow:

1. accept only an authenticated, idempotent owner-reviewed recap post
   instruction through the existing private runtime boundary;
2. fetch or validate the exact immutable approved Platform composition;
3. post only to the established recap destination;
4. return a factual receipt that Platform can store; and
5. prevent repeated requests with the same idempotency key from creating a
   second Discord message.

The final trade-recap body is owner editable. Runtime appends `@everyone` and
the configured Premium Members role at the bottom, using the existing
server-only role setting without exposing its id. No edit, owner, generator or
system label is added to Discord.

Platform owns evidence, deterministic generation, review state, the correction
queue and the final preview. Runtime does not recreate that UI or store a
second mutable draft.

## Existing scheduler retirement boundary

The existing scheduled recap service remains unchanged during planning. It
must not be disabled until the reviewed on-demand path is implemented, release
ordered and verified. The coordinated replacement release must prevent both
duplicate recap publishers and a gap in the established Discord destination.

The replacement has no automatic generation time and no automatic Discord
post.

## Deterministic evidence requirements

- The Watchlist posted price and time are the sole performance baseline.
- A later AI Read cannot be applied to earlier price movement.
- Pullback-zone language requires accepted price facts after that AI Read was
  published.
- A zone that was merely approached cannot be described as reached or tested.
- **Near** means within 10% of the nearest published zone edge. At more than
  10%, recap language does not connect the move to that zone.
- A Needs-to-hold level can support a valid defense or reclaim recap regardless
  of the initial percentage decline from the Watchlist posted price. **Held**,
  **reclaimed** and **approached** remain separate factual outcomes.
- Any move after a pullback uses the actual accepted pullback price, not a
  hypothetical fill at the zone or Needs-to-hold level.
- Removed ticker evidence freezes at the final accepted detail-page state and
  later movement is ignored.
- No provider or OpenAI request is introduced by recap generation.

## Owner-approved product decisions

- [x] Near-zone distance is 10% from the nearest edge; no separate minimum
  later-gain threshold controls recap eligibility.
- [x] Append `@everyone` and the configured Premium Members role at the bottom
  of the final recap.
- [x] Use manual cleanup only, show **Cleanup recommended** after 30 days and
  never auto-delete.
- [x] Retain **Needs correction** until explicit resolve/delete.
- [x] Allow post-success deletion of heavy evidence while retaining the exact
  posted body, time, Discord receipt/link and idempotency key until explicit
  deletion.
- [x] Allow the owner to edit the entire ticker recap and combined post while
  preserving generated, edited and posted revisions internally and showing no
  edit/system label in Discord.

## Checkpoint restrictions

No runtime source, configuration, Discord permission, webhook, provider,
server, test, build, Git publication, deployment or restart change is part of
this documentation checkpoint.
