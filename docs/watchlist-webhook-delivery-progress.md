# Watchlist webhook delivery

Owner authorized a dedicated incoming webhook on September 15. The supplied
URL is a credential and must exist only in secret configuration, never source,
logs, documentation or the release handoff.

- Optional `DISCORD_WATCHLIST_WEBHOOK_URL` switches approved notifications and
  ordinary ticker-added announcements to webhook delivery with `wait=true`.
- Keep exact saved content, links, image bytes, approval requirements and receipts.
- Verify the webhook belongs to the configured Watchlist channel before posting.
- Never attach bot credentials to webhook requests, and redact transport errors.
- No automatic bot fallback or dual delivery. Webhook receipts use the webhook
  message endpoint; unknown sends remain unknown until verified.
- Preserve the existing durable cooldown across the transport switch. This is
  not an attempt to bypass an active Discord/IP restriction.
- Bot configuration remains available for retained legacy functions; unset the
  webhook option to roll back transport without deleting saved review history.

54 focused mocked delivery/review/scheduler tests pass with one worker and a
384 MB heap. No real Discord or AI calls were made by these tests. Runtime
TypeScript/build and hosted delivery acceptance belong to the coordinator.

Deployment: set the webhook secret using stdin with automatic deployment skipped,
then publish the exact reconciled runtime commit in the reserved release lane.
After healthy deployment and any outstanding cooldown, recover only the current
approved YFOR. Do not send ADBT or replay the remaining legacy failures.

Related: [durable cooldown repair](watchlist-discord-durable-cooldown-progress.md).
