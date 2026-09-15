# September 15 Discord delivery incident

Read-only hosted review evidence: MYSZ and ADBT website deliveries acknowledged;
Discord sends explicitly rejected with HTTP 429. No owner approvals were rejected.
One hosted GET /users/@me returned 429, code 0, global-rate-limit access-block
message and Retry-After 2641 seconds. No claim that owner posts were too frequent.
Bot-wide versus shared-hosting-IP origin remains unconfirmed.

Correction: approved short route cooldowns honor header/body wait and retry
identical content up to three times. Global access blocks suppress further
gateway network calls until the provider cooldown expires. Unknown/timeout sends
are not blindly replayed. Owner-facing errors distinguish Discord refusal from
approval. Existing persisted rejected deliveries are not automatically replayed.

34 focused gateway, review API and approved-delivery tests pass. No real messages,
owner record mutations, migrations, AI requests, or settings changes performed.
ADBT is explicitly prohibited from sending. Coordinator owns production release.
The global block itself cannot be lifted by this code change.
