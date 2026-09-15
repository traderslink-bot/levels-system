# Approved Watchlist Discord cooldown recovery

September 15 owner-authorized repair. Extends
[the earlier incident repair](watchlist-discord-rate-limit-incident.md).

## Implemented

- Preserve 429 scope, reason and absolute retry time in the hashed review event.
- Serialize gateway calls and retain the bot cooldown on durable storage across
  restarts. No repeated API probing during the cooldown; add a one-second margin.
- A 30-second scheduler checks active/current approvals for newly recorded,
  confirmed 429 rejections. Resume frozen approved chunks/images after cooldown,
  retaining their existing nonce, exact content and acknowledgement guards.
- Stop retrying after success, cancellation/deactivation, newer unapproved edits,
  uncertain sends or a non-429 rejection. Further 429s reschedule without AI.
- Owner status says delivery waits for Discord and retries automatically.
- Legacy rejected entries are not automatically replayed. ADBT remains untouched.

## Verification and release boundary

Focused mocked cooldown/gateway/review/API/scheduler tests run serially with a
384 MB heap. No real Discord sends, analysis requests, database migrations or
hosted variable changes are part of local verification. Coordinator performs
immutable-source type/build checks and serialized hosted deployment.

After healthy deployment, recover only the currently active owner-approved YFOR
through the existing retry endpoint. If Discord rejects it again with 429, that
attempt records the cooldown and automatically schedules recovery. Do not retry
ADBT or blanket-replay old failures. Do not retry uncertain claims.

The earlier global/IP restriction's external trigger remains unknown. This fix
does not bypass Discord limits or promise to lift an external restriction.

Rollback: deploy the preceding runtime source; leave the additive cooldown file
and review events intact. The old source will not schedule these retries.
